// --- [NOWE FUNKCJE DLA ZLECEŃ] ---
// Modal do notatki przy zakończeniu
const noteModal = document.getElementById('noteModal');
const noteForm = document.getElementById('noteForm');
const closeNoteModal = document.getElementById('close-note-modal');
const noteZlecenieId = document.getElementById('note-zlecenie-id');
const noteText = document.getElementById('note-text');
const noteGodziny = document.getElementById('note-godziny');
const noteTyp = document.getElementById('note-typ');

// Otwieranie modala do notatki
function otworzModalNotatki(zlecenieId) {
  noteZlecenieId.value = zlecenieId;
  noteText.value = '';
  noteGodziny.value = '';
  noteTyp.value = 'S';
  noteModal.style.display = 'block';
}

// Zamykanie modala
closeNoteModal.onclick = () => { noteModal.style.display = 'none'; };

// Kliknięcie w tło modala
window.addEventListener('click', (event) => {
  if (event.target === noteModal) {
    noteModal.style.display = 'none';
  }
});

// --- OBSŁUGA ZAPISU NOTATKI I ZAMKNIĘCIA ZLECENIA ---
noteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const zlecenieId = noteZlecenieId.value;
  const notatka = noteText.value.trim();
  const godziny = Number(noteGodziny.value);
  const typ = noteTyp.value;

  if (!notatka || isNaN(godziny) || godziny <= 0) {
    alert("Uzupełnij poprawnie wszystkie pola (notatka i godziny).");
    return;
  }

  try {
    const zlecenieRef = doc(db, "zlecenia", zlecenieId);
    const snap = await getDoc(zlecenieRef);
    if (!snap.exists()) throw new Error("Zlecenie nie istnieje.");

    const data = snap.data();
    const nowaHistoria = [
      ...(data.historia || []),
      {
        timestamp: new Date().toISOString(),
        akcja: `Zakończono z notatką: "${notatka}". Godziny: ${godziny}h, typ: ${typ}.`
      }
    ];

    await updateDoc(zlecenieRef, {
      status: "ukończone",
      wyfakturowaneGodziny: godziny,
      typZlecenia: typ,
      dataUkonczenia: new Date().toISOString().split('T')[0],
      zakonczenieNotatka: notatka,
      historia: nowaHistoria
    });

    noteModal.style.display = 'none';
    alert("Zlecenie zakończone pomyślnie z notatką.");
  } catch (e) {
    console.error("Błąd przy zapisie notatki:", e);
    alert("Wystąpił błąd przy zapisie notatki.");
  }
});

// --- ZMIANA W OBSŁUDZE LISTY ZLECEŃ ---
async function obslugaListyZlecen(event) {
  const li = event.target.closest('li');
  if (!li) return;
  const docId = li.dataset.id;

  // 🔴 ZAKOŃCZ ZLECENIE — otwórz modal notatki zamiast prompta
  if (event.target.classList.contains('complete-btn')) {
    otworzModalNotatki(docId);
    return;
  }

  // 🟢 OTWÓRZ PONOWNIE — zmiana statusu na aktywne
  if (event.target.classList.contains('reopen-btn')) {
    if (confirm("Czy na pewno chcesz ponownie otworzyć to zlecenie?")) {
      const zlecenieRef = doc(db, "zlecenia", docId);
      const snap = await getDoc(zlecenieRef);
      if (!snap.exists()) return alert("Nie znaleziono zlecenia.");
      const data = snap.data();

      const nowaHistoria = [
        ...(data.historia || []),
        { timestamp: new Date().toISOString(), akcja: "Ponownie otwarto zlecenie." }
      ];

      await updateDoc(zlecenieRef, { status: "aktywne", historia: nowaHistoria });
      alert("Zlecenie zostało ponownie otwarte.");
    }
    return;
  }

  // 🟡 POZOSTAŁE PRZYCISKI
  if (event.target.classList.contains('delete-btn')) {
    if (confirm("Na pewno usunąć?")) {
      await deleteDoc(doc(db, "zlecenia", docId));
    }
    return;
  }

  if (event.target.classList.contains('details-zlecenie-btn')) {
    otworzModalSzczegolowZlecenia(docId);
    return;
  }

  if (event.target.classList.contains('edit-zlecenie-btn')) {
    otworzModalEdycjiZlecenia(docId);
    return;
  }
}

