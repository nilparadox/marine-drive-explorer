// Generated soundscape (no audio files): surf on the sea wall, city hum, wind aloft, the odd distant horn.
export function makeAudio() {
  let ctx = null, master, surfG, cityG, windG, on = false;
  const noiseBuf = (c, sec, brown) => {
    const b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    return b;
  };
  function start() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    // surf: pink-ish noise through a lowpass whose cutoff and level swell like waves
    const surf = ctx.createBufferSource(); surf.buffer = noiseBuf(ctx, 4, false); surf.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 0.4;
    surfG = ctx.createGain(); surfG.gain.value = 0;
    const swell = ctx.createGain(); swell.gain.value = 0.35;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11; const lfoG = ctx.createGain(); lfoG.gain.value = 0.25;
    lfo.connect(lfoG); lfoG.connect(swell.gain);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.07; const lfo2G = ctx.createGain(); lfo2G.gain.value = 380;
    lfo2.connect(lfo2G); lfo2G.connect(lp.frequency);
    surf.connect(lp); lp.connect(swell); swell.connect(surfG); surfG.connect(master);
    // city hum: brown noise, low
    const city = ctx.createBufferSource(); city.buffer = noiseBuf(ctx, 5, true); city.loop = true;
    const clp = ctx.createBiquadFilter(); clp.type = 'lowpass'; clp.frequency.value = 260;
    cityG = ctx.createGain(); cityG.gain.value = 0;
    city.connect(clp); clp.connect(cityG); cityG.connect(master);
    // wind when flying high
    const wind = ctx.createBufferSource(); wind.buffer = noiseBuf(ctx, 3, false); wind.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.6;
    windG = ctx.createGain(); windG.gain.value = 0;
    wind.connect(bp); bp.connect(windG); windG.connect(master);
    surf.start(); city.start(); wind.start(); lfo.start(); lfo2.start();
  }
  function horn() { // a short, far-away two-tone car horn
    if (!ctx || !on) return;
    const t = ctx.currentTime, g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.025, t + 0.03); g.gain.setValueAtTime(0.025, t + 0.28); g.gain.linearRampToValueAtTime(0, t + 0.36);
    for (const fr of [415, 520]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr * (0.95 + Math.random() * 0.1); o.connect(f); o.start(t); o.stop(t + 0.4); }
    f.connect(g); g.connect(master);
  }
  let hornT = 4;
  return {
    toggle() { start(); on = !on; master.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.4); if (ctx.state === 'suspended') ctx.resume(); return on; },
    get on() { return on; },
    // coast: metres to the sea (>=0), height: camera height, road: 0..1 closeness to traffic
    update(dt, coast, height, night) {
      if (!ctx || !on) return;
      const t = ctx.currentTime;
      const nearSea = Math.exp(-Math.max(0, coast) / 45) * Math.exp(-Math.max(0, height - 2) / 120);
      surfG.gain.setTargetAtTime(0.06 + 0.5 * nearSea, t, 0.5);
      cityG.gain.setTargetAtTime((0.22 + 0.2 * (1 - nearSea)) * (1 - 0.35 * night) * Math.exp(-Math.max(0, height - 10) / 400), t, 0.6);
      windG.gain.setTargetAtTime(Math.min(0.12, Math.max(0, height - 30) / 1200), t, 0.8);
      hornT -= dt;
      if (hornT < 0) { hornT = 3 + Math.random() * 9; if (height < 120) horn(); }
    },
  };
}
