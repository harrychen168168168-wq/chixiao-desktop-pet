(function () {
  const { PLATFORM, clock, dur, esc, tone } = window.fmt;
  const api = window.deskPet;
  const $ = (id) => document.getElementById(id);
  let active = { running: [], recent: [] };
  let alerts = [];
  let busy = false;          // a build is running: the dragon moves a little faster
  let sleepAfter = 900;      // stay awake for quiet gestures and wandering before lying down
  let quietSince = Date.now();
  const player = { clips: {}, name: 'idle', frame: 0, queued: null, fade: null };
  let moving = false;
  let hovering = false;
  let facing = 'left';
  let edgePhase = 'desktop';
  const atEdge = () => edgePhase !== 'desktop';
  const idleLife = new window.IdleLife();
  let idleSequence = [], idleActing = false;
  const statusReactions = new window.StatusLife.Reactions();
  const inscriptions = new window.StatusInscriptions.Readings($('stats'));
  const statusFx = new window.StatusLife.Renderer({ dragon: $('status-dragon-fx'), fire: $('status-fire-fx'), cloud: $('status-cloud-fx'), source: $('pet-anim'),
    inscriptions,
    pose: () => $('pet-anim').dataset.pose || player.name, frame: () => Number($('pet-anim').dataset.frame) || 0,
    muted: () => atEdge() || Boolean(pondering) || Boolean(saying) || pressed || hovering });
  const behavior = () => { if (api.behavior) api.behavior({ action: player.clips[player.name]?.wholeBody ? player.name : player.queued || player.name, blocked: (atEdge() ? Boolean(saying) : telling()) || Boolean(pondering) || pressed, hovering, canWalk: Boolean(player.clips.walk) }); };
  let saying = null;         // what the dragon says, shown in its bubble for a moment: { text, calm }
  const telling = () => active.running.length > 0 || active.recent.length > 0 || alerts.length > 0 || Boolean(saying && !saying.calm);
  const tellMind = () => { if (api.petState) api.petState(player.queued === 'lie' ? 'lie' : player.name); behavior(); };

  function normalize(meta) {
    if (meta.clips) return meta;
    return { fw: meta.fw, fh: meta.fh, clips: { idle: { src: meta.src || 'assets/pet-anim.png', frames: meta.frames, fps: meta.fps, cols: meta.cols, loop: true } } };
  }

  function startPlayer(meta) {
    meta = normalize(meta);
    const names = Object.keys(meta.clips);
    let pending = names.length;
    for (const name of names) {
      const c = meta.clips[name];
      const img = new Image();
      img.onload = () => { player.clips[name] = { ...c, img }; if (--pending === 0) begin(meta); };
      img.onerror = () => { if (--pending === 0) begin(meta); };
      img.src = c.src;
    }
  }

  function begin(meta) {
    if (!player.clips.idle) { showStill(); return; }
    const canvas = $('pet-anim');
    canvas.width = meta.fw;
    canvas.height = meta.fh;
    const k = Math.min(220 / meta.fw, 180 / meta.fh);
    const w = Math.round(meta.fw * k), h = Math.round(meta.fh * k);
    $('pet').style.width = w + 'px';
    $('pet').style.height = h + 'px';
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.hidden = false;
    $('pet-emoji').hidden = true;
    tellMind();
    const ctx = canvas.getContext('2d');
    const tick = () => {
      const c = player.clips[player.name];
      ctx.clearRect(0, 0, meta.fw, meta.fh);
      ctx.drawImage(c.img, (player.frame % c.cols) * meta.fw, Math.floor(player.frame / c.cols) * meta.fh, meta.fw, meta.fh, 0, 0, meta.fw, meta.fh);
      canvas.dataset.pose=player.name;canvas.dataset.frame=String(player.frame);
      canvas.dataset.wholeBody=String(Boolean(c.wholeBody));
      if (player.fade) {             // a quick switch (roar on click) blends out of the previous picture
        ctx.globalAlpha = player.fade.alpha;
        ctx.drawImage(player.fade.snap, 0, 0);
        ctx.globalAlpha = 1;
        player.fade.alpha -= 0.25;
        if (player.fade.alpha <= 0) player.fade = null;
      }
      statusFx.tick(performance.now(), true);
      player.frame++;
      if (player.queued && c.exitAt != null && player.frame === c.exitAt) player.frame = c.recoverAt;
      if (player.frame >= c.frames) {
        player.frame = 0;
        const was = player.name;
        if (player.queued && player.clips[player.queued]) { player.name = player.queued; player.queued = null; }
        else if (!c.loop || (player.name === 'walk' && !moving)) {
          const follow = idleActing && !moving && !pressed && !busy && !telling() && !pondering && idleSequence.shift();
          if (follow && player.clips[follow]) player.name = follow;
          else {
            player.name = c.next && player.clips[c.next] ? c.next : 'idle';
            if (idleActing) { idleActing = false; idleSequence = []; idleLife.rest(); }
          }
        }
        if (player.name !== was) {
          if(was==='guard')idleLife.rest();
          api.log(`action ${was} -> ${player.name} (telling ${telling()})`); tellMind();
        }
      }
      $('zzz').hidden = player.name !== 'sleep';
      setTimeout(tick, 1000 / (player.clips[player.name].fps * (busy && player.name === 'idle' ? 1.3 : 1)));
    };
    tick();
    setInterval(decide, 2000);
  }
  function play(name, now) {
    idleSequence = [];
    if (idleActing) { idleActing = false; idleLife.rest(); }
    if (!player.clips[name] || player.name === name || player.queued === name) return;
    if (now && player.clips[player.name]?.wholeBody) {
      player.queued = name; tellMind(); return;
    }
    if (now) {
      const snap = document.createElement('canvas');
      snap.width = $('pet-anim').width; snap.height = $('pet-anim').height;
      snap.getContext('2d').drawImage($('pet-anim'), 0, 0);
      player.fade = { snap, alpha: 1 };
      api.log(`action ${player.name} -> ${name} (now)`);
      player.name = name; player.frame = 0; player.queued = null;
    } else {
      player.queued = name;
    }
    tellMind();
  }

  const asleep = () => player.name === 'sleep' || player.name === 'lie' || player.queued === 'lie';
  function decide() {
    if (atEdge()) return;
    if (!player.clips.lie || !player.clips.sleep) return;              // no sleeping clips yet
    const reaction = statusReactions.take(asleep() || moving || pressed || hovering || Boolean(pondering) || Boolean(saying) || player.name !== 'idle' || Boolean(player.queued));
    if (reaction && act(reaction.action)) {
      api.log(`system reaction ${reaction.kind} -> ${reaction.action}`);
      return;
    }
    if (telling()) {
      quietSince = Date.now();
      if (player.queued === 'lie') player.queued = null;
      return;
    }
    if (!asleep() && ['idle', 'walk'].includes(player.name) && Date.now() - quietSince >= sleepAfter * 1000) play('lie');
    else fidget();
  }
  function rouse(why, { roar = true } = {}) {
    api.log(`rouse (${why}) while ${player.name}`);
    quietSince = Date.now();
    if (player.queued === 'lie') player.queued = null;
    if (player.name === 'sleep') play('wake', true);
    else if (player.name === 'lie') play('wake');
    else if (roar && player.name === 'idle' && player.clips.roar) play('roar', true);
  }
  function onPetClick(d) {
    const double = Boolean(d && d.double);
    const slept = asleep();
    rouse(double ? '双击' : 'click', { roar: !double });
    touch('poke', { asleep: slept, double });
  }
  const touch = (kind, info) => { api.log(`touch ${kind}`); if (api.touch) api.touch(kind, { asleep: asleep(), ...(info || {}) }); };
  const GLYPHS = { heart: ['♥', '♥', '♥'], anger: ['💢'], sweat: ['💧', '💧'], note: ['♪', '♫'], bang: ['!'] };
  let emoteTimer = null;
  function emote(kind) {
    const el = $('emote');
    if (!GLYPHS[kind]) return;
    el.className = kind + (player.name === 'sleep' || player.name === 'lie' ? ' low' : '');
    el.innerHTML = GLYPHS[kind].map((g) => `<i>${g}</i>`).join('');
    clearTimeout(emoteTimer);
    emoteTimer = setTimeout(() => { el.innerHTML = ''; }, 2700);
  }

  let sayingTimer = null;
  function say(text, ms, calm, note) {
    saying = { text: String(text), calm: Boolean(calm), note: note || '' };
    clearTimeout(sayingTimer);
    sayingTimer = setTimeout(() => { saying = null; renderActive(); }, ms);
    renderActive();
  }
  let stroke = { dir: 0, x: 0, turns: 0, last: 0 };
  let strokedAt = 0;
  let hoverTimer = null;
  function onStroke(e) {
    if (pressed || e.buttons) return;
    const now = performance.now();
    if (now - stroke.last > 900) stroke = { dir: 0, x: e.clientX, turns: 0, last: now };
    stroke.last = now;
    const dx = e.clientX - stroke.x;
    if (Math.abs(dx) < 14) return;
    const dir = Math.sign(dx);
    if (stroke.dir && dir !== stroke.dir) stroke.turns++;
    stroke.dir = dir;
    stroke.x = e.clientX;
    if (stroke.turns >= 3 && now - strokedAt > 2500) {
      strokedAt = now;
      stroke.turns = 0;
      clearTimeout(hoverTimer);
      touch('pet');
    }
  }
  let presses = [];
  function onPress() {
    const now = performance.now();
    presses = presses.filter((t) => now - t < 2500);
    presses.push(now);
    if (presses.length >= 4) { presses = []; touch('annoy'); }
  }

  function showStill() {
    const img = $('pet-img');
    img.onload = () => { img.hidden = false; $('pet-emoji').hidden = true; };
    img.src = 'assets/pet.png';
  }
  if (window.PET_ANIM) startPlayer(window.PET_ANIM);
  else showStill();

  function renderSystem(s) {
    statusFx.update(s);
    statusReactions.update(window.StatusLife.readings(s));
    if(player.name==='guard' && !statusFx.combinedActive)play('idle',true);
    inscriptions.update(s);
  }
  const on = (pf) => (/^[\x00-\x7f]/.test(pf.name) ? ` ${pf.name} ` : pf.name);

  function runningHtml(b) {
    const pf = PLATFORM[b.platform] || PLATFORM.local;
    const job = b.platform === 'local' ? '打包安卓' : '打包';
    const verb = b.queued ? `在${on(pf)}排队` : `正在${on(pf)}${job}`;
    return `<div class="b-item running">
      <span class="dot" style="--c:${pf.color}"></span><span class="b-name">${esc(b.project.name)}</span>
      <span class="b-right"><small>${b.queued ? '已等' : '已用'}</small> <span class="b-time num" data-start="${esc(b.start)}">${clock(Date.now() - new Date(b.start))}</span></span>
      <span class="b-line">${verb.trim()}</span>
    </div>`;
  }

  function doneHtml(f) {
    const pf = PLATFORM[f.platform] || PLATFORM.local;
    const t = tone(f.status);
    let label = t === 'good' ? '✓ 完成' : t === 'bad' ? '✗ 失败' : /cancel/.test(f.status) ? '■ 取消' : '● 结束';
    const took = f.start && f.end ? ` · 用时 ${dur((new Date(f.end) - new Date(f.start)) / 60000)}` : '';
    let line = `${pf.name}${took}`;
    if (f.platform === 'local' && f.status === 'unknown') line += ' · 没见到新 .aab';
    return `<div class="b-item done">
      <span class="dot" style="--c:${pf.color}"></span><span class="b-name">${esc(f.project.name)}</span>
      <span class="b-right b-done ${t}">${label}</span>
      <span class="b-line">${line}</span>
    </div>`;
  }
  function alertHtml(a) {
    const hogs = a.top == null
      ? '<span class="h-wait">正在查是谁在占用…</span>'
      : a.top.length
        ? a.top.map((h) => `<span class="h-name">${esc(h.label)}</span><span class="h-val num">${esc(h.text)}</span>`).join('')
        : '<span class="h-wait">没找到单个大户（可能是系统本身）</span>';
    const causes = a.top && a.top.length ? ' · 主要是：' : '';
    if (a.recovered) {   // ended less than a minute ago: what it was and who caused it
      return `<div class="b-item alert recovered">
        <span class="dot"></span><span class="b-name">${esc(a.name)}已回落 ${a.value}${a.unit}</span>
        <span class="b-right b-done good">✓</span>
        <span class="b-line">刚才最高 ${a.peak}${a.unit}${causes}</span>
        <span class="b-hogs">${hogs}</span>
      </div>`;
    }
    const why = a.reason === 'jump' && a.from != null
      ? `${a.minutes} 分钟内从 ${a.from}${a.unit} 涨到 ${a.value}${a.unit}`
      : a.detail;
    return `<div class="b-item alert ${a.level}">
      <span class="dot"></span><span class="b-name">${esc(a.name)} ${a.value}${a.unit}</span>
      <span class="b-right"><small>已</small> <span class="b-time num" data-start="${esc(a.since)}">${clock(Date.now() - new Date(a.since))}</span></span>
      <span class="b-line">${esc(why)}${causes}</span>
      <span class="b-hogs">${hogs}</span>
    </div>`;
  }
  function spoken(text) {
    return String(text)
      .replace(/\[([^\]\n]{1,80})\]\((https?:\/\/[^\s)]+)\)/g, (_m, name, url) => {
        const where = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
        return url.toLowerCase().includes(name.trim().toLowerCase().replace(/\/$/, '')) ? where : `${name.trim()}（${where.split('/')[0]}）`;
      })
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
      .replace(/^[ \t]*[-*•][ \t]+/gm, '')
      .replace(/\s*\n+\s*/g, ' ')
      .trim();
  }
  function sayingHtml(text, note) {
    const all = spoken(text);
    const short = all.length > 90 ? all.slice(0, 88) + '…' : all;
    return `<div class="b-item saying"><span class="b-say">${esc(short)}</span>${note ? `<span class="b-note">${esc(note)}</span>` : ''}</div>`;
  }

  function renderActive() {
    const html = [...(saying ? [sayingHtml(saying.text, saying.note)] : []), ...alerts.map(alertHtml), ...active.running.map(runningHtml), ...active.recent.map(doneHtml)];
    $('bubble').hidden = html.length === 0;
    $('bubble-list').innerHTML = html.join('');
    busy = active.running.length > 0;
    $('busy-badge').hidden = !busy;
    checkNews();
    behavior();
  }
  const seen = new Set();
  const noticed = {};
  let ready = false;         // what is already there when the pet starts is not news
  function checkNews() {
    const now = Date.now();
    const news = [];
    for (const b of active.running) if (!seen.has('run:' + b.key)) { seen.add('run:' + b.key); news.push('打包开始 ' + b.project.name); }
    for (const f of active.recent) if (!seen.has('end:' + f.key)) { seen.add('end:' + f.key); news.push('打包结束 ' + f.project.name); }
    for (const a of alerts) {
      if (a.recovered) continue;
      if (now - (noticed[a.kind] || 0) >= 10 * 60000) news.push('报警 ' + a.name);
      noticed[a.kind] = now;
    }
    if (news.length && ready) {
      if(atEdge())api.command('edge-return');
      rouse(news.join('、'));
    }
  }

  setInterval(() => {
    for (const el of document.querySelectorAll('[data-start]')) el.textContent = clock(Date.now() - new Date(el.dataset.start));
  }, 1000);
  const root = $('root');
  new ResizeObserver(() => api.size(Math.ceil(root.getBoundingClientRect().height))).observe(root);
  let pressed = false;
  const dragPoint=e=>({x:e.screenX,y:e.screenY,cancelled:['pointercancel','lostpointercapture'].includes(e.type)});
  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    if (['tucking','hidden','peeking','returning'].includes(edgePhase)) {
      if(e.button===0){e.preventDefault();api.command('edge-return');}return;
    }
    api.log(`pointerdown button=${e.button} type=${e.pointerType}`);
    if (e.button !== 0) return;
    pressed = true;
    behavior();
    root.setPointerCapture(e.pointerId);
    clearTimeout(hoverTimer);
    if (e.target.closest('#pet')) onPress();
    api.down(dragPoint(e));
  });
  root.addEventListener('pointermove',e=>{if(pressed)api.drag?.(dragPoint(e));});
  $('pet').addEventListener('pointermove', e => { if (!atEdge()) onStroke(e); });
  $('pet').addEventListener('pointerenter', () => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => { if (!atEdge() && !pressed && performance.now() - strokedAt > 4000) touch('hover'); }, 1500);
  });
  $('pet').addEventListener('pointerleave', () => clearTimeout(hoverTimer));
  const release = (e) => {
    api.log(`${e.type} pressed=${pressed}`);
    if (pressed) { pressed = false; api.up(dragPoint(e)); behavior(); }
  };
  root.addEventListener('pointerup', release);
  root.addEventListener('pointercancel', release);
  root.addEventListener('lostpointercapture', release);
  root.addEventListener('contextmenu', (e) => { e.preventDefault(); api.menu(); });
  root.addEventListener('pointerenter', () => { hovering = true; behavior(); });
  root.addEventListener('pointerleave', () => { hovering = false; behavior(); });
  let praisedAt = 0;
  $('pet').addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!atEdge() && !asleep() && Date.now() - praisedAt > 5000) { praisedAt = Date.now(); touch('praise'); }
  }, { passive: false });

  $('edge-recall').addEventListener('click', () => api.command('edge-return'));
  $('edge-recall').addEventListener('contextmenu', e => {e.preventDefault();api.menu();});
  $('edge-peek').addEventListener('click', () => api.command('edge-return'));
  $('edge-peek').addEventListener('contextmenu', e => {e.preventDefault();api.menu();});
  $('edge-peek').addEventListener('pointerenter', () => {hovering=true;behavior();});
  $('edge-peek').addEventListener('pointerleave', () => {hovering=false;behavior();});
  api.on('pet:edge', s => {
    if(!s || !['desktop','waiting','approach','tucking','hidden','peeking','returning'].includes(s.phase))return;
    edgePhase=s.phase;idleSequence=[];idleActing=false;clearTimeout(hoverTimer);
    if(s.fromDrag){
      saying=null;clearTimeout(sayingTimer);pressed=false;hovering=false;
      root.style.transition='none';root.style.transform=`translateX(${Number(s.offset)||0}px)`;
      rouse('拖进屏幕边缘',{roar:false});renderActive();
    }
    if(atEdge())document.body.dataset.edge=edgePhase;else delete document.body.dataset.edge;
    document.body.dataset.edgeSide=s.side==='left'?'left':'right';
    $('edge-recall').hidden=!['tucking','hidden','peeking'].includes(edgePhase);
    $('edge-peek').tabIndex=edgePhase==='peeking'?0:-1;
    $('edge-peek').setAttribute('aria-hidden',String(edgePhase!=='peeking'));
    if(['tucking','hidden','peeking','returning'].includes(edgePhase)&&!s.fromDrag) {
      facing=s.side==='left'?'right':'left';$('pet').style.setProperty('--facing',facing==='right'?-1:1);
    }
    if(edgePhase==='desktop'){quietSince=Date.now();idleLife.rest();hovering=false;}
    if(s.fromDrag){void root.offsetWidth;requestAnimationFrame(()=>{root.style.transition='';root.style.transform='';});}
    behavior();
  });

  let latestSystem = null, previewSystem = null;
  api.on('system', (s) => { latestSystem = s; if (!previewSystem) renderSystem(s); });
  api.on('pet:status-preview', (s) => {
    if (api.isElectron) return;
    previewSystem = s || null; renderSystem(previewSystem || latestSystem);
  });
  api.on('pet:clicked', onPetClick);
  api.on('active', (a) => { active = a; renderActive(); });
  api.on('alerts', (list) => { alerts = list || []; renderActive(); });
  api.on('chat:reply', (r) => {
    clearInterval(pondering);
    pondering = null;
    behavior();
    if (!r || !r.text) return;
    rouse('聊天', { roar: false });
    act('talk');
    say(r.text, 15000, false, r.warn ? `⚠ 有 ${r.warn} 处没对上，打开对话看` : '');
  });
  const INSTEAD = { angry: 'roar', happy: null, nod: null, shake: null, tilt: null, stretch: null, think: null, talk: null };
  function act(name) {
    const clip = player.clips[name] ? name : INSTEAD[name];
    if (!clip || !player.clips[clip] || asleep()) return false;
    if (player.name === 'wake') {            // getting up: it follows once it stands (a roar is not worth waiting for)
      if (clip === 'roar') return false;
      play(clip);
      return true;
    }
    play(clip, true);
    statusReactions.performed(clip);
    return true;
  }
  function fidget() {
    if (atEdge()) return;
    if (player.name !== 'idle' || player.queued || moving || pressed || busy || telling() || pondering) return;
    const plan = idleLife.take(player.clips, hovering);
    if (!plan || !act(plan[0])) return;
    idleSequence = plan.slice(1); idleActing = true;
    api.log(`idle sequence ${plan.join(' -> ')}`);
  }
  api.on('pet:say', (s) => {
    if (!s) return;
    if(atEdge()&&['lift','drop'].includes(s.occasion))return;
    if (s.wake) rouse(`自己开口 ${s.occasion || ''}`, { roar: false });
    if (s.emote) emote(s.emote);
    if (!(s.act && act(s.act)) && s.text && !s.calm) act('talk');   // talking, its mouth moves
    if (s.text) say(s.text, s.ms || 6000, s.calm);
  });
  let pondering = null;
  api.on('chat:thinking', (on) => {
    clearInterval(pondering);
    pondering = null;
    if (!on) { behavior(); return; }
    act('think');
    pondering = setInterval(() => { if (player.name === 'idle') act('think'); }, 1500);
    behavior();
  });
  api.on('pet:motion', (s) => {
    moving = Boolean(s.moving);
    $('toy').hidden = !s.playing;
    if (s.facing) facing = s.facing;
    $('pet').style.setProperty('--facing', facing === 'right' ? '-1' : '1');
    $('zzz').style.left = facing === 'right' ? '70%' : '20%';
    $('emote').style.left = facing === 'right' ? '70%' : '';
    if (moving && player.name === 'idle') play('walk', true);
    else if (!moving && player.name === 'walk') play('idle', true);
  });
  api.on('pet:command', (s) => {
    const kind = s && s.kind;
    if (kind === 'rest') {
      saying = null; clearTimeout(sayingTimer); renderActive();
      quietSince = Date.now() - sleepAfter * 1000;
      if (!telling() && !asleep()) play('lie');
      return;
    }
    if (kind === 'pet') { touch('pet'); return; }
    rouse('互动 ' + kind, { roar: false });
    if (kind === 'praise') touch('praise');
    if (kind === 'play' || kind === 'home') { emote('note'); act('nod'); }
  });
  api.on('pet:sleep-after', (s) => { sleepAfter = Number(s) || 900; });

  api.initial().then((init) => {
    if (init.pet && init.pet.sleepAfterSeconds) sleepAfter = init.pet.sleepAfterSeconds;
    if (init.pet && Array.isArray(init.pet.idleEverySeconds)) idleLife.every = init.pet.idleEverySeconds;
    latestSystem = init.system; renderSystem(previewSystem || latestSystem);
    if (init.active) active = init.active;
    if (init.alerts) alerts = init.alerts;
    renderActive();
    ready = true;
    tellMind();
  });
})();
