# Doradca Fantasy LM

Aplikacja w przeglądarce dla gry **Sofascore Fantasy – Liga Mistrzów 2026/27**. Użytkownik (Mati) wpisuje swój skład startowy (15 zawodników), a po każdej kolejce AI (Claude albo Gemini – wybór w zakładce Zasady) proponuje transfery, kapitana, jedenastkę i chip. Aplikacja sama sprawdza, czy plan spełnia zasady gry, zanim pozwoli go zastosować.

## Komendy

- `npm run dev` – serwer lokalny na http://localhost:5173 (moduły ES nie działają z `file://`).
- `npm test` – testy zasad i połączenia z AI (`node:test`, bez zależności).
- `npm run check` – sprawdzenie składni każdego pliku w `src/` (`node --check` po kolei; `node --check a.js b.js` sprawdza tylko pierwszy plik).

Nie ma kroku budowania ani zależności npm. Czysty HTML/CSS/JS (moduły ES). Supabase obsługujemy zwykłym `fetch` (bez `supabase-js`).

GitHub Pages: publikacja prosto z gałęzi `main` (Settings → Pages → Deploy from a branch → `main` / root). Workflowów w `.github/workflows` nie dodasz z tej sesji (brak uprawnienia `workflow`).

## Struktura

- `index.html` – szkielet strony, pasek zakładek. `manifest.webmanifest` + `icon.svg` – dodawanie do ekranu telefonu.
- `styles.css` – tokeny kolorów (jasny i ciemny motyw), typografia, boisko.
- `src/constants.js` – kluby fazy ligowej, terminarz (`ROUNDS`, `FIXTURES`), domyślne zasady, przykładowy skład, modele (`MODELS`, każdy z polem `provider`) i dostawcy (`PROVIDERS`: pole klucza w ustawieniach, link do konsoli).
- `src/rules.js` – **czyste funkcje** zasad: `validateSquad`, `lineupProblems`, `evalRec` (ocena planu AI), `applyEvaluated`, `planText` (plan jako tekst), dopasowanie nazwisk i klubów, `plural`/`countN` (polska odmiana), `timeLeft`. Bez DOM – testowane w `tests/`.
- `src/prompt.js` – treść zapytań do Claude (analiza po kolejce, odczyt składu ze zrzutu).
- `src/ai.js` – `callAi`/`askJson` z przeglądarki (`fetch`) do dwóch dostawców: Anthropic Messages API (nagłówek `anthropic-dangerous-direct-browser-access`) i Gemini API (`v1beta/models/{model}:generateContent`, prefiks `models/` usuwany z id, klucz **tylko** w nagłówku `x-goog-api-key` – nie w `?key=`, bo adres trafia do logów), `responseMimeType: application/json`, zapas `maxOutputTokens` na tokeny myślenia, części `thought: true` pomijane). Wspólne: przy przeciążeniu (503) `callAi` przechodzi na kolejny model z `fallbackModels` (app.js: kolejność `GEMINI_FALLBACK`, 2 ponowienia zamiast 4), `keyProblem()` (klucz tylko ze znaków ASCII bez spacji – inaczej przeglądarka rzuca TypeError przy nagłówku), `checkAi()` (GET modelu – przycisk „Sprawdź połączenie”), błąd sieci ze szczegółem z przeglądarki, ponawianie przy 429/529/5xx (bez czekania, gdy API każe czekać > 30 s), parsowanie JSON, zmniejszanie zrzutów (`imageFileToData` → `{ mediaType, data }`). Testy w `tests/ai.test.js` (mock `fetch`).
- `src/storage.js` – stan w `localStorage`; ustawienia w osobnym wpisie: `model`, `apiKey` (Anthropic), `geminiKey` – nie trafiają do eksportu. `lastPlan` = tekst ostatnio zastosowanego planu + `undo` (stan sprzed zmian; zerowany po ręcznej edycji składu).
- `src/app.js` – renderowanie zakładek (Skład, Kolejka, Historia, Zasady, Admin), start aplikacji (konto albo tryb bez konta) i obsługa zdarzeń.
- `src/config.js` – adres projektu Supabase i klucz publikowalny (jawny z założenia; dane chroni RLS).
- `src/cloud.js` – `createCloud()`: logowanie/rejestracja (GoTrue), sesja z odświeżaniem tokenu, PostgREST (profil, stan, game_data, RPC), funkcje brzegowe, `proxy()` dla AI. Testy w `tests/cloud.test.js` (mock `fetch`).
- `src/account.js` – ekran logowania/rejestracji. `src/admin.js` – panel admina (ranking, konta, wspólny klucz AI, terminarz). `src/dom.js` – `$`, `esc`.
- `supabase/migrations/` – schemat: `profiles` (rola, blokada), `user_states` (stan aplikacji jako jsonb), `game_data` (terminarz od admina), `ai_config` (wspólny klucz – bez polityk RLS, czyta tylko serwer), `ai_usage` (dzienny licznik). RPC: `get_ai_config`, `set_ai_config`, `clear_ai_key`; trigger `protect_profile` (role/blokady zmienia tylko admin).
- `supabase/functions/` – `ai-proxy` (wspólny klucz admina; Gemini: gracz wybiera model z `SHARED_GEMINI_MODELS` w `policy.js`, Claude: tylko model admina; dzienny limit, przerwanie po 140 s – limit darmowego planu 150 s; logika w `policy.js`, testy `tests/proxy.test.js`), `admin-users` (nowe hasło, usunięcie konta – darmowy SMTP Supabase nie wysyła maili do znajomych), `sofascore` (terminarz z nieoficjalnego API; z serwerów Supabase SofaScore zwraca 403 „challenge” – nie obchodzimy tego, admin wpisuje kolejkę ręcznie; logika w `format.js`, testy `tests/sofascore.test.js`). Wdrożenie: narzędzia Supabase (`deploy_edge_function`), `verify_jwt: true`.
- `claude-ai-artifact/doradca-fantasy-lm.html` – pierwotna wersja jako artifact na claude.ai (używa `window.claude` – `sample`, `db`). Edytuj tylko, jeśli użytkownik prosi o zmianę wersji na claude.ai.

