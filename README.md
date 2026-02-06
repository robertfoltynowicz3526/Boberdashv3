# Agro-Bober

## App lock (blokada ekranu)

Blokada hasłem służy wyłącznie do ochrony przed podglądem ekranu (np. osoby obok). Pełna ochrona danych wymaga uwierzytelniania po stronie serwera (server-side auth).

## Zasada architektury danych (na przyszłość)

Trzy warstwy bez skrótów:

1. **Data** – źródła danych i pobieranie (Firestore, API, cache).
2. **Agregacja** – obliczenia, statystyki, łączenie źródeł.
3. **Render** – wyłącznie prezentacja UI.

UI nie liczy statystyk ani nie miesza źródeł danych.
