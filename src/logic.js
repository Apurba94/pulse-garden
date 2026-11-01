// Pulse Garden rules: charts composed from a seed, tap timing and scoring. No drawing or sound here, so it can be tested.
import { Rng, clamp } from "./gamekit.js";

export const SECTORS = 6, PERFECT = 0.05, GOOD = 0.11, LEAD_IN = 2.4;
export const TRACKS = [
  "First Light", "Moss Hymn", "Rain on Reeds", "Bee Dance", "Fern Spiral", "Noon Bloom",
  "Thistle Run", "Copper Beech", "Night Jasmine", "Storm Petal", "Ivy Machine", "Last Frost",
];
export const LEVELS = [
  { name: "Seedling", density: 0.3, approach: 1.7, pairs: 0, gap: 2 },
  { name: "Bloom", density: 0.5, approach: 1.3, pairs: 0.05, gap: 1 },
  { name: "Thorn", density: 0.72, approach: 1.0, pairs: 0.14, gap: 1 },
];
const SCALES = [[0, 2, 4, 7, 9], [0, 3, 5, 7, 10], [0, 2, 3, 7, 8], [0, 2, 5, 7, 9]];
const hz = (root, n) => root * 2 ** (n / 12);

/** Compose a song for a track: bass, percussion and a melody. The melody becomes the notes to tap. */
export function compose(track) {
  const rng = new Rng(3100 + track * 53);
  const scale = SCALES[track % SCALES.length];
  const bpm = 92 + track * 5;
  const root = rng.pick([174.6, 196, 220, 246.9]);
  const bars = 24 + (track % 4) * 4;
  const steps = bars * 8;
  const chords = Array.from({ length: 4 }, () => rng.pick([0, 0, 3, 5, 7, 8]));
  const bass = [], kick = [], tune = [];
  let at = rng.int(0, scale.length * 2);
  const phrase = Array.from({ length: 16 }, () => rng.chance(0.75));
  for (let s = 0; s < steps; s++) {
    const chord = chords[Math.floor(s / 8) % 4];
    bass.push(s % 8 === 0 || s % 8 === 3 || s % 8 === 6 ? hz(root / 2, chord) : 0);
    kick.push(s % 4 === 0);
    at = clamp(at + rng.int(-2, 2), 0, scale.length * 2 - 1);
    const pitch = scale[at % scale.length] + 12 * Math.floor(at / scale.length);
    tune.push({ on: phrase[s % 16] || s % 4 === 0, pitch, freq: hz(root, pitch), strong: s % 4 === 0 ? 2 : s % 2 === 0 ? 1 : 0 });
  }
  return { bpm, steps, bass, kick, tune, gap: 30 / bpm, length: steps * (30 / bpm) };
}

/** The notes for a track at a difficulty. The same song, thinned out for easier levels. */
export function makeChart(track, level) {
  const song = compose(track), d = LEVELS[level], rng = new Rng(track * 7 + level * 1009 + 11);
  const notes = [];
  let last = -9, lastSector = 0;
  song.tune.forEach((n, s) => {
    if (!n.on || s - last < d.gap + (level === 0 ? 1 : 0) || s < 8) return;
    const keep = n.strong === 2 ? 0.95 : n.strong === 1 ? d.density : d.density * 0.55;
    if (!rng.chance(keep)) return;
    const sector = (n.pitch + 60) % SECTORS;
    const near = sector === lastSector && s - last <= 1 ? (sector + 2) % SECTORS : sector;
    notes.push({ t: s * song.gap, sector: near, freq: n.freq, id: notes.length });
    lastSector = near;
    last = s;
    if (rng.chance(d.pairs) && n.strong) notes.push({ t: s * song.gap, sector: (near + 3) % SECTORS, freq: n.freq * 1.5, id: notes.length });
  });
  return { song, notes, level };
}

export class Session {
  constructor(chart) {
    this.chart = chart;
    this.notes = chart.notes.map((n) => ({ ...n, result: null }));
    this.next = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.score = 0;
    this.counts = { perfect: 0, good: 0, miss: 0 };
    this.done = false;
  }
  /** Tap on a sector at a song time. Returns the note hit and how well, or null. */
  tap(time, sector) {
    let best = null;
    for (let i = this.next; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.t - time > GOOD) break;
      if (n.result || n.sector !== sector) continue;
      const err = Math.abs(n.t - time);
      if (err <= GOOD && (!best || err < Math.abs(best.t - time))) best = n;
    }
    if (!best) return null;
    const err = Math.abs(best.t - time);
    best.result = err <= PERFECT ? "perfect" : "good";
    best.err = time - best.t;
    this.counts[best.result]++;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.score += (best.result === "perfect" ? 300 : 120) * (1 + Math.min(1, this.combo / 50));
    this.score = Math.round(this.score);
    return best;
  }
  /** Mark notes that have passed. Returns those just missed. */
  advance(time) {
    const out = [];
    while (this.next < this.notes.length) {
      const n = this.notes[this.next];
      if (n.result) { this.next++; continue; }
      if (time - n.t <= GOOD) break;
      n.result = "miss";
      this.counts.miss++;
      this.combo = 0;
      out.push(n);
      this.next++;
    }
    if (this.next >= this.notes.length) this.done = true;
    return out;
  }
  accuracy() {
    const t = this.notes.length;
    return t ? (this.counts.perfect + this.counts.good * 0.6) / t : 0;
  }
  stars() { const a = this.accuracy(); return a >= 0.92 ? 3 : a >= 0.8 ? 2 : a >= 0.6 ? 1 : 0; }
  /** Average early or late, which helps a player set the timing offset. */
  meanError() {
    const hits = this.notes.filter((n) => n.err != null);
    return hits.length ? hits.reduce((s, n) => s + n.err, 0) / hits.length : 0;
  }
}

export const sectorOf = (x, y, cx, cy) => {
  const a = Math.atan2(y - cy, x - cx) + Math.PI / 2 + Math.PI / SECTORS;
  return ((Math.floor(a / ((Math.PI * 2) / SECTORS)) % SECTORS) + SECTORS) % SECTORS;
};

export const sectorAngle = (s) => (s * Math.PI * 2) / SECTORS - Math.PI / 2;