// --- WYSWIETLANIE ZLECEŃ — dodaj przycisk „Otwórz ponownie” ---
function wyswietlZlecenia() {
  if (_wszystkieMaszynyCache.length === 0 && _wszystkieZleceniaCache.length > 0) {
    aktywneZleceniaLista.innerHTML = "<p>Ładowanie danych maszyn...</p>";
    ukonczoneZleceniaLista.innerHTML = "<p>Ładowanie danych maszyn...</p>";
    return;
  }

  const frazaWyszukiwania = zlecenieSearchInput.value.toLowerCase();
  let aktywneHtml = "", ukonczoneHtml = "";

  const przefiltrowane = _wszystkieZleceniaCache.filter(z => {
    const tekst = `${z.nrZlecenia} ${z.opis} ${z.klientNazwa || ''}`.toLowerCase();
    return tekst.includes(frazaWyszukiwania);
  });

  przefiltrowane.forEach(z => {
    const maszyna = _wszystkieMaszynyCache.find(m => m.id === z.maszynaId);
    const klient = _wszystkieKlienciCache.find(k => k.id === z.klientId);
    const nazwa = klient ? `${klient.nazwa} - ${maszyna ? maszyna.typMaszyny + ' ' + maszyna.model : ''}` : z.nrZlecenia;

    if (z.status === "aktywne" || z.status === "nieprzypisane") {
      aktywneHtml += `
        <li data-id="${z.id}">
          <span><strong>${nazwa}</strong><br><em>${z.opis || ''}</em></span>
          <div>
            <button class="btn-details details-zlecenie-btn">Szczegóły</button>
            <button class="complete-btn">Zakończ</button>
            <button class="delete-btn">Usuń</button>
          </div>
        </li>`;
    } else {
      ukonczoneHtml += `
        <li data-id="${z.id}">
          <span>
            <strong>${nazwa}</strong> (Nr: ${z.nrZlecenia})<br>
            <em>Ukończono: ${z.dataUkonczenia || 'brak daty'}</em><br>
            <small>${z.zakonczenieNotatka ? '📝 ' + z.zakonczenieNotatka : ''}</small>
          </span>
          <div>
            <button class="btn-details details-zlecenie-btn">Szczegóły</button>
            <button class="reopen-btn btn-edit">Otwórz ponownie</button>
            <button class="delete-btn">Usuń</button>
          </div>
        </li>`;
    }
  });

  aktywneZleceniaLista.innerHTML = aktywneHtml || "<p>Brak aktywnych zleceń.</p>";
  ukonczoneZleceniaLista.innerHTML = ukonczoneHtml || "<p>Brak ukończonych zleceń.</p>";
}

// --- SZCZEGÓŁY ZLECENIA – wyświetl także notatkę ---
async function otworzModalSzczegolowZlecenia(zlecenieId) {
  const zlecenie = _wszystkieZleceniaCache.find(z => z.id === zlecenieId);
  if (!zlecenie) return alert("Nie znaleziono zlecenia.");

  document.getElementById('details-zlecenie-title').textContent = `Szczegóły Zlecenia #${zlecenie.nrZlecenia}`;
  const infoDiv = document.getElementById('details-zlecenie-info');
  infoDiv.innerHTML = `
    <div class="details-group"><strong>Status:</strong> <p>${zlecenie.status}</p></div>
    <div class="details-group"><strong>Opis:</strong> <p>${zlecenie.opis || 'Brak'}</p></div>
    ${zlecenie.zakonczenieNotatka ? `<div class="details-group"><strong>Notatka przy zakończeniu:</strong> <p>${zlecenie.zakonczenieNotatka}</p></div>` : ''}
  `;

  detailsZlecenieModal.style.display = 'block';
}
