/* 낙서 서바이벌 — 그림 판정 (화면과 분리된 순수 함수)
 * 같은 그림을 넣으면 어느 컴퓨터에서든 같은 결과가 나와야 한다.
 * 그래서 멀티에서는 그림 선만 보내고, 성능은 받는 쪽이 이 함수로 다시 계산한다.
 */
(function () {
  'use strict';
  const NS = window.NS;
  const { clamp, polyLen, resample, turnAt, area, centroid } = NS;

  // 스케치북: 480×480, 손잡이 점은 아래 가운데. 1px = S 월드 단위
  const SK = (NS.SK = { SIZE: 480, HX: 240, HY: 440, S: 2.8 / 480, LIMIT: 1300 });

  const TYPES = (NS.WEAPON_TYPES = {
    blade: { name: '검', desc: '좌우로 베고, 세 번째는 회전 베기', how: '손잡이에서 곧게 뻗은 선', dmg: 14, dur: 0.3, knock: 6 },
    spear: { name: '창', desc: '앞으로 뛰어들며 찌르기', how: '아주 길고 가늘게', dmg: 13, dur: 0.36, knock: 8 },
    hammer: { name: '망치', desc: '내려찍으면 둘레가 모두 날아가요', how: '끝에 큰 덩어리(닫힌 모양)', dmg: 22, dur: 0.62, knock: 11 },
    whip: { name: '채찍', desc: '넓게 후려치기. 끝에 맞으면 치명타', how: '구불구불 길게', dmg: 9, dur: 0.4, knock: 5 },
    shield: { name: '방패', desc: '앞에서 오는 공격을 막고, 밀쳐 내기', how: '손잡이 가까이 큰 동그라미', dmg: 8, dur: 0.34, knock: 13 },
  });

  const closedOf = (s) => s.length >= 5 && polyLen(s) > 100 && Math.hypot(s[0].x - s[s.length - 1].x, s[0].y - s[s.length - 1].y) < 30;
  NS.closedOf = closedOf;

  // 손잡이에 안 닿게 그렸으면, 손잡이에서 가장 가까운 점까지 선을 자동으로 이어 준다
  function withHandle(raw) {
    const strokes = raw.filter((s) => s.length > 1);
    if (!strokes.length) return { strokes, auto: null };
    let best = null, bd = Infinity;
    for (const s of strokes) for (const p of s) {
      const d = Math.hypot(p.x - SK.HX, p.y - SK.HY);
      if (d < bd) { bd = d; best = p; }
    }
    if (bd <= 24) return { strokes, auto: null };
    const auto = [{ x: SK.HX, y: SK.HY }, { x: best.x, y: best.y }];
    return { strokes: [auto].concat(strokes), auto };
  }
  NS.withHandle = withHandle;

  function analyzeWeapon(raw, inkKey) {
    const { strokes, auto } = withHandle(raw || []);
    if (!strokes.length) return null;
    const ink = NS.safeInk(inkKey);
    let R = 0, len = 0, K = 0, V = 0, cx = 0, cy = 0, cn = 0;
    const closed = [];
    for (const s of strokes) for (const p of s) {
      R = Math.max(R, Math.hypot(p.x - SK.HX, p.y - SK.HY));
      cx += p.x; cy += p.y; cn++;
    }
    // 무기 축: 손잡이 → 그림 한가운데
    let ax = cx / cn - SK.HX, ay = cy / cn - SK.HY;
    const al = Math.hypot(ax, ay) || 1;
    ax /= al; ay /= al;
    let W = 0;
    for (const s of strokes) for (const p of s) W = Math.max(W, Math.abs((p.x - SK.HX) * ay - (p.y - SK.HY) * ax));

    for (const s of strokes) {
      len += polyLen(s);
      const isClosed = closedOf(s);
      if (isClosed) {
        const A = area(s), c = centroid(s);
        closed.push({ A, d: Math.hypot(c.x - SK.HX, c.y - SK.HY) });
      }
      const p = resample(s, 6);
      // 뾰족한 꺾임
      for (let i = 2; i < p.length - 2; i++) {
        if (Math.abs(turnAt(p, i, 2)) > 1.0) { K++; i += 3; }
      }
      // 물결: 굽는 방향이 몇 번 바뀌었나 (닫힌 모양은 빼고)
      if (!isClosed) {
        let sign = 0;
        for (let i = 4; i < p.length - 4; i++) {
          const t = turnAt(p, i, 4);
          if (Math.abs(t) < 0.25) continue;
          const sg = Math.sign(t);
          if (sign && sg !== sign) V++;
          sign = sg;
        }
      }
    }
    const closedArea = closed.reduce((a, c) => a + c.A, 0);
    let type = 'blade';
    if (closed.some((c) => c.A >= 6000 && c.d < 170)) type = 'shield';
    else if (closed.some((c) => c.A >= 2800 && c.d >= 150 && c.d >= R * 0.45)) type = 'hammer';
    else if (V >= 3 && len >= 400 && K <= 3) type = 'whip';   // 부드러운 물결만 채찍. 뾰족한 지그재그는 가시
    else if (R >= 320 && W <= 40) type = 'spear';

    const spikes = K >= 4 ? clamp((K - 3) / 6, 0, 1) : 0;
    const mass = clamp(len / 700 + closedArea / 15000, 0.4, 3);
    const reach = Math.min(2.8, R * SK.S);
    const base = TYPES[type];
    const st = {
      type, name: base.name, desc: base.desc, ink, len, mass, reach, spikes, auto,
      dmg: base.dmg * (0.65 + 0.35 * mass) * (1 + 0.4 * spikes) * (0.85 + 0.15 * Math.min(2, reach)),
      dur: base.dur * (0.7 + 0.3 * mass),
      knock: base.knock * (0.7 + 0.3 * mass),
    };
    st.traits = [];
    if (spikes > 0) st.traits.push('가시 +' + Math.round(40 * spikes) + '%');
    st.traits.push(NS.INKS[ink].name + ': ' + NS.INKS[ink].desc);
    st.label = (spikes > 0 ? '가시 ' : '') + NS.INKS[ink].name + ' ' + base.name;
    st.bars = {
      reach: Math.min(1, reach / 2.8),
      weight: Math.min(1, mass / 3),
      speed: clamp((0.75 - st.dur) / 0.55, 0.05, 1),
      power: Math.min(1, (st.dmg * st.knock) / 420),
    };
    return st;
  }
  NS.analyzeWeapon = analyzeWeapon;

  /* ---------- 땅에 그은 선 판정 (월드 좌표, y 대신 z를 y에 넣어 쓴다) ---------- */
  NS.GROUND = {
    wall: { name: '벽', life: 9, how: '곧게 긋기' },
    spike: { name: '가시밭', life: 7, how: '지그재그로 긋기' },
    heal: { name: '회복 원', life: 6, how: '동그랗게 닫기' },
  };
  NS.analyzeGround = function (raw) {
    if (!raw || raw.length < 2) return null;
    const L = polyLen(raw);
    if (L < 1.2) return null;
    const p = resample(raw, 0.3);
    const a = p[0], b = p[p.length - 1];
    if (L > 4 && Math.hypot(a.x - b.x, a.y - b.y) < Math.max(1.1, L * 0.15)) {
      const c = centroid(p);
      let r = 0;
      for (const q of p) r += Math.hypot(q.x - c.x, q.y - c.y);
      r = clamp(r / p.length, 1, 3);
      return { kind: 'heal', pts: [c, { x: c.x + r, y: c.y }] };
    }
    let K = 0;
    for (let i = 2; i < p.length - 2; i++) if (Math.abs(turnAt(p, i, 2)) > 0.9) { K++; i += 2; }
    return { kind: K >= 3 ? 'spike' : 'wall', pts: resample(raw, 0.5) };
  };

  /* ---------- 예시 그림 ---------- */
  const H = { x: SK.HX, y: SK.HY };
  const line = (x0, y0, x1, y1, n) => Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n }));
  const circle = (cx, cy, r, n) => { const a = Array.from({ length: n }, (_, i) => ({ x: cx + Math.cos((i / n) * 6.283) * r, y: cy + Math.sin((i / n) * 6.283) * r })); a.push({ ...a[0] }); return a; };
  NS.PRESETS = {
    blade: () => [line(H.x, H.y, H.x + 4, 150, 20), line(200, 390, 280, 388, 8)],
    spear: () => [line(H.x, H.y, H.x, 70, 30), [{ x: 226, y: 100 }, { x: H.x, y: 44 }, { x: 254, y: 100 }]],
    hammer: () => [line(H.x, H.y, H.x, 220, 16), [{ x: 170, y: 220 }, { x: 310, y: 220 }, { x: 310, y: 130 }, { x: 170, y: 130 }, { x: 170, y: 220 }]],
    whip: () => { const p = []; for (let i = 0; i <= 90; i++) p.push({ x: H.x + (i > 8 ? Math.sin((i - 8) * 0.18) * 34 : 0), y: H.y - i * 4.2 }); return [p]; },
    shield: () => [line(H.x, H.y, H.x, 380, 4), circle(H.x, 300, 80, 36)],
  };
})();
