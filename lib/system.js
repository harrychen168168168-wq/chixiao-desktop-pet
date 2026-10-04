const os = require('os');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

class SystemStats extends EventEmitter {
  constructor() {
    super();
    this.gpu = null;
    this.cpuTemp = null;
    this.lhmNextProbe = 0;
    this.timer = null;
    this.smi = null;
    this.stopped = false;
  }

  start() {
    this.startSmi();
    this.tick();
    this.timer = setInterval(() => this.tick(), 2000);
  }

  startSmi() {
    const args = ['--query-gpu=name,memory.used,memory.total,temperature.gpu,utilization.gpu', '--format=csv,noheader,nounits', '-lms', '2000'];
    try {
      this.smi = spawn('nvidia-smi', args, { windowsHide: true });
    } catch {
      this.smi = null;
      return;
    }
    let buf = '';
    this.smi.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        const [name, used, total, temp, util] = line.split(',').map((s) => s.trim());
        if (!total || Number.isNaN(Number(total))) continue;
        this.gpu = { name, usedMB: Number(used), totalMB: Number(total), temp: Number(temp), util: Number(util), at: Date.now() };
      }
    });
    this.smi.on('error', () => { this.smi = null; });
    this.smi.on('exit', () => {
      this.smi = null;
      if (!this.stopped) setTimeout(() => this.startSmi(), 10000);
    });
  }

  async readLhm() {
    if (Date.now() < this.lhmNextProbe) return;
    try {
      const res = await fetch('http://localhost:8085/data.json', { signal: AbortSignal.timeout(800) });
      const root = await res.json();
      let found = null;
      const walk = (n) => {
        if (found || !n) return;
        if (/^(CPU Package|Core Max|Core \(Tctl\/Tdie\))$/i.test(n.Text || '') && /°C/.test(n.Value || '')) found = parseFloat(n.Value);
        (n.Children || []).forEach(walk);
      };
      walk(root);
      this.cpuTemp = Number.isFinite(found) ? found : null;
    } catch {
      this.cpuTemp = null;
      this.lhmNextProbe = Date.now() + 60000; // not running: look again in a minute
    }
  }

  async tick() {
    await this.readLhm();
    const total = os.totalmem();
    const free = os.freemem();
    const gpuFresh = this.gpu && Date.now() - this.gpu.at < 10000 ? this.gpu : null;
    this.last = {
      at: Date.now(),
      ram: { usedGB: (total - free) / 2 ** 30, totalGB: total / 2 ** 30 },
      vram: gpuFresh ? { usedGB: gpuFresh.usedMB / 1024, totalGB: gpuFresh.totalMB / 1024, name: gpuFresh.name } : null,
      gpuTemp: gpuFresh ? gpuFresh.temp : null,
      gpuUtil: gpuFresh ? gpuFresh.util : null,
      cpuTemp: this.cpuTemp,
    };
    this.emit('update', this.last);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    if (this.smi) this.smi.kill();
  }
}

module.exports = { SystemStats };