## Zasady gry (egzekwowane w `rules.js`)

- Skład 15: 2 GK, 5 DEF, 5 MID, 3 FWD. Budżet 100 M€, bank ≥ 0.
- Maks. 3 zawodników z jednego klubu.
- Jedenastka: 1 GK, 3–5 DEF, 2–5 MID, 1–3 FWD.
- Chipy: Wildcard, Free Hit (skład wraca po kolejce), Triple Captain.
- **Niepotwierdzone założenia:** 2 darmowe transfery na kolejkę, −4 pkt za kolejny. Użytkownik może je zmienić w zakładce Zasady. Nie wpisuj na sztywno innych wartości bez źródła.

## Konta (Supabase, projekt `zjprowiosdxiokfwurpu`)

- Bez logowania aplikacja działa jak dawniej (tryb bez konta, `localStorage`). Zalogowany: stan w `user_states` + kopia w `localStorage` pod kluczem per konto (`stateKey(uid)`).
- Skład z trybu bez konta przenosimy na konto tylko po kliknięciu „Przenieś” (telefon może być wspólny).
- Rolę admina nadaje się SQL-em (`update profiles set role='admin' where email=…`) – nie wpisuj e-maili do repo.
- Zmiany schematu: nowa migracja (`apply_migration`) + plik w `supabase/migrations/` + test RLS (blok `do $$ … raise exception $$`, wycofuje się sam).

## Konwencje

- Cały interfejs i treść zapytań po **polsku**. Komunikaty: krótko, w stronie czynnej, błąd mówi co zrobić. Liczebniki przez `countN()` – bez „transfer(y)”.
- Nazwy klubów kanoniczne jak w `CLUBS`; wejście użytkownika/AI przepuszczaj przez `canonClub()`.
- Plan AI zawsze przechodzi przez `evalRec()`; `errors` blokują przycisk „Zastosuj zmiany”, `warns` tylko informują.
- Każda kontrolka formularza ma stałe `id`. Kolory tylko z tokenów w `styles.css` (oba motywy).
- Nowa logika zasad = nowy test w `tests/rules.test.js`.

## Dane, które się starzeją

- `FIXTURES` zawiera tylko kolejkę 3. Kolejne kolejki użytkownik wkleja w aplikacji; możesz dopisać terminarz, jeśli masz go ze źródła (UEFA/Sofascore).
- `ROUNDS`: godziny dla kolejek 4–8 są szacowane (`sure: false`).
- Modele w `MODELS` (`claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5`, `gemini-3.5-flash`, `gemini-3.8-flash`, `gemini-flash-latest`, `gemini-3.5-flash-lite`) – sprawdź w dokumentacji Anthropic / Gemini API (albo na liście `GET v1beta/models`), zanim je zmienisz.
