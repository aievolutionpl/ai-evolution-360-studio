# Instalacja i odtwarzalność

Przygotuj Git, Node.js 22+ z npm, FFmpeg i ffprobe w PATH oraz sterownik Vulkan. `scripts/Setup-Studio.ps1` pobiera przypięte zależności PlayCanvas i buduje je przez `npm ci` oraz `npm run build`. Pobiera też oficjalną Spirula v2026.9.24 i sprawdza SHA-256 archiwum. Nie nadpisuje zmodyfikowanych repozytoriów zależności.

Jeśli polityka PowerShell blokuje skrypt, można wykonać instalację ręcznie:

1. Sklonuj SplatTransform do `vendor/splat-transform` i SuperSplat Viewer do `vendor/supersplat-viewer`.
2. W każdym repozytorium wykonaj `git checkout --detach <commit>` z tabeli w [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md), następnie `npm ci` i `npm run build`.
3. Pobierz oficjalne [wydanie Spirula v2026.9.24 dla Windows Vulkan](https://github.com/harry7557558/spirula-studio/releases/tag/v2026.9.24). Rozpakuj do `toolchain/spirula`, aby powstał `toolchain/spirula/spirula.exe`.
4. Uruchom `START-STUDIO.cmd` albo `npm start` w katalogu projektu.

Silnik lokalnie skompilowany w `toolchain/spirula-build-source/build_vulkan/spirula.exe` ma pierwszeństwo przed binarnym wydaniem. Pełne testy rekonstrukcji wykonano z lokalnym buildem wskazanym w notices; nie potwierdzono pełnej równoważności oficjalnego wydania. Skrypt `build-spirula.ps1` jest helperem dla przygotowanego MSVC i lokalnych plików Vulkan w `toolchain`, a nie instalatorem SDK. Wymaga źródeł Spirula w `vendor/spirula-studio`. Zawiera opcjonalne funkcje kodeków upstream.

Na czystej instalacji nie ma syntetycznej sceny demonstracyjnej ani danych QA. Najpierw dodaj własne nagranie. Po błędzie sprawdź logi w `workspace/app-logs` i panel logów projektu. Brak akceleracji sprzętowej w przeglądarce może uniemożliwić płynny podgląd. Inne systemy operacyjne nie są obecnie objęte wsparciem wrappera.
