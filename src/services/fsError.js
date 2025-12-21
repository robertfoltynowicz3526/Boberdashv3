export function humanFsError(err) {
  const code = err?.code || '';
  if (code === 'permission-denied') {
    return 'Brak uprawnień do odczytu danych Firestore. Sprawdź reguły Firestore (tryb testowy na czas weryfikacji: allow read, write: if true;).';
  }
  if (code === 'unavailable') {
    return 'Firestore chwilowo niedostępny. Spróbuj ponownie.';
  }
  return `Błąd Firestore: ${code || err?.message || err}`;
}
