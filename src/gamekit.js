// Gamekit: the small engine shared by every game in the suite. It has no dependencies.
// Games draw into a portrait canvas 390 units wide, so one layout fits every phone.
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const easeOut = (t) => 1 - (1 - t) * (1 - t);
export const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export function hashSeed(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

/** A seeded generator (mulberry32), so levels are the same on every phone. */
export class Rng {
  constructor(seed = 1) { this.s = (typeof seed === "number" ? seed : hashSeed(seed)) >>> 0; }
  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  chance(p) { return this.next() < p; }
  pick(list) { return list[Math.floor(this.next() * list.length)]; }
  shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }
}

/** Saved progress. Falls back to memory when the browser blocks storage. */
export class Store {
  constructor(key, defaults = {}) {
    this.key = key;
    this.defaults = defaults;
    this.data = { ...structuredClone(defaults) };
    try {
      const raw = localStorage.getItem(key);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch { /* private window or corrupted data: start fresh */ }
  }
  save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch { /* the game still runs without saving */ }
  }
  reset() {
    this.data = { ...structuredClone(this.defaults), sound: this.data.sound, music: this.data.music, buzz: this.data.buzz };
    this.save();
  }
}

/** Sound effects and music made by synthesis, so the game ships no audio files. */
export class Sound {
  constructor(store) {
    this.store = store;
    this.ctx = null;
    this.timer = null;
    this.song = null;
  }
  unlock() {
    if (this.ctx || typeof AudioContext === "undefined") { if (this.ctx?.state === "suspended") this.ctx.resume(); return; }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    if (this.song) this.startLoop();
  }
  tone(freq, dur = 0.12, { type = "sine", vol = 0.25, slide = 0, delay = 0, force = false } = {}) {
    if (!this.ctx || (!force && this.store.data.sound === false)) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  noise(dur = 0.2, vol = 0.2, delay = 0) {
    if (!this.ctx || this.store.data.sound === false) return;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    g.gain.value = vol;
    s.buffer = buf;
    s.connect(g).connect(this.master);
    s.start(this.ctx.currentTime + delay);
  }
  play(name) {
    const p = {
      tap: () => this.tone(660, 0.05, { type: "triangle", vol: 0.12 }),
      ok: () => { this.tone(523, 0.08, { type: "triangle" }); this.tone(784, 0.12, { type: "triangle", delay: 0.07 }); },
      bad: () => this.tone(220, 0.2, { type: "sawtooth", vol: 0.14, slide: -90 }),
      coin: () => { this.tone(988, 0.06, { type: "square", vol: 0.08 }); this.tone(1319, 0.14, { type: "square", vol: 0.08, delay: 0.05 }); },
      hit: () => { this.tone(170, 0.1, { type: "square", vol: 0.12, slide: -90 }); this.noise(0.06, 0.1); },
      boom: () => { this.noise(0.35, 0.3); this.tone(90, 0.3, { type: "sawtooth", vol: 0.2, slide: -55 }); },
      power: () => this.tone(330, 0.3, { type: "sawtooth", vol: 0.1, slide: 700 }),
      win: () => [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.2, { type: "triangle", delay: i * 0.1 })),
      lose: () => [392, 311, 233].forEach((f, i) => this.tone(f, 0.28, { type: "sawtooth", vol: 0.12, delay: i * 0.16 })),
    }[name];
    if (p) p();
  }
  /** song = {bpm, bass: [...], lead: [...]}; 0 is a rest, other values are frequencies, one step per eighth note. */
  music(song) {
    this.stopMusic();
    this.song = song;
    if (this.ctx) this.startLoop();
  }
  startLoop() {
    if (this.timer || !this.song || !this.ctx) return;
    this.step = 0;
    this.nextAt = this.ctx.currentTime + 0.05;
    this.timer = setInterval(() => this.schedule(), 60);
  }
  schedule() {
    if (!this.ctx || !this.song || this.store.data.music === false || document.hidden) return;
    const gap = 30 / this.song.bpm;
    while (this.nextAt < this.ctx.currentTime + 0.2) {
      const delay = Math.max(0, this.nextAt - this.ctx.currentTime);
      const { bass, lead } = this.song;
      const b = bass[this.step % bass.length];
      const l = lead[this.step % lead.length];
      if (b) this.tone(b, gap * 1.6, { type: "triangle", vol: 0.1, delay, force: true });
      if (l) this.tone(l, gap * 1.1, { type: "sine", vol: 0.06, delay, force: true });
      this.step++;
      this.nextAt += gap;
    }
  }
  stopMusic() {
    clearInterval(this.timer);
    this.timer = null;
    this.song = null;
  }
}

