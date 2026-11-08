/* 烬土防线 · 核心逻辑（不依赖 DOM，可在 Node 中运行） */
(function (G) {
  'use strict';
  const TD = (G.TD = G.TD || {});

  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // 右 下 左 上
  const MAX_DP = 99;

  const TILE_TYPES = {
    '#': { kind: 'wall', walk: false, deploy: null, elev: 0.36 },
    '.': { kind: 'ground', walk: true, deploy: 'ground', elev: 0 },
    ',': { kind: 'road', walk: true, deploy: null, elev: 0 },
    h: { kind: 'high', walk: false, deploy: 'high', elev: 0.24 },
    H: { kind: 'high', walk: false, deploy: null, elev: 0.24 },
    R: { kind: 'spawn', walk: true, deploy: null, elev: 0 },
    P: { kind: 'base', walk: true, deploy: null, elev: 0 },
  };

  function rotate(dx, dy, dir) {
    switch (dir) {
      case 0: return [dx, dy];
      case 1: return [-dy, dx];
      case 2: return [-dx, -dy];
      default: return [dy, -dx];
    }
  }

  function calcDamage(amount, type, def, res) {
    if (type === 'phys') return Math.max(amount - def, amount * 0.05);
    if (type === 'arts') return Math.max(amount * (1 - res / 100), amount * 0.05);
    return amount;
  }

  function makePath(points) {
    const suffix = new Array(points.length).fill(0);
    for (let i = points.length - 2; i >= 0; i--) {
      suffix[i] = suffix[i + 1] + Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
    }
    return { pts: points, suffix, length: suffix[0] };
  }

  function compress(points) {
    if (points.length <= 2) return points;
    const out = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const a = out[out.length - 1], b = points[i], c = points[i + 1];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cross) > 1e-9) out.push(b);
    }
    out.push(points[points.length - 1]);
    return out;
  }

  /* 关卡地图：解析地形与敌人路线 */
  class GameMap {
    constructor(level) {
      this.rows = level.map.length;
      this.cols = level.map[0].length;
      this.tiles = [];
      this.spawns = [];
      this.bases = [];
      for (let y = 0; y < this.rows; y++) {
        const line = level.map[y];
        if (line.length !== this.cols) throw new Error(`${level.id}: 第 ${y} 行长度为 ${line.length}，应为 ${this.cols}`);
        const row = [];
        for (let x = 0; x < this.cols; x++) {
          const ch = line[x];
          const t = TILE_TYPES[ch];
          if (!t) throw new Error(`${level.id}: 未知地图字符 "${ch}" (${x},${y})`);
          const tile = { x, y, ch, kind: t.kind, walk: t.walk, deploy: t.deploy, elev: t.elev, unit: null };
          if (ch === 'R') this.spawns.push(tile);
          if (ch === 'P') this.bases.push(tile);
          row.push(tile);
        }
        this.tiles.push(row);
      }
      if (!this.spawns.length || !this.bases.length) throw new Error(`${level.id}: 缺少入口或防御点`);
      this.routes = level.routes.map((r, i) => this.buildRoute(r, i, level.id));
    }

    tile(x, y) {
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return null;
      return this.tiles[y][x];
    }

    buildRoute(r, idx, levelId) {
      const s = this.spawns[r.spawn];
      const b = this.bases[r.base || 0];
      if (!s || !b) throw new Error(`${levelId}: 路线 ${idx} 的入口或防御点不存在`);
      if (r.flying) {
        return Object.assign(makePath([[s.x + 0.5, s.y + 0.5], [b.x + 0.5, b.y + 0.5]]), { flying: true, spawn: r.spawn });
      }
      const pts = [[s.x, s.y]].concat(r.via || [], [[b.x, b.y]]);
      const tiles = [[s.x, s.y]];
      let lastDir = -1;
      for (let i = 0; i < pts.length - 1; i++) {
        const seg = this.bfs(pts[i], pts[i + 1], lastDir, levelId, idx);
        for (let k = 1; k < seg.tiles.length; k++) tiles.push(seg.tiles[k]);
        lastDir = seg.lastDir;
      }
      const centers = compress(tiles.map(t => [t[0] + 0.5, t[1] + 0.5]));
      return Object.assign(makePath(centers), { flying: false, spawn: r.spawn, tiles });
    }

    // 从 b 出发做距离场，再从 a 贪心走回，优先保持方向以得到整齐的折线
    bfs(a, b, lastDir, levelId, idx) {
      const { cols, rows } = this;
      const dist = new Int32Array(cols * rows).fill(-1);
      const q = [b[0] + b[1] * cols];
      const bt = this.tile(b[0], b[1]);
      if (!bt || !bt.walk) throw new Error(`${levelId}: 路线 ${idx} 的途经点 (${b}) 不可通行`);
      dist[q[0]] = 0;
      for (let qi = 0; qi < q.length; qi++) {
        const cur = q[qi], cx = cur % cols, cy = (cur / cols) | 0;
        for (const [dx, dy] of DIRS) {
          const t = this.tile(cx + dx, cy + dy);
          if (!t || !t.walk) continue;
          const k = t.x + t.y * cols;
          if (dist[k] >= 0) continue;
          dist[k] = dist[cur] + 1;
          q.push(k);
        }
      }
      if (dist[a[0] + a[1] * cols] < 0) throw new Error(`${levelId}: 路线 ${idx} 从 (${a}) 无法到达 (${b})`);
      const out = [[a[0], a[1]]];
      let x = a[0], y = a[1], dir = lastDir;
      while (x !== b[0] || y !== b[1]) {
        const d = dist[x + y * cols];
        let pick = -1;
        const order = dir >= 0 ? [dir, 0, 1, 2, 3] : [0, 1, 2, 3];
        for (const di of order) {
          const nx = x + DIRS[di][0], ny = y + DIRS[di][1];
          const t = this.tile(nx, ny);
          if (t && t.walk && dist[nx + ny * cols] === d - 1) { pick = di; break; }
        }
        x += DIRS[pick][0]; y += DIRS[pick][1]; dir = pick;
        out.push([x, y]);
      }
      return { tiles: out, lastDir: dir };
    }
  }

  let UID = 1;

  /* 部署中的干员 */
  class Unit {
    constructor(game, card, x, y, dir) {
      const d = card.def;
      this.uid = UID++;
      this.game = game;
      this.card = card;
      this.def = d;
      this.x = x; this.y = y; this.dir = dir;
      this.cx = x + 0.5; this.cy = y + 0.5;
      this.elev = game.map.tile(x, y).elev;
      this.maxHp = d.hp; this.hp = d.hp;
      this.sp = d.skill.spInit || 0;
      this.skillT = 0;
      this.atkCd = 0.25; // 部署后短暂准备
      this.blocked = [];
      this.blockUsed = 0;
      this.alive = true;
      this.mods = { atk: 1, def: 1, interval: 1, splash: 0, targets: 0, regen: 0 };
      this.range = new Set();
      this.rangeList = [];
      for (const [ox, oy] of d.range) {
        const [rx, ry] = rotate(ox, oy, dir);
        const tx = x + rx, ty = y + ry;
        if (tx < 0 || ty < 0 || tx >= game.map.cols || ty >= game.map.rows) continue;
        this.range.add(tx + ty * game.map.cols);
        this.rangeList.push([tx, ty]);
      }
      this.anim = { attack: 0, hurt: 0, deploy: 1 };
    }

    get atk() { return this.def.atk * this.mods.atk; }
    get defense() { return this.def.def * this.mods.def; }
    get res() { return this.def.res; }
    get interval() { return this.def.interval * this.mods.interval; }
    get skillReady() {
      const s = this.def.skill;
      return this.skillT <= 0 && this.sp >= s.sp;
    }

    recalcMods() {
      const m = this.mods;
      m.atk = 1; m.def = 1; m.interval = 1; m.splash = 0; m.targets = 0; m.regen = 0;
      const s = this.def.skill;
      if (this.skillT > 0 && s.buff) {
        const b = s.buff;
        if (b.atk) m.atk *= b.atk;
        if (b.def) m.def *= b.def;
        if (b.interval) m.interval *= b.interval;
        if (b.splash) m.splash = b.splash;
        if (b.targets) m.targets = b.targets;
        if (b.regen) m.regen = b.regen;
      }
    }

    inRange(px, py) {
      const tx = Math.floor(px), ty = Math.floor(py);
      if (tx < 0 || ty < 0 || tx >= this.game.map.cols || ty >= this.game.map.rows) return false;
      return this.range.has(tx + ty * this.game.map.cols);
    }
  }

  /* 敌人 */
  class Enemy {
    constructor(game, key, routeIdx) {
      const d = game.data.ENEMIES[key];
      const route = game.map.routes[routeIdx];
      this.uid = UID++;
      this.key = key;
      this.def = d;
      this.route = route;
      this.flying = !!d.flying;
      this.maxHp = d.hp; this.hp = d.hp;
      this.x = route.pts[0][0]; this.y = route.pts[0][1];
      this.seg = 1;
      this.remaining = route.length;
      this.blockedBy = null;
      this.atkCd = 0;
      this.pauseT = 0;
      this.stunT = 0;
      this.slowT = 0; this.slowAmt = 0;
      this.alive = true;
      this.vx = 1; this.vy = 0;
      this.anim = { hurt: 0, attack: 0, spawn: 1, bob: Math.random() * 6.28 };
    }
  }

  /* 一局游戏 */
  class Game {
    constructor(level, data, squad) {
      this.level = level;
      this.data = data;
      this.map = new GameMap(level);
      this.time = 0;
      this.dp = level.startDP;
      this.dpTimer = 0;
      this.dpRate = 1; // 每秒 1 点
      this.life = level.life;
      this.maxLife = level.life;
      this.unitLimit = level.unitLimit;
      this.units = [];
      this.enemies = [];
      this.projectiles = [];
      this.events = [];
      this.cards = (squad || TD.SQUAD).map((id, i) => ({ idx: i, id, def: data.UNITS[id], cooldown: 0, unit: null }));
      this.spawnList = [];
      for (const w of level.waves) {
        const n = w.n || 1;
        for (let i = 0; i < n; i++) this.spawnList.push({ t: w.t + i * (w.gap || 0), e: w.e, r: w.r });
      }
      this.spawnList.sort((a, b) => a.t - b.t);
      for (const s of this.spawnList) {
        if (!data.ENEMIES[s.e]) throw new Error(`${level.id}: 未知敌人 ${s.e}`);
        if (!this.map.routes[s.r]) throw new Error(`${level.id}: 未知路线 ${s.r}`);
        if (!!data.ENEMIES[s.e].flying !== !!this.map.routes[s.r].flying) throw new Error(`${level.id}: ${s.e} 与路线 ${s.r} 的飞行属性不一致`);
      }
      this.spawnIdx = 0;
      this.total = this.spawnList.length;
      this.killed = 0;
      this.leaked = 0;
      this.state = 'playing';
    }

    emit(ev) { this.events.push(ev); }
    get aliveUnits() { return this.units.filter(u => u.alive).length; }
    get lastSpawnTime() { return this.spawnList.length ? this.spawnList[this.spawnList.length - 1].t : 0; }

    // 未来 lookahead 秒内将要出现敌人的路线
    upcomingRoutes(lookahead) {
      const set = new Set();
      for (let i = this.spawnIdx; i < this.spawnList.length; i++) {
        const s = this.spawnList[i];
        if (s.t - this.time > lookahead) break;
        set.add(s.r);
      }
      return set;
    }

    nextBoss(lookahead) {
      for (let i = this.spawnIdx; i < this.spawnList.length; i++) {
        const s = this.spawnList[i];
        if (s.t - this.time > lookahead) break;
        if (this.data.ENEMIES[s.e].boss) return s;
      }
      return null;
    }

    /* ---------- 部署 / 撤退 / 技能 ---------- */

    cardStatus(card) {
      if (card.unit) return 'deployed';
      if (card.cooldown > 0) return 'cooldown';
      if (this.aliveUnits >= this.unitLimit) return 'limit';
      if (this.dp < card.def.cost) return 'dp';
      return 'ready';
    }

    canPlace(card, x, y) {
      const t = this.map.tile(x, y);
      return !!t && t.deploy === card.def.type && !t.unit;
    }

    deploy(cardIdx, x, y, dir) {
      const card = this.cards[cardIdx];
      if (!card || this.state !== 'playing') return null;
      if (this.cardStatus(card) !== 'ready' || !this.canPlace(card, x, y)) return null;
      this.dp -= card.def.cost;
      const u = new Unit(this, card, x, y, dir);
      card.unit = u;
      this.map.tile(x, y).unit = u;
      this.units.push(u);
      this.emit({ type: 'deploy', x: u.cx, y: u.cy, z: u.elev, unit: u });
      return u;
    }

    retreat(u) {
      if (!u.alive) return;
      const refund = Math.floor(u.def.cost * 0.5);
      this.dp = Math.min(MAX_DP, this.dp + refund);
      this.removeUnit(u);
      this.emit({ type: 'retreat', x: u.cx, y: u.cy, z: u.elev, refund });
    }

    removeUnit(u) {
      u.alive = false;
      for (const e of u.blocked) if (e.blockedBy === u) e.blockedBy = null;
      u.blocked.length = 0;
      u.blockUsed = 0;
      const t = this.map.tile(u.x, u.y);
      if (t.unit === u) t.unit = null;
      u.card.unit = null;
      u.card.cooldown = u.def.redeploy;
    }

    activateSkill(u) {
      if (!u.alive || !u.skillReady) return false;
      const s = u.def.skill;
      if (s.kind === 'nextAttack') return false;
      if (s.kind === 'dp') {
        this.dp = Math.min(MAX_DP, this.dp + s.value);
        u.sp = 0;
      } else if (s.kind === 'buff') {
        u.skillT = s.duration;
      } else if (s.kind === 'stasis') {
        for (const e of this.enemies) {
          if (!e.alive || !u.inRange(e.x, e.y)) continue;
          e.stunT = Math.max(e.stunT, s.stun);
          this.damageEnemy(e, u.atk * s.mult, 'arts', u);
        }
        u.sp = 0;
      }
      this.emit({ type: 'skill', x: u.cx, y: u.cy, z: u.elev, unit: u });
      return true;
    }

    /* ---------- 主循环 ---------- */

    update(dt) {
      if (this.state !== 'playing') return;
      this.time += dt;

      this.dpTimer += dt * this.dpRate;
      while (this.dpTimer >= 1) {
        this.dpTimer -= 1;
        if (this.dp < MAX_DP) this.dp++;
      }

      for (const c of this.cards) if (c.cooldown > 0) c.cooldown = Math.max(0, c.cooldown - dt);

      while (this.spawnIdx < this.spawnList.length && this.spawnList[this.spawnIdx].t <= this.time) {
        const s = this.spawnList[this.spawnIdx++];
        const e = new Enemy(this, s.e, s.r);
        this.enemies.push(e);
        this.emit({ type: 'spawn', x: e.x, y: e.y, enemy: e });
      }

      for (const u of this.units) if (u.alive) this.updateUnit(u, dt);
      for (const e of this.enemies) if (e.alive) this.updateEnemy(e, dt);
      this.updateProjectiles(dt);

      this.units = this.units.filter(u => u.alive);
      this.enemies = this.enemies.filter(e => e.alive);

      if (this.life <= 0) {
        this.life = 0;
        this.state = 'lost';
        this.emit({ type: 'end', win: false });
      } else if (this.spawnIdx >= this.spawnList.length && this.enemies.length === 0) {
        this.state = 'won';
        this.emit({ type: 'end', win: true });
      }
    }

    stars() {
      if (this.state !== 'won') return 0;
      const lost = this.maxLife - this.life;
      if (lost === 0) return 3;
      if (lost <= 3) return 2;
      return 1;
    }

    /* ---------- 干员 ---------- */

    enemyTargets(u) {
      const list = [];
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (e.flying && !u.def.air) continue;
        if (e.blockedBy === u || u.inRange(e.x, e.y)) list.push(e);
      }
      list.sort((a, b) => {
        const ba = a.blockedBy === u ? 1 : 0, bb = b.blockedBy === u ? 1 : 0;
        if (ba !== bb) return bb - ba;
        if (u.def.preferAir && a.flying !== b.flying) return a.flying ? -1 : 1;
        return a.remaining - b.remaining;
      });
      return list;
    }

    healTargets(u) {
      const list = [];
      for (const o of this.units) {
        if (!o.alive || o.hp >= o.maxHp) continue;
        if (u.range.has(o.x + o.y * this.map.cols)) list.push(o);
      }
      list.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
      return list;
    }

    updateUnit(u, dt) {
      const s = u.def.skill;
      if (u.skillT > 0) {
        u.skillT -= dt;
        if (u.skillT <= 0) { u.skillT = 0; u.sp = 0; this.emit({ type: 'skillEnd', unit: u }); }
      } else if (s.charge === 'time' && u.sp < s.sp) {
        u.sp = Math.min(s.sp, u.sp + dt);
      }

      const isHealer = u.def.dmg === 'heal';
      let targets = null;
      if (s.trigger === 'auto' && s.kind !== 'nextAttack' && u.skillReady) {
        targets = isHealer ? this.healTargets(u) : this.enemyTargets(u);
        if (targets.length) this.activateSkill(u);
      }

      u.recalcMods();
      if (u.mods.regen > 0) this.healUnit(u, u.maxHp * u.mods.regen * dt, null, true);

      u.anim.attack = Math.max(0, u.anim.attack - dt * 4);
      u.anim.hurt = Math.max(0, u.anim.hurt - dt * 5);
      u.anim.deploy = Math.max(0, u.anim.deploy - dt * 3);

      u.atkCd -= dt;
      if (u.atkCd > 0) return;
      if (!targets) targets = isHealer ? this.healTargets(u) : this.enemyTargets(u);
      if (!targets.length) { u.atkCd = 0; return; }
      u.atkCd += u.interval;
      if (u.atkCd < 0) u.atkCd = 0;
      u.anim.attack = 1;

      if (isHealer) {
        const n = u.mods.targets || 1;
        for (const t of targets.slice(0, n)) this.fire(u, t, { heal: u.atk });
        return;
      }

      let mult = 1, all = false;
      if (s.kind === 'nextAttack' && u.sp >= s.sp) {
        mult = s.mult; all = true; u.sp = 0;
        this.emit({ type: 'skill', x: u.cx, y: u.cy, z: u.elev, unit: u });
      } else if (s.charge === 'attack' && u.skillT <= 0) {
        u.sp = Math.min(s.sp, u.sp + 1);
      }

      const count = all ? targets.length : (u.def.targets || 1);
      const payload = { amount: u.atk * mult, type: u.def.dmg, splash: u.mods.splash, slow: u.def.slow };
      for (const t of targets.slice(0, count)) {
        if (u.def.ranged) this.fire(u, t, payload);
        else {
          this.damageEnemy(t, payload.amount, payload.type, u);
          this.emit({ type: 'slash', x: t.x, y: t.y, z: t.flying ? 0.5 : 0, big: all, unit: u });
        }
      }
    }

    fire(src, target, payload) {
      const fromUnit = src instanceof Unit;
      const sx = fromUnit ? src.cx : src.x, sy = fromUnit ? src.cy : src.y;
      const sz = fromUnit ? src.elev + 0.28 : (src.flying ? 0.55 : 0.2);
      let kind = 'arrow';
      if (payload.heal) kind = 'heal';
      else if (!fromUnit) kind = 'hex';
      else if (payload.type === 'arts') kind = src.def.slow ? 'bind' : 'orb';
      this.projectiles.push({
        x: sx, y: sy, z: sz, sx, sy, sz, target, payload, src, fromUnit, kind,
        speed: kind === 'arrow' ? 11 : 7, alive: true, t: 0,
      });
    }

    updateProjectiles(dt) {
      for (const p of this.projectiles) {
        if (!p.alive) continue;
        p.t += dt;
        const tg = p.target;
        const tx = tg instanceof Unit ? tg.cx : tg.x;
        const ty = tg instanceof Unit ? tg.cy : tg.y;
        const tz = tg instanceof Unit ? tg.elev + 0.25 : (tg.flying ? 0.55 : 0.2);
        const dx = tx - p.x, dy = ty - p.y;
        const d = Math.hypot(dx, dy);
        const step = p.speed * dt;
        if (!tg.alive) { p.alive = false; continue; }
        if (d <= step || d < 0.05) {
          p.alive = false;
          this.projectileHit(p, tg);
        } else {
          p.x += (dx / d) * step;
          p.y += (dy / d) * step;
          const total = Math.hypot(tx - p.sx, ty - p.sy) || 1;
          const prog = Math.min(1, 1 - (d - step) / total);
          p.z = p.sz + (tz - p.sz) * prog + Math.sin(prog * Math.PI) * (p.kind === 'arrow' ? 0.25 : 0.1);
        }
      }
      this.projectiles = this.projectiles.filter(p => p.alive);
    }

    projectileHit(p, tg) {
      const pl = p.payload;
      if (pl.heal) {
        this.healUnit(tg, pl.heal, p.src);
        return;
      }
      if (!p.fromUnit) {
        this.damageUnit(tg, pl.amount, pl.type, p.src);
        return;
      }
      this.damageEnemy(tg, pl.amount, pl.type, p.src, pl.slow);
      this.emit({ type: 'hit', x: tg.x, y: tg.y, z: tg.flying ? 0.55 : 0.2, kind: p.kind });
      if (pl.splash > 0) {
        for (const e of this.enemies) {
          if (!e.alive || e === tg) continue;
          if (Math.hypot(e.x - tg.x, e.y - tg.y) <= pl.splash) this.damageEnemy(e, pl.amount * 0.8, pl.type, p.src, pl.slow);
        }
        this.emit({ type: 'splash', x: tg.x, y: tg.y, r: pl.splash });
      }
    }

    damageEnemy(e, amount, type, src, slow) {
      if (!e.alive) return;
      const dmg = calcDamage(amount, type, e.def.def, e.def.res);
      e.hp -= dmg;
      e.anim.hurt = 1;
      if (slow) { e.slowT = Math.max(e.slowT, slow.t); e.slowAmt = Math.max(e.slowAmt, slow.amt); }
      this.emit({ type: 'dmg', x: e.x, y: e.y, z: e.flying ? 0.6 : 0.3, amount: dmg, kind: type });
      if (e.hp <= 0) this.killEnemy(e);
    }

    damageUnit(u, amount, type, src) {
      if (!u.alive) return;
      const dmg = calcDamage(amount, type, u.defense, u.res);
      u.hp -= dmg;
      u.anim.hurt = 1;
      this.emit({ type: 'dmg', x: u.cx, y: u.cy, z: u.elev + 0.4, amount: dmg, kind: type, onUnit: true });
      if (u.hp <= 0) {
        u.hp = 0;
        this.removeUnit(u);
        this.emit({ type: 'unitDown', x: u.cx, y: u.cy, z: u.elev, unit: u });
      }
    }

    healUnit(u, amount, src, silent) {
      if (!u.alive) return;
      const before = u.hp;
      u.hp = Math.min(u.maxHp, u.hp + amount);
      if (!silent && u.hp > before) this.emit({ type: 'heal', x: u.cx, y: u.cy, z: u.elev + 0.4, amount: u.hp - before });
    }

    killEnemy(e) {
      e.alive = false;
      e.hp = 0;
      if (e.blockedBy) this.release(e);
      this.killed++;
      this.emit({ type: 'death', x: e.x, y: e.y, z: e.flying ? 0.55 : 0, enemy: e });
    }

    release(e) {
      const u = e.blockedBy;
      e.blockedBy = null;
      if (!u) return;
      const i = u.blocked.indexOf(e);
      if (i >= 0) { u.blocked.splice(i, 1); u.blockUsed -= e.def.weight; }
    }

    /* ---------- 敌人 ---------- */

    updateEnemy(e, dt) {
      const d = e.def;
      e.anim.hurt = Math.max(0, e.anim.hurt - dt * 5);
      e.anim.attack = Math.max(0, e.anim.attack - dt * 3);
      e.anim.spawn = Math.max(0, e.anim.spawn - dt * 2.5);
      e.anim.bob += dt * 3;
      e.atkCd = Math.max(0, e.atkCd - dt);
      if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slowAmt = 0; }
      if (e.blockedBy && !e.blockedBy.alive) this.release(e);
      if (e.stunT > 0) { e.stunT -= dt; return; }
      if (e.pauseT > 0) e.pauseT -= dt;

      if (e.blockedBy) {
        if (e.atkCd <= 0 && d.atk > 0) {
          e.atkCd = d.interval;
          e.anim.attack = 1;
          if (d.range) this.fire(e, e.blockedBy, { amount: d.atk, type: d.dmg });
          else this.damageUnit(e.blockedBy, d.atk, d.dmg, e);
        }
        return;
      }

      // 远程敌人：边走边寻找射程内的干员
      if (d.range && d.atk > 0 && e.atkCd <= 0) {
        let best = null, bd = Infinity;
        for (const u of this.units) {
          if (!u.alive) continue;
          const dist = Math.hypot(u.cx - e.x, u.cy - e.y);
          if (dist <= d.range && dist < bd) { bd = dist; best = u; }
        }
        if (best) {
          e.atkCd = d.interval;
          e.pauseT = 0.6;
          e.anim.attack = 1;
          this.fire(e, best, { amount: d.atk, type: d.dmg });
        }
      }
      if (e.pauseT > 0) return;

      // 沿路线移动
      const pts = e.route.pts;
      let move = d.speed * (e.slowT > 0 ? 1 - e.slowAmt : 1) * dt;
      while (move > 0 && e.seg < pts.length) {
        const [px, py] = pts[e.seg];
        const dx = px - e.x, dy = py - e.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 1e-6) { e.vx = dx / dist; e.vy = dy / dist; }
        if (dist <= move) {
          e.x = px; e.y = py; move -= dist; e.seg++;
        } else {
          e.x += (dx / dist) * move; e.y += (dy / dist) * move; move = 0;
        }
        // 每一小段都检测阻挡，避免高速敌人穿过干员
        if (!e.flying && this.tryBlock(e)) break;
      }
      if (e.seg >= pts.length) {
        this.leak(e);
        return;
      }
      e.remaining = Math.hypot(pts[e.seg][0] - e.x, pts[e.seg][1] - e.y) + e.route.suffix[e.seg];
      if (!e.flying && !e.blockedBy) this.tryBlock(e);
    }

    tryBlock(e) {
      const t = this.map.tile(Math.floor(e.x), Math.floor(e.y));
      const u = t && t.unit;
      if (!u || !u.alive || u.def.block <= 0) return false;
      if (u.blockUsed + e.def.weight > u.def.block) return false;
      e.blockedBy = u;
      u.blocked.push(e);
      u.blockUsed += e.def.weight;
      e.atkCd = Math.max(e.atkCd, e.def.interval * 0.4);
      return true;
    }

    leak(e) {
      e.alive = false;
      this.life -= e.def.leak;
      this.leaked++;
      this.emit({ type: 'leak', x: e.x, y: e.y, enemy: e, amount: e.def.leak });
    }
  }

  TD.Game = Game;
  TD.GameMap = GameMap;
  TD.rotate = rotate;
  TD.DIRS = DIRS;
  TD.calcDamage = calcDamage;
})(typeof window !== 'undefined' ? window : globalThis);
