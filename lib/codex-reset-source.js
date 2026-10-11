const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
function subscriptionFromAuth(auth, account) {
  try {
    if (account?.type !== 'chatgpt' || !account.email) return null;
    const token = auth?.tokens?.id_token;
    if (typeof token !== 'string' || token.split('.').length !== 3) return null;
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    const claims = payload['https://api.openai.com/auth'];
    if (payload.iss !== 'https://auth.openai.com' || !claims ||
      payload.email?.toLowerCase() !== account.email.toLowerCase() ||
      !auth.tokens.account_id || auth.tokens.account_id !== claims.chatgpt_account_id ||
      claims.chatgpt_plan_type !== account.planType) return null;
    const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
    const dateAt = timestamp(claims.chatgpt_subscription_active_until);
    if (dateAt == null) return null;
    return {
      dateAt, dateKind: 'expiry',
      dateText: new Date(dateAt).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      source: 'Codex 官方登录订阅记录',
      recordUpdatedAt: timestamp(claims.chatgpt_subscription_last_checked),
    };
  } catch { return null; }
}

function readSubscription(account) {
  try {
    const home = process.env.CODEX_HOME || path.join(require('os').homedir(), '.codex');
    return subscriptionFromAuth(JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')), account);
  } catch { return null; }
}

function executable() {
  const root = path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
  const choices = [];
  try {
    for (const d of fs.readdirSync(root)) {
      const p = path.join(root, d, 'codex.exe');
      if (fs.existsSync(p)) choices.push({ p, at: fs.statSync(p).mtimeMs });
    }
  } catch { /* CLI on PATH is the fallback */ }
  return choices.sort((a, b) => b.at - a.at)[0]?.p || 'codex';
}

class CodexResetSource extends EventEmitter {
  constructor() { super(); this.pending = new Map(); this.seq = 0; this.child = null; this.ready = null; this.nextSubscriptionRefreshAt = 0; }
  connect() {
    if (this.ready) return this.ready;
    const child = this.child = spawn(executable(), ['app-server', '--listen', 'stdio://'], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    readline.createInterface({ input: child.stdout }).on('line', line => {
      let m; try { m = JSON.parse(line); } catch { return; }
      if (m.id != null && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(p.timer);
        if (m.error) p.reject(new Error(`Codex 接口读取失败（${m.error.code}），请检查账户登录`));
        else p.resolve(m.result);
      } else if (['account/rateLimits/updated', 'account/updated'].includes(m.method)) {
        this.emit('changed');
      }
    });
    const lost = () => {
      if (this.child !== child) return;
      this.child = null; this.ready = null;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Codex 连接中断，将自动重连')); }
      this.pending.clear(); this.emit('disconnected');
    };
    child.on('error', lost); child.on('exit', lost);
    this.ready = this.request('initialize', { clientInfo: { name: 'chixiao_reset_monitor', version: '1.0.0' }, capabilities: { experimentalApi: true } })
      .then(() => child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n'))
      .catch(e => { this.stop(); throw e; });
    return this.ready;
  }
  request(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.child || this.child.stdin.destroyed) return reject(new Error('Codex 尚未连接'));
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex 读取超时')); }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, ...(params ? { params } : {}) }) + '\n');
    });
  }
  async read() {
    await this.connect();
    const refreshToken = Date.now() >= this.nextSubscriptionRefreshAt;
    let account;
    try {
      account = await this.request('account/read', { refreshToken });
      if (refreshToken) this.nextSubscriptionRefreshAt = Date.now() + 6 * 3600000;
    } catch (error) {
      if (!refreshToken) throw error;
      this.nextSubscriptionRefreshAt = Date.now() + 5 * 60000;
      account = await this.request('account/read', { refreshToken: false });
    }
    if (!account?.account || account.account.type !== 'chatgpt') throw new Error('请先在 Codex 登录 ChatGPT 账户');
    const data = await this.request('account/rateLimits/read');
    const identity = require('crypto').createHash('sha256').update(JSON.stringify(account.account)).digest('hex');
    return { identity, data, planType: account.account.planType || null, subscription: readSubscription(account.account) };
  }
  async messages() { await this.connect(); return this.request('account/workspaceMessages/read'); }
  stop() {
    const child = this.child; this.child = null; this.ready = null;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Codex 读取已停止')); }
    this.pending.clear();
    child?.stdin.end(); child?.kill();
  }
}
module.exports = { CodexResetSource, subscriptionFromAuth };
