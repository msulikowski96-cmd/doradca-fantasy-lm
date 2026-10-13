# Doradca Fantasy LM

Pomocnik do **Sofascore Fantasy – Liga Mistrzów 2026/27**. Wpisujesz swój skład, a po każdej kolejce Claude proponuje zmiany: transfery, kapitana, jedenastkę i ewentualny chip. Aplikacja sprawdza budżet, pozycje i limit 3 zawodników z jednego klubu, zanim pozwoli zastosować plan.

## Uruchomienie

Potrzebny Node.js 21 lub nowszy.

```bash
npm run dev     # strona na http://localhost:5173
npm test        # testy zasad
```

Bez instalowania zależności i bez budowania.

## Klucz API

Analiza AI korzysta z **Anthropic API** na Twoim kluczu:

1. Załóż klucz na [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) i doładuj konto API (rozliczane osobno od subskrypcji Claude).
2. W aplikacji: zakładka **Zasady → Klucz API Anthropic**.

Klucz zostaje tylko w Twojej przeglądarce (`localStorage`) i nie trafia do kopii danych. Jedna analiza na Sonnet 5.5 to zwykle kilka–kilkanaście groszy, więcej przy kilku zrzutach ekranu.

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
