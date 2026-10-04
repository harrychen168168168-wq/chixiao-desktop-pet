(function (root) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const inside = (b, a, margin = 10) => ({
    ...b, x: clamp(b.x, a.x + margin, a.x + a.width - b.width - margin),
    y: clamp(b.y, a.y + margin, a.y + a.height - b.height - margin),
  });
  class Roam {
    constructor({ bounds, area, move, notify = () => {}, random = Math.random, now = Date.now, config = {} }) {
      Object.assign(this, { bounds, area, move, notify, random, now });
      this.enabled = config.enabled !== false;
      this.speed = clamp(Number(config.speed) || 52, 20, 100);
      this.wait = config.everySeconds || [35, 75];
      this.state = { action: 'idle', blocked: true, canWalk: false, hovering: false };
      this.trip = null;
      this.mode = null;
      this.last = now();
      this.later();
    }
    later() {
      const lo = clamp(Number(this.wait[0]) || 35, 10, 300);
      const hi = clamp(Number(this.wait[1]) || 75, lo, 600);
      this.next = this.now() + (lo + this.random() * (hi - lo)) * 1000;
    }
    report(s) { Object.assign(this.state, s); }
    toggle(on) { this.enabled = Boolean(on); this.stop(); return this.enabled; }
    stop() {
      const active = Boolean(this.trip || this.mode);
      this.trip = null; this.mode = null; this.later();
      if (active) this.notify({ moving: false, playing: false });
    }
    blocked() {
      const s = this.state;
      return s.blocked || s.hovering || !s.canWalk || !['idle', 'walk'].includes(s.action);
    }
    go(target, kind = 'wander') {
      if (this.blocked()) return false;
      const b = this.bounds(), a = this.area();
      const t = inside({ ...b, ...target }, a);
      if (Math.hypot(t.x - b.x, t.y - b.y) < 12) return false;
      this.trip = { x: b.x, y: b.y, target: t, kind };
      this.last = this.now();
      this.notify({ moving: true, playing: kind === 'play', facing: t.x >= b.x ? 'right' : 'left' });
      return true;
    }
    play() { this.stop(); this.mode = { until: this.now() + 30000, next: 0 }; }
    tick(cursor, paused = false) {
      const now = this.now(), dt = Math.min(0.06, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      if (paused || this.blocked()) { if (this.trip || this.mode) this.stop(); return; }
      if (this.mode && now >= this.mode.until) this.stop();
      if (!this.trip && this.mode && now >= this.mode.next) {
        const b = this.bounds(), a = this.area();
        this.mode.next = now + 2500;
        const side = cursor.x < a.x + a.width / 2 ? 90 : -b.width - 90;
        this.go({ x: cursor.x + side, y: cursor.y - b.height / 2 }, 'play');
      }
      if (!this.trip && !this.mode && this.enabled && now >= this.next) {
        const b = this.bounds(), a = this.area();
        for (let i = 0; i < 8; i++) {
          const t = inside({ ...b, x: b.x + (this.random() - 0.5) * 1000, y: b.y + (this.random() - 0.5) * 600 }, a);
          if (Math.hypot(t.x - b.x, t.y - b.y) < 100) continue;
          if (cursor.x >= t.x - 90 && cursor.x <= t.x + b.width + 90 && cursor.y >= t.y - 70 && cursor.y <= t.y + b.height + 70) continue;
          if (this.go(t)) break;
        }
        this.later();
      }
      if (!this.trip) return;
      const t = this.trip, b = this.bounds(), a = this.area();
      t.target = inside({ ...b, x: t.target.x, y: t.target.y }, a);
      const dx = t.target.x - t.x, dy = t.target.y - t.y, distance = Math.hypot(dx, dy);
      const step = this.speed * dt;
      if (distance <= Math.max(1, step)) {
        this.move(t.target);
        this.trip = null;
        this.notify({ moving: false, playing: Boolean(this.mode) });
        this.later();
      } else {
        t.x += dx / distance * step; t.y += dy / distance * step;
        const next = inside({ ...b, x: Math.round(t.x), y: Math.round(t.y) }, a);
        this.move(next);
      }
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { Roam, inside };
  else root.DeskRoam = { Roam, inside };
})(typeof window === 'undefined' ? globalThis : window);
