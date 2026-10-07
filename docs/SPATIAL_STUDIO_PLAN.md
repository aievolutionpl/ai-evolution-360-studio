# AI Evolution Spatial Studio — etap 1

## Przyrost po audycie 0.6 (2026-10-07)

Repo zawierało już fundament opisany niżej. [Audyt](SPATIAL_AUDIT.md) wskazał luki w imporcie assetów, publikacji raportu i kontraktach manifestu. Ten przyrost je uzupełnia; nie dodaje jeszcze ekstrakcji, generacji ani hybrid viewera.

```
services/api/http.mjs                 JSON, limity bajtów, pliki i Range
services/api/asset-routes.mjs          import, metadane, pliki i historia
services/assets/asset-schema.mjs      wspólna walidacja i indeks assetów
services/assets/asset-import.mjs      GLB 2.0, obrazy, lokalne miniatury
services/vision/analysis-schema.mjs   walidacja obiektów i obserwacji 2D
services/vision/analysis-prompt.mjs   edytowalny prompt poza adapterem
services/vision/analysis-store.mjs    immutable run + atomowa publikacja
services/vision/reference-selector.mjs wybór referencji konkretnego obiektu
services/providers/provider-registry.mjs kontrakt dostawców
services/providers/openai-vision.mjs  adapter z ograniczonym retry i abort
services/storage/json.mjs            wspólny atomowy zapis JSON
apps/desktop/asset-library.js        import, filtry, edycja i historia UI
```

`server.mjs` nadal orchestruje dotychczasowy pipeline; helpery HTTP oraz nowa logika sceny, assetów, analizy, providerów i jobów są poza nim. Moduł `generation` zostanie wydzielony przy wdrożeniu faktycznych zadań image-to-3D, bez pustego endpointu w tym etapie.

### Kontrakty manifestu i kompatybilność

`scene.json` v1 przechowuje `environment`, `objects`, `lighting`, `audio`, `camera`, `metadata` oraz addytywne `assets` i `analysis`:

```json
{
  "assets": [{"id": "chair", "name": "Fotel", "version": 2, "type": "glb", "status": "ready", "manifest": "assets/chair/object.json"}],
  "analysis": {"runId": "run-id", "frames": "analysis/runs/run-id/frames.json", "report": "analysis/runs/run-id/scene-analysis.json", "provider": "openai", "sourceAttempt": 1}
}
```

To fragment manifestu, nie cały plik. Klient edytuje kompozycję i metadane z aktualną rewizją; `environment`, katalog `assets` i aktywny `analysis` są zarządzane przez serwer. Każda zmiana tworzy historię i zwiększa rewizję. `assetId` w nowych instancjach musi wskazywać znany asset; starsze instancje ze względną ścieżką `asset` nadal działają. Układ współrzędnych pozostaje Y-up, radiany i jednostki sceny bez potwierdzonej skali metrycznej.

`object.json` zawiera pełne metadane i pliki assetu, a manifest zawiera jego indeks. Biblioteka uzgadnia indeks po imporcie oraz przy odczycie, dzięki czemu zapis assetu zakończony przed przerwaniem aplikacji jest odzyskiwalny. Wersje plików są niezmienne; podmiana nie nadpisuje starych bajtów. Pliki projektu i źródła rekonstrukcji nie są zmieniane przez import.

Analiza zapisuje klatki i raport do `analysis/runs/<runId>/`, a potem atomowo zmienia wskaźnik w `scene.json`. Odczyt używa obu plików wskazanego runu, nawet jeżeli stare kopie kompatybilności są nieaktualne. Stare pasujące raporty bez wskaźnika są adoptowane przy pierwszym odczycie. Niezgodna para raport/klatki zgłasza błąd zamiast mieszać wyniki.

Obserwacja 2D: `{frameId, bbox: [x,y,width,height], visibility}`; liczby znormalizowane do 0..1, box w granicach obrazu, referencja wyłącznie do znanej klatki. `reference` zapisuje wybraną klatkę, metodę, opcjonalną ramkę i `isolated:false`. Nie dowodzi segmentacji ani pozycji 3D. Starsze raporty bez obserwacji korzystają z jakości klatek jako heurystyki.

### API assetów

| Metoda | Ścieżka względem `/api/projects/:id` | Dane |
| --- | --- | --- |
| POST | `/assets/import?name=Chair.glb` | Surowe bajty; nowy asset |
| POST | `/assets/:assetId/import?name=Chair.glb&version=1` | Surowe bajty; model lub obraz nowej wersji |
| PATCH | `/assets/:assetId` | `{version, patch: {name, metadata}}`; oba pola patch opcjonalne |
| GET | `/assets/:assetId` | Aktualne metadane |
| GET | `/assets/:assetId/versions` | Historia metadanych; najnowsza pierwsza |
| GET | `/assets/:assetId/file?slot=model&download=1` | `model`, `sourceImage`, `referenceImage`, `thumbnail` |

Wszystkie modyfikacje korzystają z dotychczasowego tokenu i ochrony origin. Nie ma importu przez zewnętrzny URL. GLB: limit 100 MiB, poprawny header/bloki/geometria, bez zewnętrznych URI. Zdjęcia: 20 MiB, 36 MP, bok 8192 px, pojedynczy obraz JPEG/PNG/WebP potwierdzony przez ffprobe; miniatura przez FFmpeg. Brak skonfigurowanego dekodera kompresji GLB powoduje jawny błąd. Biblioteka ma limit 500 assetów.

### Testy przyrostu

`npm test` obejmuje nowe warstwy w `assets.test.mjs`, `scene-analysis.test.mjs`, `providers-jobs.test.mjs` i `http.test.mjs` oraz wcześniejsze regresje. `npm run test:spatial-api -- http://127.0.0.1:8766` używa prawdziwego serwera i FFmpeg: upload, analiza, run pointer, obrazy, GLB, podmiana, konflikt, nazwa, historia, download i token/origin. Użyj `STUDIO_WORKSPACE` do izolacji danych QA. Płatny provider jest testowany przez kontrolowane odpowiedzi; jakość detekcji na prawdziwych skanach wymaga osobnego sprawdzenia z kluczem.

## Pierwotny fundament 0.6

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
