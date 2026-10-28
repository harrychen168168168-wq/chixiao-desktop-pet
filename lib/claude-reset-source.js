const { BrowserWindow, session } = require('electron');
const { EventEmitter } = require('events');
const { hash, stamp } = require('./reset-monitor');
const { isUsageURL, isLoginURL, noResetOffer, usageWindows, usageDetails, subscriptionDetails, preciseSubscription, subscriptionNextCheck } = require('./claude-usage');
const USAGE = 'https://claude.ai/settings/usage';
const delay = ms => new Promise(r => setTimeout(r, ms));
function pageSnapshot() {
  const candidates = [...document.querySelectorAll('[role="dialog"],main')];
  const usage = e => /当前会话|Current session|Weekly limits/i.test(e.innerText);
  const root = candidates.find(e => usage(e) && /限额重置|限額重置|resets/i.test(e.innerText)) || candidates.find(usage) || document.body;
  const text = root.innerText || '';
  const buttons = [...root.querySelectorAll('button')].filter(b => b.getClientRects().length && !b.disabled);
  const offer = buttons.find(b => /^(reset for free|免费重置|免費重設|免費重置)$/i.test(b.innerText.trim()));
  let offerText = '';
  if (offer) {
    let p = offer.parentElement;
    for (let i = 0; p && i < 4; i++, p = p.parentElement) {
      const t = p.innerText || '';
      if (t.length > 30 && t.length < 1600 && /expir|available|reset|到期|过期|過期|可用/i.test(t)) offerText = t;
    }
  }
  return { url: location.href, text: text.slice(0, 14000), offer: !!offer, offerText,
    times: [...root.querySelectorAll('time[datetime]')].map(t => ({ date: t.dateTime, text: t.parentElement.innerText })).slice(0, 15) };
}

