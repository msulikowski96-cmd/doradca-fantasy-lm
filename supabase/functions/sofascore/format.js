// Czysta logika: zamiana meczów z SofaScore na terminarz aplikacji (testy: tests/sofascore.test.js).

const DAYS = ["Nd", "Pn", "Wt", "Śr", "Cz", "Pt", "Sb"];

function warsawParts(tsSeconds) {
  const parts = new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  }).formatToParts(new Date(tsSeconds * 1000));
  const get = t => (parts.find(p => p.type === t) || {}).value;
  // Dzień tygodnia liczymy sami (krótkie nazwy z Intl różnią się między środowiskami).
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return { ymd, label: `${DAYS[dow]} ${get("day")}.${get("month")}`, time: `${get("hour")}:${get("minute")}` };
}

/**
 * events: [{ homeTeam:{name}, awayTeam:{name}, startTimestamp }]
 * Zwraca tekst w stylu FIXTURES: "Wt 20.10 (18:45): A – B, C – D\nWt 20.10 (21:00): …"
 */
export function fixturesText(events) {
  const sorted = (events || [])
    .filter(e => e && e.homeTeam && e.awayTeam && Number.isFinite(e.startTimestamp))
    .slice().sort((a, b) => a.startTimestamp - b.startTimestamp);
  const groups = [];
  for (const e of sorted) {
    const p = warsawParts(e.startTimestamp);
    const key = `${p.label} (${p.time})`;
    let g = groups.find(x => x.key === key);
    if (!g) { g = { key, games: [] }; groups.push(g); }
    g.games.push(`${e.homeTeam.name} – ${e.awayTeam.name}`);
  }
  return groups.map(g => `${g.key}: ${g.games.join(", ")}`).join("\n");
}

/** Pierwszy mecz kolejki jako ISO (termin w aplikacji = pierwszy mecz − 30 min). */
export function firstKickoff(events) {
  const ts = (events || []).map(e => e && e.startTimestamp).filter(Number.isFinite);
  return ts.length ? new Date(Math.min(...ts) * 1000).toISOString() : null;
}

/** Wybiera sezon fazy ligowej, np. "26/27" z listy sezonów SofaScore. */
export function pickSeason(seasons, year) {
  return (seasons || []).find(s => s && (s.year === year || String(s.name || "").includes(year))) || null;
}

/**
 * rounds: { [n]: events[] } -> { fixtures: {n: text}, rounds: [{n, ko, sure}] }
 * Kolejki bez meczów są pomijane.
 */
export function buildGameData(roundsEvents) {
  const fixtures = {}, rounds = [];
  Object.keys(roundsEvents || {}).map(Number).sort((a, b) => a - b).forEach(n => {
    const ev = roundsEvents[n] || [];
    if (!ev.length) return;
    fixtures[n] = fixturesText(ev);
    rounds.push({ n, ko: firstKickoff(ev), sure: true });
  });
  return { fixtures, rounds };
}
