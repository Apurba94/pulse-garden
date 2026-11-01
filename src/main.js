// Pulse Garden screens: the bloom ring, the song clock and the garden that grows from your score.
import { Game, Result, Scene, Title, backdrop, bar, dot, panel, star, text, TAU, clamp } from "./gamekit.js";
import { GOOD, LEAD_IN, LEVELS, SECTORS, Session, TRACKS, makeChart, sectorAngle, sectorOf } from "./logic.js";

export const game = new Game({ id: "pulse-garden", title: "Pulse Garden", theme: { accent: "#34d399", onAccent: "#04201a", bg: "#04120f", bg2: "#0b2a23", panel: "#123a30" }, defaults: { stars: {}, best: {}, offset: 0, flowers: 0 } });
const data = game.store.data;
const PETALS = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#fb923c"];
const R = 158;

const HELP = [
  ["The ring", "Blooms grow outward from the centre. Tap the ring where a bloom meets it, just as it arrives. You can use several fingers."],
  ["The music", "Every song is composed by your phone from a seed. The notes you tap are the melody, so a good run plays the tune."],
  ["Scoring", "Perfect taps score most, and a long streak raises every hit. Reach 60% accuracy to finish a song and open the next."],
  ["Timing", "If your taps always feel early or late, Bluetooth headphones may be the reason. Change the timing offset on the song list."],
];

function bloom(c, x, y, r, color, t = 0) {
  for (let i = 0; i < 6; i++) {
    const a = (i * TAU) / 6 + t;
    dot(c, x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.52, color);
  }
  dot(c, x, y, r * 0.42, "#fef3c7");
}

function art(c, g, t) {
  backdrop(c, g, t);
  for (let i = 0; i < 6; i++) {
    const a = t * 0.4 + (i * TAU) / 6;
    bloom(c, 195 + Math.cos(a) * 92, 340 + Math.sin(a) * 92, 15 + Math.sin(t * 2 + i) * 3, PETALS[i], t);
  }
}

const title = () => new Title(game, { tag: `${data.flowers} flowers grown`, art, help: HELP, play: () => game.go(new Songs(game)) });
const tag = (track, level) => `${track}-${level}`;
const open = (track) => track === 0 || LEVELS.some((_, l) => (data.stars[tag(track - 1, l)] || 0) > 0);

class Songs extends Scene {
  constructor(g, page = 0) { super(g); this.page = page; this.level = 0; }
  enter() { this.layout(); }
  layout() {
    const g = this.g, ui = this.ui;
    ui.clear();
    LEVELS.forEach((d, i) => ui.button(20 + i * 120, 66, 110, 42, d.name, () => { this.level = i; this.layout(); }, { style: this.level === i ? "primary" : "ghost", size: 14 }));
    const count = Math.floor((g.H - 260) / 62), start = this.page * count;
    TRACKS.slice(start, start + count).forEach((name, n) => {
      const i = start + n, b = ui.button(20, 122 + n * 62, 350, 54, name, () => g.go(new Play(g, i, this.level)), {
        disabled: !open(i),
        draw: (c, q, ink) => {
          text(c, open(i) ? name : "Locked", q.x + 16, q.y + 27, { size: 16, align: "left", color: ink, weight: 700 });
          const s = data.stars[tag(i, this.level)] || 0;
          for (let k = 0; k < 3; k++) star(c, q.x + q.w - 70 + k * 22, q.y + 27, 9, k < s ? g.theme.gold : "rgba(255,255,255,.14)");
        },
      });
      void b;
    });
    const pages = Math.ceil(TRACKS.length / count);
    const y = g.H - 126;
    if (pages > 1) {
      ui.button(20, y, 80, 42, "Back", () => { this.page = Math.max(0, this.page - 1); this.layout(); }, { disabled: !this.page, size: 13 });
      ui.button(110, y, 80, 42, "More", () => { this.page = Math.min(pages - 1, this.page + 1); this.layout(); }, { disabled: this.page >= pages - 1, size: 13 });
    }
    ui.button(200, y, 60, 42, "-10", () => { data.offset -= 10; g.store.save(); }, { size: 13 });
    ui.button(310, y, 60, 42, "+10", () => { data.offset += 10; g.store.save(); }, { size: 13 });
    ui.button(55, g.H - 70, 280, 50, "Menu", () => g.go(title()));
  }
  draw(c) {
    const g = this.g;
    backdrop(c, g, this.t);
    text(c, "Songs", g.W / 2, 38, { size: 26, weight: 800 });
    text(c, `${data.offset} ms`, 285, g.H - 112, { size: 12, color: g.theme.muted });
    text(c, "offset", 285, g.H - 96, { size: 10, color: g.theme.muted });
  }
}

