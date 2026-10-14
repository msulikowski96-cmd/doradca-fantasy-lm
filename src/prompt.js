// Treść zapytań do AI (Claude lub Gemini). Czyste funkcje — łatwo je zmieniać i testować.

import { CLUBS, CHIPS, STYLES } from "./constants.js";
import { fmt, norm } from "./rules.js";

/**
 * Prompt analizy po kolejce.
 * opts = { done, next, free, fixtures, hasImages, fix? }
 * fix = { rec, errors } gdy prosimy o poprawienie planu łamiącego zasady.
 */
export function buildAnalysisPrompt(state, opts) {
  const r = state.rules, cur = state.current, d = state.draftRound;
  const { done, next, free, fixtures, hasImages, fix } = opts;
  const chipsAvail = CHIPS.filter(c => state.chips[c.key]).map(c => `${c.label} ("${c.key}")`).join(", ") || "brak";
  const pts = d.playerPts || {};
  const curLines = cur.players.map(p => {
    let s = `${p.id} | ${p.pos} | ${p.name} | ${p.club || "?"} | ${fmt(p.price)} M€ | ${cur.xi.includes(p.id) ? "XI" : "ławka"}`;
    if (p.id === cur.captain) s += " | KAPITAN";
    else if (p.id === cur.vice) s += " | VICE";
    if (pts[p.id] !== undefined && pts[p.id] !== "") s += ` | ${pts[p.id]} pkt w K${done}`;
    return s;
  }).join("\n");
  const orig = state.original ? state.original.players.map(p => `${p.pos} ${p.name} (${p.club || "?"})`).join("; ") : "nie zapisano";
  const stillOrig = state.original ? cur.players.filter(p => state.original.players.some(o => norm(o.name) === norm(p.name))).length : null;
  const hist = state.rounds.slice(-5).map(h =>
    `K${h.n}: ${h.points !== "" && h.points != null ? h.points + " pkt" : "pkt ?"}; transfery: ${(h.transfers || []).map(t => t.out + " → " + t.in).join(", ") || "brak"}${h.chip ? "; chip: " + h.chip : ""}`
  ).join("\n") || "brak";
  const style = STYLES.find(s => s.key === state.style) || STYLES[1];

  let p = `Jesteś doradcą w grze Sofascore Fantasy – Liga Mistrzów 2026/27. Użytkownik zakończył kolejkę ${done} i przygotowuje skład na kolejkę ${next}. Zaproponuj zmiany.

ZASADY GRY (twarde, nie wolno ich łamać):
- Skład: 15 zawodników: ${r.squad.GK} GK, ${r.squad.DEF} DEF, ${r.squad.MID} MID, ${r.squad.FWD} FWD. Każdy transfer to wymiana zawodnika na innego z tej samej pozycji.
- Bank teraz: ${fmt(cur.bank)} M€. Po każdym transferze: bank = bank + cena sprzedawanego − cena kupowanego. Bank po wszystkich transferach musi być ≥ 0.
- Maksymalnie ${r.maxPerClub} zawodników z jednego klubu.
- Jedenastka: 1 GK, ${r.formation.DEF[0]}–${r.formation.DEF[1]} DEF, ${r.formation.MID[0]}–${r.formation.MID[1]} MID, ${r.formation.FWD[0]}–${r.formation.FWD[1]} FWD (razem 11). Pozostali 4 na ławce, bramkarz rezerwowy pierwszy.
- Darmowe transfery w tej kolejce: ${free}. Każdy kolejny kosztuje −${r.hitCost} pkt.
- Dostępne chipy: ${chipsAvail}. Wildcard i Free Hit znoszą limit transferów w tej kolejce (Free Hit działa tylko na jedną kolejkę). Triple Captain potraja punkty kapitana. Użyj chipu tylko wtedy, gdy to naprawdę dobry moment.
- Kupować można tylko zawodników klubów z fazy ligowej LM 2026/27: ${CLUBS.join(", ")}.

STYL UŻYTKOWNIKA: ${style.label}. ${style.desc}
Trzymaj się trzonu pierwotnego składu użytkownika. Zmieniaj zawodnika tylko z konkretnego powodu: kontuzja, zawieszenie, brak gry, słaba forma, bardzo trudny mecz albo wyraźnie lepsza opcja w podobnej cenie.${stillOrig !== null ? ` Z pierwotnego składu zostało ${stillOrig}/15 zawodników.` : ""}

PIERWOTNY SKŁAD UŻYTKOWNIKA: ${orig}

OBECNY SKŁAD (id | pozycja | zawodnik | klub | cena | rola | punkty):
${curLines}

HISTORIA POPRZEDNICH KOLEJEK:
${hist}

DANE PO KOLEJCE ${done} (od użytkownika):
- Punkty drużyny: ${d.total !== undefined && d.total !== "" ? d.total : "nie podano"}
- Wiadomości (kontuzje, zawieszenia, forma, zmiany cen): ${String(d.news || "").trim() || "brak"}

MECZE KOLEJKI ${next}:
${String(fixtures || "").trim() || "nie podano – oceniaj na podstawie swojej wiedzy"}

KANDYDACI Z RYNKU (ceny od użytkownika, najpewniejsze źródło cen):
${String(d.market || "").trim() || "nie podano"}
${hasImages ? "\nDołączone są zrzuty ekranu z aplikacji Sofascore. Odczytaj z nich punkty, ceny, statusy zawodników i inne informacje i weź je pod uwagę.\n" : ""}
Nie masz dostępu do internetu. Opieraj się na danych powyżej i na swojej wiedzy o zawodnikach. Jeśli nie znasz pewnej ceny kupowanego zawodnika, podaj najlepsze oszacowanie i ustaw "priceConfirmed": false. Pusta lista transferów jest w porządku, jeśli żadna zmiana się nie opłaca.

Odpowiedz wyłącznie JSON-em w tym kształcie (teksty po polsku), bez żadnego tekstu przed ani po:
{
  "summary": "2–3 zdania: najważniejsze wnioski przed kolejką ${next}",
  "transfers": [{"outId": "id z obecnego składu", "in": {"name": "Imię Nazwisko", "club": "klub z listy", "pos": "GK|DEF|MID|FWD", "price": 5.5, "priceConfirmed": false}, "reason": "krótkie uzasadnienie"}],
  "chip": null,
  "chipReason": "dlaczego chip teraz albo dlaczego jeszcze nie",
  "captain": "nazwisko z składu po transferach",
  "vice": "nazwisko z składu po transferach",
  "startingXI": ["11 nazwisk ze składu po transferach"],
  "bench": ["4 nazwiska, bramkarz pierwszy, potem kolejność zmian"],
  "watchlist": [{"name": "zawodnik do obserwacji", "club": "klub", "note": "dlaczego"}],
  "risks": ["ryzyko lub rzecz do sprawdzenia przed terminem"]
}
Pole "chip" to null albo jedna z wartości: "wildcard", "freehit", "triplecaptain".`;

  if (fix) {
    p += `\n\nTWOJA POPRZEDNIA PROPOZYCJA:\n${JSON.stringify(fix.rec)}\n\nNaruszała zasady:\n- ${fix.errors.join("\n- ")}\nPrzygotuj poprawioną propozycję, która spełnia wszystkie zasady.`;
  }
  return p;
}

export const SQUAD_IMPORT_PROMPT = `Na zrzucie ekranu jest skład w grze Sofascore Fantasy (Liga Mistrzów 2026/27). Odczytaj wszystkich widocznych zawodników.
Pozycję ustal z rzędu na boisku lub etykiety (GK, DEF, MID, FWD). Klub ustal z herbu, koszulki lub swojej wiedzy; jeśli nie jesteś pewien, wpisz pusty tekst. Cenę podaj w M€, jeśli jest widoczna, w przeciwnym razie null. Bank podaj, jeśli jest widoczny.
Odpowiedz tylko JSON-em, bez tekstu przed ani po: {"players":[{"name":"Imię Nazwisko","club":"klub","pos":"GK","price":5.0}],"bank":null}`;
