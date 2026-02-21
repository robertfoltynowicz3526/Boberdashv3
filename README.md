# Agro-Bober

## App lock (blokada ekranu)

Blokada hasłem służy wyłącznie do ochrony przed podglądem ekranu (np. osoby obok). Pełna ochrona danych wymaga uwierzytelniania po stronie serwera (server-side auth).

## Zasada architektury danych (na przyszłość)

Trzy warstwy bez skrótów:

1. **Data** – źródła danych i pobieranie (Firestore, API, cache).
2. **Agregacja** – obliczenia, statystyki, łączenie źródeł.
3. **Render** – wyłącznie prezentacja UI.

UI nie liczy statystyk ani nie miesza źródeł danych.

## Notatnik — ręczna checklista regresji UI

- [ ] Notatka 1 linia → fiszka ma normalny rozmiar, bez rozciągania kontenera listy.
- [ ] Notatka 2000 znaków → fiszka się **nie rozciąga**, treść jest ucięta (preview), a pełna treść widoczna jest po otwarciu edytora (modal).
