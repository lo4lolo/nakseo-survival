/* 낙서 서바이벌 — 효과음 (파일 없이 Web Audio로 만든다) */
(function () {
  'use strict';
  const NS = window.NS;
  let ctx = null, master = null, noiseBuf = null;
  const S = (NS.Sfx = { muted: false });

  function ready() {
    if (S.muted) return false;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }
  S.unlock = ready;

  function tone(f0, f1, dur, type, vol, delay) {
    if (!ready()) return;
    const t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  function noise(dur, freq, q, vol, delay, sweep) {
    if (!ready()) return;
    const t = ctx.currentTime + (delay || 0);
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf;
    f.type = 'bandpass';
    f.Q.value = q || 1;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    g.gain.setValueAtTime(vol || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  S.swing = (mass) => noise(0.16 + 0.05 * (mass || 1), 900 / Math.sqrt(mass || 1), 1.2, 0.22, 0, 2600);
  S.hit = (mass, crit) => {
    tone(220 / Math.sqrt(mass || 1), 60, 0.16, 'triangle', 0.45);
    noise(0.08, 1800, 0.8, 0.3);
    if (crit) tone(1400, 900, 0.12, 'square', 0.12, 0.02);
  };
  S.block = () => { tone(900, 700, 0.1, 'square', 0.12); noise(0.06, 3000, 2, 0.2); };
  S.slam = (mass) => { tone(120, 40, 0.35, 'sine', 0.6); noise(0.3, 400 / Math.sqrt(mass || 1), 0.7, 0.35, 0, 120); };
  S.dash = () => noise(0.14, 600, 1, 0.18, 0, 1800);
  S.pop = () => { tone(600, 120, 0.25, 'triangle', 0.4); noise(0.2, 1200, 0.6, 0.3); };
  S.scribble = () => noise(0.05, NS.rnd(2500, 4000), 3, 0.05);
  S.build = () => { tone(300, 500, 0.12, 'triangle', 0.2); noise(0.1, 2000, 2, 0.1); };
  S.heal = () => { tone(520, 780, 0.2, 'sine', 0.15); tone(780, 1040, 0.2, 'sine', 0.12, 0.08); };
  S.ui = () => tone(660, 880, 0.07, 'square', 0.08);
  S.tick = () => tone(1000, 1000, 0.05, 'square', 0.07);
  S.go = () => { tone(440, 440, 0.12, 'square', 0.12); tone(660, 660, 0.12, 'square', 0.12, 0.12); tone(880, 880, 0.25, 'square', 0.12, 0.24); };
  S.win = () => [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.22, 'triangle', 0.25, i * 0.12));
  S.lose = () => [392, 330, 262].forEach((f, i) => tone(f, f * 0.98, 0.25, 'triangle', 0.22, i * 0.15));
  S.erase = () => noise(0.25, 700, 0.5, 0.12, 0, 300);
})();
