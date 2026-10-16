/* Goofy Goalkeeper core: data, shot physics, sessions and progression.
   Pure logic with no DOM access so it can be tested in Node. */
(function (root) {
'use strict';

// ---------- utilities ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const range = (rng, a, b) => a + rng() * (b - a);
function pickWeighted(rng, weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) { if ((r -= w) <= 0) return k; }
  return entries[entries.length - 1][0];
}

// ---------- pitch geometry (meters) ----------
const GOAL = { halfW: 3.66, h: 2.44 };
const PEN_DIST = 11;
const REST = { x: 0, y: 1.05 };        // centre of both gloves in the set position
const TIER_SPEED = [1.24, 1.1, 1.0, 0.93]; // flight time multipliers by tier

// ---------- equipment ----------
const GLOVES = [
  { id: 'rookie', name: 'Rookie Mitts', colors: ['#d8f56d', '#10251f'], reach: 1, grip: 1, spring: 1, unlock: { type: 'start' }, blurb: 'Honest, slightly squeaky, yours.' },
  { id: 'sticky', name: 'Sticky Pads', colors: ['#ff8a3d', '#3b1a08'], reach: 1, grip: 1.3, spring: 0.98, unlock: { type: 'level', level: 2 }, blurb: 'Hold almost anything. Even power shots.' },
  { id: 'longfinger', name: 'Long Fingers', colors: ['#7fd3ff', '#0d2a40'], reach: 1.12, grip: 0.95, spring: 1, unlock: { type: 'level', level: 4 }, blurb: 'Extra-long fingertips for the top corner.' },
  { id: 'retro', name: 'Retro Leather', colors: ['#c8874a', '#2b1607'], reach: 1.05, grip: 1.1, spring: 1.04, unlock: { type: 'trophy', tournament: 'county' }, blurb: 'Won the County Cup in 1974. Smells like it.' },
  { id: 'spring', name: 'Spring Wraps', colors: ['#c49bff', '#1f0d3d'], reach: 1, grip: 1, spring: 1.14, unlock: { type: 'level', level: 6 }, blurb: 'Faster off the line than your goal kicks.' },
  { id: 'night', name: 'Night Glow', colors: ['#5bffb0', '#032417'], reach: 1.08, grip: 1.08, spring: 1.06, unlock: { type: 'achievement', id: 'devotee' }, blurb: 'Glows for keepers who show up every day.' },
  { id: 'golden', name: 'Golden Gloves', colors: ['#ffd23f', '#4a3300'], reach: 1.12, grip: 1.2, spring: 1.1, unlock: { type: 'trophy', tournament: 'continental' }, blurb: 'For the keeper who beat Il Maestro.' },
];
const KITS = [
  { id: 'lime', name: 'Clubhouse Lime', shirt: '#b8e04a', trim: '#1d3b2f', shorts: '#2a4a3c', unlock: { type: 'start' } },
  { id: 'tangerine', name: 'Tangerine Dream', shirt: '#ff8a3d', trim: '#fff4dc', shorts: '#2b1a10', unlock: { type: 'level', level: 3 } },
  { id: 'sky', name: 'Sky Stripes', shirt: '#7fd3ff', trim: '#ffffff', shorts: '#0d2a40', unlock: { type: 'trophy', tournament: 'sunday' } },
  { id: 'flamingo', name: 'Flamingo', shirt: '#ff7eb6', trim: '#2a0b1c', shorts: '#2a0b1c', unlock: { type: 'achievement', id: 'worldie' } },
  { id: 'midnight', name: 'Midnight', shirt: '#2c3a8c', trim: '#ffd23f', shorts: '#0b1030', unlock: { type: 'level', level: 5 } },
  { id: 'tiger', name: 'Tiger Stripe', shirt: '#ffb21e', trim: '#1a1a1a', shorts: '#1a1a1a', unlock: { type: 'trophy', tournament: 'national' } },
  { id: 'wall', name: 'The Wall', shirt: '#9aa3ad', trim: '#ff5a3c', shorts: '#2d3238', unlock: { type: 'achievement', id: 'survivor' } },
  { id: 'gold', name: 'Champion Gold', shirt: '#ffd23f', trim: '#4a3300', shorts: '#ffffff', unlock: { type: 'trophy', tournament: 'continental' } },
];

// ---------- shot styles ----------
const STYLES = {
  placed: { label: 'Placed', T: [0.8, 0.96], power: 0.55, arc: 0.18 },
  power: { label: 'Power', T: [0.54, 0.64], power: 0.95, arc: 0.06 },
  curve: { label: 'Curler', T: [0.86, 1.0], power: 0.6, arc: 0.22 },
  chip: { label: 'Chip', T: [1.08, 1.24], power: 0.3, arc: 1.5 },
  knuckle: { label: 'Knuckle', T: [0.68, 0.8], power: 0.82, arc: 0.12 },
  low: { label: 'Low drive', T: [0.64, 0.76], power: 0.74, arc: 0 },
};

// ---------- opponents ----------
const TEAMS = {
  muddy: { name: 'Muddy Boots FC', short: 'MBF', colors: ['#7a4b2a', '#f2d16b'], styles: { placed: 3, low: 2 }, acc: 0.55, honesty: 0.9, blurb: 'They play on a slope. Uphill. Both halves.' },
  pub: { name: 'Pub Wanderers', short: 'PUB', colors: ['#3a2a1f', '#e8c26a'], styles: { power: 3, placed: 1 }, acc: 0.42, honesty: 0.85, blurb: 'Hit it hard and hope. Mostly hope.' },
  allot: { name: 'Allotment Athletic', short: 'ALA', colors: ['#4f8a2b', '#f6e7b0'], styles: { low: 3, placed: 2 }, acc: 0.58, honesty: 0.85, blurb: 'Grass-cutters. Literally, they grow vegetables.' },
  riverside: { name: 'Riverside Rovers', short: 'RIV', colors: ['#1f6fb2', '#ffffff'], styles: { curve: 3, placed: 2 }, acc: 0.62, honesty: 0.75, blurb: 'Bend it like the river. Slowly, then suddenly.' },
  dumpling: { name: 'Dynamo Dumpling', short: 'DYN', colors: ['#d23b3b', '#ffe9c2'], styles: { placed: 3, power: 1, low: 1 }, acc: 0.68, honesty: 0.75, blurb: 'Small, round, surprisingly dangerous.' },
  hilltop: { name: 'Hilltop Harriers', short: 'HIL', colors: ['#6b3fa0', '#ffd23f'], styles: { chip: 2, low: 2, placed: 1 }, acc: 0.64, honesty: 0.7, patience: 0.3, blurb: 'They love a chip. Do not dive early.' },
  northport: { name: 'Northport City', short: 'NPC', colors: ['#0d3b66', '#f4d35e'], styles: { power: 3, placed: 2 }, acc: 0.72, honesty: 0.65, blurb: 'Big lads. Bigger boots.' },
  spaghetti: { name: 'Real Spaghetti', short: 'RSP', colors: ['#f0e6c8', '#c0392b'], styles: { curve: 4, placed: 1 }, acc: 0.72, honesty: 0.6, blurb: 'Every shot twists like a fork in pasta.' },
  lighthouse: { name: 'Sporting Lighthouse', short: 'SLH', colors: ['#ffffff', '#e63946'], styles: { knuckle: 3, power: 1, placed: 1 }, acc: 0.7, honesty: 0.6, blurb: 'Knuckleballs that wobble like a ship in a storm.' },
  thunder: { name: 'Atlético Thunder', short: 'ATH', colors: ['#222831', '#00adb5'], styles: { power: 2, low: 2, placed: 2 }, acc: 0.78, honesty: 0.55, blurb: 'Fast. Loud. Usually on target.' },
  banane: { name: 'Olympique Banane', short: 'OLB', colors: ['#ffe14d', '#1d3557'], styles: { curve: 3, knuckle: 2 }, acc: 0.78, honesty: 0.5, blurb: 'Banana shots, banana kits, banana everything.' },
  galactico: { name: 'Inter Galáctico', short: 'IGX', colors: ['#120d2e', '#c49bff'], styles: { placed: 2, power: 2, curve: 2, knuckle: 1, chip: 1 }, acc: 0.82, honesty: 0.5, patience: 0.3, blurb: 'The best team money cannot buy, because this game is free.' },
};
const BOSSES = {
  dave: { name: 'Big Dave', title: 'The Sunday Cannon', colors: ['#c0392b', '#ffffff'], styles: { power: 4, placed: 1 }, acc: 0.72, honesty: 0.9, patience: 0, quote: 'I only know one way: through you.', tip: 'Big Dave leans hard before he blasts. Read the lean.' },
  panenka: { name: 'Señor Panenka', title: 'The Patient Chipper', colors: ['#f4a261', '#264653'], styles: { placed: 3, low: 1 }, acc: 0.78, honesty: 0.75, patience: 0.85, panenka: true, quote: 'Dive early, amigo. I dare you.', tip: 'If you dive before he kicks, he chips it down the middle.' },
  professor: { name: 'The Professor', title: 'Master of Misdirection', colors: ['#2a9d8f', '#e9c46a'], styles: { placed: 2, curve: 2, low: 1 }, acc: 0.82, honesty: 0.2, patience: 0.4, quote: 'My hips are a lecture in lying.', tip: 'His lean usually lies. Wait for the ball.' },
  maestro: { name: 'Il Maestro', title: 'The Final Boss', colors: ['#111111', '#ffd23f'], styles: { placed: 2, power: 2, curve: 2, knuckle: 1, chip: 1, low: 1 }, acc: 0.88, honesty: 0.5, patience: 0.7, panenka: true, stutter: true, quote: 'Every keeper blinks. I wait for the blink.', tip: 'He stutters in his run-up and punishes early dives.' },
};
const TOURNAMENTS = [
  { id: 'sunday', name: 'Sunday League', trophy: 'The Muddy Plate', tier: 0, color: '#8fbf4d', matches: [
    { id: 'sunday-1', team: 'muddy', shots: 8, allow: 4, pens: 1 },
    { id: 'sunday-2', team: 'pub', shots: 8, allow: 4, pens: 1 },
    { id: 'sunday-3', team: 'allot', shots: 9, allow: 4, pens: 1 },
    { id: 'sunday-4', boss: 'dave', shots: 6, allow: 3 },
  ] },
  { id: 'county', name: 'County Cup', trophy: 'The Pie Tin Trophy', tier: 1, color: '#4da3ff', matches: [
    { id: 'county-1', team: 'riverside', shots: 9, allow: 4, pens: 1 },
    { id: 'county-2', team: 'dumpling', shots: 9, allow: 4, pens: 2 },
    { id: 'county-3', team: 'hilltop', shots: 9, allow: 4, pens: 2 },
    { id: 'county-4', boss: 'panenka', shots: 6, allow: 3 },
  ] },
  { id: 'national', name: 'National League', trophy: 'The Lighthouse Shield', tier: 2, color: '#c49bff', matches: [
    { id: 'national-1', team: 'northport', shots: 10, allow: 5, pens: 2 },
    { id: 'national-2', team: 'spaghetti', shots: 10, allow: 5, pens: 2 },
    { id: 'national-3', team: 'lighthouse', shots: 10, allow: 5, pens: 2 },
    { id: 'national-4', boss: 'professor', shots: 6, allow: 3 },
  ] },
  { id: 'continental', name: 'Continental Cup', trophy: 'The Golden Glove', tier: 3, color: '#ffd23f', matches: [
    { id: 'continental-1', team: 'thunder', shots: 10, allow: 5, pens: 2 },
    { id: 'continental-2', team: 'banane', shots: 10, allow: 5, pens: 2 },
    { id: 'continental-3', team: 'galactico', shots: 10, allow: 5, pens: 3 },
    { id: 'continental-4', boss: 'maestro', shots: 7, allow: 4 },
  ] },
];
const ALL_MATCHES = TOURNAMENTS.flatMap(t => t.matches.map(m => Object.assign({ tournament: t.id, tier: t.tier }, m)));
function findMatch(id) { return ALL_MATCHES.find(m => m.id === id) || null; }
function takerFor(match) { return match.boss ? Object.assign({ id: match.boss, boss: true }, BOSSES[match.boss]) : Object.assign({ id: match.team }, TEAMS[match.team]); }

// ---------- shot generation ----------
/* A shot travels from the shooter (sx metres across, D metres out) to a target
   (tx, ty) on the goal plane over T seconds. curve, arc and wobble shape the path. */
function generateShot(rng, taker, opts = {}) {
  const tier = clamp(opts.tier ?? 0, 0, 3);
  const penalty = !!opts.penalty;
  const style = opts.style || pickWeighted(rng, taker.styles || { placed: 1 });
  const st = STYLES[style];
  const acc = clamp((taker.acc ?? 0.6) + (opts.accBonus || 0), 0.2, 0.97);
  const D = penalty ? PEN_DIST : (opts.D ?? range(rng, 15, 22));
  const sx = penalty ? 0 : (opts.sx ?? range(rng, -6, 6));
  let side = opts.side || (rng() < 0.5 ? -1 : 1);
  let tx, ty, curve = 0, wobble = 0;
  const corner = 0.55 + 0.45 * acc * rng(); // how tight to the post (0..1)
  switch (style) {
    case 'placed': tx = side * (1.9 + 1.5 * corner); ty = rng() < 0.5 ? range(rng, 0.15, 0.6) : range(rng, 1.3, 2.2); break;
    case 'power': tx = side * range(rng, 0.5, 1.2 + 2 * corner); ty = range(rng, 0.25, 2.1); break;
    case 'curve': tx = side * (2.3 + 1.1 * corner); ty = range(rng, 0.5, 2.15); curve = -side * range(rng, 0.8, 1.35); break;
    case 'chip': tx = range(rng, -0.7, 0.7); ty = range(rng, 1.6, 2.25); break;
    case 'knuckle': tx = side * range(rng, 0.8, 3.1); ty = range(rng, 0.6, 2.0); wobble = range(rng, 0.35, 0.6) * (rng() < 0.5 ? -1 : 1); break;
    default: tx = side * (1.8 + 1.5 * corner); ty = range(rng, 0.1, 0.35); // low
  }
  if (opts.tx !== undefined) tx = opts.tx;
  if (opts.ty !== undefined) ty = opts.ty;
  // off target?
  let onTarget = true, woodwork = false;
  const missChance = opts.forceOnTarget ? 0 : (1 - acc) * 0.32;
  if (rng() < missChance) {
    onTarget = false;
    if (rng() < 0.35) { woodwork = true; if (rng() < 0.5) tx = Math.sign(tx || 1) * range(rng, 3.68, 3.78); else ty = range(rng, 2.45, 2.55); }
    else if (rng() < 0.6) tx = Math.sign(tx || 1) * range(rng, 3.95, 4.8); else ty = range(rng, 2.7, 3.4);
  }
  const speed = (TIER_SPEED[tier] ?? 1) * (0.8 + 0.2 * (D / PEN_DIST)) * (opts.assist ? 1.2 : 1) * (opts.slow || 1);
  const T = range(rng, st.T[0], st.T[1]) * speed;
  const honest = rng() < (taker.honesty ?? 0.8);
  const tellSide = Math.abs(tx) < 0.4 ? 0 : (honest ? Math.sign(tx) : -Math.sign(tx));
  return {
    style, label: st.label, penalty, D, sx, tx, ty, curve, wobble, arc: st.arc, power: st.power, T,
    runup: (penalty ? range(rng, 1.15, 1.45) : range(rng, 0.85, 1.15)) * (taker.stutter && penalty ? 1.45 : 1),
    stutter: !!(taker.stutter && penalty), tellSide, onTarget, woodwork,
    patience: taker.patience || 0, panenka: !!taker.panenka,
    taker: { id: taker.id, name: taker.name, colors: taker.colors || ['#ccc', '#333'], boss: !!taker.boss },
    showTarget: !!opts.showTarget, reaimed: false,
  };
}

/* Clever takers change their mind when the keeper commits before the kick. */
function reaim(shot, dive, rng) {
  if (!dive || shot.patience <= 0 || rng() >= shot.patience) return shot;
  const s = Object.assign({}, shot, { reaimed: true, onTarget: true, woodwork: false });
  if (shot.panenka && Math.abs(dive.x) > 0.9) {
    Object.assign(s, { style: 'chip', label: 'Panenka', tx: range(rng, -0.35, 0.35), ty: range(rng, 1.45, 1.9), arc: 1.3, power: 0.25, curve: 0, wobble: 0, T: Math.max(shot.T, 1.05) });
  } else {
    const side = dive.x >= 0 ? -1 : 1;
    s.tx = side * range(rng, 2.4, 3.3); s.ty = range(rng, 0.2, 1.9); s.curve = 0; s.wobble = 0;
  }
  return s;
}

// position along the flight, p in [0,1]: x,y on goal plane coordinates, z metres from goal line
function ballAt(shot, p) {
  const q = 4 * p * (1 - p);
  return {
    x: lerp(shot.sx, shot.tx, p) + shot.curve * q + shot.wobble * Math.sin(p * Math.PI * 3) * (1 - p) * 1.6,
    y: lerp(0.11, shot.ty, p) + shot.arc * q,
    z: shot.D * (1 - p),
  };
}

// ---------- keeper motion ----------
function keeperHands(dive, tSince, glove) {
  if (!dive || tSince < 0) return { x: REST.x, y: REST.y, phase: 'set', k: 0 };
  const spring = glove.spring || 1, setup = 0.06, speed = 7.4 * spring, maxTravel = 3.05 * spring;
  const dx = dive.x - REST.x, dy = dive.y - REST.y;
  const dist = Math.max(1e-6, Math.hypot(dx, dy));
  const travel = Math.min(dist, maxTravel), ux = dx / dist, uy = dy / dist;
  const tReach = setup + travel / speed;
  if (tSince <= setup) return { x: REST.x, y: REST.y, phase: 'load', k: 0 };
  if (tSince < tReach) { const s = (tSince - setup) * speed; return { x: REST.x + ux * s, y: REST.y + uy * s, phase: 'dive', k: s / Math.max(travel, 0.5) }; }
  const ex = REST.x + ux * travel, ey = REST.y + uy * travel, hold = 0.6 + Math.max(0, 1 - travel / 2.5);
  if (tSince < tReach + hold) return { x: ex, y: ey, phase: 'stretch', k: Math.min(1, travel / 0.5) };
  const f = Math.min(1, (tSince - tReach - hold) / 0.35);
  return { x: ex, y: ey > 0.22 ? ey + (0.22 - ey) * f : ey, phase: 'fall', k: Math.min(1, travel / 0.5), fall: f };
}

function catchLimit(glove) { return 0.7 * glove.grip + 0.15; }

/* Decide what happens when the ball reaches the goal plane. */
function resolveSave(shot, dive, glove) {
  const reaction = !!(dive && dive.t >= 0.3 * shot.T);
  if (!shot.onTarget) return { outcome: shot.woodwork ? 'post' : 'wide', save: false, goal: false, reaction: false, d: Infinity };
  const B = { x: shot.tx, y: shot.ty };
  const catchable = shot.power <= catchLimit(glove);
  if (!dive) {
    const d = Math.hypot(B.x - REST.x, (B.y - REST.y) * 0.75);
    if (d <= 0.5 && catchable) return { outcome: 'catch', save: true, goal: false, reaction: false, d, standing: true };
    if (d <= 0.92) return { outcome: 'parry', save: true, goal: false, reaction: false, d, standing: true };
    return { outcome: 'goal', save: false, goal: true, reaction: false, d };
  }
  const H = keeperHands(dive, shot.T - dive.t, glove);
  const r = 0.62 * glove.reach * (1 - 0.16 * shot.power);
  const d = Math.hypot(B.x - H.x, B.y - H.y);
  if (d <= r * 0.5 && catchable) return { outcome: 'catch', save: true, goal: false, reaction, d, H };
  if (d <= r * 0.82) return { outcome: 'parry', save: true, goal: false, reaction, d, H };
  if (d <= r) return { outcome: 'tip', save: true, goal: false, reaction, d, H };
  return { outcome: 'goal', save: false, goal: true, reaction: false, d, H };
}

const POINTS = { catch: 100, parry: 80, tip: 150 };

// ---------- keeper session (the core match loop) ----------
class KeeperSession {
  constructor(opts) {
    this.rng = opts.rng || Math.random;
    this.glove = opts.glove || GLOVES[0];
    this.nextSpec = opts.next;            // (index, session) => shot or null
    this.maxShots = opts.shots ?? Infinity;
    this.lives = opts.lives ?? Infinity;
    this.allow = opts.allow ?? Infinity;  // goals allowed before the match is lost
    this.mode = opts.mode || 'career';
    this.index = -1; this.phase = 'ready'; this.t = 0; this.wait = opts.firstDelay ?? 0.9;
    this.shot = null; this.dive = null; this.last = null; this.over = false; this.lost = false;
    this.results = []; this.score = 0; this.streak = 0; this.bestStreak = 0;
    this.goals = 0; this.saves = 0; this.catches = 0; this.parries = 0; this.tips = 0; this.reactions = 0;
    this.wides = 0; this.pensFaced = 0; this.pensSaved = 0; this.posts = 0; this.panenkas = 0;
  }
  get mult() { return Math.min(3, 1 + 0.25 * this.streak); }
  get shotsTaken() { return this.results.length; }
  get remaining() { return this.maxShots === Infinity ? Infinity : this.maxShots - this.results.length; }
  get kickTime() { return this.phase === 'flight' ? this.t : this.phase === 'runup' ? this.t - this.shot.runup : null; }
  diveAt(x, y) {
    if (this.over || this.dive || !this.shot || (this.phase !== 'runup' && this.phase !== 'flight')) return null;
    const t = this.phase === 'flight' ? this.t : this.t - this.shot.runup; // relative to kick (negative = early)
    this.dive = { x: clamp(x, -4.4, 4.4), y: clamp(y, 0, 2.7), t };
    return { type: 'dive', dive: this.dive };
  }
  step(dt) {
    if (this.over) return [];
    dt = clamp(dt, 0, 0.05);
    const ev = [];
    this.t += dt;
    if (this.phase === 'ready' && this.t >= this.wait) {
      const spec = this.results.length < this.maxShots ? this.nextSpec(this.results.length, this) : null;
      if (!spec) { this.finish(ev); return ev; }
      this.index++; this.shot = spec; this.dive = null; this.phase = 'runup'; this.t = 0;
      ev.push({ type: 'shot', shot: this.shot, index: this.index });
    } else if (this.phase === 'runup' && this.t >= this.shot.runup) {
      if (this.dive) this.shot = reaim(this.shot, this.dive, this.rng);
      this.phase = 'flight'; this.t -= this.shot.runup;
      ev.push({ type: 'kick', shot: this.shot });
    } else if (this.phase === 'flight' && this.t >= this.shot.T) {
      const res = resolveSave(this.shot, this.dive, this.glove);
      this.record(res);
      ev.push(Object.assign({ type: 'result', shot: this.shot, dive: this.dive }, res, { points: this.last.points }));
      this.phase = 'result'; this.t = 0;
    } else if (this.phase === 'result' && this.t >= 1.25) {
      if (this.lost || this.goals >= this.lives || this.results.length >= this.maxShots) { this.finish(ev); return ev; }
      this.phase = 'ready'; this.t = 0; this.wait = 0.35;
    }
    return ev;
  }
  record(res) {
    const s = this.shot;
    let points = 0;
    if (s.penalty) this.pensFaced++;
    if (res.save) {
      this.saves++; this.streak++; this.bestStreak = Math.max(this.bestStreak, this.streak);
      if (res.outcome === 'catch') this.catches++; else if (res.outcome === 'parry') this.parries++; else this.tips++;
      if (res.reaction) this.reactions++;
      if (s.penalty) this.pensSaved++;
      if (s.penalty && s.style === 'chip') this.panenkas++;
      points = Math.round((POINTS[res.outcome] + (res.reaction ? 50 : 0) + (s.penalty ? 50 : 0)) * this.mult);
      this.score += points;
    } else if (res.goal) { this.goals++; this.streak = 0; }
    else { this.wides++; if (res.outcome === 'post') this.posts++; }
    this.last = { outcome: res.outcome, points, reaction: res.reaction, penalty: s.penalty, style: s.style, reaimed: s.reaimed };
    this.results.push(this.last);
    if (this.goals > this.allow) this.lost = true;
  }
  finish(ev) {
    this.over = true; this.phase = 'done';
    ev.push({ type: 'done', summary: this.summary() });
  }
  summary() {
    return {
      mode: this.mode, shots: this.results.length, saves: this.saves, goals: this.goals, catches: this.catches,
      parries: this.parries, tips: this.tips, reactions: this.reactions, wides: this.wides, posts: this.posts,
      pensFaced: this.pensFaced, pensSaved: this.pensSaved, panenkasStopped: this.panenkas, completed: !!this.completed, bestStreak: this.bestStreak, score: this.score,
      lost: this.lost, allow: this.allow,
    };
  }
}

// ---------- mode builders ----------
function careerShots(match, rng, assist) {
  const taker = takerFor(match), tier = match.tier ?? 0;
  const list = [];
  if (match.boss) for (let i = 0; i < match.shots; i++) list.push(generateShot(rng, taker, { tier, penalty: true, assist }));
  else {
    const penAt = new Set();
    while (penAt.size < Math.min(match.pens || 0, match.shots)) penAt.add(match.shots - 1 - Math.floor(rng() * Math.ceil(match.shots / 2)));
    for (let i = 0; i < match.shots; i++) list.push(generateShot(rng, taker, { tier, penalty: penAt.has(i), assist }));
  }
  return list;
}
function careerSession(match, opts = {}) {
  const rng = opts.rng || Math.random;
  const list = careerShots(match, rng, opts.assist);
  return new KeeperSession({ rng, glove: opts.glove, mode: 'career', shots: list.length, allow: match.allow, next: i => list[i] || null });
}
function starsFor(match, summary) {
  if (summary.lost || summary.goals > match.allow) return 0;
  if (summary.goals === 0) return 3;
  if (summary.goals <= Math.floor(match.allow / 2)) return 2;
  return 1;
}

const POOL_BY_TIER = [['muddy', 'pub', 'allot'], ['riverside', 'dumpling', 'hilltop'], ['northport', 'spaghetti', 'lighthouse'], ['thunder', 'banane', 'galactico']];
function survivalSession(opts = {}) {
  const rng = opts.rng || Math.random;
  return new KeeperSession({
    rng, glove: opts.glove, mode: 'survival', lives: 3, allow: Infinity,
    next: (i) => {
      const tier = Math.min(3, Math.floor(i / 8));
      const bossTurn = i > 0 && i % 10 === 9;
      const taker = bossTurn ? Object.assign({ id: 'boss', boss: true }, BOSSES[Object.keys(BOSSES)[Math.min(3, Math.floor(i / 10))]]) : Object.assign({ id: 't' }, TEAMS[POOL_BY_TIER[tier][Math.floor(rng() * 3)]]);
      return generateShot(rng, taker, { tier, penalty: bossTurn || rng() < 0.2, accBonus: Math.min(0.12, i * 0.004), assist: opts.assist });
    },
  });
}
function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const DAILY_TIERS = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3];
function dailyShots(dateKey) {
  const rng = mulberry32(hashString('goofy-goalkeeper-daily-' + dateKey));
  const teamIds = Object.keys(TEAMS);
  const list = DAILY_TIERS.map((tier, i) => {
    const boss = i === 11;
    const taker = boss ? Object.assign({ id: 'boss', boss: true }, BOSSES[Object.keys(BOSSES)[Math.floor(rng() * 4)]]) : Object.assign({ id: 't' }, TEAMS[teamIds[Math.floor(rng() * teamIds.length)]]);
    return generateShot(rng, taker, { tier, penalty: boss || i === 5 });
  });
  return list;
}
function dailySession(dateKey, opts = {}) {
  const list = dailyShots(dateKey);
  // the session rng only decides re-aims, seeded too so a day is fully reproducible
  return new KeeperSession({ rng: mulberry32(hashString('daily-reaim-' + dateKey)), glove: opts.glove, mode: 'daily', shots: list.length, next: i => list[i] || null });
}

