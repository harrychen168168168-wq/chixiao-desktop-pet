(function (root) {
  const clamp = (x) => Math.min(1, Math.max(0, x));
  const valid = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  const ramp = (x, lo, hi) => valid(x) ? clamp((x - lo) / (hi - lo)) : 0;
  function tempColor(kind, value) {
    const heat = ramp(value, kind === 'CPU' ? 60 : 50, kind === 'CPU' ? 100 : 90);
    const brown = [61, 43, 22], gold = [191, 135, 0], red = [201, 30, 17];
    const a = heat <= .55 ? brown : gold, b = heat <= .55 ? gold : red;
    const f = heat <= .55 ? heat / .55 : (heat - .55) / .45;
    return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * f)).join(', ')})`;
  }
  function readings(s) {
    const ratio = (x) => x && valid(x.usedGB) && valid(x.totalGB) && x.totalGB > 0 ? x.usedGB / x.totalGB : null;
    const ram = ratio(s?.ram), vram = ratio(s?.vram);
    return {
      heat: Math.max(ramp(s?.gpuTemp, 50, 90), ramp(s?.cpuTemp, 60, 100)),
      ram: ramp(ram, .65, .97), vram: ramp(vram, .65, .97),
      ramPct: ram == null ? null : ram * 100, vramPct: vram == null ? null : vram * 100,
    };
  }
  function combinedMode(values, previous = false) {
    return ['heat','ram','vram'].every(k => valid(values?.[k]) && values[k] >= (previous ? .35 : .45));
  }
  const jawTrack = [
    [16,43,100,-3.06], [20,44,84,-2.96], [24,44,69,-2.85],
    [28,45,61,-2.74], [32,46,62,-2.74], [36,48,65,-2.79],
    [40,47,82,-2.92], [44,44,94,-3.03],
  ];
  function breathPose(pose, frame, cue) {
    const start=cue?.start??22,end=cue?.end??34,track=cue?.track||jawTrack;
    if(pose!=='roar' || !Number.isFinite(frame) || frame<=start || frame>=end) return null;
    const next=track.findIndex(p=>p[0]>=frame);
    if(next<1)return null;
    const a=track[next-1], b=track[next];
    const mix=(frame-a[0])/(b[0]-a[0]), phase=(frame-start)/(end-start);
    return {x:a[1]+(b[1]-a[1])*mix,y:a[2]+(b[2]-a[2])*mix,angle:a[3]+(b[3]-a[3])*mix,
      strength:Math.pow(Math.sin(phase*Math.PI),1.15),phase};
  }
  class Reactions {
    constructor(now = () => Date.now()) { this.now = now; this.level = { heat: 0, ram: 0, vram: 0 }; this.pending = {}; this.last = -Infinity; this.combined = false; }
    update(values) {
      this.updatedAt = this.now();
      const wasCombined=this.combined;
      this.combined=combinedMode(values,wasCombined);
      for (const kind of ['heat', 'ram', 'vram']) {
        const v = values[kind], old = this.level[kind];
        const next = v >= .78 ? 2 : v >= .45 ? 1 : 0;
        const level = next < old && v > (old === 2 ? .68 : .35) ? old : next;
        this.level[kind] = level;
        if (level > old) this.pending[kind] = { kind, level, at: this.now() };
        if (level === 0) delete this.pending[kind];
      }
      if(this.combined) {
        const entry=this.pending.combined;
        this.pending=entry?{combined:entry}:{};
        if(!wasCombined)this.pending.combined={kind:'combined',level:2,at:this.now()};
      } else if(wasCombined) {
        this.pending={};
        for(const [kind,level] of Object.entries(this.level))if(level)this.pending[kind]={kind,level,at:this.now()};
      }
    }
    take(blocked) {
      const now = this.now();
      if (this.updatedAt == null || now - this.updatedAt > 15000) { this.pending = {}; return null; }
      for (const [kind, p] of Object.entries(this.pending)) if (now - p.at > 45000) delete this.pending[kind];
      if (blocked || now - this.last < 20000) return null;
      if(this.combined) {
        const entry=this.pending.combined;
        if(!entry && now-this.last<40000)return null;
        this.pending={};this.last=now;this.lastKind='combined';
        return {kind:'combined',level:2,at:now,action:'guard',recurring:!entry};
      }
      let next = Object.values(this.pending).sort((a, b) => b.level - a.level || a.at - b.at)[0];
      if (!next) {
        const held = Object.entries(this.level).filter(([, level]) => level > 0).map(([kind, level]) => ({ kind, level, at: now }));
        const period = held.some(p => p.level === 2) ? 32000 : 45000;
        if (!held.length || now - this.last < period) return null;
        const index = held.findIndex(p => p.kind === this.lastKind);
        next = { ...held[(index + 1) % held.length], recurring: true };
      }
      if (!next) return null;
      delete this.pending[next.kind]; this.last = now; this.lastKind = next.kind;
      return { ...next, action: next.kind === 'heat' ? (next.level === 2 ? 'roar' : 'stretch') : next.kind === 'ram' ? 'think' : 'stretch' };
    }
    performed(action) {
      if(action==='guard' && this.combined) {this.pending={};this.last=this.now();this.lastKind='combined';return;}
      if(this.combined)return;
      const kind=Object.keys(this.level).find(k=>this.level[k]>0 && action===(k==='heat'?(this.level[k]===2?'roar':'stretch'):k==='ram'?'think':'stretch'));
      if(!kind)return;
      delete this.pending[kind];this.last=this.now();this.lastKind=kind;
    }
  }
  class Renderer {
    constructor({ dragon, fire, cloud, source, pose, inscriptions, frame = () => 0, muted = () => false }) {
      Object.assign(this, { dragon, fire, cloud, source, pose, inscriptions, frame, muted });
      this.target = { heat: 0, ram: 0, vram: 0 }; this.value = { ...this.target };
      this.combinedActive=false;this.combined=0;
      this.lastUpdate = 0; this.lastFrame = 0;
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
      this.dragon.width = 281; this.dragon.height = 256; this.cloud.width = 260; this.cloud.height = 142;
      this.fire.width = 361; this.fire.height = 336;
      this.layer = document.createElement('canvas'); this.layer.width = 281; this.layer.height = 256;
      this.layerCtx = this.layer.getContext('2d');
      this.cloudArt = new Image(); this.cloudArt.src = 'assets/cloud-platform-v1.png';
      this.guardianArt = new Image(); this.guardianArt.src = 'assets/cloud-guardian-v1.png';
      this.guardianLayer=document.createElement('canvas');this.guardianLayer.width=281;this.guardianLayer.height=256;
      this.guardianCtx=this.guardianLayer.getContext('2d',{willReadFrequently:true});
      this.fireCtx = fire.getContext('2d');
      this.bodyField = new root.FireField.Field({x:84,y:45,width:126,height:147,scale:1.25});
      this.jetField = new root.FireField.Field({x:-40,y:-40,width:181,height:241,scale:1.5,kind:'jet'});
      for(const field of [this.bodyField,this.jetField]) {
        field.canvas=document.createElement('canvas');field.canvas.width=field.w;field.canvas.height=field.h;
        field.ctx=field.canvas.getContext('2d');field.image=field.ctx.createImageData(field.w,field.h);
      }
      this.cloudLayer = document.createElement('canvas'); this.cloudLayer.width = 260; this.cloudLayer.height = 142;
      this.cloudLayerCtx = this.cloudLayer.getContext('2d');
      this.sampler = document.createElement('canvas'); this.sampler.width = 281; this.sampler.height = 256;
      this.sample = this.sampler.getContext('2d', { willReadFrequently: true });
      this.bodyPoints = []; this.jetHeading = {x:45,y:70,angle:-2.85};
      this.dctx = dragon.getContext('2d'); this.cctx = cloud.getContext('2d');
      this.tick = this.tick.bind(this); requestAnimationFrame(this.tick);
    }
    update(s) {
      const next = readings(s);
      this.target = next; this.lastUpdate = performance.now();
      this.combinedActive=combinedMode(next,this.combinedActive);
    }
    emissionPoints() {
      const key=this.pose()+':'+this.frame();
      if(this.lastSample===key) return;
      this.lastSample=key;
      if (!this.source.width || this.source.hidden) { this.bodyPoints = []; return; }
      this.sample.clearRect(0, 0, 281, 256); this.sample.drawImage(this.source, 0, 0, 281, 256);
      const p = this.sample.getImageData(0, 0, 281, 256).data, alpha = (x,y) => p[(y * 281 + x) * 4 + 3];
      this.bodyPoints = [];
      const surface=root.PET_ANIM?.clips?.[this.pose()]?.bodyFire||{xs:[114,138,162],minY:130,maxY:177};
      for (const x of surface.xs) for (let y = surface.minY; y < surface.maxY; y++) {
        let dense=0; for(let dy=0;dy<7;dy++) if(alpha(x,y+dy)>160)dense++;
        if(dense>=6) { this.bodyPoints.push({x,y:y+4}); break; }
      }
    }
    flames(now, heat) {
      const started=performance.now(),f = this.fireCtx; f.clearRect(0, 0, 361, 336);
      this.fire.dataset.breath = '0'; this.fire.dataset.body = '0';
      this.fire.dataset.pose=this.pose();this.fire.dataset.frame=String(this.frame());
      if (heat < .08 || this.reduced.matches) {this.bodyField.reset();this.jetField.reset();this.fireAt=now;return;}
      this.emissionPoints();
      const gentle = ['sleep','lie','wake'].includes(this.pose()) || (this.source.dataset.wholeBody === 'true' && this.pose() !== 'roar');
      const t = now/1000,dt=Math.min(.06,(now-(this.fireAt||now-33))/1000);this.fireAt=now;
      const jaw=breathPose(this.pose(),this.frame(),root.PET_ANIM?.clips?.roar?.breath);
      const drawField=(field,opacity)=>{
        field.image.data.set(field.shade(opacity));field.ctx.putImageData(field.image,0,0);
        f.drawImage(field.canvas,field.x+40,field.y+40,field.width,field.height);
      };
      if(gentle){this.bodyField.reset();this.jetField.reset();return;}
      const sources=heat>.25?this.bodyPoints.map((a,i)=>({...a,radius:[5.5,6.1,4.7][i],amount:(.75+.55*heat)*[.93,1,.8][i]})):[];
      this.bodyField.step(dt,t,sources,null,heat);
      drawField(this.bodyField,heat*.9);
      f.save();f.globalCompositeOperation='destination-out';f.drawImage(this.source,40,40,281,256);f.restore();
      this.fire.dataset.body=String(sources.length);
      const allowed=jaw && heat>=.45 && !this.muted();
      if(allowed){
        this.jetHeading=jaw;
        this.fire.dataset.mouthX=jaw.x.toFixed(2);this.fire.dataset.mouthY=jaw.y.toFixed(2);this.fire.dataset.angle=jaw.angle.toFixed(3);
        this.fire.dataset.breath=jaw.strength.toFixed(3);
      }
      if(this.muted() || this.pose()!=='roar')this.jetField.reset();
      else {
        const emit=allowed?[
          {x:jaw.x,y:jaw.y,radius:3.2,amount:jaw.strength*1.8},
          {x:jaw.x+Math.cos(jaw.angle)*4,y:jaw.y+Math.sin(jaw.angle)*4,radius:3.4,amount:jaw.strength*1.65},
        ]:[];
        this.jetField.step(dt,t,emit,this.jetHeading,heat);
        drawField(this.jetField,heat*.98);
      }
      this.fire.dataset.jetEnergy=this.jetField.energy.toFixed(2);
      this.fire.dataset.simulationMs=(performance.now()-started).toFixed(2);
    }
    protectReadings() {
      const c=this.cctx; c.save(); c.globalCompositeOperation='destination-out';
      const clear=c.createRadialGradient(130,77,32,130,77,114);
      clear.addColorStop(0,'rgba(0,0,0,1)'); clear.addColorStop(.45,'rgba(0,0,0,1)'); clear.addColorStop(.62,'rgba(0,0,0,.65)'); clear.addColorStop(1,'rgba(0,0,0,0)');
      c.translate(130,77); c.scale(1,.58); c.translate(-130,-77);
      c.fillStyle=clear; c.fillRect(-100,-100,460,360); c.restore();
    }
    burningCloud(heat,t) {
      if(!this.cloudArt.complete || !this.cloudArt.naturalWidth) return;
      const l=this.cloudLayerCtx; l.clearRect(0,0,260,142); l.save();
      l.drawImage(this.cloudArt,0,0,260,142);
      l.globalCompositeOperation='multiply';
      const color=l.createLinearGradient(0,18,0,135);
      color.addColorStop(0,'#ffe79a'); color.addColorStop(.3,'#ffa82e'); color.addColorStop(.64,'#f0441f'); color.addColorStop(1,'#db2816');
      l.fillStyle=color; l.fillRect(0,0,260,142);
      l.globalCompositeOperation='destination-in'; l.drawImage(this.cloudArt,0,0,260,142); l.restore();
      this.cctx.save(); this.cctx.globalAlpha=heat*.98*(this.singleOpacity??1);
      this.cctx.drawImage(this.cloudLayer,0,Math.sin(t*1.2)*heat*1.4); this.cctx.restore();
    }
    textureLayer(filter, opacity, mask) {
      opacity*=this.singleOpacity??1;
      if (!this.source.width || this.source.hidden || opacity < .002) return;
      const l = this.layerCtx;
      l.clearRect(0, 0, 281, 256); l.save();
      l.filter = filter; l.drawImage(this.source, 0, 0, 281, 256); l.filter = 'none';
      l.globalCompositeOperation = 'destination-in'; l.fillStyle = mask; l.fillRect(0, 0, 281, 256);
      l.restore();
      this.dctx.save(); this.dctx.globalAlpha = opacity; this.dctx.drawImage(this.layer, 0, 0); this.dctx.restore();
    }
    guardian(now, weight) {
      const pose=this.pose(),frame=this.frame(),gentle=['sleep','lie','wake'].includes(pose);
      const cue=root.PET_ANIM?.clips?.guard?.guardCue||{focus:19,plant:58,settle:63};
      const landing=pose==='guard'&&!this.reduced.matches&&!this.muted()?Math.exp(-(((frame-cue.plant)/5)**2)):0;
      const breath=gentle||this.reduced.matches?0:Math.sin(now/1000*1.5)*.5+.5;
      const key=pose+':'+frame;
      if(this.guardianFrame!==key && this.source.width && !this.source.hidden) {
        this.guardianFrame=key;
        const g=this.guardianCtx;g.clearRect(0,0,281,256);g.drawImage(this.source,0,0,281,256);
        const image=g.getImageData(0,0,281,256),p=image.data;
        for(let i=0;i<p.length;i+=4) {
          if(!p[i+3])continue;
          const r=p[i],green=p[i+1],b=p[i+2],red=clamp((r-green-12)/70),y=Math.floor(i/4/281);
          const shade=.94-.14*red;
          p[i]=r*shade;p[i+1]=green*(.96-.24*red);p[i+2]=b*(.9-.16*red);
          const reflected=clamp((y-130)/120)*.16;
          p[i]+=reflected*(255-p[i]);p[i+1]+=reflected*(160-p[i+1]);p[i+2]+=reflected*(54-p[i+2]);
        }
        g.putImageData(image,0,0);
      }
      this.dctx.save();this.dctx.globalAlpha=weight;this.dctx.drawImage(this.guardianLayer,0,0);this.dctx.restore();
      if(this.guardianArt.complete && this.guardianArt.naturalWidth) {
        const c=this.cctx;c.save();c.globalAlpha=weight;
        c.filter=`brightness(${1+breath*.045+landing*.14})`;
        c.drawImage(this.guardianArt,0,landing*1.4,260,142);c.restore();
        this.protectReadings();
      }
      this.cloud.dataset.landing=landing.toFixed(3);
      this.dragon.dataset.guardPhase=pose==='guard'?(frame<cue.focus?'focus':frame<cue.plant-3?'gather':frame<cue.settle?'plant':'settle'):'watch';
      return landing;
    }
    tick(now, sourceChanged = false) {
      if(!sourceChanged)requestAnimationFrame(this.tick);
      if (document.hidden || (!sourceChanged && now - this.lastFrame < (this.reduced.matches ? 200 : 33))) return;
      const dt = Math.min(2000, now - (this.lastFrame || now)); this.lastFrame = now;
      const blend = 1 - Math.exp(-dt / 700);
      const stale = now - this.lastUpdate > 15000;
      this.combined+=((!stale&&this.combinedActive?1:0)-this.combined)*blend;
      if(this.combined<.002)this.combined=0;
      for (const k of ['heat', 'ram', 'vram']) {
        this.value[k] += ((stale ? 0 : this.target[k]) - this.value[k]) * blend;
        if (this.value[k] < .002) this.value[k] = 0;
      }
      const h = this.value.heat, r = this.value.ram, v = this.value.vram;
      const stats = this.cloud.parentElement;
      const guardian=this.combinedActive&&!stale;
      this.singleOpacity=guardian?0:1-this.combined;
      stats.style.setProperty('--ram-spirit', guardian?'0':(r*this.singleOpacity).toFixed(3));
      this.dragon.dataset.heat = h.toFixed(3); this.cloud.dataset.ram = r.toFixed(3); this.cloud.dataset.vram = v.toFixed(3);
      this.dragon.dataset.mode=this.cloud.dataset.mode=guardian?'combined':this.combined?'transition':'single';
      this.dragon.dataset.combined=this.combined.toFixed(3);
      const d = this.dctx, c = this.cctx;
      d.clearRect(0, 0, 281, 256); c.clearRect(0, 0, 260, 142);
      if(guardian) {
        this.flames(now,0);
        const landing=this.guardian(now,this.combined);
        this.inscriptions?.tick(now,this.value,this.combined,true,stale,this.reduced.matches,landing);
        return;
      }
      if(this.combined)this.guardian(now,this.combined);
      this.inscriptions?.tick(now,this.value,this.combined,false,stale,this.reduced.matches);
      this.flames(now,h*this.singleOpacity);
      if (!h && !r && !v) return;
      const t = this.reduced.matches ? 1.8 : now / 1000;
      if (h) {
        const gentle = ['sleep', 'lie'].includes(this.pose());
        const strength = h * (gentle ? .45 : 1);
        const mask = this.layerCtx.createLinearGradient(0, 30, 0, 256);
        mask.addColorStop(0, 'rgba(0,0,0,.8)'); mask.addColorStop(.5, 'rgba(0,0,0,1)'); mask.addColorStop(1, 'rgba(0,0,0,.8)');
        this.textureLayer(`brightness(${1 + strength * .25}) saturate(${1 + strength * .12}) contrast(1.02)`, strength * .65, mask);
        const crest=this.layerCtx.createRadialGradient(145,145,5,145,145,61);
        crest.addColorStop(0,'rgba(0,0,0,.85)');crest.addColorStop(.5,'rgba(0,0,0,.4)');crest.addColorStop(1,'rgba(0,0,0,0)');
        this.textureLayer('brightness(1.5) saturate(1.3)',strength*.55,crest);
        const jaw=breathPose(this.pose(),this.frame(),root.PET_ANIM?.clips?.roar?.breath);
        if(jaw && !this.muted() && !this.reduced.matches && h>=.45) {
          const mouth=this.layerCtx.createRadialGradient(jaw.x,jaw.y,1,jaw.x,jaw.y,27);
          mouth.addColorStop(0,'rgba(0,0,0,.8)');mouth.addColorStop(1,'rgba(0,0,0,0)');
          this.textureLayer('brightness(1.5) saturate(1.25)',strength*jaw.strength*.45,mouth);
        }
        this.burningCloud(h,t);
      }
      if (r) {
        if (this.cloudArt.complete && this.cloudArt.naturalWidth) {
          const swell = Math.sin(t * 1.35), sink = r * (5 + swell * 3);
          c.save(); c.globalAlpha = r * .7 * this.singleOpacity; c.filter = 'blur(2px) saturate(.25) brightness(.5)';
          c.drawImage(this.cloudArt, -6 * r, sink + 5, 260 + 12 * r, 142); c.restore();
          c.save(); c.globalAlpha = r * .99 * this.singleOpacity; c.filter = `saturate(${1 - r * .82}) brightness(${1 - r * .57}) contrast(1.12)`;
          c.drawImage(this.cloudArt, -2 * r * swell, sink, 260 + 4 * r * swell, 142); c.restore();
        }
      }
      if (h || r) this.protectReadings();
      if (v) {
        const bodyMask = this.layerCtx.createLinearGradient(0, 0, 0, 256);
        bodyMask.addColorStop(0, 'rgba(0,0,0,.9)'); bodyMask.addColorStop(1, 'rgba(0,0,0,1)');
        this.textureLayer('sepia(1) saturate(2.5) hue-rotate(-8deg) brightness(1.3) contrast(1.12)', v * .92, bodyMask);
        const center = this.reduced.matches ? 145 : 55 + ((t * 34) % 205);
        const mask = this.layerCtx.createLinearGradient(center - 58, 0, center + 58, 50);
        mask.addColorStop(0, 'rgba(0,0,0,0)'); mask.addColorStop(.35, 'rgba(0,0,0,.35)');
        mask.addColorStop(.5, 'rgba(0,0,0,1)'); mask.addColorStop(.65, 'rgba(0,0,0,.35)'); mask.addColorStop(1, 'rgba(0,0,0,0)');
        this.textureLayer('sepia(1) saturate(1.8) brightness(2.1) contrast(1.08)', v * .86, mask);
      }
    }
  }
  const api = { readings, tempColor, breathPose, combinedMode, Reactions, Renderer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StatusLife = api;
})(typeof window === 'undefined' ? globalThis : window);
