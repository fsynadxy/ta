/* 烬土防线 · 界面、输入与主循环 */
(function () {
  'use strict';
  const TD = window.TD;
  const { ICONS, CLASSES, ENEMIES, LEVELS } = TD.DATA;
  const $ = s => document.querySelector(s);

  const STAR_PATH = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z';
  const SLOW_SCALE = 0.2;
  const REASONS = { dp: '部署点数不足', cooldown: '再部署冷却中', limit: '已达到部署上限', deployed: '该干员已在场' };

  /* ---------- 存档 ---------- */
  const Store = {
    key: 'emberline.v1',
    data: { stars: {}, muted: false, speed: 1 },
    load() {
      try {
        const raw = localStorage.getItem(this.key);
        if (raw) Object.assign(this.data, JSON.parse(raw));
      } catch (e) { /* 隐私模式等情况下忽略 */ }
      if (!this.data.stars || typeof this.data.stars !== 'object') this.data.stars = {};
    },
    save() {
      try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) { /* 忽略 */ }
    },
  };

  /* ---------- 音效（WebAudio 合成，无外部资源） ---------- */
  const Sfx = {
    ctx: null,
    last: {},
    ensure() {
      if (this.ctx || Store.data.muted) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      } catch (e) { this.ctx = null; }
    },
    tone(freq, dur, type, vol, slide, delay) {
      const c = this.ctx;
      if (!c || Store.data.muted) return;
      if (c.state === 'suspended') c.resume();
      const t = c.currentTime + (delay || 0);
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(vol || 0.06, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    },
    play(name) {
      if (Store.data.muted) return;
      this.ensure();
      const now = performance.now();
      if (this.last[name] && now - this.last[name] < 70) return;
      this.last[name] = now;
      switch (name) {
        case 'deploy': this.tone(520, 0.14, 'triangle', 0.08, 900); break;
        case 'retreat': this.tone(620, 0.16, 'triangle', 0.06, 300); break;
        case 'skill': this.tone(440, 0.28, 'sawtooth', 0.04, 1320); break;
        case 'leak': this.tone(180, 0.35, 'square', 0.06, 90); break;
        case 'down': this.tone(320, 0.35, 'sine', 0.08, 110); break;
        case 'kill': this.tone(760, 0.07, 'sine', 0.025, 420); break;
        case 'click': this.tone(900, 0.04, 'square', 0.025); break;
        case 'deny': this.tone(200, 0.12, 'square', 0.035); break;
        case 'warn': this.tone(260, 0.18, 'square', 0.045); this.tone(260, 0.18, 'square', 0.045, null, 0.26); break;
        case 'win': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.07, null, i * 0.11)); break;
        case 'lose': [392, 330, 262].forEach((f, i) => this.tone(f, 0.4, 'sine', 0.08, null, i * 0.16)); break;
      }
    },
  };

  /* ---------- 工具 ---------- */
  function svg(name, cls, color) {
    return `<svg viewBox="0 0 24 24" class="${cls || ''}"${color ? ` style="fill:${color}"` : ''}><path d="${ICONS[name]}"/></svg>`;
  }
  function starsHtml(n, cls) {
    let s = '';
    for (let i = 0; i < 3; i++) s += `<svg viewBox="0 0 24 24" class="star ${i < n ? 'on' : ''} ${cls || ''}"><path d="${STAR_PATH}"/></svg>`;
    return s;
  }
  function enemyCount(lv) { return lv.waves.reduce((a, w) => a + (w.n || 1), 0); }
  function fmtTime(t) {
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  function show(el, on) { el.classList.toggle('hidden', !on); }

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
  }

  function banner(main, sub, warn) {
    const el = $('#banner');
    el.innerHTML = `<span class="b-main">${main}</span>${sub ? `<span class="b-sub">${sub}</span>` : ''}`;
    el.classList.toggle('warn', !!warn);
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  /* ---------- 状态 ---------- */
  const canvas = $('#stage');
  const renderer = new TD.Renderer(canvas);
  let game = null;
  let levelIdx = 0;
  let paused = false;
  let speed = 1;
  let endTimer = -1;
  let bossWarned = new Set();
  let cardEls = [];
  let realTime = 0;
  const hudCache = {};

  const ui = {
    mode: 'idle', // idle | drag | place | direction | selected
    card: null,
    hover: null,
    pointer: null,
    startPt: null,
    dragMoved: false,
    dirTile: null,
    dir: 0,
    dirDrag: false,
    selected: null,
  };

  function isSlow() { return ui.mode !== 'idle'; }

  function setMode(mode) {
    ui.mode = mode;
    if (mode === 'idle') {
      ui.card = null; ui.hover = null; ui.dirTile = null; ui.selected = null; ui.dirDrag = false;
    }
    const hint = $('#dir-hint');
    show(hint, mode === 'direction' || mode === 'place');
    hint.querySelector('span').textContent = mode === 'place' ? '点击发光的格子进行部署' : '拖动或点击方向箭头来确定朝向';
    show($('#unit-panel'), mode === 'selected');
    show($('#radial'), mode === 'selected');
    $('#slowmo').classList.toggle('on', mode !== 'idle');
    cardEls.forEach((c, i) => c.el.classList.toggle('selected', (mode === 'drag' || mode === 'place' || mode === 'direction') && ui.card === i));
  }

  function cancel() { setMode('idle'); }

  /* ---------- 菜单 ---------- */
  function isUnlocked(i) { return i === 0 || (Store.data.stars[LEVELS[i - 1].id] || 0) > 0; }

  function renderMenu() {
    const list = $('#level-list');
    list.innerHTML = '';
    LEVELS.forEach((lv, i) => {
      const unlocked = isUnlocked(i);
      const btn = document.createElement('button');
      btn.className = 'level';
      btn.disabled = !unlocked;
      btn.innerHTML = `
        <span class="lv-code">${lv.code}</span>
        <span class="lv-name">${lv.name}<small>${lv.en.toUpperCase()}</small></span>
        <p class="lv-brief">${lv.brief}</p>
        <span class="lv-meta"><span>敌人 ${enemyCount(lv)} · 生命 ${lv.life} · 上限 ${lv.unitLimit}</span><span class="lv-stars">${starsHtml(Store.data.stars[lv.id] || 0)}</span></span>
        ${unlocked ? '' : '<span class="lv-lock">通关上一关后解锁</span>'}`;
      btn.addEventListener('click', () => { Sfx.ensure(); Sfx.play('click'); startLevel(i); });
      list.appendChild(btn);
    });
  }

  function renderHelp() {
    const byCls = {};
    for (const id of TD.SQUAD) {
      const u = TD.DATA.UNITS[id];
      (byCls[u.cls] = byCls[u.cls] || []).push(u.name);
    }
    $('#help-classes').innerHTML = Object.entries(CLASSES).map(([k, c]) => `
      <div class="help-item" style="--c:${c.color}">
        <div class="hi-icon">${svg(k)}</div>
        <div><b>${c.name} <small class="hi-units">${(byCls[k] || []).join('、')}</small></b><span>${c.desc}</span></div>
      </div>`).join('');
    $('#help-enemies').innerHTML = Object.values(ENEMIES).map(e => `
      <div class="help-item" style="--c:${e.color}">
        <div class="hi-icon">${svg('enemy', '', e.color)}</div>
        <div><b>${e.name}${e.flying ? ' · 飞行' : ''}${e.boss ? ' · 首领' : ''}</b>
        <span>${e.desc}<br>生命 ${e.hp} / 攻击 ${e.atk} / 防御 ${e.def} / 法抗 ${e.res}</span></div>
      </div>`).join('');
  }

  function showMenu() {
    game = null;
    renderer.game = null;
    paused = false;
    setMode('idle');
    renderMenu();
    show($('#menu'), true);
    show($('#hud'), false);
    show($('#pause'), false);
    show($('#result'), false);
  }

  /* ---------- 开始一关 ---------- */
  function startLevel(i) {
    levelIdx = i;
    const lv = LEVELS[i];
    game = new TD.Game(lv, TD.DATA);
    paused = false;
    endTimer = -1;
    bossWarned = new Set();
    for (const k in hudCache) delete hudCache[k];
    show($('#menu'), false);
    show($('#pause'), false);
    show($('#result'), false);
    show($('#hud'), true);
    $('#level-tag').textContent = `${lv.code} · ${lv.name}`;
    buildCards();
    setMode('idle');
    renderer.setGame(game);
    onResize();
    banner('作战开始', `${lv.code} ${lv.name}`);
  }

  function buildCards() {
    const wrap = $('#cards');
    wrap.innerHTML = '';
    cardEls = game.cards.map((c, i) => {
      const def = c.def, cls = CLASSES[def.cls];
      const el = document.createElement('div');
      el.className = 'card';
      el.style.setProperty('--c', cls.color);
      el.title = `${def.name}（${cls.name}）· ${def.type === 'high' ? '高台' : '地面'}\n${def.skill.name}：${def.skill.desc}`;
      el.innerHTML = `
        <span class="card-cost">${def.cost}</span>
        <span class="card-type">${def.type === 'high' ? '高台' : '地面'}</span>
        ${svg(def.cls, 'card-icon')}
        <span class="card-name">${def.name}</span>
        <span class="card-cls">${cls.name}</span>
        <span class="card-cd"><span></span></span>`;
      el.addEventListener('pointerdown', ev => onCardDown(ev, i));
      wrap.appendChild(el);
      return { el, cd: el.querySelector('.card-cd span'), state: '', cdText: '' };
    });
  }

  /* ---------- 输入 ---------- */
  function overCards(x, y) {
    const r = $('#cards').getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top - 6 && y <= r.bottom;
  }

  function updateHover() {
    if (ui.card == null || !ui.pointer) { ui.hover = null; return; }
    const card = game.cards[ui.card];
    if (overCards(ui.pointer.x, ui.pointer.y)) { ui.hover = null; return; }
    const t = renderer.pickDeploy(ui.pointer.x, ui.pointer.y, card.def.type);
    ui.hover = t && game.canPlace(card, t.x, t.y) ? t : null;
  }

  function onCardDown(ev, i) {
    ev.preventDefault();
    ev.stopPropagation();
    if (!game || game.state !== 'playing' || paused) return;
    Sfx.ensure();
    if (ui.mode === 'place' && ui.card === i) { cancel(); return; }
    const card = game.cards[i];
    const st = game.cardStatus(card);
    if (st !== 'ready') { toast(REASONS[st] || '暂时无法部署'); Sfx.play('deny'); return; }
    if (ui.mode !== 'idle') setMode('idle');
    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch (e) { /* 部分浏览器不支持 */ }
    ui.card = i;
    ui.startPt = { x: ev.clientX, y: ev.clientY };
    ui.pointer = { x: ev.clientX, y: ev.clientY };
    ui.dragMoved = false;
    ui.hover = null;
    setMode('drag');
  }

  function dirThreshold() {
    const c = renderer.tileCenter(ui.dirTile);
    return Math.max(14, renderer.TW * c.s * 0.32);
  }

  function dirOffset(x, y) {
    const c = renderer.tileCenter(ui.dirTile);
    return { dx: x - c.x, dy: (y - c.y) / 0.72 };
  }

  function updateDir(x, y) {
    const { dx, dy } = dirOffset(x, y);
    if (Math.hypot(dx, dy) < dirThreshold()) return false;
    ui.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
    return true;
  }

  // 默认朝向：面向最近的敌方入口
  function defaultDir(t) {
    let best = null, bd = Infinity;
    for (const s of game.map.spawns) {
      const d = Math.abs(s.x - t.x) + Math.abs(s.y - t.y);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) return 0;
    const dx = best.x - t.x, dy = best.y - t.y;
    return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 2) : (dy >= 0 ? 1 : 3);
  }

  function enterDirection(t) {
    ui.dirTile = t;
    ui.dir = defaultDir(t);
    ui.dirDrag = false;
    ui.hover = null;
    setMode('direction');
  }

  function confirmDeploy() {
    const t = ui.dirTile;
    const u = game.deploy(ui.card, t.x, t.y, ui.dir);
    if (u) Sfx.play('deploy');
    else { toast('无法在此部署'); Sfx.play('deny'); }
    setMode('idle');
  }

  function selectUnit(u) {
    ui.selected = u;
    setMode('selected');
    buildUnitPanel(u);
    Sfx.play('click');
  }

  window.addEventListener('pointermove', ev => {
    if (!game) return;
    ui.pointer = { x: ev.clientX, y: ev.clientY };
    if (ui.mode === 'drag') {
      if (!ui.dragMoved && Math.hypot(ev.clientX - ui.startPt.x, ev.clientY - ui.startPt.y) > 8) ui.dragMoved = true;
      updateHover();
    } else if (ui.mode === 'place') {
      updateHover();
    } else if (ui.mode === 'direction' && (ui.dirDrag || ev.pointerType === 'mouse')) {
      updateDir(ev.clientX, ev.clientY);
    }
  });

  function onPointerUp(ev, cancelled) {
    if (!game) return;
    if (ui.mode === 'drag') {
      ui.pointer = { x: ev.clientX, y: ev.clientY };
      updateHover();
      if (!cancelled && ui.hover) enterDirection(ui.hover);
      else if (!cancelled && !ui.dragMoved) setMode('place');
      else cancel();
    } else if (ui.mode === 'direction' && ui.dirDrag) {
      ui.dirDrag = false;
      if (!cancelled && updateDir(ev.clientX, ev.clientY)) confirmDeploy();
    }
  }
  window.addEventListener('pointerup', ev => onPointerUp(ev, false));
  window.addEventListener('pointercancel', ev => onPointerUp(ev, true));

  canvas.addEventListener('contextmenu', ev => ev.preventDefault());
  canvas.addEventListener('pointerdown', ev => {
    if (!game || game.state !== 'playing' || paused) return;
    Sfx.ensure();
    if (ev.button === 2) { cancel(); return; }
    const x = ev.clientX, y = ev.clientY;
    ui.pointer = { x, y };
    switch (ui.mode) {
      case 'place': {
        updateHover();
        if (ui.hover) enterDirection(ui.hover);
        else cancel();
        break;
      }
      case 'direction':
        ui.dirDrag = true;
        updateDir(x, y);
        break;
      case 'idle':
      case 'selected': {
        const t = renderer.pickTile(x, y);
        if (t && t.unit && t.unit !== ui.selected) selectUnit(t.unit);
        else cancel();
        break;
      }
    }
  });

  window.addEventListener('keydown', ev => {
    if (!game) return;
    const k = ev.key;
    if (k === ' ' || k === 'Spacebar') {
      ev.preventDefault();
      if (game.state === 'playing') togglePause();
      return;
    }
    if (paused || game.state !== 'playing') return;
    if (k === 'f' || k === 'F') toggleSpeed();
    else if (k === 'Escape') { if (ui.mode !== 'idle') cancel(); else togglePause(); }
    else if (ui.mode === 'direction') {
      const map = { ArrowRight: 0, ArrowDown: 1, ArrowLeft: 2, ArrowUp: 3, d: 0, s: 1, a: 2, w: 3 };
      if (k in map) { ui.dir = map[k]; ev.preventDefault(); }
      else if (k === 'Enter') confirmDeploy();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game && game.state === 'playing' && !paused) togglePause();
  });

  /* ---------- 干员面板 ---------- */
  function buildUnitPanel(u) {
    const d = u.def, cls = CLASSES[d.cls], sk = d.skill;
    const panel = $('#unit-panel');
    panel.style.setProperty('--c', cls.color);
    panel.innerHTML = `
      <div class="up-head">
        <div class="up-icon">${svg(d.cls)}</div>
        <div>
          <div class="up-name">${d.name}<small>${d.en}</small></div>
          <div class="up-cls">${cls.name} · ${d.type === 'high' ? '高台' : '地面'}</div>
        </div>
      </div>
      <div class="up-hp">
        <div class="up-hp-text"><span>生命</span><span data-k="hp"></span></div>
        <div class="up-hp-bar"><i data-k="hpbar"></i></div>
      </div>
      <div class="up-stats">
        <div><span>${d.dmg === 'heal' ? '治疗' : '攻击'}</span><b data-k="atk"></b></div>
        <div><span>防御</span><b data-k="def"></b></div>
        <div><span>法抗</span><b>${d.res}</b></div>
        <div><span>阻挡</span><b data-k="block"></b></div>
      </div>
      <div class="up-skill"><b>${sk.name}</b> <small>${sk.trigger === 'auto' ? '自动触发' : '手动发动'}</small><p>${sk.desc}</p></div>`;
    $('#skill-name').textContent = sk.name;
    $('#retreat-refund').textContent = '+' + Math.floor(d.cost * 0.5);
    const btn = $('#btn-skill');
    btn.classList.toggle('auto', sk.trigger === 'auto');
  }

  function updateUnitPanel() {
    const u = ui.selected;
    if (!u || !u.alive) { cancel(); return; }
    const panel = $('#unit-panel');
    const q = k => panel.querySelector(`[data-k="${k}"]`);
    q('hp').textContent = `${Math.ceil(u.hp)} / ${u.maxHp}`;
    q('hpbar').style.width = (100 * u.hp / u.maxHp).toFixed(1) + '%';
    q('atk').textContent = Math.round(u.atk);
    q('def').textContent = Math.round(u.defense);
    q('block').textContent = u.def.block ? `${u.blockUsed}/${u.def.block}` : '—';

    const s = u.def.skill;
    const btn = $('#btn-skill');
    const active = u.skillT > 0;
    const ready = u.skillReady;
    btn.classList.toggle('active', active);
    btn.classList.toggle('ready', ready && s.trigger === 'manual');
    let state, p;
    if (active) { state = Math.ceil(u.skillT) + 's'; p = u.skillT / s.duration; }
    else if (ready) { state = s.trigger === 'manual' ? '发动' : '待触发'; p = 1; }
    else { state = `${Math.floor(u.sp)}/${s.sp}`; p = u.sp / s.sp; }
    if (s.trigger === 'auto' && !active && !ready) state = '自动 ' + state;
    $('#skill-state').textContent = state;
    btn.style.setProperty('--p', p.toFixed(3));

    const sp = renderer.screenOfUnit(u);
    const x = Math.min(window.innerWidth - 110, Math.max(92, sp.x));
    const y = Math.min(window.innerHeight - 60, Math.max(120, sp.y));
    $('#radial').style.transform = `translate(${x}px, ${y}px)`;
  }

  $('#btn-skill').addEventListener('click', () => {
    const u = ui.selected;
    if (!u || !game) return;
    const s = u.def.skill;
    if (s.trigger === 'auto') { toast('该技能会自动触发'); return; }
    if (game.activateSkill(u)) { Sfx.play('skill'); cancel(); }
    else { toast(u.skillT > 0 ? '技能持续中' : '技能尚未就绪'); Sfx.play('deny'); }
  });
  $('#btn-retreat').addEventListener('click', () => {
    const u = ui.selected;
    if (!u || !game) return;
    game.retreat(u);
    Sfx.play('retreat');
    cancel();
  });
  $('#btn-dir-cancel').addEventListener('click', cancel);
  ['#radial', '#unit-panel', '#dir-hint'].forEach(s => $(s).addEventListener('pointerdown', ev => ev.stopPropagation()));
  // 点击后让按钮失去焦点，避免空格键再次触发按钮而与“暂停”快捷键冲突
  document.addEventListener('click', ev => {
    const b = ev.target.closest && ev.target.closest('button');
    if (b) b.blur();
  });

  /* ---------- 暂停 / 倍速 / 结算 ---------- */
  function togglePause() {
    if (!game) return;
    paused = !paused;
    if (paused) setMode('idle');
    show($('#pause'), paused);
    $('#btn-pause').innerHTML = paused
      ? '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>';
  }
  function toggleSpeed() {
    speed = speed === 1 ? 2 : 1;
    Store.data.speed = speed;
    Store.save();
    updateSpeedBtn();
  }
  function updateSpeedBtn() {
    const b = $('#btn-speed');
    b.textContent = speed + '×';
    b.classList.toggle('fast', speed > 1);
  }

  $('#btn-pause').addEventListener('click', () => { Sfx.play('click'); togglePause(); });
  $('#btn-speed').addEventListener('click', () => { Sfx.play('click'); toggleSpeed(); });
  $('#btn-resume').addEventListener('click', () => togglePause());
  $('#btn-restart').addEventListener('click', () => { paused = false; togglePauseIcon(); startLevel(levelIdx); });
  $('#btn-quit').addEventListener('click', () => { paused = false; togglePauseIcon(); showMenu(); });
  $('#btn-retry').addEventListener('click', () => startLevel(levelIdx));
  $('#btn-next').addEventListener('click', () => startLevel(levelIdx + 1));
  $('#btn-back').addEventListener('click', showMenu);
  $('#btn-help').addEventListener('click', () => show($('#help'), true));
  $('#btn-help-close').addEventListener('click', () => show($('#help'), false));
  $('#help').addEventListener('click', ev => { if (ev.target.id === 'help') show($('#help'), false); });
  $('#btn-mute').addEventListener('click', () => {
    Store.data.muted = !Store.data.muted;
    Store.save();
    updateMuteBtn();
    if (!Store.data.muted) { Sfx.ensure(); Sfx.play('click'); }
  });
  function updateMuteBtn() { $('#btn-mute').textContent = '音效：' + (Store.data.muted ? '关' : '开'); }
  function togglePauseIcon() { $('#btn-pause').innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>'; }

  function showResult() {
    const win = game.state === 'won';
    const stars = game.stars();
    const lv = LEVELS[levelIdx];
    if (win) {
      Store.data.stars[lv.id] = Math.max(Store.data.stars[lv.id] || 0, stars);
      Store.save();
    }
    setMode('idle');
    const box = $('#result .dialog');
    box.classList.toggle('win', win);
    box.classList.toggle('lose', !win);
    $('#result-kicker').textContent = `${lv.code} · ${lv.name}`;
    $('#result-title').textContent = win ? '作战成功' : '作战失败';
    $('#result-stars').innerHTML = starsHtml(stars);
    $('#result-stats').innerHTML = `
      <dt>用时</dt><dd>${fmtTime(game.time)}</dd>
      <dt>击破敌人</dt><dd>${game.killed} / ${game.total}</dd>
      <dt>漏过敌人</dt><dd>${game.leaked}</dd>
      <dt>剩余生命</dt><dd>${game.life} / ${game.maxLife}</dd>`;
    const hasNext = win && levelIdx < LEVELS.length - 1;
    show($('#btn-next'), hasNext);
    $('#btn-retry').classList.toggle('primary', !hasNext);
    show($('#result'), true);
    Sfx.play(win ? 'win' : 'lose');
  }

  /* ---------- 事件反馈 ---------- */
  function handleEvents(events) {
    for (const ev of events) {
      switch (ev.type) {
        case 'leak': {
          const v = $('#vignette');
          v.classList.remove('flash'); void v.offsetWidth; v.classList.add('flash');
          const life = $('.stat.life');
          life.classList.remove('hit'); void life.offsetWidth; life.classList.add('hit');
          Sfx.play('leak');
          break;
        }
        case 'unitDown':
          toast(`${ev.unit.def.name} 已撤离战场`);
          Sfx.play('down');
          break;
        case 'death': Sfx.play('kill'); break;
        case 'skill': if (ev.unit.def.skill.trigger === 'auto') Sfx.play('skill'); break;
        case 'end': endTimer = 0.9; break;
      }
    }
  }

  /* ---------- HUD ---------- */
  function setText(key, el, val) {
    if (hudCache[key] === val) return;
    hudCache[key] = val;
    el.textContent = val;
  }

  function updateHud() {
    setText('kills', $('#stat-kills'), `${game.killed}/${game.total}`);
    setText('life', $('#stat-life'), String(Math.max(0, game.life)));
    setText('dp', $('#dp-value'), String(game.dp));
    setText('slots', $('#slots'), String(game.unitLimit - game.aliveUnits));
    const fill = game.dp >= 99 ? 100 : game.dpTimer * 100;
    $('#dp-fill').style.width = fill.toFixed(1) + '%';
    game.cards.forEach((c, i) => {
      const ce = cardEls[i];
      const st = game.cardStatus(c);
      if (ce.state !== st) {
        ce.el.classList.remove('ready', 'dp', 'cooldown', 'limit', 'deployed');
        ce.el.classList.add(st);
        ce.state = st;
      }
      if (st === 'cooldown') {
        const t = String(Math.ceil(c.cooldown));
        if (ce.cdText !== t) { ce.cdText = t; ce.cd.textContent = t; }
      }
    });
    if (ui.mode === 'selected') updateUnitPanel();
  }

  /* ---------- 主循环 ---------- */
  let last = performance.now();
  function frame(now) {
    const realDt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    realTime += realDt;
    if (game) {
      let simDt = 0;
      if (!paused && game.state === 'playing') {
        simDt = realDt * speed * (isSlow() ? SLOW_SCALE : 1);
        const steps = Math.max(1, Math.ceil(simDt / (1 / 60)));
        for (let i = 0; i < steps; i++) game.update(simDt / steps);
        const boss = game.nextBoss(6);
        if (boss && !bossWarned.has(boss)) {
          bossWarned.add(boss);
          banner('警告', `首领「${ENEMIES[boss.e].name}」即将出现`, true);
          Sfx.play('warn');
        }
      }
      renderer.consumeEvents(game.events);
      handleEvents(game.events);
      game.events.length = 0;
      renderer.tick(game.state === 'playing' ? simDt : realDt);
      renderer.draw(ui, realTime);
      updateHud();
      if (endTimer >= 0) {
        endTimer -= realDt;
        if (endTimer < 0) showResult();
      }
    }
    requestAnimationFrame(frame);
  }

  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    const css = getComputedStyle(document.documentElement);
    const topH = parseFloat(css.getPropertyValue('--top-h')) || 56;
    const hint = $('#rotate-hint');
    const hintH = getComputedStyle(hint).display !== 'none' ? 28 : 0;
    const bottom = game ? $('.hud-bottom').offsetHeight : 120;
    renderer.resize(w, h, topH + hintH + 2, bottom + 4);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 200));

  /* ---------- 初始化 ---------- */
  Store.load();
  speed = Store.data.speed === 2 ? 2 : 1;
  updateSpeedBtn();
  updateMuteBtn();
  document.querySelectorAll('path[data-icon]').forEach(p => p.setAttribute('d', ICONS[p.dataset.icon]));
  renderHelp();
  showMenu();
  onResize();
  requestAnimationFrame(frame);

  // 便于调试
  window.EMBERLINE = { get game() { return game; }, ui, renderer, startLevel };
})();
