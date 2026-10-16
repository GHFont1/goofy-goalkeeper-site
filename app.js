/* Goofy Goalkeeper app controller: screens, modes, input, persistence, haptics. */
(function () {
'use strict';
const $ = id => document.getElementById(id);
const GG = window.GG, Sfx = window.Sfx, Render = window.Render;
const STORE = 'gg2-profile';
const VERSION = '1.0';
const starSvg = on => `<svg class="${on ? 'on' : ''}"><use href="#i-star"/></svg>`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- profile ----------
function load() {
  try { const raw = localStorage.getItem(STORE); if (raw) return GG.normalizeProfile(JSON.parse(raw)); } catch (e) { /* fall through */ }
  const p = GG.newProfile();
  try { if (localStorage.getItem('gg-sound') === 'false') p.settings.sound = false; } catch (e) { /* ignore */ }
  return p;
}
let profile = load();
profile.seen = profile.seen || { gloves: ['rookie'], kits: ['lime'] };
function save() { try { localStorage.setItem(STORE, JSON.stringify(profile)); } catch (e) { /* storage unavailable */ } }
const glove = () => GG.gloveById(profile.glove);
const kit = () => GG.kitById(profile.kit);

// ---------- haptics (native Capacitor plugin when available) ----------
function haptic(kind) {
  if (!profile.settings.haptics) return;
  try {
    const H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
    if (H) {
      if (kind === 'success') H.notification({ type: 'SUCCESS' });
      else if (kind === 'error') H.notification({ type: 'ERROR' });
      else H.impact({ style: kind === 'heavy' ? 'HEAVY' : kind === 'light' ? 'LIGHT' : 'MEDIUM' });
    } else if (navigator.vibrate) navigator.vibrate(kind === 'heavy' ? 30 : kind === 'error' ? [20, 40, 20] : 12);
  } catch (e) { /* haptics are optional */ }
}

// ---------- settings ----------
function applySettings() {
  const s = profile.settings;
  Sfx.setEnabled(s.sound); Sfx.setCrowd(s.crowd);
  Render.reducedMotion = s.reducedMotion;
  document.body.classList.toggle('reduce-motion', s.reducedMotion);
  document.querySelectorAll('.toggle').forEach(b => b.setAttribute('aria-pressed', String(!!s[b.dataset.setting])));
}

// ---------- world shared with the renderer ----------
const world = { view: 'menu', shot: null, phase: 'ready', tPhase: 0, dive: null, result: null, motion: null, tap: null, kickClock: -9, trail: [], kit: kit(), glove: glove(), attack: null, boardText: '' };
let play = null, paused = false, frozen = false, timeScale = 1, face = { expr: 'focus', until: 0 };

// ---------- screens ----------
const SCREENS = ['home', 'career', 'shootout', 'locker', 'trophies', 'settings', 'help'];
let current = 'home';
function show(name) {
  current = name;
  for (const s of SCREENS) $('screen-' + s).hidden = s !== name;
  $('hud').hidden = name !== 'hud';
  if (name === 'home') renderHome();
  if (name === 'career') renderCareer();
  if (name === 'shootout') renderShootoutPick();
  if (name === 'locker') renderLocker();
  if (name === 'trophies') renderTrophies();
  if (name !== 'hud') { world.view = 'menu'; world.shot = null; world.dive = null; world.result = null; Render.crowdColors = [kit().shirt, '#ff6b4a']; world.boardText = 'GOOFY GOALKEEPER   ·   NO ADS, JUST SAVES'; }
}
function sheet(id, on) { $(id).hidden = !on; }
function banner(text) {
  const b = $('banner'); b.textContent = text; b.hidden = false;
  clearTimeout(banner.t); banner.t = setTimeout(() => { b.hidden = true; }, 2600);
}

function renderHome() {
  const li = GG.levelInfo(profile.xp);
  $('lv-num').textContent = li.level; $('xp-fill').style.width = `${Math.round(li.progress * 100)}%`;
  const m = GG.currentMatch(profile), comp = GG.TOURNAMENTS.find(t => t.id === m.tournament);
  const allDone = GG.ALL_MATCHES.every(x => profile.career[x.id] > 0);
  $('career-sub').textContent = allDone ? 'Champion · chase every star' : `${comp.name} · ${m.boss ? 'Boss: ' + GG.BOSSES[m.boss].name : 'vs ' + GG.TEAMS[m.team].name}`;
  $('career-stars').textContent = `${GG.careerStars(profile)} ★`;
  const key = GG.localDateKey(), best = profile.daily.best[key];
  $('daily-sub').textContent = best !== undefined ? `Best today ${best}` : (profile.daily.streak > 0 && profile.daily.last === GG.previousDay(key) ? `Keep your ${profile.daily.streak}-day streak` : 'New shots today');
  $('survival-sub').textContent = profile.stats.survivalBest ? `Best ${profile.stats.survivalBest}` : '3 lives, no mercy';
  $('training-sub').textContent = profile.tutorialDone ? 'Replay 7 lessons' : 'Start here';
  const newGear = GG.GLOVES.some(g => GG.unlockMet(profile, g.unlock) && !profile.seen.gloves.includes(g.id)) || GG.KITS.some(k => GG.unlockMet(profile, k.unlock) && !profile.seen.kits.includes(k.id));
  $('locker-dot').hidden = !newGear;
}

const styleChips = styles => Object.keys(styles).sort((a, b) => styles[b] - styles[a]).map(s => `<span>${GG.STYLES[s].label}</span>`).join('');
const crest = (colors, label) => `<span class="crest" style="--a:${colors[0]};--b:${colors[1]}">${esc(label)}</span>`;

function renderCareer() {
  $('career-total').textContent = `${GG.careerStars(profile)} / ${GG.ALL_MATCHES.length * 3} ★`;
  const next = GG.currentMatch(profile);
  $('career-list').innerHTML = GG.TOURNAMENTS.map(t => {
    const stars = t.matches.reduce((s, m) => s + (profile.career[m.id] || 0), 0);
    const rows = t.matches.map((m, i) => {
      const taker = m.boss ? GG.BOSSES[m.boss] : GG.TEAMS[m.team];
      const unlocked = GG.isMatchUnlocked(profile, m.id), st = profile.career[m.id] || 0;
      const label = m.boss ? taker.name.split(' ').map(w => w[0]).join('').slice(0, 3) : taker.short;
      return `<button class="match ${m.boss ? 'boss' : ''} ${m.id === next.id && !(st > 0) ? 'next' : ''}" data-match="${m.id}" ${unlocked ? '' : 'disabled'} aria-label="${esc(taker.name)}${unlocked ? '' : ', locked'}${st ? `, ${st} stars` : ''}">
        ${crest(taker.colors, label)}
        <span class="m-text"><b>${esc(taker.name)}</b><small>${m.boss ? esc(taker.title) + ' · ' + m.shots + ' penalties' : `Match ${i + 1} · ${m.shots} shots · ${Object.keys(taker.styles).map(s => GG.STYLES[s].label).slice(0, 2).join(', ')}`}</small></span>
        ${unlocked ? `<span class="mini-stars">${[1, 2, 3].map(n => starSvg(st >= n)).join('')}</span>` : '<svg style="color:var(--muted)"><use href="#i-lock"/></svg>'}
      </button>`;
    }).join('');
    return `<div class="comp" style="--c:${t.color}"><div class="comp-head"><span class="cup ${profile.trophies[t.id] ? 'won' : ''}"><svg><use href="#i-trophy"/></svg></span><div><b>${t.name}</b><small>${profile.trophies[t.id] ? 'Won: ' : 'Prize: '}${t.trophy}</small></div><span class="comp-stars">${stars}/12 ★</span></div>${rows}</div>`;
  }).join('');
  document.querySelectorAll('[data-match]').forEach(b => b.onclick = () => { Sfx.play('click'); openPrematch(b.dataset.match); });
}

let pendingMatch = null;
function openPrematch(id) {
  const m = GG.findMatch(id); if (!m) return;
  pendingMatch = m;
  const taker = GG.takerFor(m), comp = GG.TOURNAMENTS.find(t => t.id === m.tournament);
  const idx = comp.matches.findIndex(x => x.id === id) + 1;
  $('pm-crest').style.cssText = `--a:${taker.colors[0]};--b:${taker.colors[1]}`;
  $('pm-crest').textContent = m.boss ? taker.name.split(' ').map(w => w[0]).join('').slice(0, 3) : taker.short;
  $('pm-comp').textContent = `${comp.name} · ${m.boss ? 'Final' : 'Match ' + idx}`;
  $('pm-name').textContent = taker.name;
  $('pm-blurb').textContent = m.boss ? `“${taker.quote}”` : taker.blurb;
  $('pm-chips').innerHTML = styleChips(taker.styles) + (taker.patience ? '<span>Punishes early dives</span>' : '') + (taker.honesty < 0.5 ? '<span>Lying lean</span>' : '');
  const half = Math.floor(m.allow / 2);
  $('pm-objective').innerHTML = `Face <b>${m.shots} ${m.boss ? 'penalties' : 'shots'}</b>${!m.boss && m.pens ? ` (${m.pens} from the spot)` : ''}. Concede <b>${m.allow} or fewer</b> to win.<br>★★ ${half} or fewer · ★★★ clean sheet`;
  $('pm-tip').hidden = !m.boss; if (m.boss) $('pm-tip').textContent = taker.tip;
  sheet('prematch', true);
}

function renderShootoutPick() {
  const items = GG.TOURNAMENTS.flatMap(t => t.matches.filter(m => m.team).map(m => ({ t, m, team: GG.TEAMS[m.team] })));
  $('shootout-list').innerHTML = GG.TOURNAMENTS.map(t => {
    const rows = items.filter(x => x.t.id === t.id).map(({ m, team }) => {
      const open = GG.isMatchUnlocked(profile, m.id);
      return `<button class="match" data-team="${m.team}" data-tier="${t.tier}" ${open ? '' : 'disabled'}>${crest(team.colors, team.short)}<span class="m-text"><b>${esc(team.name)}</b><small>${open ? esc(team.blurb) : 'Reach this club in Career to unlock'}</small></span>${open ? '' : '<svg style="color:var(--muted)"><use href="#i-lock"/></svg>'}</button>`;
    }).join('');
    return `<div class="comp" style="--c:${t.color}"><div class="comp-head"><span class="cup"><svg><use href="#i-target"/></svg></span><div><b>${t.name} clubs</b><small>${['Gentle', 'Tricky', 'Tough', 'Elite'][t.tier]} keepers and takers</small></div></div>${rows}</div>`;
  }).join('');
  document.querySelectorAll('[data-team]').forEach(b => b.onclick = () => { Sfx.play('click'); startShootout(b.dataset.team, +b.dataset.tier); });
}

const gloveIcon = g => `<span class="glove-swatch" style="background:${g.colors[0]};color:${g.colors[1]}"><svg><use href="#i-glove"/></svg></span>`;
function statBar(label, v) { return `<span>${label}</span><span class="bar"><i style="width:${Math.round(Math.min(1, (v - 0.85) / 0.35) * 100)}%"></i></span>`; }
function renderLocker() {
  profile.seen.gloves = GG.GLOVES.filter(g => GG.unlockMet(profile, g.unlock)).map(g => g.id);
  profile.seen.kits = GG.KITS.filter(k => GG.unlockMet(profile, k.unlock)).map(k => k.id);
  save();
  $('locker-glove-name').textContent = glove().name; $('locker-kit-name').textContent = kit().name;
  $('glove-list').innerHTML = GG.GLOVES.map(g => {
    const open = GG.unlockMet(profile, g.unlock), on = profile.glove === g.id;
    return `<button class="gear ${on ? 'on' : ''} ${open ? '' : 'locked'}" data-glove="${g.id}" aria-pressed="${on}" ${open ? '' : 'aria-disabled="true"'}>${gloveIcon(g)}<span class="g-text"><b>${g.name}${on ? ' · equipped' : ''}</b><small>${open ? esc(g.blurb) : '🔒 ' + esc(GG.unlockText(g.unlock))}</small><span class="statbars">${statBar('Reach', g.reach)}${statBar('Grip', g.grip)}${statBar('Spring', g.spring)}</span></span></button>`;
  }).join('');
  $('kit-list').innerHTML = GG.KITS.map(k => {
    const open = GG.unlockMet(profile, k.unlock), on = profile.kit === k.id;
    return `<button class="kit ${on ? 'on' : ''} ${open ? '' : 'locked'}" data-kit="${k.id}" aria-pressed="${on}" aria-label="${esc(k.name)}${open ? '' : ', locked: ' + esc(GG.unlockText(k.unlock))}"><span class="shirt" style="background:${k.shirt};--trim:${k.trim}"></span>${open ? esc(k.name) : esc(GG.unlockText(k.unlock))}</button>`;
  }).join('');
  document.querySelectorAll('[data-glove]').forEach(b => b.onclick = () => {
    const g = GG.gloveById(b.dataset.glove);
    if (!GG.unlockMet(profile, g.unlock)) { banner(GG.unlockText(g.unlock)); return; }
    profile.glove = g.id; save(); Sfx.play('slap'); haptic('light'); renderLocker();
  });
  document.querySelectorAll('[data-kit]').forEach(b => b.onclick = () => {
    const k = GG.kitById(b.dataset.kit);
    if (!GG.unlockMet(profile, k.unlock)) { banner(GG.unlockText(k.unlock)); return; }
    profile.kit = k.id; save(); Sfx.play('click'); haptic('light'); renderLocker();
  });
}

function renderTrophies() {
  $('cabinet').innerHTML = GG.TOURNAMENTS.map(t => `<div class="cab ${profile.trophies[t.id] ? 'won' : ''}" style="--c:${t.color}"><svg><use href="#i-trophy"/></svg>${t.trophy}</div>`).join('');
  const got = GG.ACHIEVEMENTS.filter(a => profile.achievements[a.id]).length;
  $('ach-count').textContent = `${got} / ${GG.ACHIEVEMENTS.length}`;
  $('ach-list').innerHTML = GG.ACHIEVEMENTS.map(a => `<div class="${profile.achievements[a.id] ? 'on' : ''}"><b>${a.name}</b><small>${a.desc}</small></div>`).join('');
  const s = profile.stats, pct = s.shots ? Math.round(s.saves / Math.max(1, s.saves + s.goals) * 100) : 0;
  const rows = [['Keeper level', GG.levelInfo(profile.xp).level], ['Total XP', profile.xp], ['Shots faced', s.shots], ['Saves', s.saves], ['Save rate (on target)', pct + '%'], ['Catches', s.catches], ['Parries', s.parries], ['Fingertip saves', s.tips], ['Reflex saves', s.reactions], ['Penalties saved', `${s.pensSaved} / ${s.pensFaced}`], ['Goals conceded', s.goals], ['Clean sheets', s.cleanSheets], ['Longest save streak', s.bestStreak], ['Career stars', `${GG.careerStars(profile)} / 48`], ['Survival best', s.survivalBest], ['Shootouts won', `${s.shootoutsWon} / ${s.shootoutsPlayed}`], ['Daily streak (best)', `${profile.daily.streak} (${profile.daily.bestStreak})`]];
  $('stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

// ---------- HUD ----------
const hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function setHTML(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).innerHTML = v; } }
function callout(text, sub, cls) {
  const c = $('callout'); c.className = 'callout'; c.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : '');
  void c.offsetWidth; c.className = `callout show ${cls || ''}`;
}
function coach(text) { $('coach').hidden = !text; if (text) $('coach-text').textContent = text; }
function updateHUD() {
  if (!play) return;
  if (play.kind === 'shootout') {
    const so = play.so, st = so.status();
    setText('hud-title', `Shootout vs ${play.team.name}`);
    setText('hud-sub', st.suddenDeath ? 'Sudden death' : `Round ${Math.min(5, Math.max(so.player.length, so.opp.length) + (st.done ? 0 : 1))} of 5`);
    setText('hud-score', `${st.playerGoals} – ${st.oppGoals}`); setText('hud-mult', play.turn === 'shoot' ? 'YOUR KICK' : 'IN GOAL');
    const row = (arr, label) => `<div class="row"><em>${label}</em>${Array.from({ length: Math.max(5, arr.length) }, (_, i) => `<span class="pip ${i < arr.length ? (arr[i] ? 'save' : 'goal') : ''}"></span>`).join('')}</div>`;
    setHTML('hud-pips', row(so.player, 'YOU') + row(so.opp, play.team.short));
    return;
  }
  const s = play.session;
  setText('hud-score', String(s.score)); setText('hud-mult', `x${s.mult.toFixed(2).replace(/0$/, '')}`);
  if (play.kind === 'survival') {
    setText('hud-title', 'Survival'); setText('hud-sub', `Shot ${Math.max(1, s.index + 1)} · tier ${Math.min(4, Math.floor(Math.max(0, s.index) / 8) + 1)}`);
    setHTML('hud-pips', `<div class="row">${[0, 1, 2].map(i => `<svg class="${i < s.goals ? 'lost' : ''}"><use href="#i-heart"/></svg>`).join('')}</div>`);
  } else if (play.kind === 'training') {
    setText('hud-title', 'Training with Coach Pickles'); setText('hud-sub', `Lesson ${Math.min(GG.TRAINING.length, (s.lessonIndex || 0) + 1)} of ${GG.TRAINING.length}`);
    setHTML('hud-pips', `<div class="row">${GG.TRAINING.map((_, i) => `<span class="pip ${i < (s.lessonIndex || 0) || (i === s.lessonIndex && s.phase === 'result' && s.last && s.last.outcome !== 'goal') ? 'save' : ''} ${i === s.lessonIndex ? 'now' : ''}"></span>`).join('')}</div>`);
  } else {
    const n = s.maxShots;
    setText('hud-sub', play.kind === 'career' ? `Shot ${Math.min(n, s.index + 1 || 1)} of ${n} · conceded ${s.goals}/${play.match.allow}` : `Shot ${Math.min(n, s.index + 1 || 1)} of ${n}`);
    setHTML('hud-pips', `<div class="row">${Array.from({ length: n }, (_, i) => { const r = s.results[i]; return `<span class="pip ${r ? (r.outcome === 'goal' ? 'goal' : (r.outcome === 'wide' || r.outcome === 'post') ? 'wide' : 'save') : ''} ${i === s.index && !r ? 'now' : ''}"></span>`; }).join('')}</div>`);
  }
}

// ---------- starting modes ----------
function beginKeeperPlay(kind, session, extra) {
  play = Object.assign({ kind, session }, extra || {});
  paused = false; timeScale = 1;
  world.view = 'keeper'; world.shot = null; world.dive = null; world.result = null; world.motion = null; world.trail = [];
  world.kit = kit(); world.glove = glove();
  for (const k in hudCache) delete hudCache[k];
  show('hud'); coach(null);
  $('hud-hint').textContent = 'Tap where the ball is going';
  Sfx.unlock(); Sfx.play('whistle');
  updateHUD();
}
function startCareer(m) {
  const taker = GG.takerFor(m), comp = GG.TOURNAMENTS.find(t => t.id === m.tournament);
  const session = GG.careerSession(m, { glove: glove(), assist: profile.settings.assist });
  world.boardText = `${comp.name.toUpperCase()}   ·   ${taker.name.toUpperCase()}`;
  beginKeeperPlay('career', session, { match: m });
  setText('hud-title', taker.name);
}
function startDaily() {
  const key = GG.localDateKey();
  world.boardText = `DAILY CHALLENGE   ·   ${key}`;
  beginKeeperPlay('daily', GG.dailySession(key, { glove: glove() }), { date: key });
  setText('hud-title', 'Daily Challenge');
}
function startSurvival() {
  world.boardText = 'SURVIVAL   ·   THREE LIVES';
  beginKeeperPlay('survival', GG.survivalSession({ glove: glove(), assist: profile.settings.assist }));
}
function startTraining() {
  world.boardText = 'TRAINING GROUND   ·   COACH PICKLES';
  beginKeeperPlay('training', GG.trainingSession({ glove: glove() }));
  $('hud-hint').textContent = '';
}
function startShootout(teamId, tier) {
  const team = GG.TEAMS[teamId];
  play = { kind: 'shootout', so: new GG.Shootout(teamId, { tier }), team, teamId, tier, rng: Math.random, keep: { shots: 0, saves: 0, goals: 0, catches: 0, parries: 0, tips: 0, reactions: 0, pensFaced: 0, pensSaved: 0, bestStreak: 0, panenkasStopped: 0 }, turn: null };
  paused = false; timeScale = 1;
  world.kit = kit(); world.glove = glove();
  world.boardText = `PENALTY SHOOTOUT   ·   ${team.name.toUpperCase()}`;
  Render.crowdColors = [team.colors[0], kit().shirt];
  for (const k in hudCache) delete hudCache[k];
  show('hud'); coach(null); Sfx.unlock(); Sfx.play('whistle');
  nextShootoutTurn();
}
function nextShootoutTurn() {
  const so = play.so, st = so.status();
  if (st.done) { finishShootout(st); return; }
  play.turn = so.next;
  if (play.turn === 'shoot') {
    world.view = 'attack'; world.shot = null;
    world.attack = { aiming: false, aim: { x: 0, y: 1 }, power: 0, hold: 0, kick: null, kickClock: null, dive: null, result: null, keeperKit: { shirt: play.team.colors[1], trim: play.team.colors[0], shorts: '#1b1b1b' }, keeperGlove: { colors: ['#ffffff', '#30343c'] } };
    $('hud-hint').textContent = 'Hold, drag to aim, release in the green';
    callout('Your kick', st.suddenDeath ? 'Sudden death' : null, 'good');
  } else {
    world.view = 'keeper';
    const taker = Object.assign({ id: play.teamId }, play.team);
    play.session = new GG.KeeperSession({ rng: Math.random, glove: glove(), mode: 'shootout', shots: 1, firstDelay: 1.0, next: () => GG.generateShot(Math.random, taker, { tier: play.tier, penalty: true, assist: profile.settings.assist }) });
    world.dive = null; world.result = null; world.motion = null;
    $('hud-hint').textContent = 'Tap where the ball is going';
    callout('In goal', null, '');
  }
  updateHUD();
}

// ---------- keeper session events ----------
const SAVE_WORDS = { catch: ['Held it!', 'Safe hands', 'In the bag'], parry: ['Parried!', 'Pushed away', 'Big hands!'], tip: ['Fingertips!', 'What a save!', 'Worldie!'] };
const GOAL_WORDS = ['Goal…', 'Top bins', 'Not today', 'Oof'];
const pick = a => a[Math.floor(Math.random() * a.length)];
function onShot(ev) {
  const shot = ev.shot;
  world.shot = shot; world.result = null; world.motion = null; world.trail = []; world.tap = null;
  Render.crowdColors = [shot.taker.colors[0], kit().shirt];
  face = { expr: 'focus', until: 0 };
  if (shot.penalty) Sfx.play('whistle');
  if (play.kind === 'training') {
    const s = play.session, lesson = s.lesson;
    coach(lesson ? (play.retry ? 'Not quite. ' : '') + lesson.coach : null); play.retry = false;
  } else if (shot.penalty && play.kind !== 'shootout') callout('Penalty!', shot.taker.boss ? shot.taker.name : null, '');
  if (play.session.index >= 2 && play.kind !== 'training') $('hud-hint').textContent = '';
  updateHUD();
}
function onResult(ev) {
  const shot = ev.shot, s = play.session;
  world.result = ev;
  const sgn = Math.sign(shot.tx) || 1;
  const pos = Render.fromGoal(shot.tx, shot.ty);
  if (ev.save) {
    if (ev.outcome === 'catch') world.motion = { follow: true };
    else if (ev.outcome === 'tip' && shot.ty > 1.5) world.motion = { x: shot.tx, y: shot.ty, z: 0, vx: sgn * 1.2, vy: 3.4, vz: -3.5 };
    else world.motion = { x: shot.tx, y: shot.ty, z: 0, vx: sgn * 4.5, vy: 2.2, vz: ev.outcome === 'tip' ? -3 : 5 };
    Sfx.play(ev.outcome === 'catch' ? 'slap' : 'parry'); Sfx.play('roar', ev.outcome === 'tip' ? 1 : 0.6);
    Render.cheer(ev.outcome === 'tip' ? 1 : 0.7); Render.bump(shot.power > 0.8 ? 7 : 3);
    Render.burst(pos.x, pos.y, ev.outcome === 'tip' ? 28 : 16, ev.outcome === 'tip' ? ['#ffd23f', '#ffffff'] : ['#d8f56d', '#ffffff']);
    haptic(ev.outcome === 'tip' || shot.power > 0.8 ? 'heavy' : 'medium');
    const extra = [ev.reaction ? 'Reflex save' : null, shot.penalty ? 'Penalty saved' : null, shot.style === 'chip' && shot.penalty ? 'Panenka denied' : null].filter(Boolean).join(' · ');
    callout(pick(SAVE_WORDS[ev.outcome]), (ev.points ? `+${ev.points}` : '') + (extra ? `  ${extra}` : ''), 'good');
    face = { expr: 'grin', until: performance.now() + 1500 };
  } else if (ev.goal) {
    world.motion = { x: shot.tx, y: shot.ty, z: 0, vx: (shot.tx - shot.sx) / shot.T * 0.3, vy: 0, vz: -8, stopZ: -1.3 };
    Sfx.play('net'); Sfx.play('groan'); Render.bump(4); Render.cheer(0.5); haptic('error');
    callout(shot.reaimed ? 'He waited!' : pick(GOAL_WORDS), shot.reaimed ? 'Dived too early' : (shot.style === 'curve' ? 'Bent it in' : shot.style === 'knuckle' ? 'It wobbled' : null), 'bad');
    face = { expr: 'shock', until: performance.now() + 1500 };
    if (play.kind === 'training') play.retry = true;
  } else {
    const post = ev.outcome === 'post';
    world.motion = post ? { x: shot.tx, y: shot.ty, z: 0, vx: -sgn * 2, vy: 1.6, vz: 6 } : { x: shot.tx, y: shot.ty, z: 0, vx: (shot.tx - shot.sx) / shot.T, vy: 0.4, vz: -shot.D / shot.T };
    Sfx.play(post ? 'post' : 'ooh'); if (post) { Render.bump(5); haptic('medium'); }
    callout(post ? 'Off the post!' : shot.ty > 2.44 ? 'Over the bar!' : 'Wide!', 'Phew', '');
    face = { expr: post ? 'dizzy' : 'smug', until: performance.now() + 1500 };
  }
  updateHUD();
}
function stepKeeper(dt) {
  const s = play.session;
  // slow motion just before a fingertip save
  if (s.phase === 'flight' && s.dive && !profile.settings.reducedMotion) {
    const p = s.t / s.shot.T;
    if (p > 0.72) { const pre = GG.resolveSave(s.shot, s.dive, glove()); timeScale = pre.outcome === 'tip' ? 0.32 : 1; }
  } else if (s.phase !== 'flight') timeScale = 1;
  const events = s.step(dt * timeScale);
  world.phase = s.phase; world.tPhase = s.t; world.dive = s.dive; world.shot = s.shot || world.shot;
  world.kickClock = s.phase === 'runup' ? s.t - s.shot.runup : s.phase === 'flight' ? s.t : s.phase === 'result' ? s.shot.T + s.t : -9;
  for (const ev of events) {
    if (ev.type === 'shot') onShot(ev);
    else if (ev.type === 'kick') { Sfx.play('kick'); world.shot = ev.shot; }
    else if (ev.type === 'result') onResult(ev);
    else if (ev.type === 'done') { onSessionDone(ev.summary); return; }
  }
  if (world.tap) world.tap.age += dt;
}
function onSessionDone(summary) {
  if (play.kind === 'shootout') {
    const r = play.session.results[0];
    const k = play.keep;
    for (const f of ['shots', 'saves', 'goals', 'catches', 'parries', 'tips', 'reactions', 'pensFaced', 'pensSaved', 'panenkasStopped']) k[f] += summary[f] || 0;
    play.so.record('keep', r && r.outcome === 'goal');
    nextShootoutTurn();
    return;
  }
  finishKeeper(summary);
}

// ---------- attack (player kicks in the shootout) ----------
function stepAttack(dt) {
  const a = world.attack; if (!a) return;
  if (a.aiming) { a.hold += dt; a.power = 0.5 - 0.5 * Math.cos(a.hold * Math.PI * 2 / 1.3); }
  if (a.kick) {
    a.kickClock += dt;
    if (!a.result && a.kickClock >= a.kick.T) {
      a.result = a.pending;
      const r = a.result;
      if (r.goal) { Sfx.play('net'); Sfx.play('roar', 1); Render.cheer(1); haptic('success'); callout('Goal!', a.kick.sweet ? 'Perfect strike' : null, 'good'); Render.confetti(); }
      else if (r.save) { Sfx.play('parry'); Sfx.play('groan'); haptic('error'); callout('Saved!', 'Their keeper guessed right', 'bad'); }
      else { Sfx.play(r.outcome === 'post' ? 'post' : 'ooh'); haptic('error'); callout(r.outcome === 'post' ? 'Off the post!' : a.kick.ty > 2.44 ? 'Over the bar!' : 'Wide!', a.kick.sweet ? null : 'Watch the power', 'bad'); }
    }
    if (a.kickClock >= a.kick.T + 1.6 && !a.recorded) {
      a.recorded = true;
      play.so.record('shoot', a.result.goal);
      updateHUD();
      setTimeout(() => { if (play && play.kind === 'shootout') nextShootoutTurn(); }, 250);
    }
  }
}
function attackPointer(type, x, y) {
  const a = world.attack; if (!a || a.kick) return;
  if (type === 'down') { a.aiming = true; a.hold = 0; a.start = { x, y }; a.aim = { x: 0, y: 1.0 }; Sfx.unlock(); haptic('light'); }
  else if (type === 'move' && a.aiming) {
    a.aim = { x: GG.clamp((x - a.start.x) / (Render.W * 0.3) * 3.66, -4.2, 4.2), y: GG.clamp(1.0 + (a.start.y - y) / (Render.H * 0.16) * 1.2, 0.05, 2.9) };
  } else if (type === 'up' && a.aiming) {
    a.aiming = false;
    const kick = GG.playerKick(a.aim, a.power, Math.random);
    a.pending = GG.resolveKick(kick, play.tier, Math.random, profile.settings.assist);
    a.kick = kick; a.dive = a.pending.dive; a.kickClock = 0;
    Sfx.play('kick'); haptic('medium');
  }
}

// ---------- results ----------
let lastLaunch = null;
function finishKeeper(summary) {
  const p = play; play = null; timeScale = 1;
  const s = Object.assign({}, summary);
  if (p.kind === 'career') s.matchId = p.match.id;
  if (p.kind === 'daily') s.date = p.date;
  const out = GG.recordSession(profile, s); save();
  showResult(p, s, out);
}
function finishShootout(st) {
  const p = play; play = null;
  const s = Object.assign({ mode: 'shootout', won: st.won, suddenDeath: st.suddenDeath, score: st.playerGoals * 100 + (st.won ? 500 : 0) }, p.keep);
  const out = GG.recordSession(profile, s); save();
  showResult(p, Object.assign(s, { pg: st.playerGoals, og: st.oppGoals }), out);
}
function showResult(p, s, out) {
  lastLaunch = p;
  let eyebrow = 'Full time', title = 'Well played', stars = null, nextLabel = null;
  if (p.kind === 'career') {
    const m = p.match;
    stars = out.stars;
    eyebrow = `${GG.TOURNAMENTS.find(t => t.id === m.tournament).name} · ${m.boss ? 'Final' : 'Full time'}`;
    title = out.trophy ? `${GG.TOURNAMENTS.find(t => t.id === out.trophy).trophy} is yours!` : stars === 3 ? 'Clean sheet!' : stars > 0 ? 'You won!' : s.lost ? 'Beaten this time' : 'Beaten this time';
    const i = GG.ALL_MATCHES.findIndex(x => x.id === m.id), nx = GG.ALL_MATCHES[i + 1];
    if (stars > 0 && nx) nextLabel = 'Next match';
  } else if (p.kind === 'shootout') {
    eyebrow = `Shootout · ${s.pg} – ${s.og}`; title = s.won ? (s.suddenDeath ? 'Ice cold. You win!' : 'Shootout hero!') : 'Lost on penalties';
  } else if (p.kind === 'survival') { eyebrow = `Survival · ${s.shots} shots faced`; title = out.newRecord ? 'New record!' : 'Three goals. Game over.'; }
  else if (p.kind === 'daily') { eyebrow = `Daily Challenge · ${s.date}`; title = out.newRecord ? 'New daily best!' : 'Daily done'; }
  else if (p.kind === 'training') { eyebrow = 'Training complete'; title = 'Gus is match fit.'; nextLabel = 'Start career'; }
  $('res-eyebrow').textContent = eyebrow; $('res-title').textContent = title;
  $('res-stars').hidden = stars === null; if (stars !== null) $('res-stars').innerHTML = [1, 2, 3].map(n => starSvg(stars >= n)).join('');
  $('res-score').textContent = p.kind === 'shootout' ? `${s.pg} – ${s.og}` : String(s.score);
  const cells = p.kind === 'training' ? [['Saves', s.saves], ['Lessons', GG.TRAINING.length], ['Tries', s.shots]]
    : [['Saves', s.saves], ['Goals', s.goals], ['Best streak', s.bestStreak], ['Catches', s.catches], ['Fingertips', s.tips], ['Reflex', s.reactions]];
  $('res-grid').innerHTML = cells.map(([k, v]) => `<div><b>${v}</b><small>${k}</small></div>`).join('');
  const li = GG.levelInfo(profile.xp);
  $('res-xp').textContent = `+${out.xp} XP`; $('res-level').textContent = `LV ${li.level}`;
  $('res-xp-fill').style.width = '0%'; requestAnimationFrame(() => requestAnimationFrame(() => { $('res-xp-fill').style.width = `${Math.round(li.progress * 100)}%`; }));
  const un = [];
  if (out.levelUp) un.push(`<div>⬆︎ <span><b>Level ${out.levelUp}!</b> Keep climbing.</span></div>`);
  if (out.trophy) { const t = GG.TOURNAMENTS.find(x => x.id === out.trophy); un.push(`<div>🏆 <span><b>${t.name} champions</b> · ${t.trophy}</span></div>`); }
  for (const u of out.unlocks) un.push(`<div>${u.kind === 'glove' ? '🧤' : '👕'} <span>Unlocked <b>${esc(u.item.name)}</b> in the Locker</span></div>`);
  for (const a of out.achievements) un.push(`<div>🏅 <span><b>${esc(a.name)}</b> · ${esc(a.desc)}</span></div>`);
  $('res-unlocks').innerHTML = un.join('');
  $('res-next').hidden = !nextLabel; if (nextLabel) $('res-next').textContent = nextLabel;
  $('res-retry').textContent = p.kind === 'training' ? 'Train again' : p.kind === 'career' && stars > 0 ? 'Replay for stars' : 'Play again';
  sheet('result', true);
  const good = (stars || 0) > 0 || s.won || out.newRecord || p.kind === 'training';
  Sfx.play('whistle-long');
  setTimeout(() => { Sfx.play(good ? 'fanfare' : 'fail'); if (good) { Render.confetti(); haptic('success'); } if (out.unlocks.length || out.achievements.length) Sfx.play('unlock'); }, 600);
  world.view = 'menu'; world.shot = null; world.dive = null; world.result = null; world.attack = null;
  $('hud').hidden = true;
}
function relaunch(p) {
  sheet('result', false);
  if (p.kind === 'career') startCareer(p.match);
  else if (p.kind === 'daily') startDaily();
  else if (p.kind === 'survival') startSurvival();
  else if (p.kind === 'training') startTraining();
  else if (p.kind === 'shootout') startShootout(p.teamId, p.tier);
}

// ---------- pause ----------
function pauseGame() { if (!play || paused) return; paused = true; sheet('pause', true); }
function resumeGame() { if (!paused) return; paused = false; sheet('pause', false); Sfx.unlock(); }
function quitToMenu() { play = null; paused = false; sheet('pause', false); show('home'); }

// ---------- input ----------
const canvas = $('scene');
function localPoint(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (!play || paused) return;
  const p = localPoint(e);
  if (world.view === 'attack') { try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or ended pointer */ } attackPointer('down', p.x, p.y); return; }
  const g = Render.toGoal(p.x, p.y), r = play.session && play.session.diveAt(g.x, g.y);
  if (r) { world.tap = { x: r.dive.x, y: r.dive.y, age: 0 }; world.dive = r.dive; Sfx.play('dive'); haptic('light'); }
});
canvas.addEventListener('pointermove', e => { if (play && world.view === 'attack') { const p = localPoint(e); attackPointer('move', p.x, p.y); } });
for (const n of ['pointerup', 'pointercancel']) canvas.addEventListener(n, e => { if (play && world.view === 'attack') { const p = localPoint(e); attackPointer('up', p.x, p.y); } });
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' || e.key === ' ') { if (play) { e.preventDefault(); paused ? resumeGame() : pauseGame(); } return; }
  const grid = { 7: [-2.8, 1.9], 8: [0, 1.9], 9: [2.8, 1.9], 4: [-2.8, 1], 5: [0, 1], 6: [2.8, 1], 1: [-2.8, 0.3], 2: [0, 0.3], 3: [2.8, 0.3] }[e.key];
  if (grid && play && play.session && world.view === 'keeper' && !paused) { const r = play.session.diveAt(grid[0], grid[1]); if (r) { world.tap = { x: r.dive.x, y: r.dive.y, age: 0 }; Sfx.play('dive'); } }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { pauseGame(); Sfx.suspend(); } else if (profile.settings.sound) Sfx.unlock(); });
