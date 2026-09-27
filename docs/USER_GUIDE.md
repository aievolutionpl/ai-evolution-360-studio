# Jak korzystać z AI Evolution 360 Studio

Uruchom START-STUDIO.cmd, dodaj film, wybierz model kamery i jakość, a następnie rozpocznij przetwarzanie. Przeglądarka może pozostać otwarta na ekranie postępu. Zamknięcie samej karty nie wyłącza serwera. STOP-STUDIO.cmd kończy aplikację; podczas pracy użyj najpierw przycisku anulowania.

## Dobry materiał referencyjny

- Na pierwszą próbę nagraj jeden pokój lub jeden obiekt przez 20–60 sekund, około 30 kl./s.
- Powoli przejdź po łuku lub pętli. Kamera musi zmieniać pozycję; sam obrót statywu nie dostarcza głębi.
- Zachowuj wspólne szczegóły pomiędzy kolejnymi pozycjami. Nie rób gwałtownych skrętów ani cięć.
- Wybierz jasne, rozproszone światło. Sprawdź ostrość pojedynczej klatki. Jeśli możesz, zablokuj ekspozycję i balans bieli.
- Wyczyść soczewki, nie zasłaniaj ich palcami. Unikaj przechodniów, poruszających się zwierząt, lustra, szkła i połysku.
- W przypadku Insta360 preferuj oryginalny INSV z dwiema ścieżkami wideo w jednym pliku. Zachowaj oryginały i telemetrię.
- Jeśli nagranie składa się z osobnych plików lub jest nieczytelne, wyeksportuj w Insta360 Studio pełną panoramę equirectangular 2:1, np. 3840×1920. Bez reframingu, napisów, przejść i przyspieszania. W aplikacji wybierz „Panorama 360°”.

Najpierw uruchom szybki test. Więcej kroków treningu nie naprawia rozmytych klatek ani braku zmiany pozycji kamery.

## Podgląd i projekty

Przeciąganie obraca scenę, kółko przybliża. Swobodny lot: prawy przycisk myszy i WASD. Kontrolki pozwalają dopasować scenę, zresetować kamerę i włączyć pełny ekran. „Płynniejszy podgląd” zmniejsza koszt renderowania. Pobierz SOG do przeglądarek lub Gaussian Splat PLY do zgodnych narzędzi.

Projekty zapisują się lokalnie. Archiwizacja jest odwracalna i nie usuwa plików. Ponowienie korzysta z tego samego filmu, ale tworzy nowe pliki robocze. Po błędzie rozwiń logi; sprawdź model kamery i jakość nagrania. Po przerwaniu pracy serwera zadanie nie wznawia się automatycznie.

## Ograniczenia

Aplikacja nie tworzy gotowego filmu reklamowego: odtwarza interaktywną scenę 3D z nagrania. Scena może mieć ubytki i artefakty, nie jest narzędziem pomiarowym. Sprawdzono syntetyczny MP4 i jeden rzeczywisty INSV z dwiema soczewkami. Jakość innych nagrań wymaga osobnego testu. Dane nie są wysyłane do chmury.

## Poruszanie się we wnętrzu

Podgląd zaczyna się w pozycji z nagrania. Użyj „Poprzedni”, „Następny” i „Odwróć widok”, aby oglądać miejsca z trasy kamery. „Wróć do wnętrza” przywraca start. „Pokaż całą bryłę” służy do widoku zewnętrznego, który w skanach pomieszczeń może być nieczytelny. Artefakty przy lustrze, operatorze i poza nagraną trasą mogą pozostać.
