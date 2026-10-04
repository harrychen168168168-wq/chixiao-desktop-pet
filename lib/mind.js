const { EventEmitter } = require('events');
const LINES = require('./lines');
const { toOwner } = require('./address');
const { DEFAULTS: ALERT_LIMITS } = require('./alerts');
const { readJson, writeJson } = require('./util');
const TALK = {
  enabled: true,
  everyMinutes: [25, 50],   // something of its own this often (sooner when it is bored)
  workHours: 2,             // "take a break" after this long without one
};
const DAY_RHYTHM = { enabled: true, morning: [6, 12], lunch: [12, 14], evening: [21, 24] };
const DAILY_BOND = 12;      // what a day can add to the bond, however much it is stroked
const SOFT_BOND = 40;       // from here on the softer lines come too
const GAP_MS = 3000;        // a breath between two lines
const BREAK_MS = 280000;    // this long without the Owner (or with the PC asleep) ends "连续用电脑"; see tick()
const PLATFORM = { xcode: ' Xcode Cloud', codemagic: ' Codemagic', github: ' GitHub Actions', local: '本机' };
const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const two = (n) => String(n).padStart(2, '0');
const calendarDay = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const clockWords = () => {
  const t = new Date(Date.now());
  return { date: `${t.getMonth() + 1}月${t.getDate()}日`, week: `星期${'日一二三四五六'[t.getDay()]}`, time: `${t.getHours()}:${two(t.getMinutes())}` };
};
const dayOf = (d = new Date(Date.now())) => { const t = new Date(d.getTime() - 5 * 3600000); return `${t.getFullYear()}-${two(t.getMonth() + 1)}-${two(t.getDate())}`; };
const good = (s) => /^(success|succeeded|finished)$/i.test(s || '');
const bad = (s) => /fail|error|timeout|timed_out/i.test(s || '');
const latin = (s) => /^[\x00-\x7f]/.test(s);
const pct = (u) => Math.round((100 * u.usedGB) / u.totalGB);
const span = (ms) => {
  if (ms < 60000) return '不到 1 分钟';
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} 分钟` : m % 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分钟` : `${Math.floor(m / 60)} 小时`;
};
const leftOf = (p) => (p.remaining < 1 ? '不到 1 分钟' : p.id === 'xcode' && p.remaining >= 60 ? `${(p.remaining / 60).toFixed(1)} 小时` : `${Math.round(p.remaining)} 分钟`);

function took(f) {
  if (!f.start || !f.end) return '';
  const ms = new Date(f.end) - new Date(f.start);
  return ms >= 60000 ? `，用时 ${span(ms)}` : '';
}
function dueToday(text, now = new Date(Date.now())) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = raw.match(/^\s*[-*]\s+(?:(\d{4})-(\d{2})-(\d{2})\s+)?(.+)$/);
    if (!m) continue;
    const written = m[1] ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    const age = written ? Math.round((today - written) / 86400000) : null;
    const body = m[4].trim();
    const week = body.match(/(每个?|每逢)?(?:周|星期|礼拜)([一二三四五六日天](?:[、,，和及][一二三四五六日天])*)/);
    const month = body.match(/每个?月\s*(\d{1,2})\s*[号日]/);
    const date = body.match(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]/) || body.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    let due = false;
    if (/每天|每日|天天/.test(body)) due = true;
    else if (/工作日/.test(body)) due = today.getDay() >= 1 && today.getDay() <= 5;
    else if (/每个?周末/.test(body)) due = today.getDay() === 0 || today.getDay() === 6;
    else if (month) due = today.getDate() === Number(month[1]);
    else if (week) {
      const on = week[2].replace(/天/g, '日').includes('日一二三四五六'[today.getDay()]);
      due = on && (Boolean(week[1]) || age == null || (age >= 0 && age < 7));   // "周五…" without 每: the coming one only
    } else if (date) {
      due = today.getMonth() + 1 === Number(date[2]) && today.getDate() === Number(date[3])
        && (!date[1] || today.getFullYear() === Number(date[1])) && (age == null || (age >= 0 && age < 366));
    } else if (age != null) {
      due = (age === 0 && /今天|今晚/.test(body)) || (age === 1 && /明天|明晚|明早/.test(body)) || (age === 2 && /后天/.test(body));
    }
    if (due) out.push(body.replace(/^主人\s*/, '').replace(/。+$/, ''));
  }
  return out;
}
const remembered = (text) => String(text || '').split(/\r?\n/).filter((l) => /^\s*[-*]\s+\S/.test(l)).length;