/** Short bursts of shapes for hits, pickups and explosions. */
export class Particles {
  constructor() { this.list = []; }
  burst(x, y, color, n = 12, speed = 120, life = 0.5, size = 3) {
    for (let i = 0; i < n && this.list.length < 400; i++) {
      const a = Math.random() * TAU;
      const v = speed * (0.3 + Math.random() * 0.7);
      this.list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, size });
    }
  }
  float(x, y, text, color = "#fff", size = 16) {
    this.list.push({ x, y, vx: 0, vy: -46, life: 0.9, max: 0.9, color, size, text });
  }
  update(dt) {
    for (const p of this.list) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }
  draw(c) {
    for (const p of this.list) {
      c.globalAlpha = clamp(p.life / p.max, 0, 1);
      if (p.text) {
        text(c, p.text, p.x, p.y, { size: p.size, color: p.color, weight: 800 });
      } else {
        c.fillStyle = p.color;
        c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    c.globalAlpha = 1;
  }
}

export function rr(c, x, y, w, h, r = 10) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export function text(c, s, x, y, { size = 16, color = "#fff", align = "center", weight = 600, base = "middle" } = {}) {
  c.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  c.textAlign = align;
  c.textBaseline = base;
  c.fillStyle = color;
  c.fillText(s, x, y);
}

export function wrapLines(c, s, maxW, size = 14, weight = 500) {
  c.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const out = [];
  for (const para of String(s).split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? line + " " + word : word;
      if (c.measureText(next).width > maxW && line) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Draw wrapped text and return the y position below it. */
export function para(c, s, x, y, maxW, { size = 14, color = "#cbd5e1", align = "left", lh = 1.4, weight = 500 } = {}) {
  const lines = wrapLines(c, s, maxW, size, weight);
  lines.forEach((l, i) => text(c, l, x, y + i * size * lh, { size, color, align, weight, base: "top" }));
  return y + lines.length * size * lh;
}

export function panel(c, x, y, w, h, fill, r = 14, stroke = null) {
  rr(c, x, y, w, h, r);
  c.fillStyle = fill;
  c.fill();
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
}

export function bar(c, x, y, w, h, f, color, bg = "rgba(255,255,255,.12)") {
  panel(c, x, y, w, h, bg, h / 2);
  if (f > 0) panel(c, x, y, Math.max(h, w * clamp(f, 0, 1)), h, color, h / 2);
}

export function star(c, x, y, r, color) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const q = i % 2 ? r * 0.45 : r;
    c.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q);
  }
  c.closePath();
  c.fillStyle = color;
  c.fill();
}

export function dot(c, x, y, r, color) {
  c.beginPath();
  c.arc(x, y, Math.max(0, r), 0, TAU);
  c.fillStyle = color;
  c.fill();
}