class Play extends Scene {
  constructor(g, track, level) { super(g); this.track = track; this.level = level; }
  get cy() { return this.g.H / 2 - 10; }
  enter() {
    this.chart = makeChart(this.track, this.level);
    this.s = new Session(this.chart);
    this.ref = 0;
    this.step = 0;
    this.flash = Array(SECTORS).fill(0);
    this.garden = [];
    this.call = null;
    this.paused = false;
    this.ctx0 = null;
    this.g.sound.stopMusic();
    this.pause = this.ui.button(this.g.W - 72, 10, 62, 34, "Pause", () => this.toggle(), { size: 13 });
    this.quit = this.ui.button(95, this.cy - 25, 200, 50, "Quit song", () => this.g.go(new Songs(this.g)), { hidden: true, style: "danger" });
  }
  hidden() { if (!this.paused) this.toggle(); }
  toggle() {
    this.paused = !this.paused;
    this.quit.hidden = !this.paused;
    this.pause.label = this.paused ? "Play" : "Pause";
    this.ctx0 = null;
  }
  /** Song time: the audio clock when there is one, as it does not drift. Negative during the lead-in. */
  time(dt) {
    const a = this.g.sound.ctx;
    if (a?.state === "running") {
      if (this.ctx0 == null) this.ctx0 = a.currentTime - this.ref;
      this.ref = a.currentTime - this.ctx0;
    } else {
      // A phone can suspend audio at any moment, and its clock stops with it. The song must not.
      this.ref += dt;
      this.ctx0 = null;
    }
    return this.ref - LEAD_IN;
  }
  schedule(now) {
    const sound = this.g.sound, song = this.chart.song;
    if (sound.ctx?.state !== "running" || this.g.store.data.music === false) { this.step = Math.max(this.step, Math.ceil(now / song.gap)); return; }
    while (this.step < song.steps && this.step * song.gap < now + 0.25) {
      const at = this.step * song.gap, delay = Math.max(0, at - now);
      if (at >= now - 0.02) {
        if (song.bass[this.step]) sound.tone(song.bass[this.step], song.gap * 1.5, { type: "triangle", vol: 0.16, delay, force: true });
        if (song.kick[this.step]) sound.tone(120, 0.1, { type: "sine", vol: 0.2, slide: -70, delay, force: true });
      }
      this.step++;
    }
  }
  update(dt) {
    if (this.paused) return;
    const now = this.time(dt);
    this.now = now;
    this.flash = this.flash.map((f) => Math.max(0, f - dt * 4));
    if (now >= 0) this.schedule(now);
    for (const n of this.s.advance(now + data.offset / 1000)) this.call = { text: "Miss", color: "#fb7185", t: 0.5, sector: n.sector };
    if (this.call) { this.call.t -= dt; if (this.call.t <= 0) this.call = null; }
    if (this.s.done && now > this.chart.notes.at(-1).t + 1.2) this.finish();
  }
  down(p) {
    if (this.paused || p.y < 50) return;
    const g = this.g, sector = sectorOf(p.x, p.y, g.W / 2, this.cy);
    this.flash[sector] = 1;
    const hit = this.s.tap(this.now + data.offset / 1000, sector);
    if (!hit) return;
    g.sound.tone(hit.freq, 0.28, { type: "triangle", vol: 0.2, force: true });
    g.buzz(6);
    this.call = hit.result === "perfect" ? { text: "Perfect", color: g.theme.gold, t: 0.45, sector } : { text: "Good", color: "#a7f3d0", t: 0.45, sector };
    const a = sectorAngle(sector), x = g.W / 2 + Math.cos(a) * R, y = this.cy + Math.sin(a) * R;
    g.fx.burst(x, y, PETALS[sector], 10, 130, 0.45);
    if (this.garden.length < 140) this.garden.push({ x: 14 + ((hit.id * 73) % 362), y: g.H - 12 - ((hit.id * 37) % 60), size: 3 + (hit.id % 4), color: PETALS[sector], born: this.t });
  }
  finish() {
    const g = this.g, s = this.s, key = tag(this.track, this.level), stars = s.stars();
    if (stars > (data.stars[key] || 0)) data.stars[key] = stars;
    if (s.score > (data.best[key] || 0)) data.best[key] = s.score;
    data.flowers += s.counts.perfect + s.counts.good;
    g.store.save();
    const err = Math.round(s.meanError() * 1000);
    const hint = Math.abs(err) >= 25 ? `You tap ${Math.abs(err)} ms ${err < 0 ? "early" : "late"} on average` : "Your timing is well centred";
    const buttons = [["Play again", () => g.go(new Play(g, this.track, this.level)), stars ? "ghost" : "primary"], ["Songs", () => g.go(new Songs(g))]];
    if (stars && this.track + 1 < TRACKS.length) buttons.unshift(["Next song", () => g.go(new Play(g, this.track + 1, this.level)), "primary"]);
    g.go(new Result(g, { title: stars ? "In full bloom" : "Wilted", good: stars > 0, stars, lines: [`Score ${s.score}`, `${Math.round(s.accuracy() * 100)}% accuracy, best streak ${s.bestCombo}`, `${s.counts.perfect} perfect, ${s.counts.good} good, ${s.counts.miss} missed`, hint], buttons }));
  }
  draw(c) {
    const g = this.g, s = this.s, cx = g.W / 2, cy = this.cy, d = LEVELS[this.level], now = this.now ?? -LEAD_IN;
    backdrop(c, g, this.t * 0.3);
    for (const f of this.garden) {
      const k = clamp((this.t - f.born) / 0.4, 0, 1);
      c.strokeStyle = "#166534";
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(f.x, g.H);
      c.lineTo(f.x, f.y);
      c.stroke();
      bloom(c, f.x, f.y, f.size * k, f.color);
    }
    text(c, TRACKS[this.track], 14, 18, { size: 14, align: "left", weight: 800 });
    text(c, String(s.score), 14, 40, { size: 20, align: "left", weight: 900, color: g.theme.gold });
    bar(c, 110, 34, 160, 6, clamp(now / this.chart.song.length, 0, 1), g.theme.accent);
    if (s.combo > 4) text(c, `${s.combo}`, cx, cy - 12, { size: 34, weight: 900 });
    if (s.combo > 4) text(c, "streak", cx, cy + 16, { size: 11, color: g.theme.muted });
    for (let i = 0; i < SECTORS; i++) {
      const a = sectorAngle(i), x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
      c.strokeStyle = "rgba(255,255,255,.08)";
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * 34, cy + Math.sin(a) * 34);
      c.lineTo(x, y);
      c.stroke();
      c.beginPath();
      c.arc(x, y, 30 + this.flash[i] * 6, 0, TAU);
      c.strokeStyle = PETALS[i];
      c.lineWidth = 3;
      c.stroke();
      if (this.flash[i]) dot(c, x, y, 28, PETALS[i] + "55");
    }
    for (const n of s.notes) {
      if (n.result && n.result !== "miss") continue;
      const left = n.t - now;
      if (left > d.approach || left < -GOOD * 2) continue;
      const u = 1 - left / d.approach, r = 34 + (R - 34) * u, a = sectorAngle(n.sector);
      c.globalAlpha = n.result === "miss" ? 0.25 : 1;
      bloom(c, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 8 + u * 11, PETALS[n.sector]);
      c.globalAlpha = 1;
    }
    if (this.call) { const a = sectorAngle(this.call.sector); text(c, this.call.text, cx + Math.cos(a) * 96, cy + Math.sin(a) * 96, { size: 16, weight: 800, color: this.call.color }); }
    if (now < 0) text(c, now < -1 ? "Get ready" : "Tap the rings", cx, cy, { size: 18, weight: 800 });
    if (this.paused) { panel(c, 60, cy - 90, 270, 60, "rgba(0,0,0,.7)", 12); text(c, "Paused", cx, cy - 60, { size: 24, weight: 800 }); }
  }
}

game.start(title());
