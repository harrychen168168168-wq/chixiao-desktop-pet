const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {ResetMonitor}=require('../lib/reset-monitor');
const {relevant,brief}=require('../lib/reset-announcement');
const start=Date.UTC(2030,3,1,12);
const costNotice='Delayed Costs data in the Compliance API\nWe have identified an issue causing delays in publishing organization cost data through the Costs API. API and ChatGPT usage are not affected, and other reporting channels remain available. We are working to restore normal data freshness.';
function fixture(saved={}){
  let clock=start,disk=saved;
  const m=new ResetMonitor({load:()=>disk,save:s=>{disk=JSON.parse(JSON.stringify(s));},now:()=>clock,codex:new EventEmitter()});
  return {m,set:t=>{clock=t;},disk:()=>disk};
}
const snapshot=(used=80,reset=start+3600000,extra={})=>({identity:'a',windows:[{id:'weekly',label:'每周',usedPercent:used,resetAt:reset}],creditCount:null,credits:null,source:'test',url:'https://claude.ai/settings/usage',...extra});
const sharedWeekly=(resetAt=start+3600000)=>[{id:'seven_day',label:'每周',usedPercent:100,resetAt},{id:'weekly_scoped:Sample',label:'Sample 每周',usedPercent:100,resetAt}];

test('report freshness, service recovery and menu refreshes are not quota resets',()=>{
  for(const text of [costNotice,'Codex usage is not affected. We are restoring normal service.','Refresh analytics on identity changes and compact usage menus','Run git reset to undo changes'])assert.equal(relevant(text),false);
  for(const text of ['We will reset all Codex usage limits at 10 PM today.','Your weekly usage limits reset tomorrow.','We have restored your quota.','系统重置所有额度'])assert(relevant(text));
  assert(relevant('Day 8/ Reset',{terse:true}));
});
test('Chinese key points distinguish future, completed, conditional and denied resets',()=>{
  const get=text=>brief({provider:'codex',text});
  assert.match(get(costNotice).text,/不是额度重置/);
  assert.match(get('We will reset all Codex usage limits at 10 PM today.').title,/预告/);
  assert.match(get('We will reset all Codex usage limits at 10 PM today.').text,/22:00（时区未注明）/);
  assert.match(get('We have reset all usage limits.').text,/已执行/);
  assert.match(get('We may reset all usage limits.').text,/不能当作确定/);
  assert.match(get('We will not reset usage limits.').text,/不会/);
  assert.match(get('We will reset usage limits at 22:00 UTC on October 15, 2030.').text,/2030年10月15日 22:00 UTC/);
});
test('status updates deduplicate identical bodies but keep changed execution times across restart',async()=>{
  const f=fixture();f.m.running=true;
  const updates=[{id:'u1',created_at:new Date(start).toISOString(),body:'We will reset usage limits at 10 PM.'},{id:'u2',created_at:new Date(start).toISOString(),body:'We will reset usage limits at 10 PM.'}];
  f.m.fetcher=async()=>({ok:true,json:async()=>({incidents:[{id:'i',name:'Quota reset',incident_updates:updates}]})});
  await f.m.readStatus('codex');assert.equal(f.m.state.notices.length,1);f.m.acknowledge(f.m.state.notices.map(n=>n.id));
  const g=fixture(f.disk());g.m.running=true;g.m.fetcher=f.m.fetcher;await g.m.readStatus('codex');
  assert.equal(g.m.state.notices.length,1);assert(g.m.state.notices[0].acknowledgedAt);
  updates.push({id:'u3',created_at:new Date(start).toISOString(),body:'We will reset usage limits at 11 PM.'});
  await g.m.readStatus('codex');assert.equal(g.m.state.notices.length,2);assert.equal(g.m.state.notices[0].acknowledgedAt,null);
});
test('saved false status alerts are set aside without being marked as read',()=>{
  const f=fixture({notices:['a','b'].map(id=>({id:`official:codex:i:${id}`,provider:'codex',kind:'official',source:'status.openai.com',text:costNotice,acknowledgedAt:null,receivedAt:start}))});
  assert.equal(f.m.snapshot().notices.length,0);assert.equal(f.m.state.ignoredNotices.length,2);
  assert(f.m.state.ignoredNotices.every(n=>n.acknowledgedAt===null));assert.equal(f.m.snapshot().ignoredNotices,undefined);
});
test('recovery observation survives closing, polling and restart without inventing an execution time',()=>{
  const f=fixture();f.m.accept('codex',snapshot(70,start+86400000));
  f.set(start+15000);f.m.accept('codex',snapshot(0,start+7*86400000));
  const r=f.m.state.accounts.codex.latestRecovery;
  assert.equal(r.previousObservedAt,start);assert.equal(r.detectedAt,start+15000);assert.equal(r.executedAt,undefined);
  f.m.acknowledge(f.m.state.notices.map(n=>n.id));
  const g=fixture(f.disk());assert.deepEqual(g.m.state.accounts.codex.latestRecovery,r);
  g.m.accept('codex',snapshot(0,start+86400000,{identity:'b'}));assert.equal(g.m.state.accounts.codex.latestRecovery,null);
});
test('windows sharing one reset time produce one reminder, also after late rows, close and restart',()=>{
  const f=fixture();let alerts=0;f.m.on('notice',()=>alerts++);
  f.m.accept('claude',snapshot(100,undefined,{windows:sharedWeekly().slice(0,1)}));
  f.m.acknowledge(f.m.state.notices.map(n=>n.id));
  f.set(start+15000);f.m.accept('claude',snapshot(100,undefined,{windows:sharedWeekly()}));
  assert.equal(alerts,1);assert.equal(f.m.state.notices.length,1);assert(f.m.state.notices[0].acknowledgedAt);
  assert.match(f.m.state.notices[0].text,/所有模型.*Sample/);
  const g=fixture(f.disk());let replay=0;g.m.on('notice',()=>replay++);
  g.m.accept('claude',snapshot(100,undefined,{windows:sharedWeekly()}));g.m.reminders('claude');
  assert.equal(replay,0);assert.equal(g.m.state.notices.length,1);
});
test('different reset times, accounts and providers stay separate',()=>{
  const f=fixture();const windows=sharedWeekly();windows[1].resetAt-=60000;
  f.m.accept('claude',snapshot(100,undefined,{windows}));assert.equal(f.m.state.notices.length,2);
  f.m.accept('claude',snapshot(100,undefined,{identity:'b',windows:sharedWeekly()}));
  f.m.accept('codex',snapshot(100,undefined,{windows:sharedWeekly()}));
  assert.equal(f.m.state.notices.length,4);
});
test('saved per-window previews migrate to one reminder and keep read state',()=>{
  for(const read of [false,true]){
    const notices=sharedWeekly().map((w,i)=>({id:`claude:a:soon:${w.id}:${w.resetAt}`,provider:'claude',kind:'upcoming',title:'Claude 即将自动恢复，先别浪费重置',text:`${w.label}：官方预告约 60 分钟后恢复。`,receivedAt:start+i*10,acknowledgedAt:read&&i===0?start+100:null}));
    const f=fixture({notices,seen:notices.map(n=>n.id)});
    assert.equal(f.m.state.notices.length,1);assert.equal(f.disk().notices.length,1);
    assert.equal(Boolean(f.m.state.notices[0].acknowledgedAt),read);
    if(!read){f.m.acknowledge([notices[1].id]);assert(f.m.state.notices[0].acknowledgedAt);}
  }
});
test('Claude billing time is used only when its day matches the page',()=>{
  const {subscriptionDetails,preciseSubscription,subscriptionNextCheck}=require('../lib/claude-usage');
  const cancel=subscriptionDetails('您的订阅将于 2030年4月20日 取消。');
  assert.deepEqual(cancel,{dateText:'2030年4月20日',dateKind:'expiry'});
  const p=preciseSubscription(cancel,{plan_ending_at:'2030-04-20T14:12:15Z',next_charge_at:null},'UTC');
  assert.equal(p.dateAt,Date.parse('2030-04-20T14:12:15Z'));assert.equal(p.dateText,'2030/4/20 14:12:15');
  assert.deepEqual(preciseSubscription(cancel,{plan_ending_at:'2030-05-20T14:12:15Z'},'UTC'),cancel);
  assert.deepEqual(preciseSubscription(cancel,null),cancel);
  assert.equal(subscriptionNextCheck({dateAt:start+60000},start),start+60000);
  assert.equal(subscriptionNextCheck({dateAt:null},start),start+300000);
});
test('Codex read restarts the reader once after an RPC error, then reports a clear failure',async()=>{
  const {CodexResetSource}=require('../lib/codex-reset-source');
  const s=new CodexResetSource();let calls=0,stops=0;
  s.stop=()=>{stops++;};s.readOnce=async()=>{if(++calls===1)throw Object.assign(new Error('Codex 接口读取失败（-32603）'),{rpc:true});return {ok:true};};
  assert.deepEqual(await s.read(),{ok:true});assert.equal(calls,2);assert.equal(stops,1);
  const t=new CodexResetSource();t.stop=()=>{};t.readOnce=async()=>{throw Object.assign(new Error('Codex 接口读取失败（-32603）'),{rpc:true});};
  await assert.rejects(t.read(),/已重启 Codex 读取仍失败/);
});