class Mind extends EventEmitter {
  constructor(hub, { idleSeconds = () => 0, memoryText = () => '', file = 'mind.json', auto = true, log = () => {}, random = Math.random } = {}) {
    super();
    Object.assign(this, { hub, idleSeconds, memoryText, file, auto, log, random });
    this.cfg = { ...TALK, ...((hub.config.pet || {}).talk || {}) };
    this.rhythm = { ...DAY_RHYTHM, ...((hub.config.pet || {}).dayRhythm || {}) };
    this.limits = { ...ALERT_LIMITS, ...(hub.config.alerts || {}) };
    const saved = readJson(file, null) || {};
    this.s = {
      mood: clamp(saved.mood == null ? 60 : saved.mood),
      bond: Math.max(0, Number(saved.bond) || 0),
      bored: clamp(Number(saved.bored) || 0),
      at: Date.now(),
      greeted: saved.greeted || '',
      told: saved.told || {},                          // said once: key -> the day it was said
      gave: saved.gave || { day: '', n: 0 },           // bond earned today
      today: saved.today || { day: '', pets: 0 },      // counted today
      quietUntil: Number(saved.quietUntil) || 0,
    };
    this.queue = [];
    this.showingUntil = 0;
    this.showingPriority = 0;
    this.last = {};        // occasion -> the line it said last time
    this.reactedAt = {};   // occasion -> when it last answered with words
    this.seen = new Set();
    this.noticed = {};
    this.spoke = {};       // alert kind -> it said something about it
    this.ready = false;
    this.asleep = false;
    this.action = 'idle';
    this.sleptAt = 0;      // since when it has been asleep
    this.touchedAt = Date.now();   // the last time somebody touched it or talked to it
    this.workSince = 0;
    this.awaySince = 0;
    this.blind = false;    // its clock stood still for a part of the time the Owner was away (the PC slept)
    this.missed = [];      // what happened while the Owner was away
    this.longworkAt = 0;
    this.chatterAt = 0;
    this.remindedAt = 0;
    this.savedAt = 0;
    this.timer = null;
    this.flushTimer = null;
    hub.mind = this;       // lib/chat.js tells the agent how the dragon feels
  }

  start() {
    this.hub.on('active', (a) => this.onActive(a));
    this.hub.on('alerts', (list) => this.onAlerts(list || []));
    this.hub.on('quota', (q) => this.onQuota(q));
    this.onActive(this.hub.getActive());   // what is there already is not news
    this.onAlerts(this.hub.getAlerts() || []);
    this.ready = true;
    this.scheduleChatter();
    if (this.auto) {
      this.timer = setInterval(() => this.tick(), 20000);
      setTimeout(() => this.tick(), 8000);
    }
  }

  stop() {
    clearInterval(this.timer);
    clearTimeout(this.flushTimer);
    this.save(true);
  }

  state() {
    const { mood, bond } = this.s;
    return {
      mood: Math.round(mood),
      moodWord: mood >= 80 ? '很好' : mood >= 55 ? '不错' : mood >= 35 ? '一般' : mood >= 18 ? '不太好' : '很差',
      bond: Math.floor(bond),
      bondWord: bond >= 120 ? '非常熟' : bond >= SOFT_BOND ? '熟' : bond >= 10 ? '刚认识' : '还不熟',
      bored: Math.round(this.s.bored),
      petsToday: this.counted().pets,
      quietMinutes: Math.max(0, Math.ceil((this.s.quietUntil - Date.now()) / 60000)),
      asleep: this.asleep,
    };
  }

