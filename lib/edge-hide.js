(function(root) {
  const fit=(b,a)=>({...b,x:Math.max(a.x,Math.min(b.x,a.x+Math.max(0,a.width-b.width))),y:Math.max(a.y,Math.min(b.y,a.y+Math.max(0,a.height-b.height)))});
  const key=a=>[a.x,a.y,a.width,a.height].join(',');
  const dragSide=(b,a)=>b.x<=a.x-36?'left':b.x+b.width>=a.x+a.width+36?'right':null;
  class EdgeHide {
    constructor({roam,bounds,area,move,notify=()=>{},persist=()=>{},now=Date.now,random=Math.random}) {
      Object.assign(this,{roam,bounds,area,move,notify,persist,now,random});this.phase='desktop';
      this.locked=false;this.alertVisible=false;this.bubbleHeight=0;
    }
    get active(){return this.phase!=='desktop';}
    get tucked(){return ['tucking','hidden','peeking','alert-peek','dragging','returning'].includes(this.phase);}
    snapshot(){return {phase:this.phase,side:this.side,locked:this.locked};}
    enter(phase,extra={}){if(phase!=='peeking'){this.hoverPeek=false;this.hoverLeftAt=null;}this.phase=phase;this.since=this.now();this.notify({...this.snapshot(),...extra});}
    save(){this.persist(this.locked?{locked:true,side:this.side,bottom:this.dockBottom,area:this.area()}:null);}
    restore(saved) {
      if(!saved?.locked||!['left','right'].includes(saved.side)||!Number.isFinite(saved.bottom))return false;
      this.locked=true;this.side=saved.side;this.dockBottom=saved.bottom;this.roam.stop();
      this.reanchor();this.enter('hidden');this.schedulePeek();return true;
    }
    reanchor(area=this.area()) {
      if(!this.locked)return false;
      const b=this.bounds();this.areaKey=key(area);
      this.move(fit({...b,x:this.side==='left'?area.x:area.x+area.width-b.width,y:this.dockBottom-b.height},area));
      return true;
    }
    setAlert(visible,height=0) {
      this.alertVisible=Boolean(visible);this.bubbleHeight=Math.max(0,Number(height)||0);
      if(!this.locked||this.phase==='dragging')return;
      if(this.alertVisible&&this.phase!=='alert-peek')this.enter('alert-peek');
      else if(!this.alertVisible&&this.phase==='alert-peek')this.enter('tucking');
    }
    beginDrag(point) {
      if(!this.locked)return false;
      this.dragPhase=this.phase;this.dragStart={...point};this.dragAnchor={...this.bounds()};this.dragArea={...this.area()};this.roam.stop();this.enter('dragging');return true;
    }
    carry() {
      if(this.phase!=='dragging'||!this.locked)return false;
      this.carried=true;return true;
    }
    endDrag(point,cancelled=false) {
      if(!this.locked||this.phase!=='dragging')return false;
      const dx=point.x-this.dragStart.x,dy=point.y-this.dragStart.y;
      const inward=dx*(this.side==='left'?1:-1);
      if(!cancelled&&inward>=96) {
        this.locked=false;
        const b=this.bounds();this.move(fit(this.carried?b:{...b,x:this.dragAnchor.x+dx,y:this.dragAnchor.y+dy},this.area()));
        this.save();this.enter('desktop');this.roam.later();
      } else {
        this.reanchor(this.dragArea);
        this.enter(this.alertVisible?'alert-peek':!cancelled&&Math.hypot(dx,dy)<8&&this.dragPhase==='peeking'?'peeking':'tucking');
        if(this.phase==='peeking')this.hover(point);
      }
      this.carried=false;this.dragStart=null;return true;
    }
    request(side) {
      if(this.active)return false;
      const b=this.bounds(),a=this.area();if(a.width<b.width||a.height<b.height)return false;
      this.side=['left','right'].includes(side)?side:(b.x+b.width/2<a.x+a.width/2?'left':'right');
      this.origin=fit(b,a);this.areaKey=key(a);this.roam.stop();this.enter('waiting');return true;
    }
    dockFromDrag(raw,area=this.area()) {
      const side=dragSide(raw,area);
      if(this.active||!side||area.width<raw.width||area.height<raw.height)return false;
      this.side=side;this.locked=true;this.dockBottom=raw.y+raw.height;this.areaKey=key(area);this.roam.stop();
      const anchor=fit({...raw,x:side==='left'?area.x:area.x+area.width-raw.width},area);
      this.move(anchor);this.ignoreBlockUntil=this.now()+200;
      this.enter('tucking',{fromDrag:true,offset:Math.max(-raw.width,Math.min(raw.width,raw.x-anchor.x))});
      this.save();if(this.alertVisible)this.enter('alert-peek');
      return true;
    }
    schedulePeek(){this.nextPeek=this.now()+(12+this.random()*14)*1000;}
    peek() {if(this.phase!=='hidden')return false;this.enter('peeking');return true;}
    hover(cursor) {
      if(!['hidden','tucking','peeking'].includes(this.phase))return false;
      const b=this.bounds(),x=cursor.x-b.x,y=cursor.y-b.y;
      const regions=this.phase==='tucking'
        ? [{x:this.side==='left'?0:b.width-38,y:119,width:38,height:74}]
        : this.hitRegion();
      const inside=regions.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height);
      if(inside) {
        this.hoverPeek=true;this.hoverLeftAt=null;
        if(this.phase!=='peeking')this.enter('peeking');
        return true;
      }
      if(!this.hoverPeek)return false;
      this.hoverLeftAt??=this.now();
      if(this.now()-this.hoverLeftAt>=160)this.enter('tucking');
      return true;
    }
    reveal(immediate=false) {
      if(this.locked)return false; // Only endDrag may release a manual lock.
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
      if(this.phase==='dragging'&&this.carried)return [];
      if(this.locked) {
        const b=this.bounds(),alert=this.alertVisible&&['alert-peek','dragging'].includes(this.phase);
        const top=alert?this.bubbleHeight+20:22;
        const regions=[{x:this.side==='left'?0:b.width-38,y:Math.min(b.height-74,top+97),width:38,height:74}];
        if(['tucking','peeking','alert-peek','dragging'].includes(this.phase))regions.push({x:this.side==='left'?0:b.width-122,y:top,width:122,height:120});
        if(alert)regions.push({x:6,y:4,width:b.width-12,height:this.bubbleHeight+12});
        return regions.map(r=>({...r,y:Math.max(0,r.y),height:Math.max(1,Math.min(r.height,b.height-Math.max(0,r.y)))}));
      }
      const b=this.bounds(),w=this.phase==='hidden'?38:this.phase==='peeking'?122:b.width;
      if(!['hidden','peeking'].includes(this.phase))return [];
      return [{x:this.side==='left'?0:b.width-w,y:this.phase==='hidden'?115:0,width:w,height:this.phase==='hidden'?82:Math.min(212,b.height)}];
    }
    tick(cursor,paused=false) {
      if(!this.active)return;
      const now=this.now(),a=this.area(),s=this.roam.state;
      if(this.locked) {
        if(this.phase==='dragging')return;
        if(key(a)!==this.areaKey){this.reanchor(a);this.save();}
        if(this.alertVisible){if(this.phase!=='alert-peek')this.enter('alert-peek');return;}
        if(this.phase==='alert-peek'){this.enter('tucking');return;}
        if(this.hover(cursor))return;
        if(this.phase==='tucking'&&now-this.since>=1100){this.enter('hidden');this.schedulePeek();return;}
        if(this.phase==='hidden'&&!paused&&now>=this.nextPeek){this.peek();return;}
        if(this.phase==='peeking'&&now-this.since>=4300)this.enter('tucking');
        return; // Hover, speech, pause and animation never unlock or drive Roam.
      }
      if(key(a)!==this.areaKey){this.reveal(true);return;}
      if(this.phase==='returning') {
        const t=Math.min(1,(now-this.since)/1000),ease=1-(1-t)**3;
        this.move(fit({...this.bounds(),x:Math.round(this.from.x+(this.to.x-this.from.x)*ease)},a));
        if(t===1){this.enter('desktop');this.roam.later();}return;
      }
      if(paused){this.reveal(true);return;}
      if(s.blocked&&now>=(this.ignoreBlockUntil||0)){if(this.phase!=='waiting'||now-this.since>20000)this.reveal();return;}
      if(this.hover(cursor))return;
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
