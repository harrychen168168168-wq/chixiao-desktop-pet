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
let landingAnchor=null,resetMonitor,resetWindow,quitting=false;
const workAreaFor=b=>screen.getDisplayMatching(b).workArea;
const clampBounds=b=>fit(b,workAreaFor(b));
function placePanel() {} // The public conversation window keeps the user's chosen position.
function resizePet(h,layout) {
  if(drag?.carrying)return; // Keep the grip anchored while reminder cards change.
  h = Math.max(120, Math.min(720, Math.ceil(Number(h) || 0)));
  if(alive(pet))h=Math.min(h,workAreaFor(pet.getBounds()).height);
  if (!alive(pet)) return;
  const b = pet.getBounds();
  const anchor=landingAnchor;
  const landing=anchor&&Number.isFinite(layout?.petTop)&&layout.petTop>=0&&layout.petTop<=720;
  if(h===petH&&!landing)return;
  if (roam && !edge?.active) roam.stop();
  petH = h;
  pet.setBounds(clampBounds({ x: b.x, y: landing?Math.round(anchor.y+8-layout.petTop):b.y+b.height-h, width: 280, height: h }));
  if(landing){landingAnchor=null;savePosition();}
  if(edge?.locked&&!drag)edge.reanchor();
  if(edge?.active&&process.platform==='win32')pet.setShape(edge.hitRegion());
  if (alive(panel) && panel.isVisible()) placePanel();
}

