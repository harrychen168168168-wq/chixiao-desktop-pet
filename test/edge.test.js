const assert=require('node:assert/strict');
const {Roam}=require('../lib/roam'),{EdgeHide}=require('../lib/edge-hide');
function rig(side='right') {
  let time=0,b={x:side==='left'?-1910:-290,y:-700,width:280,height:294},a={x:-1920,y:-1080,width:1920,height:1040};const events=[];
  const common={bounds:()=>b,area:()=>a,move:n=>b=n,now:()=>time,random:()=>0};
  const roam=new Roam({...common,config:{enabled:false},notify:s=>{roam.report({action:s.moving?'walk':'idle'});}});
  roam.report({action:'idle',blocked:false,canWalk:true,hovering:false});
  const edge=new EdgeHide({...common,roam,notify:s=>events.push(s)});
  const tick=(ms=33,paused=false)=>{time+=ms;edge.tick({x:-1000,y:0},paused);};
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
test('a real new blocker after release still restores the dragon',()=>{
  const t=rig();assert(t.edge.dockFromDrag({...t.b,x:-200}));
  t.tick(250);t.roam.report({blocked:true});t.tick();t.until('desktop');
});
console.log(count+' edge lifecycle checks passed');
