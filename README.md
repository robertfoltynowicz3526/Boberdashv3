# Agro-Bober

## Logowanie Bobereka

Logowanie z jednym polem hasła korzysta z konta e-mail/hasło w Firebase Authentication. W konfiguracji danego wdrożenia ustaw `VITE_OWNER_EMAIL` i `VITE_OWNER_UID`. Identyfikatory są dostępne w kodzie przeglądarki. Hasło podaje się w formularzu.

UID musi odpowiadać kontu dopuszczonemu przez reguły Firestore. Domyślnie sesja trwa 12 godzin. Jej długość można zmienić przez `VITE_APP_LOCK_TTL_HOURS`.

## Zasada architektury danych (na przyszłość)

Trzy warstwy bez skrótów:

1. **Data** – źródła danych i pobieranie (Firestore, API, cache).
2. **Agregacja** – obliczenia, statystyki, łączenie źródeł.
3. **Render** – wyłącznie prezentacja UI.

UI nie liczy statystyk ani nie miesza źródeł danych.

## Notatnik — ręczna checklista regresji UI

- [ ] Notatka 1 linia → fiszka ma normalny rozmiar, bez rozciągania kontenera listy.
- [ ] Notatka 2000 znaków → fiszka się **nie rozciąga**, treść jest ucięta (preview), a pełna treść widoczna jest po otwarciu edytora (modal).
