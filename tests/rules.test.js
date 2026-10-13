import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RULES, EXAMPLE } from "../src/constants.js";
import { canonClub, findByName, validateSquad, lineupProblems, autoLineup, evalRec, applyEvaluated, cleanRec, roundInfo } from "../src/rules.js";
import { parseJsonLoose } from "../src/ai.js";
import { ROUNDS } from "../src/constants.js";

const rules = DEFAULT_RULES;

function exampleCurrent() {
  const players = EXAMPLE.map(([name, club, pos, price], i) => ({ id: "p" + i, name, club, pos, price }));
  const { xi, bench } = autoLineup(players);
  return { players, bank: 0.1, xi, bench, captain: "p12", vice: "p8" };
}
const ctx = (current, extra = {}) => ({ current, rules, chips: { wildcard: true, freehit: true, triplecaptain: true }, free: 2, ...extra });

test("canonClub rozpoznaje skróty i polskie nazwy", () => {
  assert.equal(canonClub("psg"), "Paris Saint-Germain");
  assert.equal(canonClub("Bayern Monachium"), "Bayern München");
  assert.equal(canonClub("bodo glimt"), "Bodø/Glimt");
  assert.equal(canonClub("Dortmund"), "Borussia Dortmund");
  assert.equal(canonClub("Jakiś Klub"), "Jakiś Klub");
});

test("findByName dopasowuje bez polskich znaków i po samym nazwisku", () => {
  const players = exampleCurrent().players;
  assert.equal(findByName(players, "Odegaard").name, "Martin Ødegaard");
  assert.equal(findByName(players, "Demirovic").name, "Ermedin Demirović");
  assert.equal(findByName(players, "Haaland").id, "p12");
  assert.equal(findByName(players, "Nikt"), null);
});

test("przykładowy skład jest zgodny z zasadami", () => {
  const cur = exampleCurrent();
  const v = validateSquad(cur.players, cur.bank, rules);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(lineupProblems(cur.players, cur.xi, rules), []);
});

test("walidacja wyłapuje limit klubu, budżet i liczbę pozycji", () => {
  const cur = exampleCurrent();
  const players = cur.players.map(p => p.name === "Nico Paz" ? { ...p, club: "Barcelona" } : p)
    .map(p => p.name === "Ben White" ? { ...p, club: "Barcelona" } : p);
  const v = validateSquad(players, -1, rules);
  assert.ok(v.errors.some(e => e.includes("Barcelona")));
  assert.ok(v.errors.some(e => e.includes("budżet")));
  const v2 = validateSquad(cur.players.slice(1), 0, rules);
  assert.ok(v2.errors.some(e => e.startsWith("Bramkarze")));
});

test("poprawny transfer: bank się przelicza, nowy zawodnik wchodzi na miejsce sprzedanego", () => {
  const cur = exampleCurrent();
  const rec = cleanRec({
    transfers: [{ outId: "p14", in: { name: "Deniz Undav", club: "Stuttgart", pos: "FWD", price: 5.0, priceConfirmed: true }, reason: "test" }],
    captain: "Haaland", vice: "Olise",
  }, cur);
  // Stuttgart miał 2 zawodników (Stiller, Demirović) – sprzedajemy Demirovicia, kupujemy Undava: nadal 2.
  const ev = evalRec(rec, ctx(cur));
  assert.deepEqual(ev.errors, []);
  assert.equal(ev.bank, 0.2);
  assert.equal(ev.hits, 0);
  let n = 0;
  const next = applyEvaluated(cur, ev, rules, () => "new" + n++);
  assert.ok(next.players.some(p => p.name === "Deniz Undav" && p.id === "new0"));
  assert.ok(!next.players.some(p => p.name === "Ermedin Demirović"));
  assert.equal(next.xi.includes("p14"), false);
  assert.equal(next.captain, "p12");
});

test("plan przekraczający budżet albo limit klubu jest blokowany", () => {
  const cur = exampleCurrent();
  const tooExpensive = evalRec({ transfers: [{ outId: "p14", in: { name: "Harry Kane", club: "Bayern München", pos: "FWD", price: 11 } }] }, ctx(cur));
  assert.ok(tooExpensive.errors.some(e => e.includes("budżet")));
  const clubLimit = evalRec({ transfers: [{ outId: "p6", in: { name: "Pau Cubarsí", club: "Barcelona", pos: "DEF", price: 4.5 } },
    { outId: "p11", in: { name: "Pedri", club: "Barcelona", pos: "MID", price: 5.5 } }] }, ctx(cur));
  assert.ok(clubLimit.errors.some(e => e.includes("Barcelona")));
});

test("transfery ponad limit dają minusowe punkty, Wildcard je znosi, zużyty chip blokuje", () => {
  const cur = exampleCurrent();
  const t = [
    { outId: "p14", in: { name: "Deniz Undav", club: "Stuttgart", pos: "FWD", price: 5.0 } },
    { outId: "p6", in: { name: "Ezri Konsa", club: "Aston Villa", pos: "DEF", price: 4.5 } },
    { outId: "p1", in: { name: "Yann Sommer", club: "Club Brugge", pos: "GK", price: 4.5 } },
  ];
  assert.equal(evalRec({ transfers: t }, ctx(cur)).hits, 1);
  assert.equal(evalRec({ transfers: t, chip: "wildcard" }, ctx(cur)).hits, 0);
  const used = evalRec({ transfers: t, chip: "wildcard" }, ctx(cur, { chips: { wildcard: false, freehit: true, triplecaptain: true } }));
  assert.ok(used.errors.some(e => e.includes("Wildcard")));
});

test("zakup zawodnika, który już jest w składzie, jest błędem", () => {
  const cur = exampleCurrent();
  const ev = evalRec({ transfers: [{ outId: "p11", in: { name: "Lamine Yamal", club: "Barcelona", pos: "MID", price: 12.1 } }] }, ctx(cur));
  assert.ok(ev.errors.some(e => e.includes("już jest w składzie")));
});

test("parseJsonLoose czyta JSON z blokiem kodu i z tekstem dookoła", () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Oto plan:\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(parseJsonLoose('Plan: {"a":3} – powodzenia'), { a: 3 });
  assert.throws(() => parseJsonLoose("brak json"));
});

test("roundInfo wskazuje kolejkę 3 przed terminem 20 października", () => {
  const ri = roundInfo(ROUNDS, new Date("2026-10-14T23:00:00+02:00").getTime());
  assert.equal(ri.next.n, 3);
  assert.equal(ri.done, 2);
  assert.equal(ri.deadline.toISOString(), new Date("2026-10-20T18:15:00+02:00").toISOString());
});
