#!/usr/bin/env node
/* 关卡自检：校验地图/路线，并用脚本化的部署方案模拟每一关。
 * 用法：node tools/check.js [--verbose]
 */
'use strict';
const path = require('path');
require(path.join(__dirname, '../js/data.js'));
require(path.join(__dirname, '../js/engine.js'));
const TD = globalThis.TD;
const { LEVELS } = TD.DATA;
const verbose = process.argv.includes('--verbose');

// 方向：0 右 1 下 2 左 3 上
const PLANS = {
  L1: {
    full: [
      ['reed', 6, 3, 2], ['kestrel', 7, 2, 2], ['frostedge', 5, 3, 2],
      ['egret', 7, 4, 2], ['fluorite', 6, 4, 2], ['mistweaver', 4, 2, 1],
    ],
    weak: [['reed', 6, 3, 2]],
  },
  L2: {
    full: [
      ['reed', 5, 2, 2], ['kestrel', 7, 1, 1], ['frostedge', 5, 4, 2], ['fluorite', 7, 3, 2],
      ['egret', 4, 3, 0], ['anvil', 9, 3, 2], ['mistweaver', 7, 5, 3],
    ],
    weak: [['reed', 5, 2, 2], ['kestrel', 7, 1, 1]],
  },
  L3: {
    full: [
      ['reed', 6, 1, 2], ['kestrel', 5, 2, 1], ['frostedge', 5, 3, 0], ['fluorite', 6, 2, 1],
      ['egret', 4, 2, 0], ['anvil', 6, 5, 2], ['mistweaver', 7, 4, 1],
    ],
    weak: [['reed', 4, 1, 2], ['kestrel', 5, 4, 3], ['frostedge', 5, 3, 0]],
  },
  L4: {
    full: [
      ['reed', 7, 3, 0], ['kestrel', 1, 2, 0], ['anvil', 5, 3, 0], ['fluorite', 7, 4, 3],
      ['egret', 4, 2, 0], ['frostedge', 6, 3, 0], ['mistweaver', 5, 4, 0], ['maple', 3, 3, 0],
    ],
    weak: [['reed', 7, 3, 0], ['kestrel', 5, 2, 0], ['anvil', 5, 3, 0], ['fluorite', 7, 4, 3]],
  },
};

function simulate(level, plan) {
  const g = new TD.Game(level, TD.DATA);
  const dt = 1 / 30;
  let next = 0;
  const issues = [];
  while (g.state === 'playing' && g.time < 600) {
    if (next < plan.length) {
      const [id, x, y, dir] = plan[next];
      const ci = g.cards.findIndex(c => c.id === id);
      if (ci < 0) throw new Error(`${level.id}: 编队中没有 ${id}`);
      if (!g.canPlace(g.cards[ci], x, y) && !g.cards[ci].unit) {
        const t = g.map.tile(x, y);
        throw new Error(`${level.id}: 方案中 ${id} 无法部署在 (${x},${y})，该格为 ${t ? t.kind : '越界'}`);
      }
      if (g.cardStatus(g.cards[ci]) === 'ready') {
        g.deploy(ci, x, y, dir);
        if (verbose) console.log(`  t=${g.time.toFixed(1)} 部署 ${id} @(${x},${y})`);
        next++;
      }
    } else {
      // 方案全部部署后，补位阵亡干员
      for (const [id, x, y, dir] of plan) {
        const ci = g.cards.findIndex(c => c.id === id);
        if (g.cardStatus(g.cards[ci]) === 'ready' && g.canPlace(g.cards[ci], x, y)) g.deploy(ci, x, y, dir);
      }
    }
    for (const u of g.units) {
      const s = u.def.skill;
      if (s.trigger !== 'manual' || !u.skillReady) continue;
      if (s.kind === 'dp' || g.enemyTargets(u).length) g.activateSkill(u);
    }
    g.update(dt);
    for (const ev of g.events) {
      if (ev.type === 'unitDown') issues.push(`t=${g.time.toFixed(1)} ${ev.unit.def.name} 阵亡`);
      if (ev.type === 'leak' && verbose) console.log(`  t=${g.time.toFixed(1)} 漏怪 ${ev.enemy.def.name}`);
    }
    g.events.length = 0;
  }
  return { state: g.state, life: g.life, leaked: g.leaked, killed: g.killed, total: g.total, time: g.time, stars: g.stars(), issues };
}

let failed = false;
for (const level of LEVELS) {
  let game;
  try {
    game = new TD.Game(level, TD.DATA);
  } catch (err) {
    console.error(`✗ ${level.id} 数据错误：${err.message}`);
    failed = true;
    continue;
  }
  const routes = game.map.routes.map((r, i) => `#${i}${r.flying ? '(飞行)' : ''} 长度 ${r.length.toFixed(1)}`).join('，');
  console.log(`■ ${level.code} ${level.name}  ${game.map.cols}×${game.map.rows}  敌人 ${game.total}  最后出怪 ${game.lastSpawnTime}s`);
  console.log(`  路线：${routes}`);

  const idle = simulate(level, []);
  const plans = PLANS[level.id];
  const full = simulate(level, plans.full);
  const weak = simulate(level, plans.weak);
  const fmt = r => `${r.state === 'won' ? '胜利' : '失败'} 生命 ${r.life} 漏 ${r.leaked} 击破 ${r.killed}/${r.total} ${r.stars}★ 用时 ${r.time.toFixed(0)}s`;
  console.log(`  不部署：${fmt(idle)}`);
  console.log(`  简陋方案：${fmt(weak)}`);
  console.log(`  完整方案：${fmt(full)}`);
  if (full.issues.length) console.log(`    ${full.issues.join('；')}`);

  if (idle.state !== 'lost') { console.error('  ✗ 不部署也能通关，难度过低'); failed = true; }
  if (full.state !== 'won') { console.error('  ✗ 完整方案未能通关'); failed = true; }
  if (weak.state === 'won' && weak.stars === 3) { console.error('  ✗ 简陋方案也能三星，难度过低'); failed = true; }
}
if (failed) { console.error('\n自检未通过'); process.exit(1); }
console.log('\n✓ 自检通过');
