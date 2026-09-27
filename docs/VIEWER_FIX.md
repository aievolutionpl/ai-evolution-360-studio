# Naprawa podglądu INSV

Zarejestrowanie kamer i zapis SOG nie gwarantują użytecznego widoku startowego. W rzeczywistym 57-sekundowym INSV rekonstrukcja zarejestrowała 228/228 obrazów z dwóch soczewek, przy średnim błędzie reprojekcji 0.523 px. Podgląd całej bryły pokazywał rozmyte zewnętrzne splaty zamiast wnętrza.

Poprawki:
- Konwersja pionu Z z rekonstrukcji do Y w viewerze. SplatTransform najpierw interpretuje PLY z Rz(180), następnie stosujemy Rx(-90); wspólna transformacja punktów i pozycji kamer to (-x,z,y).
- Kamera z poses COLMAP, z uwzględnieniem scene_transform.json zamiast bounding box modelu.
- Start wzdłuż nagranej trasy, poziomy widok dla dwóch soczewek, punkty trasy i widok wstecz.
- Reset wraca do wnętrza; widok bryły jest jawnie oznaczony jako zewnętrzny.
- Wersjonowanie URL sceny, odbudowa opcji modelu kamery i oczekiwanie na zamknięcie serwera przy restarcie.

Walidacja: rzeczywisty model 796 tys. splatów, ponowny eksport bez treningu, czytelny salon i wyposażenie w viewerze, test jednostkowy konwersji pozycji i uszkodzonego COLMAP oraz kontrole API. Materiał i zrzuty prywatnego wnętrza pozostają lokalne. Nie jest to pełny test wszystkich kamer/trybów Insta360. PLY zachowuje oryginalną orientację treningu; SOG ma orientację pod viewer.
