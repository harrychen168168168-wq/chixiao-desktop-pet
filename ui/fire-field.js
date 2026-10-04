(function(root){
  const clamp=(x,lo=0,hi=1)=>Math.max(lo,Math.min(hi,x));
  const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
  const noiseTable=new Float32Array(64*64);
  let seed=7291;
  for(let i=0;i<noiseTable.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;noiseTable[i]=seed/4294967296;}
  function noise(x,y){
    const ix=Math.floor(x),iy=Math.floor(y),fx=smooth(x-ix),fy=smooth(y-iy);
    const a=noiseTable[(iy&63)*64+(ix&63)],b=noiseTable[(iy&63)*64+((ix+1)&63)];
    const c=noiseTable[((iy+1)&63)*64+(ix&63)],d=noiseTable[((iy+1)&63)*64+((ix+1)&63)];
    return a+(b-a)*fx+(c+(d-c)*fx-a-(b-a)*fx)*fy;
  }
  class Field {
    constructor({x,y,width,height,scale=1.5,kind='body'}){
      Object.assign(this,{x,y,width,height,scale,kind});
      this.w=Math.ceil(width/scale);this.h=Math.ceil(height/scale);
      this.fuel=new Float32Array(this.w*this.h);this.next=new Float32Array(this.fuel.length);
      this.pixels=new Uint8ClampedArray(this.fuel.length*4);this.energy=0;
    }
    reset(){this.fuel.fill(0);this.next.fill(0);this.pixels.fill(0);this.energy=0;}
    sample(x,y){
      if(x<0||y<0||x>=this.w-1||y>=this.h-1)return 0;
      const ix=x|0,iy=y|0,fx=x-ix,fy=y-iy,i=iy*this.w+ix,a=this.fuel[i],b=this.fuel[i+1],c=this.fuel[i+this.w],d=this.fuel[i+this.w+1];
      return a+(b-a)*fx+(c+(d-c)*fx-a-(b-a)*fx)*fy;
    }
    step(dt,time,sources,jet,heat){
      dt=clamp(dt,.005,.06);
      this.time=time;
      const jetMode=this.kind==='jet',cos=Math.cos(jet?.angle||0),sin=Math.sin(jet?.angle||0);
      const speed=102+heat*24;
      let energy=0;
      for(let gy=1;gy<this.h-1;gy++)for(let gx=1;gx<this.w-1;gx++){
        const x=this.x+gx*this.scale,y=this.y+gy*this.scale,n=noise(x*.075,y*.075-time*2.6);
        let vx=(n-.5)*62+(noise(x*.16+19,y*.15+time*2.2)-.5)*22+Math.sin(y*.16+time*4.7)*11;
        let vy=-(48+heat*26)+(noise(x*.095+13,y*.06-time*1.9)-.5)*34;
        if(jetMode){
          const rx=x-(jet?.x||45),ry=y-(jet?.y||70),along=rx*cos+ry*sin,perp=-rx*sin+ry*cos;
          const spread=clamp(perp*3.5*clamp(along/14),-23,23);
          vx=cos*speed-sin*spread+(n-.5)*30;
          vy=sin*speed+cos*spread-8+(noise(x*.13+11,y*.12-time*3.8)-.5)*24;
        }
        const sourceX=gx-vx*dt/this.scale,sourceY=gy-vy*dt/this.scale;
        const burn=jetMode?2.05:1.35;
        const breakup=noise(x*.21+31,y*.19-time*4.1);
        const value=Math.max(0,this.sample(sourceX,sourceY)-dt*Math.max(.35,burn+(breakup-.5)*2.4));
        this.next[gy*this.w+gx]=value;energy+=value;
      }
      [this.fuel,this.next]=[this.next,this.fuel];this.next.fill(0);
      for(let s=0;s<sources.length;s++){
        const a=sources[s],radius=a.radius||2.5,r=radius/this.scale,cx=(a.x-this.x)/this.scale,cy=(a.y-this.y)/this.scale;
        const pulse=(jetMode?.72:.5)+(jetMode?.28:.5)*noise(s*7.3+time*5.7,time*3.2+s*11);
        for(let gy=Math.max(1,Math.floor(cy-r*2.7));gy<Math.min(this.h-1,Math.ceil(cy+r*2.7));gy++)
          for(let gx=Math.max(1,Math.floor(cx-r*2.7));gx<Math.min(this.w-1,Math.ceil(cx+r*2.7));gx++){
            const d=((gx-cx)**2+(gy-cy)**2)/(r*r),i=gy*this.w+gx;
            const flame=a.amount*pulse*Math.exp(-d*1.3);
            this.fuel[i]=Math.max(this.fuel[i],flame);
          }
      }
      this.energy=energy;
    }
    shade(opacity){
      for(let i=0;i<this.fuel.length;i++){
        const gx=i%this.w,gy=Math.floor(i/this.w),p=i*4;
        const grain=noise((this.x+gx*this.scale)*.22+(this.time||0)*1.7,(this.y+gy*this.scale)*.21-(this.time||0)*6.8);
        const value=Math.max(0,this.fuel[i]-.14*(1-grain));
        if(value<.045){this.pixels[p+3]=0;continue;}
        const gold=smooth((value-.15)/.75);
        this.pixels[p]=Math.round(219+36*gold);
        this.pixels[p+1]=Math.round(48+185*gold);
        this.pixels[p+2]=Math.round(9+126*Math.pow(gold,2));
        this.pixels[p+3]=Math.round(255*opacity*smooth((value-.045)/.7));
      }
      return this.pixels;
    }
  }
  const api={Field};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FireField=api;
})(typeof window==='undefined'?globalThis:window);