const TRAINING = [
  { key: 'low', coach: 'Tap the glowing spot. Your keeper dives exactly where you tap.', opts: { style: 'placed', tx: -2.6, ty: 0.35, showTarget: true, slow: 1.4, forceOnTarget: true } },
  { key: 'high', coach: 'High ones too. Tap up in the corner to fly.', opts: { style: 'placed', tx: 2.5, ty: 1.9, showTarget: true, slow: 1.35, forceOnTarget: true } },
  { key: 'read', coach: 'No hints now. Watch the ball leave the boot, then tap where it is heading.', opts: { style: 'placed', side: -1, slow: 1.35, forceOnTarget: true } },
  { key: 'tell', coach: 'Strikers lean toward their side before they kick. Read the lean and move early.', opts: { style: 'low', side: 1, slow: 1.2, forceOnTarget: true } },
  { key: 'curve', coach: 'Curlers bend late. Follow the spin before you commit.', opts: { style: 'curve', side: -1, slow: 1.2, forceOnTarget: true } },
  { key: 'power', coach: 'Power shots are too hot to hold. A parry or fingertip still saves it.', opts: { style: 'power', tx: 1.6, ty: 1.2, slow: 1.15, forceOnTarget: true } },
  { key: 'wait', coach: 'Clever takers chip it if you guess early. Stay big and wait for the kick.', opts: { style: 'chip', tx: 0.2, ty: 1.8, slow: 1.1, forceOnTarget: true }, taker: { patience: 1, panenka: true } },
];
const TRAINER = { id: 'coach', name: 'Coach Pickles', colors: ['#ff8a3d', '#fff4dc'], acc: 1, honesty: 1 };
function trainingSession(opts = {}) {
  const rng = opts.rng || Math.random;
  let step = 0;
  const s = new KeeperSession({
    rng, glove: opts.glove, mode: 'training', allow: Infinity, firstDelay: 1.4,
    next: () => {
      if (s.results.length) { const last = s.results[s.results.length - 1]; if (last.outcome !== 'goal') step++; }
      if (step >= TRAINING.length) { s.completed = true; return null; }
      const lesson = TRAINING[step];
      s.lesson = lesson; s.lessonIndex = step;
      return generateShot(rng, Object.assign({}, TRAINER, lesson.taker || {}), Object.assign({ penalty: true, tier: 0 }, lesson.opts));
    },
  });
  return s;
}

