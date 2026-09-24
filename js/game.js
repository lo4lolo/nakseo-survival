/* 낙서 서바이벌 — 게임: 나, 다른 사람, 공격과 판정, 땅 그리기, 판 진행, 화면, 입력
 *
 * 판정 원칙
 * - 내 몸(위치, 체력)은 내 화면이 정한다. 맞았는지도 "맞는 사람" 화면이 정한다.
 * - 판 진행(그리기 → 난투 → 결과)만 방장이 정해서 자기 상태에 실어 보낸다.
 */
(function () {
  'use strict';
  const NS = window.NS, T = window.THREE, PAL = NS.PAL, Sfx = NS.Sfx, $ = NS.$;
  const { clamp, lerp, rnd, pick, angDiff, num, TAU } = NS;

  /* ---------- 저장 ---------- */
  const KEY = 'nakseo-survival-v1';
  let save = { name: '', color: NS.pick(NS.BODY_COLORS.slice(0, 6)), strokes: null, ink: 'ink', wins: 0, muted: false };
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s === 'object') save = Object.assign(save, s); } catch (e) { /* 이번 판만 */ }
  save.color = NS.safeColor(save.color);
  save.ink = NS.safeInk(save.ink);
  save.wins = Math.floor(num(save.wins, 0, 99999, 0));
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* 무시 */ } };
  Sfx.muted = !!save.muted;

  /* ---------- 규칙 숫자 ---------- */
  const DRAW_MS = 25000, FIGHT_MS = 150000, END_MS = 6000;
  const PH = ['wait', 'draw', 'fight', 'end'];
  const INK_MAX = 100, INK_COST = 6, INK_REGEN = 9, MAX_STRUCTS = 3, DRAW_RANGE = 10;
  const ZONE_START = 20, ZONE_SPEED = 0.45;
  const BODY_R = 0.62;
  const WORDS = {
    blade: ['싹둑!', '슥!', '베었다!'], spear: ['푹!', '찌릿!', '콕!'], hammer: ['쾅!', '쿵!'],
    whip: ['찰싹!', '휙!'], shield: ['퍽!', '밀쳐!'],
  };

  const G = {
    mode: 'title', time: 0, net: null, phaseKey: '', myRn: 0, watch: false, D: null, hitstop: 0,
    phase: { ph: 'wait', rn: 0, endAt: 0, fightAt: 0, win: null, wn: null },
    pubT: 0, hb: 0, spec: null, listT: 0, sketchByPhase: false, gdraw: null, zoneWarned: false,
  };
  const P = {
    x: 0, z: 0, vx: 0, vz: 0, kx: 0, kz: 0, face: 0, hp: 100, dead: false,
    atk: null, atkSeq: 0, lastAtkEnd: -9, comboStep: -1, dashT: 0, dashCd: 0, dx: 0, dz: 1,
    inv: 0, slowT: 0, rootT: 0, burnT: 0, burnBy: null, lastHitBy: null, lastHitAt: -99, kb: null,
    ink: INK_MAX, respawnAt: 0, structs: [], sid: 0, spikeCd: new Map(), healPopT: 0, flash: 0,
  };
  const ME = { w: null, kills: 0 };
  const remotes = new Map();
  const dummies = [];
  const scene = NS.scene;
  const myId = () => (G.net ? G.net.myId : 'me');

  /* ---------- 내 몸과 무기 ---------- */
  const myRig = NS.makeRig(save.color);
  scene.add(myRig.root);

  function setMyWeapon(strokes, ink) {
    ink = NS.safeInk(ink);
    // 다른 사람 화면과 똑같은 결과가 나오도록, 보낼 글자로 바꿨다가 되돌린 그림으로 판정한다
    let enc = strokes && strokes.length ? NS.encStrokes(strokes, 8, 0, 8) : '';
    let dec = NS.decStrokes(enc, 8, 0);
    let st = dec && NS.analyzeWeapon(dec, ink);
    if (!st) {
      enc = NS.encStrokes(NS.PRESETS.blade(), 8, 0, 8);
      dec = NS.decStrokes(enc, 8, 0);
      st = NS.analyzeWeapon(dec, ink);
    }
    ME.w = { strokes: dec, ink, stats: st, enc };
    NS.setRigWeapon(myRig, dec, ink, st);
    save.strokes = dec;
    save.ink = ink;
    persist();
    drawWeaponCard();
  }

  function drawWeaponCard() {
    const c = $('wcard-c'), x = c.getContext('2d'), w = ME.w;
    const k = c.width / NS.SK.SIZE;
    x.clearRect(0, 0, c.width, c.height);
    const ink = NS.INKS[w.ink];
    const { strokes } = NS.withHandle(w.strokes);
    x.lineCap = x.lineJoin = 'round';
    for (const s of strokes) {
      if (NS.closedOf(s) && NS.area(s) > 1500) {
        x.fillStyle = ink.fill;
        x.beginPath();
        s.forEach((p, i) => (i ? x.lineTo(p.x * k, p.y * k) : x.moveTo(p.x * k, p.y * k)));
        x.fill();
      }
    }
    x.strokeStyle = ink.color;
    x.lineWidth = 3;
    for (const s of strokes) {
      x.beginPath();
      s.forEach((p, i) => (i ? x.lineTo(p.x * k, p.y * k) : x.moveTo(p.x * k, p.y * k)));
      x.stroke();
    }
    $('wcard-name').textContent = w.stats.label;
    $('wcard-desc').textContent = w.stats.desc;
    $('title-weapon').textContent = w.stats.label;
  }

  /* ---------- 화면 글자 ---------- */
  const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  let bannerT = 0;
  function banner(title, sub, ms) {
    const b = $('banner');
    b.querySelector('b').textContent = title;
    b.querySelector('small').textContent = sub || '';
    b.hidden = false;
    b.classList.remove('in');
    void b.offsetWidth;
    b.classList.add('in');
    clearTimeout(bannerT);
    bannerT = setTimeout(() => { b.hidden = true; }, ms || 1500);
  }
  function feed(text) {
    const li = document.createElement('li');
    li.textContent = text;
    $('feed').appendChild(li);
    while ($('feed').children.length > 4) $('feed').firstChild.remove();
    setTimeout(() => li.remove(), 4500);
  }
  function makeTag(name) {
    const el = document.createElement('div');
    el.className = 'tag';
    el.innerHTML = '<b></b><i><u></u></i>';
    el.querySelector('b').textContent = name;
    $('pops').appendChild(el);
    return el;
  }
  function placeTag(el, x, y, z, hp, show) {
    if (!show) { if (!el.hidden) el.hidden = true; return; }
    const s = NS.toScreen(x, y, z);
    if (!s.front) { el.hidden = true; return; }
    el.hidden = false;
    el.style.transform = `translate(${s.x | 0}px, ${s.y | 0}px) translate(-50%, -100%)`;
    const w = Math.round(clamp(hp, 0, 100)) + '%';
    const u = el.querySelector('u');
    if (u.style.width !== w) { u.style.width = w; u.className = hp > 50 ? '' : hp > 25 ? 'mid' : 'low'; }
  }

  /* ---------- 입력 ---------- */
  const keys = {};
  const mouse = { sx: innerWidth / 2, sy: innerHeight / 2, down: false, has: false };
  const touch = { on: !!(window.matchMedia && matchMedia('(pointer: coarse)').matches), mx: 0, mz: 0, atk: false, drawMode: false, stickId: null };
  const view = NS.renderer.domElement;

  addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    keys[e.code] = true;
    if (G.mode !== 'play') return;
    if (e.code === 'Space') { e.preventDefault(); tryDash(); }
    if (e.code === 'KeyQ') openSketchManual();
    if (e.code === 'KeyM') toggleMute();
    if (e.code === 'Escape' && NS.Sketch.isOpen()) NS.Sketch.close(true);
    if ((e.code === 'Tab' || e.code === 'KeyE') && spectating()) { e.preventDefault(); cycleSpec(); }
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.down = false; touch.atk = false; endGroundDraw(); });

  view.addEventListener('contextmenu', (e) => e.preventDefault());
  view.addEventListener('pointerdown', (e) => {
    Sfx.unlock();
    mouse.sx = e.clientX; mouse.sy = e.clientY;
    if (G.mode !== 'play' || NS.Sketch.isOpen()) return;
    if (e.pointerType === 'touch') {
      if (touch.drawMode) { view.setPointerCapture(e.pointerId); beginGroundDraw(); }
      else if (spectating()) cycleSpec();
      return;
    }
    mouse.has = true;
    view.setPointerCapture(e.pointerId);
    if (e.button === 0) {
      if (spectating()) cycleSpec();
      else { mouse.down = true; aimAtMouse(); tryAttack(); }   // 짧게 톡 눌러도 한 번은 휘두른다
    }
    if (e.button === 2) beginGroundDraw();
  });
  view.addEventListener('pointermove', (e) => {
    mouse.sx = e.clientX; mouse.sy = e.clientY;
    if (e.pointerType !== 'touch') mouse.has = true;
  });
  view.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') { endGroundDraw(); return; }
    if (e.button === 0) mouse.down = false;
    if (e.button === 2) endGroundDraw();
  });
  view.addEventListener('pointercancel', () => { mouse.down = false; endGroundDraw(); });

  // 터치: 왼쪽 막대로 이동, 오른쪽 버튼
  (function touchUI() {
    const stick = $('stick'), knob = stick.querySelector('i');
    const setStick = (e) => {
      const r = stick.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const L = Math.hypot(dx, dy), M = r.width / 2;
      if (L > M) { dx *= M / L; dy *= M / L; }
      touch.mx = dx / M; touch.mz = dy / M;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    stick.addEventListener('pointerdown', (e) => { Sfx.unlock(); touch.stickId = e.pointerId; stick.setPointerCapture(e.pointerId); setStick(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === touch.stickId) setStick(e); });
    const stop = (e) => { if (e.pointerId !== touch.stickId) return; touch.stickId = null; touch.mx = touch.mz = 0; knob.style.transform = ''; };
    stick.addEventListener('pointerup', stop);
    stick.addEventListener('pointercancel', stop);
    const atk = $('t-atk');
    atk.addEventListener('pointerdown', (e) => { Sfx.unlock(); atk.setPointerCapture(e.pointerId); if (spectating()) cycleSpec(); else { touch.atk = true; tryAttack(); } });
    atk.addEventListener('pointerup', () => { touch.atk = false; });
    atk.addEventListener('pointercancel', () => { touch.atk = false; });
    $('t-dash').addEventListener('pointerdown', () => tryDash());
    $('t-draw').addEventListener('click', () => { touch.drawMode = !touch.drawMode; $('t-draw').classList.toggle('on', touch.drawMode); });
    $('t-sketch').addEventListener('click', () => openSketchManual());
  })();

  function aimAtMouse() {
    const q = NS.screenToGround(mouse.sx, mouse.sy);
    if (q && Math.hypot(q.x - P.x, q.z - P.z) > 0.3) P.face = Math.atan2(q.x - P.x, q.z - P.z);
  }
  function toggleMute() {
    Sfx.muted = save.muted = !save.muted;
    persist();
    $('btn-mute').textContent = save.muted ? '소리 켜기' : '소리 끄기';
  }

  /* ---------- 공격 ---------- */
  function canAct() { return G.mode === 'play' && !P.dead && !G.watch && !NS.Sketch.isOpen(); }
  function pvpOn() { return G.phase.ph === 'fight' && G.myRn === G.phase.rn && G.myRn > 0; }

  function tryAttack() {
    if (!canAct() || P.atk || P.rootT > 0) return;
    const st = ME.w.stats;
    let step = 0;
    if (st.type === 'blade') step = G.time - P.lastAtkEnd < 0.45 ? (P.comboStep + 1) % 3 : 0;
    else if (st.type === 'whip') step = G.time - P.lastAtkEnd < 0.6 ? (P.comboStep + 1) % 2 : 0;
    P.atkSeq = (P.atkSeq + 1) % 100000;
    P.atk = { seq: P.atkSeq, step, t: 0, dur: NS.atkDur(st, step), type: st.type, hit: new Set(), impacted: false, swung: false };
  }

  function tryDash() {
    if (!canAct() || P.dashCd > 0 || P.rootT > 0) return;
    let dx = 0, dz = 0;
    if (keys.KeyW || keys.ArrowUp) dz -= 1;
    if (keys.KeyS || keys.ArrowDown) dz += 1;
    if (keys.KeyA || keys.ArrowLeft) dx -= 1;
    if (keys.KeyD || keys.ArrowRight) dx += 1;
    if (touch.on) { dx += touch.mx; dz += touch.mz; }
    let L = Math.hypot(dx, dz);
    if (L < 0.2) { dx = Math.sin(P.face); dz = Math.cos(P.face); L = 1; }
    P.dx = dx / L; P.dz = dz / L;
    P.dashT = 0.17;
    P.dashCd = 0.85;
    P.inv = Math.max(P.inv, 0.2);
    Sfx.dash();
    NS.fx.burst(P.x, 0.3, P.z, { color: ['#ffffff', '#d9d4c7'], n: 8, speed: 3, up: 2, size: 0.12 });
  }

  // 맞았을 때 얼마나 아픈가 (내 무기든 남의 무기든 같은 식)
  function calcHit(st, kind, step, tip) {
    let dmg = st.dmg, knock = st.knock, word = pick(WORDS[st.type] || WORDS.blade), crit = false;
    if (st.type === 'blade' && step === 2) { dmg *= 1.3; knock *= 1.4; word = '휘리릭!'; }
    if (st.type === 'whip' && tip > 0.75) { dmg *= 2.2; knock *= 1.5; crit = true; word = '짝!!'; }
    if (st.type === 'hammer' && kind !== 'slam') dmg *= 0.6;
    if (st.ink === 'ink') dmg *= 1.15;
    return { dmg: clamp(dmg, 2, 40), knock: clamp(knock, 1, 18), word, crit, ink: st.ink };
  }

  // 무기 판정점 중 (x, z) 둘레에 닿은 점 (끝에 가까운 점을 고른다)
  function touching(pts, x, z, r) {
    let best = null;
    for (const q of pts) {
      if (q.y > 2.4) continue;
      if ((q.x - x) * (q.x - x) + (q.z - z) * (q.z - z) < r * r && (!best || q.tip > best.tip)) best = q;
    }
    return best;
  }
  // 프레임 사이 자세도 나눠 본다 (빠른 휘두르기가 건너뛰지 않게)
  function sweep(rig, type, step, k0, k1, fn) {
    const p0 = NS.pose(type, step, k0), p1 = NS.pose(type, step, k1);
    const n = clamp(Math.ceil(Math.abs(p1.yaw - p0.yaw) / 0.2 + Math.abs(p1.fwd - p0.fwd) / 0.3 + Math.abs(p1.pitch - p0.pitch) / 0.3), 1, 8);
    for (let i = 1; i <= n; i++) {
      const pp = i === n ? p1 : NS.pose(type, step, k0 + ((k1 - k0) * i) / n);
      if (!pp.active) continue;
      NS.setPose(rig, pp);
      fn(NS.rigPoints(rig));
    }
    NS.setPose(rig, p1);
  }

  function updateMyAttack(dt) {
    const a = P.atk, st = ME.w.stats;
    const k0 = a.t / a.dur;
    a.t += dt;
    const k = Math.min(1, a.t / a.dur);
    const p = NS.pose(st.type, a.step, k);
    if (p.active && !a.swung) { a.swung = true; Sfx.swing(st.mass); }
    if (p.active || NS.pose(st.type, a.step, k0).active) {
      sweep(myRig, st.type, a.step, k0, k, (pts) => {
        for (const d of dummies) {
          if (d.dead || a.hit.has(d)) continue;
          const q = touching(pts, d.x, d.z, BODY_R + 0.15);
          if (q) { a.hit.add(d); hitDummy(d, calcHit(st, 'swing', a.step, q.tip), q); }
        }
        if (!pvpOn()) return;
        for (const R of remotes.values()) {
          if (a.hit.has(R.id) || !remoteInFight(R) || R.st !== 'alive') continue;
          const q = touching(pts, R.x, R.z, BODY_R + 0.15);
          if (q) { a.hit.add(R.id); hitSpark(q, st); }
        }
      });
    } else NS.setPose(myRig, p);
    if (st.type === 'hammer' && !a.impacted && k >= NS.HAMMER_IMPACT) {
      a.impacted = true;
      const c = NS.hammerCenter(P.x, P.z, P.face, st), R = NS.slamRadius(st);
      slamFx(c, R, st);
      for (const d of dummies) if (!d.dead && Math.hypot(d.x - c.x, d.z - c.z) < R + BODY_R) hitDummy(d, calcHit(st, 'slam', 0, 1), { x: d.x, y: 1, z: d.z }, c);
    }
    if (k >= 1) { P.atk = null; P.lastAtkEnd = G.time; P.comboStep = a.step; }
  }

  function slamFx(c, R, st) {
    NS.fx.ring(c.x, c.z, R, NS.INKS[st.ink].color, 0.35);
    NS.fx.burst(c.x, 0.2, c.z, { color: [NS.INKS[st.ink].fill, '#ffffff', PAL.ink], n: 18, speed: 7, up: 7, size: 0.16 });
    NS.fx.splat(c.x, c.z, NS.INKS[st.ink].color, R * 0.5);
    NS.fx.shake(0.35);
    Sfx.slam(st.mass);
  }
  function hitSpark(q, st) {
    NS.fx.burst(q.x, Math.max(0.6, q.y), q.z, { color: [NS.INKS[st.ink].color, '#ffffff', PAL.yellow], n: 8, speed: 5, up: 4, size: 0.12 });
    Sfx.hit(st.mass, false);
    G.hitstop = Math.max(G.hitstop, 0.05);
  }

  /* ---------- 허수아비 (혼자일 때 연습 상대) ---------- */
  function spawnDummy() {
    const rig = NS.makeRig('#9aa2ad', { bodyColor: '#f3e3c3' });
    scene.add(rig.root);
    const a = Math.random() * TAU, r = rnd(5, 10);
    const d = { rig, x: clamp(P.x + Math.cos(a) * r, -18, 18), z: clamp(P.z + Math.sin(a) * r, -18, 18), kx: 0, kz: 0, face: Math.random() * TAU, hp: 50, dead: false, tx: 0, tz: 0, wT: 0, flash: 0 };
    d.tag = makeTag('허수아비');
    d.tag.classList.add('dummy');
    NS.fx.ring(d.x, d.z, 1.5, '#9aa2ad', 0.4);
    dummies.push(d);
  }
  function removeDummy(d) { NS.disposeRig(d.rig); d.tag.remove(); }
  function clearDummies() { for (const d of dummies) removeDummy(d); dummies.length = 0; }
  function hitDummy(d, h, q, from) {
    d.hp -= h.dmg;
    const f = from || { x: P.x, z: P.z };
    const dx = d.x - f.x, dz = d.z - f.z, L = Math.hypot(dx, dz) || 1;
    d.kx += (dx / L) * h.knock; d.kz += (dz / L) * h.knock;
    d.flash = 0.12;
    NS.fx.popup(h.word, d.x, 2.6, d.z, { color: h.crit ? PAL.red : PAL.ink, size: h.crit ? 1.4 : 1 });
    NS.fx.popup('-' + Math.round(h.dmg), d.x + 0.6, 1.8, d.z, { color: PAL.red, size: 0.9 });
    NS.fx.burst(q.x, Math.max(0.6, q.y), q.z, { color: [NS.INKS[h.ink].color, '#ffffff'], n: 8, speed: 5, up: 4, size: 0.12 });
    Sfx.hit(ME.w.stats.mass, h.crit);
    G.hitstop = Math.max(G.hitstop, h.crit ? 0.09 : 0.05);
    NS.fx.shake(h.crit ? 0.25 : 0.12);
    if (d.hp <= 0) {
      d.dead = true;
      NS.fx.burst(d.x, 1, d.z, { color: ['#f3e3c3', '#ffffff', PAL.ink], n: 24, speed: 8, up: 8, size: 0.18 });
      NS.fx.popup('펑!', d.x, 2.8, d.z, { size: 1.8 });
      Sfx.pop();
      removeDummy(d);
      dummies.splice(dummies.indexOf(d), 1);
    }
  }
  let dummyT = 0;
  function updateDummies(dt) {
    const want = G.mode === 'play' && G.phase.ph === 'wait' && !G.watch && ![...remotes.values()].some((R) => !R.stale);
    if (!want) { if (dummies.length) clearDummies(); return; }
    dummyT -= dt;
    if (dummies.length < 3 && dummyT <= 0) { spawnDummy(); dummyT = 1.4; }
    for (const d of dummies) {
      d.wT -= dt;
      if (d.wT <= 0) { d.wT = rnd(1.5, 3.5); d.tx = clamp(d.x + rnd(-4, 4), -18, 18); d.tz = clamp(d.z + rnd(-4, 4), -18, 18); }
      const dx = d.tx - d.x, dz = d.tz - d.z, L = Math.hypot(dx, dz);
      const moving = L > 0.3;
      if (moving) { d.x += (dx / L) * 1.3 * dt; d.z += (dz / L) * 1.3 * dt; d.face += angDiff(d.face, Math.atan2(dx, dz)) * Math.min(1, dt * 4); }
      d.x += d.kx * dt; d.z += d.kz * dt;
      const decay = Math.exp(-dt * 6);
      d.kx *= decay; d.kz *= decay;
      d.x = clamp(d.x, -NS.ARENA, NS.ARENA); d.z = clamp(d.z, -NS.ARENA, NS.ARENA);
      d.flash -= dt;
      d.rig.bodyMat.emissive.setScalar(d.flash > 0 ? 0.6 : 0);
      d.rig.root.position.set(d.x + (d.flash > 0 ? rnd(-0.08, 0.08) : 0), 0, d.z);
      d.rig.root.rotation.y = d.face;
      NS.animateBody(d.rig, dt, moving, G.time);
      placeTag(d.tag, d.x, 2.2, d.z, (d.hp / 50) * 100, true);
    }
  }

  /* ---------- 땅에 그리기: 벽, 가시밭, 회복 원 ---------- */
  const unitBox = new T.BoxGeometry(1, 1, 1);
  const coneGeo = new T.ConeGeometry(0.2, 0.62, 6);
  const plusGeo = new T.BoxGeometry(0.34, 0.1, 0.1);
  const dotGeo = new T.CylinderGeometry(0.13, 0.13, 0.04, 10);
  const previewDots = [];

  function structMesh(kind, pts, color) {
    const g = new T.Group();
    if (kind === 'heal') {
      const c = pts[0], e = pts[pts.length - 1];
      const r = clamp(Math.hypot(e.x - c.x, e.z - c.z), 1, 3);
      const ring = new T.Mesh(new T.TorusGeometry(r, 0.09, 8, 48), NS.toon(PAL.green));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(c.x, 0.09, c.z);
      ring.userData.own = true;
      g.add(ring);
      const disc = new T.Mesh(new T.CircleGeometry(r, 40), new T.MeshBasicMaterial({ color: '#8fd88a', transparent: true, opacity: 0.3, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(c.x, 0.03, c.z);
      disc.userData.own = true;
      disc.userData.ownMat = true;
      g.add(disc);
      const spin = new T.Group();
      spin.position.set(c.x, 0.9, c.z);
      for (let i = 0; i < 3; i++) {
        const p = new T.Group();
        const a = new T.Mesh(plusGeo, NS.toon(PAL.green)), b = new T.Mesh(plusGeo, NS.toon(PAL.green));
        b.rotation.z = Math.PI / 2;
        p.add(a, b);
        const ang = (i / 3) * TAU;
        p.position.set(Math.cos(ang) * r * 0.6, 0, Math.sin(ang) * r * 0.6);
        spin.add(p);
      }
      g.add(spin);
      g.userData.spin = spin;
      return g;
    }
    if (kind === 'wall') {
      const bodyMat = NS.toon('#3b3f46'), capMat = NS.toon(color);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        if (L < 0.05) continue;
        const ang = -Math.atan2(b.z - a.z, b.x - a.x);
        const m = new T.Mesh(unitBox, bodyMat);
        m.scale.set(L + 0.3, 1.25, 0.34);
        m.position.set((a.x + b.x) / 2, 0.62, (a.z + b.z) / 2);
        m.rotation.y = ang;
        m.castShadow = true;
        g.add(m);
        const cap = new T.Mesh(unitBox, capMat);
        cap.scale.set(L + 0.3, 0.14, 0.4);
        cap.position.set((a.x + b.x) / 2, 1.3, (a.z + b.z) / 2);
        cap.rotation.y = ang;
        g.add(cap);
      }
      return g;
    }
    // 가시밭
    const coneMat = NS.toon(color), baseMat = NS.toon('#3b3f46');
    const r = NS.resample(pts.map((p) => ({ x: p.x, y: p.z })), 0.55);
    for (const p of r) {
      const m = new T.Mesh(coneGeo, coneMat);
      m.position.set(p.x + rnd(-0.08, 0.08), 0.31, p.y + rnd(-0.08, 0.08));
      m.castShadow = true;
      g.add(m);
    }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      const m = new T.Mesh(unitBox, baseMat);
      m.scale.set(L + 0.2, 0.08, 0.5);
      m.position.set((a.x + b.x) / 2, 0.04, (a.z + b.z) / 2);
      m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      g.add(m);
    }
    return g;
  }

  function makeStruct(owner, id, kind, pts, color) {
    const s = { key: owner + ':' + id, owner, id, kind, pts, born: G.time, life: NS.GROUND[kind].life, color, segs: [], dead: false };
    for (let i = 1; i < pts.length; i++) s.segs.push({ ax: pts[i - 1].x, az: pts[i - 1].z, bx: pts[i].x, bz: pts[i].z });
    if (kind === 'heal') {
      s.c = { x: pts[0].x, z: pts[0].z };
      const e = pts[pts.length - 1];
      s.r = clamp(Math.hypot(e.x - s.c.x, e.z - s.c.z), 1, 3);
    } else {
      const c = NS.centroid(pts.map((p) => ({ x: p.x, y: p.z })));
      s.c = { x: c.x, z: c.y };
    }
    s.g = structMesh(kind, pts, color);
    s.g.scale.y = 0.01;
    scene.add(s.g);
    return s;
  }
  function removeStruct(s, fx) {
    if (s.dead) return;
    s.dead = true;
    scene.remove(s.g);
    s.g.traverse((o) => {
      if (o.userData.own && o.geometry) o.geometry.dispose();
      if (o.userData.ownMat && o.material) o.material.dispose();
    });
    if (fx) NS.fx.burst(s.c.x, 0.5, s.c.z, { color: ['#ffffff', PAL.eraser, s.color], n: 10, speed: 4, up: 4, size: 0.12 });
  }
  const encGround = (pts) => NS.encStrokes([pts.map((p) => ({ x: p.x, y: p.z }))], 60, 32, 0.5, 700);
  const decGround = (s) => {
    const d = NS.decStrokes(s, 60, 32, 700);
    return d ? d[0].slice(0, 80).map((p) => ({ x: clamp(p.x, -NS.ARENA - 2, NS.ARENA + 2), z: clamp(p.y, -NS.ARENA - 2, NS.ARENA + 2) })) : null;
  };
  const KIND_CH = { wall: 'w', spike: 's', heal: 'h' }, CH_KIND = { w: 'wall', s: 'spike', h: 'heal' };
  const myGs = () => P.structs.filter((s) => !s.dead).map((s) => `${s.id}~${KIND_CH[s.kind]}~${s.enc}`).join('|');

  function beginGroundDraw() {
    if (!canAct() || G.gdraw) return;
    if (P.ink < 8) { banner('잉크가 모자라요', '잠깐 기다리면 다시 차요', 900); Sfx.block(); return; }
    G.gdraw = { pts: [] };
    addGroundPoint();
  }
  function addGroundPoint() {
    const g = G.gdraw;
    const q = NS.screenToGround(mouse.sx, mouse.sy);
    if (!g || !q) return;
    if (Math.hypot(q.x - P.x, q.z - P.z) > DRAW_RANGE) return;
    q.x = clamp(q.x, -NS.ARENA, NS.ARENA);
    q.z = clamp(q.z, -NS.ARENA, NS.ARENA);
    const last = g.pts[g.pts.length - 1];
    if (last) {
      const d = Math.hypot(q.x - last.x, q.z - last.z);
      if (d < 0.25) return;
      if (P.ink < d * INK_COST || g.pts.length >= 70) return;
      P.ink -= d * INK_COST;
      if (Math.random() < 0.3) Sfx.scribble();
    }
    g.pts.push({ x: q.x, z: q.z });
    let dot = previewDots[g.pts.length - 1];
    if (!dot) { dot = new T.Mesh(dotGeo, NS.toon(PAL.ink)); previewDots.push(dot); }
    dot.material = NS.toon(save.color);
    dot.position.set(q.x, 0.06, q.z);
    scene.add(dot);
  }
  function stopPreview() { for (const d of previewDots) scene.remove(d); }
  function endGroundDraw() {
    const g = G.gdraw;
    if (!g) return;
    G.gdraw = null;
    stopPreview();
    if (!canAct()) return;
    const res = NS.analyzeGround(g.pts.map((p) => ({ x: p.x, y: p.z })));
    if (!res) return;
    const enc = encGround(res.pts.map((p) => ({ x: p.x, z: p.y })));
    const pts = decGround(enc);
    if (!pts || pts.length < 2) return;
    P.sid = (P.sid + 1) % 1000;
    const s = makeStruct(myId(), P.sid.toString(36), res.kind, pts, save.color);
    s.enc = enc;
    P.structs.push(s);
    while (P.structs.filter((x) => !x.dead).length > MAX_STRUCTS) removeStruct(P.structs.find((x) => !x.dead), true);
    P.structs = P.structs.filter((x) => !x.dead);
    NS.fx.popup(NS.GROUND[res.kind].name + '!', s.c.x, 1.8, s.c.z, { color: res.kind === 'heal' ? PAL.green : PAL.ink, size: 1.1 });
    Sfx.build();
  }
  function clearMyStructs() { for (const s of P.structs) removeStruct(s, false); P.structs = []; }

  function allStructs() {
    const out = P.structs.slice();
    for (const R of remotes.values()) if (!R.stale) for (const s of R.structs.values()) if (!s.dead) out.push(s);
    return out;
  }
  function updateStructs(dt) {
    const zr = NS.zone.r;
    const tick = (s) => {
      const age = G.time - s.born, left = s.life - age;
      const grow = Math.min(1, age / 0.25), fade = Math.min(1, left / 0.6);
      const k = Math.max(0.01, Math.min(grow, fade));
      if (s.kind === 'heal') s.g.scale.set(1, 1, 1), s.g.children.forEach((o) => { if (o !== s.g.userData.spin) o.scale.setScalar(k); });
      else s.g.scale.y = k;
      if (s.g.userData.spin) { s.g.userData.spin.rotation.y += dt * 1.5; s.g.userData.spin.position.y = 0.9 + Math.sin(G.time * 3) * 0.15; s.g.userData.spin.visible = k > 0.5; }
      const erased = zr < 40 && Math.hypot(s.c.x, s.c.z) > zr + 0.5;
      return left <= 0 || erased;
    };
    for (const s of P.structs) if (!s.dead && tick(s)) removeStruct(s, true);
    P.structs = P.structs.filter((s) => !s.dead);
    for (const R of remotes.values()) for (const s of R.structs.values()) {
      if (s.dead) continue;
      s.g.visible = !R.stale;
      if (tick(s)) removeStruct(s, true);
    }
  }
  function pushOutOfWalls(o, r) {
    for (const s of allStructs()) {
      if (s.kind !== 'wall' || G.time - s.born < 0.15) continue;
      for (const g of s.segs) {
        const c = NS.closestOnSeg(o.x, o.z, g.ax, g.az, g.bx, g.bz);
        let dx = o.x - c.x, dz = o.z - c.y;
        const d = Math.hypot(dx, dz), need = r + 0.17;
        if (d >= need) continue;
        if (d < 1e-4) { dx = -(g.bz - g.az); dz = g.bx - g.ax; }
        const L = Math.hypot(dx, dz) || 1;
        o.x = c.x + (dx / L) * need;
        o.z = c.y + (dz / L) * need;
      }
    }
  }
  function wallBetween(ax, az, bx, bz) {
    for (const s of allStructs()) {
      if (s.kind !== 'wall' || G.time - s.born < 0.15) continue;
      for (const g of s.segs) if (NS.segCross(ax, az, bx, bz, g.ax, g.az, g.bx, g.bz)) return true;
    }
    return false;
  }

  /* ---------- 내가 맞음, 쓰러짐 ---------- */
  function takeHit(h) {
    if (P.dead || P.inv > 0 || G.watch) return false;
    P.hp -= h.dmg;
    const dx = P.x - h.from.x, dz = P.z - h.from.z, L = Math.hypot(dx, dz) || 1;
    P.kx += (dx / L) * h.knock;
    P.kz += (dz / L) * h.knock;
    if (h.ink === 'fire') { P.burnT = 2; P.burnBy = h.by; }
    if (h.ink === 'water') P.slowT = Math.max(P.slowT, 1.5);
    if (h.ink === 'vine') P.rootT = Math.max(P.rootT, 0.6);
    if (h.by) { P.lastHitBy = h.by; P.lastHitAt = G.time; }
    P.inv = 0.1;
    P.flash = 0.12;
    G.hitstop = Math.max(G.hitstop, 0.06);
    NS.fx.shake(h.crit ? 0.5 : 0.3);
    NS.fx.popup(h.word, P.x, 2.7, P.z, { color: h.crit ? PAL.red : PAL.ink, size: h.crit ? 1.4 : 1 });
    NS.fx.popup('-' + Math.round(h.dmg), P.x + 0.6, 1.9, P.z, { color: PAL.red, size: 0.9 });
    NS.fx.burst(P.x, 1, P.z, { color: [save.color, '#ffffff'], n: 8, speed: 5, up: 4, size: 0.12 });
    Sfx.hit(1, h.crit);
    if (P.hp <= 0) die();
    publish(true);
    return true;
  }
  function hurt(amount, by) {
    if (P.dead || G.watch) return;
    P.hp -= amount;
    if (by) { P.lastHitBy = by; P.lastHitAt = G.time; }
    if (P.hp <= 0) die();
  }
  function nameOf(id) {
    if (!id) return null;
    if (id === myId()) return '나';
    const R = remotes.get(id);
    return R ? R.name : null;
  }
  function die() {
    if (P.dead) return;
    P.dead = true;
    P.hp = 0;
    P.atk = null;
    endGroundDraw();
    P.kb = P.lastHitBy && G.time - P.lastHitAt < 6 ? P.lastHitBy : null;
    NS.fx.burst(P.x, 1, P.z, { color: [save.color, '#ffffff', PAL.ink], n: 30, speed: 9, up: 9, size: 0.2 });
    NS.fx.splat(P.x, P.z, save.color, 1.3);
    NS.fx.popup('으악!', P.x, 2.6, P.z, { size: 1.8 });
    Sfx.pop();
    const by = nameOf(P.kb);
    feed(by ? `${by} → 나` : '나 · 지워짐');
    const practice = !pvpOn();
    $('dead').hidden = false;
    setText($('dead-by'), by ? `${by}에게 당했다` : NS.zone.r < 40 ? '지우개에 지워졌다' : '찢어졌다');
    setText($('dead-sub'), practice ? '곧 다시 태어나요' : '관전 중 · 클릭(또는 Tab)으로 다른 사람 보기');
    P.respawnAt = practice ? G.time + 2.5 : 0;
    publish(true);
  }
  function respawn(x, z) {
    const a = Math.random() * TAU;
    P.x = x != null ? x : Math.cos(a) * rnd(2, 8);
    P.z = z != null ? z : Math.sin(a) * rnd(2, 8);
    P.vx = P.vz = P.kx = P.kz = 0;
    P.hp = 100;
    P.dead = false;
    P.inv = 1.2;
    P.burnT = P.slowT = P.rootT = 0;
    P.lastHitBy = null;
    P.kb = null;
    P.atk = null;
    P.ink = INK_MAX;
    $('dead').hidden = true;
    NS.fx.ring(P.x, P.z, 2, save.color, 0.5);
  }

  /* ---------- 다른 사람 ---------- */
  function newRemote(id) {
    const R = {
      id, rig: NS.makeRig(PAL.blue), pr: null, name: '', color: '', x: 0, z: 0, tx: 0, tz: 0, vx: 0, vz: 0, face: 0, tf: 0,
      st: 'alive', hp: 100, atk: null, wKey: '', stats: null, hb: null, hbAt: performance.now(), stale: false,
      structs: new Map(), gsKey: '', fresh: true, rn: 0, wins: 0, kills: 0, flash: 0, deadSeen: false,
    };
    scene.add(R.rig.root);
    R.tag = makeTag('');
    return R;
  }
  function removeRemote(R) {
    for (const s of R.structs.values()) removeStruct(s, false);
    NS.disposeRig(R.rig);
    R.tag.remove();
  }
  const remoteInFight = (R) => G.phase.ph === 'fight' && R.rn === G.phase.rn && R.rn > 0;

  function applyPresence(R, pr) {
    R.pr = pr;
    const name = NS.cleanName(pr.n), color = NS.safeColor(pr.c);
    if (name !== R.name) { R.name = name; R.tag.querySelector('b').textContent = name; }
    if (color !== R.color) { R.color = color; R.rig.bandMat.color.set(color); R.tag.style.setProperty('--c', color); }
    const wi = NS.safeInk(pr.wi);
    const wKey = (typeof pr.w === 'string' ? pr.w : '') + '|' + wi;
    if (wKey !== R.wKey) {
      const strokes = NS.decStrokes(pr.w, 8, 0);
      const st = strokes && NS.analyzeWeapon(strokes, wi);
      if (st) { NS.setRigWeapon(R.rig, strokes, wi, st); R.stats = st; R.wKey = wKey; }
    }
    R.tx = num(pr.x, -30, 30, 0);
    R.tz = num(pr.z, -30, 30, 0);
    R.tf = num(pr.f, -100, 100, 0);
    R.vx = num(pr.vx, -30, 30, 0);
    R.vz = num(pr.vz, -30, 30, 0);
    R.rn = Math.floor(num(pr.rn, 0, 1e6, 0));
    R.wins = Math.floor(num(pr.wn, 0, 99999, 0));
    R.kills = Math.floor(num(pr.k, 0, 99999, 0));
    const hp = num(pr.hp, 0, 100, 100);
    if (!R.fresh && R.st === 'alive' && hp < R.hp - 0.5) {
      NS.fx.popup('-' + Math.round(R.hp - hp), R.x + 0.6, 2, R.z, { color: PAL.red, size: 0.9 });
      R.flash = 0.1;
    }
    R.hp = hp;
    if (pr.hb !== R.hb) { R.hb = pr.hb; R.hbAt = performance.now(); }
    const st = ['alive', 'dead', 'watch', 'draw'].includes(pr.st) ? pr.st : 'alive';
    if (st !== R.st) {
      if (st === 'dead' && R.st !== 'dead' && !R.fresh) remoteDied(R, typeof pr.kb === 'string' ? pr.kb.slice(0, 12) : null);
      if (st === 'alive') { R.x = R.tx; R.z = R.tz; }
      R.st = st;
    }
    if (R.fresh || Math.hypot(R.x - R.tx, R.z - R.tz) > 6) { R.x = R.tx; R.z = R.tz; R.face = R.tf; R.fresh = false; }
    // 공격 동작: [번호, 콤보 단계, 진행률]
    if (Array.isArray(pr.a) && R.stats && R.st === 'alive') {
      const seq = num(pr.a[0], 0, 1e6, 0), step = Math.floor(num(pr.a[1], 0, 2, 0)), k = num(pr.a[2], 0, 1, 0);
      if (!R.atk || R.atk.seq !== seq) {
        const dur = NS.atkDur(R.stats, step);
        R.atk = { seq, step, type: R.stats.type, t: k * dur, dur, hitMe: false, impacted: k >= NS.HAMMER_IMPACT, swung: false };
      } else if (Math.abs(k * R.atk.dur - R.atk.t) > 0.12) R.atk.t = k * R.atk.dur;
    }
    // 땅 그림
    const gs = typeof pr.gs === 'string' ? pr.gs.slice(0, 2400) : '';
    if (gs !== R.gsKey) {
      R.gsKey = gs;
      const seen = new Set();
      for (const part of gs ? gs.split('|').slice(0, MAX_STRUCTS) : []) {
        const [id, ch, enc] = part.split('~');
        const kind = CH_KIND[ch];
        if (!id || !kind || id.length > 4) continue;
        seen.add(id);
        if (R.structs.has(id)) continue;
        const pts = decGround(enc);
        if (pts && pts.length >= 2) R.structs.set(id, makeStruct(R.id, id, kind, pts, R.color));
      }
      for (const [id, s] of R.structs) if (!seen.has(id)) { removeStruct(s, true); R.structs.delete(id); }
    }
  }

  function remoteDied(R, kb) {
    NS.fx.burst(R.x, 1, R.z, { color: [R.color, '#ffffff', PAL.ink], n: 30, speed: 9, up: 9, size: 0.2 });
    NS.fx.splat(R.x, R.z, R.color, 1.3);
    NS.fx.popup('펑!', R.x, 2.6, R.z, { size: 1.8 });
    Sfx.pop();
    R.atk = null;
    const by = nameOf(kb);
    feed(by ? `${by} → ${R.name}` : `${R.name} · 지워짐`);
    if (kb && kb === myId() && G.myRn && R.rn === G.myRn) {
      ME.kills++;
      banner(`${R.name} 탈락!`, `이번 판 ${ME.kills}킬`, 1200);
      NS.fx.popup('처치!', R.x, 3.2, R.z, { color: PAL.red, size: 2 });
    }
  }

  function remoteHitsMe(R, kind, step, tip, from) {
    const st = R.stats;
    const h = calcHit(st, kind, step, tip);
    h.from = from;
    h.by = R.id;
    if (wallBetween(from.x, from.z, P.x, P.z)) {
      NS.fx.burst((from.x + P.x) / 2, 1, (from.z + P.z) / 2, { color: ['#3b3f46', '#ffffff'], n: 6, speed: 3, up: 3, size: 0.1 });
      Sfx.block();
      return;
    }
    // 방패: 공격하지 않을 때 앞에서 오는 공격을 막는다
    if (ME.w.stats.type === 'shield' && !P.atk) {
      const toA = Math.atan2(from.x - P.x, from.z - P.z);
      if (Math.abs(angDiff(P.face, toA)) < 1.1) {
        h.dmg *= 0.3; h.knock *= 0.4; h.word = '막음!'; h.crit = false; h.ink = null;
        Sfx.block();
      }
    }
    takeHit(h);
  }

  function simulateRemote(R, dt) {
    const rig = R.rig;
    const k = Math.min(1, dt * 14);
    R.x += (R.tx + R.vx * 0.05 - R.x) * k;
    R.z += (R.tz + R.vz * 0.05 - R.z) * k;
    R.face += angDiff(R.face, R.tf) * Math.min(1, dt * 16);
    const gone = R.stale || R.st === 'watch';
    const visible = !gone && (R.st === 'alive' || (R.st === 'draw' && Math.floor(G.time * 3) % 2 === 0));
    rig.root.visible = visible;
    R.flash -= dt;
    rig.bodyMat.emissive.setScalar(R.flash > 0 ? 0.6 : 0);
    rig.root.position.set(R.x + (R.flash > 0 ? rnd(-0.08, 0.08) : 0), 0, R.z);
    rig.root.rotation.y = R.face;
    NS.animateBody(rig, dt, Math.hypot(R.vx, R.vz) > 0.5, G.time + R.id.length);
    placeTag(R.tag, R.x, 2.3, R.z, R.hp, visible && R.st === 'alive');
    if (!R.stats || R.st !== 'alive' || gone) { R.atk = null; return; }
    const a = R.atk;
    if (!a) { NS.setPose(rig, NS.idlePose(R.stats.type)); return; }
    const k0 = a.t / a.dur;
    a.t += dt;
    const kk = Math.min(1, a.t / a.dur);
    const p = NS.pose(a.type, a.step, kk);
    const near = Math.hypot(R.x - P.x, R.z - P.z);
    if (p.active && !a.swung) { a.swung = true; if (near < 14) Sfx.swing(R.stats.mass); }
    const canHitMe = pvpOn() && remoteInFight(R) && !P.dead && near < 7;
    if (canHitMe && !a.hitMe && (p.active || NS.pose(a.type, a.step, k0).active)) {
      sweep(rig, a.type, a.step, k0, kk, (pts) => {
        if (a.hitMe) return;
        const q = touching(pts, P.x, P.z, BODY_R + 0.1);
        if (q) { a.hitMe = true; remoteHitsMe(R, 'swing', a.step, q.tip, { x: R.x, z: R.z }); }
      });
    } else NS.setPose(rig, p);
    if (a.type === 'hammer' && !a.impacted && kk >= NS.HAMMER_IMPACT) {
      a.impacted = true;
      const c = NS.hammerCenter(R.x, R.z, R.face, R.stats), rad = NS.slamRadius(R.stats);
      if (near < 18) slamFx(c, rad, R.stats);
      if (canHitMe && Math.hypot(P.x - c.x, P.z - c.z) < rad + BODY_R) remoteHitsMe(R, 'slam', 0, 1, c);
    }
    if (kk >= 1) R.atk = null;
  }

  function readNet() {
    const n = G.net;
    if (!n) return;
    const seen = new Set();
    const now = performance.now();
    for (const p of n.peers()) {
      if (p.me) continue;
      const pr = p.pr;
      if (!pr || pr.v !== 1) continue;
      seen.add(p.id);
      let R = remotes.get(p.id);
      if (!R) {
        R = newRemote(p.id);
        remotes.set(p.id, R);
        applyPresence(R, pr);
        banner(`${R.name} 입장!`, '', 1100);
        Sfx.ui();
      } else if (pr !== R.pr) applyPresence(R, pr);
    }
    for (const [id, R] of remotes) if (!seen.has(id)) { removeRemote(R); remotes.delete(id); }
    for (const R of remotes.values()) R.stale = now - R.hbAt > 2500;
  }

  /* ---------- 판 진행 ---------- */
  function readPhase() {
    let best = null;
    const now = performance.now();
    for (const p of G.net.peers()) {
      const dk = p.pr && p.pr.dk;
      if (p.me || !dk || typeof dk !== 'object' || now - p.last > 3000) continue;
      const ph = PH.includes(dk.ph) ? dk.ph : null;
      if (!ph) continue;
      const rn = Math.floor(num(dk.rn, 0, 1e6, 0));
      const score = rn * 10 + PH.indexOf(ph);
      if (best && score <= best.score) continue;
      best = {
        score, ph, rn,
        endAt: p.last + num(dk.left, 0, 600, 0) * 1000,
        fightAt: p.last - num(dk.zt, 0, 600, 0) * 1000,
        win: typeof dk.win === 'string' ? dk.win.slice(0, 12) : null,
        wn: dk.wn ? NS.cleanName(dk.wn) : null,
      };
    }
    return best;
  }

  // 방장만: 0.25초마다 판을 굴린다 (화면이 멈춰도 돌도록 타이머로)
  function deskTick() {
    const n = G.net;
    if (!n || G.mode !== 'play') return;
    if (!n.isDesk()) { if (G.D) { G.D = null; n.setPresence({ dk: null }); } return; }
    const now = performance.now();
    if (!G.D) {
      const f = G.phase;
      G.D = { ph: f.ph, rn: f.rn, endAt: f.endAt || now, fightAt: f.fightAt || now, win: f.win, wn: f.wn };
    }
    const D = G.D;
    const list = n.peers().filter((p) => p.pr && p.pr.v === 1 && (p.me || now - p.last < 3000));
    const count = list.length;
    const go = (ph, ms) => {
      D.ph = ph;
      if (ph === 'draw' || ph === 'wait') D.rn++;
      D.endAt = now + (ms || 0);
      D.win = D.wn = null;
      D.parts = null;
    };
    const finish = (w) => {
      D.ph = 'end';
      D.endAt = now + END_MS;
      D.win = w ? w.id : null;
      D.wn = w ? NS.cleanName(w.pr.n) : null;
    };
    if (D.ph === 'wait') { if (count >= 2) go('draw', DRAW_MS); }
    else if (D.ph === 'draw') {
      if (count < 2) go('wait');
      else if (now >= D.endAt) {
        go('fight', FIGHT_MS);
        D.fightAt = now;
        // 참가자는 난투가 시작된 순간 방에 있던 사람. 신호가 늦게 닿아도 빠지지 않게 명단으로 센다
        D.parts = list.filter((p) => p.pr.st !== 'watch').map((p) => p.id);
      }
    } else if (D.ph === 'fight') {
      const byId = new Map(list.map((p) => [p.id, p]));
      const ids = D.parts || list.filter((p) => p.pr.rn === D.rn).map((p) => p.id);
      const alive = ids.map((id) => byId.get(id)).filter((p) => {
        if (!p || p.pr.st === 'dead' || p.pr.st === 'watch') return false;
        return p.pr.rn === D.rn || now - D.fightAt < 10000;   // 10초 안에 난투에 안 들어오면 뺀다
      });
      if (now - D.fightAt > 1500 && alive.length <= 1) finish(alive[0]);
      else if (now >= D.endAt) finish(alive.sort((a, b) => num(b.pr.hp, 0, 100, 0) - num(a.pr.hp, 0, 100, 0))[0]);
    } else if (D.ph === 'end' && now >= D.endAt) go(count >= 2 ? 'draw' : 'wait', count >= 2 ? DRAW_MS : 0);
    const r1 = (v) => Math.round(v * 10) / 10;
    n.setPresence({ dk: { ph: D.ph, rn: D.rn, left: r1(Math.max(0, (D.endAt - now) / 1000)), zt: D.ph === 'fight' ? r1((now - D.fightAt) / 1000) : 0, win: D.win || null, wn: D.wn || null } });
  }
  setInterval(deskTick, 250);

  function phaseUpdate() {
    if (!G.net) return;
    if (G.net.isDesk() && G.D) G.phase = { ph: G.D.ph, rn: G.D.rn, endAt: G.D.endAt, fightAt: G.D.fightAt, win: G.D.win, wn: G.D.wn };
    else { const b = readPhase(); if (b) G.phase = b; }
    const key = G.phase.ph + ':' + G.phase.rn;
    if (key !== G.phaseKey) { G.phaseKey = key; onPhase(G.phase.ph); }
    if (G.phase.ph === 'draw' && G.sketchByPhase) NS.Sketch.setDeadline(G.phase.endAt);
  }

  function onPhase(ph) {
    const now = performance.now();
    if (ph !== 'fight') G.zoneWarned = false;
    if (ph === 'wait') {
      G.myRn = 0;
      G.watch = false;
      if (G.sketchByPhase) NS.Sketch.close(true);
      if (P.dead) respawn();
      banner('연습 중', '친구가 들어오면 판이 시작돼요', 1800);
    } else if (ph === 'draw') {
      clearDummies();
      clearMyStructs();
      G.myRn = 0;
      G.watch = false;
      ME.kills = 0;
      if (P.dead) respawn();
      P.hp = 100;
      P.atk = null;
      openPhaseSketch();
      banner('무기를 그려라!', '시간이 끝나면 난투가 시작돼요', 1800);
      Sfx.ui();
    } else if (ph === 'fight') {
      clearDummies();
      if ((now - G.phase.fightAt) / 1000 < 9) joinFight();
      else {
        G.watch = true;
        G.myRn = 0;
        if (G.sketchByPhase) NS.Sketch.close(true);
        banner('관전 중', '이번 판이 끝나면 참가해요', 2200);
      }
    } else if (ph === 'end') {
      P.atk = null;
      endGroundDraw();
      const w = G.phase.win;
      if (w && w === myId() && G.myRn) {
        save.wins++;
        persist();
        banner('내가 우승!', '마지막까지 살아남았다', 3200);
        Sfx.win();
        for (let i = 0; i < 4; i++) NS.fx.burst(P.x + rnd(-2, 2), 3, P.z + rnd(-2, 2), { color: [PAL.red, PAL.yellow, PAL.blue, PAL.green, '#ffffff'], n: 16, speed: 7, up: 10, size: 0.16 });
      } else if (w) {
        banner(`${G.phase.wn || '누군가'} 우승!`, G.myRn ? '다음 판에 다시 도전!' : '', 3000);
        if (G.myRn) Sfx.lose();
      } else banner('무승부!', '', 2500);
    }
  }

  function openPhaseSketch() {
    G.sketchByPhase = true;
    mouse.down = false;
    NS.Sketch.open({
      strokes: ME.w.strokes, ink: ME.w.ink, deadline: G.phase.endAt,
      onDone: (r) => { G.sketchByPhase = false; if (r) setMyWeapon(r.strokes, r.ink); publish(true); },
    });
  }
  function openSketchManual() {
    if (NS.Sketch.isOpen()) return;
    const ph = G.phase.ph;
    if (G.mode === 'play' && ph === 'fight' && !P.dead && !G.watch) { banner('난투 중에는 못 바꿔요', '쓰러지거나 판이 끝나면 다시 그릴 수 있어요', 1400); return; }
    if (G.mode === 'play' && ph === 'draw') { openPhaseSketch(); return; }
    mouse.down = false;
    NS.Sketch.open({ strokes: ME.w.strokes, ink: ME.w.ink, onDone: (r) => { if (r) setMyWeapon(r.strokes, r.ink); publish(true); } });
  }

  function joinFight() {
    G.myRn = G.phase.rn;
    G.watch = false;
    if (NS.Sketch.isOpen()) NS.Sketch.close(true);
    // 자리: 참가자 주소 순서대로 원 둘레에 나눠 선다
    const ids = [myId()].concat([...remotes.values()].filter((R) => !R.stale).map((R) => R.id)).sort();
    const i = ids.indexOf(myId()), a = (i / ids.length) * TAU + G.phase.rn * 0.7;
    respawn(Math.cos(a) * 12, Math.sin(a) * 12);
    P.inv = 1.5;
    P.face = Math.atan2(-P.x, -P.z);
    banner('난투 시작!', '마지막까지 살아남아라', 1600);
    Sfx.go();
    publish(true);
  }

  function zoneRadius() {
    if (G.phase.ph !== 'fight') return 99;
    const zt = (performance.now() - G.phase.fightAt) / 1000;
    return zt < ZONE_START ? 30 : Math.max(3, 30 - (zt - ZONE_START) * ZONE_SPEED);
  }

  /* ---------- 관전 ---------- */
  const spectating = () => G.mode === 'play' && G.phase.ph === 'fight' && (P.dead || G.watch);
  function aliveRemotes() { return [...remotes.values()].filter((R) => !R.stale && R.st === 'alive' && remoteInFight(R)); }
  function cycleSpec() {
    const list = aliveRemotes();
    if (!list.length) return;
    const i = list.findIndex((R) => R.id === G.spec);
    G.spec = list[(i + 1) % list.length].id;
    Sfx.ui();
  }

  /* ---------- 내 상태 보내기 ---------- */
  function myStatus() {
    if (NS.Sketch.isOpen()) return 'draw';
    if (G.watch) return 'watch';
    return P.dead ? 'dead' : 'alive';
  }
  function publish(force) {
    const n = G.net;
    if (!n || G.mode !== 'play') return;
    const now = performance.now();
    if (!force && now - G.pubT < 40) return;
    G.pubT = now;
    const r2 = (v) => Math.round(v * 100) / 100;
    const a = P.atk && !P.dead ? [P.atk.seq, P.atk.step, r2(Math.min(1, P.atk.t / P.atk.dur))] : null;
    G.hb = (G.hb + 1) % 1000;
    n.setPresence({
      v: 1, n: save.name || '낙서', c: save.color, w: ME.w.enc, wi: ME.w.ink, st: myStatus(),
      x: r2(P.x), z: r2(P.z), f: r2(P.face), vx: r2(P.vx + P.kx), vz: r2(P.vz + P.kz),
      hp: Math.max(0, Math.round(P.hp)), a, kb: P.dead ? P.kb : null, rn: G.myRn, k: ME.kills, wn: save.wins, gs: myGs(), hb: G.hb,
    });
  }

  /* ---------- 나 움직이기 ---------- */
  function updateMe(dt) {
    const sdt = G.hitstop > 0 ? dt * 0.25 : dt;
    G.hitstop -= dt;
    const out = P.dead || G.watch;
    myRig.root.visible = !out;
    if (P.dead && P.respawnAt && G.time >= P.respawnAt) { P.respawnAt = 0; respawn(); }
    if (out) { if (G.gdraw) endGroundDraw(); return; }
    const sketching = NS.Sketch.isOpen();
    let ix = 0, iz = 0;
    if (!sketching) {
      if (keys.KeyW || keys.ArrowUp) iz -= 1;
      if (keys.KeyS || keys.ArrowDown) iz += 1;
      if (keys.KeyA || keys.ArrowLeft) ix -= 1;
      if (keys.KeyD || keys.ArrowRight) ix += 1;
      if (touch.on) { ix += touch.mx; iz += touch.mz; }
    }
    const il = Math.hypot(ix, iz);
    if (il > 1) { ix /= il; iz /= il; }
    // 조준
    let want = null;
    if (!sketching && !touch.on && mouse.has) {
      const q = NS.screenToGround(mouse.sx, mouse.sy);
      if (q && Math.hypot(q.x - P.x, q.z - P.z) > 0.3) want = Math.atan2(q.x - P.x, q.z - P.z);
    }
    if (touch.on && !sketching) {
      if (touch.atk) {
        // 터치로 공격할 때는 가장 가까운 상대를 저절로 겨눈다
        let best = null, bd = 7;
        for (const d of dummies) { const L = Math.hypot(d.x - P.x, d.z - P.z); if (L < bd) { bd = L; best = d; } }
        if (pvpOn()) for (const R of aliveRemotes()) { const L = Math.hypot(R.x - P.x, R.z - P.z); if (L < bd) { bd = L; best = R; } }
        if (best) want = Math.atan2(best.x - P.x, best.z - P.z);
        else if (il > 0.2) want = Math.atan2(ix, iz);
      } else if (il > 0.2) want = Math.atan2(ix, iz);
    }
    if (want != null) {
      const turn = P.atk ? 7 * dt : 99;
      P.face += clamp(angDiff(P.face, want), -turn, turn);
    }
    P.slowT -= dt; P.rootT -= dt; P.inv -= dt; P.dashCd -= dt;
    const st = ME.w.stats;
    let speed = 6.8 - 0.35 * st.mass;
    if (P.slowT > 0) speed *= 0.55;
    if (P.atk) speed *= P.atk.type === 'hammer' ? 0.35 : 0.6;
    if (P.rootT > 0) speed = 0;
    if (P.dashT > 0) { P.dashT -= dt; P.vx = P.dx * 19; P.vz = P.dz * 19; }
    else {
      const k = Math.min(1, dt * 14);
      P.vx = lerp(P.vx, ix * speed, k);
      P.vz = lerp(P.vz, iz * speed, k);
    }
    // 창과 방패는 공격하며 앞으로 뛰어든다
    if (P.atk && (st.type === 'spear' || st.type === 'shield') && P.rootT <= 0) {
      const kk = P.atk.t / P.atk.dur;
      const on = st.type === 'spear' ? kk > 0.28 && kk < 0.5 : kk > 0.2 && kk < 0.42;
      if (on) { P.vx = Math.sin(P.face) * 11; P.vz = Math.cos(P.face) * 11; }
    }
    P.x += (P.vx + P.kx) * dt;
    P.z += (P.vz + P.kz) * dt;
    const decay = Math.exp(-dt * 7);
    P.kx *= decay; P.kz *= decay;
    pushOutOfWalls(P, BODY_R);
    P.x = clamp(P.x, -NS.ARENA, NS.ARENA);
    P.z = clamp(P.z, -NS.ARENA, NS.ARENA);
    // 공격
    if (!sketching && (mouse.down || touch.atk) && !P.atk) tryAttack();
    myRig.root.position.set(P.x, 0, P.z);
    myRig.root.rotation.y = P.face;
    if (P.atk) updateMyAttack(sdt);
    else NS.setPose(myRig, NS.idlePose(st.type));
    P.flash -= dt;
    myRig.bodyMat.emissive.setScalar(P.flash > 0 ? 0.6 : P.inv > 0.3 && Math.floor(G.time * 10) % 2 ? 0.35 : 0);
    const moving = Math.hypot(P.vx, P.vz) > 0.5;
    NS.animateBody(myRig, sdt, moving, G.time);
    if (P.dashT > 0) myRig.bodyG.scale.set(1.1, 0.85, 1.1); else myRig.bodyG.scale.set(1, 1, 1);
    hazards(dt);
    if (G.gdraw) addGroundPoint();
    else P.ink = Math.min(INK_MAX, P.ink + INK_REGEN * dt);
  }

  function hazards(dt) {
    if (P.dead) return;
    if (P.burnT > 0) {
      P.burnT -= dt;
      hurt(4 * dt, P.burnBy);
      if (Math.random() < dt * 8) NS.fx.burst(P.x, 1.2, P.z, { color: [PAL.red, PAL.orange], n: 1, speed: 1, up: 3, size: 0.12 });
    }
    if (pvpOn()) {
      const d = Math.hypot(P.x, P.z);
      if (d > NS.zone.r) {
        const zt = (performance.now() - G.phase.fightAt) / 1000;
        hurt((6 + Math.max(0, zt - 80) * 0.3) * dt, null);
        if (Math.random() < dt * 3) NS.fx.popup('지워진다!', P.x, 2.4, P.z, { color: PAL.eraser, size: 0.8 });
      }
    }
    for (const s of allStructs()) {
      if (s.kind === 'spike') {
        if (s.owner === myId() || !pvpOn() || G.time - s.born < 0.25) continue;
        if ((P.spikeCd.get(s.key) || 0) > G.time) continue;
        for (const g of s.segs) {
          const c = NS.closestOnSeg(P.x, P.z, g.ax, g.az, g.bx, g.bz);
          if (Math.hypot(P.x - c.x, P.z - c.y) < BODY_R + 0.1) {
            P.spikeCd.set(s.key, G.time + 0.7);
            P.slowT = Math.max(P.slowT, 0.4);
            takeHit({ dmg: 8, knock: 3, from: { x: c.x, z: c.y }, by: s.owner, word: '따끔!', crit: false, ink: null });
            break;
          }
        }
      } else if (s.kind === 'heal' && Math.hypot(P.x - s.c.x, P.z - s.c.z) < s.r && P.hp < 100) {
        P.hp = Math.min(100, P.hp + 10 * dt);
        P.healPopT -= dt;
        if (P.healPopT <= 0) { P.healPopT = 0.5; NS.fx.popup('+', P.x + rnd(-0.5, 0.5), 2.2, P.z, { color: PAL.green, size: 1.1 }); }
      }
    }
    // 내 가시밭은 허수아비에게도 아프다
    for (const s of P.structs) {
      if (s.kind !== 'spike') continue;
      for (const d of dummies.slice()) {
        if ((d.spikeCd || 0) > G.time) continue;
        for (const g of s.segs) {
          const c = NS.closestOnSeg(d.x, d.z, g.ax, g.az, g.bx, g.bz);
          if (Math.hypot(d.x - c.x, d.z - c.y) < BODY_R + 0.1) { d.spikeCd = G.time + 0.7; hitDummy(d, { dmg: 8, knock: 3, word: '따끔!', crit: false, ink: 'ink' }, { x: d.x, y: 0.5, z: d.z }, { x: c.x, z: c.y }); break; }
        }
      }
    }
  }

  /* ---------- 화면 ---------- */
  function roomLabel(r) {
    const no = NS.Net.roomNo(r);
    return (NS.Net.roomBase(r) === 'plaza' ? '공개 방' : '친구 방') + (no > 1 ? ' ' + no : '');
  }
  function hud() {
    setText($('hp-n'), String(Math.max(0, Math.ceil(P.hp))));
    $('hp-fill').style.width = clamp(P.hp, 0, 100) + '%';
    $('hp-fill').className = P.hp > 50 ? '' : P.hp > 25 ? 'mid' : 'low';
    $('ink-fill').style.width = (P.ink / INK_MAX) * 100 + '%';
    const ph = G.phase.ph, now = performance.now();
    const left = Math.max(0, Math.ceil((G.phase.endAt - now) / 1000));
    const stt = G.net ? G.net.status() : 'offline';
    let title = '', sub = '', timer = '';
    if (ph === 'wait') {
      title = '연습 중';
      sub = stt === 'connecting' ? '방 찾는 중…' : stt === 'offline' || stt === 'unsupported' ? '온라인 연결 안 됨 · 혼자 연습' : '친구가 들어오면 판이 시작돼요';
    } else if (ph === 'draw') { title = '무기 그리기'; timer = left + '초'; sub = NS.Sketch.isOpen() ? '' : 'Q: 스케치북 다시 열기'; }
    else if (ph === 'fight') {
      const alive = aliveRemotes().length + (G.myRn === G.phase.rn && !P.dead && !G.watch ? 1 : 0);
      title = G.watch ? '관전 중' : P.dead ? '탈락 · 관전 중' : '난투!';
      const zt = (now - G.phase.fightAt) / 1000;
      sub = `남은 인원 ${alive}명 · ` + (zt < ZONE_START ? `지우개까지 ${Math.ceil(ZONE_START - zt)}초` : '지우개가 공책을 지우는 중!');
      if (!G.zoneWarned && zt >= ZONE_START - 0.5) { G.zoneWarned = true; banner('지우개가 몰려온다!', '가운데로 모여라', 1800); Sfx.erase(); }
    } else if (ph === 'end') { title = '판 끝'; timer = left + '초'; sub = '곧 다음 판'; }
    setText($('phase'), title);
    setText($('ptimer'), timer);
    setText($('phase-sub'), sub);
    const cnt = 1 + [...remotes.values()].filter((R) => !R.stale).length;
    setText($('room-label'), G.net ? `${roomLabel(G.net.room)} · ${cnt}/${NS.Net.MAX}명` : '');
    // 참가자 목록은 가끔만
    if (now - G.listT > 300) {
      G.listT = now;
      const rows = [{ id: myId(), name: (save.name || '낙서') + ' (나)', color: save.color, wins: save.wins, kills: ME.kills, st: myStatus(), me: true }];
      for (const R of remotes.values()) if (!R.stale) rows.push({ id: R.id, name: R.name, color: R.color, wins: R.wins, kills: R.kills, st: R.st });
      rows.sort((a, b) => b.wins - a.wins || b.kills - a.kills);
      const top = rows[0] && rows[0].wins > 0 ? rows[0].id : null;
      const icon = { dead: '💀', draw: '✏️', watch: '👀', alive: '' };
      const html = rows.map((r) => `<li class="${r.me ? 'me' : ''}"><i style="background:${r.color}"></i><span>${r.id === top ? '👑 ' : ''}${escapeHtml(r.name)}</span><em>${icon[r.st] || ''} ${r.wins}승 ${r.kills}킬</em></li>`).join('');
      if ($('plist').innerHTML !== html) $('plist').innerHTML = html;
      myRig.crown.visible = top === myId();
      for (const R of remotes.values()) R.rig.crown.visible = top === R.id;
    }
  }
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- 시작 화면 ---------- */
  function titleUI() {
    const nameIn = $('in-name');
    nameIn.value = save.name;
    nameIn.addEventListener('input', () => { save.name = NS.cleanName(nameIn.value) === '낙서' && !nameIn.value.trim() ? '' : NS.cleanName(nameIn.value); persist(); });
    const sw = $('swatches');
    for (const c of NS.BODY_COLORS) {
      const b = document.createElement('button');
      b.style.background = c;
      b.title = c;
      b.addEventListener('click', () => { save.color = c; persist(); myRig.bandMat.color.set(c); syncSw(); Sfx.ui(); });
      sw.appendChild(b);
    }
    function syncSw() { for (const b of sw.children) b.classList.toggle('on', b.title === save.color); }
    syncSw();
    const hashRoom = () => { try { return NS.Net.cleanRoom(decodeURIComponent(location.hash.slice(1))); } catch (e) { return ''; } };
    const syncRoomNote = () => {
      const r = hashRoom();
      const invited = r && r !== 'plaza';
      $('btn-play').textContent = invited ? '초대받은 방 입장' : '난투 입장';
      setText($('room-note'), invited ? `친구 방(${r})으로 들어가요. 공개 방은 주소 끝의 #…을 지우면 돼요.` : '링크만 열면 자동으로 빈자리가 있는 방에 들어가요.');
    };
    syncRoomNote();
    addEventListener('hashchange', () => { if (G.mode === 'title') syncRoomNote(); });
    $('btn-play').addEventListener('click', () => { Sfx.unlock(); enterPlay(hashRoom() || 'plaza'); });
    $('btn-friend').addEventListener('click', () => {
      Sfx.unlock();
      const r = NS.Net.newRoomName();
      history.replaceState(null, '', location.pathname + location.search + '#' + r);
      enterPlay(r);
      copyLink(true);
    });
    $('btn-weapon').addEventListener('click', () => { Sfx.unlock(); openSketchManual(); });
    $('btn-link').addEventListener('click', () => copyLink(false));
    $('btn-leave').addEventListener('click', leavePlay);
    $('btn-mute').addEventListener('click', toggleMute);
    $('btn-mute').textContent = save.muted ? '소리 켜기' : '소리 끄기';
    $('wcard').addEventListener('click', openSketchManual);
    if (touch.on) document.body.classList.add('touch');
  }
  function copyLink(fresh) {
    const url = location.href;
    const done = () => banner(fresh ? '친구 방을 만들었어요' : '링크를 복사했어요', '친구에게 링크를 보내 주세요 (최대 6명)', 2200);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => banner('주소창의 링크를 친구에게 보내 주세요', url, 3000));
    else banner('주소창의 링크를 친구에게 보내 주세요', url, 3000);
  }

  function enterPlay(room) {
    if (G.mode === 'play') return;
    G.mode = 'play';
    $('title').hidden = true;
    $('hud').hidden = false;
    $('touch').hidden = !touch.on;
    G.phase = { ph: 'wait', rn: 0, endAt: 0, fightAt: 0, win: null, wn: null };
    G.phaseKey = '';
    G.D = null;
    G.myRn = 0;
    G.watch = false;
    ME.kills = 0;
    respawn();
    G.net = NS.Net.join(room, {
      onMove: (r) => {
        if (NS.Net.roomBase(r) !== 'plaza') history.replaceState(null, '', location.pathname + location.search + '#' + r);
        banner(`${roomLabel(r)}에 들어왔어요`, '앞 방이 꽉 찼어요', 1800);
      },
    });
    publish(true);
  }
  function leavePlay() {
    if (G.net) G.net.leave();
    G.net = null;
    for (const R of remotes.values()) removeRemote(R);
    remotes.clear();
    clearDummies();
    clearMyStructs();
    endGroundDraw();
    if (NS.Sketch.isOpen()) NS.Sketch.close(false);
    G.mode = 'title';
    G.watch = false;
    $('hud').hidden = true;
    $('dead').hidden = true;
    $('title').hidden = false;
    respawn(0, 0);
    NS.zone.set(99, 0);
  }
  addEventListener('beforeunload', () => { if (G.net) G.net.leave(); });

  /* ---------- 반복 ---------- */
  function update(dt) {
    if (G.mode === 'title') {
      myRig.root.visible = true;
      P.face += dt * 0.6;
      myRig.root.position.set(0, 0, 0);
      myRig.root.rotation.y = P.face;
      NS.setPose(myRig, NS.idlePose(ME.w.stats.type));
      NS.animateBody(myRig, dt, false, G.time);
      NS.cam.follow(window.innerWidth > 760 ? -2.6 : 0, window.innerWidth > 760 ? -0.5 : 1.6, dt, 'title');
      return;
    }
    readNet();
    phaseUpdate();
    NS.zone.set(zoneRadius(), G.time);
    updateMe(dt);
    for (const R of remotes.values()) simulateRemote(R, dt);
    updateDummies(dt);
    updateStructs(dt);
    // 카메라: 관전 중이면 살아 있는 사람을 따라간다
    if (spectating()) {
      let R = remotes.get(G.spec);
      if (!R || R.st !== 'alive' || R.stale) { const list = aliveRemotes(); R = list[0]; G.spec = R ? R.id : null; }
      if (R) NS.cam.follow(R.x, R.z, dt, false);
      else NS.cam.follow(0, 0, dt, true);
      setText($('dead-sub'), R ? `관전 중: ${R.name} · 클릭(또는 Tab)으로 바꾸기` : '관전 중');
      if (G.watch) $('dead').hidden = true;
    } else NS.cam.follow(P.x, P.z, dt, false);
    hud();
    publish(false);
  }

  let last = performance.now(), lastFrame = 0;
  function frame(now) {
    // 탭이 가려져 1초에 한 번만 불려도 시간은 제대로 흐르게, 밀린 시간을 잘게 나눠 계산한다
    let total = Math.min(3, Math.max(0, (now - last) / 1000));
    last = now;
    lastFrame = now;
    do {
      const dt = Math.min(0.05, total);
      total -= dt;
      G.time += dt;
      update(dt);
      NS.fx.update(dt);
    } while (total > 0.001);
    NS.Sketch.update();
    NS.render();
  }
  function loop(now) { frame(now); requestAnimationFrame(loop); }
  // 탭이 가려져 requestAnimationFrame이 멈춰도, 상태는 계속 보내야 다른 사람 화면에서 안 사라진다
  setInterval(() => { const now = performance.now(); if (now - lastFrame > 150) frame(now); }, 100);

  /* ---------- 시작 ---------- */
  setMyWeapon(save.strokes, save.ink);
  titleUI();
  NS.cam.follow(window.innerWidth > 760 ? -2.6 : 0, window.innerWidth > 760 ? -0.5 : 1.6, 0, 'title');
  requestAnimationFrame(loop);
  // 테스트용 창구
  NS.debug = { G, P, ME, remotes, dummies, mouse, beginGroundDraw, endGroundDraw, allStructs, frame: (dt) => { last = performance.now() - (dt || 16); frame(performance.now()); }, enterPlay, leavePlay, setMyWeapon };
})();
