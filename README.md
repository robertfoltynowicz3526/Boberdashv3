# Boberdash Dashboard

Aplikacja webowa do zarządzania serwisem, magazynem i kalendarzem zbudowana w oparciu o Vite i Firebase.

## Rozruch lokalny

1. Zainstaluj zależności: `pnpm install`
2. Uruchom środowisko developerskie: `pnpm dev`
3. Zbuduj projekt produkcyjny: `pnpm build`

## Konfiguracja Firebase

Bieżąca wersja korzysta ze stałej konfiguracji Firebase osadzonej w pliku [`src/services/firebase.js`](src/services/firebase.js). Dane konfiguracyjne są inicjalizowane jednorazowo w aplikacji i nie wymagają ustawiania zmiennych środowiskowych.

Aby powrócić do wersji korzystającej ze zmiennych środowiskowych (`import.meta.env`), przywróć wcześniejszą wersję pliku `src/services/firebase.js` z dynamicznym odczytem wartości z `import.meta.env`.
