(function(root) {
  const fit=(b,a)=>({...b,x:Math.max(a.x,Math.min(b.x,a.x+Math.max(0,a.width-b.width))),y:Math.max(a.y,Math.min(b.y,a.y+Math.max(0,a.height-b.height)))});
  const key=a=>[a.x,a.y,a.width,a.height].join(',');
  const dragSide=(b,a)=>b.x<=a.x-36?'left':b.x+b.width>=a.x+a.width+36?'right':null;
  class EdgeHide {
    constructor({roam,bounds,area,move,notify=()=>{},now=Date.now,random=Math.random}) {
      Object.assign(this,{roam,bounds,area,move,notify,now,random});this.phase='desktop';
    }
    get active(){return this.phase!=='desktop';}
    get tucked(){return ['tucking','hidden','peeking','returning'].includes(this.phase);}
    enter(phase,extra={}){this.phase=phase;this.since=this.now();this.notify({phase,side:this.side,...extra});}
    request(side) {
      if(this.active)return false;
      const b=this.bounds(),a=this.area();if(a.width<b.width||a.height<b.height)return false;
      this.side=['left','right'].includes(side)?side:(b.x+b.width/2<a.x+a.width/2?'left':'right');
      this.origin=fit(b,a);this.areaKey=key(a);this.roam.stop();this.enter('waiting');return true;
    }
    dockFromDrag(raw,area=this.area()) {
      const side=dragSide(raw,area);
      if(this.active||!side||area.width<raw.width||area.height<raw.height)return false;
      this.side=side;this.areaKey=key(area);this.roam.stop();
      const anchor=fit({...raw,x:side==='left'?area.x:area.x+area.width-raw.width},area);
      this.move(anchor);this.ignoreBlockUntil=this.now()+200;
      this.enter('tucking',{fromDrag:true,offset:Math.max(-raw.width,Math.min(raw.width,raw.x-anchor.x))});
      return true;
    }
    schedulePeek(){this.nextPeek=this.now()+(12+this.random()*14)*1000;}
    peek() {if(this.phase!=='hidden')return false;this.enter('peeking');return true;}
    reveal(immediate=false) {
      if(!this.active)return false;
      this.roam.stop();
      if(immediate||!this.tucked){this.move(fit(this.bounds(),this.area()));this.enter('desktop');return true;}
      if(this.phase==='returning')return true;
      this.from=this.bounds();const a=this.area(),b=this.from;
      const inset=Math.min(110,Math.max(0,(a.width-b.width)/2));
      this.to=fit({...b,x:b.x+(this.side==='right'?-inset:inset)},a);
      this.enter('returning');return true;
    }
    hitRegion() {
      const b=this.bounds(),w=this.phase==='hidden'?38:this.phase==='peeking'?122:b.width;
      if(!['hidden','peeking'].includes(this.phase))return [];
      return [{x:this.side==='left'?0:b.width-w,y:this.phase==='hidden'?115:0,width:w,height:this.phase==='hidden'?82:Math.min(212,b.height)}];
    }
    tick(cursor,paused=false) {
      if(!this.active)return;
      const now=this.now(),a=this.area(),s=this.roam.state;
      if(key(a)!==this.areaKey){this.reveal(true);return;}
      if(this.phase==='returning') {
        const t=Math.min(1,(now-this.since)/1000),ease=1-(1-t)**3;
        this.move(fit({...this.bounds(),x:Math.round(this.from.x+(this.to.x-this.from.x)*ease)},a));
        if(t===1){this.enter('desktop');this.roam.later();}return;
      }
      if(paused){this.reveal(true);return;}
      if(s.blocked&&now>=(this.ignoreBlockUntil||0)){if(this.phase!=='waiting'||now-this.since>20000)this.reveal();return;}
      if(this.phase==='waiting') {
        if(now-this.since>20000){this.reveal(true);return;}
        if(this.roam.blocked())return;
        const b=this.bounds();this.roam.go({x:this.side==='left'?a.x:a.x+a.width-b.width,y:b.y},'edge');
        this.enter('approach');return;
      }
      if(this.phase==='approach') {
        if(s.hovering){this.reveal(true);return;}
        if(this.roam.trip){this.roam.tick(cursor);return;}
        if(s.action!=='idle')return; // finish the last planted step before turning inward
        const b=this.bounds();this.move(fit({...b,x:this.side==='left'?a.x:a.x+a.width-b.width},a));
        this.enter('tucking');return;
      }
      if(this.phase==='tucking'&&now-this.since>=1100){this.enter('hidden');this.schedulePeek();return;}
      if(this.phase==='hidden'&&now>=this.nextPeek){this.peek();return;}
      if(this.phase==='peeking'&&now-this.since>=4300&&!s.hovering&&s.action==='idle')this.enter('tucking');
    }
  }
  const api={EdgeHide,fit,dragSide};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DeskEdge=api;
})(typeof window==='undefined'?globalThis:window);
