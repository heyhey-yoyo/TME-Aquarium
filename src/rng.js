export function hashSeed(input = 'TME-AQUARIUM') {
  let h = 2166136261 >>> 0;
  const text = String(input);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h += h << 13; h ^= h >>> 7; h += h << 3; h ^= h >>> 17; h += h << 5;
  return h >>> 0;
}

export class RNG {
  constructor(seed = 'TME-AQUARIUM') {
    this.state = hashSeed(seed) || 0x6d2b79f5;
  }
  next() {
    let t = this.state += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const result = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    this.state >>>= 0;
    return result;
  }
  range(min, max) { return min + (max - min) * this.next(); }
  int(min, maxInclusive) { return Math.floor(this.range(min, maxInclusive + 1)); }
  chance(probability) { return this.next() < probability; }
  pick(values) { return values[Math.floor(this.next() * values.length)]; }
  normal(mean = 0, sd = 1) {
    const u = Math.max(this.next(), 1e-9);
    const v = Math.max(this.next(), 1e-9);
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

export function makeShareCode(config) {
  const raw = JSON.stringify(config);
  let hash = hashSeed(raw).toString(36).toUpperCase().padStart(7, '0');
  return `TME-${hash.slice(0, 4)}-${hash.slice(4, 7)}-V1`;
}