window.addEventListener('blur', pauseGame);
new ResizeObserver(() => Render.resize()).observe(canvas);

// ---------- buttons ----------
const click = (id, fn) => { $(id).addEventListener('click', () => { Sfx.unlock(); Sfx.play('click'); fn(); }); };
click('go-career', () => show('career'));
click('go-shootout', () => show('shootout'));
click('go-daily', startDaily);
click('go-survival', startSurvival);
click('go-training', startTraining);
click('go-locker', () => show('locker'));
click('go-trophies', () => show('trophies'));
click('home-level', () => show('trophies'));
click('go-help', () => show('help'));
click('open-settings', () => show('settings'));
document.querySelectorAll('.back').forEach(b => b.addEventListener('click', () => { Sfx.play('click'); show('home'); }));
click('pm-go', () => { sheet('prematch', false); if (pendingMatch) startCareer(pendingMatch); });
click('pm-cancel', () => sheet('prematch', false));
click('pause-btn', pauseGame);
click('resume-btn', resumeGame);
click('restart-btn', () => { const p = play; paused = false; sheet('pause', false); play = null; if (p) relaunch(p.kind === 'career' ? p : p); });
click('quit-btn', quitToMenu);
click('res-retry', () => relaunch(lastLaunch));
click('res-menu', () => { sheet('result', false); show('home'); });
click('res-next', () => {
  sheet('result', false);
  if (lastLaunch.kind === 'training') { show('career'); return; }
  const i = GG.ALL_MATCHES.findIndex(x => x.id === lastLaunch.match.id), nx = GG.ALL_MATCHES[i + 1];
  show('career'); if (nx) openPrematch(nx.id);
});
document.querySelectorAll('.toggle').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.setting; profile.settings[k] = !profile.settings[k]; save(); applySettings(); Sfx.play('click');
  if (k === 'haptics' && profile.settings.haptics) haptic('medium');
}));
click('replay-tutorial', startTraining);
click('reset-progress', () => sheet('confirm', true));
click('cf-no', () => sheet('confirm', false));
click('cf-yes', () => {
  profile = GG.newProfile(); profile.seen = { gloves: ['rookie'], kits: ['lime'] }; profile.welcomed = true;
  try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ }
  save(); applySettings(); sheet('confirm', false); show('home'); banner('Progress reset. Fresh gloves, fresh start.');
});
click('wl-train', () => { sheet('welcome', false); startTraining(); });
click('wl-skip', () => { sheet('welcome', false); });
$('version-label').textContent = `Goofy Goalkeeper ${VERSION} (3) · made for keepers everywhere`;

