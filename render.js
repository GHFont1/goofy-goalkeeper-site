/* Goofy Goalkeeper renderer: floodlit stadium, perspective pitch, keeper, strikers, ball and effects. */
(function (root) {
'use strict';
const GG = root.GG;
const TAU = Math.PI * 2;
const ease = t => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
const lerp = (a, b, t) => a + (b - a) * t;

const R = {
  canvas: null, ctx: null, W: 0, H: 0, dpr: 1, stands: null, standsKey: '',
  particles: [], shake: 0, excite: 0, flashes: [], reducedMotion: false, crowdColors: ['#d8f56d', '#ff6b4a'],
  init(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.resize(); },
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.dpr = Math.min(3, root.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.W * this.dpr); this.canvas.height = Math.round(this.H * this.dpr);
    this.layout(); this.stands = null;
  },
  layout() {
    const { W, H } = this;
    // keeper view: camera behind the goal
    const half = Math.min(W * 0.45, H * 0.24);
    this.K = { cx: W / 2, hy: H * 0.33, gy: H * (W / H > 0.5 ? 0.8 : 0.765), xs: half / 3.66, ys: half / 3.66 * 1.12, F: 7.5 };
    // attack view: camera behind the ball
    const kG = 6 / 17, halfA = Math.min(W * 0.4, H * 0.21);
    this.A = { cx: W / 2, hy: H * 0.36, gy: H * 0.88, xs: halfA / (3.66 * kG), ys: halfA / (3.66 * kG) * 1.12, F: 6, goalZ: 11 };
  },
  proj(P, X, Y, Z) {
    const k = P.F / (P.F + Math.max(Z, -P.F * 0.6));
    return { x: P.cx + X * P.xs * k, y: P.hy + (P.gy - P.hy) * k - Y * P.ys * k, k };
  },
  // screen point -> goal-plane metres (keeper view)
  toGoal(px, py) {
    const P = this.K;
    return { x: (px - P.cx) / P.xs, y: Math.max(0, (P.gy - py) / P.ys) };
  },
  fromGoal(x, y) { return this.proj(this.K, x, y, 0); },
  bump(amount) { if (!this.reducedMotion) this.shake = Math.max(this.shake, amount); },
  cheer(level) { this.excite = Math.max(this.excite, level); },

  // ---------- background ----------
  buildStands(key, colors) {
    const { W, H } = this, c = document.createElement('canvas');
    const top = 0, bottom = Math.ceil(H * 0.37);
    c.width = Math.round(W * this.dpr); c.height = Math.round(bottom * this.dpr);
    const g = c.getContext('2d'); g.scale(this.dpr, this.dpr);
    const sky = g.createLinearGradient(0, 0, 0, bottom);
    sky.addColorStop(0, '#060b24'); sky.addColorStop(0.5, '#142057'); sky.addColorStop(1, '#22306b');
    g.fillStyle = sky; g.fillRect(0, 0, W, bottom);
    // stars
    const rnd = GG.mulberry32(7);
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 40; i++) { g.globalAlpha = 0.2 + rnd() * 0.5; g.fillRect(rnd() * W, rnd() * H * 0.07, 1.2, 1.2); }
    g.globalAlpha = 1;
    // roof
    g.fillStyle = '#0a0f2a'; g.beginPath(); g.moveTo(0, H * 0.075); g.quadraticCurveTo(W / 2, H * 0.04, W, H * 0.075); g.lineTo(W, H * 0.105); g.quadraticCurveTo(W / 2, H * 0.075, 0, H * 0.105); g.fill();
    // stands with crowd
    const standTop = H * 0.1, standBottom = bottom;
    const sg = g.createLinearGradient(0, standTop, 0, standBottom); sg.addColorStop(0, '#1b2350'); sg.addColorStop(1, '#2b3770');
    g.fillStyle = sg; g.fillRect(0, standTop, W, standBottom - standTop);
    const palette = [colors[0], colors[1], '#fff4dc', '#ff6b4a', '#d8f56d', '#7fd3ff', '#f2a65a', '#e9e2ff'];
    const rows = Math.max(10, Math.floor((standBottom - standTop) / 5.2));
    for (let r = 0; r < rows; r++) {
      const y = standTop + 4 + r * (standBottom - standTop - 6) / rows;
      const size = 1.6 + r * 0.09;
      for (let x = rnd() * 4; x < W; x += size * 2.3 + rnd() * 1.6) {
        g.fillStyle = palette[Math.floor(rnd() * palette.length)];
        g.globalAlpha = 0.55 + rnd() * 0.45;
        g.beginPath(); g.arc(x, y, size, 0, TAU); g.fill();
      }
      if (r % 6 === 5) { g.globalAlpha = 0.35; g.fillStyle = '#0a0f2a'; g.fillRect(0, y + size + 0.6, W, 1.3); }
    }
    g.globalAlpha = 1;
    // floodlights
    for (const fx of [W * 0.07, W * 0.93]) {
      g.fillStyle = '#0a0f2a'; g.fillRect(fx - 2, H * 0.075, 4, H * 0.06);
      const glow = g.createRadialGradient(fx, H * 0.08, 2, fx, H * 0.08, W * 0.32);
      glow.addColorStop(0, 'rgba(255,250,220,0.9)'); glow.addColorStop(0.08, 'rgba(255,248,210,0.35)'); glow.addColorStop(1, 'rgba(255,248,210,0)');
      g.fillStyle = glow; g.fillRect(0, 0, W, bottom);
      g.fillStyle = '#fffbe6'; for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) g.fillRect(fx - 9 + i * 6.5, H * 0.07 + j * 6, 5, 4.5);
    }
    this.stands = c; this.standsKey = key; this.standsBottom = bottom;
  },
  drawStands(t) {
    const key = `${this.W}x${this.H}:${this.crowdColors.join()}`;
    if (!this.stands || this.standsKey !== key) this.buildStands(key, this.crowdColors);
    const g = this.ctx, c = this.stands, slices = 6, h = this.standsBottom, sh = h / slices;
    g.fillStyle = '#1b2350'; g.fillRect(0, 0, this.W, h);
    for (let i = 0; i < slices; i++) {
      const jump = this.excite > 0.05 && i > 0 ? Math.max(0, Math.sin(t * 16 + i * 1.7)) * this.excite * 3.5 : 0;
      g.drawImage(c, 0, i * sh * this.dpr, c.width, sh * this.dpr, 0, i * sh - jump, this.W, sh + 0.5);
    }
    // camera flashes
    if (Math.random() < 0.02 + this.excite * 0.5) this.flashes.push({ x: Math.random() * this.W, y: this.H * (0.11 + Math.random() * 0.2), life: 1 });
    for (const f of this.flashes) { g.globalAlpha = f.life; g.fillStyle = '#ffffff'; g.beginPath(); g.arc(f.x, f.y, 2.6 * f.life + 0.5, 0, TAU); g.fill(); f.life -= 0.12; }
    g.globalAlpha = 1; this.flashes = this.flashes.filter(f => f.life > 0);
  },
  // LED boards sit on the horizon, in front of the stands and behind everything on the pitch
  drawBoards(P, t, text) {
    if (!text) return;
    const g = this.ctx, h = Math.max(12, Math.min(20, this.H * 0.021)), y0 = P.hy - h;
    g.fillStyle = '#0d1230'; g.fillRect(0, y0, this.W, h);
    g.save(); g.beginPath(); g.rect(0, y0, this.W, h); g.clip();
    g.font = `900 ${Math.round(h * 0.62)}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`; g.textBaseline = 'middle';
    const msg = text + '   ★   ';
    const wMsg = g.measureText(msg).width, off = -((t * 40) % wMsg);
    for (let x = off; x < this.W; x += wMsg) { g.fillStyle = '#d8f56d'; g.fillText(msg, x, y0 + h / 2 + 0.5); }
    g.restore();
    g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(0, y0, this.W, 1); g.fillRect(0, P.hy - 1, this.W, 1);
  },
  drawPitch(P, flip) {
    const g = this.ctx, { W, H } = this;
    const top = P.hy, grad = g.createLinearGradient(0, top, 0, H);
    grad.addColorStop(0, '#1f6b45'); grad.addColorStop(1, '#2f9a5f');
    g.fillStyle = grad; g.fillRect(0, top, W, H - top);
    // mowing stripes perpendicular to the camera
    for (let i = -1; i < 24; i++) {
      if (i % 2) continue;
      const z0 = i * 2.6 + (flip ? -1.5 : 0), z1 = z0 + 2.6;
      const a = this.proj(P, 0, 0, Math.max(z0, -1.5)), b = this.proj(P, 0, 0, z1);
      g.fillStyle = 'rgba(255,255,255,0.045)'; g.fillRect(0, b.y, W, a.y - b.y);
    }
    g.strokeStyle = 'rgba(245,255,240,0.75)'; g.lineWidth = 2; g.lineCap = 'round';
    const line = (pts) => { g.beginPath(); pts.forEach((p, i) => { const s = this.proj(P, p[0], 0, p[1]); i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y); }); g.stroke(); };
    const zz = z => flip ? P.goalZ - z : z; // distance from goal line -> camera depth
    line([[-60, zz(0)], [60, zz(0)]]);
    line([[-9.16, zz(0)], [-9.16, zz(5.5)], [9.16, zz(5.5)], [9.16, zz(0)]]);
    line([[-20.16, zz(0)], [-20.16, zz(16.5)], [20.16, zz(16.5)], [20.16, zz(0)]]);
    const arc = []; for (let a = -0.93; a <= 0.93; a += 0.06) { const z = 11 + Math.cos(a) * 9.15; if (z >= 16.5) arc.push([Math.sin(a) * 9.15, zz(z)]); }
    if (arc.length > 1) line(arc);
    const spot = this.proj(P, 0, 0, zz(11)); g.fillStyle = 'rgba(245,255,240,0.85)'; g.beginPath(); g.ellipse(spot.x, spot.y, 4 * spot.k + 1.5, 1.6 * spot.k + 0.8, 0, 0, TAU); g.fill();
  },
  drawGoalFrame(P, z, front) {
    const g = this.ctx, bl = this.proj(P, -3.66, 0, z), tl = this.proj(P, -3.66, 2.44, z), tr = this.proj(P, 3.66, 2.44, z), br = this.proj(P, 3.66, 0, z);
    const w = Math.max(3, 0.12 * P.xs * bl.k);
    if (front) { // net behind the goal, seen from the field
      const back = this.proj(P, -3.66, 0, z + 1.8), backT = this.proj(P, -3.66, 2.2, z + 1.8), backR = this.proj(P, 3.66, 2.2, z + 1.8), backRB = this.proj(P, 3.66, 0, z + 1.8);
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.moveTo(bl.x, bl.y); g.lineTo(tl.x, tl.y); g.lineTo(tr.x, tr.y); g.lineTo(br.x, br.y); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 1;
      for (let i = 0; i <= 18; i++) { const x = lerp(backT.x, backR.x, i / 18); g.beginPath(); g.moveTo(x, backT.y); g.lineTo(lerp(back.x, backRB.x, i / 18), back.y); g.stroke(); }
      for (let i = 0; i <= 6; i++) { const y = lerp(backT.y, back.y, i / 6); g.beginPath(); g.moveTo(backT.x, y); g.lineTo(backR.x, y); g.stroke(); }
    }
    g.strokeStyle = '#ffffff'; g.lineWidth = w; g.lineJoin = 'round';
    g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 6;
    g.beginPath(); g.moveTo(bl.x, bl.y); g.lineTo(tl.x, tl.y); g.lineTo(tr.x, tr.y); g.lineTo(br.x, br.y); g.stroke();
    g.shadowBlur = 0;
  },
  drawNetMesh(P, bulge) {
    const g = this.ctx, tl = this.proj(P, -3.66, 2.44, 0), br = this.proj(P, 3.66, 0, 0);
    g.save(); g.strokeStyle = 'rgba(255,255,255,0.13)'; g.lineWidth = 1;
    const cols = 22, rows = 8;
    const warp = (x, y) => {
      if (!bulge) return [x, y];
      const dx = x - bulge.x, dy = y - bulge.y, d = Math.hypot(dx, dy), f = Math.max(0, 1 - d / bulge.r) * bulge.a;
      return [x + dx * f * 0.35, y + dy * f * 0.35];
    };
    for (let i = 0; i <= cols; i++) { g.beginPath(); for (let j = 0; j <= rows; j++) { const [x, y] = warp(lerp(tl.x, br.x, i / cols), lerp(tl.y, br.y, j / rows)); j ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    for (let j = 0; j <= rows; j++) { g.beginPath(); for (let i = 0; i <= cols; i++) { const [x, y] = warp(lerp(tl.x, br.x, i / cols), lerp(tl.y, br.y, j / rows)); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    g.restore();
  },

  // ---------- people ----------
  keeperPose(H, k, t, idle) {
    const bob = idle ? Math.abs(Math.sin(t * 5)) * 0.05 : 0;
    const sway = idle ? Math.sin(t * 2.5) * 0.12 : 0;
    const stand = { hips: [sway, 0.95 + bob], sh: [sway, 1.48 + bob], head: [sway, 1.75 + bob], hl: [sway - 0.44, 1.02 + bob], hr: [sway + 0.44, 1.02 + bob], fl: [sway - 0.3, bob * 0.5], fr: [sway + 0.3, bob * 0.5], kneeL: [sway - 0.36, 0.5 + bob], kneeR: [sway + 0.36, 0.5 + bob] };
    if (!H || k <= 0.001) return stand;
    let ux = H.x, uy = H.y - 0.6; const n = Math.hypot(ux, uy) || 1; ux /= n; uy /= n;
    const px = -uy, py = ux;
    const S = [H.x - ux * 0.62, H.y - uy * 0.62], Pp = [S[0] - ux * 0.6, S[1] - uy * 0.6];
    const dive = {
      hl: [H.x + px * 0.17, H.y + py * 0.17], hr: [H.x - px * 0.17, H.y - py * 0.17],
      sh: S, hips: Pp, head: [S[0] + ux * 0.1 + px * 0.2 * Math.sign(H.x || 1), S[1] + uy * 0.1 + py * 0.2 * Math.sign(H.x || 1)],
      fl: [Pp[0] - ux * 0.85 + px * 0.2, Pp[1] - uy * 0.85 + py * 0.2], fr: [Pp[0] - ux * 0.8 - px * 0.25, Pp[1] - uy * 0.8 - py * 0.25],
      kneeL: [Pp[0] - ux * 0.45 + px * 0.15, Pp[1] - uy * 0.45 + py * 0.15], kneeR: [Pp[0] - ux * 0.4 - px * 0.2, Pp[1] - uy * 0.4 - py * 0.2],
    };
    const e = ease(k), out = {};
    for (const key in stand) { out[key] = [lerp(stand[key][0], dive[key][0], e), Math.max(0.02, lerp(stand[key][1], dive[key][1], e))]; }
    return out;
  },
  drawKeeper(P, z, pose, kit, glove, front, expr, lookX, scale = 1) {
    const g = this.ctx, pt = (p) => this.proj(P, p[0], p[1], z);
    const base = this.proj(P, 0, 0, z), m = P.xs * base.k * scale; // px per metre
    const limb = (a, b, c, w, col) => { const A = pt(a), B = pt(b), C = c ? pt(c) : null; g.strokeStyle = col; g.lineWidth = w * m; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(A.x, A.y); if (C) { g.lineTo(C.x, C.y); } g.lineTo(B.x, B.y); g.stroke(); };
    // shadow
    const shadowX = (pose.hips[0] + pose.fl[0] + pose.fr[0]) / 3, sh = this.proj(P, shadowX, 0, z);
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.beginPath(); g.ellipse(sh.x, sh.y, 0.8 * m, 0.13 * m, 0, 0, TAU); g.fill();
    // legs
    limb(pose.hips, pose.fl, pose.kneeL, 0.2, kit.shorts); limb(pose.hips, pose.fr, pose.kneeR, 0.2, kit.shorts);
    const sock = (f, kn) => { const k2 = [lerp(kn[0], f[0], 0.35), lerp(kn[1], f[1], 0.35)]; limb(k2, f, null, 0.17, kit.trim); };
    sock(pose.fl, pose.kneeL); sock(pose.fr, pose.kneeR);
    for (const f of [pose.fl, pose.fr]) { const F = pt(f); g.fillStyle = '#16181d'; g.beginPath(); g.ellipse(F.x, F.y, 0.13 * m, 0.08 * m, 0, 0, TAU); g.fill(); }
    // torso
    limb(pose.hips, pose.sh, null, 0.46, kit.shirt);
    const Hp = pt(pose.hips), Sp = pt(pose.sh);
    g.strokeStyle = kit.trim; g.lineWidth = 0.08 * m; g.beginPath(); g.moveTo(lerp(Hp.x, Sp.x, 0.15), lerp(Hp.y, Sp.y, 0.15)); g.lineTo(lerp(Hp.x, Sp.x, 0.2), lerp(Hp.y, Sp.y, 0.2)); g.stroke();
    // shorts block at hips
    g.fillStyle = kit.shorts; g.beginPath(); g.arc(Hp.x, Hp.y, 0.25 * m, 0, TAU); g.fill();
    // number on back / badge on front
    g.save(); g.translate(lerp(Hp.x, Sp.x, 0.55), lerp(Hp.y, Sp.y, 0.55)); g.rotate(Math.atan2(Sp.x - Hp.x, -(Sp.y - Hp.y)));
    g.fillStyle = kit.trim; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (!front) { g.font = `900 ${0.3 * m}px ui-rounded, system-ui, sans-serif`; g.fillText('1', 0, 0); }
    else { g.beginPath(); g.arc(0.1 * m, -0.08 * m, 0.06 * m, 0, TAU); g.fill(); }
    g.restore();
    // arms
    limb(pose.sh, pose.hl, null, 0.15, kit.shirt); limb(pose.sh, pose.hr, null, 0.15, kit.shirt);
    // head
    const Hd = pt(pose.head), hr = 0.15 * m;
    g.fillStyle = '#f0b48a'; g.beginPath(); g.arc(Hd.x, Hd.y, hr, 0, TAU); g.fill();
    if (!front) {
      g.fillStyle = '#4a2a14'; g.beginPath(); g.arc(Hd.x, Hd.y - hr * 0.1, hr * 1.02, Math.PI * 0.95, Math.PI * 2.05); g.fill();
      g.beginPath(); g.ellipse(Hd.x, Hd.y + hr * 0.1, hr, hr * 0.75, 0, Math.PI, TAU); g.fill();
      g.strokeStyle = '#4a2a14'; g.lineWidth = Math.max(1.5, hr * 0.25); g.beginPath(); g.moveTo(Hd.x, Hd.y - hr * 0.9); g.quadraticCurveTo(Hd.x + hr * 0.6, Hd.y - hr * 1.9, Hd.x + hr * 0.2, Hd.y - hr * 1.6); g.stroke();
      g.fillStyle = '#f0b48a'; g.beginPath(); g.arc(Hd.x - hr, Hd.y, hr * 0.25, 0, TAU); g.arc(Hd.x + hr, Hd.y, hr * 0.25, 0, TAU); g.fill();
    } else {
      this.face(g, Hd.x, Hd.y, hr, expr || 'focus', lookX || 0, '#2a1a10', 0);
    }
    // gloves
    for (const h of [pose.hl, pose.hr]) {
      const Gp = pt(h), r = 0.17 * m;
      g.fillStyle = glove.colors[0]; g.strokeStyle = glove.colors[1]; g.lineWidth = Math.max(1.2, r * 0.22);
      g.beginPath(); g.arc(Gp.x, Gp.y, r, 0, TAU); g.fill(); g.stroke();
      g.beginPath(); for (let i = -1; i <= 1; i++) { g.moveTo(Gp.x + i * r * 0.45, Gp.y - r * 0.2); g.lineTo(Gp.x + i * r * 0.55, Gp.y - r * 0.85); } g.stroke();
    }
  },
  face(g, x, y, r, expr, look, hair, blink) {
    // goofy keeper face: used on the field, in the face cam and on the home screen
    g.fillStyle = '#f0b48a'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    g.fillStyle = hair; g.beginPath(); g.ellipse(x, y - r * 0.62, r * 0.98, r * 0.48, 0, Math.PI, TAU); g.fill();
    g.strokeStyle = hair; g.lineWidth = Math.max(1, r * 0.13); g.lineCap = 'round';
    g.beginPath(); g.moveTo(x + r * 0.05, y - r * 1.05); g.quadraticCurveTo(x + r * 0.5, y - r * 1.75, x + r * 0.15, y - r * 1.5); g.stroke();
    const eyeY = y - r * 0.12, ex = r * 0.36, er = r * (expr === 'shock' ? 0.27 : 0.22);
    for (const s of [-1, 1]) {
      g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(x + s * ex, eyeY, er, blink ? er * 0.12 : er * 1.15, 0, 0, TAU); g.fill();
      if (!blink) { g.fillStyle = '#1b1b1b'; const pupil = expr === 'dizzy' ? 0 : look * er * 0.5; g.beginPath(); g.arc(x + s * ex + pupil, eyeY + (expr === 'shock' ? 0 : er * 0.15), er * 0.5, 0, TAU); g.fill(); }
      g.strokeStyle = hair; g.lineWidth = Math.max(1, r * 0.09);
      const tilt = expr === 'focus' ? 0.18 : expr === 'shock' ? -0.25 : expr === 'smug' ? (s > 0 ? -0.2 : 0.1) : -0.1;
      g.beginPath(); g.moveTo(x + s * (ex - er), eyeY - er * 1.6 + s * tilt * r * 0.5 * -1); g.lineTo(x + s * (ex + er), eyeY - er * 1.6 - s * tilt * r * 0.5 * -1 * -1); g.stroke();
    }
    if (expr === 'dizzy') { g.strokeStyle = '#ffd23f'; g.lineWidth = Math.max(1, r * 0.08); g.beginPath(); g.arc(x, y - r * 1.25, r * 0.6, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
    // nose
    g.fillStyle = '#e09a72'; g.beginPath(); g.ellipse(x + look * r * 0.08, y + r * 0.15, r * 0.14, r * 0.11, 0, 0, TAU); g.fill();
    // mouth
    g.strokeStyle = '#5a2214'; g.fillStyle = '#5a2214'; g.lineWidth = Math.max(1.2, r * 0.1);
    const my = y + r * 0.48;
    g.beginPath();
    if (expr === 'grin') { g.arc(x, my - r * 0.12, r * 0.38, 0.15 * Math.PI, 0.85 * Math.PI); g.closePath(); g.fill(); g.fillStyle = '#fff'; g.fillRect(x - r * 0.25, my - r * 0.06, r * 0.5, r * 0.08); }
    else if (expr === 'shock') { g.ellipse(x, my, r * 0.16, r * 0.22, 0, 0, TAU); g.fill(); }
    else if (expr === 'smug') { g.moveTo(x - r * 0.25, my); g.quadraticCurveTo(x + r * 0.1, my + r * 0.12, x + r * 0.3, my - r * 0.1); g.stroke(); }
    else if (expr === 'dizzy') { g.moveTo(x - r * 0.3, my); for (let i = 1; i <= 6; i++) g.lineTo(x - r * 0.3 + i * r * 0.1, my + (i % 2 ? -1 : 1) * r * 0.07); g.stroke(); }
    else { g.moveTo(x - r * 0.25, my); g.lineTo(x + r * 0.25, my); g.stroke(); }
  },
  drawStriker(P, X, Z, colors, pose) {
    const g = this.ctx, base = this.proj(P, X, 0, Z), m = P.xs * base.k * 1.6, k = base.k;
    const { run = 0, lean = 0, kick = 0, celebrate = 0, sad = 0, facing = 1 } = pose;
    const hipY = base.y - 0.95 * m, shY = hipY - 0.55 * m;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(base.x, base.y, 0.45 * m, 0.08 * m, 0, 0, TAU); g.fill();
    const legSwing = Math.sin(run) * 0.5;
    const leg = (ang, col) => { g.strokeStyle = col; g.lineWidth = 0.17 * m; g.lineCap = 'round'; g.beginPath(); g.moveTo(base.x, hipY); g.lineTo(base.x + Math.sin(ang) * 0.95 * m, hipY + Math.cos(ang) * 0.95 * m); g.stroke(); };
    leg(legSwing - kick * 1.1, '#f0b48a'); leg(-legSwing, '#f0b48a');
    g.save(); g.translate(base.x, hipY); g.rotate(lean * 0.45 + (celebrate ? Math.sin(celebrate * 12) * 0.08 : 0));
    g.fillStyle = colors[0]; g.beginPath(); g.roundRect(-0.24 * m, -0.6 * m, 0.48 * m, 0.62 * m, 0.1 * m); g.fill();
    g.fillStyle = colors[1]; g.fillRect(-0.05 * m, -0.6 * m, 0.1 * m, 0.62 * m);
    g.fillStyle = colors[1]; g.fillRect(-0.24 * m, -0.04 * m, 0.48 * m, 0.18 * m); // shorts
    // arms
    g.strokeStyle = colors[0]; g.lineWidth = 0.12 * m;
    const armUp = celebrate ? -2.6 : sad ? -2.2 : 0;
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 0.22 * m, -0.52 * m); g.lineTo(s * (0.4 + (celebrate ? 0.1 : 0)) * m, (-0.15 + (armUp ? -0.55 : 0) - s * legSwing * 0.15) * m); g.stroke(); }
    // head
    g.fillStyle = '#c98b62'; g.beginPath(); g.arc(0, -0.78 * m, 0.16 * m, 0, TAU); g.fill();
    g.fillStyle = '#1d1208'; g.beginPath(); g.arc(0, -0.83 * m, 0.16 * m, Math.PI, TAU); g.fill();
    if (sad) { g.fillStyle = '#c98b62'; for (const s of [-1, 1]) { g.beginPath(); g.arc(s * 0.14 * m, -0.95 * m, 0.06 * m, 0, TAU); g.fill(); } }
    g.restore();
    return k;
  },
  ball(x, y, r, spin, trail) {
    const g = this.ctx;
    if (trail && trail.length > 1) {
      for (let i = 1; i < trail.length; i++) { const a = trail[i - 1], b = trail[i]; g.strokeStyle = `rgba(255,255,255,${0.04 + i / trail.length * 0.25})`; g.lineWidth = b.r * 1.4 * (i / trail.length); g.lineCap = 'round'; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
    }
    g.save(); g.translate(x, y); g.rotate(spin);
    g.fillStyle = '#fffdf3'; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
    g.fillStyle = '#1b2433';
    g.beginPath(); for (let i = 0; i < 5; i++) { const a = i * TAU / 5 - Math.PI / 2; g.lineTo(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42); } g.closePath(); g.fill();
    g.strokeStyle = '#1b2433'; g.lineWidth = Math.max(0.8, r * 0.1);
    for (let i = 0; i < 5; i++) { const a = i * TAU / 5 - Math.PI / 2; g.beginPath(); g.moveTo(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); g.stroke(); }
    g.restore();
    const hl = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    hl.addColorStop(0, 'rgba(255,255,255,0.55)'); hl.addColorStop(0.5, 'rgba(255,255,255,0)'); hl.addColorStop(1, 'rgba(0,0,0,0.28)');
    g.fillStyle = hl; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  },

  // ---------- particles ----------
  burst(x, y, n, colors, opts = {}) {
    if (this.reducedMotion) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = opts.up ? -Math.PI / 2 + (Math.random() - 0.5) * 2.2 : Math.random() * TAU, sp = (opts.speed || 220) * (0.4 + Math.random() * 0.8);
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, decay: opts.decay || 1.4, color: colors[i % colors.length], size: opts.size || 3, g: opts.g ?? 500, rect: !!opts.confetti, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12 });
    }
  },
  confetti() { for (let i = 0; i < 4; i++) this.burst(this.W * (0.15 + i * 0.23), this.H * 0.15, 30, ['#d8f56d', '#ff6b4a', '#7fd3ff', '#ffd23f', '#ffffff', '#ff7eb6'], { confetti: true, speed: 260, decay: 0.45, size: 5, g: 220, up: false }); },
  stepParticles(dt) {
    for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.vx *= 0.99; p.life -= dt * p.decay; p.rot += p.vr * dt; }
    this.particles = this.particles.filter(p => p.life > 0 && p.y < this.H + 20);
  },
  drawParticles() {
    const g = this.ctx;
    for (const p of this.particles) {
      g.globalAlpha = Math.max(0, Math.min(1, p.life)); g.fillStyle = p.color;
      if (p.rect) { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); g.restore(); }
      else { g.beginPath(); g.arc(p.x, p.y, p.size * (0.5 + p.life * 0.5), 0, TAU); g.fill(); }
    }
    g.globalAlpha = 1;
  },

  // ---------- frames ----------
  frame(world, t, dt) {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    this.excite = Math.max(0, this.excite - dt * 0.6);
    this.shake = Math.max(0, this.shake - dt * 30);
    if (this.shake > 0) g.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    if (world.view === 'attack') this.drawAttack(world, t); else this.drawKeeperView(world, t);
    this.stepParticles(dt); this.drawParticles();
    g.setTransform(1, 0, 0, 1, 0, 0);
  },
  strikerPose(world, shot, t) {
    const ph = world.phase, tp = world.tPhase;
    const runSide = shot.tellSide || (shot.tx >= 0 ? 1 : -1);
    const startX = shot.sx - runSide * 1.4, startZ = shot.D + 2.8, endX = shot.sx - runSide * 0.35, endZ = shot.D + 0.45;
    let f = 1, lean = 0, kick = 0, run = 0, celebrate = 0, sad = 0;
    if (ph === 'ready') f = 0;
    else if (ph === 'runup') {
      const u = tp / shot.runup;
      f = shot.stutter ? (u < 0.45 ? u / 0.45 * 0.6 : u < 0.75 ? 0.6 + Math.sin((u - 0.45) * 20) * 0.02 : 0.6 + (u - 0.75) / 0.25 * 0.4) : u;
      run = t * 14; lean = shot.tellSide * Math.max(0, (u - 0.5) / 0.5);
      if (u > 0.9) kick = (u - 0.9) / 0.1 * -0.4;
    } else if (ph === 'flight') { kick = Math.max(0, 1 - tp * 3); lean = shot.tellSide * Math.max(0, 1 - tp * 2); }
    else if (ph === 'result' && world.result) { if (world.result.goal) { celebrate = tp + 0.01; run = t * 18; } else if (world.result.save) sad = 1; }
    return { X: lerp(startX, endX, f), Z: lerp(startZ, endZ, f), pose: { run, lean, kick, celebrate, sad } };
  },
  ballPosition(world, shot) {
    const ph = world.phase, tp = world.tPhase;
    if (ph === 'ready' || ph === 'runup') return { x: shot.sx, y: 0.11, z: shot.D, spin: 0 };
    if (ph === 'flight') { const p = Math.min(1, tp / shot.T), b = GG.ballAt(shot, p); b.spin = tp * (shot.style === 'knuckle' ? 0.6 : 14) * (shot.curve ? Math.sign(shot.curve) : 1); return b; }
    const m = world.motion; if (!m) return GG.ballAt(shot, 1);
    const tt = Math.min(tp, 2.2);
    if (m.follow) { const H = world.handsNow; return { x: H.x, y: H.y + 0.05, z: 0, spin: 0 }; }
    let x = m.x + m.vx * tt, z = m.z + m.vz * tt, y = m.y + m.vy * tt - 4.9 * tt * tt;
    if (m.stopZ !== undefined && z < m.stopZ) { const tStop = (m.stopZ - m.z) / m.vz; z = m.stopZ; x = m.x + m.vx * tStop; y = Math.max(0.11, m.y + m.vy * tStop - 4.9 * tStop * tStop - 2 * (tt - tStop)); }
    if (y < 0.11) y = 0.11 + Math.abs(Math.sin(tt * 6)) * 0.3 * Math.max(0, 1 - tt);
    return { x, y, z, spin: tt * 10 };
  },
  drawKeeperView(world, t) {
    const P = this.K, g = this.ctx;
    this.drawStands(t);
    this.drawPitch(P, false);
    this.drawBoards(P, t, world.view === 'menu' ? null : world.boardText);
    const shot = world.shot;
    // striker
    if (shot && world.view !== 'menu') {
      const sp = this.strikerPose(world, shot, t);
      const ballP = this.ballPosition(world, shot);
      // tell glow in training
      this.drawStriker(P, sp.X, sp.Z, shot.taker.colors, sp.pose);
      if (world.phase === 'runup' || world.phase === 'ready') { const b = this.proj(P, ballP.x, 0.11, ballP.z); this.ball(b.x, b.y, Math.max(2.5, 0.11 * P.xs * b.k * 1.6), 0); }
    }
    // keeper
    const kit = world.kit, glove = world.glove;
    let H = null, k = 0, idle = true;
    if (world.dive && shot) {
      const now = world.kickClock; const hs = GG.keeperHands(world.dive, now - world.dive.t, glove);
      H = hs; k = hs.k; idle = false; world.handsNow = hs;
    } else world.handsNow = GG.REST;
    if (world.result && world.result.save && world.phase === 'result' && !world.dive) { H = { x: GG.REST.x, y: GG.REST.y }; }
    const pose = this.keeperPose(H, k, t, idle && world.view !== 'freeze');
    this.drawKeeper(P, 0, pose, kit, glove, false);
    this.drawGoalFrame(P, 0, false);
    // target hint and tap marker
    if (shot && shot.showTarget && (world.phase === 'runup' || world.phase === 'flight')) {
      const c = this.fromGoal(shot.tx, shot.ty), pulse = 0.5 + 0.5 * Math.sin(t * 8);
      g.strokeStyle = `rgba(216,245,109,${0.5 + pulse * 0.5})`; g.lineWidth = 3; g.beginPath(); g.arc(c.x, c.y, 18 + pulse * 6, 0, TAU); g.stroke();
      g.fillStyle = 'rgba(216,245,109,0.25)'; g.beginPath(); g.arc(c.x, c.y, 14, 0, TAU); g.fill();
    }
    if (world.tap && world.tap.age < 0.6) { const c = this.fromGoal(world.tap.x, world.tap.y), a = 1 - world.tap.age / 0.6; g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = 2; g.beginPath(); g.arc(c.x, c.y, 10 + world.tap.age * 40, 0, TAU); g.stroke(); }
    // ball in flight / after
    if (shot && (world.phase === 'flight' || world.phase === 'result')) {
      const b = this.ballPosition(world, shot), s = this.proj(P, b.x, b.y, b.z), r = Math.max(3, 0.11 * P.xs * s.k * 1.6);
      const sh = this.proj(P, b.x, 0, b.z);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(sh.x, sh.y, r * 0.9, r * 0.3, 0, 0, TAU); g.fill();
      world.trail = world.trail || [];
      if (world.phase === 'flight') { world.trail.push({ x: s.x, y: s.y, r }); if (world.trail.length > (shot.power > 0.8 ? 9 : 5)) world.trail.shift(); }
      else if (world.trail.length) world.trail.shift();
      this.ball(s.x, s.y, r, b.spin, this.reducedMotion ? null : world.trail);
    }
    // net bulge after a goal
    let bulge = null;
    if (world.result && world.result.goal && world.phase === 'result') { const c = this.fromGoal(world.shot.tx, world.shot.ty); bulge = { x: c.x, y: c.y, r: 90, a: Math.max(0, 1 - world.tPhase * 1.5) }; }
    this.drawNetMesh(P, bulge);
    // foreground vignette
    const vg = g.createRadialGradient(this.W / 2, this.H * 0.55, this.H * 0.3, this.W / 2, this.H * 0.55, this.H * 0.8);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(4,8,24,0.45)'); g.fillStyle = vg; g.fillRect(0, 0, this.W, this.H);
  },
  drawAttack(world, t) {
    const P = this.A, g = this.ctx, a = world.attack;
    this.drawStands(t);
    this.drawPitch(P, true);
    this.drawBoards(P, t, world.boardText || 'SHOOTOUT   ·   PICK YOUR SPOT');
    this.drawGoalFrame(P, P.goalZ, true);
    // AI keeper
    let H = null, k = 0, expr = 'focus';
    if (a.dive && a.kickClock !== null) { const hs = GG.keeperHands(a.dive, a.kickClock - a.dive.t, GG.AI_GLOVE || { reach: 1, grip: 1, spring: 1 }); H = hs; k = hs.k; }
    if (a.result) expr = a.result.goal ? 'shock' : a.result.save ? 'grin' : 'smug';
    const pose = this.keeperPose(H, k, t, !a.kick);
    // mirror x for the front view so a dive to the keeper's right appears on screen right (goal x)
    this.drawKeeper(P, P.goalZ, pose, a.keeperKit, a.keeperGlove, true, expr, a.aim ? Math.max(-1, Math.min(1, a.aim.x / 3)) : 0, 1);
    this.drawGoalFrame(P, P.goalZ, false);
    // aim reticle
    if (a.aiming && a.aim) {
      const c = this.proj(P, a.aim.x, a.aim.y, P.goalZ), pulse = Math.sin(t * 10) * 2;
      g.strokeStyle = '#d8f56d'; g.lineWidth = 2.5; g.beginPath(); g.arc(c.x, c.y, 12 + pulse, 0, TAU); g.stroke();
      g.beginPath(); g.moveTo(c.x - 20, c.y); g.lineTo(c.x - 6, c.y); g.moveTo(c.x + 6, c.y); g.lineTo(c.x + 20, c.y); g.moveTo(c.x, c.y - 20); g.lineTo(c.x, c.y - 6); g.moveTo(c.x, c.y + 6); g.lineTo(c.x, c.y + 20); g.stroke();
      // power meter
      const mx = this.W - 34, my = this.H * 0.5, mh = this.H * 0.28;
      g.fillStyle = 'rgba(6,11,36,0.75)'; g.beginPath(); g.roundRect(mx - 9, my, 18, mh, 9); g.fill();
      const sweet0 = my + mh * (1 - 0.85), sweet1 = my + mh * (1 - 0.55);
      g.fillStyle = 'rgba(216,245,109,0.35)'; g.fillRect(mx - 9, sweet0, 18, sweet1 - sweet0);
      const py = my + mh * (1 - a.power);
      g.fillStyle = a.power > 0.85 ? '#ff6b4a' : a.power >= 0.55 ? '#d8f56d' : '#fff4dc';
      g.beginPath(); g.roundRect(mx - 13, py - 4, 26, 8, 4); g.fill();
      g.font = '800 10px ui-rounded, system-ui, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#fff4dc'; g.fillText('POWER', mx, my + mh + 16);
    }
    // ball
    let b;
    if (!a.kick) b = { x: 0, y: 0.11, z: 0 };
    else if (a.kickClock < a.kick.T) { const p = a.kickClock / a.kick.T; b = { x: lerp(0, a.kick.tx, p), y: lerp(0.11, a.kick.ty, p) + a.kick.arc * 4 * p * (1 - p), z: P.goalZ * p }; }
    else {
      const tt = a.kickClock - a.kick.T, res = a.result || {};
      if (res.goal) b = { x: a.kick.tx, y: Math.max(0.11, a.kick.ty - tt * 2.5), z: P.goalZ + Math.min(1.6, tt * 8) };
      else if (res.save && res.outcome === 'catch' && a.handsNow) b = { x: a.handsNow.x, y: a.handsNow.y, z: P.goalZ };
      else if (res.save) b = { x: a.kick.tx + Math.sign(a.kick.tx || 1) * tt * 4, y: Math.max(0.11, a.kick.ty + tt * 3 - 5 * tt * tt), z: P.goalZ - tt * 4 };
      else b = { x: a.kick.tx * (1 + tt * 0.6), y: a.kick.ty + tt * 0.5, z: P.goalZ + tt * 6 };
    }
    if (a.dive && a.kickClock !== null) a.handsNow = GG.keeperHands(a.dive, a.kickClock - a.dive.t, { reach: 1, grip: 1, spring: 1 });
    const s = this.proj(P, b.x, b.y, b.z), sh = this.proj(P, b.x, 0, b.z), r = Math.max(2.5, 0.11 * P.xs * s.k * 1.5);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(sh.x, sh.y, r * 0.9, r * 0.3, 0, 0, TAU); g.fill();
    this.ball(s.x, s.y, r, a.kick ? a.kickClock * 12 : 0, null);
    const vg = g.createRadialGradient(this.W / 2, this.H * 0.55, this.H * 0.3, this.W / 2, this.H * 0.55, this.H * 0.8);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(4,8,24,0.45)'); g.fillStyle = vg; g.fillRect(0, 0, this.W, this.H);
  },
  // standalone portrait used by the face cam, home mascot and locker
  portrait(canvas, kit, glove, expr, look, t) {
    const d = Math.min(3, root.devicePixelRatio || 1), w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
    if (canvas.width !== Math.round(w * d)) { canvas.width = Math.round(w * d); canvas.height = Math.round(h * d); }
    const g = canvas.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
    const cx = w / 2, r = Math.min(w, h) * 0.3, cy = h * 0.47;
    // shoulders in kit
    g.fillStyle = kit.shirt; g.beginPath(); g.ellipse(cx, h * 1.02, w * 0.42, h * 0.3, 0, Math.PI, TAU); g.fill();
    g.fillStyle = kit.trim; g.beginPath(); g.ellipse(cx, h * 0.76, r * 0.5, r * 0.18, 0, 0, Math.PI); g.fill();
    const blink = (t % 3.7) < 0.12;
    this.face(g, cx, cy, r, expr, look, '#4a2a14', blink);
    if (glove) { // a glove waving at the side
      const gx = cx + r * 1.45, gy = cy + r * 0.35 + Math.sin(t * 3) * r * 0.08, gr = r * 0.42;
      g.fillStyle = glove.colors[0]; g.strokeStyle = glove.colors[1]; g.lineWidth = Math.max(1.5, gr * 0.16);
      g.beginPath(); g.roundRect(gx - gr, gy - gr, gr * 2, gr * 2.1, gr * 0.6); g.fill(); g.stroke();
      for (let i = 0; i < 4; i++) { g.beginPath(); g.roundRect(gx - gr + i * gr * 0.52, gy - gr * 1.8 - (i === 1 ? gr * 0.2 : 0), gr * 0.48, gr * 1.1, gr * 0.24); g.fill(); g.stroke(); }
    }
  },
};
root.Render = R;
})(window);