/** Buttons that belong to one screen. */
export class Ui {
  constructor(game) {
    this.g = game;
    this.items = [];
    this.pressed = null;
  }
  clear() { this.items = []; this.pressed = null; }
  button(x, y, w, h, label, fn, opts = {}) {
    const b = { x, y, w, h, label, fn, ...opts };
    this.items.push(b);
    return b;
  }
  hit(p) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const b = this.items[i];
      if (!b.disabled && !b.hidden && inRect(p, b)) return b;
    }
    return null;
  }
  down(p) {
    const b = this.hit(p);
    if (b) this.pressed = b;
    return !!b;
  }
  up(p) {
    const b = this.pressed;
    this.pressed = null;
    if (b && inRect(p, b)) {
      this.g.sound.play("tap");
      this.g.buzz(8);
      b.fn(b);
      return true;
    }
    return !!b;
  }
  draw(c) {
    const th = this.g.theme;
    for (const b of this.items) {
      if (b.hidden) continue;
      const k = this.pressed === b ? 1.5 : 0;
      const kind = b.style || "ghost";
      const fill = b.disabled ? "rgba(255,255,255,.05)" : b.fill || { primary: th.accent, ghost: th.panel, danger: th.danger, clear: "rgba(0,0,0,0)" }[kind];
      const ink = b.disabled ? th.muted : b.ink || (kind === "primary" || kind === "danger" ? th.onAccent : th.ink);
      panel(c, b.x, b.y + k, b.w, b.h, fill, b.r ?? 12, b.stroke || (kind === "ghost" ? th.line : null));
      if (b.draw) b.draw(c, b, ink);
      else if (b.sub) {
        text(c, b.label, b.x + b.w / 2, b.y + b.h / 2 - 8 + k, { size: b.size || 15, color: ink, weight: 700 });
        text(c, b.sub, b.x + b.w / 2, b.y + b.h / 2 + 10 + k, { size: 11, color: ink, weight: 500 });
      } else text(c, b.label, b.x + b.w / 2, b.y + b.h / 2 + k, { size: b.size || 16, color: ink, weight: 700 });
    }
  }
}

export class Scene {
  constructor(game) {
    this.g = game;
    this.ui = new Ui(game);
    this.t = 0;
  }
  enter() {}
  update() {}
  draw() {}
  down() {}
  move() {}
  up() {}
  hidden() {}
}

export const THEME = { bg: "#0b1020", bg2: "#141c33", panel: "#1b2542", line: "rgba(255,255,255,.12)", ink: "#f1f5f9", muted: "#94a3b8", accent: "#38bdf8", onAccent: "#04121f", danger: "#ef4444", ok: "#22c55e", gold: "#fbbf24" };