// ---------- main loop ----------
Render.init(canvas);
applySettings();
show('home');
if (!profile.welcomed && !profile.tutorialDone) { profile.welcomed = true; save(); sheet('welcome', true); }
let last = 0;
function loop(ts) {
  const t = ts / 1000, dt = last ? Math.min(0.05, t - last) : 0; last = t;
  if (play && !paused && !frozen) {
    if (world.view === 'attack') stepAttack(dt);
    else if (play.session) stepKeeper(dt);
    if (play) updateHUD();
  }
  world.kit = kit(); world.glove = glove();
  Render.frame(world, t, paused || frozen ? 0 : dt);
  // portraits
  const now = performance.now();
  if (!$('hud').hidden) {
    let expr = face.until > now ? face.expr : 'focus', look = 0;
    if (world.shot && world.view === 'keeper') { const b = world.phase === 'flight' ? GG.ballAt(world.shot, Math.min(1, world.tPhase / world.shot.T)) : { x: world.shot.sx }; look = GG.clamp(b.x / 3, -1, 1); }
    if (world.view === 'attack' && world.attack) expr = world.attack.result ? (world.attack.result.goal ? 'grin' : 'shock') : 'focus';
    Render.portrait($('facecam'), kit(), null, expr, look, t);
  }
  if (current === 'home' && !$('screen-home').hidden) Render.portrait($('mascot'), kit(), glove(), 'grin', Math.sin(t * 0.8) * 0.6, t);
  if (!$('welcome').hidden) Render.portrait($('welcome-face'), kit(), glove(), 'grin', Math.sin(t) * 0.5, t);
  if (current === 'locker') Render.portrait($('locker-canvas'), kit(), glove(), 'smug', Math.sin(t) * 0.4, t);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// test hook used by the automated browser checks (no network, read-only helpers)
window.__gg = { world, set frozen(v) { frozen = !!v; }, get frozen() { return frozen; }, get play() { return play; }, get profile() { return profile; }, startCareer: id => startCareer(GG.findMatch(id)), startDaily, startSurvival, startTraining, startShootout, show, openPrematch, setProfile(p) { profile = GG.normalizeProfile(p); profile.seen = profile.seen || { gloves: [], kits: [] }; profile.welcomed = true; save(); applySettings(); show('home'); } };
})();
