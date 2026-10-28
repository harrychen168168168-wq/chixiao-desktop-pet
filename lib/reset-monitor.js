const { EventEmitter } = require('events');
const { createHash } = require('crypto');
const { readJson, writeJson } = require('./util');
const { CodexResetSource } = require('./codex-reset-source');
const { SOURCES: WEB_SOURCES, readOfficialPage } = require('./official-web-source');
const hash = value => createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
const num = v => typeof v === 'number' && Number.isFinite(v);
const fiveHour = w => w.windowDurationMins === 300 || w.id === 'five_hour' || /5\s*小时|300\s*分钟/.test(w.label || '');
const stamp = v => num(v) ? v * 1000 : typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
const {relevant,brief,normalize,statusScope}=require('./reset-announcement');
const upcomingReset = require('./reset-upcoming');

function codexSnapshot({ identity, data, planType, subscription }) {
  const windows = [];
  const buckets = data.rateLimitsByLimitId || (data.rateLimits ? { [data.rateLimits.limitId || 'codex']: data.rateLimits } : {});
  for (const [id, b] of Object.entries(buckets)) for (const key of ['primary', 'secondary']) {
    const w = b?.[key];
    if (!w || !num(w.usedPercent)) continue;
    windows.push({ id: `${id}:${key}`, label: `${b.limitName || id} · ${w.windowDurationMins === 10080 ? '每周' : w.windowDurationMins === 300 ? '5 小时' : w.windowDurationMins % 1440 === 0 ? `${w.windowDurationMins / 1440} 天` : `${w.windowDurationMins ?? '?'} 分钟`}`,
      usedPercent: w.usedPercent, windowDurationMins: w.windowDurationMins, resetAt: stamp(w.resetsAt), precision: 'exact' });
  }
  const r = data.rateLimitResetCredits;
  const planNames = { free: 'Free', go: 'Go', plus: 'Plus', pro: 'Pro', prolite: 'Pro', promax: 'Pro', team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu' };
  return { identity, windows, planName: planNames[planType] || (planType ? '官方套餐名称待确认' : null), subscription: subscription || { dateText: null, dateKind: null }, creditCount: num(r?.availableCount) ? r.availableCount : null,
    credits: Array.isArray(r?.credits) ? r.credits.filter(c => c.status === 'available').map(c => ({ id: c.id, title: c.title || '官方重置次数', expiresAt: stamp(c.expiresAt) })) : null,
    source: 'Codex 官方账户接口', url: 'https://chatgpt.com/codex/settings/usage' };
}

class ResetMonitor extends EventEmitter {
  constructor({ config = {}, load = () => readJson('ai-resets.json', {}), save = s => writeJson('ai-resets.json', s), now = Date.now, codex = new CodexResetSource(), claude = null, fetcher = fetch } = {}) {
    super(); this.config = { pollMs: 15000, officialPollMs: 15000, officialWebPollMs: 15000, upcomingMinutes: 60, includeFiveHour: false, ...config };
    this.now = now; this.save = save; this.codex = codex; this.claude = claude; this.fetcher = fetcher;
    const saved = load() || {};
    this.state = { accounts: saved.accounts || {}, notices: saved.notices || [], seen: saved.seen || [], webPages: saved.webPages || {}, ignoredNotices:saved.ignoredNotices || [], sources: {} };
    const retained=[];
    for (const n of this.state.notices) {
      const scope=statusScope(n);
      if (scope && !relevant(n.text)) { this.state.ignoredNotices.push({...n,correction:'非额度重置，已纠正误报'}); continue; }
      const duplicate=scope && retained.find(x=>x.provider===n.provider && statusScope(x)===scope && normalize(x.text)===normalize(n.text));
      if (duplicate) {
        duplicate.acknowledgedAt=duplicate.acknowledgedAt && n.acknowledgedAt ? Math.max(duplicate.acknowledgedAt,n.acknowledgedAt) : null;
        continue;
      }
      retained.push(n);
    }
    this.state.notices=retained; this.state.ignoredNotices=this.state.ignoredNotices.slice(-100);
    const migrated = upcomingReset.migrate(this.state.notices, this.state.seen);
    const changed = JSON.stringify(migrated) !== JSON.stringify({ notices: this.state.notices, seen: this.state.seen });
    Object.assign(this.state, migrated);
    for (const s of WEB_SOURCES) this.state.sources[`official:web:${s.id}`] = { name: s.name, url: s.url, ok: false, error: '正在首次读取官网…' };
    if (!this.config.includeFiveHour) {
      for (const c of Object.values(this.state.accounts)) c.windows = (c.windows || []).filter(w => !fiveHour(w));
      this.state.notices = this.state.notices.filter(n => !['upcoming', 'recovered', 'official-change'].includes(n.kind) || !/5\s*小时|300\s*分钟/.test(n.text || ''));
    }
    for (const [provider, account] of Object.entries(this.state.accounts)) {
      if (account.latestRecovery) continue;
      const last = this.state.notices.filter(n => n.provider === provider && n.kind === 'recovered' && n.id?.startsWith(`${provider}:${account.identity}:recovered:`)).sort((a, b) => b.receivedAt - a.receivedAt)[0];
      if (last) account.latestRecovery = last.observation || { detectedAt: last.receivedAt, previousObservedAt: null };
    }
    if (changed) this.persist();
    this.running = false; this.jobs = new Map(); this.timers = new Map(); this.failures = {};
    this.codex?.on('changed', () => this.trigger('codex', () => this.readCodex(), 0));
    this.codex?.on('disconnected', () => { if (this.running) this.failed('codex', new Error('连接中断，自动重连中')); });
    this.claude?.on('changed', () => this.trigger('claude', () => this.readClaude(), 500));
  }
  snapshot() {
    const rank = { official: 0, 'official-change': 1, credit: 1, recovered: 1, expiring: 2, upcoming: 3 };
    const notices = [...this.state.notices].sort((a, b) => (rank[a.kind] ?? 2) - (rank[b.kind] ?? 2) || b.receivedAt - a.receivedAt).map(n=>n.kind==='official'?{...n,brief:brief(n)}:n);
    const { webPages, ignoredNotices, ...visible } = this.state;
    return JSON.parse(JSON.stringify({ ...visible, notices, preferences:this.config.preferences, pollMs: this.config.pollMs, officialPollMs: this.config.officialPollMs, officialWebPollMs: this.config.officialWebPollMs, at: this.now() }));
  }
  persist() { this.save(this.state); }
  publish() { this.emit('update', this.snapshot()); }
  add(key, notice) {
    if (this.state.seen.includes(key) || this.state.notices.some(n => n.id === key)) return false;
    this.state.seen.push(key); this.state.seen = this.state.seen.slice(-4000);
    const scope=statusScope({...notice,id:key});
    if (scope && this.state.notices.some(n=>n.provider===notice.provider && statusScope(n)===scope && normalize(n.text)===normalize(notice.text))) {this.persist();return false;}
    this.state.notices.unshift({ ...notice, id: key, receivedAt: this.now(), acknowledgedAt: null });
    const acknowledged = this.state.notices.filter(n => n.acknowledgedAt).slice(0, 100);
    this.state.notices = [...this.state.notices.filter(n => !n.acknowledgedAt), ...acknowledged];
    this.persist(); this.publish(); this.emit('notice', this.state.notices[0]); return true;
  }
  acknowledge(ids) {
    const wanted = new Set(Array.isArray(ids) ? ids : []);
    for (const n of this.state.notices) if (wanted.has(n.id) || n.mergedIds?.some(id => wanted.has(id))) n.acknowledgedAt = this.now();
    this.persist(); this.publish();
  }
  accept(provider, current) {
    current = { ...current, windows: (current.windows || []).filter(w => this.config.includeFiveHour || !fiveHour(w)) };
    const at = this.now(), prev = this.state.accounts[provider];
    const same = prev && prev.identity === current.identity;
    const prefix = `${provider}:${current.identity}`;
    const name = provider === 'codex' ? 'Codex' : 'Claude';
    const base = { provider, source: current.source, url: current.url };
    let latestRecovery = same ? prev.latestRecovery || null : null;
    if (same) for (const w of current.windows || []) {
      const p = prev.windows?.find(x => x.id === w.id);
      const observation = p ? { detectedAt: at, previousObservedAt: prev.at, windowId: w.id, label: w.label, previousUsedPercent: p.usedPercent, usedPercent: w.usedPercent, previousResetAt: p.resetAt, nextResetAt: w.resetAt } : null;
      if (p && p.usedPercent > 0 && w.usedPercent === 0) {
        latestRecovery = observation;
        this.add(`${prefix}:recovered:${w.id}:${p.resetAt || prev.at}`, { ...base, observation, kind: 'recovered', title: `${name} 额度已恢复`, text: `${w.label}：官方当前已用 0%。${p.resetAt && at < p.resetAt - 60000 ? '早于上次预告时间；原因未确认。' : ''}` });
      } else if (p && p.resetAt && w.resetAt > p.resetAt && at >= p.resetAt && w.usedPercent < p.usedPercent) {
        latestRecovery = observation;
        this.add(`${prefix}:recovered:${w.id}:${p.resetAt}`, { ...base, observation, kind: 'recovered', title: `${name} 已进入新额度周期`, text: `${w.label}：官方返回新周期，目前已用 ${w.usedPercent}%。` });
      } else if (p && p.resetAt && w.resetAt && w.resetAt !== p.resetAt && at < p.resetAt && w.usedPercent < p.usedPercent) {
        this.add(`${prefix}:changed:${w.id}:${w.resetAt}`, { ...base, observation, kind: 'official-change', title: `${name} 检测到额度提前变化`, text: `${w.label}：已用从 ${p.usedPercent}% 变为 ${w.usedPercent}%，自动重置时间也已变化。可能有系统重置或额度调整，请先核对使用情况，再决定是否使用赠送次数。具体原因尚未确认。` });
      }
    }
    const available = current.creditCount > 0;
    const priorCreditIds = same ? (prev.knownCreditIds || []) : [];
    const previousCount = same ? (num(prev.creditCount) ? prev.creditCount : prev.lastCreditCount) : null;
    const newCredits = (current.credits || []).filter(c => !priorCreditIds.includes(c.id));
    if (available && (!same || !prev.creditObserved || (num(previousCount) && current.creditCount > previousCount) || (priorCreditIds.length && newCredits.length))) {
      const near = (current.windows || []).filter(w => w.usedPercent > 0 && w.resetAt > at && w.resetAt - at <= this.config.upcomingMinutes * 60000);
      this.add(`${prefix}:credits:${newCredits.length ? newCredits.map(c => c.id).sort().join(',') : `${current.creditCount}:${same ? prev.creditRevision || 0 : 0}`}`,
        { ...base, kind: 'credit', title: `${name} 有 ${current.creditCount} 次官方重置可用`, text: `使用前请先看下面的自动恢复时间和赠送到期时间。${near.length ? '注意：部分额度将在 1 小时内自动恢复，可能无需消耗赠送次数。' : ''}` });
    }
    this.state.accounts[provider] = { ...current, at, latestRecovery, knownCreditIds: [...new Set([...priorCreditIds, ...(current.credits || []).map(c => c.id)])],
      lastCreditCount: num(current.creditCount) ? current.creditCount : previousCount,
      creditObserved: available || (same && prev.creditObserved) || false,
      creditRevision: (same ? prev.creditRevision || 0 : 0) + (same && num(current.creditCount) && current.creditCount !== prev.creditCount ? 1 : 0) };
    this.state.sources[provider] = { ok: true, at, lastAttemptAt: at, nextAt: at + this.config.pollMs };
    this.reminders(provider); this.persist(); this.publish();
  }
  reminders(provider) {
    const c = this.state.accounts[provider]; if (!c) return;
    const at = this.now(), name = provider === 'codex' ? 'Codex' : 'Claude';
    const base = { provider, source: c.source, url: c.url };
    const groups = new Map();
    for (const w of c.windows || []) {
      const left = w.resetAt - at;
      if (w.usedPercent > 0 && left > 0 && left <= this.config.upcomingMinutes * 60000) {
        if (!groups.has(w.resetAt)) groups.set(w.resetAt, []);
        groups.get(w.resetAt).push({ id: w.id, label: w.label });
      }
    }
    for (const [resetAt, windows] of groups) {
      const key = upcomingReset.keyOf(provider, c.identity, resetAt);
      const upcoming = { identity: c.identity, resetAt, windows };
      const existing = this.state.notices.find(n => n.id === key);
      if (existing) {
        existing.upcoming = upcomingReset.combine(existing.upcoming, upcoming);
        existing.text = upcomingReset.text(existing.upcoming, existing.receivedAt);
      } else {
        this.add(key, { ...base, upcoming, kind: 'upcoming', title: `${name} 即将自动恢复，先别浪费重置`, text: upcomingReset.text(upcoming, at) });
      }
    }
    for (const credit of c.credits || []) {
      const left = credit.expiresAt - at;
      if (left > 0 && left <= 86400000) this.add(`${provider}:${c.identity}:expiry:${credit.id}:${left <= 3600000 ? '1h' : '24h'}`, { ...base, kind: 'expiring', title: `${name} 赠送重置即将过期`, text: `${credit.title}：约 ${Math.ceil(left / 3600000)} 小时内到期，请对照自动恢复时间决定是否使用。` });
    }
  }
  failed(source, error) {
    const old = this.state.sources[source] || {};
    const failures = this.failures[source] = (this.failures[source] || 0) + 1;
    const wait = Math.max(error.retryAfterMs || 0, Math.min(300000, this.config.pollMs * 2 ** Math.min(4, failures - 1)));
    this.state.sources[source] = { ...old, ok: false, error: String(error.message || '读取失败').slice(0, 200), lastAttemptAt: this.now(), nextAt: this.now() + wait };
    this.publish(); return wait;
  }
  trigger(key, fn, delay = this.config.pollMs) {
    if (!this.running || !this.enabled(key)) return;
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => this.run(key, fn, this.interval(key)), delay));
  }
  interval(key) { return key.startsWith('official:web:') ? this.config.officialWebPollMs : key.startsWith('official:') ? this.config.officialPollMs : this.config.pollMs; }
  enabled(key) { return !this.config.sourceEnabled || this.config.sourceEnabled(key); }
  run(key, fn, interval) {
    if (!this.enabled(key)) return Promise.resolve();
    if (this.jobs.has(key)) return this.jobs.get(key);
    const job = (async () => {
      let delay = interval;
      try { await fn(); this.failures[key] = 0; }
      catch (e) { if (this.running) delay = this.failed(key, e); }
      finally { this.jobs.delete(key); this.trigger(key, fn, delay); }
    })();
    this.jobs.set(key, job); return job;
  }
  async readCodex() { const r = await this.codex.read(); if (this.running) this.accept('codex', codexSnapshot(r)); }
  async readClaude() {
    if (!this.claude) throw new Error('尚未连接 Claude：请点“连接 Claude 官方用量页”');
    const r = await this.claude.read(); if (this.running) this.accept('claude', r);
  }
  async readMessages() {
    const data = await this.codex.messages(); if (!this.running) return;
    const now = this.now();
    for (const m of data.messages || []) if (!m.archivedAt && relevant(m.messageBody || '')) {
      this.add(`codex:official:${m.messageId}`, { provider: 'codex', kind: 'official', title: 'Codex 官方重置相关通知', text: String(m.messageBody).slice(0, 2400), source: 'Codex 官方账户通知', url: 'https://chatgpt.com/codex/settings/usage' });
    }
    this.state.sources['official:codex-messages'] = { ok: true, available: data.featureEnabled !== false, at: now, nextAt: now + this.config.officialPollMs }; this.publish();
  }
  async readWeb(source) {
    const result = await readOfficialPage(source, this.state.webPages[source.id], { fetcher: this.fetcher, now: this.now() });
    if (!this.running) return;
    for (const n of result.notices) this.add(`official:web:${source.provider}:${n.key}`, {
      provider: source.provider, kind: 'official', title: `${source.provider === 'codex' ? 'OpenAI / Codex' : 'Claude'} 官网${n.initial ? '近期' : '新增'}重置相关内容`,
      text: `${n.text.slice(0, 2200)}\n\n请核对官方原文中的适用账户和执行时间；页面提及重置不代表你的额度已恢复。`, source: source.name, url: n.url, publishedAt: n.publishedAt, contentUpdatedAt: n.contentUpdatedAt,
    });
    this.state.webPages[source.id] = result.saved;
    this.state.sources[`official:web:${source.id}`] = { ...result.status, name: source.name, ok: true, at: this.now(), nextAt: this.now() + this.config.officialWebPollMs };
    this.persist(); this.publish();
  }
  async readStatus(provider) {
    const domain = provider === 'codex' ? 'status.openai.com' : 'status.claude.com';
    const res = await this.fetcher(`https://${domain}/api/v2/incidents.json`, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
    if (!res.ok) throw new Error(`官方公告读取失败（HTTP ${res.status}）`);
    const data = await res.json();
    if (!Array.isArray(data.incidents)) throw new Error('官方公告格式变化，暂不能读取');
    if (!this.running) return;
    for (const i of data.incidents) for (const u of i.incident_updates || []) {
      const published = stamp(u.created_at);
      if (!published || this.now() - published > 86400000 || published > this.now() + 60000 || !relevant(`${i.name}\n${u.body}`)) continue;
      this.add(`official:${provider}:${i.id}:${u.id}`, { provider, kind: 'official', incidentId:i.id, title: `${provider === 'codex' ? 'OpenAI' : 'Claude'} 官方重置相关公告`, text: `${i.name}\n${u.body}`.slice(0, 2400), source: domain, url: `https://${domain}`, publishedAt: published });
    }
    this.state.sources[`official:${provider}-status`] = { ok: true, at: this.now(), nextAt: this.now() + this.config.officialPollMs }; this.publish();
  }
  start() {
    if (this.running) return; this.running = true;
    this.refresh();
    this.clock = setInterval(() => {
      for (const p of ['codex', 'claude']) if (this.state.sources[p]?.ok && this.now() - this.state.sources[p].at < 90000) this.reminders(p);
      this.publish();
    }, 10000);
  }
  refresh() {
    this.claude?.invalidateBilling?.();
    const jobs = [['codex', () => this.readCodex()], ['claude', () => this.readClaude()], ['official:codex-messages', () => this.readMessages()],
      ['official:codex-status', () => this.readStatus('codex')], ['official:claude-status', () => this.readStatus('claude')],
      ...WEB_SOURCES.map(source => [`official:web:${source.id}`, () => this.readWeb(source)])];
    return Promise.allSettled(jobs.map(([key, fn]) => { clearTimeout(this.timers.get(key)); return this.run(key, fn, this.interval(key)); }));
  }
  stop() { this.running = false; clearInterval(this.clock); for (const t of this.timers.values()) clearTimeout(t); this.codex?.stop(); this.claude?.stop(); this.social?.stop(); }
}
module.exports = { ResetMonitor, codexSnapshot, relevant, hash, stamp };