function clickPet() {
  if(clickTimer){
    clearTimeout(clickTimer);clickTimer=null;

    pet.webContents.send('pet:clicked',{double:true});openPanel();
  } else {
    clickTimer=setTimeout(()=>{
      clickTimer=null;
      if(!alive(pet))return;
      pet.webContents.send('pet:clicked',{double:false});openPanel();
    },380);
  }
}

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
function setupResets(){
  const prefs=require('./lib/reset-preferences');
  const {ResetMonitor}=require('./lib/reset-monitor');
  const {ClaudeResetSource}=require('./lib/claude-reset-source');
  const {createResetWindow}=require('./lib/reset-window');
  let choices=proof?{...prefs.DEFAULTS}:prefs.validate(readJson('reset-settings.json',prefs.DEFAULTS));
  resetMonitor=new ResetMonitor({config:{sourceEnabled:key=>prefs.enabled(choices,key),preferences:choices},claude:new ClaudeResetSource()});
  const markDisabled=()=>{
    for(const key of ['codex','claude','official:codex-messages','official:codex-status','official:claude-status',...Object.keys(resetMonitor.state.sources)]){
      if(!prefs.enabled(choices,key))resetMonitor.state.sources[key]={disabled:true,ok:false,error:'未开启 · 在上方选择后保存'};
    }
  };
  markDisabled();
  resetWindow=createResetWindow({monitor:resetMonitor,pet:()=>pet,onState:s=>send('ai-resets',s),onNotice:()=>{edge.reveal();pet.showInactive();}});
  handle('ai-resets:initial',()=>resetMonitor.snapshot());
  on('ai-resets:open',()=>resetWindow.show());
  handle('public:resets-save',async input=>{
    resetMonitor.stop();
    await Promise.allSettled([...resetMonitor.jobs.values()]);
    choices=prefs.validate(input);writeJson('reset-settings.json',choices);
    resetMonitor.config.preferences=choices;
    markDisabled();
    if(Object.values(choices).some(Boolean))resetMonitor.start();
    resetMonitor.publish();return resetMonitor.snapshot();
  });
  if(Object.values(choices).some(Boolean))resetMonitor.start();
}
function openPanel(){
  edge.reveal(true);roam.stop();
  if(!alive(panel)){
    panel=new BrowserWindow({width:470,height:740,minWidth:390,minHeight:540,title:'赤霄 · 对话与设置',icon,show:false,autoHideMenuBar:true,webPreferences:preferences});
    protect(panel);panel.loadFile(path.join(__dirname,'ui/panel.html'));panel.webContents.once('did-finish-load',()=>panel.show());panel.show();panel.on('close',e=>{if(!quitting){e.preventDefault();panel.hide();}});
  }else{panel.show();panel.focus();}
}
function command(kind){
  if(kind==='edge-return'){edge.reveal();return;}
  if(!['pet','praise','rest','play','home','roam'].includes(kind))return;
  edge.reveal(true);roam.stop();pending=null;
  if(kind==='roam'){roam.toggle(!roam.enabled);writeJson('pet-preferences.json',{roamEnabled:roam.enabled});return;}
  send('pet:command',{kind});if(!edge.locked&&['play','home'].includes(kind))pending={kind,until:Date.now()+20000};
}
function menu(){
  Menu.buildFromTemplate([
    {label:'和赤霄说话 / 连接设置',click:openPanel},{type:'separator'},
    ...[['摸摸赤霄','pet'],['夸夸赤霄','praise'],['陪它玩','play'],['回到右下角','home'],['休息一会儿','rest']].map(([label,kind])=>({label,click:()=>command(kind)})),
    {label:'自由散步',type:'checkbox',checked:roam.enabled,click:()=>command('roam')},
    ...(edge.locked?[{label:'靠边已锁定 · 向内拖动后松手解锁',enabled:false}]:edge.active?[{label:'叫赤霄回到桌面',click:()=>command('edge-return')}]:[]),
    {label:'安静一小时',click:()=>mind.hush(60)},
    {label:'恢复说话',click:()=>mind.hush(0)},
    {type:'separator'},{label:'退出赤霄公开版',click:()=>app.quit()}
  ]).popup({window:pet});
}
function authorized(e){return [pet,panel].some(w=>alive(w)&&e.sender===w.webContents&&e.senderFrame===w.webContents.mainFrame);}
const on=(name,fn)=>ipcMain.on(name,(e,...args)=>{if(authorized(e))fn(...args);});
const handle=(name,fn)=>ipcMain.handle(name,(e,...args)=>{const reset=resetWindow?.getWindow();const resetSettings=name==='public:resets-save'&&alive(reset)&&e.sender===reset.webContents&&e.senderFrame===reset.webContents.mainFrame;if(!authorized(e)&&!resetSettings)throw Error('Untrusted window');return fn(...args);});
const emptyActive=()=>({running:[],recent:[]});
const snapshot=()=>({settings:{...settings,hasToken:Boolean(getToken())},messages:chat.messages,system:system.last||null});
function wire(){
  handle('initial',()=>({edge:edge?.snapshot(),workArea:area(),system:system.last||null,active:emptyActive(),alerts:[],pet:{sleepAfterSeconds:900,idleEverySeconds:[16,34]}}));
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
  on('pet:size',resizePet);
  on('pet:bubble',s=>{if(!s)return;edge.setAlert(Boolean(s.visible),Math.min(720,Math.max(0,Number(s.height)||0)));if(edge.locked&&process.platform==='win32')pet.setShape(edge.hitRegion());});
  on('pet:down', point => {
    landingAnchor=null;
    if(edge?.tucked&&!edge.locked){edge.reveal();return;}
    edge?.reveal(true);
    if (roam) roam.stop();
    pending = null;
    if (drag) clearInterval(drag.timer);
    const b = pet.getBounds();
    const c = Number.isFinite(point?.clientX)&&Number.isFinite(point?.clientY)&&point.clientX>=0&&point.clientX<=b.width&&point.clientY>=0&&point.clientY<=b.height
      ? {x:b.x+point.clientX,y:b.y+point.clientY}:screen.getCursorScreenPoint();
    const locked=edge?.beginDrag(c)||false;
    const started = Date.now();

    drag = { sx: c.x, sy: c.y, ox: c.x - b.x, oy: c.y - b.y, moved: false, t0: started, orig: b, locked };
    drag.timer = setInterval(() => {
      if (!drag || !alive(pet)) return;
      if (Date.now() - started > 60000) { clearInterval(drag.timer); edge?.endDrag(screen.getCursorScreenPoint(),true); drag = null; pet.webContents.send('pet:carry',{active:false}); return; }
      const p = screen.getCursorScreenPoint();
      if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) < 8) return;
      if(!drag.carrying){
        drag.carrying=true;edge?.carry();
        const right=drag.locked?edge.side==='left':point?.facing==='right';
        if(drag.locked){drag.ox=right?155:125;drag.oy=64;}
        else if(Number.isFinite(point?.petTop)&&point.petTop>=0&&point.petTop<=720)drag.oy-=point.petTop-8;
        petH=Math.max(212,petH);
        if(process.platform==='win32')pet.setShape([]);
        pet.webContents.send('pet:carry',{active:true,facing:right?'right':'left'});
      }
      if (!drag.locked && !drag.lifted && Date.now() - started > 350 && Math.hypot(p.x - drag.sx, p.y - drag.sy) >= 24) { drag.lifted = true; mind.touch('lift'); }
      drag.moved = true;
      const next={ x: p.x - drag.ox, y: p.y - drag.oy, width: 280, height: petH };
      pet.setBounds(drag.locked?clampBounds(next):next);
      if (alive(panel) && panel.isVisible()) placePanel();
    }, 16);
  });
  on('pet:up', point => {

    if (!drag) return;
    clearInterval(drag.timer);
    const d = drag;
    drag = null;
    const finishCarry=()=>{
      if(!d.carrying)return;
      const landed=!edge?.locked&&!point?.cancelled;
      if(landed)landingAnchor={y:pet.getBounds().y};
      pet.webContents.send('pet:carry',{active:false,landed});
    };
    if(d.locked){
      const p=screen.getCursorScreenPoint(),cancelled=Boolean(point?.cancelled);
      const clicked=!cancelled&&!d.moved&&Math.hypot(p.x-d.sx,p.y-d.sy)<8;
      edge.endDrag(p,cancelled);
      finishCarry();
      if(!edge.locked)savePosition();
      else if(clicked)clickPet();
      return;
    }
    if(point?.cancelled){pet.setBounds(clampBounds(d.orig));finishCarry();return;}
    const p = screen.getCursorScreenPoint();
    const wobble = Date.now() - d.t0 < 350 && Math.hypot(p.x - d.sx, p.y - d.sy) < 24;
    if ((d.moved||Math.hypot(p.x-d.sx,p.y-d.sy)>=8) && !wobble) {
      const raw={x:p.x-d.ox,y:p.y-d.oy,width:280,height:petH};
      if(edge?.dockFromDrag(raw,screen.getDisplayNearestPoint(p).workArea)){
        finishCarry();
        pet.webContents.send('pet:viewport',workAreaFor(pet.getBounds()));
        if(clickTimer){clearTimeout(clickTimer);clickTimer=null;}
        return;
      }
      pet.setBounds(raw);
      pet.setBounds(clampBounds(pet.getBounds()));
      savePosition();
      if (d.lifted) mind.touch('drop');
    } else {
      if (d.moved) pet.setBounds(d.orig);
      clickPet();
    }
    finishCarry();
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
  roam=new Roam({bounds:()=>pet.getBounds(),area,move:b=>{if(!edge?.locked)move(b);},config:{enabled:readJson('pet-preferences.json',{}).roamEnabled!==false,everySeconds:[30,70],speed:75},notify:s=>send('pet:motion',s)});
  edge=new EdgeHide({roam,bounds:()=>pet.getBounds(),area,move,persist:s=>writeJson('edge-lock.json',s),notify:s=>{send('pet:edge',s);if(process.platform==='win32')pet.setShape(edge.hitRegion());}});
  edge.restore(readJson('edge-lock.json',null));
  wire();
  setupResets();
  system.on('update',s=>send('system',s));
  mind.on('say',s=>{if(edge.active&&['lift','drop'].includes(s.occasion))return;edge.reveal();send('pet:say',s);});
  await pet.loadFile(path.join(__dirname,'ui/pet.html'));
  if(!proof&&resetMonitor.state.notices.some(n=>!n.acknowledgedAt))resetWindow.show();
  send('pet:edge',edge.snapshot());send('pet:viewport',area());
  pet.showInactive();pet.setAlwaysOnTop(true,'screen-saver');system.start();if(!proof)mind.start();
  loop=setInterval(()=>{
    if(!alive(pet)||drag)return;
    const block=paused||(alive(panel)&&panel.isVisible());
    if(edge.active){edge.tick(screen.getCursorScreenPoint(),block);return;}
    if(pending&&Date.now()>pending.until)pending=null;
    if(pending&&!block&&!roam.blocked()){const p=pending;pending=null;if(p.kind==='play')roam.play();else roam.go(home(),'home');}
    roam.tick(screen.getCursorScreenPoint(),block);
  },33);
  const recover=()=>{roam.stop();if(edge.locked)edge.reanchor();else{edge.reveal(true);move(fit(pet.getBounds(),area()));}send('pet:viewport',area());};
  for(const ev of ['display-added','display-removed','display-metrics-changed'])screen.on(ev,recover);
  powerMonitor.on('suspend',()=>{paused=true;recover();});powerMonitor.on('resume',()=>{paused=false;if(resetMonitor.running)resetMonitor.refresh();});
  if(proof)await verify();
}
async function verify(){
  const assert=require('node:assert/strict'),out=path.resolve(proof);fs.mkdirSync(out,{recursive:true});
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  try{
    assert.equal(settings.provider,'disabled');assert.equal(getToken(),'');assert.deepEqual(chat.messages,[]);
    await wait(6000);
    assert(await pet.webContents.executeJavaScript("document.querySelector('#pet-grabbed img').naturalWidth>0"));
    send('pet:carry',{active:true,facing:'left'});await wait(200);
    assert(await pet.webContents.executeJavaScript("document.body.hasAttribute('data-carry')"));
    send('pet:carry',{active:false,landed:true});await wait(1000);
    assert(!(await pet.webContents.executeJavaScript("document.body.hasAttribute('data-carry')")));
    const before=await pet.webContents.executeJavaScript("({ready:document.querySelector('#pet-anim').dataset.pose,rows:[...document.querySelectorAll('#stats .row')].map(e=>e.offsetTop)})");
    assert(before.ready);const b=pet.getBounds(),a=area();assert(edge.dockFromDrag({...b,x:a.x+a.width-b.width+40},a));
    await wait(1400);assert.equal(edge.phase,'hidden');edge.peek();await wait(1800);
    const peek=await pet.webContents.executeJavaScript("({body:getComputedStyle(document.querySelector('#root')).transform,head:getComputedStyle(document.querySelector('#edge-peek')).opacity})");
    assert.equal(peek.body,'matrix(1, 0, 0, 1, 280, 0)');assert.equal(peek.head,'1');
    fs.writeFileSync(path.join(out,'peek.png'),(await pet.webContents.capturePage()).toPNG());
    assert(edge.locked);edge.reveal();assert(edge.locked);
    edge.beginDrag({x:400,y:400});edge.endDrag({x:280,y:400});await wait(1300);assert.equal(edge.phase,'desktop');
    openPanel();await wait(1400);
    const firstRun=await panel.webContents.executeJavaScript("document.body.innerText");assert(firstRun.includes('尚未连接'));assert(!firstRun.includes('Bearer'));
    fs.writeFileSync(path.join(out,'panel.png'),(await panel.webContents.capturePage()).toPNG());
    await panel.webContents.executeJavaScript("document.getElementById('message').value='Synthetic unsent draft';document.getElementById('open-ai-resets').click()");
    await wait(600);const reset=resetWindow.getWindow();assert(reset?.isVisible());assert(panel.isVisible());
    assert.equal(await panel.webContents.executeJavaScript("document.getElementById('message').value"),'Synthetic unsent draft');
    assert.equal(resetMonitor.codex.child,null);assert.equal(resetMonitor.claude.win,null);assert.equal(resetMonitor.running,false);
    await reset.webContents.executeJavaScript("window.resetApi.savePreferences({official:false,codex:false,claude:false})");
    assert.equal(resetMonitor.running,false);
    assert.equal(await reset.webContents.executeJavaScript("getComputedStyle(document.getElementById('account-claude')).borderTopColor"),'rgb(217, 119, 87)');
    await reset.webContents.executeJavaScript("document.getElementById('close').click()");await wait(200);assert(!reset.isVisible());
    resetMonitor.add('synthetic-notice',{provider:'codex',kind:'official',title:'合成测试：官方重置通知',text:'Synthetic test message',source:'Controlled fixture'});
    await wait(300);assert(reset.isVisible());panel.focus();await wait(200);assert(reset.isVisible());
    fs.writeFileSync(path.join(out,'resets.png'),(await reset.webContents.capturePage()).toPNG());
    await reset.webContents.executeJavaScript("document.getElementById('close').click()");await wait(200);assert(!reset.isVisible());
    panel.close();await wait(200);assert(!panel.isVisible());openPanel();await wait(200);
    assert.equal(await panel.webContents.executeJavaScript("document.getElementById('message').value"),'Synthetic unsent draft');
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
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({ok:true,version:app.getVersion(),freshProfile:true,provider:settings.provider,tokenPresent:false,messages:0,peek,checks:['fresh isolated profile','disabled AI and account monitors by default','animated dragon loaded','drag dock and persistent manual lock','head-only peek','inward-drag unlock','first-run settings panel','reset entry next to conversation','opening reminder preserves draft and panel','reset preference IPC works with all sources disabled','orange Claude card','incoming synthetic notice opens persistent popup','focus does not close reminder','manual close acknowledges notice','closing/reopening conversation preserves draft','Ollama loopback fixture via renderer IPC','OpenClaw loopback fixture via renderer IPC','OS-encrypted token not exposed to renderer or settings JSON','disconnect clears credentials and conversation']},null,2));
    app.exit(0);
  }catch(e){fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({ok:false,error:e.stack}));app.exit(1);}
}
if(!app.requestSingleInstanceLock()){app.quit();}
else{
  app.on('second-instance',()=>{if(alive(pet)){edge.reveal();pet.showInactive();}});
  app.whenReady().then(start).catch(e=>{console.error(e.message);app.exit(1);});
  app.on('window-all-closed',()=>{if(!alive(pet))app.quit();});
  app.on('before-quit',()=>{quitting=true;resetWindow?.stop();clearInterval(loop);clearInterval(drag?.timer);clearTimeout(clickTimer);chat?.cancel();system?.stop();if(!proof)mind?.stop();savePosition();});
}
