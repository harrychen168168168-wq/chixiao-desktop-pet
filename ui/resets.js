(() => {
  const api = window.resetApi, $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const when = ms => ms ? new Date(ms).toLocaleString('zh-CN', { hour12:false }) : '未读到官方日期';
  const shortTime = ms => ms ? new Date(ms).toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }) : '时间未知';
  const resetTime = ms => ms ? ms <= Date.now() ? '待官方确认恢复' : new Date(ms).toLocaleString('zh-CN', { weekday:'short', hour:'2-digit', minute:'2-digit', hour12:false }).replace(/\s/g,'') + ' 重置' : '重置时间未知';
  const sourceNames = { codex:'Codex 账户', claude:'Claude 账户', 'official:codex-messages':'Codex 工作区通知', 'official:codex-status':'OpenAI 状态公告', 'official:claude-status':'Claude 状态公告' };
  const official = n => n.kind === 'official' || n.kind === 'official-change';
  let state = null, displayed = [], preferencesInitialized=false;
  function notice(n) { return `<div class="notice"><h3>${esc(n.title)}</h3><p>${esc(n.text)}</p><small>${esc(n.source)} · ${esc(shortTime(n.receivedAt))}</small>${n.url ? `<br><button data-url="${esc(n.url)}">官方原文</button>` : ''}</div>`; }
  function render(s) {
    if (!s) return; state = s;
    if(!preferencesInitialized){for(const key of ['official','codex','claude'])$('enable-'+key).checked=Boolean(s.preferences?.[key]);$('monitor-settings').open=!Object.values(s.preferences||{}).some(Boolean);preferencesInitialized=true;}
    const pending = s.notices.filter(n => !n.acknowledgedAt); displayed = pending.filter(n => ['claude','codex'].includes(n.provider)).map(n => n.id);
    $('accounts').innerHTML = ['claude','codex'].map(p => {
      const c = s.accounts[p], src = s.sources[p], stale = !src?.ok || !src.at || Date.now() - src.at > 90000;
      const alerts = pending.filter(n => n.provider === p);
      let html = `<article class="account" id="account-${p}"><div class="account-head"><h2>${p === 'claude' ? 'Claude' : 'Codex'}</h2>${alerts.length ? '<span class="pending-label">新提醒</span>' : ''}</div>`;
      if (stale) html += `<p class="error">${esc(src?.error || '正在读取…')}${c ? '（显示上次数据）' : ''}</p>`;
      html += `<div class="plan"><span>当前订阅套餐 · ${esc(c?.planName || (src?.disabled ? '未开启读取' : '读取中'))}</span></div>`;
      html += `<div class="subscription">${c?.subscription?.dateKind === 'renewal' ? '套餐自动续费日' : '套餐到期日'} · ${esc(c?.subscription?.dateText || '未读到官方日期')}</div>`;
      if (c?.subscription?.source) {
        const subscription = c.subscription;
        const recordDate = subscription.recordUpdatedAt ? new Date(subscription.recordUpdatedAt).toLocaleDateString('zh-CN', {  }) : '更新时间未提供';
        html += `<div class="expiry" title="${esc(subscription.source)}">官方订阅记录 · ${esc(recordDate)}${subscription.recordUpdatedAt ? ' 更新' : ''}${subscription.dateAt <= Date.now() ? ' · 已过记录日期，待官方更新' : ''}</div>`;
      }
      if (c) {
        for (const w of c.windows || []) {
          const value = typeof w.usedPercent === 'number' ? Math.max(0,Math.min(100,w.usedPercent)) : null;
          const label = p === 'claude' ? w.id === 'seven_day' ? '每周 · 所有模型' : w.label.replace(/(.+) 每周/,'每周 · $1') : w.label.replace(/^codex\s*·\s*/i,'当前额度 · ');
          html += `<div class="usage-row"><div class="usage-line"><span class="usage-label">${esc(label)}</span><span class="usage-meta">${esc(resetTime(w.resetAt))}<span class="percent">${p === 'codex' ? `剩余 ${value == null ? '未知' : 100-value+'%'}` : `${value == null ? '未知' : value+'%'}`}</span></span></div><progress max="100" value="${value == null ? 0 : p === 'codex' ? 100-value : value}" aria-label="${esc(label)}${p === 'codex' ? '剩余' : '已使用'} ${value == null ? '未知' : p === 'codex' ? 100-value : value}%"></progress></div>`;
        }
        if (p === 'claude' && c.cloudCredits) {
          const cloud = c.cloudCredits, money = n => new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n);
          html += `<div class="cloud"><div class="usage-line"><span>云会话额度</span><span class="usage-meta">剩余 US$${esc(money(cloud.remaining))}（共 US$${esc(money(cloud.total))}）</span></div><progress max="${cloud.total || 1}" value="${Math.max(0,cloud.total-cloud.remaining)}" aria-label="云会话额度已使用"></progress>${cloud.expiresText ? `<div class="expiry">${esc(cloud.expiresText)}</div>` : ''}</div>`;
        }
        html += `<div class="credit"><span>可用重置额度</span><span class="credit-value">${c.creditCount == null ? '尚未确认' : c.creditCount === 0 ? '暂无' : `${c.creditCountIsMinimum ? '至少 ' : ''}${c.creditCount} 次`}</span></div>`;
        for (const credit of c.credits || []) html += `<div class="credit-expiry">${esc(credit.title)} · ${credit.expiresAt ? esc(shortTime(credit.expiresAt)) + ' 到期' : '到期时间未提供'}</div>`;
      }
      const announcements = s.notices.filter(n => n.provider === p && official(n) && (!n.acknowledgedAt || Date.now()-n.receivedAt < 86400000));
      html += `<div class="system"><span class="system-empty">系统重置公告 · ${announcements.length ? '以下为已读到的官方内容' : '暂未读到官方公布的时间'}</span>${announcements.map(notice).join('')}${alerts.filter(n => n.kind !== 'credit' && !official(n)).map(notice).join('')}</div>`;
      if (p === 'claude' && !src?.ok && !src?.disabled) html += '<p><button id="connect-claude">连接 Claude</button></p>';
      return html + '</article>';
    }).join('');
    const websites = Object.entries(s.sources).filter(([key]) => key.startsWith('official:web:'));
    const active = websites.filter(([,src]) => src.ok && Date.now()-src.at < 90000).length;
    $('monitor-status').textContent = s.preferences?.official ? `官网监测 ${active}/${websites.length || 7} · 每 15 秒` : '官网监测未开启';
    $('sources').innerHTML = Object.entries(s.sources).filter(([key]) => key !== 'official:x').map(([key,src]) => `<p><b>${esc(src.name || sourceNames[key] || key)}</b> · ${src.ok ? src.available === false ? '接口已连接，官方返回通知功能未启用' : src.pendingArticles ? '部分正文待读取' : '已连接' : esc(src.error || '正在读取')}<br>最近成功：${esc(when(src.at))}${src.cacheAgeSeconds > 60 ? '<br>官网缓存可能延迟更新' : ''}${src.warning ? `<br>${esc(src.warning)}` : ''}</p>`).join('');
    $('history').innerHTML = s.notices.filter(n => n.acknowledgedAt).map(notice).join('') || '<p>暂无记录</p>';
  }
  const close = () => api.close(displayed.slice());
  $('save-monitors').onclick=async()=>{
    $('save-monitors').disabled=true;
    try{const next=await api.savePreferences(Object.fromEntries(['official','codex','claude'].map(key=>[key,$('enable-'+key).checked])));preferencesInitialized=false;render(next);$('feedback').textContent='选择已保存';}
    catch{$('feedback').textContent='保存失败，请稍后重试';}
    finally{$('save-monitors').disabled=false;}
  };
  $('close').onclick = close; api.onClose(close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  $('refresh').onclick = async () => {
    $('refresh').disabled = true; $('feedback').textContent = '正在刷新…';
    try { render(await api.refresh()); $('feedback').textContent = '已刷新'; }
    catch { $('feedback').textContent = '读取失败，请稍后重试'; }
    finally { $('refresh').disabled = false; }
  };
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-url]'); if (b) api.open(b.dataset.url);
    if (e.target.id === 'connect-claude') { const r = await api.connectClaude(); $('feedback').textContent = r?.ok ? '在官方窗口完成登录即可' : r?.error; }
  });
  api.onState(render); api.initial().then(render);
  setInterval(() => { if (state) render(state); }, 10000);
})();
