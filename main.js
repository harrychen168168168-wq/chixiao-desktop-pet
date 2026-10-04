const {app,BrowserWindow,ipcMain,Menu,screen,powerMonitor,safeStorage,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const {randomUUID}=require('node:crypto');
app.setName('Chixiao Public');
const proof=(process.argv.find(a=>a.startsWith('--verify='))||'').slice(9);
app.setPath('userData',proof?path.join(app.getPath('temp'),'chixiao-public-check-'+randomUUID()):path.join(app.getPath('appData'),'chixiao-public'));
const {readJson,writeJson,DATA_DIR}=require('./lib/util');
const {DEFAULTS,validate}=require('./lib/settings');
const {Chat}=require('./lib/chat'),{SystemStats}=require('./lib/system'),{Mind}=require('./lib/mind');
const {Roam}=require('./lib/roam'),{EdgeHide,fit}=require('./lib/edge-hide');
const icon=path.join(__dirname,'ui/assets/icon.ico');
let pet,panel,roam,edge,mind,system,chat,drag,clickTimer,loop,paused=false,petH=294,pending=null;
let settings;try{settings=validate(readJson('settings.json',DEFAULTS));}catch{settings={...DEFAULTS};}
const tokenFile=path.join(DATA_DIR,'gateway.bin');
const getToken=()=>{try{return safeStorage.decryptString(fs.readFileSync(tokenFile));}catch{return '';}};
const forgetToken=()=>{try{fs.unlinkSync(tokenFile);}catch{}};
const alive=w=>w&&!w.isDestroyed();
const send=(channel,data)=>{for(const w of [pet,panel])if(alive(w))w.webContents.send(channel,data);};
const area=()=>screen.getDisplayMatching(pet.getBounds()).workArea;
const home=()=>{const a=screen.getPrimaryDisplay().workArea;return {x:a.x+a.width-296,y:a.y+a.height-petH-12,width:280,height:petH};};
const move=b=>{if(alive(pet))pet.setBounds(b);};
const savePosition=()=>{if(!proof&&alive(pet)&&!edge?.active)writeJson('window.json',pet.getBounds());};
const protect=w=>{
  w.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  w.webContents.on('will-navigate',e=>e.preventDefault());
  w.webContents.on('will-attach-webview',e=>e.preventDefault());
};
const preferences={preload:path.join(__dirname,'preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false};
function openPanel(){
  edge.reveal(true);roam.stop();
  if(!alive(panel)){
    panel=new BrowserWindow({width:470,height:740,minWidth:390,minHeight:540,title:'赤霄 · 对话与设置',icon,show:false,autoHideMenuBar:true,webPreferences:preferences});
    protect(panel);panel.loadFile(path.join(__dirname,'ui/panel.html'));panel.once('ready-to-show',()=>panel.show());
  }else{panel.show();panel.focus();}
}
function command(kind){
  if(kind==='edge-return'){edge.reveal();return;}
  if(!['pet','praise','rest','play','home','roam'].includes(kind))return;
  edge.reveal(true);roam.stop();pending=null;
  if(kind==='roam'){roam.toggle(!roam.enabled);return;}
  send('pet:command',{kind});if(['play','home'].includes(kind))pending={kind,until:Date.now()+20000};
}
function menu(){
  Menu.buildFromTemplate([
    {label:'和赤霄说话 / 连接设置',click:openPanel},{type:'separator'},
    ...[['摸摸赤霄','pet'],['夸夸赤霄','praise'],['陪它玩','play'],['回到右下角','home'],['休息一会儿','rest']].map(([label,kind])=>({label,click:()=>command(kind)})),
    {label:'自由散步',type:'checkbox',checked:roam.enabled,click:()=>command('roam')},
    ...(edge.active?[{label:'叫赤霄回到桌面',click:()=>command('edge-return')}]:[]),
    {label:'安静一小时',click:()=>mind.hush(60)},
    {label:'恢复说话',click:()=>mind.hush(0)},
    {type:'separator'},{label:'退出赤霄公开版',click:()=>app.quit()}
  ]).popup({window:pet});
}
function authorized(e){return [pet,panel].some(w=>alive(w)&&e.sender===w.webContents&&e.senderFrame===w.webContents.mainFrame);}
const on=(name,fn)=>ipcMain.on(name,(e,...args)=>{if(authorized(e))fn(...args);});
const handle=(name,fn)=>ipcMain.handle(name,(e,...args)=>{if(!authorized(e))throw Error('Untrusted window');return fn(...args);});
const emptyActive=()=>({running:[],recent:[]});
const snapshot=()=>({settings:{...settings,hasToken:Boolean(getToken())},messages:chat.messages,system:system.last||null});
function wire(){
  handle('initial',()=>({system:system.last||null,active:emptyActive(),alerts:[],pet:{sleepAfterSeconds:900,idleEverySeconds:[16,34]}}));
  handle('public:state',snapshot);
  handle('public:save',input=>{
    if(chat.controller)throw Error('请先停止等待当前回复，再修改连接');
    const next=validate(input);const token=typeof input?.token==='string'?input.token.trim():'';
    if(token.length>4096)throw Error('口令过长');
    if(token){if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text')throw Error('系统加密不可用，无法保存口令');fs.mkdirSync(DATA_DIR,{recursive:true});fs.writeFileSync(tokenFile,safeStorage.encryptString(token));}
    else if(input?.forgetToken||next.endpoint!==settings.endpoint||next.provider!==settings.provider)forgetToken();
    if(next.provider!==settings.provider||next.endpoint!==settings.endpoint||next.agent!==settings.agent||next.model!==settings.model)chat.clear();
    settings=next;writeJson('settings.json',settings);return snapshot();
  });
  handle('public:send',async text=>{
    if(chat.controller)throw Error('正在等待回复');
    edge.reveal();send('chat:thinking',true);
    try{const reply=await chat.send(text);send('chat:reply',{text:reply});return snapshot();}
    finally{send('chat:thinking',false);}
  });
  handle('public:stop',()=>{chat.cancel();return true;});
  handle('public:clear',()=>{chat.clear();return snapshot();});
  on('pet:menu',menu);on('public:open',openPanel);on('pet:command',command);
  on('pet:touch',(kind,info)=>mind.touch(kind,info||{}));
  on('pet:state',action=>mind.report(String(action)));
  on('pet:behavior',s=>{if(s&&typeof s==='object')roam.report(s);});
  on('pet:size',h=>{
    h=Math.max(120,Math.min(720,Math.ceil(Number(h)||294)));if(h===petH)return;
    const b=pet.getBounds();petH=h;move(fit({...b,y:b.y+b.height-h,height:h},area()));
    if(process.platform==='win32'&&edge?.active)pet.setShape(edge.hitRegion());
  });
  on('pet:down',()=>{
    if(edge.tucked){edge.reveal();return;}
    edge.reveal(true);roam.stop();pending=null;
    const p=screen.getCursorScreenPoint(),b=pet.getBounds();if(drag)clearInterval(drag.timer);
    drag={sx:p.x,sy:p.y,ox:p.x-b.x,oy:p.y-b.y,orig:b,at:Date.now(),moved:false};
    drag.timer=setInterval(()=>{
      if(!drag||!alive(pet))return;
      if(Date.now()-drag.at>60000){clearInterval(drag.timer);move(fit(drag.orig,area()));drag=null;return;}
      const c=screen.getCursorScreenPoint();if(!drag.moved&&Math.hypot(c.x-drag.sx,c.y-drag.sy)<8)return;
      drag.moved=true;move({x:c.x-drag.ox,y:c.y-drag.oy,width:280,height:petH});
    },16);
  });
  on('pet:up',point=>{
    if(!drag)return;const d=drag;clearInterval(d.timer);drag=null;
    if(point?.cancelled){move(fit(d.orig,area()));return;}
    const p=screen.getCursorScreenPoint(),wobble=Date.now()-d.at<350&&Math.hypot(p.x-d.sx,p.y-d.sy)<24;
    if(d.moved&&!wobble){
      clearTimeout(clickTimer);clickTimer=null;
      const raw={x:p.x-d.ox,y:p.y-d.oy,width:280,height:petH},a=screen.getDisplayNearestPoint(p).workArea;
      if(!edge.dockFromDrag(raw,a)){move(fit(raw,a));savePosition();}return;
    }
    if(d.moved)move(d.orig);
    if(clickTimer){clearTimeout(clickTimer);clickTimer=null;send('pet:clicked',{double:true});openPanel();}
    else clickTimer=setTimeout(()=>{clickTimer=null;send('pet:clicked',{double:false});openPanel();},380);
  });
}
async function start(){
  session.defaultSession.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  session.defaultSession.webRequest.onBeforeRequest((details,cb)=>cb({cancel:! /^(file:|data:|devtools:)/.test(details.url)}));
  system=new SystemStats();
  chat=new Chat({settings:()=>settings,token:getToken,read:readJson,write:writeJson,system:()=>system.last});
  const hub=new EventEmitter();hub.config={pet:{talk:{enabled:true},dayRhythm:{enabled:true}}};hub.system=system;hub.getActive=emptyActive;hub.getAlerts=()=>[];hub.getQuota=()=>null;
  mind=new Mind(hub,{idleSeconds:()=>powerMonitor.getSystemIdleTime(),memoryText:()=>''});
  let bounds=home();const saved=readJson('window.json',null);
  if(saved&&['x','y'].every(k=>Number.isFinite(saved[k])))bounds=fit({...bounds,x:saved.x,y:saved.y},screen.getDisplayMatching({...bounds,...saved}).workArea);
  pet=new BrowserWindow({...bounds,transparent:true,frame:false,resizable:false,maximizable:false,minimizable:false,fullscreenable:false,hasShadow:false,alwaysOnTop:true,skipTaskbar:true,focusable:false,show:false,title:'赤霄 · 公开版',icon,webPreferences:preferences});
  protect(pet);
  roam=new Roam({bounds:()=>pet.getBounds(),area,move,config:{enabled:true,everySeconds:[30,70],speed:75},notify:s=>send('pet:motion',s)});
  edge=new EdgeHide({roam,bounds:()=>pet.getBounds(),area,move,notify:s=>{send('pet:edge',s);if(process.platform==='win32')pet.setShape(edge.hitRegion());}});
  wire();
  system.on('update',s=>send('system',s));
  mind.on('say',s=>{if(edge.active&&['lift','drop'].includes(s.occasion))return;edge.reveal();send('pet:say',s);});
  await pet.loadFile(path.join(__dirname,'ui/pet.html'));
  pet.showInactive();pet.setAlwaysOnTop(true,'screen-saver');system.start();if(!proof)mind.start();
  loop=setInterval(()=>{
    if(!alive(pet)||drag)return;
    const block=paused||(alive(panel)&&panel.isVisible());
    if(edge.active){edge.tick(screen.getCursorScreenPoint(),block);return;}
    if(pending&&Date.now()>pending.until)pending=null;
    if(pending&&!block&&!roam.blocked()){const p=pending;pending=null;if(p.kind==='play')roam.play();else roam.go(home(),'home');}
    roam.tick(screen.getCursorScreenPoint(),block);
  },33);
  const recover=()=>{edge.reveal(true);roam.stop();move(fit(pet.getBounds(),area()));};
  for(const ev of ['display-added','display-removed','display-metrics-changed'])screen.on(ev,recover);
  powerMonitor.on('suspend',()=>{paused=true;recover();});powerMonitor.on('resume',()=>{paused=false;});
  if(proof)await verify();
}
async function verify(){
  const assert=require('node:assert/strict'),out=path.resolve(proof);fs.mkdirSync(out,{recursive:true});
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  try{
    assert.equal(settings.provider,'disabled');assert.equal(getToken(),'');assert.deepEqual(chat.messages,[]);
    await wait(6000);
    const before=await pet.webContents.executeJavaScript("({ready:document.querySelector('#pet-anim').dataset.pose,rows:[...document.querySelectorAll('#stats .row')].map(e=>e.offsetTop)})");
    assert(before.ready);const b=pet.getBounds(),a=area();assert(edge.dockFromDrag({...b,x:a.x+a.width-b.width+40},a));
    await wait(1400);assert.equal(edge.phase,'hidden');edge.peek();await wait(1800);
    const peek=await pet.webContents.executeJavaScript("({body:getComputedStyle(document.querySelector('#root')).transform,head:getComputedStyle(document.querySelector('#edge-peek')).opacity})");
    assert.equal(peek.body,'matrix(1, 0, 0, 1, 280, 0)');assert.equal(peek.head,'1');
    fs.writeFileSync(path.join(out,'peek.png'),(await pet.webContents.capturePage()).toPNG());edge.reveal();await wait(1300);assert.equal(edge.phase,'desktop');
    openPanel();await wait(1400);
    const firstRun=await panel.webContents.executeJavaScript("document.body.innerText");assert(firstRun.includes('尚未连接'));assert(!firstRun.includes('Bearer'));
    fs.writeFileSync(path.join(out,'panel.png'),(await panel.webContents.capturePage()).toPNG());
    // An isolated local fixture tests both protocols without using any installed AI.
    const requests=[];
    const server=require('node:http').createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{requests.push({url:req.url,auth:req.headers.authorization,body:JSON.parse(body)});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({message:{content:'主人，本机测试通过。'},choices:[{message:{content:'主人，本机测试通过。'}}]}));});});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    try{
      const endpoint='http://127.0.0.1:'+server.address().port;
      await panel.webContents.executeJavaScript('window.deskPet.public.save('+JSON.stringify({...DEFAULTS,provider:'ollama',endpoint,model:'test-model'})+')');
      await panel.webContents.executeJavaScript('window.deskPet.public.send("隔离验证")');
      assert.equal(requests[0].url,'/api/chat');assert.equal(requests[0].auth,undefined);assert(!JSON.stringify(requests[0].body).includes('当前电脑读数'));
      const cfg={...DEFAULTS,provider:'openclaw',endpoint,token:'fixture-token-not-a-real-credential'};
      const saved=await panel.webContents.executeJavaScript('window.deskPet.public.save('+JSON.stringify(cfg)+')');assert.equal(saved.settings.hasToken,true);assert(!JSON.stringify(saved).includes(cfg.token));
      assert(!fs.readFileSync(tokenFile).includes(Buffer.from(cfg.token)));assert(!fs.readFileSync(path.join(DATA_DIR,'settings.json'),'utf8').includes(cfg.token));
      await panel.webContents.executeJavaScript('window.deskPet.public.send("隔离验证")');assert.equal(requests[1].url,'/v1/chat/completions');assert.equal(requests[1].auth,'Bearer '+cfg.token);
      await panel.webContents.executeJavaScript('window.deskPet.public.save('+JSON.stringify({...DEFAULTS,forgetToken:true})+')');assert.equal(getToken(),'');assert.deepEqual(chat.messages,[]);
    }finally{await new Promise(r=>server.close(r));}
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({ok:true,version:app.getVersion(),freshProfile:true,provider:settings.provider,tokenPresent:false,messages:0,peek,checks:['fresh isolated profile','disabled AI by default','animated dragon loaded','drag dock','head-only peek','recall','first-run settings panel','Ollama loopback fixture via renderer IPC','OpenClaw loopback fixture via renderer IPC','OS-encrypted token not exposed to renderer or settings JSON','disconnect clears credentials and conversation']},null,2));
    app.exit(0);
  }catch(e){fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({ok:false,error:e.stack}));app.exit(1);}
}
if(!app.requestSingleInstanceLock()){app.quit();}
else{
  app.on('second-instance',()=>{if(alive(pet)){edge.reveal();pet.showInactive();}});
  app.whenReady().then(start).catch(e=>{console.error(e.message);app.exit(1);});
  app.on('window-all-closed',()=>{if(!alive(pet))app.quit();});
  app.on('before-quit',()=>{clearInterval(loop);clearInterval(drag?.timer);clearTimeout(clickTimer);chat?.cancel();system?.stop();if(!proof)mind?.stop();savePosition();});
}
