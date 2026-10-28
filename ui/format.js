(function () {
  const PLATFORM = {
    xcode: { name: 'Xcode Cloud', color: 'var(--c-xcode)' },
    codemagic: { name: 'Codemagic', color: 'var(--c-codemagic)' },
    github: { name: 'GitHub', color: 'var(--c-github)' },
    local: { name: '本机', color: 'var(--c-local)' },
  };
  const STATUS = {
    success: '成功', succeeded: '成功', failure: '失败', failed: '失败', errored: '出错', cancelled: '已取消',
    canceled: '已取消', skipped: '跳过', timeout: '超时', timed_out: '超时', in_progress: '进行中', queued: '排队中',
    'not-started': '没开跑（额度不足被拒）', action_required: '等待处理', unknown: '已结束', warning: '有警告',
  };
  const GOOD = new Set(['success', 'succeeded']);
  const BAD = new Set(['failure', 'failed', 'errored', 'timeout', 'timed_out']);
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function dur(min) {
    if (!min || min < 0.5) return min > 0 ? '不到 1 分' : '0 分';
    const m = Math.round(min);
    if (m < 60) return `${m} 分`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h} 小时 ${r} 分` : `${h} 小时`;
  }
  function int(n) { return Math.round(n).toLocaleString('en-US'); }
  function clock(ms) {
    if (!Number.isFinite(ms)) return '时间未知';
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }
  function day(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const w = new Date(y, m - 1, d).getDay();
    return `${m}月${d}日 ${WEEK[w]}`;
  }
  function hm(iso) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function md(iso) { const d = new Date(iso); return `${d.getMonth() + 1}月${d.getDate()}日`; }
  function until(at) {
    const ms = Math.max(0, at - Date.now());
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    if (d > 0) return h ? `还有 ${d} 天 ${h} 小时` : `还有 ${d} 天`;
    return h > 0 ? `还有 ${h} 小时` : '马上';
  }
  function reset(card) {
    const at = new Date(card.resetAt);
    const left = until(at);
    if (card.resetPrecision === 'exact') {
      const utc = card.id === 'github' ? `，= ${at.getUTCMonth() + 1}月${at.getUTCDate()}日 00:00 UTC` : '';
      return `${md(at)} ${hm(at)} 重置（${left}${utc}）`;
    }
    return `${at.getUTCMonth() + 1}月${at.getUTCDate()}日 重置（${left}）`;
  }
  const status = (s) => STATUS[s] || s || '';
  const tone = (s) => (GOOD.has(s) ? 'good' : BAD.has(s) ? 'bad' : s === 'not-started' ? 'warn' : 'neutral');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  window.fmt = { PLATFORM, dur, int, clock, day, hm, md, reset, status, tone, esc };
})();
