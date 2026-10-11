const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SOURCES, pageEntries, getPage, readOfficialPage } = require('../lib/official-web-source');
const { ResetMonitor } = require('../lib/reset-monitor');
const now = Date.UTC(2026, 9, 11, 15);
const source = SOURCES.find(s => s.id === 'claude-release');
const page = text => `<main><article><h1>Official product announcements</h1><p>This page contains updates from the official product team for our customers and subscribers.</p>${text}</article></main>`;
const response = body => new Response(body, { headers: { 'content-type': 'text/html' } });
test('initial history is silent, new relevant content alerts once across restart and layout changes', async () => {
  let html = page('<p>Your weekly usage limits reset on their usual day.</p>');
  const options = { now, fetcher: async () => response(html) };
  const first = await readOfficialPage(source, null, options);
  assert.equal(first.notices.length, 0); assert.equal(first.saved.matches, 1);
  html = page('<p>Your weekly usage limits reset on their usual day.</p><p>We will reset all Claude usage limits at 10 PM today.</p>');
  const next = await readOfficialPage(source, JSON.parse(JSON.stringify(first.saved)), options);
  assert.equal(next.notices.length, 1); assert(next.notices[0].text.includes('10 PM'));
  html = html.replace('all Claude', 'all <b>Claude</b>');
  const repeat = await readOfficialPage(source, JSON.parse(JSON.stringify(next.saved)), options);
  assert.equal(repeat.notices.length, 0);
});
test('initial recent dated reset announcement is not suppressed as an old FAQ', async () => {
  const html = page('<h3>October 11, 2026</h3><p>We reset usage limits for eligible users today.</p>');
  const r = await readOfficialPage(source, null, { now, fetcher: async () => response(html) });
  assert.equal(r.notices.length, 1); assert(r.notices[0].initial);
});
test('scripts, menus, and unrelated git reset are excluded', () => {
  const html = page('<p>Run git reset in your Codex project.</p><script>const s="We reset usage limits";</script>') + '<footer>usage limits reset</footer>';
  assert.equal(pageEntries(html, source.url).length, 0);
  assert.throws(() => pageEntries('<h1>Just a moment</h1>', source.url), /正文/);
});
test('all entries in a multi-article changelog are monitored', () => {
  const html = '<main><time>2026-10-11</time><article><p>New feature improvements are now available for the app.</p></article><time>2026-10-11</time><article><p>We are resetting all Codex usage limits as part of this launch.</p></article></main>';
  const r = pageEntries(html, source.url); assert.equal(r.length, 1); assert.equal(r[0].publishedAt, Date.UTC(2026, 9, 11));
});
test('403, Retry-After and off-domain redirects are explicit failures', async () => {
  await assert.rejects(getPage(source.url, async () => new Response('', { status: 403 })), e => e.retryAfterMs === 300000);
  await assert.rejects(getPage(source.url, async () => new Response('', { status: 429, headers: { 'retry-after': '600' } })), e => e.retryAfterMs === 600000);
  await assert.rejects(getPage(source.url, async () => new Response('', { status: 302, headers: { location: 'https://untrusted.example/news' } })), /未验证域名/);
});
test('conditional requests retain the last baseline and never invent a new event', async () => {
  const saved = { baselineAt: now, seen: ['old'], etag: 'one', matches: 1 };
  const r = await readOfficialPage(source, saved, { now, fetcher: async (_url, options) => { assert.equal(options.headers['If-None-Match'], 'one'); return new Response(null, { status: 304 }); } });
  assert.equal(r.saved, saved); assert.deepEqual(r.notices, []);
});
test('new RSS articles are checked beyond a title that does not mention resets', async () => {
  const rssSource = SOURCES.find(s => s.type === 'rss');
  const item = '<item><title>Product improvements</title><link>https://openai.com/index/test</link><description>News today</description><pubDate>Sun, 11 Oct 2026 14:00:00 GMT</pubDate></item>';
  const r = await readOfficialPage(rssSource, { baselineAt: now - 60000, seen: [], links: [] }, { now, fetcher: async url => response(url === rssSource.url ? `<rss><channel>${item}</channel></rss>` : page('<p>We will reset all Codex usage limits tonight.</p>')) });
  assert.equal(r.notices.length, 1); assert.equal(r.notices[0].url, 'https://openai.com/index/test');
});
test('failed article reads remain pending and retry even with a cached index', async () => {
  const rssSource = SOURCES.find(s => s.type === 'rss');
  const rss = '<rss><item><title>News</title><link>https://openai.com/index/test</link></item></rss>';
  const prev = { baselineAt: now - 60000, seen: [], links: [] };
  const first = await readOfficialPage(rssSource, prev, { now, fetcher: async url => url === rssSource.url ? response(rss) : new Response('', { status: 403 }) });
  assert(first.saved.pendingArticles); assert(!first.saved.links.includes('https://openai.com/index/test'));
  const second = await readOfficialPage(rssSource, { ...first.saved, etag: 'cached' }, { now: now + 300001, fetcher: async (url, options) => { assert(!options.headers['If-None-Match']); return response(url === rssSource.url ? rss : page('<p>We reset all Codex usage limits today.</p>')); } });
  assert.equal(second.notices.length, 1); assert(!second.saved.pendingArticles);
});
test('official website alert enters the existing persistent popup queue and remains pending', async () => {
  let html = page('<p>Product news.</p>'); let disk;
  const m = new ResetMonitor({ load: () => ({}), save: s => { disk = JSON.parse(JSON.stringify(s)); }, now: () => now, codex: null, fetcher: async () => response(html) });
  m.running = true; await m.readWeb(source);
  let alerts = 0; m.on('notice', () => alerts++);
  html = page('<p>We will reset Claude usage limits tonight at 10 PM.</p>');
  await m.readWeb(source); await m.readWeb(source);
  assert.equal(alerts, 1); assert.equal(m.snapshot().notices[0].kind, 'official'); assert.equal(m.snapshot().notices[0].acknowledgedAt, null);
  const restart = new ResetMonitor({ load: () => disk, save: () => {}, now: () => now, codex: null, fetcher: async () => response(html) });
  restart.running = true; await restart.readWeb(source); assert.equal(restart.state.notices.length, 1); assert.equal(restart.state.notices[0].acknowledgedAt, null);
});