// ---------- penalty shootout ----------
const AI_GLOVE = { reach: 1, grip: 1, spring: 1 };
/* The player's kick: aim in goal metres plus a power value 0..1. */
function playerKick(aim, power, rng) {
  power = clamp(power, 0, 1);
  const sweet = power >= 0.55 && power <= 0.85;
  const err = 0.12 + (sweet ? 0 : 0.25) + Math.max(0, power - 0.85) * 2.2;
  const gauss = () => (rng() + rng() + rng() - 1.5) / 1.5;
  let tx = aim.x + gauss() * err, ty = aim.y + gauss() * err * 0.7 + Math.max(0, power - 0.85) * 5;
  ty = Math.max(0.1, ty);
  const onTarget = Math.abs(tx) <= 3.55 && ty <= 2.38;
  const woodwork = !onTarget && Math.abs(tx) <= 3.8 && ty <= 2.6;
  const T = lerp(1.05, 0.5, power);
  return { style: power > 0.8 ? 'power' : 'placed', label: 'Your kick', penalty: true, D: PEN_DIST, sx: 0, tx, ty, curve: 0, wobble: 0, arc: lerp(0.4, 0.05, power), power: lerp(0.35, 0.98, power), T, onTarget, woodwork, sweet };
}
function aiKeeperDive(kick, tier, rng, assist) {
  if (rng() < 0.12) return null; // stays central
  const guessRight = rng() < (0.3 + 0.08 * tier - (assist ? 0.08 : 0));
  const side = guessRight ? (Math.sign(kick.tx) || 1) : (rng() < 0.5 ? -1 : 1);
  const t = range(rng, -0.05, 0.16);
  if (guessRight) return { x: kick.tx + (rng() - 0.5) * 1.3, y: clamp(kick.ty + (rng() - 0.5) * 0.9, 0.1, 2.3), t };
  return { x: side * range(rng, 1.8, 3), y: range(rng, 0.3, 1.8), t };
}
function resolveKick(kick, tier, rng, assist) {
  const dive = aiKeeperDive(kick, tier, rng, assist);
  const res = resolveSave(kick, dive, AI_GLOVE);
  return Object.assign({ dive, scored: res.goal }, res);
}

