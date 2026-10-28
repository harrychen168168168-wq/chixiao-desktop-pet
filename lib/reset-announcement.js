const normalize = text => String(text || '').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
const ACTION = '(?:reset(?:s|ting)?|replenish\\w*|restor\\w*|refresh\\w*)';
const QUOTA = '(?:(?:usage|rate|weekly|session)\\s+limits?|quota|allowance|credits|限额|限額|额度|額度|用量)';
const forward = new RegExp(`\\b${ACTION}\\b[^.!?;。！？；\\n]{0,60}${QUOTA}`,'i');
const backward = new RegExp(`${QUOTA}[^.!?;。！？；\\n]{0,45}\\b${ACTION}\\b`,'i');
function relevant(text, { terse = false } = {}) {
  const s = String(text || '');
  return s.split(/(?<=[.!?。！？;；])\s*|\n+/).some(part => {
    if (/\bgit\s+reset\b|password reset|reset (?:your|the) password/i.test(part)) return false;
    return /\b(?:free|banked|full|global) resets?\b|\breset credits?\b|赠送重置|系[统統]重置|全局重置|(?:额度|額度|用量|限额|限額).{0,25}(?:重置|重设|重設|恢复|恢復)|(?:重置|重设|重設|恢复|恢復).{0,25}(?:额度|額度|用量|限额|限額)/i.test(part)
      || forward.test(part) || backward.test(part)
      || (terse && /^\s*(?:day\s*\d+\s*[/：:]?\s*)?(?:full\s+)?reset[.!\s]*$/i.test(part));
  });
}
function brief(notice) {
  const raw=String(notice.text||''), name=notice.provider==='claude'?'Claude':'Codex';
  const text=raw.split('\n\n')[0];
  if (/Delayed Costs data|delays in publishing organization cost data/i.test(text)) return {title:'费用报表更新延迟',text:'费用报表显示延迟，API 和 ChatGPT 使用不受影响。这不是额度重置。'};
  if (/\b(?:will not|won['’]t|not going to)\s+reset|不会重置|不會重置/i.test(text)) return {title:`${name} 重置说明`,text:'公告说明不会进行所述重置，请勿据此等待额度恢复。'};
  if (/\b(?:may|might|could|if|either)\b|可能|如果/i.test(text)) return {title:`${name} 重置相关说明`,text:'公告提到可能或有条件进行额度重置，尚不能当作确定的重置安排。'};
  let title=`${name} 额度重置消息`, message='公告涉及额度重置；是否适用于你的账户仍需核对。';
  if (/\bbanked resets?\b|\breset credits?\b|赠送重置/i.test(text)) {title=`${name} 重置次数相关消息`;message='公告涉及可保留、手动使用的重置次数。实际是否到账及到期日，以你的账户为准。';}
  else if (/\b(?:will|going to|scheduled to|plan to)\b[^.!?\n]{0,60}\breset|即将|将于|將於/i.test(text)) {title=`${name} 预告额度重置`;message='官方预告将重置额度，目前不能据此认定已经恢复。';}
  else if (/\b(?:have|has|have been|has been|were|was)\s+(?:fully\s+)?reset\b|\bwe reset\b|已.{0,6}重置/i.test(text)) {title=`${name} 已发布重置消息`;message='官方表示已执行额度重置；你的账户是否已恢复，以当前用量为准。';}
  else if (/^\s*(?:Day\s*\d+\s*[/：:]?\s*)?(?:Full\s+)?Reset[.!\s]*$/i.test(text)) message='官方发布了重置消息，但这条原文未说明执行时间和适用范围。';
  const times=[...text.matchAll(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(AM|PM)\b(?:\s*(UTC(?:[+-]\d{1,2})?|GMT(?:[+-]\d{1,2})?|PST|PDT|EST|EDT|PT|ET))?/gi)].map(m=>`${String(Number(m[1])%12+(/pm/i.test(m[3])?12:0)).padStart(2,'0')}:${m[2]||'00'}${m[4]?` ${m[4].toUpperCase()}`:'（时区未注明）'}`);
  for (const m of text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*(?:AM|PM))(?:\s*(UTC(?:[+-]\d{1,2})?|GMT(?:[+-]\d{1,2})?|PST|PDT|EST|EDT|PT|ET))?/gi)) times.push(`${m[1].padStart(2,'0')}:${m[2]}${m[3]?` ${m[3].toUpperCase()}`:'（时区未注明）'}`);
  const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
  const date=text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,?\s+(20\d\d))?\b/i);
  const day=date?`${date[3]?date[3]+'年':''}${months.indexOf(date[1].toLowerCase())+1}月${date[2]}日 `:(text.match(/\b20\d\d-\d\d-\d\d\b/)?.[0]||'');
  if (times.length || day) message+=`原文提及时间：${day || (/tomorrow/i.test(text)?'明天 ':/tonight/i.test(text)?'今晚 ':/today/i.test(text)?'当天 ':'')}${[...new Set(times)].slice(0,4).join('、')}。`;
  return {title,text:message};
}
function statusScope(n) {
  if (n.kind!=='official' || !/^status\.(openai|claude)\.com$/.test(n.source||'')) return null;
  return n.incidentId || n.id?.match(/^official:(?:codex|claude):([^:]+):/)?.[1] || null;
}
module.exports={relevant,brief,normalize,statusScope};