  feel(mood = 0, bored = 0) {
    this.s.mood = clamp(this.s.mood + mood);
    this.s.bored = clamp(this.s.bored + bored);
  }

  counted() {
    if (this.s.today.day !== dayOf()) this.s.today = { day: dayOf(), pets: 0 };
    return this.s.today;
  }

  earn(n) {
    const today = dayOf();
    if (this.s.gave.day !== today) this.s.gave = { day: today, n: 0 };
    const add = Math.min(n, DAILY_BOND - this.s.gave.n);
    if (add > 0) { this.s.gave.n += add; this.s.bond += add; }
  }

  once(key) {
    if (this.s.told[key] === dayOf()) return false;
    this.s.told[key] = dayOf();
    return true;
  }

  quiet() {
    return !this.cfg.enabled || Date.now() < this.s.quietUntil;
  }
  hush(minutes) {
    if (minutes > 0) {
      this.queue = [];
      if (!this.quiet()) this.speak({ occasion: 'quiet_on', vars: { minutes }, priority: 3 });
      this.s.quietUntil = Date.now() + minutes * 60000;
    } else {
      this.s.quietUntil = 0;
      this.speak({ occasion: 'quiet_off', priority: 3 });
    }
    this.save(true);
    return this.state();
  }

  save(now) {
    if (!now && Date.now() - this.savedAt < 60000) return;
    this.savedAt = Date.now();
    const cutoff = dayOf(new Date(Date.now() - 60 * 86400000));
    for (const k of Object.keys(this.s.told)) if (this.s.told[k] < cutoff) delete this.s.told[k];
    try { writeJson(this.file, { ...this.s, at: new Date().toISOString() }); } catch { /* its mood is not worth a crash */ }
  }

  tick() {
    const now = Date.now();
    const idle = Number(this.idleSeconds()) || 0;
    const present = idle < 120;
    const gap = now - this.s.at;
    const mins = Math.min(30, gap / 60000);
    this.s.at = now;
    if (gap >= BREAK_MS) {
      this.workSince = 0;
      this.blind = true;
      if (!this.awaySince) this.awaySince = now - gap;
    }
    this.s.mood += (60 - this.s.mood) * Math.min(1, mins / 90);   // it gets over things within an hour or two
    if (present) this.feel(0, mins * 1.5);                          // an hour without attention is a long time
    const d = new Date(now);
    if (present) {
      if (this.awaySince && now - this.awaySince >= 30 * 60000 && this.s.greeted === dayOf()) {
        const saw = this.missed.length ? `：${this.missed.slice(-3).join('；')}。` : '没有新的打包，也没有报警。';
        const summary = this.blind ? `本座醒着的那段${saw}中间电脑睡过，那段本座没看到。` : `这期间${saw}`;
        this.enqueue('back', { away: span(now - this.awaySince), summary });
      }
      this.awaySince = 0;
      this.blind = false;
      this.missed = [];
      if (!this.workSince) this.workSince = now;
    } else {
      if (idle * 1000 >= BREAK_MS) this.workSince = 0;   // a break (it looks every 20 s: none of 5 minutes gets past it)
      if (idle >= 300 && !this.awaySince) this.awaySince = now - idle * 1000;
    }
    if (present && !this.quiet()) {
      const h = d.getHours() + d.getMinutes() / 60;
      if (this.s.greeted !== dayOf()) {
        this.s.greeted = dayOf();
        this.earn(2);
        const night = h < 6 || h >= 23;
        if (night) this.once('latenight');   // the greeting says it already
        if (!this.rhythmSlot(d)) this.enqueue(night ? 'greet_night' : h < 12 ? 'greet_morning' : h < 14 ? 'greet_noon' : h < 18 ? 'greet_afternoon' : 'greet_evening', clockWords);
      }
      this.dayRhythm();
      if (now - this.remindedAt >= 30 * 60000) { this.remindedAt = now; this.remind(); }
      if (this.workSince && now - this.workSince >= this.cfg.workHours * 3600000 && now - this.longworkAt >= 90 * 60000) {
        this.longworkAt = now;
        this.enqueue('longwork', { hours: Math.floor((now - this.workSince) / 3600000) });
      }
      if (h >= 0.5 && h < 5 && this.once('latenight')) this.enqueue('latenight', clockWords);
      if (now >= this.chatterAt) { this.scheduleChatter(); this.chatter(); }
    }
    this.flush();
    this.save();
  }

