const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {ResetMonitor,codexSnapshot}=require('../lib/reset-monitor');
const {subscriptionFromAuth}=require('../lib/codex-reset-source');
const prefs=require('../lib/reset-preferences');
const now=Date.UTC(2030,3,1,12);
const fixture=()=>new ResetMonitor({codex:null,load:()=>({}),save:()=>{},now:()=>now});
test('fresh public edition performs no account reads or website requests, including refresh',async()=>{
  let calls=0;const source=new EventEmitter();source.read=source.messages=async()=>{calls++;};source.stop=()=>{};
  const m=new ResetMonitor({codex:source,claude:source,load:()=>({}),save:()=>{},config:{sourceEnabled:key=>prefs.enabled(prefs.DEFAULTS,key)},fetcher:async()=>{calls++;}});
  m.start();await m.refresh();m.trigger('codex',()=>source.read(),0);m.stop();assert.equal(calls,0);assert.equal(m.timers.size,0);
  assert.deepEqual(prefs.validate({codex:'true',claude:true,official:1}),{official:false,codex:false,claude:true});
  assert(!prefs.enabled({official:true,codex:false,claude:false},'official:codex-messages'));
});
test('subscription is account-bound, has independent billing and gift expiry dates, and exports no credentials',()=>{
  const account={type:'chatgpt',email:'reader@example.invalid',planType:'plus'};
  const payload={iss:'https://auth.openai.com',email:account.email,'https://api.openai.com/auth':{chatgpt_account_id:'fictional-account',chatgpt_plan_type:'plus',chatgpt_subscription_active_until:'2030-04-12T18:00:00Z',chatgpt_subscription_last_checked:'2030-03-12T18:00:00Z'}};
  const auth={tokens:{account_id:'fictional-account',id_token:'fixture.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.fixture',refresh_token:'fixture-secret'}};
  const subscription=subscriptionFromAuth(auth,account);
  assert.equal(subscription.dateAt,Date.parse('2030-04-12T18:00:00Z'));assert.equal(subscription.dateKind,'expiry');
  assert.equal(subscription.recordUpdatedAt,Date.parse('2030-03-12T18:00:00Z'));
  assert(!/fictional-account|example.invalid|fixture-secret/.test(JSON.stringify(subscription)));
  assert.equal(subscriptionFromAuth(auth,{...account,email:'other@example.invalid'}),null);
  assert.equal(subscriptionFromAuth(auth,{...account,planType:'free'}),null);
  assert.equal(subscriptionFromAuth({tokens:{id_token:'broken'}},account),null);
  const data={rateLimitResetCredits:{availableCount:2,credits:[{id:'gift',status:'available',expiresAt:now/1000+86400}]}};
  const snapshot=codexSnapshot({identity:'test',data,planType:'plus',subscription});
  assert.notEqual(snapshot.subscription.dateAt,snapshot.credits[0].expiresAt);
  assert.equal(codexSnapshot({identity:'test',data,planType:'plus'}).subscription.dateText,null);
});
test('opting into official websites alone never starts either account reader',async()=>{
  let accountReads=0,webReads=0;
  const source=new EventEmitter();source.read=source.messages=async()=>{accountReads++;};source.stop=()=>{};
  const choices={official:true,codex:false,claude:false};
  const m=new ResetMonitor({codex:source,claude:source,load:()=>({}),save:()=>{},config:{sourceEnabled:key=>prefs.enabled(choices,key)},fetcher:async url=>{
    webReads++;return new Response(String(url).includes('incidents.json')?JSON.stringify({incidents:[]}):'<main><p>Synthetic official page without announcements. This controlled response contains no account data and is used only to validate source selection.</p></main>');
  }});
  m.running=true;await m.refresh();m.stop();assert(webReads>0);assert.equal(accountReads,0);
});
test('weekly recovery and credits deduplicate; five-hour quota stays hidden; manual close preserves concurrent notice',()=>{
  const m=fixture();
  const account={identity:'synthetic',windows:[{id:'weekly',label:'每周',windowDurationMins:10080,usedPercent:60,resetAt:now+86400000},{id:'five_hour',windowDurationMins:300,usedPercent:80,resetAt:now+900000}],creditCount:2,credits:[]};
  m.accept('codex',account);const ids=m.snapshot().notices.map(n=>n.id);assert.equal(ids.length,1);
  m.accept('codex',account);assert.equal(m.snapshot().notices.length,1);assert.equal(m.snapshot().accounts.codex.windows.length,1);
  m.accept('codex',{...account,windows:[{...account.windows[0],usedPercent:0,resetAt:now+604800000}]});
  m.acknowledge(ids);assert(m.snapshot().notices.some(n=>!n.acknowledgedAt&&n.kind==='recovered'));
});
test('Claude subscription is never taken from cloud credit expiry',()=>{
  const {subscriptionDetails,usageWindows}=require('../lib/claude-usage');
  assert.equal(subscriptionDetails('云会话额度\n6月20日 过期\n剩余 US$80（共 US$100）').dateText,null);
  assert.deepEqual(subscriptionDetails('您的订阅将于 2030年4月20日 自动续费。'),{dateText:'2030年4月20日',dateKind:'renewal'});
  assert.equal(usageWindows({limits:[{kind:'weekly_all',percent:23,resets_at:'2030-04-07T00:00:00Z'}]})[0].usedPercent,23);
});
