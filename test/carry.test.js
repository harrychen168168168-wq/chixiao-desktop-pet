const assert=require('node:assert/strict');
const {CarryMotion}=require('../ui/carry-motion');
let count=0;
for(const releaseAt of [30,120,300,570,650,1400,3100]){
  let now=0;const m=new CarryMotion(()=>now);assert.equal(m.start().frame,0);
  for(now=16;now<releaseAt;now+=16)m.sample();now=releaseAt;
  const before=m.sample();const released=m.release();assert.equal(released.frame,before.frame);
  let previous=released.frame;const target=m.to;
  for(let i=0;i<90&&m.phase!=='idle';i++){
    now+=16;const s=m.sample();assert(Math.abs(s.frame-previous)<=3);
    assert(target===0?s.frame<=previous:s.frame>=previous);previous=s.frame;
  }
  assert.equal(m.phase,'idle');assert.equal(previous,target);count++;
}
for(const regrabAt of [50,180,420,680]){
  let now=0;const m=new CarryMotion(()=>now);m.start();now=700;m.sample();m.release();
  now+=regrabAt;const before=m.sample();assert.equal(m.start().frame,before.frame);
  now+=700;assert.equal(m.sample().phase,'held');count++;
}
console.log(count+' continuous lift/early-release/regrab checks passed');
