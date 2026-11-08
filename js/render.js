/* 烬土防线 · 渲染（Canvas 2D，带轻微透视的 2.5D 视角） */
(function (G) {
  'use strict';
  const TD = (G.TD = G.TD || {});
  const { ICONS, CLASSES } = TD.DATA;

  const S_TOP = 0.86; // 顶行相对底行的缩放，模拟镜头俯角
  const TH_RATIO = 0.72; // 格子纵向压缩比
  const HIGH_Z = 0.24;
  const UNIT_LIFT = 0.5; // 干员圆标相对格心的抬升（半径倍数）

  const DMG_COLORS = { phys: '#f3f5f7', arts: '#c9a6ff', true: '#ffd27a', heal: '#5be39a', unit: '#ff7070' };

  const iconCache = {};
  function iconPath(name) {
    if (!iconCache[name]) iconCache[name] = new Path2D(ICONS[name]);
    return iconCache[name];
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  class Renderer {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.bg = document.createElement('canvas');
      this.effects = [];
      this.game = null;
      this.time = 0;
      this.w = 1; this.h = 1; this.dpr = 1;
    }

    setGame(game) {
      this.game = game;
      this.effects = [];
      this.layout();
    }

    resize(w, h, insetTop, insetBottom) {
      this.w = w; this.h = h;
      this.insetTop = insetTop; this.insetBottom = insetBottom;
      this.dpr = Math.min(G.devicePixelRatio || 1, 2);
      this.cv.width = Math.round(w * this.dpr);
      this.cv.height = Math.round(h * this.dpr);
      this.cv.style.width = w + 'px';
      this.cv.style.height = h + 'px';
      this.layout();
    }

    layout() {
      const g = this.game;
      if (!g) return;
      const { cols, rows } = g.map;
      const availW = this.w - 24;
      const availH = Math.max(120, this.h - this.insetTop - this.insetBottom);
      const hUnits = TH_RATIO * (S_TOP * rows + (1 - S_TOP) * rows / 2) + 0.5;
      this.TW = Math.max(18, Math.min(availW / cols, availH / hUnits));
      this.TH = this.TW * TH_RATIO;
      this.cols = cols; this.rows = rows;
      this.cx = this.w / 2;
      const mapH = hUnits * this.TW;
      this.oy = this.insetTop + (availH - mapH) / 2 + 0.42 * this.TW * S_TOP;
      this.renderBackground();
    }

    /* ---------- 投影 ---------- */
    scaleAt(y) { return S_TOP + (1 - S_TOP) * (y / this.rows); }
    Y(y) { return this.TH * (S_TOP * y + (1 - S_TOP) * y * y / (2 * this.rows)); }
    P(x, y, z) {
      const s = this.scaleAt(y);
      return { x: this.cx + (x - this.cols / 2) * this.TW * s, y: this.oy + this.Y(y) - (z || 0) * this.TW * s, s };
    }
    unproject(sx, sy, z) {
      let lo = -3, hi = this.rows + 3;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const v = this.oy + this.Y(mid) - z * this.TW * this.scaleAt(mid);
        if (v < sy) lo = mid; else hi = mid;
      }
      const y = (lo + hi) / 2;
      const x = (sx - this.cx) / (this.TW * this.scaleAt(y)) + this.cols / 2;
      return { x, y };
    }
    tileAtZ(sx, sy, z) {
      const p = this.unproject(sx, sy, z);
      return this.game.map.tile(Math.floor(p.x), Math.floor(p.y));
    }
    // 拾取：先按高台高度判断，命中高台/墙体则取之，否则按地面判断
    pickTile(sx, sy) {
      const hi = this.tileAtZ(sx, sy, HIGH_Z);
      if (hi && hi.elev > 0) return hi;
      return this.tileAtZ(sx, sy, 0);
    }
    pickDeploy(sx, sy, type) {
      const t = type === 'high' ? this.tileAtZ(sx, sy, HIGH_Z) : this.tileAtZ(sx, sy, 0);
      if (t && t.deploy === type) return t;
      // 地面单位：点击位置可能被前方高台遮挡，退而按地面判断
      const t2 = this.tileAtZ(sx, sy, type === 'high' ? 0 : HIGH_Z);
      return t2 && t2.deploy === type ? t2 : null;
    }
    tileCenter(t) { return this.P(t.x + 0.5, t.y + 0.5, t.elev); }

    quad(ctx, x, y, z, inset) {
      const i = inset || 0;
      const a = this.P(x + i, y + i, z), b = this.P(x + 1 - i, y + i, z);
      const c = this.P(x + 1 - i, y + 1 - i, z), d = this.P(x + i, y + 1 - i, z);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
      ctx.closePath();
    }

    /* ---------- 静态背景 ---------- */
    renderBackground() {
      const g = this.game;
      const bg = this.bg;
      bg.width = this.cv.width; bg.height = this.cv.height;
      const ctx = bg.getContext('2d');
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const grad = ctx.createRadialGradient(this.w / 2, this.h * 0.45, 50, this.w / 2, this.h * 0.5, Math.max(this.w, this.h) * 0.75);
      grad.addColorStop(0, '#1a2430');
      grad.addColorStop(1, '#080b10');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.w, this.h);

      // 地图底座阴影
      const { cols, rows } = g.map;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = this.TW * 0.6;
      ctx.shadowOffsetY = this.TW * 0.2;
      const a = this.P(0, 0, 0), b = this.P(cols, 0, 0), c = this.P(cols, rows, 0), d = this.P(0, rows, 0);
      ctx.fillStyle = '#0c1015';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y + this.TW * 0.12); ctx.lineTo(d.x, d.y + this.TW * 0.12); ctx.closePath(); ctx.fill();
      ctx.restore();

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) this.drawTile(ctx, g.map.tiles[y][x]);
      }
    }

    drawTile(ctx, t) {
      const { x, y, elev } = t;
      const lw = Math.max(1, this.TW * 0.018);
      if (elev > 0) {
        // 正面
        const a = this.P(x, y + 1, elev), b = this.P(x + 1, y + 1, elev);
        const c = this.P(x + 1, y + 1, 0), d = this.P(x, y + 1, 0);
        const fg = ctx.createLinearGradient(0, a.y, 0, d.y);
        if (t.kind === 'wall') { fg.addColorStop(0, '#141a20'); fg.addColorStop(1, '#0a0d11'); }
        else { fg.addColorStop(0, '#34414d'); fg.addColorStop(1, '#1e262e'); }
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); ctx.fill();
      }
      // 顶面
      this.quad(ctx, x, y, elev, 0);
      let top;
      switch (t.kind) {
        case 'wall': top = '#1a2128'; break;
        case 'high': top = t.deploy ? '#4d5d6b' : '#3e4b56'; break;
        case 'road': case 'spawn': case 'base': top = '#1f272f'; break;
        default: top = (x + y) % 2 ? '#2b3641' : '#2e3a46';
      }
      ctx.fillStyle = top;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = lw;
      ctx.stroke();

      if (t.kind === 'wall') {
        // 斜纹
        ctx.save();
        this.quad(ctx, x, y, elev, 0.04);
        ctx.clip();
        ctx.strokeStyle = 'rgba(255,255,255,0.035)';
        ctx.lineWidth = lw * 2;
        const p0 = this.P(x, y, elev);
        for (let k = -1; k < 4; k++) {
          ctx.beginPath();
          ctx.moveTo(p0.x + k * this.TW * 0.3, p0.y + this.TH);
          ctx.lineTo(p0.x + k * this.TW * 0.3 + this.TH, p0.y);
          ctx.stroke();
        }
        ctx.restore();
      } else if (t.kind === 'high') {
        // 顶部高光边
        const a = this.P(x, y, elev), b = this.P(x + 1, y, elev);
        ctx.strokeStyle = 'rgba(255,255,255,0.16)';
        ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(a.x, a.y + lw); ctx.lineTo(b.x, b.y + lw); ctx.stroke();
        if (t.deploy) {
          this.quad(ctx, x, y, elev, 0.12);
          ctx.strokeStyle = 'rgba(180,215,235,0.16)';
          ctx.stroke();
        }
      } else if (t.kind === 'ground') {
        this.cornerMarks(ctx, t, 'rgba(150,190,210,0.22)');
      } else if (t.kind === 'road') {
        this.quad(ctx, x, y, 0, 0.08);
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.stroke();
      }
    }

    cornerMarks(ctx, t, color) {
      const i = 0.1, L = 0.16;
      const pts = [
        [[i, i + L], [i, i], [i + L, i]],
        [[1 - i - L, i], [1 - i, i], [1 - i, i + L]],
        [[1 - i, 1 - i - L], [1 - i, 1 - i], [1 - i - L, 1 - i]],
        [[i + L, 1 - i], [i, 1 - i], [i, 1 - i - L]],
      ];
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, this.TW * 0.02);
      for (const seg of pts) {
        ctx.beginPath();
        seg.forEach(([dx, dy], k) => {
          const p = this.P(t.x + dx, t.y + dy, t.elev);
          if (k) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
        });
        ctx.stroke();
      }
    }

    /* ---------- 特效 ---------- */
    consumeEvents(events) {
      for (const ev of events) {
        switch (ev.type) {
          case 'dmg':
            if (ev.amount >= 1) this.addFx({ type: 'num', x: ev.x, y: ev.y, z: ev.z, text: Math.round(ev.amount), color: ev.onUnit ? DMG_COLORS.unit : DMG_COLORS[ev.kind] || '#fff', life: 0.8, jx: (Math.random() - 0.5) * 0.3 });
            break;
          case 'heal':
            if (ev.amount >= 1) this.addFx({ type: 'num', x: ev.x, y: ev.y, z: ev.z, text: '+' + Math.round(ev.amount), color: DMG_COLORS.heal, life: 0.9, jx: (Math.random() - 0.5) * 0.3 });
            break;
          case 'hit': this.addFx({ type: 'ring', x: ev.x, y: ev.y, z: ev.z, r0: 0.05, r1: 0.22, color: ev.kind === 'arrow' ? '#ffe9b0' : '#d8b8ff', life: 0.25 }); break;
          case 'slash': this.addFx({ type: 'slash', x: ev.x, y: ev.y, z: ev.z + 0.3, big: ev.big, color: ev.big ? '#ffcf5a' : '#ffffff', life: ev.big ? 0.35 : 0.2, rot: Math.random() * Math.PI }); break;
          case 'splash': this.addFx({ type: 'ring', x: ev.x, y: ev.y, z: 0.05, r0: 0.2, r1: ev.r, color: '#b98cff', life: 0.35, flat: true }); break;
          case 'death': this.addFx({ type: 'burst', x: ev.x, y: ev.y, z: ev.z + 0.25, color: ev.enemy.def.color, life: 0.55, n: ev.enemy.def.boss ? 22 : 10, seed: Math.random() * 10 }); break;
          case 'deploy': this.addFx({ type: 'pillar', x: ev.x, y: ev.y, z: ev.z, color: CLASSES[ev.unit.def.cls].color, life: 0.5 }); break;
          case 'retreat': this.addFx({ type: 'pillar', x: ev.x, y: ev.y, z: ev.z, color: '#e6edf3', life: 0.45 }); break;
          case 'unitDown': this.addFx({ type: 'burst', x: ev.x, y: ev.y, z: ev.z + 0.3, color: '#8b98a5', life: 0.7, n: 14, seed: Math.random() * 10 }); break;
          case 'skill': {
            const c = CLASSES[ev.unit.def.cls].color;
            this.addFx({ type: 'ring', x: ev.x, y: ev.y, z: ev.z + 0.05, r0: 0.2, r1: 0.9, color: c, life: 0.5, flat: true });
            this.addFx({ type: 'label', x: ev.x, y: ev.y, z: ev.z + 0.9, text: ev.unit.def.skill.name, color: c, life: 1.1 });
            break;
          }
          case 'spawn': this.addFx({ type: 'ring', x: ev.x, y: ev.y, z: 0.02, r0: 0.1, r1: 0.5, color: '#ff5a5a', life: 0.5, flat: true }); break;
          case 'leak': this.addFx({ type: 'ring', x: ev.x, y: ev.y, z: 0.02, r0: 0.2, r1: 0.8, color: '#ff4040', life: 0.6, flat: true }); break;
        }
      }
    }

    addFx(fx) {
      fx.t = 0;
      this.effects.push(fx);
      if (this.effects.length > 400) this.effects.splice(0, this.effects.length - 400);
    }

    tick(dt) {
      this.time += dt;
      for (const fx of this.effects) fx.t += dt;
      this.effects = this.effects.filter(fx => fx.t < fx.life);
    }

    /* ---------- 主绘制 ---------- */
    draw(ui, realTime) {
      const ctx = this.ctx;
      const g = this.game;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.bg, 0, 0);
      if (!g) return;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.realTime = realTime;

      this.drawSpecialTiles(ctx, realTime);
      this.drawRoutes(ctx, g, realTime);
      this.drawOverlays(ctx, g, ui, realTime);

      // 实体：按纵深排序
      const list = [];
      for (const u of g.units) list.push({ y: u.cy + 0.25, u });
      for (const e of g.enemies) list.push({ y: e.y + (e.flying ? 10 : 0), e });
      list.sort((a, b) => a.y - b.y);
      for (const it of list) {
        if (it.u) this.drawUnitShadow(ctx, it.u);
        else this.drawEnemyShadow(ctx, it.e);
      }
      for (const it of list) {
        if (it.u) this.drawUnit(ctx, it.u, ui);
        else this.drawEnemy(ctx, it.e);
      }

      this.drawGhost(ctx, g, ui, realTime);
      for (const p of g.projectiles) this.drawProjectile(ctx, p);
      this.drawEffects(ctx);
      this.drawDirectionPicker(ctx, g, ui, realTime);
    }

    drawSpecialTiles(ctx, rt) {
      const g = this.game;
      for (const s of g.map.spawns) this.drawPortal(ctx, s, '#ff4d4d', rt, false);
      for (const b of g.map.bases) this.drawPortal(ctx, b, '#4da3ff', rt, true);
    }

    drawPortal(ctx, t, color, rt, isBase) {
      const c = this.P(t.x + 0.5, t.y + 0.5, 0.01);
      const R = this.TW * c.s * 0.42;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(1, TH_RATIO);
      const pulse = 0.5 + 0.5 * Math.sin(rt * 3);
      const grd = ctx.createRadialGradient(0, 0, R * 0.1, 0, 0, R);
      grd.addColorStop(0, color + 'aa');
      grd.addColorStop(1, color + '00');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, this.TW * 0.03);
      ctx.globalAlpha = 0.6 + pulse * 0.4;
      ctx.beginPath(); ctx.arc(0, 0, R * (0.62 + pulse * 0.08), 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([R * 0.25, R * 0.18]);
      ctx.lineDashOffset = (isBase ? 1 : -1) * rt * R * 0.8;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.86, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      // 中心图标
      ctx.save();
      const lift = this.TW * c.s * (0.14 + 0.03 * Math.sin(rt * 2));
      ctx.translate(c.x, c.y - lift);
      const k = (this.TW * c.s * 0.32) / 24;
      ctx.scale(k, k);
      ctx.translate(-12, -12);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.shadowColor = color; ctx.shadowBlur = 12;
      ctx.fill(iconPath(isBase ? 'bulwark' : 'enemy'));
      ctx.restore();
    }

    drawRoutes(ctx, g, rt) {
      const show = g.upcomingRoutes(4);
      if (!show.size) return;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const ri of show) {
        const r = g.map.routes[ri];
        const z = r.flying ? 0.5 : 0.02;
        ctx.strokeStyle = r.flying ? 'rgba(255,150,180,0.75)' : 'rgba(255,90,90,0.8)';
        ctx.lineWidth = Math.max(2, this.TW * 0.05);
        ctx.setLineDash([this.TW * 0.12, this.TW * 0.16]);
        ctx.lineDashOffset = -rt * this.TW * 0.9;
        ctx.beginPath();
        const steps = [];
        for (let i = 0; i < r.pts.length - 1; i++) {
          const [x0, y0] = r.pts[i], [x1, y1] = r.pts[i + 1];
          const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 3));
          for (let k = 0; k <= n; k++) steps.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
        }
        steps.forEach(([x, y], k) => {
          const p = this.P(x, y, z);
          if (k) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
        });
        ctx.stroke();
        // 终点箭头
        const last = steps[steps.length - 1], prev = steps[steps.length - 2];
        const pa = this.P(last[0], last[1], z), pb = this.P(prev[0], prev[1], z);
        const ang = Math.atan2(pa.y - pb.y, pa.x - pb.x);
        ctx.setLineDash([]);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        const L = this.TW * 0.18;
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pa.x - Math.cos(ang - 0.5) * L, pa.y - Math.sin(ang - 0.5) * L);
        ctx.lineTo(pa.x - Math.cos(ang + 0.5) * L, pa.y - Math.sin(ang + 0.5) * L);
        ctx.fill();
      }
      ctx.restore();
    }

    fillTile(ctx, t, fill, stroke, inset) {
      this.quad(ctx, t.x, t.y, t.elev + 0.002, inset || 0.03);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1.5, this.TW * 0.03); ctx.stroke(); }
    }

    rangeTiles(def, x, y, dir) {
      const out = [];
      for (const [ox, oy] of def.range) {
        const [rx, ry] = TD.rotate(ox, oy, dir);
        const t = this.game.map.tile(x + rx, y + ry);
        if (t) out.push(t);
      }
      return out;
    }

    drawOverlays(ctx, g, ui, rt) {
      const pulse = 0.5 + 0.5 * Math.sin(rt * 5);
      if ((ui.mode === 'drag' || ui.mode === 'place') && ui.card != null) {
        const card = g.cards[ui.card];
        for (const row of g.map.tiles) for (const t of row) {
          if (!g.canPlace(card, t.x, t.y)) continue;
          const hover = ui.hover && ui.hover.x === t.x && ui.hover.y === t.y;
          this.fillTile(ctx, t, hover ? 'rgba(79,209,197,0.45)' : `rgba(79,209,197,${0.13 + pulse * 0.08})`, hover ? '#7ff0e4' : 'rgba(79,209,197,0.55)');
        }
      }
      if (ui.mode === 'direction' && ui.dirTile) {
        const card = g.cards[ui.card];
        for (const t of this.rangeTiles(card.def, ui.dirTile.x, ui.dirTile.y, ui.dir)) {
          this.fillTile(ctx, t, card.def.dmg === 'heal' ? 'rgba(91,227,154,0.28)' : 'rgba(240,180,41,0.30)', card.def.dmg === 'heal' ? 'rgba(91,227,154,0.8)' : 'rgba(240,180,41,0.85)');
        }
      }
      if (ui.mode === 'selected' && ui.selected && ui.selected.alive) {
        const u = ui.selected;
        for (const [x, y] of u.rangeList) {
          const t = g.map.tile(x, y);
          this.fillTile(ctx, t, u.def.dmg === 'heal' ? 'rgba(91,227,154,0.22)' : 'rgba(240,180,41,0.24)', u.def.dmg === 'heal' ? 'rgba(91,227,154,0.7)' : 'rgba(240,180,41,0.7)');
        }
        this.fillTile(ctx, g.map.tile(u.x, u.y), null, '#ffffff', 0.02);
      }
    }

    /* ---------- 干员 ---------- */
    unitRadius(s) { return this.TW * s * 0.29; }

    drawUnitShadow(ctx, u) {
      const p = this.P(u.cx, u.cy, u.elev);
      const r = this.unitRadius(p.s);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.ellipse(p.x, p.y + r * 0.1, r * 0.95, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
    }

    drawToken(ctx, def, x, y, r, opts) {
      const color = CLASSES[def.cls].color;
      opts = opts || {};
      ctx.save();
      if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
      // 底座
      const grd = ctx.createLinearGradient(x, y - r, x, y + r);
      grd.addColorStop(0, '#26313d');
      grd.addColorStop(1, '#10161c');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = Math.max(2, r * 0.16);
      ctx.strokeStyle = color;
      if (opts.glow) { ctx.shadowColor = color; ctx.shadowBlur = r * 0.8; }
      ctx.stroke();
      ctx.shadowBlur = 0;
      // 图标
      const k = (r * 1.15) / 24;
      ctx.save();
      ctx.translate(x - 12 * k, y - 12 * k);
      ctx.scale(k, k);
      ctx.strokeStyle = '#f3f6f9';
      ctx.fillStyle = color + '55';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const path = iconPath(def.cls);
      ctx.fill(path);
      ctx.stroke(path);
      ctx.restore();
      // 朝向
      if (opts.dir != null) {
        const [dx, dy] = TD.DIRS[opts.dir];
        const ang = Math.atan2(dy * TH_RATIO, dx);
        ctx.fillStyle = color;
        ctx.beginPath();
        const R1 = r * 1.18, R2 = r * 1.5;
        ctx.moveTo(x + Math.cos(ang) * R2, y + Math.sin(ang) * R2);
        ctx.lineTo(x + Math.cos(ang + 0.42) * R1, y + Math.sin(ang + 0.42) * R1);
        ctx.lineTo(x + Math.cos(ang - 0.42) * R1, y + Math.sin(ang - 0.42) * R1);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    bar(ctx, x, y, w, h, frac, color, bgc) {
      ctx.fillStyle = bgc || 'rgba(0,0,0,0.65)';
      ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = color;
      ctx.fillRect(x - w / 2, y, w * clamp(frac, 0, 1), h);
    }

    drawUnit(ctx, u, ui) {
      const drop = u.anim.deploy;
      const p = this.P(u.cx, u.cy, u.elev + drop * drop * 0.9);
      const r = this.unitRadius(p.s);
      const bodyY = p.y - r * UNIT_LIFT;
      const color = CLASSES[u.def.cls].color;
      const s = u.def.skill;
      const active = u.skillT > 0;

      if (active) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, r * 0.1);
        ctx.setLineDash([r * 0.35, r * 0.25]);
        ctx.lineDashOffset = -this.realTime * r * 2;
        ctx.shadowColor = color; ctx.shadowBlur = r * 0.6;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 1.25, r * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }

      const atkScale = 1 + u.anim.attack * 0.08;
      this.drawToken(ctx, u.def, p.x, bodyY, r * atkScale, { dir: u.dir, glow: active });
      if (u.anim.hurt > 0) {
        ctx.fillStyle = `rgba(255,70,70,${u.anim.hurt * 0.45})`;
        ctx.beginPath(); ctx.arc(p.x, bodyY, r, 0, Math.PI * 2); ctx.fill();
      }

      // 生命 / 技能条
      const bw = r * 2.1, bh = Math.max(3, r * 0.17);
      const by = bodyY + r * 1.2;
      this.bar(ctx, p.x, by, bw, bh, u.hp / u.maxHp, u.hp / u.maxHp > 0.35 ? '#5ed17f' : '#ff6b5b');
      let spFrac, spColor;
      if (active) { spFrac = u.skillT / s.duration; spColor = '#f0b429'; }
      else { spFrac = u.sp / s.sp; spColor = u.skillReady ? '#f0b429' : '#7fb2ff'; }
      this.bar(ctx, p.x, by + bh + 2, bw, Math.max(2, bh * 0.7), spFrac, spColor);

      // 技能就绪提示（手动技能）
      if (u.skillReady && s.trigger === 'manual') {
        const bob = Math.sin(this.realTime * 5) * r * 0.12;
        const ix = p.x + r * 0.95, iy = bodyY - r * 1.05 + bob;
        ctx.save();
        ctx.fillStyle = '#f0b429';
        ctx.shadowColor = '#f0b429'; ctx.shadowBlur = r * 0.7;
        ctx.beginPath();
        const q = r * 0.42;
        ctx.moveTo(ix, iy - q); ctx.lineTo(ix + q * 0.8, iy); ctx.lineTo(ix, iy + q); ctx.lineTo(ix - q * 0.8, iy);
        ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#1b1300';
        ctx.font = `bold ${Math.round(q * 1.1)}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('!', ix, iy + q * 0.05);
        ctx.restore();
      }

      if (ui.mode === 'selected' && ui.selected === u) {
        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, bodyY, r * 1.12, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }

    drawGhost(ctx, g, ui) {
      if (ui.mode === 'drag' && ui.card != null && ui.pointer) {
        const def = g.cards[ui.card].def;
        let x = ui.pointer.x, y = ui.pointer.y, s = 1;
        if (ui.hover) {
          const c = this.tileCenter(ui.hover);
          x = c.x; s = c.s;
          y = c.y - this.unitRadius(s) * UNIT_LIFT;
        } else {
          y -= this.TW * 0.35;
        }
        this.drawToken(ctx, def, x, y, this.unitRadius(s), { alpha: 0.75 });
      }
    }

    drawDirectionPicker(ctx, g, ui, rt) {
      if (ui.mode !== 'direction' || !ui.dirTile) return;
      const def = g.cards[ui.card].def;
      const c = this.tileCenter(ui.dirTile);
      const r = this.unitRadius(c.s);
      const bodyY = c.y - r * UNIT_LIFT;
      // 选择圈
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(1, TH_RATIO);
      const R = this.TW * c.s * 1.05;
      ctx.fillStyle = 'rgba(10,14,20,0.35)';
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
      for (let d = 0; d < 4; d++) {
        const [dx, dy] = TD.DIRS[d];
        const ang = Math.atan2(dy, dx);
        const on = d === ui.dir;
        ctx.fillStyle = on ? '#f0b429' : 'rgba(255,255,255,0.45)';
        const a1 = R * 0.78, a2 = R * 1.08;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * a2, Math.sin(ang) * a2);
        ctx.lineTo(Math.cos(ang + 0.28) * a1, Math.sin(ang + 0.28) * a1);
        ctx.lineTo(Math.cos(ang - 0.28) * a1, Math.sin(ang - 0.28) * a1);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      this.drawToken(ctx, def, c.x, bodyY, r * (1 + 0.04 * Math.sin(rt * 6)), { dir: ui.dir, alpha: 0.95, glow: true });
    }

    /* ---------- 敌人 ---------- */
    enemyZ(e) { return e.flying ? 0.62 + Math.sin(e.anim.bob) * 0.05 : 0; }

    // 同一干员阻挡的多名敌人横向错开，避免完全重叠（仅影响显示）
    enemyPos(e) {
      let x = e.x, y = e.y;
      const u = e.blockedBy;
      if (u && u.blocked.length > 1) {
        const i = u.blocked.indexOf(e), n = u.blocked.length;
        const off = (i - (n - 1) / 2) * 0.26;
        x += -e.vy * off; y += e.vx * off;
      }
      return { x, y };
    }

    drawEnemyShadow(ctx, e) {
      const q = this.enemyPos(e);
      const p = this.P(q.x, q.y, 0);
      const r = e.def.size * this.TW * p.s;
      ctx.fillStyle = e.flying ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.ellipse(p.x, p.y + r * 0.1, r * 0.95, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    }

    drawEnemy(ctx, e) {
      const d = e.def;
      const q = this.enemyPos(e);
      const p = this.P(q.x, q.y, this.enemyZ(e));
      const sc = 1 - e.anim.spawn * 0.6;
      const r = d.size * this.TW * p.s * sc;
      const cy = p.y - r * 0.6 - (e.anim.attack > 0 ? Math.sin(e.anim.attack * Math.PI) * r * 0.15 : 0);
      const ang = Math.atan2(e.vy * TH_RATIO, e.vx);
      ctx.save();
      ctx.globalAlpha = 1 - e.anim.spawn * 0.7;
      ctx.translate(p.x, cy);
      this.enemyShape(ctx, e, r, ang);
      if (e.anim.hurt > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = e.anim.hurt * 0.5;
        this.enemyShape(ctx, e, r, ang, '#ffffff');
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();

      ctx.globalAlpha = 1;
      if (e.slowT > 0) {
        ctx.strokeStyle = 'rgba(219,97,162,0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 1.05, r * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
      }
      if (e.stunT > 0) {
        ctx.fillStyle = '#ffd34d';
        for (let i = 0; i < 3; i++) {
          const a = this.realTime * 4 + (i * Math.PI * 2) / 3;
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(a) * r * 0.8, cy - r * 1.1 + Math.sin(a) * r * 0.25, Math.max(1.5, r * 0.12), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (e.hp < e.maxHp || d.boss) {
        const bw = Math.max(r * 2, this.TW * 0.4), bh = Math.max(3, this.TW * 0.045);
        this.bar(ctx, p.x, cy - r * 1.35 - bh, bw, bh, e.hp / e.maxHp, d.boss ? '#ff9f43' : '#ff5a4f');
      }
    }

    enemyShape(ctx, e, r, ang, override) {
      const d = e.def;
      const col = override || d.color;
      const dark = override || '#2a0d10';
      ctx.lineJoin = 'round';
      switch (d.shape) {
        case 'drifter': {
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.9, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.9, 0); ctx.closePath(); ctx.fill();
          ctx.fillStyle = dark;
          ctx.beginPath(); ctx.moveTo(0, -r * 0.5); ctx.lineTo(r * 0.45, 0); ctx.lineTo(0, r * 0.5); ctx.lineTo(-r * 0.45, 0); ctx.closePath(); ctx.fill();
          this.eye(ctx, r, ang, override);
          break;
        }
        case 'carapace': {
          ctx.fillStyle = col;
          this.poly(ctx, 6, r, Math.PI / 6); ctx.fill();
          ctx.strokeStyle = override || '#d9c3b8';
          ctx.lineWidth = Math.max(2, r * 0.18);
          this.poly(ctx, 6, r * 0.82, Math.PI / 6); ctx.stroke();
          ctx.fillStyle = dark;
          this.poly(ctx, 6, r * 0.42, Math.PI / 6); ctx.fill();
          this.eye(ctx, r * 0.9, ang, override);
          break;
        }
        case 'runner': {
          ctx.save();
          ctx.rotate(ang);
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.moveTo(r * 1.1, 0); ctx.lineTo(-r * 0.7, -r * 0.85); ctx.lineTo(-r * 0.3, 0); ctx.lineTo(-r * 0.7, r * 0.85); ctx.closePath(); ctx.fill();
          ctx.restore();
          this.eye(ctx, r * 0.6, ang, override);
          break;
        }
        case 'hexer': {
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.moveTo(0, -r * 1.05); ctx.lineTo(r * 0.85, r * 0.9); ctx.lineTo(-r * 0.85, r * 0.9); ctx.closePath(); ctx.fill();
          ctx.fillStyle = dark;
          ctx.beginPath(); ctx.arc(0, r * 0.15, r * 0.35, 0, Math.PI * 2); ctx.fill();
          const ob = Math.sin(this.realTime * 4 + e.uid) * r * 0.15;
          ctx.fillStyle = override || '#e6b3ff';
          ctx.shadowColor = '#c77dff'; ctx.shadowBlur = override ? 0 : r;
          ctx.beginPath(); ctx.arc(r * 0.9, -r * 0.9 + ob, r * 0.24, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          this.eye(ctx, r * 0.5, ang, override, r * 0.15);
          break;
        }
        case 'wisp': {
          const flap = Math.sin(this.realTime * 12 + e.uid) * 0.35;
          ctx.fillStyle = override || 'rgba(255,190,205,0.55)';
          ctx.save(); ctx.rotate(-0.5 - flap); ctx.beginPath(); ctx.ellipse(-r * 0.9, 0, r * 0.75, r * 0.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
          ctx.save(); ctx.rotate(0.5 + flap); ctx.beginPath(); ctx.ellipse(r * 0.9, 0, r * 0.75, r * 0.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
          ctx.fillStyle = col;
          ctx.shadowColor = d.color; ctx.shadowBlur = override ? 0 : r * 0.8;
          ctx.beginPath(); ctx.ellipse(0, 0, r * 0.55, r * 0.75, 0, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          this.eye(ctx, r * 0.5, ang, override);
          break;
        }
        case 'colossus': {
          ctx.fillStyle = col;
          this.poly(ctx, 8, r, Math.PI / 8); ctx.fill();
          ctx.strokeStyle = override || '#e3b341';
          ctx.lineWidth = Math.max(2, r * 0.1);
          this.poly(ctx, 8, r * 0.86, Math.PI / 8); ctx.stroke();
          // 冠刺
          ctx.fillStyle = override || '#e3b341';
          for (let i = -1; i <= 1; i++) {
            ctx.beginPath();
            ctx.moveTo(i * r * 0.42 - r * 0.14, -r * 0.82);
            ctx.lineTo(i * r * 0.42, -r * (1.25 + (i === 0 ? 0.2 : 0)));
            ctx.lineTo(i * r * 0.42 + r * 0.14, -r * 0.82);
            ctx.fill();
          }
          ctx.fillStyle = dark;
          this.poly(ctx, 8, r * 0.48, Math.PI / 8); ctx.fill();
          this.eye(ctx, r * 0.8, ang, override);
          break;
        }
      }
    }

    poly(ctx, n, r, rot) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = rot + (i * Math.PI * 2) / n;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
    }

    eye(ctx, r, ang, override, oy) {
      ctx.fillStyle = override || '#ffd0c4';
      ctx.beginPath();
      ctx.arc(Math.cos(ang) * r * 0.32, (oy || 0) + Math.sin(ang) * r * 0.32, Math.max(1.2, r * 0.14), 0, Math.PI * 2);
      ctx.fill();
    }

    /* ---------- 弹道与特效 ---------- */
    drawProjectile(ctx, p) {
      const a = this.P(p.x, p.y, p.z);
      const s = a.s;
      ctx.save();
      if (p.kind === 'arrow') {
        const dx = p.x - p.sx, dy = p.y - p.sy;
        const d = Math.hypot(dx, dy) || 1;
        const b = this.P(p.x - (dx / d) * 0.28, p.y - (dy / d) * 0.28, p.z);
        ctx.strokeStyle = '#ffe9b0';
        ctx.lineWidth = Math.max(1.5, this.TW * s * 0.035);
        ctx.lineCap = 'round';
        ctx.shadowColor = '#ffd36b'; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(a.x, a.y); ctx.stroke();
      } else {
        const colors = { orb: '#b98cff', bind: '#ff8fcf', heal: '#5be39a', hex: '#c060ff' };
        const c = colors[p.kind] || '#fff';
        const r = this.TW * s * (p.kind === 'heal' ? 0.07 : 0.085);
        ctx.fillStyle = c;
        ctx.shadowColor = c; ctx.shadowBlur = r * 2.5;
        ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(a.x, a.y, r * 0.45, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    drawEffects(ctx) {
      for (const fx of this.effects) {
        const k = fx.t / fx.life;
        ctx.save();
        switch (fx.type) {
          case 'num': {
            const p = this.P(fx.x + fx.jx, fx.y, fx.z + k * 0.45);
            ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
            const size = Math.round(this.TW * p.s * 0.2 * (k < 0.15 ? 1 + (0.15 - k) * 3 : 1));
            ctx.font = `800 ${size}px system-ui, -apple-system, "PingFang SC", sans-serif`;
            ctx.textAlign = 'center';
            ctx.lineWidth = Math.max(2, size * 0.18);
            ctx.strokeStyle = 'rgba(0,0,0,0.75)';
            ctx.strokeText(fx.text, p.x, p.y);
            ctx.fillStyle = fx.color;
            ctx.fillText(fx.text, p.x, p.y);
            break;
          }
          case 'label': {
            const p = this.P(fx.x, fx.y, fx.z + k * 0.3);
            ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
            const size = Math.round(this.TW * p.s * 0.22);
            ctx.font = `800 ${size}px system-ui, -apple-system, "PingFang SC", sans-serif`;
            ctx.textAlign = 'center';
            ctx.lineWidth = Math.max(3, size * 0.22);
            ctx.strokeStyle = 'rgba(0,0,0,0.8)';
            ctx.strokeText(fx.text, p.x, p.y);
            ctx.fillStyle = fx.color;
            ctx.fillText(fx.text, p.x, p.y);
            break;
          }
          case 'ring': {
            const p = this.P(fx.x, fx.y, fx.z);
            const r = this.TW * p.s * (fx.r0 + (fx.r1 - fx.r0) * k);
            ctx.globalAlpha = 1 - k;
            ctx.strokeStyle = fx.color;
            ctx.lineWidth = Math.max(1.5, this.TW * p.s * 0.05 * (1 - k));
            ctx.beginPath();
            if (fx.flat) ctx.ellipse(p.x, p.y, r, r * TH_RATIO, 0, 0, Math.PI * 2);
            else ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.stroke();
            break;
          }
          case 'slash': {
            const p = this.P(fx.x, fx.y, fx.z);
            const r = this.TW * p.s * (fx.big ? 0.55 : 0.32);
            ctx.globalAlpha = 1 - k;
            ctx.strokeStyle = fx.color;
            ctx.lineWidth = Math.max(2, this.TW * p.s * (fx.big ? 0.07 : 0.045));
            ctx.lineCap = 'round';
            ctx.shadowColor = fx.color; ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, fx.rot - 0.9 + k * 0.6, fx.rot + 0.9 + k * 0.6);
            ctx.stroke();
            break;
          }
          case 'burst': {
            const p = this.P(fx.x, fx.y, fx.z);
            ctx.globalAlpha = 1 - k;
            ctx.fillStyle = fx.color;
            const R = this.TW * p.s * (0.1 + k * 0.55);
            for (let i = 0; i < fx.n; i++) {
              const a = fx.seed + (i * Math.PI * 2) / fx.n;
              const rr = R * (0.7 + 0.3 * Math.sin(i * 7.3 + fx.seed));
              const sz = this.TW * p.s * 0.05 * (1 - k * 0.6);
              ctx.fillRect(p.x + Math.cos(a) * rr - sz / 2, p.y + Math.sin(a) * rr * 0.8 - sz / 2 - k * this.TW * 0.1, sz, sz);
            }
            break;
          }
          case 'pillar': {
            const p = this.P(fx.x, fx.y, fx.z);
            const w = this.TW * p.s * 0.5 * (1 - k * 0.5);
            const h = this.TW * p.s * 1.6;
            const grd = ctx.createLinearGradient(0, p.y - h, 0, p.y);
            grd.addColorStop(0, fx.color + '00');
            grd.addColorStop(1, fx.color + 'aa');
            ctx.globalAlpha = 1 - k;
            ctx.fillStyle = grd;
            ctx.fillRect(p.x - w / 2, p.y - h, w, h);
            ctx.strokeStyle = fx.color;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.ellipse(p.x, p.y, w * 1.2 + k * w, (w * 1.2 + k * w) * TH_RATIO, 0, 0, Math.PI * 2); ctx.stroke();
            break;
          }
        }
        ctx.restore();
      }
    }

    // 世界坐标 → 屏幕坐标（供 DOM 浮层定位）
    screenOfUnit(u) {
      const p = this.P(u.cx, u.cy, u.elev);
      const r = this.unitRadius(p.s);
      return { x: p.x, y: p.y - r * UNIT_LIFT, r, s: p.s };
    }
  }

  TD.Renderer = Renderer;
  TD.HIGH_Z = HIGH_Z;
})(typeof window !== 'undefined' ? window : globalThis);
