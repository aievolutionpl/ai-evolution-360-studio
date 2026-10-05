# AI Evolution Spatial Studio — etap 1

## Stan przed zmianą

Studio 0.5 używa Node HTTP i statycznego interfejsu w `apps/desktop`. `services/server.mjs` łączy routing, upload, rekonstrukcję i eksporty. `ProjectStore` zapisuje `project.json`; Spirula wykonuje SfM i trening, PlayCanvas eksportuje SOG. Osobne moduły obsługują zdjęcia, czyszczenie, kamerę, Blender i Smart Concept Designer. Te funkcje i ich formaty pozostają kompatybilne.

Brakuje wspólnego manifestu sceny, biblioteki assetów, oceny klatek i jawnego rozróżnienia analizy lokalnej od rozpoznawania przez AI. Backend ma jedną blokadę długich zadań rekonstrukcji. Frontend ma duży `app.js` i rozbudowaną kolumnę operacji.

## Inspiracja

[Image Blaster](https://github.com/neilsonnn/image-blaster) rozdziela świat, niezależne obiekty, referencje obrazowe i dostawców generacji. Przyjmujemy ten podział, a nie implementację ani automatyczne wysyłanie obrazów do zewnętrznych usług. Lokalna Spirula pozostaje podstawą Studio. Analiza obrazu nie daje automatycznie pozycji XYZ, pełnego pokrycia sceny ani edytowalnego GLB.

## Struktura i zakres wdrożenia

```
services/api/spatial-routes.mjs           osobny router nowych endpointów
services/scene/scene-schema.mjs          walidacja manifestu v1
services/scene/scene-manager.mjs         migracja, warianty, rewizje, zapis atomowy
services/assets/asset-manager.mjs        katalog referencji i wersje assetów
services/vision/frame-selector.mjs       ostrość, podobieństwo i pokrycie czasowe
services/vision/scene-analyser.mjs        przygotowanie materiału i raport
services/providers/vision-provider.mjs   lokalny raport / opcjonalne OpenAI Vision
services/jobs/job-manager.mjs            zadania analizy, anulowanie i odzyskiwanie
apps/desktop/spatial.js                  interfejs analizy i assetów
apps/desktop/premium.css                 spójny wygląd oraz responsywność
```

`server.mjs` otrzymuje tylko integrację routera i blokady pracy. `ProjectStore` nadal odpowiada za rekonstrukcję. `scene.json` powstaje przy pierwszym odczycie projektu; nie zmienia jego źródeł. Aktualizacja wariantu synchronizuje ścieżki środowiska, pozostawiając obiekty i metadane. Zapis edycji wymaga aktualnej rewizji, a poprzedni manifest trafia do historii.

Analiza działa asynchronicznie. Wybiera do 24 klatek z maksymalnie 72 próbek, ocenia ostrość i usuwa podobne widoki. Pokrycie jest czasowe/próbkowe, nie pomiarem ruchu kamery. Lokalny tryb daje raport jakości bez wymyślania obiektów. Opcjonalne OpenAI Vision wymaga lokalnego klucza i świadomego wyboru wysłania wybranych obrazów. Wyniki AI przechodzą walidację; elementy konstrukcyjne nie są assetami. Zaznaczone obiekty można zapisać jako referencje w bibliotece, bez udawania gotowych modeli 3D.

## Migracja i kolejne etapy

1. Wdrożyć i przetestować powyższe moduły oraz UI, zachowując dotychczasowe endpointy.
2. Osobno dodać izolowanie pojedynczego obiektu, providerów image-to-3D i wersje GLB.
3. Dopiero po tym budować edytor transformacji i renderowanie splat + GLB; nowy edytor może używać React/TypeScript bez przepisywania obecnego viewera.
4. Auto placement, clean plate, fizyka, World Labs i agent pozostają poza tym etapem.

## Weryfikacja

Testy manifestu, konfliktów rewizji, migracji, ścieżek, assetów, wyboru klatek, parsera AI i cyklu zadań; integracja HTTP z syntetycznym materiałem i rzeczywistym FFmpeg; sprawdzenie UI w przeglądarce. Istniejący zestaw testów musi pozostać zielony. Źródła użytkownika, klucze i wyniki z `workspace/` nie trafiają do repozytorium.
