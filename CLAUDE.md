# Doradca Fantasy LM

Aplikacja w przeglądarce dla gry **Sofascore Fantasy – Liga Mistrzów 2026/27**. Użytkownik (Mati) wpisuje swój skład startowy (15 zawodników), a po każdej kolejce Claude proponuje transfery, kapitana, jedenastkę i chip. Aplikacja sama sprawdza, czy plan spełnia zasady gry, zanim pozwoli go zastosować.

## Komendy

- `npm run dev` – serwer lokalny na http://localhost:5173 (moduły ES nie działają z `file://`).
- `npm test` – testy zasad (`node:test`, bez zależności).

Nie ma kroku budowania ani zależności npm. Czysty HTML/CSS/JS (moduły ES).

## Struktura

- `index.html` – szkielet strony, pasek zakładek. `manifest.webmanifest` + `icon.svg` – dodawanie do ekranu telefonu.
- `styles.css` – tokeny kolorów (jasny i ciemny motyw), typografia, boisko.
- `src/constants.js` – kluby fazy ligowej, terminarz (`ROUNDS`, `FIXTURES`), domyślne zasady, przykładowy skład, modele.
- `src/rules.js` – **czyste funkcje** zasad: `validateSquad`, `lineupProblems`, `evalRec` (ocena planu AI), `applyEvaluated`, `planText` (plan jako tekst), dopasowanie nazwisk i klubów, `plural`/`countN` (polska odmiana), `timeLeft`. Bez DOM – testowane w `tests/`.
- `src/prompt.js` – treść zapytań do Claude (analiza po kolejce, odczyt składu ze zrzutu).
- `src/ai.js` – wywołanie Anthropic Messages API z przeglądarki (`fetch`, nagłówek `anthropic-dangerous-direct-browser-access`), ponawianie przy 429/529/5xx, parsowanie JSON, zmniejszanie zrzutów.
- `src/storage.js` – stan w `localStorage`; klucz API w osobnym wpisie (nie trafia do eksportu). `lastPlan` = tekst ostatnio zastosowanego planu + `undo` (stan sprzed zmian; zerowany po ręcznej edycji składu).
- `src/app.js` – renderowanie zakładek (Skład, Kolejka, Historia, Zasady) i obsługa zdarzeń.
- `claude-ai-artifact/doradca-fantasy-lm.html` – pierwotna wersja jako artifact na claude.ai (używa `window.claude` – `sample`, `db`). Edytuj tylko, jeśli użytkownik prosi o zmianę wersji na claude.ai.

## Zasady gry (egzekwowane w `rules.js`)

- Skład 15: 2 GK, 5 DEF, 5 MID, 3 FWD. Budżet 100 M€, bank ≥ 0.
- Maks. 3 zawodników z jednego klubu.
- Jedenastka: 1 GK, 3–5 DEF, 2–5 MID, 1–3 FWD.
- Chipy: Wildcard, Free Hit (skład wraca po kolejce), Triple Captain.
- **Niepotwierdzone założenia:** 2 darmowe transfery na kolejkę, −4 pkt za kolejny. Użytkownik może je zmienić w zakładce Zasady. Nie wpisuj na sztywno innych wartości bez źródła.

## Konwencje

- Cały interfejs i treść zapytań po **polsku**. Komunikaty: krótko, w stronie czynnej, błąd mówi co zrobić. Liczebniki przez `countN()` – bez „transfer(y)”.
- Nazwy klubów kanoniczne jak w `CLUBS`; wejście użytkownika/AI przepuszczaj przez `canonClub()`.
- Plan AI zawsze przechodzi przez `evalRec()`; `errors` blokują przycisk „Zastosuj zmiany”, `warns` tylko informują.
- Każda kontrolka formularza ma stałe `id`. Kolory tylko z tokenów w `styles.css` (oba motywy).
- Nowa logika zasad = nowy test w `tests/rules.test.js`.

## Dane, które się starzeją

- `FIXTURES` zawiera tylko kolejkę 3. Kolejne kolejki użytkownik wkleja w aplikacji; możesz dopisać terminarz, jeśli masz go ze źródła (UEFA/Sofascore).
- `ROUNDS`: godziny dla kolejek 4–8 są szacowane (`sure: false`).
- Modele w `MODELS` (`claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5`) – sprawdź w dokumentacji Anthropic, zanim je zmienisz.
