import assert from "node:assert/strict";
import test from "node:test";
import { GOOD, LEVELS, PERFECT, SECTORS, Session, TRACKS, compose, makeChart, sectorAngle, sectorOf } from "../src/logic.js";

const chart = (times, sector = 0) => ({ notes: times.map((t, id) => ({ t, sector, freq: 440, id })) });

function perform(s, late = 0) {
  for (const n of s.notes) {
    s.advance(n.t + late);
    s.tap(n.t + late, n.sector);
  }
  s.advance(1e9);
  return s;
}

test("songs and charts repeat exactly, and tracks differ", () => {
  assert.deepEqual(makeChart(3, 1), makeChart(3, 1));
  assert.notDeepEqual(compose(3).tune, compose(4).tune);
});

test("every note in every chart is on the beat grid and in time order", () => {
  for (let t = 0; t < TRACKS.length; t++) {
    for (let l = 0; l < LEVELS.length; l++) {
      const { notes, song } = makeChart(t, l);
      assert.ok(notes.length > 20, `track ${t} level ${l}: ${notes.length} notes`);
      for (let i = 0; i < notes.length; i++) {
        const steps = notes[i].t / song.gap;
        assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9);
        assert.ok(notes[i].sector >= 0 && notes[i].sector < SECTORS);
        if (i) assert.ok(notes[i].t >= notes[i - 1].t);
        assert.ok(notes[i].t < song.length);
      }
    }
  }
});

test("harder levels mean more notes and a shorter approach", () => {
  for (let t = 0; t < TRACKS.length; t++) {
    const n = LEVELS.map((_, l) => makeChart(t, l).notes.length);
    assert.ok(n[0] < n[1] && n[1] < n[2], `track ${t}: ${n}`);
  }
  assert.ok(LEVELS[0].approach > LEVELS[2].approach);
});

test("no chart asks for two taps on one ring at once, or more than two fingers", () => {
  for (let t = 0; t < TRACKS.length; t++) {
    const { notes } = makeChart(t, 2);
    const at = new Map();
    for (const n of notes) { if (!at.has(n.t)) at.set(n.t, []); at.get(n.t).push(n.sector); }
    for (const list of at.values()) {
      assert.ok(list.length <= 2);
      assert.equal(new Set(list).size, list.length);
    }
  }
});

test("the easiest level leaves a playable gap between notes", () => {
  for (let t = 0; t < TRACKS.length; t++) {
    const { notes, song } = makeChart(t, 0);
    for (let i = 1; i < notes.length; i++) assert.ok(notes[i].t - notes[i - 1].t >= song.gap * 2.9, `track ${t}`);
  }
});

test("a tap on time is perfect, a little off is good, far off is nothing", () => {
  const s = new Session(chart([1, 2, 3]));
  assert.equal(s.tap(1 + PERFECT - 0.001, 0).result, "perfect");
  assert.equal(s.tap(2 - GOOD + 0.001, 0).result, "good");
  assert.equal(s.tap(3 - GOOD - 0.05, 0), null);
});

test("the wrong ring does not count", () => {
  const s = new Session(chart([1]));
  assert.equal(s.tap(1, 3), null);
  assert.equal(s.notes[0].result, null);
});

test("the same note cannot be hit twice", () => {
  const s = new Session(chart([1]));
  assert.ok(s.tap(1, 0));
  assert.equal(s.tap(1.01, 0), null);
  assert.equal(s.counts.perfect, 1);
});

test("a tap takes the closest of two notes on the same ring", () => {
  const s = new Session(chart([1, 1.1]));
  assert.equal(s.tap(1.09, 0).id, 1);
});

test("a late note counts as missed and breaks the streak", () => {
  const s = new Session(chart([1, 2, 3]));
  s.tap(1, 0);
  assert.equal(s.combo, 1);
  const miss = s.advance(2 + GOOD + 0.01);
  assert.equal(miss.length, 1);
  assert.equal(s.combo, 0);
  assert.equal(s.counts.miss, 1);
});

test("two notes at once can both be hit", () => {
  const s = new Session({ notes: [{ t: 1, sector: 0, id: 0 }, { t: 1, sector: 3, id: 1 }] });
  assert.ok(s.tap(1, 3));
  assert.ok(s.tap(1, 0));
  s.advance(5);
  assert.equal(s.accuracy(), 1);
});

test("a perfect performance earns three stars and no misses", () => {
  for (const [t, l] of [[0, 0], [5, 1], [11, 2]]) {
    const s = perform(new Session(makeChart(t, l)));
    assert.equal(s.counts.miss, 0);
    assert.equal(s.stars(), 3);
    assert.equal(s.bestCombo, s.notes.length);
    assert.ok(s.done);
  }
});

test("doing nothing scores nothing", () => {
  const s = new Session(makeChart(2, 1));
  s.advance(1e9);
  assert.equal(s.score, 0);
  assert.equal(s.stars(), 0);
  assert.equal(s.counts.miss, s.notes.length);
});

test("streaks raise the score", () => {
  const a = perform(new Session(chart(Array.from({ length: 100 }, (_, i) => i))));
  const b = new Session(chart(Array.from({ length: 100 }, (_, i) => i)));
  b.notes.forEach((n, i) => { b.advance(n.t); if (i % 2) b.tap(n.t, 0); });
  b.advance(1e9);
  assert.ok(a.score > b.score * 2.2);
});

test("a consistently late player gets told by how much", () => {
  const s = perform(new Session(chart([1, 2, 3, 4])), 0.08);
  assert.ok(Math.abs(s.meanError() - 0.08) < 1e-9);
  assert.equal(s.counts.good, 4);
});

test("touches map to the nearest ring", () => {
  for (let i = 0; i < SECTORS; i++) {
    const a = sectorAngle(i);
    assert.equal(sectorOf(100 + Math.cos(a) * 50, 100 + Math.sin(a) * 50, 100, 100), i);
    assert.equal(sectorOf(100 + Math.cos(a + 0.4) * 50, 100 + Math.sin(a + 0.4) * 50, 100, 100), i);
  }
});
