const {test}=require('node:test'),assert=require('node:assert/strict');
const {DEFAULTS,validate}=require('../lib/settings'),{Chat,request}=require('../lib/chat');
test('fresh edition has no enabled provider, key, identity, model or memory path',()=>{
  assert.equal(DEFAULTS.provider,'disabled');assert.equal(DEFAULTS.shareSystem,false);assert.equal(DEFAULTS.model,'');
  assert.deepEqual(Object.keys(DEFAULTS).sort(),['agent','endpoint','model','provider','shareSystem']);
  assert.throws(()=>request(DEFAULTS,'',[],null),/先在连接设置/);
});
test('connection settings accept only explicit loopback origins',()=>{
  for(const endpoint of ['https://example.org','http://192.168.1.1:18789','http://169.254.169.254','file:///secret','http://user:pass@localhost','http://localhost/api','http://localhost?key=x','http://localhost#x'])assert.throws(()=>validate({...DEFAULTS,endpoint}));
  for(const endpoint of ['http://127.0.0.1:18789','http://localhost:11434','http://[::1]:11434'])assert.equal(validate({...DEFAULTS,endpoint}).endpoint,endpoint);
});
test('computer readings are excluded unless explicitly opted in; key is header-only',()=>{
  const cfg={...DEFAULTS,provider:'openclaw'},marker={ram:{usedGB:12345}};
  const no=request(cfg,'test-only-token',[{role:'user',content:'你好'}],marker);
  assert(!no.body.includes('12345'));assert(!no.body.includes('test-only-token'));
  assert.equal(no.headers.Authorization,'Bearer test-only-token');assert.equal(no.url,'http://127.0.0.1:11434/v1/chat/completions');
  assert(request({...cfg,shareSystem:true},'test-only-token',[],marker).body.includes('12345'));
});
test('disabled service performs zero requests and imports no history',async()=>{
  let calls=0;const chat=new Chat({settings:()=>DEFAULTS,token:()=>'',read:(_k,f)=>f,write:()=>{},system:()=>null,fetcher:async()=>{calls++;}});
  assert.deepEqual(chat.messages,[]);await assert.rejects(chat.send('hello'));assert.equal(calls,0);
});
test('only submitted local chat is persisted, redirects blocked, session rotates on clear',async()=>{
  const saved=[],cfg={...DEFAULTS,provider:'ollama',model:'test-model'};
  const chat=new Chat({settings:()=>cfg,token:()=>'',read:(_k,f)=>f,write:(k,v)=>saved.push([k,v]),system:()=>null,fetcher:async(url,opts)=>{assert.equal(url,'http://127.0.0.1:11434/api/chat');assert.equal(opts.redirect,'error');assert(!opts.headers.Authorization);return {ok:true,json:async()=>({message:{content:'主人，你好。'}})};}});
  assert.equal(await chat.send('你好'),'主人，你好。');assert.equal(saved[0][0],'chat.json');assert.equal(saved[0][1].length,2);
  const before=chat.session;chat.clear();assert.notEqual(chat.session,before);assert.deepEqual(chat.messages,[]);
});
test('stopping a request prevents late replies from being saved',async()=>{
  let resolve;const saved=[],chat=new Chat({settings:()=>({...DEFAULTS,provider:'ollama',model:'test'}),token:()=>'',read:(_k,f)=>f,write:(_k,v)=>saved.push(v),system:()=>null,fetcher:()=>new Promise(r=>resolve=r)});
  const pending=chat.send('hello');chat.cancel();resolve({ok:true,json:async()=>({message:{content:'late'}})});await assert.rejects(pending,/停止等待/);assert.deepEqual(saved,[]);assert.equal(chat.controller,null);
});