  rhythmSlot(d = new Date(Date.now())) {
    if (!this.rhythm.enabled) return null;
    const h = d.getHours() + d.getMinutes() / 60;
    for (const [key, occasion] of [['morning', 'greet_morning'], ['lunch', 'lunch'], ['evening', 'evening_rest']]) {
      const range = this.rhythm[key];
      const [from, to] = Array.isArray(range) && range.length === 2 && range.every(Number.isFinite)
        && range[0] >= 0 && range[1] <= 24 && range[0] < range[1] ? range : DAY_RHYTHM[key];
      if (h >= from && h < to) return { key: `day-rhythm:${key}`, occasion };
    }
    return null;
  }
  dayRhythm() {
    if (this.quiet() || Number(this.idleSeconds()) >= 120) return;
    const d = new Date(Date.now()), slot = this.rhythmSlot(d), day = calendarDay(d);
    if (!slot || this.s.told[slot.key] === day || this.queue.some((q) => q.rhythm && q.rhythm.key === slot.key && q.rhythm.day === day)) return;
    this.enqueue(slot.occasion, () => {
      const at = new Date(Date.now()), current = this.rhythmSlot(at);
      return !this.quiet() && Number(this.idleSeconds()) < 120 && calendarDay(at) === day && current && current.key === slot.key
        ? clockWords() : null;
    }, { rhythm: { key: slot.key, day }, keepMs: 30 * 60000 });
  }

  scheduleChatter() {
    const [lo, hi] = this.cfg.everyMinutes;
    const wait = (lo + this.random() * (hi - lo)) * (1 - this.s.bored / 250);
    this.chatterAt = Date.now() + wait * 60000;
  }
  chatter() {
    if (this.quiet() || this.hub.getActive().running.length || (this.hub.getAlerts() || []).length || Date.now() < this.showingUntil) return;
    if (this.asleep) {
      const slept = this.sleptAt ? Date.now() - this.sleptAt : 0;
      if (slept >= 60000) this.enqueue('selfwake', { slept: span(slept) });
      else this.enqueue('selfwake_plain');
      setTimeout(() => this.muse(), 40000);
      return;
    }
    this.muse();
  }

