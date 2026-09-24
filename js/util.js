/* 낙서 서바이벌 — 공용 도구: 수학, 색, 선 다루기, 선을 짧은 글자로 바꾸기 */
(function () {
  'use strict';
  const NS = (window.NS = window.NS || {});

  NS.TAU = Math.PI * 2;
  NS.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  NS.lerp = (a, b, t) => a + (b - a) * t;
  NS.rnd = (a, b) => a + Math.random() * (b - a);
  NS.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  NS.angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  NS.easeOut = (x) => 1 - Math.pow(1 - x, 3);
  NS.easeIn = (x) => x * x * x;
  NS.easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  NS.$ = (id) => document.getElementById(id);
  // 받은 숫자는 믿지 않는다: 숫자가 아니면 기본값, 범위 밖이면 자른다
  NS.num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? NS.clamp(v, lo, hi) : d);

  NS.PAL = {
    ink: '#23262b', paper: '#fbf8ef', line: '#bcd3ea', margin: '#ec9b9b',
    red: '#e0452b', orange: '#f08a24', yellow: '#f2c230', green: '#3a9a4a',
    blue: '#2f6fd6', purple: '#8a5cd6', pink: '#f39bb4', eraser: '#f28aa5', white: '#ffffff',
  };
  NS.BODY_COLORS = ['#e0452b', '#f08a24', '#f2c230', '#3a9a4a', '#2f6fd6', '#8a5cd6', '#f39bb4', '#23262b'];
  NS.safeColor = (c) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : NS.PAL.blue);
  NS.cleanName = (s) => {
    if (typeof s !== 'string') return '낙서';
    const t = s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, '').trim().slice(0, 8);
    return t || '낙서';
  };

  // 무기 잉크: 색마다 맞았을 때 효과가 다르다
  NS.INKS = {
    ink: { name: '먹물', color: '#23262b', fill: '#6b7078', desc: '피해 +15%' },
    fire: { name: '불꽃', color: '#e0452b', fill: '#f5a08c', desc: '맞으면 2초 동안 화상' },
    water: { name: '물', color: '#2f6fd6', fill: '#9cbcf0', desc: '맞으면 1.5초 느려짐' },
    vine: { name: '덩굴', color: '#3a9a4a', fill: '#a6d6a0', desc: '맞으면 0.6초 묶임' },
  };
  NS.safeInk = (k) => (Object.prototype.hasOwnProperty.call(NS.INKS, k) ? k : 'ink');

  /* ---------- 선(점 배열) ---------- */
  NS.polyLen = function (pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return L;
  };
  // 일정한 간격으로 다시 찍기
  NS.resample = function (pts, step) {
    if (!pts.length) return [];
    const out = [{ x: pts[0].x, y: pts[0].y }];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      let ax = pts[i - 1].x, ay = pts[i - 1].y;
      const bx = pts[i].x, by = pts[i].y;
      let seg = Math.hypot(bx - ax, by - ay);
      while (acc + seg >= step) {
        const t = (step - acc) / seg;
        ax += (bx - ax) * t;
        ay += (by - ay) * t;
        out.push({ x: ax, y: ay });
        seg = Math.hypot(bx - ax, by - ay);
        acc = 0;
      }
      acc += seg;
    }
    const last = pts[pts.length - 1], o = out[out.length - 1];
    if (Math.hypot(last.x - o.x, last.y - o.y) > step * 0.3) out.push({ x: last.x, y: last.y });
    return out;
  };
  // i번째 점에서 w칸 앞뒤로 본 꺾인 각도
  NS.turnAt = function (p, i, w) {
    const a = p[i - w], b = p[i], c = p[i + w];
    return NS.angDiff(Math.atan2(b.y - a.y, b.x - a.x), Math.atan2(c.y - b.y, c.x - b.x));
  };
  NS.area = function (pts) {
    let A = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) A += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
    return Math.abs(A / 2);
  };
  NS.centroid = function (pts) {
    let x = 0, y = 0;
    for (const p of pts) { x += p.x; y += p.y; }
    return { x: x / pts.length, y: y / pts.length };
  };
  // 두 선분이 교차하는지 (벽이 공격을 막는지 볼 때)
  NS.segCross = function (ax, ay, bx, by, cx, cy, dx, dy) {
    const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  // 점과 선분 사이 가장 가까운 점
  NS.closestOnSeg = function (px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy || 1;
    const t = NS.clamp(((px - ax) * vx + (py - ay) * vy) / L, 0, 1);
    return { x: ax + vx * t, y: ay + vy * t };
  };

  /* ---------- 선을 짧은 글자로 ----------
   * 좌표 하나 = 64진 두 글자(0~4095). 선과 선 사이는 '.'
   * scale/off로 원래 좌표 범위를 0~4095 안에 맞춘다.
   */
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const e2 = (v) => { const n = NS.clamp(Math.round(v), 0, 4095); return B64[n >> 6] + B64[n & 63]; };
  const d2 = (s, i) => B64.indexOf(s[i]) * 64 + B64.indexOf(s[i + 1]);
  NS.encStrokes = function (strokes, scale, off, step, maxLen) {
    return strokes
      .map((s) => NS.resample(s, step).map((p) => e2((p.x + off) * scale) + e2((p.y + off) * scale)).join(''))
      .join('.')
      .slice(0, maxLen || 2400);
  };
  NS.decStrokes = function (str, scale, off, maxLen) {
    if (typeof str !== 'string' || !str || str.length > (maxLen || 2400) || /[^A-Za-z0-9\-_.]/.test(str)) return null;
    const out = [];
    for (const part of str.split('.')) {
      const pts = [];
      for (let i = 0; i + 3 < part.length; i += 4) pts.push({ x: d2(part, i) / scale - off, y: d2(part, i + 2) / scale - off });
      if (pts.length > 1) out.push(pts);
    }
    return out.length ? out : null;
  };
})();
