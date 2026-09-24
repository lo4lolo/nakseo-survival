/* 낙서 서바이벌 — 3D 무대: 공책 바닥, 빛, 툰 재질, 지우개 자기장, 효과(파편, 얼룩, 글자) */
(function () {
  'use strict';
  const NS = window.NS, T = window.THREE, PAL = NS.PAL;
  const ARENA = (NS.ARENA = 20);   // 움직일 수 있는 범위: -20~20 정사각형

  const canvas = NS.$('view');
  const renderer = new T.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  scene.background = new T.Color('#d8c7a4');
  const camera = new T.PerspectiveCamera(42, 1, 0.5, 200);
  camera.position.set(0, 22, 15);
  camera.lookAt(0, 0, 0);
  NS.renderer = renderer; NS.scene = scene; NS.camera = camera;

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 세로 화면에서는 조금 더 멀리서 본다
    camera.fov = w < h ? 58 : 42;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  scene.add(new T.HemisphereLight('#ffffff', '#b9a98a', 1.4));
  const sun = new T.DirectionalLight('#fff6e6', 1.9);
  sun.position.set(-10, 26, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);

  /* ---------- 툰 재질과 외곽선 ---------- */
  const grad = new T.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, T.RedFormat);
  grad.minFilter = grad.magFilter = T.NearestFilter;
  grad.needsUpdate = true;
  const toonCache = new Map();
  NS.toon = function (color, fresh) {
    if (!fresh && toonCache.has(color)) return toonCache.get(color);
    const m = new T.MeshToonMaterial({ color, gradientMap: grad });
    if (!fresh) toonCache.set(color, m);
    return m;
  };
  const outlineMat = new T.MeshBasicMaterial({ color: PAL.ink, side: T.BackSide });
  NS.outline = function (mesh, s) {
    const o = new T.Mesh(mesh.geometry, outlineMat);
    o.scale.setScalar(s || 1.08);
    mesh.add(o);
    return o;
  };

  /* ---------- 공책 바닥 ---------- */
  const PAGE = ARENA + 2.5;
  function paperTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 2048;
    const x = c.getContext('2d');
    x.fillStyle = PAL.paper;
    x.fillRect(0, 0, 2048, 2048);
    const u = 2048 / (PAGE * 2);   // 1 월드 단위 = u px
    x.strokeStyle = PAL.line;
    x.lineWidth = 3;
    for (let y = u * 1.5; y < 2048; y += u * 1.2) { x.beginPath(); x.moveTo(0, y); x.lineTo(2048, y); x.stroke(); }
    x.strokeStyle = PAL.margin;
    x.lineWidth = 4;
    x.beginPath(); x.moveTo(u * 3, 0); x.lineTo(u * 3, 2048); x.stroke();
    // 구석의 연필 낙서
    x.strokeStyle = 'rgba(35,38,43,0.25)';
    x.lineWidth = 5;
    x.lineCap = 'round';
    const star = (cx, cy, r) => { x.beginPath(); for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5; x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } x.stroke(); };
    const spiral = (cx, cy) => { x.beginPath(); for (let i = 0; i < 90; i++) { const a = i * 0.25, r = i * 0.9; x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } x.stroke(); };
    star(1850, 190, 60); star(260, 1830, 45); spiral(1820, 1800); spiral(330, 260);
    x.beginPath(); x.arc(1030, 1024, 150, 0, 6.283); x.stroke();   // 가운데 표시
    x.font = "bold 96px 'Nanum Pen Script', sans-serif";
    x.fillStyle = 'rgba(35,38,43,0.3)';
    x.fillText('낙서 서바이벌', 1480, 1990);
    const tex = new T.CanvasTexture(c);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.colorSpace = T.SRGBColorSpace;
    return tex;
  }
  const ground = new T.Mesh(new T.PlaneGeometry(PAGE * 2, PAGE * 2), new T.MeshToonMaterial({ map: paperTexture(), gradientMap: grad }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  NS.ground = ground;
  // 공책 두께와 책상
  const block = new T.Mesh(new T.BoxGeometry(PAGE * 2, 0.6, PAGE * 2), NS.toon('#efe9da'));
  block.position.y = -0.31;
  scene.add(block);
  const desk = new T.Mesh(new T.PlaneGeometry(300, 300), NS.toon('#caa979'));
  desk.rotation.x = -Math.PI / 2;
  desk.position.y = -0.62;
  desk.receiveShadow = true;
  scene.add(desk);
  // 스프링
  const ringMat = NS.toon('#9aa2ad');
  for (let i = -PAGE + 1.5; i < PAGE - 1; i += 2.2) {
    const r = new T.Mesh(new T.TorusGeometry(0.7, 0.12, 8, 18), ringMat);
    r.position.set(i, 0.1, -PAGE - 0.1);
    r.castShadow = true;
    scene.add(r);
  }
  // 눈에 보이는 경계선(점선 네모)
  const border = new T.LineLoop(
    new T.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new T.Vector3(a * (ARENA + 0.6), 0.02, b * (ARENA + 0.6)))),
    new T.LineDashedMaterial({ color: PAL.ink, dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.35 })
  );
  border.computeLineDistances();
  scene.add(border);

  /* ---------- 지우개 자기장: 반지름 밖은 하얗게 지워진다 ---------- */
  const zoneMat = new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uR: { value: 99 }, uT: { value: 0 } },
    vertexShader: 'varying vec2 vP; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: [
      'uniform float uR; uniform float uT; varying vec2 vP;',
      'void main(){',
      '  float d = length(vP);',
      '  if (d < uR) discard;',
      '  float edge = 1.0 - smoothstep(uR, uR + 1.2, d);',
      '  float n = fract(sin(dot(floor(vP * 3.0), vec2(12.9898, 78.233))) * 43758.5453);',
      '  vec3 col = mix(vec3(0.99, 0.98, 0.97), vec3(0.95, 0.93, 0.93), step(0.85, n));',
      '  float band = step(0.5, fract((vP.x + vP.y) * 0.25 - uT * 0.2));',
      '  col = mix(col, col * 0.96, band);',
      '  col = mix(col, vec3(0.95, 0.54, 0.65), edge);',
      '  gl_FragColor = vec4(col, 0.94);',
      '}',
    ].join('\n'),
  });
  const zoneMesh = new T.Mesh(new T.PlaneGeometry(120, 120), zoneMat);
  zoneMesh.rotation.x = -Math.PI / 2;
  zoneMesh.position.y = 0.04;
  zoneMesh.renderOrder = 2;
  zoneMesh.visible = false;
  scene.add(zoneMesh);
  // 자기장 둘레를 문지르며 도는 지우개들
  const erasers = [];
  const eraserMat = NS.toon(PAL.eraser), sleeveMat = NS.toon('#3a6bd1');
  for (let i = 0; i < 8; i++) {
    const g = new T.Group();
    const a = new T.Mesh(new T.BoxGeometry(1.6, 0.8, 0.9), eraserMat);
    const b = new T.Mesh(new T.BoxGeometry(1.0, 0.84, 0.94), sleeveMat);
    b.position.x = 0.45;
    for (const m of [a, b]) { NS.outline(m, 1.06); m.castShadow = true; g.add(m); }
    g.visible = false;
    scene.add(g);
    erasers.push(g);
  }
  NS.zone = {
    r: 99,
    set(r, t) {
      this.r = r;
      const on = r < 40;
      zoneMesh.visible = on;
      zoneMat.uniforms.uR.value = r;
      zoneMat.uniforms.uT.value = t;
      erasers.forEach((g, i) => {
        g.visible = on;
        if (!on) return;
        const a = (i / erasers.length) * NS.TAU + t * 0.25 + Math.sin(t * 3 + i) * 0.03;
        g.position.set(Math.cos(a) * (r + 0.5), 0.45 + Math.abs(Math.sin(t * 8 + i)) * 0.15, Math.sin(a) * (r + 0.5));
        g.rotation.y = -a + Math.PI / 2 + Math.sin(t * 10 + i) * 0.25;
      });
    },
  };

  /* ---------- 효과 ---------- */
  const parts = [];
  const partGeo = new T.BoxGeometry(1, 1, 1);
  function burst(x, y, z, o) {
    o = o || {};
    const cols = [].concat(o.color || PAL.ink);
    for (let i = 0; i < (o.n || 12); i++) {
      const m = new T.Mesh(partGeo, NS.toon(NS.pick(cols)));
      const s = (o.size || 0.15) * NS.rnd(0.6, 1.4);
      m.scale.setScalar(s);
      m.position.set(x, y, z);
      const a = Math.random() * NS.TAU, sp = (o.speed || 6) * NS.rnd(0.4, 1);
      parts.push({ m, vx: Math.cos(a) * sp, vy: (o.up || 5) * NS.rnd(0.5, 1.2), vz: Math.sin(a) * sp, life: NS.rnd(0.5, 0.9), s, spin: NS.rnd(-10, 10) });
      scene.add(m);
    }
  }
  const splats = [];
  const splatGeo = new T.CircleGeometry(1, 14);
  function splat(x, z, color, size) {
    const m = new T.Mesh(splatGeo, new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * NS.TAU;
    m.position.set(x, 0.015 + splats.length * 0.0002, z);
    m.scale.set(size * NS.rnd(0.8, 1.2), size * NS.rnd(0.6, 1), 1);
    scene.add(m);
    splats.push({ m, life: 14 });
    if (splats.length > 60) { const s = splats.shift(); scene.remove(s.m); s.m.material.dispose(); }
  }
  const rings = [];
  const ringGeo = new T.RingGeometry(0.85, 1, 40);
  function ring(x, z, r, color, dur) {
    const m = new T.Mesh(ringGeo, new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: T.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.06, z);
    scene.add(m);
    rings.push({ m, r, t: 0, dur: dur || 0.4 });
  }
  // 글자 튀어 오르기 (DOM)
  const popLayer = NS.$('pops');
  const pops = [];
  const v3 = new T.Vector3();
  function toScreen(x, y, z) {
    v3.set(x, y, z).project(camera);
    return { x: (v3.x * 0.5 + 0.5) * window.innerWidth, y: (-v3.y * 0.5 + 0.5) * window.innerHeight, front: v3.z < 1 };
  }
  NS.toScreen = toScreen;
  function popup(text, x, y, z, o) {
    o = o || {};
    const el = document.createElement('div');
    el.className = 'pop';
    el.textContent = text;
    el.style.color = o.color || PAL.ink;
    el.style.fontSize = (o.size || 1) * 26 + 'px';
    popLayer.appendChild(el);
    pops.push({ el, x, y, z, t: 0, dur: o.dur || 0.9 });
    if (pops.length > 30) { const p = pops.shift(); p.el.remove(); }
  }
  let shakeAmt = 0;
  NS.fx = {
    burst, splat, ring, popup,
    shake(a) { shakeAmt = Math.min(1, shakeAmt + a); },
    clearGround() { for (const s of splats) { scene.remove(s.m); s.m.material.dispose(); } splats.length = 0; },
    update(dt) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= dt;
        p.vy -= 22 * dt;
        p.m.position.x += p.vx * dt;
        p.m.position.y = Math.max(0.05, p.m.position.y + p.vy * dt);
        p.m.position.z += p.vz * dt;
        if (p.m.position.y <= 0.05) { p.vx *= 0.8; p.vz *= 0.8; p.vy = Math.abs(p.vy) * 0.3; }
        p.m.rotation.x += p.spin * dt;
        p.m.rotation.y += p.spin * dt;
        p.m.scale.setScalar(p.s * Math.min(1, p.life * 3));
        if (p.life <= 0) { scene.remove(p.m); parts.splice(i, 1); }
      }
      for (let i = splats.length - 1; i >= 0; i--) {
        const s = splats[i];
        s.life -= dt;
        if (s.life < 2) s.m.material.opacity = 0.75 * Math.max(0, s.life / 2);
        if (s.life <= 0) { scene.remove(s.m); s.m.material.dispose(); splats.splice(i, 1); }
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.t += dt;
        const k = r.t / r.dur;
        r.m.scale.setScalar(Math.max(0.01, r.r * NS.easeOut(Math.min(1, k))));
        r.m.material.opacity = 0.9 * (1 - k);
        if (k >= 1) { scene.remove(r.m); r.m.material.dispose(); rings.splice(i, 1); }
      }
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i];
        p.t += dt;
        const k = p.t / p.dur;
        const s = toScreen(p.x, p.y + NS.easeOut(Math.min(1, k)) * 1.2, p.z);
        p.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%) scale(${k < 0.15 ? 0.6 + k * 3 : 1})`;
        p.el.style.opacity = k > 0.7 ? (1 - k) / 0.3 : 1;
        if (k >= 1) { p.el.remove(); pops.splice(i, 1); }
      }
    },
  };

  /* ---------- 카메라 ---------- */
  const camTarget = new T.Vector3();
  NS.cam = {
    shakeLevel: 1,
    follow(x, z, dt, far) {
      const k = dt ? Math.min(1, dt * 6) : 1;
      camTarget.x += (x - camTarget.x) * k;
      camTarget.z += (z - camTarget.z) * k;
      const h = far === 'title' ? 8 : far ? 28 : 16, back = far === 'title' ? 7.5 : far ? 17 : 11;
      shakeAmt = Math.max(0, shakeAmt - (dt || 0) * 2.5);
      const s = shakeAmt * shakeAmt * 0.8 * this.shakeLevel;
      camera.position.set(camTarget.x + (Math.random() - 0.5) * s, h + (Math.random() - 0.5) * s, camTarget.z + back + (Math.random() - 0.5) * s);
      camera.lookAt(camTarget.x, 0, camTarget.z + 0.5);
      sun.position.set(camTarget.x - 10, 26, camTarget.z + 14);
      sun.target.position.set(camTarget.x, 0, camTarget.z);
    },
  };

  // 화면 좌표 → 바닥(y=0) 위의 점
  const ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0), ndc = new T.Vector2(), hit = new T.Vector3();
  NS.screenToGround = function (sx, sy) {
    ndc.set((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, z: hit.z } : null;
  };

  NS.render = () => renderer.render(scene, camera);
})();