class Shootout {
  constructor(teamId, opts = {}) {
    this.teamId = teamId; this.tier = opts.tier ?? 0;
    this.player = []; this.opp = []; // true = scored
    this.playerFirst = opts.playerFirst ?? true;
  }
  get next() {
    if (this.status().done) return null;
    const p = this.player.length, o = this.opp.length;
    if (this.playerFirst) return p <= o ? 'shoot' : 'keep';
    return o <= p ? 'keep' : 'shoot';
  }
  record(side, scored) { (side === 'shoot' ? this.player : this.opp).push(!!scored); return this.status(); }
  status() {
    const pg = this.player.filter(Boolean).length, og = this.opp.filter(Boolean).length;
    const pk = this.player.length, ok = this.opp.length;
    const base = { playerGoals: pg, oppGoals: og, round: Math.max(pk, ok), suddenDeath: pk > 5 || ok > 5 || (pk === 5 && ok === 5) };
    if (pk <= 5 && ok <= 5) {
      if (pg + (5 - pk) < og) return Object.assign(base, { done: true, won: false });
      if (og + (5 - ok) < pg) return Object.assign(base, { done: true, won: true });
      if (pk === 5 && ok === 5 && pg !== og) return Object.assign(base, { done: true, won: pg > og });
      return Object.assign(base, { done: false });
    }
    if (pk === ok && pg !== og) return Object.assign(base, { done: true, won: pg > og });
    return Object.assign(base, { done: false });
  }
}

