/* 낙서 서바이벌 — 혼자 모험: 스토리 4장, 적, 보스, 로그라이크 스티커
 *
 * 한 판(런) = 4장. 장마다 [방 1(웨이브 2) → 방 2(웨이브 3) → 보스].
 * 방을 깰 때마다 스티커 3장 중 하나를 골라 강해지고, 무기도 다시 그릴 수 있다.
 * 쓰러지면 처음부터(로그라이크). 모든 공격은 바닥에 빨간 예고를 먼저 보여 준다.
 */
(function () {
  'use strict';
  const NS = window.NS, T = window.THREE, PAL = NS.PAL, Sfx = NS.Sfx, $ = NS.$;
  const { clamp, lerp, rnd, pick, angDiff, TAU, easeOut, easeInOut } = NS;
  const C = () => NS.core;
  const scene = NS.scene;
  const A = 18.5;   // 적이 다니는 범위

  /* ---------- 기록 ---------- */
  const REC_KEY = 'nakseo-survival-solo-v1';
  let rec = { runs: 0, clears: 0, best: 0, bestTime: 0 };
  try { const r = JSON.parse(localStorage.getItem(REC_KEY) || 'null'); if (r && typeof r === 'object') rec = Object.assign(rec, r); } catch (e) { /* 무시 */ }
  const saveRec = () => { try { localStorage.setItem(REC_KEY, JSON.stringify(rec)); } catch (e) { /* 무시 */ } };

  /* ---------- 스티커(강화) ---------- */
  const BASE_MODS = { dmg: 1, crit: 0, knock: 1, atkSpd: 1, size: 1, speed: 1, dashCd: 1, inkRegen: 1, inkMax: 0, maxHp: 0, structLife: 1, structs: 0, heal: 1, lifesteal: 0, thorns: 0, dashHit: 0, revive: 0, magnet: 1 };
  const STICKERS = [
    { id: 'pen', icon: '🖊️', name: '굵은 펜', desc: '공격력 +20%', apply: (m) => { m.dmg *= 1.2; } },
    { id: 'ruler', icon: '📏', name: '긴 자', desc: '무기가 15% 커져요', max: 4, apply: (m) => { m.size *= 1.15; } },
    { id: 'feather', icon: '🪶', name: '가벼운 손', desc: '공격 속도 +15%', max: 4, apply: (m) => { m.atkSpd *= 1.15; } },
    { id: 'cover', icon: '📔', name: '튼튼한 표지', desc: '최대 체력 +25, 체력 25 회복', heal: 25, apply: (m) => { m.maxHp += 25; } },
    { id: 'bottle', icon: '🫙', name: '잉크병', desc: '잉크 최대 +40, 잉크 회복 +30%', max: 3, apply: (m) => { m.inkMax += 40; m.inkRegen *= 1.3; } },
    { id: 'star', icon: '⭐', name: '반짝 별', desc: '12% 확률로 피해 2배', max: 4, apply: (m) => { m.crit += 0.12; } },
    { id: 'juice', icon: '🧃', name: '잉크 흡수', desc: '적을 쓰러뜨리면 체력 +4', max: 3, apply: (m) => { m.lifesteal += 4; } },
    { id: 'shoes', icon: '👟', name: '날쌘 운동화', desc: '이동 +12%, 구르기 대기 -20%', max: 3, apply: (m) => { m.speed *= 1.12; m.dashCd *= 0.8; } },
    { id: 'bolt', icon: '⚡', name: '번개 구르기', desc: '구르다 닿은 적에게 피해 14', max: 3, apply: (m) => { m.dashHit += 14; } },
    { id: 'cactus', icon: '🌵', name: '가시 갑옷', desc: '맞으면 둘레 적에게 반격 12', max: 3, apply: (m) => { m.thorns += 12; } },
    { id: 'glue', icon: '🧴', name: '딱풀', desc: '땅 그림이 50% 오래가고, 1개 더 그려요', max: 2, apply: (m) => { m.structLife *= 1.5; m.structs += 1; } },
    { id: 'band', icon: '🩹', name: '반창고', desc: '회복 원 효과 2배', max: 2, apply: (m) => { m.heal *= 2; } },
    { id: 'fist', icon: '💥', name: '묵직한 손', desc: '밀쳐내기 +40%', max: 3, apply: (m) => { m.knock *= 1.4; } },
    { id: 'magnet', icon: '🧲', name: '자석', desc: '잉크 방울을 멀리서 끌어와요', max: 1, apply: (m) => { m.magnet = 3; } },
    { id: 'clover', icon: '🍀', name: '지우개 부적', desc: '쓰러지면 한 번, 체력 절반으로 일어나요', max: 1, rare: true, apply: (m) => { m.revive += 1; } },
  ];
  const REST = { id: 'rest', icon: '☕', name: '쉬는 시간', desc: '체력을 모두 회복해요', once: true };

  /* ---------- 적 ---------- */
  const MOBS = {
    bug: { name: '지우개 벌레', hp: 26, speed: 3.0, r: 0.55, dmg: 8, reach: 1.2, windup: 0.5, cd: 1.3, color: '#f28aa5', look: 'eraser', drop: 0.35 },
    crumb: { name: '지우개 가루', hp: 10, speed: 4.8, r: 0.38, dmg: 5, reach: 0.9, windup: 0.35, cd: 1.0, color: '#f6c4d1', look: 'crumb', drop: 0.15 },
    ruler: { name: '자 병사', hp: 40, speed: 2.3, r: 0.6, dmg: 13, charge: true, color: '#f2c230', look: 'ruler', drop: 0.45 },
    blob: { name: '번짐 방울', hp: 36, speed: 1.9, r: 0.7, dmg: 9, reach: 1.3, windup: 0.55, cd: 1.5, split: 'drop', color: '#6fa8ff', look: 'blob', drop: 0.4 },
    drop: { name: '작은 방울', hp: 12, speed: 3.4, r: 0.42, dmg: 5, reach: 1.0, windup: 0.35, cd: 1.0, color: '#9cc4ff', look: 'blob', drop: 0.1 },
    brush: { name: '물감 붓', hp: 24, speed: 2.5, r: 0.5, dmg: 9, ranged: true, keep: 7, fireCd: 2.6, color: '#8a5cd6', look: 'brush', drop: 0.45 },
    bottle: { name: '수정액 병', hp: 80, speed: 1.5, r: 0.85, dmg: 16, reach: 1.8, windup: 0.85, cd: 2.2, heavy: true, color: '#f4f4f4', look: 'bottle', drop: 0.7 },
  };
  const BOSSES = {
    eraser: { name: '말랑 지우개', hp: 600, r: 1.5, speed: 2.6, dmg: 16, color: '#f28aa5', look: 'bigEraser', summon: ['bug', 3], phases: [['slam', 'charge', 'summon'], ['slam2', 'charge', 'summon', 'slam']] },
    compass: { name: '컴퍼스 기사', hp: 850, r: 1.2, speed: 3.0, dmg: 15, color: '#9aa2ad', look: 'compass', summon: ['ruler', 2], phases: [['spin', 'fan', 'charge'], ['spin', 'fan', 'ring', 'charge', 'summon']] },
    paint: { name: '물감 괴물', hp: 1050, r: 1.7, speed: 2.0, dmg: 14, color: '#8a5cd6', look: 'paint', summon: ['drop', 4], phases: [['puddles', 'fan', 'summon'], ['puddles', 'ring', 'fan', 'summon', 'slam']] },
    king: { name: '지우개 대왕', hp: 1500, r: 1.8, speed: 2.6, dmg: 18, color: '#f28aa5', look: 'king', summon: ['bug', 3], phases: [['slam', 'charge', 'summon', 'fan'], ['slam', 'charge', 'ring', 'spin', 'summon'], ['slam2', 'charge', 'ring', 'spin', 'puddles']], at: [0.66, 0.33] },
  };

  /* ---------- 이야기 ---------- */
  const CHAPTERS = [
    {
      title: '1장 · 연습장', page: '#fbf8ef', bg: '#d8c7a4', boss: 'eraser',
      story: ['공책 나라에 <b>지우개 군단</b>이 쳐들어왔어요.', '연습장부터 하얗게 지워지고 있어요!', '내가 그린 무기로 공책을 지켜 주세요.'],
      tip: '빨간 원이 바닥에 보이면 곧 공격이 와요. Space로 굴러서 피하세요!',
      rooms: [[[['bug', 4]], [['bug', 5], ['crumb', 3]]], [[['bug', 4], ['crumb', 4]], [['bug', 5], ['ruler', 1]], [['crumb', 6], ['bug', 3]]]],
    },
    {
      title: '2장 · 수학 공책', page: '#eef4ff', bg: '#c9d3e6', boss: 'compass',
      story: ['모눈 칸이 삐뚤빼뚤해졌어요.', '<b>자 병사</b>들이 줄을 맞춰 돌진해 와요.', '맨 끝에서는 <b>컴퍼스 기사</b>가 빙글빙글 기다려요.'],
      tip: '자 병사는 빨간 줄이 보인 다음 곧게 달려와요. 옆으로 비키세요!',
      rooms: [[[['ruler', 2], ['bug', 4]], [['ruler', 3], ['crumb', 5]]], [[['bug', 5], ['ruler', 2]], [['brush', 2], ['bug', 4]], [['ruler', 4], ['crumb', 4]]]],
    },
    {
      title: '3장 · 미술 스케치북', page: '#fff7ea', bg: '#e3cfae', boss: 'paint',
      story: ['물감이 번져서 그림이 엉망이 됐어요.', '<b>물감 붓</b>은 멀리서 물감을 던져요.', '우클릭으로 <b>벽</b>을 그어 막아 보세요!'],
      tip: '벽은 물감 방울을 막아 줘요. 무기로 쳐서 튕겨 낼 수도 있어요.',
      rooms: [[[['blob', 3], ['brush', 2]], [['blob', 3], ['drop', 4], ['brush', 2]]], [[['brush', 3], ['bug', 4]], [['blob', 4], ['ruler', 2]], [['bottle', 1], ['brush', 3], ['blob', 2]]]],
    },
    {
      title: '4장 · 지우개 왕국', page: '#fff0f3', bg: '#e6c3cc', boss: 'king',
      story: ['드디어 지우개 왕국이에요.', '<b>지우개 대왕</b>이 공책 전체를 지우려고 해요.', '지금까지 모은 스티커의 힘을 모두 모아서!'],
      tip: '대왕이 힘이 빠지면 공책 가장자리를 지우기 시작해요. 가운데에 있으세요!',
      rooms: [[[['bottle', 1], ['bug', 5], ['crumb', 4]], [['ruler', 3], ['brush', 3], ['blob', 2]]], [[['bottle', 2], ['brush', 3]], [['ruler', 3], ['blob', 3], ['crumb', 5]], [['bottle', 2], ['ruler', 2], ['brush', 3], ['bug', 4]]]],
    },
  ];
  const ENDING = ['지우개 대왕이 말랑말랑 작아졌어요.', '"미안해… 나도 그림을 그려 보고 싶었어."', '이제 지우개는 틀린 곳만 살짝 지워 주기로 했어요.', '<b>공책 나라를 지켰어요!</b>'];

  /* ---------- 상태 ---------- */
  const S = {
    state: 'off', prev: null, ch: 0, room: 0, wave: 0, waves: null, waveT: 0,
    mobs: [], shots: [], teles: [], drops: [], puddles: [], spawnQ: [], pending: 0, boss: null,
    mods: Object.assign({}, BASE_MODS), stickers: {}, kills: 0, time: 0, zoneR: 99, zoneTarget: 99,
    clearT: 0, overT: 0, hpMul: 1, dmgMul: 1, dashSet: null, stickerKey: '',
  };
  const frozen = () => S.state === 'story' || S.state === 'reward' || S.state === 'pause' || S.state === 'result' || NS.Sketch.isOpen();

  /* ---------- 모양 만들기 ---------- */
  function mesh(geo, color, x, y, z, parent, outline) {
    const m = new T.Mesh(geo, NS.toon(color));
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true;
    if (outline !== false) NS.outline(m, 1.07);
    if (parent) parent.add(m);
    return m;
  }
  const eyeWhite = new T.SphereGeometry(1, 12, 10), browGeo = new T.BoxGeometry(1, 1, 1);
  function eyes(parent, y, z, spread, s, angry) {
    for (const sx of [-1, 1]) {
      const w = mesh(eyeWhite, '#ffffff', sx * spread, y, z, parent, false);
      w.scale.set(s, s * 1.15, s * 0.6);
      const p = new T.Mesh(eyeWhite, new T.MeshBasicMaterial({ color: PAL.ink }));
      p.position.set(sx * spread * 0.95, y - s * 0.1, z + s * 0.45);
      p.scale.set(s * 0.5, s * 0.6, s * 0.3);
      parent.add(p);
      if (angry) {
        const b = new T.Mesh(browGeo, new T.MeshBasicMaterial({ color: PAL.ink }));
        b.position.set(sx * spread, y + s * 1.25, z + s * 0.2);
        b.scale.set(s * 1.4, s * 0.28, s * 0.3);
        b.rotation.z = sx * -0.45;
        parent.add(b);
      }
    }
  }
  const LOOK_R = { eraser: 0.55, crumb: 0.38, ruler: 0.6, blob: 0.7, brush: 0.5, bottle: 0.85 };
  function buildLook(look, color, r) {
    const g = new T.Group(), b = new T.Group();
    g.add(b);
    g.userData.body = b;
    let top = 1.2;
    if (look === 'eraser') {
      mesh(new T.BoxGeometry(1.1, 0.62, 0.75), color, 0.12, 0.31, 0, b);
      mesh(new T.BoxGeometry(0.5, 0.66, 0.79), '#3a6bd1', -0.3, 0.31, 0, b);
      eyes(b, 0.42, 0.38, 0.2, 0.09, true);
      top = 1.1;
    } else if (look === 'crumb') {
      const m = mesh(new T.BoxGeometry(0.55, 0.42, 0.5), color, 0, 0.21, 0, b);
      m.rotation.set(rnd(-0.3, 0.3), rnd(0, 3), rnd(-0.3, 0.3));
      eyes(b, 0.3, 0.26, 0.12, 0.07, true);
      top = 0.9;
    } else if (look === 'ruler') {
      mesh(new T.BoxGeometry(0.34, 1.6, 0.18), color, 0, 0.8, 0, b);
      for (let i = 0; i < 6; i++) { const t = new T.Mesh(browGeo, new T.MeshBasicMaterial({ color: PAL.ink })); t.position.set(-0.1, 0.2 + i * 0.22, 0.1); t.scale.set(i % 2 ? 0.12 : 0.2, 0.03, 0.02); b.add(t); }
      eyes(b, 1.25, 0.1, 0.09, 0.07, true);
      top = 1.9;
    } else if (look === 'blob') {
      const m = mesh(new T.SphereGeometry(0.7, 20, 14), color, 0, 0.5, 0, b);
      m.scale.set(1, 0.75, 1);
      eyes(b, 0.62, 0.55, 0.2, 0.1, false);
      top = 1.3;
    } else if (look === 'brush') {
      const c = mesh(new T.ConeGeometry(0.3, 0.55, 12), color, 0, 0.28, 0, b);
      c.rotation.x = Math.PI;
      mesh(new T.CylinderGeometry(0.2, 0.26, 0.3, 12), '#b9c0c9', 0, 0.68, 0, b);
      mesh(new T.CylinderGeometry(0.12, 0.17, 1.0, 10), '#a0673a', 0, 1.3, 0, b);
      eyes(b, 0.7, 0.22, 0.1, 0.065, true);
      top = 2.0;
    } else if (look === 'bottle') {
      mesh(new T.CylinderGeometry(0.62, 0.7, 1.2, 16), color, 0, 0.6, 0, b);
      mesh(new T.CylinderGeometry(0.3, 0.32, 0.4, 12), '#2f6fd6', 0, 1.4, 0, b);
      const lab = new T.Mesh(new T.CylinderGeometry(0.71, 0.71, 0.35, 16, 1, true), NS.toon('#f2c230'));
      lab.position.y = 0.55;
      b.add(lab);
      eyes(b, 0.85, 0.6, 0.24, 0.1, true);
      top = 2.0;
    }
    const k = r / (LOOK_R[look] || r);
    g.scale.setScalar(k);
    g.userData.top = top * k;
    return g;
  }
  function buildBoss(look) {
    const g = new T.Group(), b = new T.Group();
    g.add(b);
    g.userData.body = b;
    if (look === 'bigEraser' || look === 'king') {
      mesh(new T.BoxGeometry(3.0, 1.7, 2.0), look === 'king' ? '#f7a3b8' : '#f28aa5', 0.3, 0.85, 0, b);
      mesh(new T.BoxGeometry(1.3, 1.78, 2.06), look === 'king' ? '#8a5cd6' : '#3a6bd1', -0.85, 0.85, 0, b);
      const lab = new T.Mesh(new T.BoxGeometry(0.9, 0.5, 2.1), NS.toon('#ffffff'));
      lab.position.set(-0.85, 0.9, 0);
      b.add(lab);
      eyes(b, 1.1, 1.0, 0.55, 0.2, true);
      g.userData.top = 2.6;
      if (look === 'king') {
        const cr = new T.Group();
        mesh(new T.CylinderGeometry(0.75, 0.8, 0.4, 12, 1, true), '#f2c230', 0, 0, 0, cr, false);
        for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; mesh(new T.ConeGeometry(0.16, 0.45, 6), '#f2c230', Math.cos(a) * 0.72, 0.4, Math.sin(a) * 0.72, cr, false); }
        mesh(new T.SphereGeometry(0.14, 8, 6), '#e0452b', 0, 0.1, 0.8, cr, false);
        cr.position.set(0.3, 1.95, 0);
        b.add(cr);
        const cape = new T.Mesh(new T.PlaneGeometry(2.8, 1.6), new T.MeshToonMaterial({ color: '#c0392b', side: T.DoubleSide }));
        cape.position.set(0.2, 0.9, -1.1);
        cape.rotation.x = 0.15;
        b.add(cape);
        g.userData.top = 3.2;
      }
    } else if (look === 'compass') {
      const legs = new T.Group();
      b.add(legs);
      g.userData.spinner = legs;
      mesh(new T.SphereGeometry(0.42, 16, 12), '#9aa2ad', 0, 2.9, 0, legs);
      mesh(new T.CylinderGeometry(0.1, 0.1, 0.6, 8), '#23262b', 0, 3.5, 0, legs);
      for (const sx of [-1, 1]) {
        const leg = new T.Group();
        leg.position.set(0, 2.9, 0);
        leg.rotation.z = sx * 0.42;
        mesh(new T.CylinderGeometry(0.12, 0.1, 2.6, 8), '#b9c0c9', 0, -1.3, 0, leg);
        if (sx < 0) { const n = mesh(new T.ConeGeometry(0.1, 0.4, 8), '#23262b', 0, -2.75, 0, leg); n.rotation.x = Math.PI; }
        else {
          mesh(new T.CylinderGeometry(0.16, 0.16, 0.6, 6), '#f2c230', 0, -2.75, 0, leg);
          const tip = mesh(new T.ConeGeometry(0.16, 0.3, 6), '#e8c79a', 0, -3.2, 0, leg);
          tip.rotation.x = Math.PI;
        }
        legs.add(leg);
      }
      eyes(b, 2.95, 0.35, 0.16, 0.1, true);
      g.userData.top = 4.0;
    } else if (look === 'paint') {
      const m = mesh(new T.SphereGeometry(1.6, 24, 18), '#8a5cd6', 0, 1.1, 0, b);
      m.scale.set(1, 0.72, 1);
      const cols = ['#e0452b', '#f2c230', '#2f6fd6', '#3a9a4a', '#f08a24'];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        const d = mesh(new T.SphereGeometry(0.28, 10, 8), cols[i % 5], Math.cos(a) * 1.45, 0.3, Math.sin(a) * 1.45, b, false);
        d.scale.set(1, 1.5, 1);
      }
      for (let i = 0; i < 3; i++) mesh(new T.SphereGeometry(0.35, 10, 8), cols[i], rnd(-0.7, 0.7), 2.0, rnd(-0.7, 0.3), b, false).scale.set(1, 0.4, 1);
      eyes(b, 1.4, 1.3, 0.5, 0.22, true);
      g.userData.top = 2.9;
    }
    return g;
  }

  /* ---------- 예고(바닥의 빨간 표시) ---------- */
  const circleGeo = new T.CircleGeometry(1, 40), ringGeo = new T.RingGeometry(0.9, 1, 48), planeGeo = new T.PlaneGeometry(1, 1);
  function tele(kind, x, z, o, dur, onEnd) {
    const g = new T.Group();
    g.position.set(x, 0.06, z);
    const color = o.color || '#e0452b';
    const back = new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, side: T.DoubleSide });
    const fill = new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, depthWrite: false, side: T.DoubleSide });
    const edge = new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: T.DoubleSide });
    let fillMesh;
    if (kind === 'line') {
      g.rotation.y = o.ang;
      const bm = new T.Mesh(planeGeo, back);
      bm.rotation.x = Math.PI / 2;
      bm.scale.set(o.w, o.len, 1);
      bm.position.z = o.len / 2;
      fillMesh = new T.Mesh(planeGeo, fill);
      fillMesh.rotation.x = Math.PI / 2;
      g.add(bm, fillMesh);
    } else {
      const bm = new T.Mesh(circleGeo, back);
      bm.rotation.x = -Math.PI / 2;
      bm.scale.setScalar(o.r);
      const em = new T.Mesh(ringGeo, edge);
      em.rotation.x = -Math.PI / 2;
      em.scale.setScalar(o.r);
      fillMesh = new T.Mesh(circleGeo, fill);
      fillMesh.rotation.x = -Math.PI / 2;
      g.add(bm, em, fillMesh);
    }
    scene.add(g);
    const t = { kind, g, o, t: 0, dur, onEnd, fillMesh, mats: [back, fill, edge], follow: o.follow || null };
    S.teles.push(t);
    return t;
  }
  function updateTeles(dt) {
    for (let i = S.teles.length - 1; i >= 0; i--) {
      const t = S.teles[i];
      t.t += dt;
      const k = Math.min(1, t.t / t.dur);
      if (t.follow) t.g.position.set(t.follow.x, 0.06, t.follow.z);
      if (t.kind === 'line') { t.fillMesh.scale.set(t.o.w, Math.max(0.01, t.o.len * k), 1); t.fillMesh.position.z = (t.o.len * k) / 2; }
      else t.fillMesh.scale.setScalar(Math.max(0.01, t.o.r * k));
      if (k >= 1) {
        removeTele(t);
        S.teles.splice(i, 1);
        if (t.onEnd) t.onEnd();
      }
    }
  }
  function removeTele(t) { scene.remove(t.g); for (const m of t.mats) m.dispose(); }

  /* ---------- 적 ---------- */
  function spawnAt(type, x, z, delay) {
    S.pending++;
    tele('circle', x, z, { r: MOBS[type].r + 0.5, color: '#8a5cd6' }, delay || 0.8, () => {
      S.pending--;
      if (S.state !== 'fight') return;
      makeMob(type, x, z);
      NS.fx.burst(x, 0.5, z, { color: [MOBS[type].color, '#ffffff'], n: 10, speed: 4, up: 5, size: 0.12 });
    });
  }
  function spawnPoint(minD) {
    const P = C().P;
    for (let i = 0; i < 20; i++) {
      const x = rnd(-A + 1, A - 1), z = rnd(-A + 1, A - 1);
      if (Math.hypot(x - P.x, z - P.z) >= (minD || 8)) return { x, z };
    }
    return { x: -P.x * 0.8 || 10, z: -P.z * 0.8 || 10 };
  }
  function makeMob(type, x, z) {
    const def = MOBS[type];
    const g = buildLook(def.look, def.color, def.r);
    g.position.set(x, 0, z);
    scene.add(g);
    const m = {
      kind: 'mob', type, def, x, z, kx: 0, kz: 0, face: Math.atan2(C().P.x - x, C().P.z - z), r: def.r, g,
      hp: def.hp * S.hpMul, max: def.hp * S.hpMul, dmg: def.dmg * S.dmgMul, speed: def.speed * rnd(0.9, 1.1),
      state: 'walk', t: 0, cd: rnd(0.4, 1.2), fireT: rnd(1, 2.5), flash: 0, dead: false, strafe: Math.random() < 0.5 ? -1 : 1,
      burnT: 0, slowT: 0, rootT: 0, dir: 0, hitDone: false,
    };
    m.tag = C().makeTag('');
    m.tag.classList.add('mob');
    m.hurt = (h, q, from) => hurtMob(m, h, q, from);
    S.mobs.push(m);
    return m;
  }
  function fwd(a) { return { x: Math.sin(a), z: Math.cos(a) }; }
  function hitPlayer(dmg, from, word, knock) {
    return C().takeHit({ dmg, knock: knock || 6, from, by: null, word: word || pick(['앗!', '아야!', '꽥!']), crit: false, ink: null });
  }

  function updateMob(m, dt) {
    const P = C().P, def = m.def;
    const dx = P.x - m.x, dz = P.z - m.z, d = Math.hypot(dx, dz) || 1;
    const aim = Math.atan2(dx, dz);
    m.t -= dt; m.cd -= dt; m.flash -= dt; m.slowT -= dt; m.rootT -= dt;
    if (m.burnT > 0) { m.burnT -= dt; m.hp -= 4 * dt; if (Math.random() < dt * 6) NS.fx.burst(m.x, 1, m.z, { color: [PAL.red, PAL.orange], n: 1, speed: 1, up: 3, size: 0.1 }); if (m.hp <= 0) { killMob(m); return; } }
    let mvx = 0, mvz = 0, spd = m.speed;
    const f = fwd(m.face);
    if (P.dead) { m.state = 'walk'; mvx = -dx / d * 0.3; mvz = -dz / d * 0.3; }
    else if (m.state === 'walk') {
      if (def.ranged) {
        const want = d > def.keep + 1 ? 1 : d < def.keep - 1.5 ? -1 : 0;
        mvx = (dx / d) * want - (dz / d) * 0.5 * m.strafe;
        mvz = (dz / d) * want + (dx / d) * 0.5 * m.strafe;
        m.fireT -= dt;
        if (m.fireT <= 0 && d < 15) { m.state = 'aim'; m.t = 0.5; }
      } else if (def.charge) {
        mvx = dx / d; mvz = dz / d;
        if (d < 9 && m.cd <= 0) {
          m.state = 'aim'; m.t = 0.75; m.dir = aim;
          tele('line', m.x, m.z, { ang: aim, len: 9, w: 1.2 }, 0.75);
        }
      } else {
        if (d > def.reach * 0.7 + BODY()) { mvx = dx / d; mvz = dz / d; }
        if (d < def.reach + BODY() && m.cd <= 0) {
          m.state = 'windup'; m.t = def.windup; m.dir = aim;
          const c = fwd(aim);
          tele('circle', m.x + c.x * def.reach * 0.6, m.z + c.z * def.reach * 0.6, { r: def.reach * 0.75 }, def.windup);
        }
      }
      m.face += angDiff(m.face, aim) * Math.min(1, dt * 8);
    } else if (m.state === 'windup') {
      spd = 0;
      if (m.t <= 0) {
        const c = fwd(m.dir), cx = m.x + c.x * def.reach * 0.6, cz = m.z + c.z * def.reach * 0.6;
        if (Math.hypot(P.x - cx, P.z - cz) < def.reach * 0.75 + BODY() * 0.6) hitPlayer(m.dmg, { x: m.x, z: m.z }, null, def.heavy ? 10 : 6);
        m.kx += c.x * 4; m.kz += c.z * 4;
        m.state = 'recover'; m.t = 0.45; m.cd = def.cd;
        if (def.heavy) { NS.fx.ring(cx, cz, def.reach, '#ffffff', 0.3); NS.fx.shake(0.2); Sfx.slam(1.5); }
      }
    } else if (m.state === 'aim') {
      spd = 0;
      m.face += angDiff(m.face, def.charge ? m.dir : aim) * Math.min(1, dt * 10);
      if (m.t <= 0) {
        if (def.charge) { m.state = 'dash'; m.t = 0.6; m.hitDone = false; }
        else {
          const a = aim + rnd(-0.08, 0.08);
          shoot(m.x + Math.sin(a) * 0.6, m.z + Math.cos(a) * 0.6, a, 8.5, m.dmg, def.color, 0.3);
          m.fireT = def.fireCd * rnd(0.8, 1.2);
          m.state = 'walk';
        }
      }
    } else if (m.state === 'dash') {
      const c = fwd(m.dir);
      mvx = c.x; mvz = c.z; spd = 14;
      if (!m.hitDone && d < m.r + BODY() + 0.2) { m.hitDone = true; hitPlayer(m.dmg, { x: m.x, z: m.z }, '쿵!', 10); }
      if (m.t <= 0) { m.state = 'recover'; m.t = 0.8; m.cd = 2.6; }
    } else if (m.state === 'recover') {
      spd *= 0.3;
      mvx = dx / d; mvz = dz / d;
      if (m.t <= 0) m.state = 'walk';
    }
    if (m.slowT > 0) spd *= 0.5;
    if (m.rootT > 0) spd = 0;
    m.x += (mvx * spd + m.kx) * dt;
    m.z += (mvz * spd + m.kz) * dt;
    const decay = Math.exp(-dt * 6);
    m.kx *= decay; m.kz *= decay;
    for (const o of S.mobs) {
      if (o === m || o.dead) continue;
      const ox = m.x - o.x, oz = m.z - o.z, od = Math.hypot(ox, oz), need = m.r + o.r;
      if (od < need && od > 1e-4) { const push = (need - od) * 0.5; m.x += (ox / od) * push; m.z += (oz / od) * push; }
    }
    if (m.state !== 'dash') C().pushOutOfWalls(m, m.r);
    m.x = clamp(m.x, -A - 1, A + 1);
    m.z = clamp(m.z, -A - 1, A + 1);
    const moving = Math.hypot(mvx, mvz) * spd > 0.3;
    const b = m.g.userData.body;
    const shake = m.state === 'windup' || m.state === 'aim' ? 0.05 : 0;
    m.g.position.set(m.x + rnd(-shake, shake) + (m.flash > 0 ? rnd(-0.08, 0.08) : 0), 0, m.z);
    m.g.rotation.y = m.face;
    b.position.y = moving ? Math.abs(Math.sin(S.time * 12 + m.x)) * 0.15 : m.state === 'windup' ? 0.1 : 0;
    const sq = m.flash > 0 ? 1.15 : 1;
    b.scale.set(sq, 2 - sq, sq);
    C().placeTag(m.tag, m.x, m.g.userData.top + 0.2, m.z, (m.hp / m.max) * 100, m.hp < m.max);
  }
  const BODY = () => C().BODY_R;

  function hurtMob(m, h, q, from) {
    if (m.dead) return;
    m.hp -= h.dmg;
    const boss = m.kind === 'boss';
    const kb = boss ? 0.12 : m.def.heavy ? 0.5 : 1;
    const dx = m.x - from.x, dz = m.z - from.z, L = Math.hypot(dx, dz) || 1;
    m.kx += (dx / L) * h.knock * kb;
    m.kz += (dz / L) * h.knock * kb;
    if (h.ink === 'fire') m.burnT = 2;
    if (h.ink === 'water') m.slowT = 1.5;
    if (h.ink === 'vine') m.rootT = boss ? 0.2 : 0.6;
    m.flash = 0.12;
    C().hitFx(m.x, m.z, h, q, (m.g.userData.top || 2) + 0.3);
    if (m.hp <= 0) killMob(m);
  }
  function killMob(m) {
    if (m.dead) return;
    m.dead = true;
    const col = m.def.color;
    NS.fx.burst(m.x, 1, m.z, { color: [col, '#ffffff', PAL.ink], n: m.kind === 'boss' ? 60 : 18, speed: 8, up: 8, size: m.kind === 'boss' ? 0.3 : 0.16 });
    NS.fx.splat(m.x, m.z, col, m.r * 1.2);
    NS.fx.popup('펑!', m.x, 2.4, m.z, { size: 1.5 });
    Sfx.pop();
    scene.remove(m.g);
    m.tag.remove();
    S.kills++;
    const P = C().P;
    if (S.mods.lifesteal > 0 && !P.dead) {
      P.hp = Math.min(P.maxHp, P.hp + S.mods.lifesteal);
      NS.fx.popup('+' + S.mods.lifesteal, P.x, 2.2, P.z, { color: PAL.green, size: 0.8 });
    }
    if (m.kind === 'boss') { bossDown(m); return; }
    if (Math.random() < m.def.drop) makeDrop('ink', m.x, m.z);
    if (Math.random() < 0.08) makeDrop('heart', m.x + 0.3, m.z);
    if (m.def.split) for (let i = 0; i < 2; i++) { const a = Math.random() * TAU; makeMob(m.def.split, m.x + Math.cos(a) * 0.6, m.z + Math.sin(a) * 0.6); }
  }

  /* ---------- 날아오는 물감 ---------- */
  const shotGeo = new T.SphereGeometry(1, 12, 10);
  function shoot(x, z, a, speed, dmg, color, size) {
    const g = new T.Mesh(shotGeo, NS.toon(color));
    g.scale.setScalar(size);
    NS.outline(g, 1.15);
    g.position.set(x, 0.9, z);
    scene.add(g);
    const s = { shot: true, x, z, vx: Math.sin(a) * speed, vz: Math.cos(a) * speed, r: size + 0.1, dmg, life: 4, g, dead: false, color };
    s.hurt = () => {
      if (s.dead) return;
      NS.fx.popup('튕!', s.x, 1.8, s.z, { size: 0.9 });
      Sfx.block();
      killShot(s);
    };
    S.shots.push(s);
  }
  function killShot(s) {
    s.dead = true;
    scene.remove(s.g);
    NS.fx.burst(s.x, 0.9, s.z, { color: [s.color, '#ffffff'], n: 6, speed: 3, up: 3, size: 0.1 });
  }
  function updateShots(dt) {
    const P = C().P;
    for (const s of S.shots) {
      if (s.dead) continue;
      const px = s.x, pz = s.z;
      s.x += s.vx * dt; s.z += s.vz * dt; s.life -= dt;
      s.g.position.set(s.x, 0.9, s.z);
      if (C().wallBetween(px, pz, s.x, s.z)) { NS.fx.splat(s.x, s.z, s.color, 0.4); killShot(s); continue; }
      if (s.life <= 0 || Math.abs(s.x) > A + 4 || Math.abs(s.z) > A + 4) { killShot(s); continue; }
      if (!P.dead && Math.hypot(P.x - s.x, P.z - s.z) < s.r + BODY() * 0.8) {
        hitPlayer(s.dmg, { x: px, z: pz }, '철퍽!', 4);
        NS.fx.splat(s.x, s.z, s.color, 0.5);
        killShot(s);
      }
    }
    S.shots = S.shots.filter((s) => !s.dead);
  }

  /* ---------- 떨어진 잉크 방울, 하트 ---------- */
  const dropGeo = new T.SphereGeometry(0.22, 10, 8), heartGeo = new T.SphereGeometry(0.2, 10, 8);
  function makeDrop(kind, x, z) {
    const g = new T.Group();
    if (kind === 'ink') {
      mesh(dropGeo, '#2f6fd6', 0, 0, 0, g);
      const c = mesh(new T.ConeGeometry(0.16, 0.3, 8), '#2f6fd6', 0, 0.22, 0, g, false);
      c.userData.own = true;
    } else {
      mesh(heartGeo, '#e0452b', -0.12, 0, 0, g);
      mesh(heartGeo, '#e0452b', 0.12, 0, 0, g);
      const c = mesh(new T.ConeGeometry(0.3, 0.35, 8), '#e0452b', 0, -0.2, 0, g, false);
      c.rotation.x = Math.PI;
    }
    g.position.set(x, 0.5, z);
    scene.add(g);
    S.drops.push({ kind, x, z, g, t: 0, dead: false });
  }
  function updateDrops(dt) {
    const P = C().P;
    for (const d of S.drops) {
      d.t += dt;
      const dist = Math.hypot(P.x - d.x, P.z - d.z);
      const pull = S.state === 'cleared' ? 99 : 1.4 * S.mods.magnet;
      if (!P.dead && dist < pull) { const k = Math.min(1, (dt * 14) / Math.max(0.3, dist)); d.x += (P.x - d.x) * k; d.z += (P.z - d.z) * k; }
      d.g.position.set(d.x, 0.5 + Math.sin(d.t * 4) * 0.12, d.z);
      d.g.rotation.y += dt * 2;
      if (!P.dead && dist < 0.8) {
        d.dead = true;
        if (d.kind === 'ink') { P.ink = Math.min(P.inkMax, P.ink + 25); NS.fx.popup('잉크 +25', P.x, 2.2, P.z, { color: PAL.blue, size: 0.8 }); }
        else { P.hp = Math.min(P.maxHp, P.hp + 12); NS.fx.popup('+12', P.x, 2.2, P.z, { color: PAL.green, size: 0.9 }); }
        Sfx.heal();
      } else if (d.t > 15) d.dead = true;
      if (d.dead) scene.remove(d.g);
    }
    S.drops = S.drops.filter((d) => !d.dead);
  }

  /* ---------- 물감 웅덩이 (느려지고 아프다) ---------- */
  function makePuddle(x, z, r, color) {
    const m = new T.Mesh(circleGeo, new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.03, z);
    m.scale.setScalar(r);
    scene.add(m);
    S.puddles.push({ x, z, r, t: 5, m });
  }
  function updatePuddles(dt) {
    const P = C().P;
    for (const p of S.puddles) {
      p.t -= dt;
      p.m.material.opacity = 0.55 * Math.min(1, p.t);
      if (!P.dead && Math.hypot(P.x - p.x, P.z - p.z) < p.r) { P.slowT = Math.max(P.slowT, 0.3); C().hurt(6 * dt, null); }
      if (p.t <= 0) { scene.remove(p.m); p.m.material.dispose(); }
    }
    S.puddles = S.puddles.filter((p) => p.t > 0);
  }

  /* ---------- 보스 ---------- */
  function spawnBoss(key) {
    const def = BOSSES[key];
    const g = buildBoss(def.look);
    g.position.set(0, 0, -10);
    scene.add(g);
    const b = {
      kind: 'boss', key, def: Object.assign({ drop: 0 }, def), x: 0, z: -10, kx: 0, kz: 0, face: 0, r: def.r, g,
      hp: def.hp, max: def.hp, dmg: def.dmg, speed: def.speed, state: 'intro', t: 2, phase: 0, move: null, last: null,
      y: 0, flash: 0, dead: false, burnT: 0, slowT: 0, rootT: 0, contactT: 0, sub: 0, n: 0,
    };
    b.tag = document.createElement('i');   // 보스는 머리 위 이름표 대신 위쪽 큰 체력 막대를 쓴다
    b.hurt = (h, q, from) => { if (b.state === 'intro') return; hurtMob(b, h, q, from); };
    S.boss = b;
    S.mobs.push(b);
    $('bossbar').hidden = false;
    C().setText($('boss-name'), def.name);
    NS.fx.ring(0, -10, 4, def.color, 0.8);
    NS.fx.shake(0.6);
    Sfx.slam(3);
    C().banner(def.name, '보스가 나타났다!', 2000);
  }

  function bossPhase(b) {
    const at = b.def.at || [0.5];
    let ph = 0;
    for (const a of at) if (b.hp / b.max <= a) ph++;
    return Math.min(ph, b.def.phases.length - 1);
  }

  function startMove(b) {
    const list = b.def.phases[b.phase];
    let mv = pick(list);
    if (mv === b.last && list.length > 1) mv = pick(list.filter((x) => x !== b.last));
    if (mv === 'summon' && S.mobs.filter((m) => !m.dead && m.kind === 'mob').length > 5) mv = list.find((x) => x !== 'summon') || 'charge';
    b.last = mv;
    b.move = mv;
    b.sub = 0;
    b.n = 0;
    const P = C().P, fast = b.phase > 0 ? 0.8 : 1;
    const aim = Math.atan2(P.x - b.x, P.z - b.z);
    if (mv === 'slam' || mv === 'slam2') {
      b.state = 'slamRise'; b.t = 0.95 * fast; b.sx = b.x; b.sz = b.z; b.tx = P.x; b.tz = P.z; b.n = mv === 'slam2' ? 2 : 1;
      tele('circle', b.tx, b.tz, { r: 2.8 }, b.t);
    } else if (mv === 'charge') {
      b.state = 'chargeAim'; b.t = 0.85 * fast; b.dir = aim; b.face = aim;
      tele('line', b.x, b.z, { ang: aim, len: 18, w: b.r * 2 }, b.t);
    } else if (mv === 'summon') {
      b.state = 'cast'; b.t = 0.8;
    } else if (mv === 'fan' || mv === 'ring') {
      b.state = 'cast'; b.t = mv === 'ring' ? 0.8 : 0.55;
    } else if (mv === 'spin') {
      b.state = 'spinAim'; b.t = 0.8 * fast;
      tele('circle', b.x, b.z, { r: 3.6, follow: b }, b.t);
    } else if (mv === 'puddles') {
      b.state = 'cast'; b.t = 0.45;
    }
  }

  function endMove(b, rest) { b.state = 'idle'; b.t = rest != null ? rest : rnd(0.7, 1.3) * (b.phase > 0 ? 0.75 : 1); b.move = null; }

  function castMove(b) {
    const P = C().P, aim = Math.atan2(P.x - b.x, P.z - b.z);
    const col = b.key === 'paint' ? pick(['#e0452b', '#f2c230', '#2f6fd6', '#3a9a4a']) : b.key === 'compass' ? '#23262b' : '#f28aa5';
    if (b.move === 'summon') {
      const [type, n] = b.def.summon;
      for (let i = 0; i < n + b.phase; i++) { const a = (i / (n + b.phase)) * TAU; spawnAt(type, clamp(b.x + Math.cos(a) * 3, -A, A), clamp(b.z + Math.sin(a) * 3, -A, A), 0.7); }
      NS.fx.ring(b.x, b.z, 4, b.def.color, 0.5);
      endMove(b);
    } else if (b.move === 'fan') {
      const n = b.phase > 0 ? 7 : 5;
      for (let i = 0; i < n; i++) shoot(b.x, b.z, aim + (i - (n - 1) / 2) * 0.16, 9, b.dmg * 0.5, col, 0.32);
      Sfx.swing(2);
      endMove(b);
    } else if (b.move === 'ring') {
      const n = b.phase > 1 ? 18 : 14, off = Math.random() * TAU;
      for (let i = 0; i < n; i++) shoot(b.x, b.z, off + (i / n) * TAU, 6.5, b.dmg * 0.45, col, 0.34);
      NS.fx.ring(b.x, b.z, 3, b.def.color, 0.4);
      Sfx.slam(2);
      endMove(b);
    } else if (b.move === 'puddles') {
      const spots = [{ x: P.x, z: P.z }];
      for (let i = 0; i < 3 + b.phase; i++) spots.push({ x: clamp(P.x + rnd(-5, 5), -A, A), z: clamp(P.z + rnd(-5, 5), -A, A) });
      for (const s of spots) {
        const c = pick(['#e0452b', '#f2c230', '#2f6fd6', '#3a9a4a']);
        tele('circle', s.x, s.z, { r: 1.8, color: c }, 1.0, () => {
          const P2 = C().P;
          if (Math.hypot(P2.x - s.x, P2.z - s.z) < 1.8 + BODY() * 0.5) hitPlayer(b.dmg * 0.7, s, '철퍽!', 5);
          NS.fx.burst(s.x, 0.4, s.z, { color: [c, '#ffffff'], n: 10, speed: 4, up: 5, size: 0.14 });
          makePuddle(s.x, s.z, 1.8, c);
        });
      }
      endMove(b, 1.2);
    }
  }

  function updateBoss(b, dt) {
    const P = C().P;
    const dx = P.x - b.x, dz = P.z - b.z, d = Math.hypot(dx, dz) || 1;
    const aim = Math.atan2(dx, dz);
    b.t -= dt; b.flash -= dt; b.slowT -= dt; b.rootT -= dt; b.contactT -= dt;
    if (b.burnT > 0) { b.burnT -= dt; b.hp -= 4 * dt; if (b.hp <= 0) { killMob(b); return; } }
    // 체력이 줄면 더 화가 난다
    const ph = bossPhase(b);
    if (ph > b.phase && b.state !== 'intro') {
      b.phase = ph;
      C().banner(`${b.def.name} 화났다!`, ph >= 2 ? '마지막 힘을 쥐어짠다!' : '공격이 빨라져요', 1600);
      NS.fx.ring(b.x, b.z, 5, '#e0452b', 0.6);
      NS.fx.shake(0.5);
      Sfx.slam(3);
      for (const t of S.teles.slice()) if (!t.o.color) { removeTele(t); S.teles.splice(S.teles.indexOf(t), 1); }
      endMove(b, 1.0);
      b.y = 0;
      if (b.key === 'king' && ph >= 2) { S.zoneTarget = 9; C().banner('공책이 지워진다!', '가운데로 모여라', 1800); Sfx.erase(); }
    }
    let mvx = 0, mvz = 0, spd = b.speed * (b.phase > 0 ? 1.2 : 1);
    const spinner = b.g.userData.spinner;
    switch (b.state) {
      case 'intro':
        b.face = aim;
        if (b.t <= 0) endMove(b, 0.6);
        break;
      case 'idle':
        if (d > b.r + 2) { mvx = dx / d; mvz = dz / d; }
        b.face += angDiff(b.face, aim) * Math.min(1, dt * 5);
        if (b.t <= 0 && !P.dead) startMove(b);
        break;
      case 'slamRise': {
        const tot = 0.95 * (b.phase > 0 ? 0.8 : 1), k = 1 - Math.max(0, b.t) / tot;
        b.x = lerp(b.sx, b.tx, easeInOut(k));
        b.z = lerp(b.sz, b.tz, easeInOut(k));
        b.y = Math.sin(Math.PI * Math.min(1, k)) * 4;
        if (b.t <= 0) {
          b.y = 0;
          if (Math.hypot(P.x - b.tx, P.z - b.tz) < 2.8 + BODY() * 0.5) hitPlayer(b.dmg, { x: b.tx, z: b.tz }, '쿵!!', 12);
          NS.fx.ring(b.tx, b.tz, 3.2, b.def.color, 0.4);
          NS.fx.burst(b.tx, 0.3, b.tz, { color: [b.def.color, '#ffffff'], n: 20, speed: 8, up: 7, size: 0.18 });
          NS.fx.shake(0.6);
          Sfx.slam(3);
          b.n--;
          if (b.n > 0) {
            b.state = 'slamRise'; b.t = 0.7; b.sx = b.x; b.sz = b.z; b.tx = P.x; b.tz = P.z;
            tele('circle', b.tx, b.tz, { r: 2.8 }, 0.7);
          } else { b.state = 'recover'; b.t = 0.7; }
        }
        break;
      }
      case 'chargeAim':
        b.face = b.dir;
        if (b.t <= 0) { b.state = 'charge'; b.t = 18 / 17; b.hitDone = false; }
        break;
      case 'charge': {
        const c = fwd(b.dir);
        mvx = c.x; mvz = c.z; spd = 17;
        if (!b.hitDone && d < b.r + BODY() + 0.2) { b.hitDone = true; hitPlayer(b.dmg, { x: b.x, z: b.z }, '쾅!', 14); }
        if (Math.random() < dt * 20) NS.fx.burst(b.x, 0.3, b.z, { color: ['#ffffff', b.def.color], n: 1, speed: 2, up: 2, size: 0.15 });
        if (b.t <= 0 || Math.abs(b.x) > A || Math.abs(b.z) > A) { b.state = 'recover'; b.t = 0.9; NS.fx.shake(0.3); }
        break;
      }
      case 'cast':
        b.g.userData.body.position.y = Math.abs(Math.sin(S.time * 20)) * 0.2;
        b.face += angDiff(b.face, aim) * Math.min(1, dt * 6);
        if (b.t <= 0) { b.g.userData.body.position.y = 0; castMove(b); }
        break;
      case 'spinAim':
        if (b.t <= 0) { b.state = 'spin'; b.t = 1.7; b.sub = 0; }
        break;
      case 'spin':
        mvx = dx / d; mvz = dz / d; spd = 2.6;
        b.face += dt * 18;
        if (spinner) spinner.rotation.y += dt * 18;
        b.sub -= dt;
        if (b.sub <= 0 && d < 3.6 + BODY() * 0.5) { b.sub = 0.5; hitPlayer(b.dmg * 0.5, { x: b.x, z: b.z }, '빙글!', 8); }
        if (Math.random() < dt * 12) NS.fx.burst(b.x + rnd(-3, 3), 0.3, b.z + rnd(-3, 3), { color: ['#ffffff'], n: 1, speed: 2, up: 2, size: 0.12 });
        if (b.t <= 0) { b.state = 'recover'; b.t = 1.0; }
        break;
      case 'recover':
        if (b.t <= 0) endMove(b);
        break;
    }
    if (b.slowT > 0) spd *= 0.6;
    if (b.rootT > 0 && b.state !== 'charge') spd = 0;
    b.x += (mvx * spd + b.kx) * dt;
    b.z += (mvz * spd + b.kz) * dt;
    const decay = Math.exp(-dt * 6);
    b.kx *= decay; b.kz *= decay;
    if (b.state !== 'charge' && b.state !== 'slamRise') C().pushOutOfWalls(b, b.r);
    b.x = clamp(b.x, -A, A);
    b.z = clamp(b.z, -A, A);
    // 몸에 부딪혀도 조금 아프다
    if (!P.dead && b.y < 0.5 && b.state !== 'charge' && b.state !== 'intro' && d < b.r + BODY() && b.contactT <= 0) { b.contactT = 0.8; hitPlayer(8, { x: b.x, z: b.z }, '퉁!', 9); }
    b.g.position.set(b.x + (b.flash > 0 ? rnd(-0.1, 0.1) : 0) + (b.state === 'chargeAim' ? rnd(-0.08, 0.08) : 0), b.y, b.z);
    b.g.rotation.y = b.face;
    const sq = b.flash > 0 ? 1.06 : 1;
    b.g.userData.body.scale.set(sq, 2 - sq, sq);
    C().setText($('boss-hp'), `${Math.max(0, Math.ceil(b.hp))} / ${b.max}`);
    $('boss-fill').style.width = clamp((b.hp / b.max) * 100, 0, 100) + '%';
  }

  function bossDown(b) {
    S.boss = null;
    $('bossbar').hidden = true;
    for (let i = 0; i < 5; i++) NS.fx.burst(b.x + rnd(-2, 2), 2, b.z + rnd(-2, 2), { color: [PAL.red, PAL.yellow, PAL.blue, PAL.green, '#ffffff'], n: 16, speed: 8, up: 10, size: 0.18 });
    for (let i = 0; i < 6; i++) makeDrop(i % 3 ? 'ink' : 'heart', b.x + rnd(-2, 2), b.z + rnd(-2, 2));
    for (const m of S.mobs) if (!m.dead && m.kind === 'mob') killMob(m);
    for (const s of S.shots) if (!s.dead) killShot(s);
    for (const t of S.teles) removeTele(t);
    S.teles = [];
    S.spawnQ = [];
    S.pending = 0;
    S.zoneTarget = 99;
    NS.fx.shake(0.8);
    Sfx.win();
    C().banner(`${b.def.name} 격파!`, S.ch === CHAPTERS.length - 1 ? '공책 나라를 지켰다!' : `${CHAPTERS[S.ch].title} 클리어`, 2600);
    S.state = 'cleared';
    S.clearT = 2.8;
  }

  /* ---------- 방과 웨이브 ---------- */
  function clearArena() {
    for (const m of S.mobs) { if (!m.dead) { scene.remove(m.g); m.tag.remove(); } }
    for (const s of S.shots) scene.remove(s.g);
    for (const t of S.teles) removeTele(t);
    for (const d of S.drops) scene.remove(d.g);
    for (const p of S.puddles) { scene.remove(p.m); p.m.material.dispose(); }
    S.mobs = []; S.shots = []; S.teles = []; S.drops = []; S.puddles = []; S.spawnQ = []; S.pending = 0; S.boss = null;
    $('bossbar').hidden = true;
  }
  function setTheme(ch) {
    const c = ch == null ? null : CHAPTERS[ch];
    NS.ground.material.color.set(c && c.page !== '#fbf8ef' ? c.page : '#ffffff');
    NS.scene.background.set(c ? c.bg : '#d8c7a4');
  }

  function beginRoom() {
    clearArena();
    C().clearMyStructs();
    C().endGroundDraw();
    const P = C().P;
    P.x = 0; P.z = 4; P.vx = P.vz = P.kx = P.kz = 0; P.atk = null; P.inv = 1;
    P.ink = P.inkMax;
    S.hpMul = 1 + 0.3 * S.ch;
    S.dmgMul = 1 + 0.15 * S.ch;
    S.zoneR = S.zoneTarget = 99;
    S.state = 'fight';
    hideOverlays();
    const ch = CHAPTERS[S.ch];
    if (S.room < 2) {
      S.waves = ch.rooms[S.room];
      S.wave = -1;
      S.waveT = 0.8;
      C().banner(`${ch.title}`, `방 ${S.room + 1} · 적을 모두 물리쳐요`, 1600);
    } else {
      S.waves = null;
      spawnBoss(ch.boss);
    }
  }
  function nextWave() {
    S.wave++;
    const w = S.waves[S.wave];
    let delay = 0;
    for (const [type, n] of w) for (let i = 0; i < n; i++) { S.spawnQ.push({ type, t: delay }); delay += 0.35; }
    if (S.wave > 0) C().banner(`웨이브 ${S.wave + 1}/${S.waves.length}`, '', 1000);
  }
  function roomClear() {
    S.state = 'cleared';
    S.clearT = 1.8;
    C().banner('방 클리어!', '잉크 방울이 모여요', 1500);
    Sfx.win();
  }

  /* ---------- 화면: 이야기, 스티커 고르기, 결과, 멈춤 ---------- */
  function hideOverlays() { for (const id of ['story', 'reward', 'result', 'pause']) $(id).hidden = true; }
  function showStory(ch) {
    S.state = 'story';
    setTheme(ch);
    hideOverlays();
    const c = CHAPTERS[ch];
    C().setText($('story-kicker'), `혼자 모험 · ${ch + 1} / ${CHAPTERS.length}장`);
    C().setText($('story-title'), c.title);
    $('story-text').innerHTML = c.story.map((l) => `<p>${l}</p>`).join('') + `<p class="tip">💡 ${c.tip}</p>`;
    C().setText($('story-go'), '시작!');
    $('story-go').onclick = () => { Sfx.ui(); beginRoom(); };
    $('story').hidden = false;
  }
  function showEnding() {
    S.state = 'story';
    hideOverlays();
    C().setText($('story-kicker'), '마지막 이야기');
    C().setText($('story-title'), '공책 나라에 평화가');
    $('story-text').innerHTML = ENDING.map((l) => `<p>${l}</p>`).join('');
    C().setText($('story-go'), '결과 보기');
    $('story-go').onclick = () => { Sfx.ui(); showResult(true); };
    $('story').hidden = false;
  }
  function stickerCount(id) { return S.stickers[id] || 0; }
  function rollStickers() {
    const pool = STICKERS.filter((s) => !s.max || stickerCount(s.id) < s.max);
    const out = [];
    while (out.length < 3 && pool.length) {
      // 드문 스티커는 잘 안 나온다
      const weights = pool.map((s) => (s.rare ? 0.35 : 1));
      let r = Math.random() * weights.reduce((a, b) => a + b, 0);
      let i = 0;
      while (r > weights[i]) { r -= weights[i]; i++; }
      out.push(pool.splice(Math.min(i, pool.length - 1), 1)[0]);
    }
    const P = C().P;
    if (P.hp < P.maxHp * 0.6 && out.length) out[Math.floor(Math.random() * out.length)] = REST;
    return out;
  }
  function showReward() {
    S.state = 'reward';
    hideOverlays();
    const next = S.room === 0 ? '다음: 방 2' : S.room === 1 ? `다음: 보스 ${BOSSES[CHAPTERS[S.ch].boss].name}` : `다음: ${CHAPTERS[S.ch + 1].title}`;
    C().setText($('reward-sub'), next);
    const box = $('reward-cards');
    box.innerHTML = '';
    for (const s of rollStickers()) {
      const b = document.createElement('button');
      b.className = 'sticker-card' + (s.rare ? ' rare' : '') + (s.id === 'rest' ? ' rest' : '');
      const cnt = stickerCount(s.id);
      b.innerHTML = `<span class="ic">${s.icon}</span><b></b><small></small>${cnt ? `<em>가진 수 ${cnt}</em>` : ''}`;
      b.querySelector('b').textContent = s.name;
      b.querySelector('small').textContent = s.desc;
      b.addEventListener('click', () => takeSticker(s));
      box.appendChild(b);
    }
    $('reward').hidden = false;
  }
  function applyMods() {
    const P = C().P;
    const m = Object.assign({}, BASE_MODS);
    for (const s of STICKERS) for (let i = 0; i < stickerCount(s.id); i++) s.apply(m);
    m.revive = Math.max(0, m.revive - (S.usedRevive || 0));
    S.mods = m;
    const oldMax = P.maxHp;
    P.maxHp = 100 + m.maxHp;
    P.inkMax = 100 + m.inkMax;
    if (P.maxHp > oldMax) P.hp += P.maxHp - oldMax;
    P.hp = Math.min(P.hp, P.maxHp);
    C().myRig.fwdG.scale.setScalar(m.size);
  }
  function takeSticker(s) {
    Sfx.ui();
    const P = C().P;
    if (s.id === 'rest') { P.hp = P.maxHp; NS.fx.popup('회복!', P.x, 2.4, P.z, { color: PAL.green, size: 1.2 }); }
    else {
      S.stickers[s.id] = stickerCount(s.id) + 1;
      applyMods();
      if (s.heal) P.hp = Math.min(P.maxHp, P.hp + s.heal);
    }
    $('reward').hidden = true;
    if (S.room < 2) { S.room++; beginRoom(); }
    else { S.ch++; S.room = 0; showStory(S.ch); }
  }
  function renderStickers() {
    const key = JSON.stringify(S.stickers);
    if (key === S.stickerKey) return;
    S.stickerKey = key;
    $('stickers').innerHTML = STICKERS.filter((s) => stickerCount(s.id)).map((s) => `<span title="${s.name}: ${s.desc}">${s.icon}${stickerCount(s.id) > 1 ? `<i>${stickerCount(s.id)}</i>` : ''}</span>`).join('');
  }
  const fmtTime = (t) => `${Math.floor(t / 60)}분 ${String(Math.floor(t % 60)).padStart(2, '0')}초`;
  function progressIndex() { return S.ch * 3 + S.room + 1; }   // 1장 방1 = 1 … 4장 보스 = 12
  function progressLabel(i) {
    if (!i) return '아직 없음';
    const ch = Math.floor((i - 1) / 3), room = (i - 1) % 3;
    return `${ch + 1}장 ${room === 2 ? '보스' : '방 ' + (room + 1)}`;
  }
  function showResult(win) {
    S.state = 'result';
    hideOverlays();
    const prog = win ? CHAPTERS.length * 3 : progressIndex();
    rec.best = Math.max(rec.best, prog);
    if (win) { rec.clears++; if (!rec.bestTime || S.time < rec.bestTime) rec.bestTime = Math.round(S.time); }
    saveRec();
    C().setText($('result-title'), win ? '공책 나라를 지켰다!' : '모험 끝…');
    C().setText($('result-sub'), win ? `모든 보스를 물리쳤어요! (클리어 ${rec.clears}번째)` : '스티커를 새로 모으며 다시 도전해 보세요.');
    const stats = [
      ['도착한 곳', win ? '엔딩' : progressLabel(prog)],
      ['쓰러뜨린 적', S.kills + '마리'],
      ['걸린 시간', fmtTime(S.time)],
      ['무기', C().ME.w.stats.label],
      ['최고 기록', win || rec.clears ? `클리어 ${rec.clears}번 · 가장 빠른 ${fmtTime(rec.bestTime)}` : progressLabel(rec.best)],
    ];
    $('result-stats').innerHTML = stats.map(([a, b]) => `<li><span>${a}</span><b></b></li>`).join('');
    [...$('result-stats').children].forEach((li, i) => { li.querySelector('b').textContent = stats[i][1]; });
    $('result-stickers').innerHTML = STICKERS.filter((s) => stickerCount(s.id)).map((s) => `<span title="${s.name}">${s.icon}${stickerCount(s.id) > 1 ? '×' + stickerCount(s.id) : ''}</span>`).join('') || '<small>모은 스티커 없음</small>';
    $('result').hidden = false;
    if (win) Sfx.win(); else Sfx.lose();
    updateNote();
  }
  function togglePause() {
    if (S.state === 'pause') { S.state = S.prev || 'fight'; $('pause').hidden = true; return; }
    if (S.state !== 'fight' && S.state !== 'cleared') return;
    S.prev = S.state;
    S.state = 'pause';
    $('pause').hidden = false;
  }

  /* ---------- 한 판 시작과 끝 ---------- */
  function startRun() {
    if (!C().startSolo()) return;
    S.stickers = {};
    S.stickerKey = '';
    S.usedRevive = 0;
    S.kills = 0;
    S.time = 0;
    S.ch = 0;
    S.room = 0;
    const P = C().P;
    applyMods();
    C().respawn(0, 4);
    P.hp = P.maxHp;
    rec.runs++;
    saveRec();
    renderStickers();
    showStory(0);
  }
  function endRun() {
    clearArena();
    hideOverlays();
    S.state = 'off';
    S.mods = Object.assign({}, BASE_MODS);
    S.stickers = {};
    S.stickerKey = '';
    $('stickers').innerHTML = '';
    setTheme(null);
    C().endSolo();
    updateNote();
  }
  function updateNote() {
    const n = $('solo-note');
    if (!n) return;
    n.textContent = rec.clears ? `혼자 모험 클리어 ${rec.clears}번 · 가장 빠른 기록 ${fmtTime(rec.bestTime)}` : rec.best ? `혼자 모험 최고 기록: ${progressLabel(rec.best)}` : '혼자 모험: 4장의 이야기와 보스 4마리가 기다려요.';
  }

  /* ---------- 매 프레임 ---------- */
  function update(dt) {
    if (S.state === 'off') return;
    const P = C().P;
    NS.zone.set(S.zoneR, S.time);
    updateTeles(0);
    if (!dt) return;
    S.time += dt;
    updateTeles(dt);
    // 스폰 대기열
    for (const q of S.spawnQ) { q.t -= dt; if (q.t <= 0) { const p = spawnPoint(8); spawnAt(q.type, p.x, p.z, 0.8); q.done = true; } }
    S.spawnQ = S.spawnQ.filter((q) => !q.done);
    for (const m of S.mobs.slice()) { if (m.dead) continue; if (m.kind === 'boss') updateBoss(m, dt); else updateMob(m, dt); }
    S.mobs = S.mobs.filter((m) => !m.dead);
    updateShots(dt);
    updateDrops(dt);
    updatePuddles(dt);
    // 번개 구르기
    if (S.mods.dashHit > 0 && P.dashT > 0) {
      if (!S.dashSet) S.dashSet = new Set();
      for (const m of S.mobs) if (!m.dead && !S.dashSet.has(m) && Math.hypot(m.x - P.x, m.z - P.z) < m.r + BODY() + 0.2) {
        S.dashSet.add(m);
        m.hurt({ dmg: S.mods.dashHit * S.mods.dmg, knock: 7, word: '찌릿!', crit: false, ink: 'ink' }, { x: m.x, y: 1, z: m.z }, { x: P.x, z: P.z });
      }
    } else S.dashSet = null;
    // 지우개 대왕이 지우는 공책
    S.zoneR += (S.zoneTarget - S.zoneR) * Math.min(1, dt * (S.zoneTarget < S.zoneR ? 0.5 : 2));
    if (S.zoneTarget > 50 && S.zoneR > 40) S.zoneR = 99;
    if (S.zoneR < 40 && !P.dead && Math.hypot(P.x, P.z) > S.zoneR) { C().hurt(8 * dt, null); if (Math.random() < dt * 3) NS.fx.popup('지워진다!', P.x, 2.4, P.z, { color: PAL.eraser, size: 0.8 }); }
    if (S.state === 'fight' && S.waves) {
      const alive = S.mobs.some((m) => !m.dead);
      if (!alive && !S.spawnQ.length && !S.pending) {
        if (S.wave < S.waves.length - 1) { S.waveT -= dt; if (S.waveT <= 0) { S.waveT = 1.2; nextWave(); } }
        else roomClear();
      }
    } else if (S.state === 'cleared') {
      S.clearT -= dt;
      if (S.clearT <= 0) {
        if (S.room === 2 && S.ch === CHAPTERS.length - 1) showEnding();
        else showReward();
      }
    } else if (S.state === 'over') {
      S.overT -= dt;
      if (S.overT <= 0) showResult(false);
    }
  }

  function hud() {
    const $t = C().setText, ch = CHAPTERS[S.ch];
    renderStickers();
    const room = S.room < 2 ? `방 ${S.room + 1}` : '보스';
    $t($('phase'), ch ? `${ch.title.split(' · ')[0]} · ${room}` : '혼자 모험');
    $t($('ptimer'), '');
    let sub = '';
    if (S.state === 'fight' && S.waves) sub = `웨이브 ${Math.max(1, S.wave + 1)}/${S.waves.length} · 남은 적 ${S.mobs.filter((m) => !m.dead).length + S.spawnQ.length + S.pending}`;
    else if (S.boss) sub = `보스: ${S.boss.def.name}`;
    else if (S.state === 'cleared') sub = '클리어!';
    $t($('phase-sub'), sub);
  }

  /* ---------- 연결 ---------- */
  $('btn-solo').addEventListener('click', () => { Sfx.unlock(); startRun(); });
  $('btn-pause').addEventListener('click', togglePause);
  $('pause-go').addEventListener('click', togglePause);
  $('pause-quit').addEventListener('click', () => { Sfx.ui(); showResult(false); });
  $('reward-redraw').addEventListener('click', () => { Sfx.ui(); $('reward').hidden = true; C().openSketch(() => { if (S.state === 'reward') $('reward').hidden = false; }); });
  $('result-again').addEventListener('click', () => { Sfx.ui(); endRun(); startRun(); });
  $('result-home').addEventListener('click', () => { Sfx.ui(); endRun(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && (S.state === 'fight' || S.state === 'cleared')) togglePause(); });
  updateNote();

  NS.Solo = {
    frozen,
    update,
    hud,
    togglePause,
    mod: (k, d) => (k in S.mods ? S.mods[k] : d),
    modHit(h) {
      h.dmg *= S.mods.dmg;
      h.knock *= S.mods.knock;
      if (S.mods.crit > 0 && Math.random() < S.mods.crit) { h.dmg *= 2; h.crit = true; h.word = '반짝!!'; }
      return h;
    },
    targets: () => S.mobs.filter((m) => !m.dead && m.state !== 'intro' && !(m.y > 1.5)).concat(S.shots.filter((s) => !s.dead)),
    canRedraw: () => S.state === 'reward' || S.state === 'story',
    onPlayerHit() {
      if (S.mods.thorns <= 0) return;
      const P = C().P;
      NS.fx.ring(P.x, P.z, 2.6, '#3a9a4a', 0.3);
      for (const m of S.mobs.slice()) if (!m.dead && Math.hypot(m.x - P.x, m.z - P.z) < 2.6 + m.r) m.hurt({ dmg: S.mods.thorns * S.mods.dmg, knock: 6, word: '가시!', crit: false, ink: 'ink' }, { x: m.x, y: 1, z: m.z }, { x: P.x, z: P.z });
    },
    tryRevive() {
      if (S.mods.revive <= 0) return false;
      S.usedRevive = (S.usedRevive || 0) + 1;
      S.mods.revive--;
      const P = C().P;
      P.hp = P.maxHp * 0.5;
      P.inv = 2.5;
      NS.fx.ring(P.x, P.z, 4, '#3a9a4a', 0.7);
      NS.fx.burst(P.x, 1, P.z, { color: ['#3a9a4a', '#ffffff', '#f2c230'], n: 24, speed: 6, up: 8, size: 0.16 });
      C().banner('지우개 부적!', '다시 일어났다', 1600);
      Sfx.heal();
      return true;
    },
    onPlayerDeath() {
      S.state = 'over';
      S.overT = 1.8;
      C().banner('으악…', '공책이 지워졌어요', 1600);
    },
    debug: { S, startRun, endRun, showReward, showResult, spawnBoss, makeMob, beginRoom, rec },
  };
})();
