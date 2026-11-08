/* 烬土防线 · 游戏数据：干员、敌人、关卡
 * 所有角色、敌人与关卡均为原创设定。
 */
(function (G) {
  'use strict';
  const TD = (G.TD = G.TD || {});

  // 生成矩形范围（以“面朝右”为基准，dx 向前，dy 向侧方）
  function rect(x0, x1, y0, y1, extra) {
    const out = [];
    for (let dx = x0; dx <= x1; dx++) for (let dy = y0; dy <= y1; dy++) out.push([dx, dy]);
    return extra ? out.concat(extra) : out;
  }

  // 图标：24×24 视窗下的 SVG 路径，DOM 与 Canvas 共用
  const ICONS = {
    outrider: 'M7 21V3M7 4h11l-3.2 4L18 12H7',
    bulwark: 'M12 2.8l7.5 3v5.4c0 4.9-3.2 8.3-7.5 10-4.3-1.7-7.5-5.1-7.5-10V5.8z',
    blade: 'M19.5 3.5L9 14M15 3.5h4.5V8M6.5 11.5l6 6M4 20l3.6-3.6',
    lancer: 'M3 21L19 5M14.5 3.5H20.5V9.5M7 13l4 4',
    hawkeye: 'M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5M17.5 12a5.5 5.5 0 1 1-11 0a5.5 5.5 0 1 1 11 0',
    arcanist: 'M12 2.5l2.4 7.1 7.1 2.4-7.1 2.4L12 21.5l-2.4-7.1L2.5 12l7.1-2.4z',
    mender: 'M9.6 3.5h4.8v6.1h6.1v4.8h-6.1v6.1H9.6v-6.1H3.5V9.6h6.1z',
    binder: 'M13.5 12a4.5 4.5 0 1 1-9 0a4.5 4.5 0 1 1 9 0M19.5 12a4.5 4.5 0 1 1-9 0a4.5 4.5 0 1 1 9 0',
    life: 'M12 21s-7.5-4.6-9.3-9.6C1.4 7.9 3.8 4 7.6 4c2 0 3.4 1 4.4 2.5C13 5 14.4 4 16.4 4c3.8 0 6.2 3.9 4.9 7.4C19.5 16.4 12 21 12 21z',
    enemy: 'M12 2.5l9.5 9.5-9.5 9.5L2.5 12z',
  };

  const CLASSES = {
    outrider: { name: '先遣', en: 'Outrider', color: '#e8a33d', desc: '低费快速部署，技能可回复部署点数。阻挡 1。' },
    bulwark: { name: '重盾', en: 'Bulwark', color: '#5b8def', desc: '高防御，可同时阻挡 3 名敌人。' },
    blade: { name: '刃卫', en: 'Blade', color: '#e5534b', desc: '近战主力，阻挡 2，攻击前方一格。' },
    lancer: { name: '枪卫', en: 'Lancer', color: '#f0883e', desc: '攻击前方两格内的全部敌人。阻挡 1。' },
    hawkeye: { name: '远射', en: 'Hawkeye', color: '#57c27a', desc: '部署于高台，物理远程，优先攻击空中单位。' },
    arcanist: { name: '秘仪', en: 'Arcanist', color: '#a371f7', desc: '部署于高台，造成法术伤害，克制重甲。' },
    mender: { name: '愈疗', en: 'Mender', color: '#4fd1c5', desc: '部署于高台，治疗范围内受伤的友方。' },
    binder: { name: '缚咒', en: 'Binder', color: '#db61a2', desc: '部署于高台，法术攻击并减速敌人。' },
  };

  /* 干员
   * type: ground 只能部署在地面；high 只能部署在高台
   * range: 面朝右时的攻击格（含自身所在格 [0,0]）
   * dmg: phys 物理 / arts 法术 / heal 治疗
   */
  const UNITS = {
    reed: {
      name: '苇莺', en: 'Reed', cls: 'outrider', type: 'ground',
      cost: 10, redeploy: 25, hp: 1500, atk: 420, def: 260, res: 0, interval: 1.05,
      block: 1, dmg: 'phys', air: false, range: [[0, 0], [1, 0]],
      skill: {
        name: '整军', desc: '立即获得 12 点部署点数。', sp: 24, spInit: 10,
        charge: 'time', trigger: 'manual', kind: 'dp', value: 12,
      },
    },
    anvil: {
      name: '铁砧', en: 'Anvil', cls: 'bulwark', type: 'ground',
      cost: 18, redeploy: 60, hp: 3200, atk: 340, def: 620, res: 10, interval: 1.2,
      block: 3, dmg: 'phys', air: false, range: [[0, 0]],
      skill: {
        name: '坚壁', desc: '15 秒内防御力 +100%，每秒回复 2.5% 最大生命。', sp: 30, spInit: 12,
        charge: 'time', trigger: 'manual', kind: 'buff', duration: 15, buff: { def: 2.0, regen: 0.025 },
      },
    },
    frostedge: {
      name: '霜刃', en: 'Frostedge', cls: 'blade', type: 'ground',
      cost: 15, redeploy: 60, hp: 2300, atk: 600, def: 330, res: 0, interval: 1.25,
      block: 2, dmg: 'phys', air: false, range: [[0, 0], [1, 0]],
      skill: {
        name: '裂空', desc: '每攻击 4 次，下一次攻击对范围内所有敌人造成 220% 攻击力的伤害。（自动）', sp: 4, spInit: 0,
        charge: 'attack', trigger: 'auto', kind: 'nextAttack', mult: 2.2,
      },
    },
    maple: {
      name: '赤枫', en: 'Maple', cls: 'lancer', type: 'ground',
      cost: 14, redeploy: 50, hp: 1900, atk: 500, def: 280, res: 0, interval: 1.3,
      block: 1, dmg: 'phys', air: false, range: [[0, 0], [1, 0], [2, 0]], targets: 99,
      skill: {
        name: '贯虹', desc: '12 秒内攻击力 +70%。', sp: 28, spInit: 8,
        charge: 'time', trigger: 'manual', kind: 'buff', duration: 12, buff: { atk: 1.7 },
      },
    },
    kestrel: {
      name: '隼', en: 'Kestrel', cls: 'hawkeye', type: 'high',
      cost: 12, redeploy: 70, hp: 1100, atk: 470, def: 120, res: 0, interval: 1.0,
      block: 0, dmg: 'phys', air: true, preferAir: true, ranged: true, range: rect(0, 3, -1, 1),
      skill: {
        name: '疾射', desc: '15 秒内攻击间隔缩短 50%，攻击力 +15%。', sp: 30, spInit: 10,
        charge: 'time', trigger: 'manual', kind: 'buff', duration: 15, buff: { interval: 0.5, atk: 1.15 },
      },
    },
    fluorite: {
      name: '萤石', en: 'Fluorite', cls: 'arcanist', type: 'high',
      cost: 19, redeploy: 70, hp: 1000, atk: 560, def: 90, res: 20, interval: 1.6,
      block: 0, dmg: 'arts', air: true, ranged: true, range: rect(0, 2, -1, 1, [[3, 0]]),
      skill: {
        name: '星陨', desc: '15 秒内攻击力 +50%，攻击对目标周围的敌人造成溅射伤害。', sp: 40, spInit: 16,
        charge: 'time', trigger: 'manual', kind: 'buff', duration: 15, buff: { atk: 1.5, splash: 1.2 },
      },
    },
    egret: {
      name: '白鹭', en: 'Egret', cls: 'mender', type: 'high',
      cost: 16, redeploy: 70, hp: 1050, atk: 380, def: 110, res: 10, interval: 2.2,
      block: 0, dmg: 'heal', air: false, ranged: true, range: rect(0, 3, -1, 1, [[-1, 0]]),
      skill: {
        name: '复苏', desc: '10 秒内每次治疗 3 名友方，治疗量 +20%。（自动）', sp: 24, spInit: 6,
        charge: 'time', trigger: 'auto', kind: 'buff', duration: 10, buff: { targets: 3, atk: 1.2 },
      },
    },
    mistweaver: {
      name: '织雾', en: 'Mistweaver', cls: 'binder', type: 'high',
      cost: 13, redeploy: 70, hp: 1150, atk: 380, def: 100, res: 20, interval: 1.8,
      block: 0, dmg: 'arts', air: true, ranged: true, range: rect(0, 2, -1, 1), slow: { amt: 0.4, t: 1.4 },
      skill: {
        name: '禁锢', desc: '使范围内所有敌人停滞 3.5 秒，并造成 160% 攻击力的法术伤害。', sp: 32, spInit: 14,
        charge: 'time', trigger: 'manual', kind: 'stasis', mult: 1.6, stun: 3.5,
      },
    },
  };

  /* 敌人
   * speed: 格/秒；weight: 占用的阻挡数；leak: 进入防御点扣除的生命
   */
  const ENEMIES = {
    drifter: {
      name: '游荡者', desc: '最常见的敌人，没有特别之处。',
      hp: 1700, atk: 380, def: 110, res: 0, speed: 0.75, interval: 2.0, dmg: 'phys', weight: 1, leak: 1, shape: 'drifter', color: '#d0564f', size: 0.24,
    },
    carapace: {
      name: '甲壳兵', desc: '防御力很高，物理攻击难以奏效，建议用法术处理。',
      hp: 3200, atk: 560, def: 450, res: 0, speed: 0.5, interval: 2.6, dmg: 'phys', weight: 1, leak: 1, shape: 'carapace', color: '#a2453f', size: 0.28,
    },
    runner: {
      name: '疾行者', desc: '移动迅速，注意提前阻挡。',
      hp: 1100, atk: 300, def: 60, res: 0, speed: 1.35, interval: 1.2, dmg: 'phys', weight: 1, leak: 1, shape: 'runner', color: '#ff7b5c', size: 0.22,
    },
    hexer: {
      name: '咒术者', desc: '远程法术攻击干员，法术抗性较高。',
      hp: 1500, atk: 260, def: 60, res: 50, speed: 0.6, interval: 2.8, dmg: 'arts', range: 2.3, weight: 1, leak: 1, shape: 'hexer', color: '#b062d6', size: 0.24,
    },
    wisp: {
      name: '浮游体', desc: '飞行单位，无视地形直线前进，近战干员无法攻击。',
      hp: 1300, atk: 0, def: 60, res: 10, speed: 0.8, interval: 99, dmg: 'phys', weight: 1, leak: 1, flying: true, shape: 'wisp', color: '#ff9db0', size: 0.22,
    },
    colossus: {
      name: '巨像', desc: '首领单位。生命与攻击极高，占用 3 点阻挡，进入防御点扣除 3 点生命。',
      hp: 15000, atk: 950, def: 380, res: 40, speed: 0.32, interval: 3.2, dmg: 'phys', weight: 3, leak: 3, boss: true, shape: 'colossus', color: '#8e2b39', size: 0.38,
    },
  };

  /* 地图字符
   * #  墙体（不可通行、不可部署）
   * .  地面（可通行，可部署近战）
   * ,  道路（可通行，不可部署）
   * h  高台（可部署远程）
   * H  高台（不可部署）
   * R  敌方入口（按阅读顺序编号 0,1,2…）
   * P  防御点
   */
  const LEVELS = [
    {
      id: 'L1', code: '01', name: '拂晓前哨', en: 'Dawn Outpost',
      brief: '教学关卡。单条通道，先在地面放置近战干员阻挡敌人，再在高台布置远程火力。',
      life: 10, startDP: 10, unitLimit: 6,
      map: [
        '############',
        '#hhhhh#hhhh#',
        '#h..hhhh.hh#',
        'R,........,P',
        '#hh.hhhh..h#',
        '#hhhh#hhhhh#',
        '############',
      ],
      routes: [{ spawn: 0 }],
      waves: [
        { t: 6, e: 'drifter', r: 0, n: 3, gap: 4 },
        { t: 26, e: 'drifter', r: 0, n: 4, gap: 3 },
        { t: 44, e: 'carapace', r: 0 },
        { t: 50, e: 'runner', r: 0, n: 2, gap: 2 },
        { t: 60, e: 'drifter', r: 0, n: 4, gap: 2.5 },
        { t: 68, e: 'carapace', r: 0 },
      ],
    },
    {
      id: 'L2', code: '02', name: '断桥', en: 'Broken Bridge',
      brief: '两路敌人在桥头汇合，空中会出现飞行单位——记得安排能对空的远程干员。',
      life: 10, startDP: 12, unitLimit: 7,
      map: [
        'R,..hh######',
        '#hh.hh#hhhh#',
        '#hh......hh#',
        '##hhhh#h..,P',
        '#hh......hh#',
        '#hh.hh#hhhh#',
        'R,..hh######',
      ],
      routes: [
        { spawn: 0, via: [[3, 0], [3, 2], [8, 2], [8, 3]] },
        { spawn: 1, via: [[3, 6], [3, 4], [8, 4], [8, 3]] },
        { spawn: 0, flying: true },
        { spawn: 1, flying: true },
      ],
      waves: [
        { t: 5, e: 'drifter', r: 0, n: 3, gap: 3 },
        { t: 14, e: 'drifter', r: 1, n: 3, gap: 3 },
        { t: 28, e: 'runner', r: 0, n: 3, gap: 1.6 },
        { t: 36, e: 'wisp', r: 2, n: 3, gap: 2 },
        { t: 42, e: 'carapace', r: 1, n: 2, gap: 4 },
        { t: 54, e: 'drifter', r: 0, n: 4, gap: 2 },
        { t: 56, e: 'drifter', r: 1, n: 4, gap: 2 },
        { t: 68, e: 'wisp', r: 3, n: 3, gap: 1.6 },
        { t: 72, e: 'runner', r: 1, n: 3, gap: 1.4 },
        { t: 82, e: 'carapace', r: 0, n: 2, gap: 3 },
        { t: 84, e: 'drifter', r: 1, n: 3, gap: 2.5 },
      ],
    },
    {
      id: 'L3', code: '03', name: '雾港回廊', en: 'Misty Corridor',
      brief: '蜿蜒的回廊让高台能同时覆盖两段通道。咒术者会远程攻击干员，最后会有巨像登场。',
      life: 10, startDP: 14, unitLimit: 7,
      map: [
        '############',
        'R,........h#',
        '#hhhhhhhh.h#',
        '#h........h#',
        '#h.hhhhhhhh#',
        '#h........,P',
        '#hhhh##hhhh#',
        '############',
      ],
      routes: [
        { spawn: 0, via: [[9, 1], [9, 3], [2, 3], [2, 5]] },
        { spawn: 0, flying: true },
      ],
      waves: [
        { t: 5, e: 'drifter', r: 0, n: 4, gap: 2.5 },
        { t: 18, e: 'hexer', r: 0, n: 2, gap: 4 },
        { t: 30, e: 'runner', r: 0, n: 4, gap: 1.3 },
        { t: 40, e: 'carapace', r: 0, n: 2, gap: 3 },
        { t: 50, e: 'wisp', r: 1, n: 4, gap: 1.5 },
        { t: 60, e: 'hexer', r: 0, n: 3, gap: 3 },
        { t: 64, e: 'drifter', r: 0, n: 5, gap: 2 },
        { t: 84, e: 'colossus', r: 0 },
        { t: 90, e: 'drifter', r: 0, n: 4, gap: 2 },
        { t: 96, e: 'wisp', r: 1, n: 3, gap: 1.5 },
      ],
    },
    {
      id: 'L4', code: '04', name: '终焉堡垒', en: 'Last Bastion',
      brief: '三个入口同时施压，防御点位于左侧。合理分配阻挡位与部署点数，迎击两名巨像。',
      life: 10, startDP: 16, unitLimit: 8,
      map: [
        '##hhhhR#hhhh#',
        '#hhhhh.h...,R',
        '#h..hh.h.hhh#',
        'P,.......hhh#',
        '#h..hhhh.hhh#',
        '#hhhhhhh...,R',
        '#hhhh###hhhh#',
      ],
      routes: [
        { spawn: 1, via: [[8, 1], [8, 3]] },
        { spawn: 2, via: [[8, 5], [8, 3]] },
        { spawn: 0, via: [[6, 3]] },
        { spawn: 0, flying: true },
        { spawn: 1, flying: true },
        { spawn: 2, flying: true },
      ],
      waves: [
        { t: 5, e: 'drifter', r: 0, n: 3, gap: 3 },
        { t: 12, e: 'drifter', r: 1, n: 3, gap: 3 },
        { t: 24, e: 'runner', r: 2, n: 3, gap: 1.5 },
        { t: 32, e: 'hexer', r: 0, n: 2, gap: 3 },
        { t: 38, e: 'carapace', r: 1, n: 2, gap: 3 },
        { t: 46, e: 'wisp', r: 3, n: 3, gap: 1.5 },
        { t: 54, e: 'drifter', r: 0, n: 4, gap: 2 },
        { t: 56, e: 'drifter', r: 1, n: 4, gap: 2 },
        { t: 66, e: 'colossus', r: 0 },
        { t: 72, e: 'hexer', r: 1, n: 2, gap: 3 },
        { t: 78, e: 'wisp', r: 4, n: 2, gap: 1.5 },
        { t: 80, e: 'wisp', r: 5, n: 2, gap: 1.5 },
        { t: 88, e: 'runner', r: 2, n: 4, gap: 1.2 },
        { t: 96, e: 'carapace', r: 0, n: 2, gap: 3 },
        { t: 104, e: 'colossus', r: 1 },
        { t: 108, e: 'drifter', r: 2, n: 4, gap: 2 },
      ],
    },
  ];

  TD.DATA = { ICONS, CLASSES, UNITS, ENEMIES, LEVELS };
  TD.SQUAD = ['reed', 'anvil', 'frostedge', 'maple', 'kestrel', 'fluorite', 'egret', 'mistweaver'];
})(typeof window !== 'undefined' ? window : globalThis);
