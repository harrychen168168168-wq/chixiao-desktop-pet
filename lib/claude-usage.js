function isUsageURL(value) {
  try {
    const u = new URL(value);
    return u.origin === 'https://claude.ai' && (/^\/settings\/usage\/?$/.test(u.pathname) || /^#\/?settings\/usage(?:[/?]|$)/.test(u.hash));
  } catch { return false; }
}
function isLoginURL(value) {
  try { const u = new URL(value); return u.hostname === 'accounts.google.com' || (u.origin === 'https://claude.ai' && /^\/(login|oauth|auth)(?:\/|$)/.test(u.pathname)); }
  catch { return false; }
}
function noResetOffer(text) {
  return /(?:no|0)\s+(?:free\s+)?resets?\s+(?:available|remaining)|没有可用.{0,5}重置|沒有可用.{0,5}重置|暂无重置|暫無重置|暫無重設/i.test(text || '');
}
function usageWindows(data) {
  const reset = value => { const t = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(t) ? Math.round(t / 60000) * 60000 : null; };
  if (Array.isArray(data?.limits)) {
    return data.limits.filter(w => ['session', 'weekly_all', 'weekly_scoped'].includes(w.kind) && typeof w.percent === 'number' && Number.isFinite(w.percent)).map(w => {
      const model = w.scope?.model?.display_name || w.scope?.model?.id;
      const suffix = model || w.scope?.surface || '其他模型';
      return { id: w.kind === 'session' ? 'five_hour' : w.kind === 'weekly_all' ? 'seven_day' : `weekly_scoped:${suffix}`,
        label: w.kind === 'session' ? '5 小时' : w.kind === 'weekly_all' ? '每周' : `${suffix} 每周`,
        windowDurationMins: w.kind === 'session' ? 300 : 10080, usedPercent: w.percent, resetAt: reset(w.resets_at), precision: 'minute' };
    });
  }
  const labels = { five_hour: '5 小时', seven_day: '每周', seven_day_opus: 'Opus 每周', seven_day_sonnet: 'Sonnet 每周' };
  return Object.entries(data || {}).filter(([key, v]) => /^(five_hour|seven_day)/.test(key) && v && typeof v.utilization === 'number' && Number.isFinite(v.utilization))
    .map(([key, v]) => ({ id: key, label: labels[key] || key, windowDurationMins: key === 'five_hour' ? 300 : 10080, usedPercent: v.utilization, resetAt: reset(v.resets_at), precision: 'minute' }));
}
function usageDetails(text) {
  const planName = text.match(/\bMax\s*\(\s*\d+x\s*\)|\bMax\s+\d+x\b|\b(?:Pro|Team|Enterprise)\b/i)?.[0] || null;
  const cloud = text.match(/(?:云会话额度|Cloud session credits)([\s\S]*?)(?:\n用量额度|\nUsage credits|$)/i)?.[1] || '';
  const amount = cloud.match(/(?:剩余\s*US\$|US\$)([\d,.]+)\s*[（(](?:共\s*)?US\$([\d,.]+)[）)]/i) || cloud.match(/\$([\d,.]+)\s*(?:remaining)?\s*\(\$([\d,.]+)\s*total\)/i);
  const expiry = cloud.split('\n').map(s => s.trim()).find(s => /过期|過期|expir/i.test(s) && /\d{1,2}月\d{1,2}日|\d{4}-\d{2}-\d{2}|\b[A-Z][a-z]+ \d{1,2}\b/.test(s)) || null;
  return { planName, cloudCredits: amount ? { remaining: Number(amount[1].replace(/,/g, '')), total: Number(amount[2].replace(/,/g, '')), currency: 'USD', expiresText: expiry } : null };
}
function subscriptionDetails(text) {
  const lines = String(text || '').split('\n').map(s => s.trim());
  const line = lines.find(s => /订阅.*(?:续费|续订|到期|取消)|套餐.*(?:续费|到期|取消)|subscription.*(?:renew|expir|ends|cancel)|next billing/i.test(s));
  const dateText = line?.match(/\d{4}年\d{1,2}月\d{1,2}日|\b\d{4}-\d{2}-\d{2}\b|\b[A-Z][a-z]+ \d{1,2},? \d{4}\b/)?.[0] || null;
  return { dateText, dateKind: dateText ? /续费|续订|renew|next billing/i.test(line) ? 'renewal' : 'expiry' : null };
}
function pageDay(text) {
  const m = String(text || '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日|(\d{4})-(\d{2})-(\d{2})/);
  if (m) return [m[1] || m[4], m[2] || m[5], m[3] || m[6]].map(Number).join('-');
  const t = Date.parse(`${text} 12:00 UTC`);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10).split('-').map(Number).join('-') : null;
}
function preciseSubscription(page, details, timeZone) {
  if (!page?.dateText || !details) return page;
  const iso = page.dateKind === 'renewal' ? details.next_charge_at : details.plan_ending_at || details.next_charge_at;
  const at = typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(iso) ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return page;
  const zone = timeZone ? { timeZone } : {};
  const day = new Date(at).toLocaleDateString('en-CA', zone).split('-').map(Number).join('-');
  if (day !== pageDay(page.dateText)) return page;
  return { ...page, dateAt: at, dateText: new Date(at).toLocaleString('zh-CN', { ...zone, hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) };
}
function subscriptionNextCheck(value, now = Date.now()) {
  return Number.isFinite(value?.dateAt) && value.dateAt > now ? Math.min(now + 6 * 3600000, value.dateAt) : now + 300000;
}
module.exports = { isUsageURL, isLoginURL, noResetOffer, usageWindows, usageDetails, subscriptionDetails, preciseSubscription, subscriptionNextCheck };
