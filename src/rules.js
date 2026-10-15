// Czyste funkcje: normalizacja nazw, walidacja składu i jedenastki, ocena planu AI.
// Bez DOM i bez stanu globalnego, żeby dało się je testować w Node (npm test).

import { POS, POS_PL, POS_ONE, CLUBS, ALIAS, CHIPS } from "./constants.js";

export const r1 = n => Math.round(Number(n) * 10) / 10;
export const fmt = n => (n !== "" && n !== null && n !== undefined && isFinite(Number(n))) ? r1(n).toFixed(1) : "–";

// Polska odmiana po liczbie: plural(5, "transfer", "transfery", "transferów") -> "transferów".
export function plural(n, one, few, many) {
  n = Math.abs(Math.trunc(Number(n) || 0));
  if (n === 1) return one;
  const d = n % 10, h = n % 100;
  return d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
}
export const countN = (n, one, few, many) => `${n} ${plural(n, one, few, many)}`;

// Czas do terminu: "2 dni 3 godz.", "5 godz. 10 min", "12 min"; null, gdy termin minął.
export function timeLeft(deadline, now = Date.now()) {
  const ms = new Date(deadline).getTime() - now;
  if (!(ms > 0)) return null;
  const m = Math.ceil(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  if (d) return `${countN(d, "dzień", "dni", "dni")}${h ? ` ${h} godz.` : ""}`;
  if (h) return `${h} godz.${min ? ` ${min} min` : ""}`;
  return `${min} min`;
}

export function norm(s) {
  return String(s || "")
    .replace(/[øØ]/g, "o").replace(/[łŁ]/g, "l").replace(/[đĐ]/g, "d").replace(/ß/g, "ss").replace(/[æÆ]/g, "ae")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

export function canonClub(c) {
  const n = norm(c);
  if (!n) return "";
  const exact = CLUBS.find(x => norm(x) === n);
  if (exact) return exact;
  if (ALIAS[n]) return ALIAS[n];
  if (n.length >= 4) {
    const hits = CLUBS.filter(x => norm(x).includes(n));
    if (hits.length === 1) return hits[0];
  }
  return String(c).trim();
}

export function normPos(p) {
  const n = norm(p);
  if (["gk", "bramkarz", "goalkeeper", "g"].includes(n)) return "GK";
  if (["def", "d", "obronca", "defender"].includes(n)) return "DEF";
  if (["mid", "m", "pomocnik", "midfielder"].includes(n)) return "MID";
  if (["fwd", "f", "napastnik", "forward", "att", "st"].includes(n)) return "FWD";
  return null;
}

export const lastName = n => {
  const parts = String(n || "").trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : parts[0] || "?";
};

// Dopasowanie nazwiska z odpowiedzi AI do zawodnika: pełne, zawieranie, potem samo nazwisko.
export function findByName(players, name) {
  const n = norm(name);
  if (!n) return null;
  const exact = players.find(x => norm(x.name) === n);
  if (exact) return exact;
  let hits = players.filter(x => { const xn = norm(x.name); return xn.includes(n) || n.includes(xn); });
  if (hits.length === 1) return hits[0];
  const last = n.split(" ").pop();
  hits = players.filter(x => norm(x.name).split(" ").pop() === last);
  return hits.length === 1 ? hits[0] : null;
}

export function validateSquad(players, bank, rules) {
  const errors = [], warns = [];
  const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  players.forEach(p => { if (counts[p.pos] != null) counts[p.pos]++; });
  POS.forEach(pos => {
    if (counts[pos] !== rules.squad[pos]) errors.push(`${POS_PL[pos]}: ${counts[pos]} zamiast ${rules.squad[pos]}.`);
  });
  const empty = players.filter(p => !String(p.name).trim()).length;
  if (empty) errors.push(`Brakuje nazwisk: ${countN(empty, "miejsce", "miejsca", "miejsc")} bez zawodnika.`);
  const seen = {};
  players.forEach(p => {
    const n = norm(p.name);
    if (!n) return;
    if (seen[n]) errors.push(`${p.name} jest w składzie dwa razy.`);
    seen[n] = 1;
  });
  const byClub = {};
  players.forEach(p => { if (p.club) byClub[p.club] = (byClub[p.club] || 0) + 1; });
  Object.entries(byClub).forEach(([c, n]) => {
    if (n > rules.maxPerClub) errors.push(`Za dużo zawodników z klubu ${c}: ${n} (limit ${rules.maxPerClub}).`);
  });
  const named = players.filter(p => String(p.name).trim());
  const names = list => list.map(p => lastName(p.name)).join(", ");
  const noClub = named.filter(p => !p.club);
  if (noClub.length) warns.push(`Bez klubu: ${names(noClub)}. Limit na klub nie jest dla nich sprawdzany.`);
  const unknown = [...new Set(players.filter(p => p.club && !CLUBS.includes(p.club)).map(p => p.club))];
  if (unknown.length) warns.push(`Nieznany klub: ${unknown.join(", ")}. Sprawdź, czy gra w fazie ligowej LM.`);
  const noPrice = named.filter(p => !isFinite(parseFloat(p.price)));
  if (noPrice.length) errors.push(`Brak ceny: ${names(noPrice)}.`);
  if (isFinite(bank) && bank < -0.05) errors.push(`Przekroczony budżet o ${fmt(-bank)} M€.`);
  return { errors, warns, counts };
}

export function lineupProblems(players, xi, rules) {
  const probs = [];
  const ids = new Set(players.map(p => p.id));
  if (xi.length !== 11 || new Set(xi).size !== 11 || xi.some(id => !ids.has(id))) {
    probs.push("Jedenastka musi mieć 11 różnych zawodników ze składu.");
    return probs;
  }
  const c = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  xi.forEach(id => { c[players.find(x => x.id === id).pos]++; });
  POS.forEach(pos => {
    const [mn, mx] = rules.formation[pos];
    if (c[pos] < mn || c[pos] > mx) probs.push(`${POS_PL[pos]} w jedenastce: ${c[pos]} (dozwolone ${mn === mx ? mn : mn + "–" + mx}).`);
  });
  return probs;
}

export function autoLineup(players) {
  const by = pos => players.filter(p => p.pos === pos);
  const take = { GK: 1, DEF: 4, MID: 4, FWD: 2 };
  if (by("FWD").length < 2) {
    take.FWD = by("FWD").length;
    take.MID = Math.min(5, by("MID").length);
    take.DEF = 11 - 1 - take.MID - take.FWD;
  }
  const xi = [];
  POS.forEach(pos => by(pos).slice(0, take[pos]).forEach(p => xi.push(p.id)));
  return { xi, bench: benchOrder(players, xi) };
}

// Ławka: bramkarz rezerwowy pierwszy, potem w kolejności `preferred` (jeśli podana).
export function benchOrder(players, xi, preferred) {
  const rest = players.filter(p => !xi.includes(p.id));
  const gk = rest.filter(p => p.pos === "GK");
  const out = rest.filter(p => p.pos !== "GK");
  if (preferred && preferred.length) {
    out.sort((a, b) => {
      const ia = preferred.indexOf(a.id), ib = preferred.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }
  return [...gk, ...out].map(p => p.id);
}

// Najdroższy zawodnik z pola w jedenastce (domyślny kapitan), z pominięciem `skip`.
export function pickCaptain(players, xi, skip) {
  const c = xi.map(id => players.find(p => p.id === id)).filter(p => p && p.pos !== "GK" && p.id !== skip)
    .sort((a, b) => b.price - a.price)[0];
  return c ? c.id : null;
}

// Porządkuje surową odpowiedź AI do stałego kształtu planu.
export function cleanRec(res, current) {
  const transfers = (Array.isArray(res.transfers) ? res.transfers : []).map(t => {
    t = t || {};
    const out = current.players.find(p => p.id === t.outId) || findByName(current.players, t.outName || t.outId || t.out);
    const inn = t.in || {};
    return {
      outId: out ? out.id : String(t.outId || ""),
      outName: out ? out.name : String(t.outName || t.outId || ""),
      in: {
        name: String(inn.name || "").trim(),
        club: canonClub(inn.club),
        pos: normPos(inn.pos) || (out ? out.pos : "MID"),
        price: isFinite(parseFloat(inn.price)) ? r1(inn.price) : "",
        priceConfirmed: inn.priceConfirmed === true,
      },
      reason: String(t.reason || ""),
    };
  });
  const arr = a => Array.isArray(a) ? a.map(x => String(x)) : [];
  return {
    summary: String(res.summary || ""),
    transfers,
    chip: CHIPS.some(c => c.key === res.chip) ? res.chip : null,
    chipReason: String(res.chipReason || ""),
    captain: String(res.captain || ""),
    vice: String(res.vice || ""),
    startingXI: arr(res.startingXI),
    bench: arr(res.bench),
    watchlist: (Array.isArray(res.watchlist) ? res.watchlist : []).slice(0, 6)
      .map(w => ({ name: String((w || {}).name || ""), club: String((w || {}).club || ""), note: String((w || {}).note || "") })),
    risks: arr(res.risks).slice(0, 6),
  };
}

/**
 * Sprawdza plan AI względem zasad i zwraca skład po zmianach.
 * ctx = { current, rules, chips, free }
 * errors blokują zastosowanie planu; warns są tylko informacją.
 */
export function evalRec(rec, ctx) {
  const { current: cur, rules, chips, free } = ctx;
  const errors = [], warns = [];
  const players = cur.players.map(p => ({ ...p }));
  let bank = Number(cur.bank) || 0;
  const swaps = {}, list = [];

  (rec.transfers || []).forEach((t, i) => {
    const out = cur.players.find(p => p.id === t.outId) || findByName(cur.players, t.outName || t.outId);
    const inn = t.in || {};
    if (!out) { errors.push(`Transfer ${i + 1}: nie wiadomo, kogo sprzedać.`); return; }
    if (swaps[out.id]) { errors.push(`${out.name} jest sprzedawany dwa razy.`); return; }
    const pos = normPos(inn.pos) || out.pos;
    const price = parseFloat(inn.price);
    if (!String(inn.name || "").trim()) { errors.push(`Transfer ${i + 1}: brak nazwiska kupowanego zawodnika.`); return; }
    const already = players.find(p => !p.temp && !swaps[p.id] && p.id !== out.id && norm(p.name) === norm(inn.name));
    if (already) errors.push(`${inn.name} już jest w składzie.`);
    if (!isFinite(price)) errors.push(`${inn.name}: brak ceny.`);
    if (pos !== out.pos) warns.push(`${inn.name} (${POS_ONE[pos]}) zastępuje ${out.name} (${POS_ONE[out.pos]}).`);
    if (inn.priceConfirmed === false) warns.push(`Sprawdź w aplikacji cenę: ${inn.name} (${fmt(price)} M€).`);
    const tmp = "t" + i;
    swaps[out.id] = tmp;
    bank = bank + Number(out.price) - (isFinite(price) ? price : 0);
    const idx = players.findIndex(p => p.id === out.id);
    players[idx] = { id: tmp, temp: true, name: String(inn.name).trim(), club: canonClub(inn.club), pos, price: isFinite(price) ? r1(price) : null };
    list.push({ out, inn: players[idx], reason: t.reason || "" });
  });

  bank = r1(bank);
  const sq = validateSquad(players, bank, rules);
  errors.push(...sq.errors);
  sq.warns.forEach(w => { if (!warns.includes(w)) warns.push(w); });

  const chip = rec.chip && CHIPS.some(c => c.key === rec.chip) ? rec.chip : null;
  if (chip && !chips[chip]) errors.push(`Chip ${CHIPS.find(c => c.key === chip).label} został już wykorzystany.`);
  const unlimited = chip === "wildcard" || chip === "freehit";
  const hits = unlimited ? 0 : Math.max(0, list.length - free);
  if (hits) warns.push(`${countN(hits, "transfer", "transfery", "transferów")} ponad darmowe: −${hits * rules.hitCost} pkt.`);

  const xiIds = [...new Set((rec.startingXI || []).map(n => findByName(players, n)).filter(Boolean).map(p => p.id))];
  const lineupOk = xiIds.length === 11 && lineupProblems(players, xiIds, rules).length === 0;
  let xi = null, bench = null;
  if (lineupOk) {
    xi = xiIds;
    const pref = (rec.bench || []).map(n => findByName(players, n)).filter(Boolean).map(p => p.id);
    bench = benchOrder(players, xi, pref);
  } else if ((rec.startingXI || []).length) {
    warns.push("Jedenastka od AI nie pasuje do zasad. Zostanie obecne ustawienie (nowi zawodnicy wejdą na miejsca sprzedanych).");
  }

  const capP = findByName(players, rec.captain), viceP = findByName(players, rec.vice);
  const inXI = p => p && (xi
    ? xi.includes(p.id)
    : (cur.xi.includes(p.id) || Object.entries(swaps).some(([o, t]) => t === p.id && cur.xi.includes(o))));
  const captain = inXI(capP) ? capP.id : null;
  const vice = inXI(viceP) && (!capP || viceP.id !== capP.id) ? viceP.id : null;
  if (rec.captain && !captain) warns.push(`Kapitan „${rec.captain}” nie jest w jedenastce – zostanie obecny.`);

  return { errors, warns, players, bank, swaps, list, chip, hits, free, xi, bench, lineupOk, captain, vice };
}

/**
 * Zwraca nowy obiekt `current` po zastosowaniu ocenionego planu (bez błędów).
 * newId — generator identyfikatorów dla kupionych zawodników.
 */
export function applyEvaluated(cur, ev, rules, newId) {
  const idMap = {};
  const players = ev.players.map(p => {
    if (p.temp) { const nid = newId(); idMap[p.id] = nid; return { id: nid, name: p.name, club: p.club, pos: p.pos, price: p.price }; }
    return { id: p.id, name: p.name, club: p.club, pos: p.pos, price: p.price };
  });
  const mapId = id => idMap[id] || id;
  const viaSwap = id => ev.swaps[id] ? mapId(ev.swaps[id]) : id;
  let xi, bench;
  if (ev.lineupOk) { xi = ev.xi.map(mapId); bench = ev.bench.map(mapId); }
  else {
    xi = cur.xi.map(viaSwap); bench = cur.bench.map(viaSwap);
    if (lineupProblems(players, xi, rules).length) ({ xi, bench } = autoLineup(players));
  }
  let captain = ev.captain ? mapId(ev.captain) : viaSwap(cur.captain);
  if (!xi.includes(captain)) captain = pickCaptain(players, xi) || xi[0];
  let vice = ev.vice ? mapId(ev.vice) : viaSwap(cur.vice);
  if (!xi.includes(vice) || vice === captain) vice = pickCaptain(players, xi, captain);
  return { players, bank: ev.bank, xi, bench, captain, vice };
}

/**
 * Plan jako zwykły tekst do skopiowania (żeby przepisać go w Sofascore).
 * after — wynik applyEvaluated(); ev — wynik evalRec().
 */
export function planText({ forRound, ev, after, hitCost }) {
  const byId = id => after.players.find(p => p.id === id);
  const nm = id => { const p = byId(id); return p ? p.name : "?"; };
  const lines = [`Plan na kolejkę ${forRound}`];
  if (ev.list.length) {
    lines.push(`Transfery (${ev.list.length}):`);
    ev.list.forEach((t, i) => lines.push(`${i + 1}. ${t.out.name} → ${t.inn.name} (${t.inn.club || "klub ?"}, ${fmt(t.inn.price)} M€)`));
  } else lines.push("Transfery: brak");
  const chip = ev.chip ? CHIPS.find(c => c.key === ev.chip) : null;
  if (chip) lines.push(`Chip: ${chip.label}`);
  lines.push(`Kapitan: ${nm(after.captain)}${after.vice ? ` · Wicekapitan: ${nm(after.vice)}` : ""}`);
  const xi = after.xi.map(byId).filter(Boolean);
  lines.push("Jedenastka: " + POS.map(pos => xi.filter(p => p.pos === pos).map(p => lastName(p.name)).join(", ")).filter(Boolean).join("; "));
  lines.push("Ławka: " + after.bench.map(id => lastName(nm(id))).join(", "));
  lines.push(`Bank: ${fmt(after.bank)} M€`);
  if (ev.hits) lines.push(`Minusowe punkty: −${ev.hits * hitCost}`);
  return lines.join("\n");
}

/**
 * Ranking ligi znajomych z zapisanych historii kolejek (panel admina).
 * entries = [{ id, name, state }] -> [{ id, name, total, played, lastRound, lastPoints, transfers, rank }]
 * Remis w sumie punktów = to samo miejsce.
 */
export function leagueTable(entries) {
  const rows = (entries || []).map(e => {
    const rounds = e.state && Array.isArray(e.state.rounds) ? e.state.rounds : [];
    const scored = rounds.filter(r => r && r.points !== "" && r.points != null && isFinite(Number(r.points)));
    const last = scored.reduce((a, r) => (!a || r.n > a.n ? r : a), null);
    return {
      id: e.id, name: e.name || "?",
      total: scored.reduce((s, r) => s + Number(r.points), 0),
      played: scored.length,
      lastRound: last ? last.n : null,
      lastPoints: last ? Number(last.points) : null,
      transfers: rounds.reduce((s, r) => s + ((r && r.transfers) || []).length, 0),
    };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "pl"));
  rows.forEach((r, i) => { r.rank = i > 0 && r.total === rows[i - 1].total ? rows[i - 1].rank : i + 1; });
  return rows;
}

/**
 * Terminarz od admina (tabela game_data) nałożony na wbudowany (constants.js).
 * Kolejki/mecze od admina wygrywają; brakujące zostają z wbudowanych. Zwraca { rounds, fixtures }.
 */
export function mergeGameData(baseRounds, baseFixtures, gd) {
  const rounds = baseRounds.map(r => ({ ...r }));
  ((gd && Array.isArray(gd.rounds)) ? gd.rounds : []).forEach(r => {
    if (!r || !Number.isFinite(Number(r.n)) || !r.ko || isNaN(new Date(r.ko).getTime())) return;
    const n = Number(r.n), i = rounds.findIndex(x => x.n === n);
    const row = { n, ko: r.ko, sure: r.sure !== false };
    if (i >= 0) rounds[i] = row; else rounds.push(row);
  });
  rounds.sort((a, b) => a.n - b.n);
  const fixtures = { ...baseFixtures };
  Object.entries((gd && gd.fixtures) || {}).forEach(([n, txt]) => { if (String(txt || "").trim()) fixtures[n] = String(txt); });
  return { rounds, fixtures };
}

// Kolejka, przed którą jesteśmy, liczona z terminarza (termin = pierwszy mecz − 30 min).
export function roundInfo(rounds, now = Date.now()) {
  const next = rounds.find(r => new Date(r.ko).getTime() - 30 * 60000 > now);
  if (!next) return { next: null, done: rounds.length };
  return { next, done: next.n - 1, deadline: new Date(new Date(next.ko).getTime() - 30 * 60000) };
}
