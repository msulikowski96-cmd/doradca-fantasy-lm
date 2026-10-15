# Doradca Fantasy LM

Pomocnik do **Sofascore Fantasy – Liga Mistrzów 2026/27**. Wpisujesz swój skład, a po każdej kolejce Claude proponuje zmiany: transfery, kapitana, jedenastkę i ewentualny chip. Aplikacja sprawdza budżet, pozycje i limit 3 zawodników z jednego klubu, zanim pozwoli zastosować plan.

## Uruchomienie

Potrzebny Node.js 21 lub nowszy.

```bash
npm run dev     # strona na http://localhost:5173
npm test        # testy zasad
npm run check   # sprawdzenie składni plików w src/
```

Bez instalowania zależności i bez budowania.

## Konta i liga znajomych

Aplikacja ma konta (Supabase): każdy zakłada konto e-mailem i hasłem, a skład, historia i plany zapisują się w chmurze – są dostępne na każdym telefonie. Można też korzystać bez konta (dane tylko w przeglądarce).

**Admin** (zakładka Admin) widzi ranking ligi i składy graczy, blokuje i usuwa konta, nadaje rolę admina, ustawia nowe hasło (zamiast maila z resetem), ustawia **wspólny klucz AI** z dziennym limitem analiz na osobę (klucz zna tylko serwer) i wpisuje terminarz kolejek dla wszystkich. Przycisk „Pobierz z SofaScore” zwykle nie działa – SofaScore nie ma publicznego API i blokuje zapytania z serwerów.

Analizy przez wspólny klucz są przerywane po ok. 140 s (limit darmowego planu Supabase); z własnym kluczem tego limitu nie ma.

Strona dla znajomych: GitHub Pages (`https://msulikowski96-cmd.github.io/doradca-fantasy-lm/`) – publikuje się sama po zmianie na `main` (jednorazowo: Settings → Pages → Deploy from a branch → `main` / root).

## Klucz API

Analiza AI działa na Twoim kluczu – do wyboru **Claude (Anthropic)** albo **Gemini (Google)**. W aplikacji: zakładka **Zasady → Model AI i klucz API**; najpierw wybierz model, potem wklej klucz tego dostawcy.

- **Gemini** (3.8 Flash, 3.5 Flash, Flash Latest, 3.5 Flash-Lite) – klucz założysz za darmo na [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Darmowy pakiet ma dzienny limit zapytań (aktualny limit widać w AI Studio), a Google może wykorzystywać dane z darmowego pakietu do ulepszania swoich usług. Po włączeniu płatności w AI Studio limity rosną. Gdy wybrany model jest przeciążony (błąd 503), spróbuj za chwilę albo wybierz inny model Gemini – limity liczą się osobno dla każdego modelu.
- **Claude (Sonnet, Opus, Haiku 5.5)** – klucz z [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys); konto API trzeba doładować (rozliczane osobno od subskrypcji Claude). Jedna analiza na Sonnet 5.5 to zwykle kilka–kilkanaście groszy, więcej przy kilku zrzutach ekranu.

Klucze zostają tylko w Twojej przeglądarce (`localStorage`) i nie trafiają do kopii danych. Możesz zapisać oba i przełączać model w dowolnej chwili.

## Jak używać

1. **Skład** – wpisz 15 zawodników z klubami i cenami albo wczytaj zrzut boiska. Pierwszy zapisany skład staje się „pierwotnym” i AI stara się trzymać jego trzonu.
2. **Kolejka** – po meczach wpisz punkty, wiadomości (kontuzje, zmiany cen), kandydatów z cenami lub dodaj zrzuty. Wybierz styl i kliknij „Analizuj z AI”.
3. Popraw ceny zaproponowanych zawodników, pomiń niechciane transfery i kliknij **Zastosuj zmiany**. W zakładce Skład pojawi się plan jako tekst – **Skopiuj plan** i przepisz go w Sofascore. Pomyłka? **Cofnij plan** przywraca skład, chipy i historię sprzed zmian (do czasu ręcznej edycji składu).
4. **Historia** – punkty po kolejkach, transfery, ilu zawodników z pierwotnego składu zostało. Błędny wpis usuniesz przyciskiem „Usuń wpis”.

Nagłówek odlicza czas do terminu najbliższej kolejki; w ostatniej dobie wyróżnia go kolorem. Gdy serwery Anthropic są przeciążone, aplikacja sama ponawia zapytanie (do 2 razy).

Dane zapisują się w przeglądarce. Żeby przenieść je na inne urządzenie, użyj **Zasady → Kopia danych** (plik albo tekst). Na telefonie możesz dodać aplikację do ekranu głównego.

## Ograniczenia

- AI nie ma dostępu do internetu ani do danych Sofascore – działa na tym, co wpiszesz lub pokażesz na zrzutach.
- Darmowe transfery (2) i koszt dodatkowego (−4 pkt) to założenia – sprawdź regulamin w aplikacji Sofascore i popraw w zakładce Zasady.
- Terminarz jest wpisany tylko dla 3. kolejki; kolejne wklejasz sam.

## Struktura

Opis plików i konwencji dla Claude Code: [CLAUDE.md](CLAUDE.md).