// ---------- profile, XP, unlocks, achievements ----------
const LEVELS = [0, 250, 650, 1200, 1900, 2800, 3900, 5200, 6800, 8700, 11000, 14000];
function levelInfo(xp) {
  let level = 1;
  for (let i = 1; i < LEVELS.length; i++) if (xp >= LEVELS[i]) level = i + 1;
  const extra = level >= LEVELS.length ? Math.floor((xp - LEVELS[LEVELS.length - 1]) / 3500) : 0;
  level += extra;
  const cur = level <= LEVELS.length ? LEVELS[level - 1] : LEVELS[LEVELS.length - 1] + (extra) * 3500;
  const next = level < LEVELS.length ? LEVELS[level] : cur + 3500;
  return { level, cur, next, progress: clamp((xp - cur) / (next - cur), 0, 1) };
}
function newProfile() {
  return {
    v: 2, xp: 0, glove: 'rookie', kit: 'lime', tutorialDone: false,
    career: {}, trophies: {}, achievements: {},
    stats: { shots: 0, saves: 0, goals: 0, catches: 0, parries: 0, tips: 0, reactions: 0, pensFaced: 0, pensSaved: 0, cleanSheets: 0, matches: 0, bestStreak: 0, survivalBest: 0, survivalBestShots: 0, shootoutsPlayed: 0, shootoutsWon: 0, suddenDeathWins: 0, panenkasStopped: 0 },
    daily: { best: {}, last: null, streak: 0, bestStreak: 0 },
    settings: { sound: true, crowd: true, haptics: true, reducedMotion: false, assist: false },
  };
}
function normalizeProfile(p) {
  const base = newProfile();
  if (!p || typeof p !== 'object' || p.v !== 2) return base;
  const out = Object.assign(base, p);
  out.stats = Object.assign(newProfile().stats, p.stats || {});
  out.daily = Object.assign(newProfile().daily, p.daily || {});
  out.settings = Object.assign(newProfile().settings, p.settings || {});
  out.career = Object.assign({}, p.career || {}); out.trophies = Object.assign({}, p.trophies || {}); out.achievements = Object.assign({}, p.achievements || {});
  if (!GLOVES.some(g => g.id === out.glove)) out.glove = 'rookie';
  if (!KITS.some(k => k.id === out.kit)) out.kit = 'lime';
  return out;
}
function isMatchUnlocked(profile, matchId) {
  const i = ALL_MATCHES.findIndex(m => m.id === matchId);
  if (i <= 0) return i === 0;
  return (profile.career[ALL_MATCHES[i - 1].id] || 0) > 0;
}
function careerStars(profile) { return ALL_MATCHES.reduce((s, m) => s + (profile.career[m.id] || 0), 0); }
function currentMatch(profile) { return ALL_MATCHES.find(m => !(profile.career[m.id] > 0)) || ALL_MATCHES[ALL_MATCHES.length - 1]; }
function unlockMet(profile, u) {
  if (!u || u.type === 'start') return true;
  if (u.type === 'level') return levelInfo(profile.xp).level >= u.level;
  if (u.type === 'trophy') return !!profile.trophies[u.tournament];
  if (u.type === 'achievement') return !!profile.achievements[u.id];
  return false;
}
function unlockText(u) {
  if (!u || u.type === 'start') return 'Starter';
  if (u.type === 'level') return `Reach keeper level ${u.level}`;
  if (u.type === 'trophy') { const t = TOURNAMENTS.find(x => x.id === u.tournament); return `Win the ${t ? t.name : 'cup'}`; }
  if (u.type === 'achievement') { const a = ACHIEVEMENTS.find(x => x.id === u.id); return `Achievement: ${a ? a.name : u.id}`; }
  return '';
}
function gloveById(id) { return GLOVES.find(g => g.id === id) || GLOVES[0]; }
function kitById(id) { return KITS.find(k => k.id === id) || KITS[0]; }

