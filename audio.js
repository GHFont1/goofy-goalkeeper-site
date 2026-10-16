/* Synthesised stadium audio. Everything is generated on the device; there are no audio files. */
(function (root) {
'use strict';
const Sfx = {
  ctx: null, master: null, bedGain: null, enabled: true, crowd: true, noise: null,
  ensure() {
    if (this.ctx) return this.ctx;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = this.enabled ? 0.8 : 0; this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      this.startBed();
    } catch (e) { this.ctx = null; }
    return this.ctx;
  },
  unlock() { const c = this.ensure(); if (c && c.state === 'suspended') c.resume().catch(() => {}); },
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); },
  setEnabled(on) { this.enabled = on; if (this.master) this.master.gain.value = on ? 0.8 : 0; if (on) this.unlock(); },
  setCrowd(on) { this.crowd = on; if (this.bedGain) this.bedGain.gain.value = on ? 0.05 : 0; },
  startBed() {
    const c = this.ctx; if (!c) return;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
    const lfo = c.createOscillator(), lfoGain = c.createGain(); lfo.frequency.value = 0.13; lfoGain.gain.value = 260;
    lfo.connect(lfoGain); lfoGain.connect(bp.frequency); lfo.start();
    this.bedGain = c.createGain(); this.bedGain.gain.value = this.crowd ? 0.05 : 0;
    src.connect(bp); bp.connect(this.bedGain); this.bedGain.connect(this.master); src.start();
  },
  noiseBurst(dur, { type = 'bandpass', freq = 1000, q = 1, gain = 0.3, attack = 0.005, sweep = null } = {}) {
    const c = this.ensure(); if (!c || !this.enabled) return;
    const t = c.currentTime, src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t, Math.random()); src.stop(t + dur + 0.05);
  },
  tone(freq, dur, { type = 'sine', gain = 0.2, to = null, delay = 0 } = {}) {
    const c = this.ensure(); if (!c || !this.enabled) return;
    const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  },
  play(name, intensity = 1) {
    if (!this.enabled) return;
    switch (name) {
      case 'click': this.tone(880, 0.06, { type: 'triangle', gain: 0.08 }); break;
      case 'kick': this.tone(150, 0.16, { gain: 0.5, to: 50 }); this.noiseBurst(0.05, { freq: 2000, gain: 0.15 }); break;
      case 'whistle': this.tone(2800, 0.32, { type: 'square', gain: 0.05 }); this.tone(2950, 0.32, { type: 'square', gain: 0.04 }); break;
      case 'whistle-long': this.tone(2800, 0.9, { type: 'square', gain: 0.05 }); this.tone(2950, 0.9, { type: 'square', gain: 0.04 }); break;
      case 'slap': this.noiseBurst(0.12, { type: 'highpass', freq: 1400, gain: 0.5 }); this.tone(220, 0.08, { gain: 0.2, to: 90 }); break;
      case 'parry': this.noiseBurst(0.09, { type: 'highpass', freq: 1800, gain: 0.45 }); this.tone(330, 0.07, { gain: 0.18, to: 140 }); break;
      case 'net': this.noiseBurst(0.5, { type: 'lowpass', freq: 3000, gain: 0.25, sweep: 300 }); break;
      case 'post': [520, 1310, 2090, 2930].forEach((f, i) => this.tone(f, 0.9 - i * 0.15, { type: 'sine', gain: 0.12 / (i + 1) })); break;
      case 'dive': this.noiseBurst(0.22, { type: 'bandpass', freq: 500, q: 0.7, gain: 0.12, sweep: 1600 }); break;
      case 'thud': this.tone(90, 0.2, { gain: 0.3, to: 40 }); this.noiseBurst(0.15, { type: 'lowpass', freq: 500, gain: 0.2 }); break;
      case 'roar': this.noiseBurst(1.6 + intensity * 0.6, { freq: 900, q: 0.5, gain: 0.25 + 0.15 * intensity, attack: 0.08 }); break;
      case 'groan': this.noiseBurst(1.2, { freq: 500, q: 0.8, gain: 0.22, attack: 0.1, sweep: 240 }); break;
      case 'ooh': this.noiseBurst(0.9, { freq: 650, q: 1.2, gain: 0.2, attack: 0.08, sweep: 900 }); break;
      case 'unlock': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', gain: 0.12, delay: i * 0.09 })); break;
      case 'fanfare': [392, 523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', gain: 0.12, delay: i * 0.12 })); break;
      case 'fail': [392, 330, 262].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', gain: 0.1, delay: i * 0.16 })); break;
      case 'tick': this.tone(1200, 0.04, { type: 'square', gain: 0.03 }); break;
    }
  },
};
root.Sfx = Sfx;
})(window);
