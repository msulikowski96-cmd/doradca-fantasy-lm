import { test } from "node:test";
import assert from "node:assert/strict";
import { fixturesText, firstKickoff, pickSeason, buildGameData } from "../supabase/functions/sofascore/format.js";

const ts = iso => Math.floor(new Date(iso).getTime() / 1000);
const ev = (h, a, iso) => ({ homeTeam: { name: h }, awayTeam: { name: a }, startTimestamp: ts(iso) });

test("SofaScore: mecze grupowane po dniu i godzinie w czasie polskim", () => {
  const events = [
    ev("Liverpool", "Villarreal", "2026-10-20T19:00:00Z"),
    ev("Fenerbahçe", "Slavia Praha", "2026-10-20T16:45:00Z"),
    ev("Roma", "Slovan Bratislava", "2026-10-20T19:00:00Z"),
    ev("Lille", "Galatasaray", "2026-10-21T16:45:00Z"),
  ];
  assert.equal(fixturesText(events),
    "Wt 20.10 (18:45): Fenerbahçe – Slavia Praha\n" +
    "Wt 20.10 (21:00): Liverpool – Villarreal, Roma – Slovan Bratislava\n" +
    "Śr 21.10 (18:45): Lille – Galatasaray");
  assert.equal(firstKickoff(events), "2026-10-20T16:45:00.000Z");
});

test("SofaScore: czas zimowy (listopad) też w polskiej strefie", () => {
  assert.equal(fixturesText([ev("Inter", "Arsenal", "2026-11-24T17:45:00Z")]), "Wt 24.11 (18:45): Inter – Arsenal");
});

test("SofaScore: wybór sezonu i budowa danych gry bez pustych kolejek", () => {
  const seasons = [{ id: 1, name: "UEFA Champions League 25/26", year: "25/26" }, { id: 2, name: "UEFA Champions League 26/27", year: "26/27" }];
  assert.equal(pickSeason(seasons, "26/27").id, 2);
  assert.equal(pickSeason(seasons, "27/28"), null);
  const gd = buildGameData({ 1: [ev("A", "B", "2026-09-08T16:45:00Z")], 2: [], 3: [ev("C", "D", "2026-10-20T16:45:00Z")] });
  assert.deepEqual(Object.keys(gd.fixtures), ["1", "3"]);
  assert.deepEqual(gd.rounds, [
    { n: 1, ko: "2026-09-08T16:45:00.000Z", sure: true },
    { n: 3, ko: "2026-10-20T16:45:00.000Z", sure: true },
  ]);
});
