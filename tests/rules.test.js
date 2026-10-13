import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RULES, EXAMPLE } from "../src/constants.js";
import { canonClub, findByName, validateSquad, lineupProblems, autoLineup, evalRec, applyEvaluated, cleanRec, roundInfo, plural, countN, timeLeft, planText } from "../src/rules.js";
import { parseJsonLoose, callClaude } from "../src/ai.js";
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

test("plural odmienia po polsku", () => {
  const t = n => plural(n, "transfer", "transfery", "transferów");
  assert.equal(t(1), "transfer");
  assert.equal(t(2), "transfery");
  assert.equal(t(4), "transfery");
  assert.equal(t(5), "transferów");
  assert.equal(t(12), "transferów");
  assert.equal(t(22), "transfery");
  assert.equal(t(0), "transferów");
  assert.equal(countN(3, "problem", "problemy", "problemów"), "3 problemy");
});

test("timeLeft opisuje czas do terminu i zwraca null po terminie", () => {
  const now = new Date("2026-10-13T12:00:00Z").getTime();
  const at = ms => new Date(now + ms);
  assert.equal(timeLeft(at((2 * 24 + 3) * 3600e3), now), "2 dni 3 godz.");
  assert.equal(timeLeft(at(24 * 3600e3), now), "1 dzień");
  assert.equal(timeLeft(at((5 * 60 + 10) * 60e3), now), "5 godz. 10 min");
  assert.equal(timeLeft(at(12 * 60e3), now), "12 min");
  assert.equal(timeLeft(at(-1000), now), null);
});

test("walidacja podaje nazwiska zawodników bez ceny i bez klubu", () => {
  const cur = exampleCurrent();
  const players = cur.players.map(p => p.name === "Nico Paz" ? { ...p, price: "" } : p.name === "Ben White" ? { ...p, club: "" } : p);
  const v = validateSquad(players, 0, rules);
  assert.ok(v.errors.includes("Brak ceny: Paz."));
  assert.ok(v.warns.some(w => w.startsWith("Bez klubu: White.")));
  const empty = validateSquad(cur.players.map((p, i) => i < 2 ? { ...p, name: "" } : p), 0, rules);
  assert.ok(empty.errors.includes("Brakuje nazwisk: 2 miejsca bez zawodnika."));
});

test("planText opisuje transfery, kapitana, jedenastkę i bank", () => {
  const cur = exampleCurrent();
  const rec = cleanRec({
    transfers: [{ outId: "p14", in: { name: "Deniz Undav", club: "Stuttgart", pos: "FWD", price: 5.0, priceConfirmed: true } }],
    chip: "triplecaptain", captain: "Haaland", vice: "Olise",
  }, cur);
  const ev = evalRec(rec, ctx(cur));
  let n = 0;
  const after = applyEvaluated(cur, ev, rules, () => "x" + n++);
  const txt = planText({ forRound: 3, ev, after, hitCost: 4 });
  assert.match(txt, /^Plan na kolejkę 3/);
  assert.match(txt, /1\. Ermedin Demirović → Deniz Undav \(Stuttgart, 5\.0 M€\)/);
  assert.match(txt, /Chip: Triple Captain/);
  assert.match(txt, /Kapitan: Erling Haaland · Wicekapitan: Michael Olise/);
  assert.match(txt, /Bank: 0\.2 M€/);
  assert.doesNotMatch(txt, /Minusowe/);
  const lineup = txt.split("\n").find(l => l.startsWith("Jedenastka:"));
  assert.equal(lineup.split(/[;,]/).length, 11);
});

test("callClaude ponawia przy przeciążeniu, a błąd klucza zwraca od razu", async () => {
  const realFetch = globalThis.fetch;
  const ok = { ok: true, status: 200, headers: new Headers(), json: async () => ({ content: [{ type: "text", text: "{}" }], stop_reason: "end_turn" }) };
  const err = status => ({ ok: false, status, headers: new Headers(), json: async () => ({ error: { message: "x" } }) });
  try {
    let calls = 0; const retries = [];
    globalThis.fetch = async () => (++calls < 3 ? err(529) : ok);
    const res = await callClaude({ apiKey: "k", model: "m", prompt: "p", retryDelays: [1, 1], onRetry: n => retries.push(n) });
    assert.equal(res.text, "{}");
    assert.equal(calls, 3);
    assert.deepEqual(retries, [1, 2]);

    calls = 0;
    globalThis.fetch = async () => { calls++; return err(529); };
    await assert.rejects(callClaude({ apiKey: "k", model: "m", prompt: "p", retryDelays: [1] }), e => e.code === "overloaded");
    assert.equal(calls, 2);

    calls = 0;
    globalThis.fetch = async () => { calls++; return err(401); };
    await assert.rejects(callClaude({ apiKey: "k", model: "m", prompt: "p", retryDelays: [1, 1] }), e => e.code === "auth");
    assert.equal(calls, 1);
  } finally { globalThis.fetch = realFetch; }
});
