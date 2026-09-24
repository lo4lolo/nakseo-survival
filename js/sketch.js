/* 낙서 서바이벌 — 스케치북: 무기 그리기, 그리는 동안 판정 결과를 바로 보여 준다 */
(function () {
  'use strict';
  const NS = window.NS, SK = NS.SK, $ = NS.$;

  const S = { open: false, strokes: [], cur: null, ink: 'ink', onDone: null, deadline: 0, dirty: true, lastTick: -1 };
  const pad = $('pad'), ctx = pad.getContext('2d');

  function inkUsed() {
    let L = 0;
    for (const s of S.strokes) L += NS.polyLen(s);
    if (S.cur) L += NS.polyLen(S.cur);
    return L;
  }

  function redraw() {
    const c = ctx, N = SK.SIZE;
    c.fillStyle = '#fbf8ef';
    c.fillRect(0, 0, N, N);
    c.strokeStyle = '#d6e3ef';
    c.lineWidth = 1;
    for (let i = 0; i <= N; i += 24) {
      c.beginPath(); c.moveTo(i + 0.5, 0); c.lineTo(i + 0.5, N); c.stroke();
      c.beginPath(); c.moveTo(0, i + 0.5); c.lineTo(N, i + 0.5); c.stroke();
    }
    // 사거리 눈금
    c.strokeStyle = 'rgba(35,38,43,0.14)';
    c.setLineDash([6, 6]);
    for (const r of [120, 240, 360]) { c.beginPath(); c.arc(SK.HX, SK.HY, r, Math.PI, 0); c.stroke(); }
    c.setLineDash([]);
    const all = S.strokes.concat(S.cur ? [S.cur] : []);
    const { auto } = NS.withHandle(all);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (auto) {
      c.strokeStyle = 'rgba(35,38,43,0.35)';
      c.setLineDash([8, 8]);
      c.lineWidth = 5;
      c.beginPath(); c.moveTo(auto[0].x, auto[0].y); c.lineTo(auto[1].x, auto[1].y); c.stroke();
      c.setLineDash([]);
    }
    const ink = NS.INKS[S.ink];
    // 닫힌 모양은 채워서 보여 준다
    for (const s of all) {
      if (!NS.closedOf(s) || NS.area(s) < 1500) continue;
      c.fillStyle = ink.fill;
      c.beginPath();
      s.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      c.closePath();
      c.fill();
    }
    c.strokeStyle = ink.color;
    c.lineWidth = 7;
    for (const s of all) {
      c.beginPath();
      s.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      c.stroke();
    }
    // 손잡이 점
    c.fillStyle = '#e0452b';
    c.strokeStyle = '#23262b';
    c.lineWidth = 3;
    c.beginPath(); c.arc(SK.HX, SK.HY, 11, 0, NS.TAU); c.fill(); c.stroke();
    c.fillStyle = '#23262b';
    c.font = "22px 'Nanum Pen Script', sans-serif";
    c.fillText('손잡이', SK.HX + 16, SK.HY + 8);
  }

  const BAR_NAMES = { reach: '사거리', weight: '무게', speed: '속도', power: '파괴력' };
  function refreshInfo() {
    const all = S.strokes.concat(S.cur ? [S.cur] : []);
    const st = NS.analyzeWeapon(all, S.ink);
    if (!st) {
      $('sk-type').textContent = '?';
      $('sk-desc').textContent = '손잡이 점에서부터 무기를 그려 보세요.';
      $('sk-traits').textContent = '';
      $('sk-bars').innerHTML = '';
    } else {
      $('sk-type').textContent = st.label;
      $('sk-desc').textContent = st.desc;
      $('sk-traits').textContent = st.traits.join(' · ');
      $('sk-bars').innerHTML = Object.keys(BAR_NAMES)
        .map((k) => `<div class="sbar"><span>${BAR_NAMES[k]}</span><i><b style="width:${Math.round(st.bars[k] * 100)}%"></b></i></div>`)
        .join('');
      for (const li of $('sk-guide').children) li.classList.toggle('on', li.dataset.type === st.type);
    }
    const used = inkUsed();
    $('sk-ink').style.width = Math.min(100, (used / SK.LIMIT) * 100) + '%';
    $('sk-ink-n').textContent = Math.round((used / SK.LIMIT) * 100) + '%';
    $('sk-done').disabled = !st;
  }

  function padPoint(e) {
    const r = pad.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * SK.SIZE, y: ((e.clientY - r.top) / r.height) * SK.SIZE };
  }
  pad.addEventListener('pointerdown', (e) => {
    if (!S.open) return;
    e.preventDefault();
    pad.setPointerCapture(e.pointerId);
    if (inkUsed() >= SK.LIMIT) { NS.Sfx.block(); return; }
    S.cur = [padPoint(e)];
    S.dirty = true;
  });
  pad.addEventListener('pointermove', (e) => {
    if (!S.cur) return;
    const p = padPoint(e), q = S.cur[S.cur.length - 1];
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < 3) return;
    if (inkUsed() + d > SK.LIMIT) return;
    S.cur.push({ x: NS.clamp(p.x, 0, SK.SIZE), y: NS.clamp(p.y, 0, SK.SIZE) });
    if (Math.random() < 0.25) NS.Sfx.scribble();
    S.dirty = true;
  });
  const endStroke = () => {
    if (!S.cur) return;
    if (S.cur.length > 1) S.strokes.push(S.cur);
    S.cur = null;
    S.dirty = true;
  };
  pad.addEventListener('pointerup', endStroke);
  pad.addEventListener('pointercancel', endStroke);

  $('sk-undo').addEventListener('click', () => { S.strokes.pop(); S.dirty = true; NS.Sfx.ui(); });
  $('sk-clear').addEventListener('click', () => { S.strokes = []; S.dirty = true; NS.Sfx.ui(); });
  $('sk-done').addEventListener('click', () => close(true));

  // 잉크 색 고르기
  const inkBox = $('inks');
  for (const k of Object.keys(NS.INKS)) {
    const b = document.createElement('button');
    b.className = 'ink-btn';
    b.dataset.ink = k;
    b.title = NS.INKS[k].name + ': ' + NS.INKS[k].desc;
    b.innerHTML = `<i style="background:${NS.INKS[k].color}"></i><span>${NS.INKS[k].name}</span>`;
    b.addEventListener('click', () => { S.ink = k; syncInk(); S.dirty = true; NS.Sfx.ui(); });
    inkBox.appendChild(b);
  }
  function syncInk() { for (const b of inkBox.children) b.classList.toggle('on', b.dataset.ink === S.ink); }

  // 모양 안내 (누르면 예시 그림)
  const guide = $('sk-guide');
  for (const k of Object.keys(NS.WEAPON_TYPES)) {
    const t = NS.WEAPON_TYPES[k];
    const li = document.createElement('li');
    li.dataset.type = k;
    li.innerHTML = `<b>${t.name}</b> <span>${t.how}</span><em>예시</em>`;
    li.title = '누르면 예시 그림을 불러와요';
    li.addEventListener('click', () => { S.strokes = NS.PRESETS[k](); S.dirty = true; NS.Sfx.ui(); });
    guide.appendChild(li);
  }

  function open(o) {
    o = o || {};
    S.open = true;
    S.strokes = (o.strokes || []).map((s) => s.map((p) => ({ x: p.x, y: p.y })));
    S.ink = NS.safeInk(o.ink);
    S.onDone = o.onDone || null;
    S.deadline = o.deadline || 0;
    S.cur = null;
    S.dirty = true;
    S.lastTick = -1;
    syncInk();
    $('sketch').hidden = false;
    $('sk-timer').hidden = !S.deadline;
  }
  function close(accept) {
    if (!S.open) return;
    endStroke();
    S.open = false;
    $('sketch').hidden = true;
    const cb = S.onDone;
    S.onDone = null;
    if (cb) {
      const st = NS.analyzeWeapon(S.strokes, S.ink);
      cb(accept && st ? { strokes: S.strokes, ink: S.ink, stats: st } : null);
    }
  }

  NS.Sketch = {
    open, close,
    isOpen: () => S.open,
    setDeadline(t) { S.deadline = t; $('sk-timer').hidden = !t; },
    update() {
      if (!S.open) return;
      if (S.dirty) { S.dirty = false; redraw(); refreshInfo(); }
      if (S.deadline) {
        const left = Math.max(0, Math.ceil((S.deadline - performance.now()) / 1000));
        if (left !== S.lastTick) {
          S.lastTick = left;
          $('sk-timer').textContent = `${left}초 뒤 난투 시작!`;
          $('sk-timer').classList.toggle('hurry', left <= 5);
          if (left <= 5 && left > 0) NS.Sfx.tick();
        }
      }
    },
  };
})();
