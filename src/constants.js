// Stałe gry: pozycje, kluby fazy ligowej LM 2026/27, terminarz, domyślne zasady.

export const POS = ["GK", "DEF", "MID", "FWD"];
export const POS_PL = { GK: "Bramkarze", DEF: "Obrońcy", MID: "Pomocnicy", FWD: "Napastnicy" };
export const POS_ONE = { GK: "bramkarz", DEF: "obrońca", MID: "pomocnik", FWD: "napastnik" };

// 36 klubów fazy ligowej Ligi Mistrzów 2026/27 (nazwy jak w Sofascore/UEFA).
export const CLUBS = [
  "AEK Athens", "Arsenal", "Aston Villa", "Atlético Madrid", "Barcelona", "Bayern München",
  "Bodø/Glimt", "Borussia Dortmund", "Club Brugge", "Como", "Fenerbahçe", "Feyenoord",
  "Galatasaray", "Inter", "LASK", "RB Leipzig", "Lens", "Lille", "Liverpool",
  "Manchester City", "Manchester United", "Napoli", "Paris Saint-Germain", "Porto",
  "PSV Eindhoven", "Real Betis", "Real Madrid", "Roma", "Sabah", "Shakhtar Donetsk",
  "Slavia Praha", "Slovan Bratislava", "Sporting CP", "Stuttgart", "Viking", "Villarreal",
];

export const SHORT = {
  "AEK Athens": "AEK", "Arsenal": "ARS", "Aston Villa": "AVL", "Atlético Madrid": "ATM", "Barcelona": "BAR",
  "Bayern München": "BAY", "Bodø/Glimt": "BOD", "Borussia Dortmund": "BVB", "Club Brugge": "BRU", "Como": "COM",
  "Fenerbahçe": "FEN", "Feyenoord": "FEY", "Galatasaray": "GAL", "Inter": "INT", "LASK": "LAS", "RB Leipzig": "RBL",
  "Lens": "RCL", "Lille": "LIL", "Liverpool": "LIV", "Manchester City": "MCI", "Manchester United": "MUN",
  "Napoli": "NAP", "Paris Saint-Germain": "PSG", "Porto": "POR", "PSV Eindhoven": "PSV", "Real Betis": "BET",
  "Real Madrid": "RMA", "Roma": "ROM", "Sabah": "SAB", "Shakhtar Donetsk": "SHA", "Slavia Praha": "SLA",
  "Slovan Bratislava": "SLO", "Sporting CP": "SCP", "Stuttgart": "VFB", "Viking": "VIK", "Villarreal": "VIL",
};

// Popularne skróty i polskie nazwy -> nazwa kanoniczna (klucze po norm()).
export const ALIAS = {
  "psg": "Paris Saint-Germain", "paris": "Paris Saint-Germain", "paris sg": "Paris Saint-Germain",
  "man city": "Manchester City", "city": "Manchester City", "mci": "Manchester City",
  "man utd": "Manchester United", "man united": "Manchester United", "manchester utd": "Manchester United", "mun": "Manchester United",
  "bayern": "Bayern München", "bayern munich": "Bayern München", "bayern monachium": "Bayern München",
  "dortmund": "Borussia Dortmund", "bvb": "Borussia Dortmund",
  "atletico": "Atlético Madrid", "atletico madryt": "Atlético Madrid", "atletico de madrid": "Atlético Madrid", "atleti": "Atlético Madrid",
  "leipzig": "RB Leipzig", "inter milan": "Inter", "inter mediolan": "Inter", "internazionale": "Inter",
  "sporting": "Sporting CP", "sporting lizbona": "Sporting CP", "psv": "PSV Eindhoven",
  "brugge": "Club Brugge", "brugia": "Club Brugge",
  "bodo": "Bodø/Glimt", "bodo/glimt": "Bodø/Glimt", "bodo glimt": "Bodø/Glimt",
  "shakhtar": "Shakhtar Donetsk", "szachtar": "Shakhtar Donetsk", "szachtar donieck": "Shakhtar Donetsk",
  "slavia": "Slavia Praha", "slavia praga": "Slavia Praha", "slovan": "Slovan Bratislava",
  "betis": "Real Betis", "aek": "AEK Athens", "aek ateny": "AEK Athens", "villa": "Aston Villa",
  "real madryt": "Real Madrid", "rcl": "Lens", "neapol": "Napoli", "fenerbahce": "Fenerbahçe",
};

