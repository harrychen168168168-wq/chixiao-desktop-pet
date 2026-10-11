const assert=require('node:assert/strict');
const {Roam}=require('../lib/roam'),{EdgeHide}=require('../lib/edge-hide');
function rig(side='right') {
  let time=0,b={x:side==='left'?-1910:-290,y:-700,width:280,height:294},a={x:-1920,y:-1080,width:1920,height:1040};const events=[];
  const common={bounds:()=>b,area:()=>a,move:n=>b=n,now:()=>time,random:()=>0};
  const roam=new Roam({...common,config:{enabled:false},notify:s=>{roam.report({action:s.moving?'walk':'idle'});}});
  roam.report({action:'idle',blocked:false,canWalk:true,hovering:false});
  const edge=new EdgeHide({...common,roam,notify:s=>events.push(s)});
  const tick=(ms=33,paused=false,cursor={x:-1000,y:0})=>{time+=ms;edge.tick(cursor,paused);};
  const until=phase=>{for(let n=0;edge.phase!==phase&&n<2500;n++)tick();assert.equal(edge.phase,phase);};
  return {edge,roam,events,tick,until,get b(){return b;},set area(v){a=v;}};
}
let count=0;const test=(name,fn)=>{fn();console.log('OK '+name);count++;};
test('both edges tuck inside a negative-origin monitor, then peek and retreat repeatedly',()=>{
  for(const side of ['left','right']){const t=rig(side);assert(t.edge.request(side));t.until('hidden');
    assert.equal(t.b.x,side==='left'?-1920:-280);assert(t.edge.hitRegion()[0].width<40);
    t.tick(11900);assert.equal(t.edge.phase,'hidden');t.tick(150);assert.equal(t.edge.phase,'peeking');
    t.roam.report({hovering:true});t.tick(5000);assert.equal(t.edge.phase,'peeking');
    t.roam.report({hovering:false});t.tick();t.until('hidden');t.tick(12100);assert.equal(t.edge.phase,'peeking');
  }
});
test('recall from every phase is repeat-safe and restores full hit region',()=>{
  for(const phase of ['waiting','approach','tucking','hidden','peeking']){const t=rig();t.edge.request();
    if(phase==='peeking'){t.until('hidden');t.edge.peek();}else if(phase!=='waiting')t.until(phase);
    t.edge.reveal();t.edge.reveal();t.until('desktop');assert.deepEqual(t.edge.hitRegion(),[]);assert(t.b.x+t.b.width<=0);
  }
});
test('chat/news interrupts hiding; paused desktop and monitor changes recover immediately',()=>{
  for(const why of ['news','paused','screen']){const t=rig();t.edge.request();t.until('hidden');
    if(why==='news')t.roam.report({blocked:true});
    if(why==='screen')t.area={x:0,y:0,width:1280,height:720};
    t.tick(33,why==='paused');t.until('desktop');assert.deepEqual(t.edge.hitRegion(),[]);
    if(why==='screen')assert(t.b.x>=0&&t.b.y>=0);
  }
});
test('waits for the body to finish and never replaces a landing with a teleport',()=>{
  const t=rig();t.roam.report({action:'stretch'});t.edge.request();t.tick(3000);assert.equal(t.edge.phase,'waiting');
  t.roam.report({action:'idle'});t.until('approach');t.roam.report({action:'walk'});t.tick();assert.equal(t.edge.phase,'approach');
  t.roam.report({action:'idle'});t.until('hidden');
});
test('dragging 36px into either side hides directly despite hover and disabled roaming',()=>{
  for(const side of ['left','right']){
    const t=rig(side);t.roam.report({hovering:true,blocked:true});
    assert.equal(t.edge.dockFromDrag({...t.b,x:side==='left'?-1955:-245}),false);
    assert(t.edge.dockFromDrag({...t.b,x:side==='left'?-1956:-244}));
    assert.equal(t.edge.phase,'tucking');assert.equal(t.events.at(-1).fromDrag,true);
    assert.equal(t.events.at(-1).offset,side==='left'?-36:36);
    t.tick(100);assert.equal(t.edge.phase,'tucking');
    t.roam.report({blocked:false});t.until('hidden');assert.equal(t.edge.side,side);
    assert.equal(t.b.x,side==='left'?-1920:-280);
  }
});
test('a new blocker after manual release cannot unlock the dragon',()=>{
  const t=rig();assert(t.edge.dockFromDrag({...t.b,x:-200}));
  t.tick(250);t.roam.report({blocked:true});t.tick();t.until('hidden');assert(t.edge.locked);
});
test('manual lock survives hover, pause, commands and alerts interrupt random peeks',()=>{
  for(const side of ['left','right']){
    const t=rig(side);t.edge.dockFromDrag({...t.b,x:side==='left'?-1960:-240});t.until('hidden');
    const anchor={...t.b};t.edge.peek();t.edge.setAlert(true,150);assert.equal(t.edge.phase,'alert-peek');
    t.roam.report({blocked:true,hovering:true,action:'roar'});t.tick(60000,true);
    assert.equal(t.edge.phase,'alert-peek');assert.equal(t.edge.reveal(true),false);assert.deepEqual(t.b,anchor);
    assert.equal(t.edge.hitRegion().length,3);t.edge.setAlert(false);t.until('hidden');
    t.edge.peek();t.tick(4400);t.until('hidden');assert(t.edge.locked);
  }
});
test('only an inward 96 DIP released drag unlocks, click/cancel/short/outward do not',()=>{
  for(const side of ['left','right'])for(const distance of [0,95,96,-180,180])for(const cancel of [false,true]){
    const t=rig(side);t.edge.dockFromDrag({...t.b,x:side==='left'?-1960:-240});t.until('hidden');
    const start={x:side==='left'?-1910:-10,y:-500};t.edge.beginDrag(start);
    t.edge.setAlert(true,80);assert.equal(t.edge.phase,'dragging');
    t.edge.endDrag({x:start.x+distance*(side==='left'?1:-1),y:start.y},cancel);
    assert.equal(t.edge.locked,cancel||distance<96);
    assert.equal(t.edge.phase,cancel||distance<96?'alert-peek':'desktop');
  }
});
test('saved locks restore, migrate displays and clamp work-area changes without unlocking',()=>{
  for(const side of ['left','right'])for(const a of [{x:0,y:40,width:1280,height:680},{x:-2560,y:-1440,width:2560,height:1400},{x:40,y:0,width:1240,height:720}]){
    const t=rig(side);let saved;t.edge.persist=s=>saved=s;
    t.edge.dockFromDrag({...t.b,x:side==='left'?-1960:-240});assert(saved.locked);
    const restored=rig(side);restored.area=a;assert(restored.edge.restore(JSON.parse(JSON.stringify(saved))));
    assert.equal(restored.edge.phase,'hidden');assert(restored.edge.locked);restored.tick(600,true);
    assert.equal(restored.b.x,side==='left'?a.x:a.x+a.width-restored.b.width);
    assert(restored.b.y>=a.y&&restored.b.y+restored.b.height<=a.y+a.height);
  }
});
test('hover cloud opens head on both sides, stays clickable, leaves and re-enters without unlocking',()=>{
  for(const side of ['left','right'])for(const locked of [false,true]){
    const t=rig(side);
    if(locked)t.edge.dockFromDrag({...t.b,x:side==='left'?-1960:-240});else t.edge.request(side);
    t.until('hidden');const anchor={...t.b};
    const cloud={x:t.b.x+(side==='left'?15:265),y:t.b.y+155};
    const head={x:t.b.x+(side==='left'?70:210),y:t.b.y+80};
    t.tick(33,locked,cloud);assert.equal(t.edge.phase,'peeking');
    t.tick(6000,locked,head);assert.equal(t.edge.phase,'peeking');assert.deepEqual(t.b,anchor);
    t.tick();t.tick(100,locked,head);assert.equal(t.edge.phase,'peeking');
    if(locked){t.edge.beginDrag(head);t.edge.endDrag(head);assert.equal(t.edge.phase,'peeking');}
    t.tick();t.tick(170);assert.equal(t.edge.phase,'tucking');
    t.tick(33,locked,cloud);assert.equal(t.edge.phase,'peeking');
    t.tick();t.tick(170);t.until('hidden');assert.equal(t.edge.locked,locked);
    t.tick(12100);assert.equal(t.edge.phase,'peeking');
  }
});
test('alerts take precedence over hover withdrawal and cancelled head drags keep lock',()=>{
  const t=rig();t.edge.dockFromDrag({...t.b,x:-240});t.until('hidden');
  const cloud={x:t.b.x+265,y:t.b.y+155};t.tick(33,false,cloud);
  t.edge.setAlert(true,150);t.tick(6000);assert.equal(t.edge.phase,'alert-peek');
  t.edge.setAlert(false);t.until('hidden');t.tick(33,false,cloud);
  t.edge.beginDrag(cloud);t.edge.endDrag(cloud,true);t.until('hidden');assert(t.edge.locked);
});
test('carried body expands the native region and releases without jumping back to the old grip',()=>{
  for(const side of ['left','right']){
    const t=rig(side);t.edge.dockFromDrag({...t.b,x:side==='left'?-1960:-240});t.until('hidden');
    t.edge.beginDrag({x:0,y:0});t.edge.carry();assert.deepEqual(t.edge.hitRegion(),[]);
    const carried={...t.b,x:side==='left'?-1600:-600,y:-500};t.edge.move(carried);
    t.edge.endDrag({x:side==='left'?190:-190,y:30});assert(!t.edge.locked);assert.deepEqual(t.b,carried);
  }
});
console.log(count+' edge lifecycle checks passed');