  muse() {
    if (this.quiet() || Date.now() < this.showingUntil) return;
    const alone = Date.now() - this.touchedAt;   // counted since it was started, at the least
    if (this.s.bored >= 70 && alone >= 10 * 60000) { this.enqueue('lonely', { idle: span(alone) }); return; }
    const facts = this.facts().filter((f) => f !== this.last.fact);
    if (!facts.length) return;
    const fact = facts[Math.floor(this.random() * facts.length)];
    this.last.fact = fact;
    this.enqueue('musing', { fact });
  }
  facts() {
    const out = [];
    const s = this.hub.system.last;
    const a = this.hub.getActive();
    const q = this.hub.getQuota ? this.hub.getQuota() : null;
    const L = this.limits;
    if (s && s.ram && s.ram.totalGB) {
      const parts = [`内存 ${pct(s.ram)}%`];
      let fine = pct(s.ram) < L.ramPct;
      if (s.vram && s.vram.totalGB) { parts.push(`显存 ${pct(s.vram)}%`); fine = fine && pct(s.vram) < L.vramPct; }
      if (s.gpuTemp != null) { parts.push(`GPU ${Math.round(s.gpuTemp)}°C`); fine = fine && s.gpuTemp < L.gpuTemp; }
      if (fine) out.push(`现在${parts.join('、')}，都在警戒线以下。`);
    }
    out.push(a.running.length ? `现在有 ${a.running.length} 个包在打：${a.running.map((b) => b.project.name).join('、')}。` : '现在没有包在打。');
    for (const p of (q && q.platforms) || []) {
      if (!p.ok || p.stale || !p.resetAt || (p.refused && p.refused.blocked)) continue;
      const days = Math.floor((new Date(p.resetAt) - Date.now()) / 86400000);
      if (days < 1) continue;
      const est = p.official ? '' : '按估算（不是官方数），';
      out.push(`${est}${p.name} ${p.remaining <= 0 ? '这期的额度用完了' : `这期还剩 ${leftOf(p)}`}，${days} 天后重置。`);
    }
    const n = this.counted().pets;
    if (n > 0) out.push(`今天你摸了本座 ${n} 次。`);
    let kept = 0;
    try { kept = remembered(this.memoryText()); } catch { /* unreadable: nothing to say about it */ }
    if (kept > 0) out.push(`本座的长期记忆里现在有 ${kept} 条。`);
    if (this.workSince && Date.now() - this.workSince >= 20 * 60000) out.push(`你已经连续用了 ${span(Date.now() - this.workSince)}电脑。`);
    out.push(`本座现在心情${this.state().moodWord}，亲密度 ${Math.floor(this.s.bond)}。`);
    return out;
  }
  remind() {
    let due = [];
    try { due = dueToday(this.memoryText()); } catch { /* an unreadable memory file is no reason to stop */ }
    const d = new Date(Date.now());
    for (const what of due.slice(0, 3)) {
      if (this.once('due:' + what)) this.enqueue('remind', { what, day: `星期${'日一二三四五六'[d.getDay()]}` }, { priority: 2, keepMs: 30 * 60000 });
    }
  }
  enqueue(occasion, vars = {}, { priority = 1, keepMs = 10 * 60000, rhythm = null } = {}) {
    if (this.quiet()) return;
    this.queue.push({ occasion, vars, priority, keepMs, rhythm, at: Date.now() });
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), 700);   // what comes together is sorted first
  }

  flush() {
    const now = Date.now();
    this.queue = this.queue.filter((q) => now - q.at < q.keepMs);
    if (!this.queue.length) return;
    const free = this.showingUntil + GAP_MS;
    if (now < free) {
      clearTimeout(this.flushTimer);
      this.flushTimer = setTimeout(() => this.flush(), free - now + 50);
      return;
    }
    this.queue.sort((a, b) => b.priority - a.priority || a.at - b.at);
    this.speak(this.queue.shift());
    if (this.queue.length) this.flush();
  }
  speak(q) {
    if (q.rhythm && this.s.told[q.rhythm.key] === q.rhythm.day) return false;
    const o = LINES[q.occasion] || {};
    const vars = typeof q.vars === 'function' ? q.vars() : q.vars || {};
    if (!vars) return false;
    const known = (l) => (l.match(/\{(\w+)\}/g) || []).every((k) => vars[k.slice(1, -1)] != null && vars[k.slice(1, -1)] !== '' || ['took', 'who', 'summary'].includes(k.slice(1, -1)));
    const pool = (o.lines || []).filter((l) => typeof l === 'string' || this.s.bond >= SOFT_BOND).map((l) => (typeof l === 'string' ? l : l.soft)).filter(known);
    if (!pool.length) return false;
    const fresh = pool.length > 1 ? pool.filter((l) => l !== this.last[q.occasion]) : pool;
    const raw = fresh[Math.floor(this.random() * fresh.length)];
    this.last[q.occasion] = raw;
    const text = toOwner(raw.replace(/\{(\w+)\}/g, (_m, k) => (vars[k] != null ? vars[k] : '')));
    const ms = Math.round(clamp(2600 + text.length * 170, 4500, 12000));
    this.showingUntil = Date.now() + ms;
    this.showingPriority = q.priority || 1;
    if (q.rhythm) { this.s.told[q.rhythm.key] = q.rhythm.day; this.save(true); }
    this.log(`says (${q.occasion}): ${text}`);
    this.emit('say', { text, ms, occasion: q.occasion, emote: o.emote || null, act: o.act || null, wake: Boolean(o.wake), calm: Boolean(o.calm) });
    return true;
  }
  chatted() {
    this.showingUntil = Date.now() + 15000;
    this.showingPriority = 3;
    this.touchedAt = Date.now();
    this.feel(2, -40);
    this.earn(1);
  }
  touch(kind, { asleep = this.asleep, double = false } = {}) {
    if (!['pet', 'poke', 'annoy', 'lift', 'drop', 'hover', 'praise', 'play'].includes(kind)) return null;
    if (kind !== 'hover') { this.feel(0, -25); this.touchedAt = Date.now(); }
    if (kind === 'pet') {
      const grumpy = this.s.mood < 35;
      this.feel(4);
      this.earn(1);
      const n = ++this.counted().pets;
      return this.react(asleep ? 'pet_asleep' : grumpy ? 'pet_makeup' : 'pet', { gapMs: 20000, vars: { n, bond: Math.floor(this.s.bond) } });
    }
    if (kind === 'poke') {
      if (double) return this.react('listen', { gapMs: 60000, chance: 0.6 });
      return asleep ? this.react('poke_wake', { gapMs: 20000, chance: 0.8 }) : this.react('poke', { gapMs: 25000, chance: 0.45 });
    }
    if (kind === 'annoy') { this.feel(-12); return this.react('annoy', { gapMs: 8000, priority: 2 }); }
    if (kind === 'lift') { this.feel(-3); return this.react('lift', { gapMs: 15000, priority: 2 }); }
    if (kind === 'drop') return this.react('drop', { gapMs: 15000, chance: 0.8, priority: 2 });
    if (kind === 'praise' || kind === 'play') {
      this.feel(kind === 'praise' ? 3 : 2, -30);
      this.earn(1);
      return this.react(kind, { gapMs: 20000 });
    }
    if (kind === 'hover' && !asleep) return this.react('hover', { gapMs: 5 * 60000, chance: 0.3 });
    return null;
  }
  react(occasion, { gapMs = 20000, chance = 1, priority = 1, vars = {} } = {}) {
    const now = Date.now();
    const o = LINES[occasion] || {};
    const free = now >= this.showingUntil || priority > this.showingPriority;
    const due = now - (this.reactedAt[occasion] || 0) >= gapMs;
    if (!this.quiet() && free && due && this.random() < chance) {
      this.reactedAt[occasion] = now;
      this.speak({ occasion, vars, priority });
    } else if (o.emote || o.act) {
      this.emit('say', { text: null, ms: 0, occasion, emote: o.emote || null, act: o.act || null, wake: false, calm: true });
    }
    this.save();
    return occasion;
  }
  report(action) {
    const was = this.asleep;
    this.action = action;
    this.asleep = action === 'sleep' || action === 'lie';
    if (this.asleep && !was) this.sleptAt = Date.now();
    if (!this.asleep) this.sleptAt = 0;
    if (action === 'lie' && !was && Date.now() >= this.showingUntil + GAP_MS) this.react('sleepy', { gapMs: 20 * 60000, chance: 0.4 });
  }

  away() {
    return Boolean(this.awaySince);
  }

  onActive(a) {
    for (const b of a.running || []) {
      if (this.seen.has('run:' + b.key)) continue;
      this.seen.add('run:' + b.key);
      if (!this.ready) continue;
      if (this.away()) this.missed.push(`${b.project.name} 开始打包`);
      this.enqueue('build_start', { app: b.project.name, platform: PLATFORM[b.platform] || ` ${b.platformName || b.platform}` }, { priority: 2, keepMs: 5 * 60000 });
    }
    for (const f of a.recent || []) {
      if (this.seen.has('end:' + f.key)) continue;
      this.seen.add('end:' + f.key);
      if (!this.ready) continue;
      const ok = good(f.status);
      const failed = bad(f.status);
      this.feel(ok ? 6 : failed ? -8 : 0);
      if (ok) this.earn(1);
      if (this.away()) this.missed.push(`${f.project.name} 打包${ok ? '成功' : failed ? '失败' : '停了'}`);
      this.enqueue(ok ? 'build_ok' : failed ? 'build_fail' : 'build_stop', { app: f.project.name, took: took(f), status: f.status || '原因不明' }, { priority: 2, keepMs: 8 * 60000 });
    }
  }
  onAlerts(list) {
    const now = Date.now();
    this.alertsNow = list;
    for (const a of list) {
      if (a.recovered) {
        const key = `over:${a.kind}:${a.endedAt}`;
        if (this.seen.has(key)) continue;
        this.seen.add(key);
        if (this.ready && this.spoke[a.kind]) {
          this.spoke[a.kind] = false;
          this.enqueue('alert_over', { name: a.name, value: a.value, unit: a.unit, peak: a.peak }, { priority: 2, keepMs: 60000 });
        }
        continue;
      }
      if (!this.ready) { this.noticed[a.kind] = now; continue; }
      if (a.top == null && now - new Date(a.since).getTime() < 15000) continue;   // who is using it: still being looked up
      const fresh = now - (this.noticed[a.kind] || 0) >= 10 * 60000;
      this.noticed[a.kind] = now;
      if (!fresh || !LINES['alert_' + a.kind]) continue;
      const limit = { ram: this.limits.ramPct, vram: this.limits.vramPct, gpuTemp: this.limits.gpuTemp, cpuTemp: this.limits.cpuTemp }[a.kind];
      const words = (al) => {
        const peak = Math.max(al.value, al.peak || 0);
        const why = al.reason === 'jump' && al.from != null ? (al.value > al.from ? `${al.minutes} 分钟内从 ${al.from}${al.unit} 涨上来的` : null)
          : al.value >= limit ? `到了 ${limit}${al.unit} 的警戒线`
            : peak >= limit ? `刚才到过 ${peak}${al.unit}，过了 ${limit}${al.unit} 的警戒线` : null;
        const first = al.top && al.top[0];
        return why ? { value: al.value, why, who: first ? `占得最多的是${latin(first.label) ? ' ' : ''}${first.label}（${first.text}）。` : '' } : null;
      };
      if (!words(a)) continue;
      this.spoke[a.kind] = true;
      this.feel(-4);
      if (this.away()) this.missed.push(`${a.name}到过 ${Math.max(a.value, a.peak || 0)}${a.unit}`);
      const kind = a.kind;
      this.enqueue('alert_' + kind, () => { const al = (this.alertsNow || []).find((x) => x.kind === kind && !x.recovered); return al ? words(al) : null; }, { priority: 2, keepMs: 2 * 60000 });
    }
  }
  onQuota(q) {
    if (!q) return;
    this.quotaNow = q;
    if (!this.ready) return;
    const kindOf = (p) => (p.refused && p.refused.blocked ? 'quota_blocked' : p.remaining <= 0 ? 'quota_out' : p.limit && p.remaining / p.limit < 0.15 ? 'quota_low' : null);
    for (const p of q.platforms || []) {
      if (!p.ok || p.stale) continue;                     // old numbers are no news
      const kind = kindOf(p);
      const key = `${kind}:${p.id}:${p.resetAt || ''}`;
      if (!kind || this.s.told[key]) continue;
      this.s.told[key] = dayOf();
      this.enqueue(p.official || kind === 'quota_blocked' ? kind : `${kind}_est`, () => {
        const now = ((this.quotaNow || {}).platforms || []).find((x) => x.id === p.id && x.ok && !x.stale);
        if (!now || kindOf(now) !== kind) return null;
        const at = now.resetAt ? new Date(now.resetAt) : null;
        const reset = !at ? null : now.resetPrecision === 'exact' ? `${at.getMonth() + 1}月${at.getDate()}日` : `${at.getUTCMonth() + 1}月${at.getUTCDate()}日`;
        return { platform: now.name, left: leftOf(now), reset };
      }, { keepMs: 20 * 60000 });
    }
  }
}

module.exports = { Mind, dueToday };
