(function(root){
  const ease=t=>t*t*(3-2*t);
  class CarryMotion {
    constructor(now=()=>performance.now()){this.now=now;this.phase='idle';this.frame=0;}
    start(){
      const pose=this.sample();
      this.from=pose.phase==='idle'?0:pose.frame;this.to=32;this.at=this.now();
      this.duration=Math.max(160,Math.abs(32-this.from)*18);
      this.phase='lifting';return this.sample();
    }
    release(){
      const pose=this.sample();
      if(this.phase==='idle')return pose;
      this.from=pose.frame;
      this.to=this.phase==='lifting'&&this.from<30?0:64;
      this.at=this.now();this.duration=Math.max(220,Math.abs(this.to-this.from)*24);
      this.phase='landing';return this.sample();
    }
    cancel(){this.phase='idle';this.frame=0;}
    sample(){
      const now=this.now();
      if(this.phase==='held'){
        this.frame=Math.round(31+Math.cos((now-this.at)*Math.PI/900));
      }else if(this.phase==='lifting'||this.phase==='landing'){
        const t=Math.min(1,Math.max(0,(now-this.at)/this.duration));
        this.frame=Math.round(this.from+(this.to-this.from)*ease(t));
        if(t===1){
          if(this.phase==='lifting'){this.phase='held';this.at=now;}
          else {this.phase='idle';return {phase:'idle',frame:this.frame,done:true};}
        }
      }
      return {phase:this.phase,frame:this.frame,done:false};
    }
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={CarryMotion};else root.CarryMotion=CarryMotion;
})(typeof window==='undefined'?globalThis:window);