const ACHIEVEMENTS = [
  { id: 'firstsave', name: 'First Touch', desc: 'Make your first save.', test: (p) => p.stats.saves >= 1 },
  { id: 'graduate', name: 'Graduate', desc: 'Finish training with Coach Pickles.', test: (p) => p.tutorialDone },
  { id: 'cleansheet', name: 'Clean Sheet', desc: 'Win a career match without conceding.', test: (p) => p.stats.cleanSheets >= 1 },
  { id: 'wall', name: 'The Wall', desc: 'Make 8 saves in a row in one match.', test: (p, s) => !!s && s.bestStreak >= 8 },
  { id: 'worldie', name: 'Worldie', desc: 'Make 10 fingertip saves.', test: (p) => p.stats.tips >= 10 },
  { id: 'reflexes', name: 'Cat Reflexes', desc: 'Make 4 reaction saves in one session.', test: (p, s) => !!s && s.reactions >= 4 },
  { id: 'spotkick', name: 'Spot-Kick Stopper', desc: 'Save 10 penalties.', test: (p) => p.stats.pensSaved >= 10 },
  { id: 'sunday', name: 'Muddy Plate', desc: 'Win the Sunday League.', test: (p) => !!p.trophies.sunday },
  { id: 'county', name: 'Pie Tin Hero', desc: 'Win the County Cup.', test: (p) => !!p.trophies.county },
  { id: 'national', name: 'Lighthouse Keeper', desc: 'Win the National League.', test: (p) => !!p.trophies.national },
  { id: 'continental', name: 'Golden Glove', desc: 'Win the Continental Cup.', test: (p) => !!p.trophies.continental },
  { id: 'perfect', name: 'Three-Star Keeper', desc: 'Earn 3 stars in 8 career matches.', test: (p) => Object.values(p.career).filter(v => v >= 3).length >= 8 },
  { id: 'survivor', name: 'Survivor', desc: 'Face 30 shots in one Survival run.', test: (p) => p.stats.survivalBestShots >= 30 },
  { id: 'hero', name: 'Shootout Hero', desc: 'Win a penalty shootout.', test: (p) => p.stats.shootoutsWon >= 1 },
  { id: 'icecold', name: 'Ice Cold', desc: 'Win a shootout in sudden death.', test: (p) => p.stats.suddenDeathWins >= 1 },
  { id: 'devotee', name: 'Daily Devotee', desc: 'Play the Daily Challenge 3 days in a row.', test: (p) => p.daily.bestStreak >= 3 },
  { id: 'panenka', name: 'Not Today, Señor', desc: 'Save a chipped penalty.', test: (p) => p.stats.panenkasStopped >= 1 },
  { id: 'century', name: 'Century', desc: 'Make 100 saves in total.', test: (p) => p.stats.saves >= 100 },
];

function previousDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return localDateKey(new Date(y, m - 1, d - 1));
}

/* Apply a finished session to the profile. Returns what changed for the result screen. */
function recordSession(profile, s) {
  const st = profile.stats;
  const beforeLevel = levelInfo(profile.xp).level;
  const beforeGloves = GLOVES.filter(g => unlockMet(profile, g.unlock)).map(g => g.id);
  const beforeKits = KITS.filter(k => unlockMet(profile, k.unlock)).map(k => k.id);
  let xp = 0;
  const out = { xp: 0, stars: 0, prevStars: 0, trophy: null, newRecord: false, achievements: [], unlocks: [] };
  if (s.shots !== undefined && s.mode !== 'shootout-attack') {
    st.shots += s.shots || 0; st.saves += s.saves || 0; st.goals += s.goals || 0; st.catches += s.catches || 0;
    st.parries += s.parries || 0; st.tips += s.tips || 0; st.reactions += s.reactions || 0;
    st.pensFaced += s.pensFaced || 0; st.pensSaved += s.pensSaved || 0; st.bestStreak = Math.max(st.bestStreak, s.bestStreak || 0);
    st.panenkasStopped += s.panenkasStopped || 0;
    xp += (s.saves || 0) * 12 + (s.tips || 0) * 6 + (s.reactions || 0) * 6;
  }
  if (s.mode === 'career') {
    const match = findMatch(s.matchId);
    st.matches++;
    const stars = match ? starsFor(match, s) : 0;
    out.stars = stars; out.prevStars = profile.career[s.matchId] || 0;
    if (stars > 0 && s.goals === 0) st.cleanSheets++;
    if (stars > out.prevStars) { profile.career[s.matchId] = stars; xp += (stars - out.prevStars) * 60; }
    if (stars > 0) xp += 80;
    if (stars > 0 && match && match.boss && !profile.trophies[match.tournament]) {
      profile.trophies[match.tournament] = true; out.trophy = match.tournament; xp += 300;
    }
  } else if (s.mode === 'survival') {
    out.newRecord = s.score > st.survivalBest;
    st.survivalBest = Math.max(st.survivalBest, s.score); st.survivalBestShots = Math.max(st.survivalBestShots, s.shots);
    xp += Math.floor(s.score / 25);
  } else if (s.mode === 'daily') {
    const key = s.date;
    out.newRecord = s.score > (profile.daily.best[key] || 0);
    profile.daily.best[key] = Math.max(profile.daily.best[key] || 0, s.score);
    if (profile.daily.last !== key) {
      profile.daily.streak = profile.daily.last === previousDay(key) ? profile.daily.streak + 1 : 1;
      profile.daily.last = key; xp += 100;
    }
    profile.daily.bestStreak = Math.max(profile.daily.bestStreak, profile.daily.streak);
    xp += Math.floor(s.score / 20);
    // keep the daily table small
    const keys = Object.keys(profile.daily.best).sort();
    while (keys.length > 60) delete profile.daily.best[keys.shift()];
  } else if (s.mode === 'shootout') {
    st.shootoutsPlayed++;
    if (s.won) { st.shootoutsWon++; xp += 150; if (s.suddenDeath) st.suddenDeathWins++; } else xp += 40;
  } else if (s.mode === 'training') {
    if (!profile.tutorialDone && s.completed) { profile.tutorialDone = true; xp += 150; }
  }
  profile.xp += xp; out.xp = xp;
  for (const a of ACHIEVEMENTS) if (!profile.achievements[a.id] && a.test(profile, s)) { profile.achievements[a.id] = Date.now(); out.achievements.push(a); }
  // achievements may unlock more things; re-test once
  const afterGloves = GLOVES.filter(g => unlockMet(profile, g.unlock) && !beforeGloves.includes(g.id));
  const afterKits = KITS.filter(k => unlockMet(profile, k.unlock) && !beforeKits.includes(k.id));
  out.unlocks = [...afterGloves.map(g => ({ kind: 'glove', item: g })), ...afterKits.map(k => ({ kind: 'kit', item: k }))];
  out.levelUp = levelInfo(profile.xp).level > beforeLevel ? levelInfo(profile.xp).level : 0;
  return out;
}

