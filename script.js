(() => {
  'use strict';

  const BASE_CONFIG = {
    slotCount: 9,
    ambientTemp: 20,
    maxTemp: 140,
    heatTargets: [20, 75, 100, 130],
    burnAt: 1,
    perfectScore: 100,
    overScore: 30,
    burntPenalty: 50,
    comboBonus: 20,
    comboCap: 5,
  };

  const DIFFICULTIES = {
    easy: {
      label: '易しい',
      note: '制限時間100秒。火力が効きやすく、湯も減りにくい。蒸し加減のばらつきは小さめ。',
      stock: 20,
      duration: 100,
      tempRate: 0.5,
      baseCookPerSec: 1 / 17,
      zoneStart: 0.5,
      zoneEnd: 0.82,
      cookSpeedMin: 0.88,
      cookSpeedMax: 1.12,
      waterDrainPerSec: 1.2,
      waterRefill: 50,
      waterCooldown: 2,
      ranks: [
        { min: 2200, label: '名人' },
        { min: 1500, label: '熟練' },
        { min: 900, label: '一人前' },
        { min: 450, label: '見習い' },
        { min: 0, label: '修行中' },
      ],
    },
    normal: {
      label: '普通',
      note: '制限時間90秒。蒸し上がりは速く、一個ごとに早さがばらつく。',
      stock: 24,
      duration: 90,
      tempRate: 0.32,
      baseCookPerSec: 1 / 14,
      zoneStart: 0.57,
      zoneEnd: 0.76,
      cookSpeedMin: 0.78,
      cookSpeedMax: 1.24,
      waterDrainPerSec: 1.7,
      waterRefill: 40,
      waterCooldown: 3,
      ranks: [
        { min: 3000, label: '名人' },
        { min: 2000, label: '熟練' },
        { min: 1200, label: '一人前' },
        { min: 600, label: '見習い' },
        { min: 0, label: '修行中' },
      ],
    },
    hard: {
      label: '厳しい',
      note: '制限時間80秒。蒸し上がりは速く、ばらつきも大きい。湯の減りも早い。',
      stock: 28,
      duration: 80,
      tempRate: 0.26,
      baseCookPerSec: 1 / 11.5,
      zoneStart: 0.6,
      zoneEnd: 0.73,
      cookSpeedMin: 0.7,
      cookSpeedMax: 1.32,
      waterDrainPerSec: 2.1,
      waterRefill: 32,
      waterCooldown: 4,
      ranks: [
        { min: 3600, label: '名人' },
        { min: 2400, label: '熟練' },
        { min: 1500, label: '一人前' },
        { min: 700, label: '見習い' },
        { min: 0, label: '修行中' },
      ],
    },
  };

  let CONFIG = { ...BASE_CONFIG, ...DIFFICULTIES.normal };

  const $ = (id) => document.getElementById(id);
  const el = {
    score: $('score'),
    time: $('time'),
    stock: $('stock'),
    timeBox: $('time').parentElement,
    message: $('message'),
    slots: $('slots'),
    steam: $('steam-layer'),
    temp: $('temp'),
    tempBar: $('temp-bar'),
    water: $('water'),
    waterBar: $('water-bar'),
    addWater: $('add-water'),
    heatBtns: Array.from(document.querySelectorAll('.heat-btn')),
    overlay: $('overlay'),
    dialogBody: $('dialog-body'),
    start: $('start'),
    best: $('best'),
    mute: $('mute'),
    diffBtns: Array.from(document.querySelectorAll('.diff-btn')),
    difficultyNote: $('difficulty-note'),
  };

  const storage = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : v;
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, String(value));
      } catch (e) {
        /* ignore */
      }
    },
  };

  const state = {
    running: false,
    score: 0,
    timeLeft: CONFIG.duration,
    stock: CONFIG.stock,
    temp: CONFIG.ambientTemp,
    water: 100,
    heat: 2,
    waterCd: 0,
    combo: 0,
    stats: { perfect: 0, over: 0, raw: 0, burnt: 0, maxCombo: 0 },
    slots: [],
    best: Number(storage.get('shumai-best', 0)) || 0,
    muted: storage.get('shumai-muted', '0') === '1',
    difficulty: storage.get('shumai-difficulty', 'normal'),
    steamTimer: 0,
    msgTimer: 0,
    last: 0,
  };

  /* ---------- Audio ---------- */
  let audioCtx = null;
  function beep(freq, duration, type = 'sine', gain = 0.1, delay = 0) {
    if (state.muted) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t = audioCtx.currentTime + delay;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(g).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + duration);
    } catch (e) {
      /* ignore */
    }
  }
  const sfx = {
    place: () => beep(260, 0.07, 'triangle', 0.09),
    perfect: () => { beep(587, 0.14, 'sine', 0.11); beep(784, 0.22, 'sine', 0.11, 0.1); },
    ok: () => beep(440, 0.12, 'sine', 0.08),
    bad: () => beep(140, 0.22, 'triangle', 0.12),
    water: () => beep(380, 0.14, 'triangle', 0.08),
    end: () => { beep(440, 0.18, 'sine', 0.09); beep(587, 0.18, 'sine', 0.09, 0.18); beep(698, 0.34, 'sine', 0.09, 0.36); },
  };

  /* ---------- Shumai drawing (top view) ---------- */
  const rand = (a, b) => a + Math.random() * (b - a);

  function blobPath(cx, cy, radiusAt, steps) {
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const r = radiusAt(t);
      const x = (cx + Math.cos(t) * r).toFixed(2);
      const y = (cy + Math.sin(t) * r).toFixed(2);
      d += (i === 0 ? 'M' : 'L') + x + ' ' + y;
    }
    return d + 'Z';
  }

  function shumaiMarkup() {
    const pleats = 14 + Math.floor(Math.random() * 3);
    const ph = rand(0, Math.PI * 2);
    const w1 = rand(0, Math.PI * 2);
    const w2 = rand(0, Math.PI * 2);
    const edgeR = (t) => 37.5 + 2.6 * Math.sin(pleats * t + ph) + 0.9 * Math.sin(3 * t + w1) + 0.6 * Math.sin(5 * t + w2);
    const skinPath = blobPath(50, 50, edgeR, 140);

    const m1 = rand(0, Math.PI * 2);
    const m2 = rand(0, Math.PI * 2);
    const meatR = (t) => 21 + 1.4 * Math.sin(5 * t + m1) + 1 * Math.sin(8 * t + m2) + 0.6 * Math.sin(13 * t + m1);
    const meatPath = blobPath(50, 50, meatR, 80);

    let folds = '';
    for (let k = 0; k < pleats; k++) {
      const t = (Math.PI / 2 - ph + Math.PI * 2 * k) / pleats;
      const rOut = edgeR(t) - 2.2;
      const rIn = 23.5;
      const tw = 0.16;
      const x1 = 50 + Math.cos(t + tw) * rIn;
      const y1 = 50 + Math.sin(t + tw) * rIn;
      const x2 = 50 + Math.cos(t) * rOut;
      const y2 = 50 + Math.sin(t) * rOut;
      const cx = 50 + Math.cos(t + tw * 0.2) * ((rIn + rOut) / 2 + 1.5);
      const cy = 50 + Math.sin(t + tw * 0.2) * ((rIn + rOut) / 2 + 1.5);
      folds += `M${x1.toFixed(2)} ${y1.toFixed(2)}Q${cx.toFixed(2)} ${cy.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
      const tv = t + Math.PI / pleats;
      const vIn = 27;
      const vOut = edgeR(tv) - 1;
      folds += `M${(50 + Math.cos(tv) * vIn).toFixed(2)} ${(50 + Math.sin(tv) * vIn).toFixed(2)}L${(50 + Math.cos(tv) * vOut).toFixed(2)} ${(50 + Math.sin(tv) * vOut).toFixed(2)}`;
    }

    let flecks = '';
    for (let i = 0; i < 9; i++) {
      const a = rand(0, Math.PI * 2);
      const d = rand(2, 16);
      const x = (50 + Math.cos(a) * d).toFixed(1);
      const y = (50 + Math.sin(a) * d).toFixed(1);
      const cls = i % 3 === 0 ? 'mt-l' : 'mt-d';
      flecks += `<ellipse class="${cls}" cx="${x}" cy="${y}" rx="${rand(1.1, 2.6).toFixed(1)}" ry="${rand(0.8, 1.8).toFixed(1)}" transform="rotate(${Math.round(rand(0, 180))} ${x} ${y})"/>`;
    }

    const px = (50 + rand(-1.5, 1.5)).toFixed(1);
    const py = (49 + rand(-1.5, 1.5)).toFixed(1);

    return (
      '<svg class="shumai-svg" viewBox="0 0 100 100" aria-hidden="true">' +
      '<circle class="track" cx="50" cy="50" r="47.5" pathLength="100"/>' +
      '<circle class="zone" cx="50" cy="50" r="47.5" pathLength="100" transform="rotate(-90 50 50)"/>' +
      '<circle class="prog" cx="50" cy="50" r="47.5" pathLength="100" transform="rotate(-90 50 50)"/>' +
      '<ellipse cx="51" cy="54" rx="43" ry="41" fill="url(#g-shadow)"/>' +
      `<path class="sk" d="${skinPath}"/>` +
      `<path d="${skinPath}" fill="url(#g-skin)"/>` +
      `<path class="sk-line" d="${folds}"/>` +
      `<path class="mt" d="${meatPath}"/>` +
      flecks +
      `<path d="${meatPath}" fill="url(#g-meat)"/>` +
      `<path d="${meatPath}" fill="none" stroke="#000" stroke-opacity="0.22" stroke-width="1.2"/>` +
      `<circle class="pea" cx="${px}" cy="${py}" r="4.8"/>` +
      `<circle cx="${px}" cy="${py}" r="4.8" fill="url(#g-pea)"/>` +
      '<ellipse class="gloss" cx="36" cy="33" rx="9" ry="4.5" fill="#fff" opacity="0.18" transform="rotate(-35 36 33)"/>' +
      '</svg>'
    );
  }

  /* ---------- Setup ---------- */
  function emptySlotMarkup() {
    return '<span class="empty"></span>';
  }

  function buildSlots() {
    el.slots.textContent = '';
    state.slots = [];
    for (let i = 0; i < CONFIG.slotCount; i++) {
      const btn = document.createElement('button');
      btn.className = 'slot';
      btn.type = 'button';
      btn.setAttribute('aria-label', `蒸籠 ${i + 1}`);
      btn.innerHTML = emptySlotMarkup();
      btn.addEventListener('click', () => onSlot(i));
      el.slots.appendChild(btn);
      state.slots.push({ el: btn, item: null });
    }
  }

  function setMessage(text, kind = '', hold = 2) {
    el.message.textContent = text;
    el.message.className = 'message' + (kind ? ' ' + kind : '');
    state.msgTimer = hold;
  }

  /* ---------- Actions ---------- */
  function onSlot(i) {
    if (!state.running) return;
    const slot = state.slots[i];
    if (!slot.item) {
      if (state.stock <= 0) {
        setMessage('種がもうありません', 'bad');
        return;
      }
      state.stock--;
      slot.item = { progress: 0, speed: rand(CONFIG.cookSpeedMin, CONFIG.cookSpeedMax) };
      slot.el.innerHTML = shumaiMarkup();
      slot.svg = slot.el.querySelector('.shumai-svg');
      slot.prog = slot.el.querySelector('.prog');
      slot.gloss = slot.el.querySelector('.gloss');
      const zone = slot.el.querySelector('.zone');
      const len = (CONFIG.zoneEnd - CONFIG.zoneStart) * 100;
      zone.style.strokeDasharray = `${len} ${100 - len}`;
      zone.style.strokeDashoffset = -CONFIG.zoneStart * 100;
      renderSlot(slot);
      sfx.place();
    } else {
      serve(slot);
    }
    renderHud();
    checkEnd();
  }

  function clearSlot(slot) {
    slot.item = null;
    slot.svg = null;
    slot.prog = null;
    slot.gloss = null;
    slot.el.innerHTML = emptySlotMarkup();
  }

  function serve(slot) {
    const p = slot.item.progress;
    const { zoneStart, zoneEnd, burnAt } = CONFIG;
    if (p < zoneStart) {
      state.stats.raw++;
      state.combo = 0;
      setMessage('火が通っていません。0点', 'bad');
      sfx.bad();
    } else if (p < zoneEnd) {
      state.combo++;
      state.stats.perfect++;
      state.stats.maxCombo = Math.max(state.stats.maxCombo, state.combo);
      const bonus = CONFIG.comboBonus * Math.min(state.combo - 1, CONFIG.comboCap);
      const pts = CONFIG.perfectScore + bonus;
      state.score += pts;
      setMessage(`見事な蒸し上がり　+${pts}` + (state.combo > 1 ? `　連続 ${state.combo}` : ''), 'good');
      sfx.perfect();
    } else if (p < burnAt) {
      state.combo = 0;
      state.stats.over++;
      state.score += CONFIG.overScore;
      setMessage(`蒸しすぎです　+${CONFIG.overScore}`, 'bad');
      sfx.ok();
    } else {
      state.combo = 0;
      state.stats.burnt++;
      state.score = Math.max(0, state.score - CONFIG.burntPenalty);
      setMessage(`焦げ付きました　−${CONFIG.burntPenalty}`, 'bad');
      sfx.bad();
    }
    clearSlot(slot);
  }

  function setHeat(level) {
    state.heat = level;
    el.heatBtns.forEach((b) => b.classList.toggle('active', Number(b.dataset.heat) === level));
  }

  function setDifficulty(key, persist = true) {
    if (!DIFFICULTIES[key]) key = 'normal';
    state.difficulty = key;
    el.diffBtns.forEach((b) => b.classList.toggle('active', b.dataset.difficulty === key));
    el.difficultyNote.textContent = DIFFICULTIES[key].note;
    if (!state.running) {
      state.timeLeft = DIFFICULTIES[key].duration;
      state.stock = DIFFICULTIES[key].stock;
      renderHud();
    }
    if (persist) storage.set('shumai-difficulty', key);
  }

  function addWater() {
    if (!state.running || state.waterCd > 0) return;
    state.water = Math.min(100, state.water + CONFIG.waterRefill);
    state.temp = Math.max(CONFIG.ambientTemp, state.temp - 15);
    state.waterCd = CONFIG.waterCooldown;
    sfx.water();
    setMessage('差し水をしました', '', 1.5);
  }

  /* ---------- Game flow ---------- */
  function startGame() {
    CONFIG = { ...BASE_CONFIG, ...DIFFICULTIES[state.difficulty] };
    Object.assign(state, {
      running: true,
      score: 0,
      timeLeft: CONFIG.duration,
      stock: CONFIG.stock,
      temp: CONFIG.ambientTemp,
      water: 100,
      waterCd: 0,
      combo: 0,
      stats: { perfect: 0, over: 0, raw: 0, burnt: 0, maxCombo: 0 },
      steamTimer: 0,
    });
    buildSlots();
    setHeat(2);
    el.overlay.classList.add('hidden');
    setMessage('種を蒸籠に並べてください', '', 3);
    renderHud();
    state.last = performance.now();
    requestAnimationFrame(loop);
  }

  function checkEnd() {
    if (!state.running) return;
    const empty = state.slots.every((s) => !s.item);
    if (state.timeLeft <= 0 || (state.stock <= 0 && empty)) endGame();
  }

  function endGame() {
    state.running = false;
    sfx.end();
    const isBest = state.score > state.best;
    if (isBest) {
      state.best = state.score;
      storage.set('shumai-best', state.best);
    }
    const rank = CONFIG.ranks.find((r) => state.score >= r.min).label;
    const s = state.stats;
    el.dialogBody.innerHTML =
      '<div class="result">' +
      '<p class="result-label">本日の評価</p>' +
      `<p class="result-rank">${rank}</p>` +
      `<p class="result-score">${state.score}<small>点</small>${isBest ? '<span class="result-new">最高得点更新</span>' : ''}</p>` +
      `<p class="result-stats">難易度 ${DIFFICULTIES[state.difficulty].label}<br>見事 ${s.perfect}　蒸しすぎ ${s.over}　生焼け ${s.raw}　焦げ ${s.burnt}<br>最大連続 ${s.maxCombo}</p>` +
      '</div>';
    el.start.textContent = 'もう一度';
    el.best.textContent = state.best;
    el.overlay.classList.remove('hidden');
  }

  /* ---------- Simulation ---------- */
  function update(dt) {
    state.timeLeft = Math.max(0, state.timeLeft - dt);

    const target = CONFIG.heatTargets[state.heat];
    const dry = state.water <= 0;
    state.temp += (target - state.temp) * Math.min(1, CONFIG.tempRate * dt);
    if (dry && state.heat > 0) state.temp += (target + 40 - state.temp) * Math.min(1, 0.2 * dt);

    state.waterCd = Math.max(0, state.waterCd - dt);

    const steaming = !dry && state.temp >= 70;
    if (steaming) {
      const k = Math.max(0, state.temp - 70) / 30;
      state.water = Math.max(0, state.water - CONFIG.waterDrainPerSec * k * dt);
    }

    let cookRate = 0;
    if (steaming && state.temp >= 60) {
      cookRate = CONFIG.baseCookPerSec * ((state.temp - 60) / 40);
    } else if (dry && state.temp > 110) {
      cookRate = CONFIG.baseCookPerSec * 2.5;
    }

    for (const slot of state.slots) {
      if (slot.item) slot.item.progress += cookRate * slot.item.speed * dt;
    }

    state.msgTimer -= dt;
    if (state.msgTimer <= 0 && state.running) {
      if (dry && state.heat > 0) setMessage('空焚きです。差し水をしてください', 'bad', 1);
      else if (state.water < 25 && state.heat > 0) setMessage('湯が少なくなっています', 'bad', 1);
    }

    state.steamTimer -= dt;
    if (steaming && state.steamTimer <= 0) {
      spawnSteam();
      state.steamTimer = Math.max(0.12, 0.6 - (state.temp - 70) / 120);
    }
  }

  function spawnSteam() {
    const puff = document.createElement('span');
    puff.className = 'steam-puff';
    puff.style.left = 10 + Math.random() * 80 + '%';
    el.steam.appendChild(puff);
    puff.addEventListener('animationend', () => puff.remove());
  }

  /* ---------- Render ---------- */
  function mix(a, b, t) {
    return Math.round(a + (b - a) * Math.max(0, Math.min(1, t)));
  }
  function lerpColor(c1, c2, t) {
    return [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];
  }
  function css(c, k = 1) {
    return `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`;
  }

  const SKIN = { raw: [236, 226, 206], cooked: [242, 224, 176], over: [200, 158, 96], burnt: [64, 42, 30] };
  const MEAT = { raw: [206, 132, 128], cooked: [160, 102, 76], over: [120, 76, 52], burnt: [34, 24, 18] };
  const PEA = { raw: [128, 168, 88], cooked: [108, 160, 72], over: [92, 104, 56], burnt: [38, 40, 24] };

  function stage(p, c) {
    const { zoneStart, zoneEnd, burnAt } = CONFIG;
    if (p < zoneStart) return lerpColor(c.raw, c.cooked, p / zoneStart);
    if (p < zoneEnd) return c.cooked;
    if (p < burnAt) return lerpColor(c.cooked, c.over, (p - zoneEnd) / (burnAt - zoneEnd));
    return lerpColor(c.over, c.burnt, Math.min(1, (p - burnAt) * 6));
  }

  function renderSlot(slot) {
    const p = slot.item.progress;
    const { zoneStart, zoneEnd, burnAt } = CONFIG;
    const skin = stage(p, SKIN);
    const s = slot.svg.style;
    s.setProperty('--skin', css(skin));
    s.setProperty('--skin-d', css(skin, 0.6));
    s.setProperty('--meat', css(stage(p, MEAT)));
    s.setProperty('--meat-d', css(stage(p, MEAT), 0.6));
    s.setProperty('--meat-l', css(stage(p, MEAT), 1.3));
    s.setProperty('--pea', css(stage(p, PEA)));

    const inZone = p >= zoneStart && p < zoneEnd;
    slot.svg.classList.toggle('in-zone', inZone);
    slot.gloss.setAttribute('opacity', inZone ? 0.32 : p < zoneStart ? 0.14 : 0.06);

    slot.prog.style.strokeDasharray = `${Math.min(1, p) * 100} 100`;
    slot.prog.style.stroke = inZone ? '#c9a24a' : p >= burnAt ? '#b8452f' : p >= zoneEnd ? '#c9703a' : 'rgba(233,226,214,0.75)';
  }

  function renderHud() {
    el.score.textContent = state.score;
    el.time.textContent = Math.ceil(state.timeLeft);
    el.timeBox.classList.toggle('warn', state.timeLeft <= 10);
    el.stock.textContent = state.stock;
    el.temp.textContent = Math.round(state.temp);
    el.tempBar.style.width = Math.min(100, (state.temp / CONFIG.maxTemp) * 100) + '%';
    el.water.textContent = Math.round(state.water);
    el.waterBar.style.width = state.water + '%';
    el.addWater.disabled = state.waterCd > 0;
    el.addWater.textContent = state.waterCd > 0 ? `差し水（あと ${Math.ceil(state.waterCd)} 秒）` : '差し水';
  }

  function loop(now) {
    if (!state.running) return;
    const dt = Math.min(0.1, (now - state.last) / 1000);
    state.last = now;
    update(dt);
    for (const slot of state.slots) if (slot.item) renderSlot(slot);
    renderHud();
    checkEnd();
    if (state.running) requestAnimationFrame(loop);
  }

  /* ---------- Events ---------- */
  function renderMute() {
    el.mute.textContent = state.muted ? 'OFF' : 'ON';
  }

  el.heatBtns.forEach((b) =>
    b.addEventListener('click', () => {
      if (state.running) setHeat(Number(b.dataset.heat));
    })
  );
  el.addWater.addEventListener('click', addWater);
  el.diffBtns.forEach((b) => b.addEventListener('click', () => setDifficulty(b.dataset.difficulty)));
  el.start.addEventListener('click', startGame);
  el.mute.addEventListener('click', () => {
    state.muted = !state.muted;
    storage.set('shumai-muted', state.muted ? '1' : '0');
    renderMute();
  });

  el.best.textContent = state.best;
  renderMute();
  setDifficulty(state.difficulty, false);
  buildSlots();
  renderHud();
})();
