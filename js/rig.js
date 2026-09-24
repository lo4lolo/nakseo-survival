/* 낙서 서바이벌 — 캐릭터 몸, 그림으로 만든 3D 무기, 공격 자세
 * 나, 다른 사람, 허수아비가 모두 같은 코드를 쓴다.
 * 무기가 맞았는지는 그림 선 위의 점(samples)으로 판정한다. 보이는 모양 = 맞는 모양.
 */
(function () {
  'use strict';
  const NS = window.NS, T = window.THREE, PAL = NS.PAL, SK = NS.SK;
  const { lerp, easeOut, easeIn, easeInOut, clamp } = NS;

  const eyeGeo = new T.SphereGeometry(0.075, 10, 8), eyeMat = new T.MeshBasicMaterial({ color: PAL.ink });
  const bodyGeo = new T.SphereGeometry(0.6, 24, 16);
  const legGeo = new T.CylinderGeometry(0.1, 0.1, 0.32, 8);
  const bandGeo = new T.TorusGeometry(0.56, 0.075, 8, 28);

  NS.makeRig = function (color, o) {
    o = o || {};
    const root = new T.Group();
    const bodyG = new T.Group();
    root.add(bodyG);
    const bodyMat = NS.toon(o.bodyColor || '#ffffff', true);
    const body = new T.Mesh(bodyGeo, bodyMat);
    body.scale.set(1, 0.92, 1);
    body.position.y = 0.66;
    body.castShadow = true;
    NS.outline(body, 1.07);
    bodyG.add(body);
    for (const sx of [-1, 1]) {
      const e = new T.Mesh(eyeGeo, eyeMat);
      e.position.set(sx * 0.19, 0.78, 0.52);
      e.scale.set(0.8, 1.3, 0.6);
      bodyG.add(e);
    }
    const bandMat = NS.toon(color, true);
    const band = new T.Mesh(bandGeo, bandMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.98;
    bodyG.add(band);
    const tail = new T.Mesh(new T.BoxGeometry(0.1, 0.08, 0.34), bandMat);
    tail.position.set(0.1, 0.9, -0.66);
    tail.rotation.set(0.5, 0.3, 0);
    bodyG.add(tail);
    const legs = [];
    for (const sx of [-1, 1]) {
      const L = new T.Mesh(legGeo, NS.toon(PAL.ink));
      L.position.set(sx * 0.22, 0.14, 0);
      L.castShadow = true;
      root.add(L);
      legs.push({ m: L, side: sx });
    }
    // 왕관(우승을 가장 많이 한 사람)
    const crown = new T.Group();
    const cb = new T.Mesh(new T.CylinderGeometry(0.28, 0.3, 0.18, 10, 1, true), NS.toon(PAL.yellow));
    crown.add(cb);
    for (let i = 0; i < 5; i++) {
      const s = new T.Mesh(new T.ConeGeometry(0.07, 0.2, 6), NS.toon(PAL.yellow));
      const a = (i / 5) * NS.TAU;
      s.position.set(Math.cos(a) * 0.27, 0.18, Math.sin(a) * 0.27);
      crown.add(s);
    }
    crown.position.y = 1.42;
    crown.visible = false;
    bodyG.add(crown);
    // 팔: 몸 앞 가운데에서 무기를 든다. yaw(좌우) → pitch(위아래) → fwd(앞으로 내밀기)
    const yawG = new T.Group();
    yawG.position.set(0, 0.72, 0.18);
    const pitchG = new T.Group();
    const fwdG = new T.Group();
    yawG.add(pitchG);
    pitchG.add(fwdG);
    root.add(yawG);
    return { root, bodyG, body, bodyMat, bandMat, legs, crown, yawG, pitchG, fwdG, weapon: null, samples: [], stats: null, pts: [] };
  };

  NS.disposeRig = function (rig) {
    clearWeapon(rig);
    if (rig.root.parent) rig.root.parent.remove(rig.root);
  };

  function clearWeapon(rig) {
    if (!rig.weapon) return;
    rig.fwdG.remove(rig.weapon);
    rig.weapon.traverse((o) => { if (o.geometry && o.userData.own) o.geometry.dispose(); });
    rig.weapon = null;
  }

  const toLocal = (p) => new T.Vector3((p.x - SK.HX) * SK.S, (SK.HY - p.y) * SK.S, 0);

  // 그림 → 3D 무기. 선은 튜브, 닫힌 모양은 두께 있는 판
  NS.buildWeapon = function (raw, inkKey) {
    const ink = NS.INKS[NS.safeInk(inkKey)];
    const { strokes } = NS.withHandle(raw || []);
    const g = new T.Group();
    const lineMat = NS.toon(ink.color), fillMat = NS.toon(ink.fill);
    const samples = [];
    let R = 0;
    for (const s of strokes) {
      const isClosed = NS.closedOf(s);
      const p = NS.resample(s, 10);
      if (p.length < 2) continue;
      const v = p.map(toLocal);
      const loop = isClosed && v.length > 3;
      if (loop) v.pop();
      const curve = new T.CatmullRomCurve3(v, loop, 'centripetal');
      const tubeGeo = new T.TubeGeometry(curve, Math.max(8, v.length * 3), 0.06, 6, loop);
      const tube = new T.Mesh(tubeGeo, lineMat);
      tube.userData.own = true;
      tube.castShadow = true;
      g.add(tube);
      for (const q of v) { samples.push(q.clone()); R = Math.max(R, q.length()); }
      if (loop && NS.area(s) > 1500) {
        const shape = new T.Shape(v.map((q) => new T.Vector2(q.x, q.y)));
        const geo = new T.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false });
        geo.translate(0, 0, -0.05);
        const m = new T.Mesh(geo, fillMat);
        m.userData.own = true;
        m.castShadow = true;
        g.add(m);
        // 판 안쪽도 맞는 자리
        const c = NS.centroid(v);
        for (let i = 0; i < v.length; i += 2) samples.push(new T.Vector3((v[i].x + c.x) / 2, (v[i].y + c.y) / 2, 0));
        samples.push(new T.Vector3(c.x, c.y, 0));
      }
    }
    const grip = new T.Mesh(new T.CylinderGeometry(0.085, 0.085, 0.32, 8), NS.toon(PAL.ink));
    grip.userData.own = true;
    grip.position.y = 0.04;
    g.add(grip);
    for (const q of samples) q.tip = R ? q.length() / R : 1;
    g.rotation.x = Math.PI / 2;   // 그림의 위쪽(길이 방향)이 몸의 앞쪽(+z)을 향하게
    g.userData.samples = samples;
    g.userData.reach = R;
    return g;
  };

  NS.setRigWeapon = function (rig, strokes, inkKey, stats) {
    clearWeapon(rig);
    const w = NS.buildWeapon(strokes, inkKey);
    rig.fwdG.add(w);
    rig.weapon = w;
    rig.samples = w.userData.samples;
    rig.stats = stats;
    rig.pts = rig.samples.map(() => ({ x: 0, y: 0, z: 0, tip: 0 }));
  };

  // 무기 판정점의 월드 좌표 (미리 만든 배열을 다시 쓴다)
  const tmp = new T.Vector3();
  NS.rigPoints = function (rig) {
    if (!rig.weapon) return [];
    rig.root.updateMatrixWorld(true);
    const M = rig.weapon.matrixWorld;
    for (let i = 0; i < rig.samples.length; i++) {
      tmp.copy(rig.samples[i]).applyMatrix4(M);
      const o = rig.pts[i];
      o.x = tmp.x; o.y = tmp.y; o.z = tmp.z; o.tip = rig.samples[i].tip;
    }
    return rig.pts;
  };

  /* ---------- 자세 ----------
   * k: 공격 진행(0~1). active: 이때만 맞는다.
   */
  NS.idlePose = (type) => (type === 'shield' ? { yaw: 0, pitch: 1.35, fwd: 0.3 } : type === 'hammer' ? { yaw: 0.45, pitch: 1.15, fwd: 0 } : { yaw: 0.4, pitch: 0.9, fwd: 0 });

  function swing(idle, A, B, k, w0, w1, pitch) {
    if (k < w0) { const u = easeOut(k / w0); return { yaw: lerp(idle.yaw, A, u), pitch: lerp(idle.pitch, pitch, u), fwd: 0, active: false }; }
    if (k < w1) { const u = easeOut((k - w0) / (w1 - w0)); return { yaw: lerp(A, B, u), pitch, fwd: 0.1, active: true }; }
    const u = easeInOut((k - w1) / (1 - w1));
    return { yaw: lerp(B, idle.yaw, u), pitch: lerp(pitch, idle.pitch, u), fwd: 0, active: false };
  }

  NS.pose = function (type, step, k) {
    const idle = NS.idlePose(type);
    k = clamp(k, 0, 1);
    if (type === 'blade') {
      if (step === 2) {
        if (k < 0.15) { const u = easeOut(k / 0.15); return { yaw: lerp(idle.yaw, 1.2, u), pitch: lerp(idle.pitch, 0.1, u), fwd: 0, active: false }; }
        if (k < 0.78) { const u = easeInOut((k - 0.15) / 0.63); return { yaw: 1.2 - NS.TAU * u, pitch: 0.1, fwd: 0.15, active: true }; }
        const u = easeInOut((k - 0.78) / 0.22);
        return { yaw: lerp(1.2 - NS.TAU, idle.yaw - NS.TAU, u), pitch: lerp(0.1, idle.pitch, u), fwd: 0, active: false };
      }
      const d = step === 1 ? -1 : 1;
      return swing(idle, 1.9 * d, -1.9 * d, k, 0.2, 0.62, 0.12);
    }
    if (type === 'whip') {
      const d = step === 1 ? -1 : 1;
      return swing(idle, 2.3 * d, -2.3 * d, k, 0.24, 0.7, 0.16);
    }
    if (type === 'spear') {
      if (k < 0.28) { const u = easeOut(k / 0.28); return { yaw: lerp(idle.yaw, 0, u), pitch: lerp(idle.pitch, 0.06, u), fwd: -0.5 * u, active: false }; }
      if (k < 0.5) { const u = easeOut((k - 0.28) / 0.22); return { yaw: 0, pitch: 0.06, fwd: lerp(-0.5, 1.1, u), active: true }; }
      if (k < 0.62) return { yaw: 0, pitch: 0.06, fwd: 1.1, active: true };
      const u = easeInOut((k - 0.62) / 0.38);
      return { yaw: lerp(0, idle.yaw, u), pitch: lerp(0.06, idle.pitch, u), fwd: lerp(1.1, 0, u), active: false };
    }
    if (type === 'hammer') {
      if (k < 0.38) { const u = easeOut(k / 0.38); return { yaw: lerp(idle.yaw, 0, u), pitch: lerp(idle.pitch, 2.45, u), fwd: 0, active: false }; }
      if (k < 0.56) { const u = easeIn((k - 0.38) / 0.18); return { yaw: 0, pitch: lerp(2.45, -0.04, u), fwd: 0.1, active: u > 0.35 }; }
      if (k < 0.8) return { yaw: 0, pitch: -0.04, fwd: 0.1, active: false };
      const u = easeInOut((k - 0.8) / 0.2);
      return { yaw: lerp(0, idle.yaw, u), pitch: lerp(-0.04, idle.pitch, u), fwd: 0, active: false };
    }
    if (type === 'shield') {
      if (k < 0.2) { const u = easeOut(k / 0.2); return { yaw: 0, pitch: 1.35, fwd: lerp(0.3, -0.1, u), active: false }; }
      if (k < 0.45) { const u = easeOut((k - 0.2) / 0.25); return { yaw: 0, pitch: 1.35, fwd: lerp(-0.1, 1.2, u), active: true }; }
      const u = easeInOut((k - 0.45) / 0.55);
      return { yaw: 0, pitch: 1.35, fwd: lerp(1.2, 0.3, u), active: false };
    }
    return { ...idle, active: false };
  };

  NS.setPose = function (rig, p) {
    rig.yawG.rotation.y = p.yaw;
    rig.pitchG.rotation.x = -p.pitch;
    rig.fwdG.position.z = p.fwd;
  };

  // 공격 시간(콤보 단계별)
  NS.atkDur = function (st, step) {
    if (st.type === 'blade' && step === 2) return st.dur * 1.5;
    return st.dur;
  };
  NS.HAMMER_IMPACT = 0.56;
  NS.hammerCenter = function (x, z, face, st) {
    const d = Math.max(1.2, st.reach * 0.9 + 0.3);
    return { x: x + Math.sin(face) * d, z: z + Math.cos(face) * d };
  };
  NS.slamRadius = (st) => 1.3 + st.mass * 0.45;

  // 걷기와 숨쉬기
  NS.animateBody = function (rig, dt, moving, t) {
    rig.walkT = (rig.walkT || 0) + (moving ? dt * 13 : 0);
    const bob = moving ? Math.abs(Math.sin(rig.walkT)) * 0.12 : Math.sin(t * 3) * 0.02;
    rig.bodyG.position.y = bob;
    for (const L of rig.legs) L.m.rotation.x = moving ? Math.sin(rig.walkT + L.side * 1.6) * 0.8 : 0;
  };
})();