class ClaudeResetSource extends EventEmitter {
  constructor() { super(); this.win = null; this.latest = null; this.responses = new Map(); this.loading = null; this.stopped = false; this.diagnostics = []; }
  create(background = false, slot = background ? 'reader' : 'win') {
    if (this[slot] && !this[slot].isDestroyed()) return this[slot];
    const ownSession=session.fromPartition('persist:claude-reset-monitor');
    ownSession.setPermissionRequestHandler((_web,_permission,callback)=>callback(false));
    ownSession.setPermissionCheckHandler(()=>false);
    this.stopped = false;
    const win = this[slot] = new BrowserWindow({ width: 1020, height: 800, show: false, title: '连接 Claude 官方用量页',
      webPreferences: { partition: 'persist:claude-reset-monitor', contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('close', e => { if (!this.stopped) { e.preventDefault(); win.hide(); } });
    win.on('hide', () => { if (!background && !this.stopped) this.emit('changed'); });
    win.webContents.on('did-navigate', () => { if (!background && !this.stopped) this.emit('changed'); });
    win.webContents.on('will-navigate', (e, url) => {
      try { const u = new URL(url); if (u.protocol !== 'https:' || !['claude.ai', 'accounts.google.com'].includes(u.hostname)) e.preventDefault(); }
      catch { e.preventDefault(); }
    });
    const dbg = win.webContents.debugger, billing = new Map();
    dbg.attach('1.3'); dbg.sendCommand('Network.enable').catch(() => {});
    dbg.on('message', async (_e, method, p) => {
      if (method === 'Network.responseReceived') {
        try {
          const url = new URL(p.response.url);
          if (url.origin === 'https://claude.ai' && /usage|reset|limit/.test(url.pathname)) {
            this.diagnostics.push({ at: Date.now(), path: url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id'), status: p.response.status });
            this.diagnostics = this.diagnostics.slice(-30);
          }
          if (url.origin === 'https://claude.ai' && /\/api\/organizations\/[^/]+\/usage(?:\?|$)/.test(url.pathname) && p.response.status === 200)
            this.responses.set(p.requestId, { identity: hash(url.pathname.split('/')[3]), at: Date.now() });
          if (url.origin === 'https://claude.ai' && /^\/api\/organizations\/[^/]+\/subscription_details$/.test(url.pathname) && p.response.status === 200)
            billing.set(p.requestId, { identity: hash(url.pathname.split('/')[3]) });
        } catch { /* unrelated response */ }
      } else if (method === 'Network.loadingFinished' && billing.has(p.requestId)) {
        const meta = billing.get(p.requestId); billing.delete(p.requestId);
        try {
          const body = await dbg.sendCommand('Network.getResponseBody', { requestId: p.requestId });
          const d = JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body);
          win.subscriptionLatest = { ...meta, at: Date.now(), plan_ending_at: d.plan_ending_at ?? null, next_charge_at: d.next_charge_at ?? null };
        } catch { /* page date is still shown */ }
      } else if (method === 'Network.loadingFinished' && this.responses.has(p.requestId)) {
        const meta = this.responses.get(p.requestId); this.responses.delete(p.requestId);
        try {
          const body = await dbg.sendCommand('Network.getResponseBody', { requestId: p.requestId });
          const data = JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body);
          this.usageSchema = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, Array.isArray(value) ? value.slice(0, 8) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([k]) => /model|name|label|utilization|reset|limit|window|scope|usage/i.test(k))) : typeof value]));
          const windows = usageWindows(data);
          if (windows.length) this.latest = win.usageLatest = { ...meta, windows };
        } catch { /* show explicit unavailable if no validated usage response */ }
      } else if (method === 'Network.loadingFailed') { this.responses.delete(p.requestId); billing.delete(p.requestId); }
    });
    return win;
  }
  async openLogin() {
    const win = this.create(); win.show(); win.focus();
    if (!win.webContents.getURL().startsWith('https://claude.ai/')) await win.loadURL(USAGE);
  }
  async read() {
    if (this.loading) return this.loading;
    this.loading = this.readOnce().finally(() => { this.loading = null; }); return this.loading;
  }
  invalidateBilling() { this.billingState = null; }
  async readSubscription(identity) {
    const old = this.billingState;
    if (old?.identity === identity && Date.now() < old.nextAt) return old.value;
    const win = this.create(true, 'billingReader');
    const timeout = setTimeout(() => { if (!win.isDestroyed()) win.webContents.stop(); }, 15000);
    try {
      const before = Date.now();
      await win.loadURL('https://claude.ai/settings/billing');
      let value = { dateText: null, dateKind: null };
      const details = () => { const d = win.subscriptionLatest; return d && d.at >= before && d.identity === identity ? d : null; };
      for (let i = 0; i < 8 && !this.stopped; i++) {
        const text = await win.webContents.executeJavaScript(`(() => { const root = [...document.querySelectorAll('[role="dialog"],main')].find(e => /Max 套餐|您的订阅|Your subscription|next billing/i.test(e.innerText)); return root?.innerText || ''; })()`);
        value = subscriptionDetails(text); if (value.dateText && details()) break; await delay(350);
      }
      value = preciseSubscription(value, details());
      this.billingState = { identity, nextAt: subscriptionNextCheck(value), value: { ...value, at: Date.now() } };
    } catch { this.billingState = { identity, nextAt: Date.now() + 300000, value: { dateText: null, dateKind: null } }; }
    finally { clearTimeout(timeout); }
    return this.billingState.value;
  }
  async readOnce() {
    const cookies = await session.fromPartition('persist:claude-reset-monitor').cookies.get({ url: 'https://claude.ai' });
    if (!cookies.some(c => c.name === 'sessionKey' && c.value)) throw new Error('请点“连接 Claude 官方用量页”，在官方窗口登录一次');
    const win = this.create(true), before = Date.now();
    const currentURL = win.webContents.getURL();
    if (win.isVisible() && isLoginURL(currentURL)) throw new Error('请先完成 Claude 官方登录');
    if (!win.isVisible() || !isUsageURL(currentURL)) {
      const timeout = setTimeout(() => { if (!win.isDestroyed()) win.webContents.stop(); }, 20000);
      try { await win.loadURL(USAGE); } finally { clearTimeout(timeout); }
    }
    let page;
    for (let i = 0; i < 12 && !this.stopped; i++) {
      if (win.isDestroyed()) throw new Error('Claude 页面已关闭');
      if (!isUsageURL(win.webContents.getURL())) {
        if (isLoginURL(win.webContents.getURL())) throw new Error('Claude 当前停在登录页，请完成官方登录');
        await delay(500); continue;
      }
      page = await win.webContents.executeJavaScript(`(${pageSnapshot.toString()})()`);
      if (win.usageLatest && win.usageLatest.at >= before && /current session|weekly limits|当前会话|目前工作階段|每周|每週/i.test(page.text) && (page.offer || noResetOffer(page.text) || i >= 10)) break;
      await delay(500);
    }
    if (this.stopped) throw new Error('Claude 读取已停止');
    const latest = win.usageLatest;
    if (!latest || latest.at < before) throw new Error('尚未读到 Claude 官方用量响应，将自动重试；这不代表登录失效');
    if (!page || !/current session|weekly limits|当前会话|目前工作階段|每周|每週/i.test(page.text)) throw new Error('Claude 用量页未加载完成或页面格式变化，未确认重置状态');
    const countMatch = page.offerText.match(/(\d+)\s+(?:resets?\s+(?:available|remaining))|(\d+)\s*次(?:可用|重置)/i);
    const count = page.offer ? (countMatch ? Number(countMatch[1] || countMatch[2]) : 1) : noResetOffer(page.text) ? 0 : null;
    const expiry = page.times.find(t => /expir|到期|过期|過期/i.test(t.text));
    const expiresAt = expiry ? stamp(expiry.date) : null;
    const subscription = await this.readSubscription(latest.identity);
    return { identity: latest.identity, windows: latest.windows, ...usageDetails(page.text), subscription, creditCount: count,
      creditCountIsMinimum: page.offer && !countMatch, credits: page.offer ? [{ id: `web-offer:${expiresAt || 'available'}`, title: '官方免费重置', expiresAt }] : null,
      offerText: page.offerText.slice(0, 1600), source: 'Claude 官方用量页及其官方用量响应', url: USAGE };
  }
  stop() { this.stopped = true; for (const win of [this.win, this.reader, this.billingReader]) if (win && !win.isDestroyed()) win.destroy(); }
}
module.exports = { ClaudeResetSource, usageWindows };