export const CHIPS = [
  { key: "wildcard", label: "Wildcard" },
  { key: "freehit", label: "Free Hit" },
  { key: "triplecaptain", label: "Triple Captain" },
];

// Budżet i limit 3 na klub potwierdzone w Sofascore. Darmowe transfery i koszt dodatkowego
// to założenia — użytkownik może je zmienić w zakładce Zasady.
export const DEFAULT_RULES = {
  budget: 100,
  maxPerClub: 3,
  freeTransfers: 2,
  hitCost: 4,
  squad: { GK: 2, DEF: 5, MID: 5, FWD: 3 },
  formation: { GK: [1, 1], DEF: [3, 5], MID: [2, 5], FWD: [1, 3] },
};

// Pierwsze mecze kolejek fazy ligowej (czas polski). Termin = pierwszy mecz − 30 min.
// sure:false = godzina przyjęta, nie potwierdzona.
export const ROUNDS = [
  { n: 1, ko: "2026-09-08T18:45:00+02:00", sure: true },
  { n: 2, ko: "2026-10-13T18:45:00+02:00", sure: true },
  { n: 3, ko: "2026-10-20T18:45:00+02:00", sure: true },
  { n: 4, ko: "2026-11-03T18:45:00+01:00", sure: false },
  { n: 5, ko: "2026-11-24T18:45:00+01:00", sure: false },
  { n: 6, ko: "2026-12-08T18:45:00+01:00", sure: false },
  { n: 7, ko: "2027-01-19T18:45:00+01:00", sure: false },
  { n: 8, ko: "2027-01-27T21:00:00+01:00", sure: false },
];

// Terminarz kolejek, które znamy. Pozostałe użytkownik wkleja sam.
export const FIXTURES = {
  3: "Wt 20.10 (18:45): Fenerbahçe – Slavia Praha, Sabah – Borussia Dortmund\n" +
     "Wt 20.10 (21:00): Roma – Slovan Bratislava, Porto – PSV Eindhoven, Liverpool – Villarreal, Manchester City – AEK Athens, Paris Saint-Germain – Barcelona, Napoli – Bodø/Glimt, Stuttgart – Atlético Madrid\n" +
     "Śr 21.10 (18:45): Lille – Galatasaray\n" +
     "Śr 21.10 (21:00): Como – Manchester United, Aston Villa – Viking, Club Brugge – Lens, Bayern München – Arsenal, Inter – Shakhtar Donetsk, Real Betis – Feyenoord, Sporting CP – LASK, Real Madrid / RB Leipzig (gospodarz do potwierdzenia)",
};

// Przykładowy skład (zaproponowany w rozmowie z Claude) — tylko jako wypełnienie edytora.
export const EXAMPLE = [
  ["Zion Suzuki", "Aston Villa", "GK", 5.0], ["Alex Meret", "Napoli", "GK", 4.5],
  ["Pau Torres", "Aston Villa", "DEF", 5.0], ["João Cancelo", "Barcelona", "DEF", 5.0], ["Ben White", "Arsenal", "DEF", 5.0],
  ["Marc Bartra", "Real Betis", "DEF", 5.1], ["Štěpán Chaloupek", "Slavia Praha", "DEF", 4.5],
  ["Lamine Yamal", "Barcelona", "MID", 12.1], ["Michael Olise", "Bayern München", "MID", 10.1], ["Martin Ødegaard", "Arsenal", "MID", 7.5],
  ["Nico Paz", "Como", "MID", 6.5], ["Angelo Stiller", "Stuttgart", "MID", 5.5],
  ["Erling Haaland", "Manchester City", "FWD", 11.0], ["Serhou Guirassy", "Borussia Dortmund", "FWD", 8.0], ["Ermedin Demirović", "Stuttgart", "FWD", 5.1],
];

export const STYLES = [
  { key: "conservative", label: "Zachowawczy", desc: "Tylko konieczne zmiany: kontuzje, zawieszenia, pewna ławka. Żadnych transferów na minus." },
  { key: "balanced", label: "Zbalansowany", desc: "Zmiany konieczne plus wyraźne okazje. Transfer na minus tylko przy dużej przewadze." },
  { key: "aggressive", label: "Ofensywny", desc: "Goni punkty, chętniej zmienia zawodników i używa chipów." },
];

export const MODELS = [
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5 (zalecany)" },
  { id: "claude-opus-5-5", label: "Opus 5.5 (dokładniejszy, droższy)" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5 (najtańszy)" },
];