// ---------- test/bot helper: dive using only what a viewer could see ----------
function botDive(shot, delay, opts = {}) {
  if (opts.guessEarly) return { x: (opts.guessSide || shot.tellSide || 1) * 2.6, y: 0.9, early: true };
  const t = Math.min(shot.T * 0.97, delay);
  const p = t / shot.T, e = 0.02;
  const a = ballAt(shot, Math.max(0, p - 2 * e)), b = ballAt(shot, Math.max(0, p - e)), c = ballAt(shot, p);
  const order2 = opts.order2 !== false && p > 2 * e;
  const vx = (c.x - b.x) / e, vy = (c.y - b.y) / e;
  const ax = order2 ? (c.x - 2 * b.x + a.x) / (e * e) : 0, ay = order2 ? (c.y - 2 * b.y + a.y) / (e * e) : 0;
  const r = 1 - p;
  return { x: c.x + vx * r + 0.5 * ax * r * r, y: Math.max(0.05, c.y + vy * r + 0.5 * ay * r * r), t };
}
function simulate(session, policy, maxSteps = 200000) {
  let steps = 0;
  while (!session.over && steps++ < maxSteps) {
    if (session.phase === 'runup' && !session.dive && policy.early) {
      const d = policy.early(session.shot); if (d) session.diveAt(d.x, d.y);
    }
    if (session.phase === 'flight' && !session.dive) {
      const d = policy.react(session.shot);
      if (d && session.t >= d.t) session.diveAt(d.x, d.y);
    }
    session.step(1 / 60);
  }
  return session.summary();
}

const api = {
  mulberry32, hashString, clamp, lerp, GOAL, PEN_DIST, REST, STYLES, GLOVES, KITS, TEAMS, BOSSES, TOURNAMENTS, ALL_MATCHES,
  findMatch, takerFor, generateShot, reaim, ballAt, keeperHands, resolveSave, catchLimit, KeeperSession, careerShots, careerSession,
  starsFor, survivalSession, dailyShots, dailySession, localDateKey, previousDay, trainingSession, TRAINING, playerKick, aiKeeperDive, resolveKick,
  Shootout, LEVELS, levelInfo, newProfile, normalizeProfile, isMatchUnlocked, careerStars, currentMatch, unlockMet, unlockText,
  gloveById, kitById, ACHIEVEMENTS, recordSession, botDive, simulate, POINTS,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GG = api;
})(typeof window !== 'undefined' ? window : globalThis);
