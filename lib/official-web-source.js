const { createHash } = require('crypto');
const fingerprint = text => createHash('sha256').update(text).digest('hex').slice(0, 24);
const SOURCES = [
  { id: 'codex-changelog', provider: 'codex', name: 'Codex / ChatGPT 官网更新日志', url: 'https://learn.chatgpt.com/docs/changelog', type: 'page' },
  { id: 'openai-news', provider: 'codex', name: 'OpenAI 官网新闻', url: 'https://openai.com/news/rss.xml', type: 'rss' },
  { id: 'openai-release', provider: 'codex', name: 'OpenAI 帮助中心更新公告', url: 'https://help.openai.com/en/articles/6825453-chatgpt-release-notes', type: 'page' },
  { id: 'codex-resets', provider: 'codex', name: 'Codex 官方重置说明', url: 'https://help.openai.com/en/articles/20001498', type: 'page' },
  { id: 'claude-release', provider: 'claude', name: 'Claude 官网更新日志', url: 'https://support.claude.com/en/articles/12138966-release-notes', type: 'page' },
  { id: 'claude-news', provider: 'claude', name: 'Claude 官网产品公告', url: 'https://claude.com/resources/product-announcements', type: 'cards' },
  { id: 'claude-resets', provider: 'claude', name: 'Claude 官方重置说明', url: 'https://support.claude.com/en/articles/17007452-what-is-a-limit-reset', type: 'page' },
];
const HOSTS = new Set(['learn.chatgpt.com', 'developers.openai.com', 'help.openai.com', 'openai.com', 'www.openai.com', 'support.claude.com', 'claude.com', 'www.claude.com', 'anthropic.com', 'www.anthropic.com']);
function officialURL(value, base) {
  try { const u = new URL(value, base); return u.protocol === 'https:' && !u.username && !u.password && HOSTS.has(u.hostname) ? u.href : null; } catch { return null; }
}
function decode(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|ndash|mdash);/gi, (all, key) => {
    if (key[0] === '#') { const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1)); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—' })[key.toLowerCase()];
  });
}
const clean = s => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const relevant = s => /\b(?:free|banked|full) reset\b|\breset credits?\b|赠送重置|系统重置|全局重置/i.test(s) || (/\b(?:reset\w*|replenish\w*|restor\w*|refresh\w*)\b|重置|重设|重設|恢复|恢復/i.test(s) && /\busage\b|\blimits?\b|\bquota\b|\ballowance\b|额度|額度|用量|限额|限額/i.test(s));
function dateIn(s) {
  const d = s.match(/\b20\d\d-\d\d-\d\d\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?) \d{1,2}, 20\d\d\b/i);
  return d && Number.isFinite(Date.parse(d[0])) ? Date.parse(d[0]) : null;
}
function pageEntries(html, url) {
  let body = html.replace(/<(script|style|nav|footer|header|pre|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const main = body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (!main) throw new Error('官网正文结构变化，尚未确认公告内容');
  body = main[1];
  const articles = [...body.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)];
  if (articles.length === 1) body = articles[0][1];
  const lines = body.replace(/<\/(?:p|li|h[1-6]|blockquote|time|div)>|<br\s*\/?>/gi, '\n').split('\n').map(clean).filter(Boolean);
  if (lines.join(' ').length < 80) throw new Error('官网正文未完整载入');
  let date = null;
  return lines.map(text => { if (text.length < 120 && dateIn(text)) date = dateIn(text); return { text, url, publishedAt: date }; }).filter(e => relevant(e.text));
}
function listing(html, source) {
  if (source.type === 'rss') {
    const items = [...html.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
    if (!items.length) throw new Error('官网新闻订阅格式变化');
    return items.map(([, item]) => {
      const tag = name => item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '';
      return { url: officialURL(decode(tag('link')).trim(), source.url), text: clean(decode(tag('title') + ' ' + tag('description'))), publishedAt: Date.parse(tag('pubDate')) || null };
    }).filter(e => e.url);
  }
  const cards = [...html.matchAll(/<a\b([^>]*class="[^"]*ResourceCard[^>]*)>([\s\S]*?)<\/a>/gi)];
  if (!cards.length) throw new Error('官网产品公告列表结构变化');
  return cards.map(([, attrs, body]) => ({ url: officialURL(decode(attrs.match(/href="([^"]+)"/)?.[1] || ''), source.url), text: clean(body), publishedAt: dateIn(clean(body)) })).filter(e => e.url);
}
async function getPage(url, fetcher, headers = {}) {
  for (let redirects = 0; redirects < 6; redirects++) {
    if (!officialURL(url)) throw new Error('公告链接不在官方域名范围内');
    const res = await fetcher(url, { redirect: 'manual', headers: { 'Cache-Control': 'no-cache', ...headers }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if ([301, 302, 303, 307, 308].includes(res.status)) { const next = officialURL(res.headers.get('location'), url); await res.body?.cancel(); if (!next) throw new Error('官网跳转到未验证域名'); url = next; continue; }
    if (res.status === 304) return { unchanged: true, url };
    if (!res.ok) {
      await res.body?.cancel(); const error = new Error(`官网读取失败（HTTP ${res.status}）${res.status === 403 ? '，网站拒绝后台访问' : ''}`);
      const retry = res.headers.get('retry-after'); error.retryAfterMs = /^\d+$/.test(retry || '') ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 0;
      if (res.status === 403) error.retryAfterMs = Math.max(300000, error.retryAfterMs);
      throw error;
    }
    const reader = res.body.getReader(); const chunks = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 3 * 1024 * 1024) { await reader.cancel(); throw new Error('官网页面过大，暂未读取'); } chunks.push(Buffer.from(value)); }
    return { html: Buffer.concat(chunks).toString('utf8'), url, etag: res.headers.get('etag'), modified: res.headers.get('last-modified'), cacheAgeSeconds: Number(res.headers.get('age')) || 0 };
  }
  throw new Error('官网跳转次数过多');
}
async function readOfficialPage(source, previous, { fetcher = fetch, now = Date.now() } = {}) {
  const old = previous || {}, initial = !old.baselineAt;
  const headers = {};
  if (!old.pendingArticles) { if (old.etag) headers['If-None-Match'] = old.etag; if (old.modified) headers['If-Modified-Since'] = old.modified; }
  const page = await getPage(source.url, fetcher, headers);
  if (page.unchanged) return { saved: old, notices: [], status: { baselineAt: old.baselineAt, lastChangeAt: old.lastChangeAt, cacheAgeSeconds: old.cacheAgeSeconds, matches: old.matches, url: source.url } };
  const known = new Set(old.seen || []), links = new Set(old.links || []), seen = new Set(known);
  const articleRetries = { ...(old.articleRetries || {}) };
  let entries = [], pendingArticles = false, warning = '';
  if (source.type === 'page') entries = pageEntries(page.html, page.url);
  else {
    const items = listing(page.html, source);
    entries = items.filter(e => relevant(e.text));
    const candidates = items.filter(e => !links.has(e.url) && (!initial || (e.publishedAt && now - e.publishedAt < 86400000 && e.publishedAt <= now)));
    if (initial) for (const item of items) if (!candidates.includes(item)) links.add(item.url);
    const batch = candidates.filter(item => !articleRetries[item.url] || now >= articleRetries[item.url].nextAt).slice(0, 4);
    const results = await Promise.allSettled(batch.map(async item => ({ item, entries: pageEntries((await getPage(item.url, fetcher)).html, item.url) })));
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') { links.add(r.value.item.url); delete articleRetries[r.value.item.url]; entries.push(...r.value.entries.map(e => ({ ...e, publishedAt: e.publishedAt || r.value.item.publishedAt }))); }
      else { pendingArticles = true; articleRetries[batch[i].url] = { nextAt: now + Math.max(300000, r.reason.retryAfterMs || 0), error: r.reason.message }; }
    }
    pendingArticles ||= candidates.length > batch.length;
    if (Object.keys(articleRetries).length) warning = `公告列表可读，但部分新文章正文暂不可读：${Object.values(articleRetries)[0].error}`;
  }
  const notices = [];
  for (const entry of entries) {
    const key = fingerprint(entry.text);
    if (seen.has(key)) continue;
    seen.add(key);
    if (initial && (!entry.publishedAt || entry.publishedAt > now || now - entry.publishedAt >= 86400000)) continue;
    notices.push({ ...entry, key, initial });
  }
  const saved = { baselineAt: old.baselineAt || now, lastChangeAt: notices.length ? now : old.lastChangeAt || null, seen: [...seen].slice(-2500), links: [...links].slice(-2500), etag: page.etag, modified: page.modified, cacheAgeSeconds: page.cacheAgeSeconds, matches: entries.length, pendingArticles, articleRetries };
  return { saved, notices, status: { baselineAt: saved.baselineAt, lastChangeAt: saved.lastChangeAt, cacheAgeSeconds: saved.cacheAgeSeconds, matches: saved.matches, url: source.url, warning, pendingArticles } };
}
module.exports = { SOURCES, HOSTS, officialURL, relevant, pageEntries, listing, getPage, readOfficialPage };