/** The canvas, the loop, screens, input and saved settings. */
export class Game {
  constructor({ id, title, theme = {}, defaults = {} }) {
    this.id = id;
    this.title = title;
    this.theme = { ...THEME, ...theme };
    this.store = new Store("game:" + id, { sound: true, music: true, buzz: true, ...defaults });
    this.sound = new Sound(this.store);
    this.fx = new Particles();
    this.canvas = document.getElementById("game");
    this.c = this.canvas.getContext("2d");
    this.W = 390;
    this.H = 760;
    this.scene = null;
    this.next = null;
    this.fade = 0;
    this.shakeT = 0;
    this.last = 0;
    this.acc = 0;
    this.installEvent = null;
    this.resize();
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("orientationchange", () => this.resize());
    const pointer = (kind) => (e) => {
      e.preventDefault();
      this.pointer(kind, e.clientX, e.clientY, e.pointerId, true);
    };
    this.canvas.addEventListener("pointerdown", pointer("down"));
    this.canvas.addEventListener("pointermove", pointer("move"));
    this.canvas.addEventListener("pointerup", pointer("up"));
    this.canvas.addEventListener("pointercancel", pointer("up"));
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.scene?.hidden(); });
    window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); this.installEvent = e; });
    if ("serviceWorker" in navigator && /^https:|localhost/.test(location.href)) navigator.serviceWorker.register("sw.js").catch(() => {});
    window.__game = this;
  }
  resize() {
    const cw = window.innerWidth;
    const ch = window.innerHeight;
    if (!(cw > 0 && ch > 0)) return; // A page opened hidden has no size yet; a resize event follows when it gets one.
    const before = this.H;
    this.H = clamp((this.W * ch) / cw, 640, 860);
    const s = Math.min(cw / this.W, ch / this.H);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.scale = s * dpr;
    this.canvas.width = Math.round(this.W * s * dpr);
    this.canvas.height = Math.round(this.H * s * dpr);
    this.canvas.style.width = this.W * s + "px";
    this.canvas.style.height = this.H * s + "px";
    this.css = s;
    // Buttons near the bottom edge follow it, so a rotation or a browser bar cannot strand them off screen.
    if (this.scene) for (const b of this.scene.ui.items) if (b.y > before / 2) b.y += this.H - before;
  }
  /** Convert a browser position (or game units when raw is false) and pass it to the screen. */
  pointer(kind, x, y, id = 1, raw = false) {
    let p = { x, y, id };
    if (raw) {
      const r = this.canvas.getBoundingClientRect();
      p = { x: (x - r.left) / this.css, y: (y - r.top) / this.css, id };
    }
    if (kind === "down") {
      this.sound.unlock();
      if (raw) try { this.canvas.setPointerCapture(id); } catch { /* not every browser allows it */ }
    }
    const s = this.scene;
    if (!s || this.next) return;
    if (kind === "down") { if (!s.ui.down(p)) s.down(p); } else if (kind === "move") s.move(p);
    else if (!s.ui.up(p)) s.up(p);
  }
  buzz(ms) {
    if (this.store.data.buzz !== false && navigator.vibrate && navigator.userActivation?.hasBeenActive !== false) { try { navigator.vibrate(ms); } catch { /* unsupported */ } }
  }
  shake(t = 0.25) { this.shakeT = Math.max(this.shakeT, t); }
  go(scene) {
    if (this.scene) { this.next = scene; this.fade = 0.0001; } else this.enter(scene);
  }
  enter(scene) {
    this.scene = scene;
    this.fx.list = [];
    scene.ui.clear();
    scene.enter();
  }
  step(dt) {
    if (this.next) {
      this.fade += dt / 0.14;
      if (this.fade >= 1) { const n = this.next; this.next = null; this.fade = 1; this.enter(n); }
    } else if (this.fade > 0) this.fade = Math.max(0, this.fade - dt / 0.14);
    const s = this.scene;
    if (s) { s.t += dt; s.update(dt); }
    this.fx.update(dt);
    this.shakeT = Math.max(0, this.shakeT - dt);
  }
  render() {
    const c = this.c;
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    if (this.shakeT > 0) c.translate((Math.random() - 0.5) * 10 * this.shakeT, (Math.random() - 0.5) * 10 * this.shakeT);
    c.fillStyle = this.theme.bg;
    c.fillRect(-10, -10, this.W + 20, this.H + 20);
    if (this.scene) {
      this.scene.draw(c);
      this.scene.ui.draw(c);
      this.scene.over?.(c);
    }
    this.fx.draw(c);
    if (this.fade > 0) {
      c.fillStyle = `rgba(0,0,0,${clamp(this.fade, 0, 1)})`;
      c.fillRect(-10, -10, this.W + 20, this.H + 20);
    }
  }
  start(scene) {
    this.go(scene);
    const frame = (now) => {
      const d = Math.min(0.1, (now - (this.last || now)) / 1000);
      this.last = now;
      this.acc += d;
      let n = 0;
      while (this.acc >= 1 / 60 && n++ < 5) { this.step(1 / 60); this.acc -= 1 / 60; }
      if (n >= 5) this.acc = 0;
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}

/** A drifting star field, the default backdrop for menus. */
export function backdrop(c, g, t) {
  const grad = c.createLinearGradient(0, 0, 0, g.H);
  grad.addColorStop(0, g.theme.bg2);
  grad.addColorStop(1, g.theme.bg);
  c.fillStyle = grad;
  c.fillRect(0, 0, g.W, g.H);
  for (let i = 0; i < 46; i++) {
    const x = (i * 97.3) % g.W;
    const y = ((i * 53.7 + t * (6 + (i % 5) * 3)) % (g.H + 10)) - 5;
    dot(c, x, y, 0.6 + (i % 3) * 0.5, "rgba(255,255,255,.28)");
  }
}

export class Title extends Scene {
  /** opts: {tag, play(), buttons: [[label, fn]], art(c, g, t), help: [[heading, text]]} */
  constructor(game, opts) { super(game); this.o = opts; }
  enter() {
    const g = this.g;
    const o = this.o;
    const items = [["Play", o.play, "primary"], ...(o.buttons || []), ["How to play", () => g.go(new Help(g, o.help, this)), "ghost"], ["Settings", () => g.go(new Settings(g, this)), "ghost"]];
    let y = g.H - 72 - (items.length - 1) * 60;
    for (const [label, fn, style] of items) {
      this.ui.button(55, y, 280, 50, label, fn, { style: style || "ghost" });
      y += 60;
    }
    if (g.installEvent) this.ui.button(120, 18, 150, 34, "Install game", () => { g.installEvent.prompt(); g.installEvent = null; this.ui.items = this.ui.items.filter((b) => b.label !== "Install game"); }, { size: 13 });
  }
  draw(c) {
    const g = this.g;
    (this.o.art ? this.o.art(c, g, this.t) : backdrop(c, g, this.t));
    text(c, g.title, g.W / 2, 118, { size: g.title.length > 14 ? 38 : 46, weight: 900 });
    if (this.o.tag) text(c, this.o.tag, g.W / 2, 160, { size: 15, color: g.theme.accent, weight: 600 });
  }
}

export class Help extends Scene {
  constructor(game, pages, back) { super(game); this.pages = pages; this.back = back; this.i = 0; }
  enter() {
    const g = this.g;
    this.ui.button(24, g.H - 70, 110, 48, "Back", () => { if (this.i) this.i--; else g.go(this.back); });
    this.ui.button(256, g.H - 70, 110, 48, "Next", () => { if (this.i < this.pages.length - 1) this.i++; else g.go(this.back); }, { style: "primary" });
  }
  draw(c) {
    const g = this.g;
    backdrop(c, g, this.t);
    const [head, body] = this.pages[this.i];
    panel(c, 24, 70, g.W - 48, g.H - 170, g.theme.panel, 16, g.theme.line);
    text(c, head, g.W / 2, 110, { size: 24, weight: 800 });
    para(c, body, 46, 146, g.W - 92, { size: 16, color: g.theme.ink, lh: 1.5 });
    text(c, `${this.i + 1} of ${this.pages.length}`, g.W / 2, g.H - 46, { size: 13, color: g.theme.muted });
  }
}

export class Settings extends Scene {
  constructor(game, back) { super(game); this.back = back; }
  enter() {
    const g = this.g;
    const d = g.store.data;
    const flip = (key, label, y) => {
      const b = this.ui.button(55, y, 280, 52, "", () => {
        d[key] = d[key] === false;
        g.store.save();
        b.label = `${label}: ${d[key] === false ? "off" : "on"}`;
      });
      b.label = `${label}: ${d[key] === false ? "off" : "on"}`;
    };
    flip("sound", "Sound effects", 150);
    flip("music", "Music", 214);
    flip("buzz", "Vibration", 278);
    this.ui.button(55, 362, 280, 52, "Erase saved progress", () => g.go(new Confirm(g, "Erase all saved progress? This cannot be undone.", () => { g.store.reset(); g.go(this.back); }, this)), { style: "danger" });
    this.ui.button(55, g.H - 80, 280, 50, "Done", () => g.go(this.back), { style: "primary" });
  }
  draw(c) {
    backdrop(c, this.g, this.t);
    text(c, "Settings", this.g.W / 2, 92, { size: 30, weight: 800 });
  }
}

export class Confirm extends Scene {
  constructor(game, question, yes, back) { super(game); this.q = question; this.yes = yes; this.back = back; }
  enter() {
    const g = this.g;
    this.ui.button(55, 360, 130, 50, "Cancel", () => g.go(this.back));
    this.ui.button(205, 360, 130, 50, "Yes", () => this.yes(), { style: "danger" });
  }
  draw(c) {
    backdrop(c, this.g, this.t);
    para(c, this.q, this.g.W / 2, 250, 300, { size: 20, color: this.g.theme.ink, align: "center", weight: 700 });
  }
}

/** A paged grid of numbered levels. opts: {title, count, unlocked(i), stars(i), pick(i), back, page} */
export class LevelSelect extends Scene {
  constructor(game, opts) {
    super(game);
    this.o = opts;
    const first = Array.from({ length: opts.count }, (_, i) => i).filter(opts.unlocked).pop() || 0;
    this.page = opts.page ?? Math.floor(first / 20);
  }
  enter() { this.layout(); }
  layout() {
    const g = this.g;
    const o = this.o;
    this.ui.clear();
    const pages = Math.ceil(o.count / 20);
    const start = this.page * 20;
    for (let i = start; i < Math.min(o.count, start + 20); i++) {
      const col = (i - start) % 4;
      const row = Math.floor((i - start) / 4);
      const open = o.unlocked(i);
      this.ui.button(30 + col * 86, 120 + row * 96, 72, 84, String(i + 1), () => o.pick(i), {
        disabled: !open,
        draw: (c, b, ink) => {
          text(c, open ? b.label : "-", b.x + b.w / 2, b.y + 32, { size: 24, color: ink, weight: 800 });
          const n = open ? o.stars(i) : 0;
          for (let s = 0; s < 3; s++) star(c, b.x + b.w / 2 + (s - 1) * 19, b.y + 64, 8, s < n ? g.theme.gold : "rgba(255,255,255,.14)");
        },
      });
    }
    this.ui.button(24, g.H - 70, 90, 48, "Back", o.back);
    if (pages > 1) {
      this.ui.button(150, g.H - 70, 50, 48, "<", () => { this.page = Math.max(0, this.page - 1); this.layout(); }, { disabled: this.page === 0 });
      this.ui.button(210, g.H - 70, 50, 48, ">", () => { this.page = Math.min(pages - 1, this.page + 1); this.layout(); }, { disabled: this.page === pages - 1 });
    }
  }
  draw(c) {
    backdrop(c, this.g, this.t);
    text(c, this.o.title || "Choose a level", this.g.W / 2, 72, { size: 26, weight: 800 });
  }
}

/** The end of a level. opts: {title, lines, stars, buttons: [[label, fn, style]], good} */
export class Result extends Scene {
  constructor(game, opts) { super(game); this.o = opts; }
  enter() {
    const g = this.g;
    g.sound.play(this.o.good === false ? "lose" : "win");
    let y = g.H - 72 - (this.o.buttons.length - 1) * 60;
    for (const [label, fn, style] of this.o.buttons) {
      this.ui.button(55, y, 280, 50, label, fn, { style: style || "ghost" });
      y += 60;
    }
  }
  draw(c) {
    const g = this.g;
    const o = this.o;
    backdrop(c, g, this.t);
    text(c, o.title, g.W / 2, 120, { size: 34, weight: 900, color: o.good === false ? g.theme.danger : g.theme.ink });
    if (o.stars != null) {
      for (let s = 0; s < 3; s++) {
        const show = clamp((this.t - 0.2 - s * 0.25) / 0.2, 0, 1);
        star(c, g.W / 2 + (s - 1) * 66, 200, 28 * (s < o.stars ? easeOut(show) : 1), s < o.stars ? g.theme.gold : "rgba(255,255,255,.14)");
      }
    }
    (o.lines || []).forEach((l, i) => text(c, l, g.W / 2, 268 + i * 30, { size: 17, color: i ? g.theme.muted : g.theme.ink }));
  }
}

/** Turn a scale and a seed into a short looping tune for background music. */
export function compose(seed, bpm = 96, root = 110) {
  const rng = new Rng(seed);
  const scale = [0, 3, 5, 7, 10, 12, 15];
  const hz = (n) => root * 2 ** (n / 12);
  const chords = Array.from({ length: 4 }, () => rng.pick([0, 3, 5, 7, 10]));
  const bass = [];
  const lead = [];
  for (const ch of chords) {
    for (let i = 0; i < 8; i++) {
      bass.push(i % 4 === 0 ? hz(ch) : i % 4 === 2 && rng.chance(0.6) ? hz(ch + 12) : 0);
      lead.push(rng.chance(0.5) ? hz(ch + 24 + rng.pick(scale)) : 0);
    }
  }
  return { bpm, bass, lead };
}
