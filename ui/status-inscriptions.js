(function (root) {
  const clamp = x => Math.max(0, Math.min(1, x));
  const usable = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const heat = (kind, n) => usable(n) ? clamp((n - (kind === 'CPU' ? 60 : 50)) / 40) : 0;
  const ink = (text, extra = '') => `<b class="ink ${extra}" data-ink="${text}"><span class="ink-face">${text}</span><span class="ink-light" aria-hidden="true" data-ink="${text}"></span></b>`;
  function writeInk(node, text) {
    node.dataset.ink = text; node.querySelector('.ink-face').textContent = text;
    node.querySelector('.ink-light').dataset.ink = text;
  }
  class Readings {
    constructor(stats) {
      this.stats = stats; this.lastTick = 0; this.sensors = new Map();
      this.rows = ['ram','vram','temp'].map(k => stats.querySelector('#row-' + k));
      this.values = Object.fromEntries(['ram','vram','temp'].map(k => [k, stats.querySelector('#v-' + k)]));
    }
    capacity(kind, data) {
      const el = this.values[kind], row = el.parentElement;
      const available = data && usable(data.usedGB) && usable(data.totalGB) && data.totalGB > 0;
      row.dataset.available = String(Boolean(available));
      if (!available) { el.textContent = '读不到'; return; }
      if (!el.querySelector('.reading-used')) {
        el.innerHTML = `<span class="reading-text">${ink('0.0', 'reading-used')}<small class="reading-total"> / 0.0</small><small class="reading-unit"> GB</small></span>`;
      }
      const used = el.querySelector('.reading-used');
      writeInk(used, data.usedGB.toFixed(1));
      el.querySelector('.reading-total').textContent = ` / ${data.totalGB.toFixed(1)}`;
      const meter = this.stats.querySelector('#m-' + kind);
      meter.style.width = Math.min(100, Math.max(2, data.usedGB / data.totalGB * 100)).toFixed(1) + '%';
    }
    update(s) {
      this.capacity('ram', s?.ram); this.capacity('vram', s?.vram);
      const readings = [['CPU',s?.cpuTemp],['GPU',s?.gpuTemp]].filter(([,v]) => usable(v));
      const el = this.values.temp, keys = new Set(readings.map(([k]) => k));
      for (const key of this.sensors.keys()) if (!keys.has(key)) this.sensors.delete(key);
      const nodes = readings.map(([kind, value]) => {
        let entry = this.sensors.get(kind);
        if (!entry) {
          const node = document.createElement('span'); node.dataset.sensor = kind;
          node.innerHTML = `<span class="reading-text"><small class="sensor-name">${kind} </small>${ink('0')}<small class="reading-unit">°C</small></span>`;
          entry = { node, level: 0 }; this.sensors.set(kind, entry);
        }
        entry.target = heat(kind, value);
        const number = entry.node.querySelector('.ink');
        writeInk(number, String(Math.round(value)));
        entry.node.style.color = root.StatusLife.tempColor(kind, value);
        return entry.node;
      });
      if (nodes.length) {
        if (nodes.length !== el.children.length || nodes.some((n,i) => n !== el.children[i])) el.replaceChildren(...nodes);
      } else el.textContent = '读不到';
      el.classList.toggle('dual', nodes.length > 1);
      el.parentElement.dataset.available = String(Boolean(nodes.length));
    }
    tick(now, levels, joined, guardian, stale, reduced, landing = 0) {
      const dt = Math.min(2000, Math.max(0, now - (this.lastTick || now))); this.lastTick = now;
      const blend = 1 - Math.exp(-dt / 700);
      const still = reduced || stale;
      const phase = still ? .5 : (Math.sin(now / 1000 * 1.5) + 1) / 2;
      const position = still ? 50 : 250 - ((now / 3800) % 1) * 400;
      const common = phase;
      this.stats.dataset.inscriptionMode = guardian ? 'combined' : joined ? 'transition' : 'single';
      this.stats.style.setProperty('--inscription-joined', joined.toFixed(3));
      this.stats.style.setProperty('--inscription-unity', (.35 + common * .3 + landing * .35).toFixed(3));
      this.stats.style.setProperty('--ink-position', position.toFixed(1) + '%');
      this.stats.style.setProperty('--heat-ink-position', (still ? 50 : 130 - ((now / 3600) % 1) * 160).toFixed(1) + '%');
      this.stats.style.setProperty('--inscription-phase', phase.toFixed(3));
      for (const kind of ['ram','vram']) {
        const row = this.values[kind].parentElement;
        const level = row.dataset.available === 'true' && !stale ? levels[kind] : 0;
        row.dataset.level = level.toFixed(3); row.style.setProperty('--inscription-level', level.toFixed(3));
        const from = [61,43,22], to = kind === 'ram' ? [37,78,76] : [139,84,20];
        row.style.setProperty('--reading-color', `rgb(${from.map((n,i)=>Math.round(n+(to[i]-n)*level)).join(',')})`);
      }
      let hottest = 0;
      for (const entry of this.sensors.values()) {
        entry.level += ((stale ? 0 : entry.target) - entry.level) * blend;
        if (entry.level < .002) entry.level = 0;
        entry.node.dataset.level = entry.level.toFixed(3);
        entry.node.style.setProperty('--inscription-level', entry.level.toFixed(3));
        hottest = Math.max(hottest, entry.level);
      }
      this.values.temp.parentElement.dataset.level = hottest.toFixed(3);
      this.values.temp.parentElement.style.setProperty('--inscription-level', hottest.toFixed(3));
    }
  }
  root.StatusInscriptions = { Readings };
})(window);
