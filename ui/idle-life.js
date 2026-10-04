(function (root) {
  const PLANS = [
    ['tilt'], ['nod'], ['shake'], ['stretch'], ['think'], ['happy'],
    ['tilt', 'nod'], ['think', 'tilt'], ['stretch', 'shake'], ['happy', 'tilt'],
  ];
  class IdleLife {
    constructor({ now = () => Date.now(), random = () => Math.random(), every = [8, 18] } = {}) {
      Object.assign(this, { now, random, every });
      this.bag = []; this.recent = []; this.nextAt = now() + 6000;
      this.bodyBag = []; this.motionTurn = 0; this.lastBody = null;
    }
    rest() {
      const lo = Math.max(2, Number(this.every[0]) || 8), hi = Math.max(lo, Number(this.every[1]) || 18);
      this.nextAt = this.now() + (lo + this.random() * (hi - lo)) * 1000;
    }
    take(available, hovering = false) {
      if (this.now() < this.nextAt) return null;
      const broad = ['stretch', 'think', 'happy'].filter(n => available[n]?.wholeBody);
      if (!hovering && broad.length && this.motionTurn % 3 !== 1) {
        this.bodyBag = this.bodyBag.filter(n => broad.includes(n));
        if (!this.bodyBag.length) {
          this.bodyBag = [...broad];
          for (let i = this.bodyBag.length - 1; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1));
            [this.bodyBag[i], this.bodyBag[j]] = [this.bodyBag[j], this.bodyBag[i]];
          }
        }
        let i = this.bodyBag.findIndex(n => n !== this.lastBody);
        if (i < 0) i = 0;
        const name = this.bodyBag.splice(i, 1)[0];
        this.lastBody = name; this.motionTurn++;
        this.recent = [...this.recent, name].slice(-2);
        return [name];
      }
      const usable = (p) => p.every((n) => available[n]) && (!broad.length || p.every(n => !broad.includes(n))) && (!hovering || p.length === 1 && ['nod', 'tilt'].includes(p[0]));
      if (!PLANS.some(usable)) return null;
      if (!this.bag.some(usable)) {
        this.bag = PLANS.filter((p) => p.every((n) => available[n])).map((p) => [...p]);
        for (let i = this.bag.length - 1; i > 0; i--) {
          const j = Math.floor(this.random() * (i + 1));
          [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
        }
      }
      let i = this.bag.findIndex((p) => usable(p) && !this.recent.includes(p[0]));
      if (i < 0) i = this.bag.findIndex(usable);
      const plan = this.bag.splice(i, 1)[0];
      this.recent = [...this.recent, ...plan].slice(-2);
      if (!hovering) this.motionTurn++;
      return plan;
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { IdleLife };
  else root.IdleLife = IdleLife;
})(typeof window === 'undefined' ? globalThis : window);
