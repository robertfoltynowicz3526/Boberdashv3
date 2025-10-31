import { db } from './firebase-config.js';
import { collection, query, orderBy, onSnapshot, doc, deleteDoc, updateDoc, getDoc, runTransaction, addDoc, setDoc, where, getDocs } from "firebase/firestore";
import Papa from 'papaparse';

// Uruchom dopiero po załadowaniu DOM:
window.addEventListener('DOMContentLoaded', initializeApp);


function initializeApp() {
    // --- STAŁE I ZMIENNE GLOBALNE ---
    const STAWKI = {
        S: { nazwa: "Wyjazdowe", stawka: 45 },
        W: { nazwa: "Warsztat",  stawka: 35 },
        G: { nazwa: "Gwarancja", stawka: 35 },
        Z: { nazwa: "Zbrojenie", stawka: 30 },
        P: { nazwa: "Poprawka",  stawka: 0  }
    };
    let wszystkieZlecenia = [], wszystkieProdukty = [], wszystkiePrzejazdy = [],
        czesciDoZlecenia = [], wszystkieMaszyny = [], wszystkieKlienci = [], wszystkieWpisyKalendarza = [];
    let _wszystkieKlienciCache = [], _wszystkieMaszynyCache = [], _wszystkieZleceniaCache = []; // Cache z Firebase
    const NISKI_STAN_MAGAZYNOWY = 5;
    let calendar;
    let edytowanyPrzejazdId = null;
    let stockChangeOperation = null;

    // --- SELEKTORY ---
    const miesiacSummaryInput = document.getElementById('miesiac-summary');
    const zlecenieKlientSelect = document.getElementById('zlecenie-klient-select');
    const zlecenieKlientFilterInput = document.getElementById('zlecenie-klient-filter');
    const zlecenieMaszynaSelect = document.getElementById('zlecenie-maszyna-select');
    const kalendarzContainer = document.getElementById('kalendarz');
    const kalendarzModal = document.getElementById('kalendarz-modal');
    const kalendarzForm = document.getElementById('kalendarz-form');
    const kalendarzModalTitle = document.getElementById('kalendarz-modal-title');
    const kalendarzPodsumowanieDiv = document.getElementById('kalendarz-podsumowanie');
    const assignModal = document.getElementById('assign-zlecenie-modal');
    const assignForm = document.getElementById('assign-zlecenie-form');
    const klientForm = document.getElementById('klient-form');
    const listaKlientowDiv = document.getElementById('lista-klientow');
    const maszynaKlientSelect = document.getElementById('maszyna-klient-select');
    const maszynaForm = document.getElementById('maszyna-form');
    const listaMaszynDiv = document.getElementById('lista-maszyn');
    const zlecenieForm = document.getElementById('zlecenie-form');
    const aktywneZleceniaLista = document.getElementById('aktywne-zlecenia-lista');
    const ukonczoneZleceniaLista = document.getElementById('ukonczone-zlecenia-lista');
    const completeModal = document.getElementById('complete-zlecenie-modal');
    const completeModalForm = document.getElementById('complete-zlecenie-form');
    const closeModalButton = completeModal.querySelector('.close-button');
    const summaryContainer = document.getElementById('summary-container');
    const modalMagazynLista = document.getElementById('modal-magazyn-lista');
    const partsToRemoveList = document.getElementById('parts-to-remove-list');
    const magazynForm = document.getElementById('magazyn-form');
    const magazynLista = document.getElementById('magazyn-lista');
    const bulkAddForm = document.getElementById('bulk-add-form');
    const stockModal = document.getElementById('stock-change-modal');
    const stockModalForm = document.getElementById('stock-change-form');
    const stockModalCloseButton = stockModal.querySelector('.close-button');
    const addOilBtn = document.getElementById('add-oil-btn');
    const oilTypeSelect = document.getElementById('oil-type');
    const oilContainerSizeSelect = document.getElementById('oil-container-size');
    const converterLitryInput = document.getElementById('converter-litry');
    const converterSztukiInput = document.getElementById('converter-sztuki');
    const resultSztuki = document.getElementById('result-sztuki');
    const resultLitry = document.getElementById('result-litry');
    const themeToggle = document.getElementById('theme-toggle');
    const zakonczoneZleceniaHeader = document.getElementById('zakonczone-zlecenia-header');
    const zakonczoneZleceniaContent = document.getElementById('zakonczone-zlecenia-content');
    const zlecenieSearchInput = document.getElementById('zlecenie-search-input');
    const editKlientModal = document.getElementById('edit-klient-modal');
    const editKlientForm = document.getElementById('edit-klient-form');
    const editMaszynaModal = document.getElementById('edit-maszyna-modal');
    const editMaszynaForm = document.getElementById('edit-maszyna-form');
    const detailsZlecenieModal = document.getElementById('details-zlecenie-modal');
    const klientSearchInput = document.getElementById('klient-search-input');
    const maszynaSearchInput = document.getElementById('maszyna-search-input');
    const listaKlientowHeader = document.getElementById('lista-klientow-header');
    const listaKlientowContent = document.getElementById('lista-klientow-content');
    const listaMaszynHeader = document.getElementById('lista-maszyn-header');
    const listaMaszynContent = document.getElementById('lista-maszyn-content');
    const editZlecenieModal = document.getElementById('edit-zlecenie-modal');
    const editZlecenieForm = document.getElementById('edit-zlecenie-form');
    const machineHistoryModal = document.getElementById('machine-history-modal');
    const machineHistoryList = document.getElementById('machine-history-list');

    // --- INICJALIZACJA UI / TABS / MOTYW ---
    window.openTab = (evt, tabName) => {
        document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
        document.querySelectorAll('.tab-button').forEach(button => button.classList.remove('active'));
        document.getElementById(tabName).style.display = 'block';
        evt.currentTarget.classList.add('active');
    };
    const now = new Date();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    const currentMonth = `${year}-${month}`;
    if (miesiacSummaryInput) miesiacSummaryInput.value = currentMonth;
    document.querySelector('.tab-button').click(); // Otwórz pierwszą zakładkę
    inicjujCiemnyMotyw();
    inicjujZwijanie();
    ensureZakonczenieNotatkaField(); // wstrzyknięcie pola notatki do modala (index.html bez zmian)
        if (zlecenieKlientFilterInput) {
        zlecenieKlientFilterInput.addEventListener('input', () => {
            odswiezSelectKlientaDoZlecenia();
        });
    }
    odswiezSelectKlientaDoZlecenia();

    // --- KALENDARZ ---
    function inicjalizujKalendarz() {
        if (!kalendarzContainer) return;
        calendar = new FullCalendar.Calendar(kalendarzContainer, {
            initialView: 'dayGridMonth',
            locale: 'pl',
            headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth' },
            eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
            displayEventEnd: true,
            eventContent: (arg) => {
                let eventEl = document.createElement('div');
                eventEl.innerHTML = `<div>${arg.event.title || ''}</div>`;
                if (arg.event.extendedProps.type === 'godziny_pracy') {
                    if (arg.event.extendedProps.notatka) {
                        eventEl.innerHTML += ` <small title="${arg.event.extendedProps.notatka}">📝</small>`;
                    }
                    let actionsEl = document.createElement('div');
                    actionsEl.classList.add('event-actions');
                    actionsEl.innerHTML = `
                        <button type="button" class="btn-edit event-edit-btn" data-date="${arg.event.startStr}">E</button>
                        <button type="button" class="btn-remove event-delete-btn" data-date="${arg.event.startStr}">X</button>
                    `;
                    eventEl.appendChild(actionsEl);
                }
                return { domNodes: [eventEl] };
            },
            dateClick: (info) => otworzModalGodzin(info.dateStr),
            datesSet: (view) => { obliczSumeGodzinZKalendarza(view.view.currentStart, view.view.currentEnd); }
        });
        calendar.render();
    }

    async function otworzModalGodzin(data) {
        kalendarzModalTitle.textContent = `Ewidencja Czasu - ${data}`;
        kalendarzForm.reset();
        document.getElementById('kalendarz-data').value = data;

        const zlecenieSelect = kalendarzForm['kalendarz-zlecenie-select'];
        zlecenieSelect.innerHTML = '<option value="">-- Brak --</option>';
        _wszystkieZleceniaCache
            .filter(z => z.status === 'aktywne' || z.status === 'nieprzypisane')
            .sort((a,b) => (a.klientNazwa || a.nrZlecenia).localeCompare(b.klientNazwa || b.nrZlecenia))
            .forEach(z => {
                const maszyna = _wszystkieMaszynyCache.find(m => m.id === z.maszynaId);
                const nazwa = z.klientNazwa ? `${z.klientNazwa} (${maszyna ? maszyna.model : z.nrZlecenia})` : z.nrZlecenia;
                const option = document.createElement('option');
                option.value = z.id;
                option.textContent = nazwa;
                option.dataset.klientNazwa = z.klientNazwa || nazwa;
                zlecenieSelect.appendChild(option);
            });

        const docRef = doc(db, "godziny_pracy", data);
        try {
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const dane = docSnap.data();
                kalendarzForm['godziny-pracy'].value = dane.praca || 0;
                kalendarzForm['godziny-fakturowane'].value = dane.fakturowane || 0;
                kalendarzForm['nadgodziny'].value = dane.nadgodziny || 0;
                kalendarzForm['czas-jazdy'].value = dane.jazda || 0;
                kalendarzForm['kalendarz-notatka'].value = dane.notatka || '';
                const zlecenieIstnieje = _wszystkieZleceniaCache.some(z => z.id === dane.zlecenieId && (z.status === 'aktywne' || z.status === 'nieprzypisane'));
                kalendarzForm['kalendarz-zlecenie-select'].value = zlecenieIstnieje ? dane.zlecenieId : '';
            }
        } catch (error) {
            console.error("Błąd podczas pobierania danych ewidencji:", error);
        }
        kalendarzModal.style.display = 'block';
    }

    async function obslugaZapisuGodzin(event) {
        event.preventDefault();
        const data = kalendarzForm['kalendarz-data'].value;
        const zlecenieSelect = kalendarzForm['kalendarz-zlecenie-select'];
        const zlecenieId = zlecenieSelect.value;
        const selectedOption = zlecenieSelect.options[zlecenieSelect.selectedIndex];
        const klientNazwa = zlecenieId ? selectedOption.dataset.klientNazwa : null;

        const dane = {
            praca: Number(kalendarzForm['godziny-pracy'].value) || 0,
            fakturowane: Number(kalendarzForm['godziny-fakturowane'].value) || 0,
            nadgodziny: Number(kalendarzForm['nadgodziny'].value) || 0,
            jazda: Number(kalendarzForm['czas-jazdy'].value) || 0,
            notatka: kalendarzForm['kalendarz-notatka'].value || '',
            zlecenieId: zlecenieId || null,
            klientNazwa: klientNazwa
        };
        try {
            await setDoc(doc(db, "godziny_pracy", data), dane);
            kalendarzModal.style.display = 'none';
        } catch (e) {
            console.error("Błąd zapisu godzin: ", e);
        }
    }

    function wyswietlWpisyKalendarza() {
        if (_wszystkieZleceniaCache.length === 0 && (_wszystkieKlienciCache.length > 0 || _wszystkieMaszynyCache.length > 0)) {
            if (calendar) calendar.removeAllEvents();
            return;
        }
        onSnapshot(collection(db, "godziny_pracy"), (snapshotGodziny) => {
            wszystkieWpisyKalendarza = [];
            const events = [];

            snapshotGodziny.forEach(docSnap => {
                const dane = docSnap.data();
                const id = docSnap.id;
                wszystkieWpisyKalendarza.push({ id, ...dane });
                let title = '';
                if (dane.praca > 0) title += `P: ${dane.praca}h<br>`;
                if (dane.fakturowane > 0) title += `F: ${dane.fakturowane}h<br>`;
                if (dane.nadgodziny > 0) title += `N: ${dane.nadgodziny}h<br>`;
                if (dane.jazda > 0) title += `J: ${dane.jazda}h`;

                let className = 'fc-event-godziny';
                if (dane.zlecenieId) {
                    title += `<hr style='margin: 2px 0; border-color: rgba(255,255,255,0.5)'><strong>${dane.klientNazwa || 'Zlecenie?'}</strong>`;
                    className = 'fc-event-godziny-zlecenie';
                }

                if (title) {
                    events.push({
                        id: `godziny_${id}`,
                        title: title.trim(),
                        start: id,
                        allDay: true,
                        classNames: [className],
                        extendedProps: { notatka: dane.notatka, type: 'godziny_pracy' }
                    });
                }
            });

            if (calendar) {
                calendar.removeAllEvents();
                calendar.addEventSource(events);
                obliczSumeGodzinZKalendarza(calendar.view.currentStart, calendar.view.currentEnd);
            }
        });
    }

    function obliczSumeGodzinZKalendarza(start, end) {
        const wpisyZMiesiaca = wszystkieWpisyKalendarza.filter(wpis => {
            const dataWpisu = new Date(wpis.id);
            return dataWpisu >= start && dataWpisu < end;
        });
        const sumy = wpisyZMiesiaca.reduce((acc, wpis) => {
            acc.praca += wpis.praca || 0;
            acc.fakturowane += wpis.fakturowane || 0;
            acc.nadgodziny += wpis.nadgodziny || 0;
            acc.jazda += wpis.jazda || 0;
            return acc;
        }, { praca: 0, fakturowane: 0, nadgodziny: 0, jazda: 0 });

        kalendarzPodsumowanieDiv.innerHTML = `
            <p>Praca w miesiącu: <strong>${sumy.praca.toFixed(1)} h</strong></p>
            <p>Fakturowane: <strong>${sumy.fakturowane.toFixed(1)} h</strong></p>
            <p>Nadgodziny: <strong>${sumy.nadgodziny.toFixed(1)} h</strong></p>
            <p>Czas Jazdy: <strong>${sumy.jazda.toFixed(1)} h</strong></p>
        `;
    }

    async function obslugaKalendarza(event) {
        const target = event.target;
        if (target.classList.contains('event-edit-btn')) { otworzModalGodzin(target.dataset.date); }
        if (target.classList.contains('event-delete-btn')) {
            const data = target.dataset.date;
            if (confirm(`Czy na pewno chcesz usunąć wpis z dnia ${data}?`)) {
                await deleteDoc(doc(db, "godziny_pracy", data));
            }
        }
    }

    // --- FUNKCJE OGÓLNE ---
    function obliczPodsumowanieFinansowe(wybranyMiesiac, zlecenia) {
        let sumaGodzin = 0, sumaBrutto = 0;
        if (!wybranyMiesiac || zlecenia.length === 0) return { sumaGodzin, sumaBrutto, sumaNetto: 0 };
        const zleceniaZMiesiaca = zlecenia.filter(z => z.status === 'ukończone' && z.dataUkonczenia && z.dataUkonczenia.startsWith(wybranyMiesiac));
        zleceniaZMiesiaca.forEach(zlecenie => {
            sumaGodzin += zlecenie.wyfakturowaneGodziny || 0;
            if (STAWKI[zlecenie.typZlecenia] && zlecenie.wyfakturowaneGodziny) {
                sumaBrutto += zlecenie.wyfakturowaneGodziny * STAWKI[zlecenie.typZlecenia].stawka;
            }
        });
        const sumaNetto = sumaBrutto * 0.70;
        return { sumaGodzin, sumaBrutto, sumaNetto };
    }

    function eksportujDoCSV(dane, nazwaPliku) {
        if (dane.length === 0) { alert("Brak danych do wyeksportowania."); return; }
        const csv = Papa.unparse(dane);
        const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = nazwaPliku;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function inicjujCiemnyMotyw() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        applyTheme(savedTheme);
        if (themeToggle) {
            themeToggle.checked = (savedTheme === 'dark');
            themeToggle.addEventListener('change', () => {
                const newTheme = themeToggle.checked ? 'dark' : 'light';
                applyTheme(newTheme);
                localStorage.setItem('theme', newTheme);
            });
        } else {
            console.error("Nie znaleziono przełącznika motywu (themeToggle)");
        }
    }
    function applyTheme(theme) { if (theme === 'dark') { document.body.dataset.theme = 'dark'; } else { delete document.body.dataset.theme; } }

    function inicjujZwijanie() {
  // Zakończone zlecenia
  if (zakonczoneZleceniaHeader && zakonczoneZleceniaContent) {
    zakonczoneZleceniaHeader.classList.add('collapsed');
    zakonczoneZleceniaContent.classList.add('collapsed');
    zakonczoneZleceniaHeader.addEventListener('click', () => {
      zakonczoneZleceniaHeader.classList.toggle('collapsed');
      zakonczoneZleceniaContent.classList.toggle('collapsed');
    }, { passive: true });
  }

  // Klienci (zwijana cała sekcja „Lista Klientów”)
  if (listaKlientowHeader && listaKlientowContent) {
    listaKlientowHeader.classList.add('collapsed');
    listaKlientowContent.classList.add('collapsed');
    listaKlientowHeader.addEventListener('click', () => {
      listaKlientowHeader.classList.toggle('collapsed');
      listaKlientowContent.classList.toggle('collapsed');
    }, { passive: true });
  }

  // Maszyny (zwijana cała sekcja „Lista Maszyn”)
  if (listaMaszynHeader && listaMaszynContent) {
    listaMaszynHeader.classList.add('collapsed');
    listaMaszynContent.classList.add('collapsed');
    listaMaszynHeader.addEventListener('click', () => {
      listaMaszynHeader.classList.toggle('collapsed');
      listaMaszynContent.classList.toggle('collapsed');
    }, { passive: true });
  }
}


    // WSTRZYKNIĘCIE POLA NOTATKI DO MODALA ZAKOŃCZENIA (bez modyfikacji index.html)
    function ensureZakonczenieNotatkaField() {
        const form = completeModalForm;
        if (!form) return;
        if (!form.querySelector('#zakonczenie-notatka')) {
            const group = document.createElement('div');
            group.className = 'form-group';
            group.innerHTML = `
                <label for="zakonczenie-notatka">Notatka do zakończenia (opcjonalnie):</label>
                <textarea id="zakonczenie-notatka" rows="3" placeholder="Co zostało zrobione, uwagi..."></textarea>
            `;
            // wstaw przed <hr> (pierwszym) lub na koniec
            const firstHr = form.querySelector('hr');
            if (firstHr) {
                form.insertBefore(group, firstHr);
            } else {
                form.appendChild(group);
            }
        }
    }

    // --- KLIENCI ---
    async function dodajKlienta(event) {
        event.preventDefault();
        const dane = {
            nazwa: klientForm['klient-nazwa'].value,
            nip: klientForm['klient-nip'].value || '---',
            adres: klientForm['klient-adres'].value || '---',
            telefon: klientForm['klient-telefon'].value || '---',
            createdAt: new Date()
        };
        try { await addDoc(collection(db, "klienci"), dane); klientForm.reset(); }
        catch (e) { console.error("Błąd dodawania klienta: ", e); }
    }

    function odswiezSelectKlientaDoZlecenia() {
        if (!zlecenieKlientSelect) return;

        const poprzedniWybor = zlecenieKlientSelect.value;
        const fraza = (zlecenieKlientFilterInput?.value || '').trim().toLowerCase();

        const klienciDlaSelecta = (_wszystkieKlienciCache || [])
            .filter(klient => {
                if (!fraza) return true;
                const tekst = [
                    klient.nazwa || '',
                    klient.nip || '',
                    klient.adres || '',
                    klient.telefon || ''
                ].join(' ').toLowerCase();
                return tekst.includes(fraza);
            })
            .sort((a, b) => (a.nazwa || '').localeCompare(b.nazwa || ''));

        const maWyniki = klienciDlaSelecta.length > 0;
        const placeholder = (_wszystkieKlienciCache?.length || 0) === 0
            ? '-- Brak klientów w bazie --'
            : (maWyniki ? '-- Wybierz klienta --' : '-- Brak klientów pasujących do filtra --');
        let optionsHtml = `<option value="">${placeholder}</option>`;
        optionsHtml += '<option value="szybkie-zlecenie">-- SZYBKIE ZLECENIE (bez klienta) --</option>';

        if (maWyniki) {
            klienciDlaSelecta.forEach(klient => {
                optionsHtml += `<option value="${klient.id}">${klient.nazwa || '(bez nazwy)'}</option>`;
            });
        }

        zlecenieKlientSelect.innerHTML = optionsHtml;

        const moznaPrzywrocic = poprzedniWybor === ''
            || poprzedniWybor === 'szybkie-zlecenie'
            || klienciDlaSelecta.some(klient => klient.id === poprzedniWybor);

        zlecenieKlientSelect.value = moznaPrzywrocic ? poprzedniWybor : '';
        zlecenieKlientSelect.dispatchEvent(new Event('change'));
    }

function wyswietlKlientow() {
  try {
    // Poczekaj na maszyny – bez nich nie budujemy list pod klientami
    if (_wszystkieMaszynyCache.length === 0 && _wszystkieKlienciCache.length > 0) {
      console.log("Czekam na maszyny przed renderowaniem klientów...");
      if (listaKlientowDiv) listaKlientowDiv.innerHTML = "<p>Ładowanie danych maszyn...</p>";
      return;
    }

    const frazaWyszukiwania = ((klientSearchInput && klientSearchInput.value) ? klientSearchInput.value : "").toLowerCase();
    wszystkieKlienci = [];

    let klienciHtml = "";
    let selectHtml = '<option value="">-- Wybierz klienta --</option>';
   

    // Filtrowanie
    const przefiltrowaniKlienci = (_wszystkieKlienciCache || []).filter(klient => {
      if (!frazaWyszukiwania) return true;
      const tekst = [
        klient.nazwa || "",
        klient.nip || "",
        klient.adres || "",
        klient.telefon || ""
      ].join(" ").toLowerCase();
      return tekst.includes(frazaWyszukiwania);
    });

    przefiltrowaniKlienci.forEach(klient => {
      wszystkieKlienci.push(klient);

      // Maszyny tego klienta
      const maszynyKlienta = (_wszystkieMaszynyCache || []).filter(m => m.klientId === klient.id);

      // ID kontenera maszyn
      const maszynyListaId = "client-" + klient.id + "-machines";

      // Kontener listy maszyn – domyślnie zwinięty
      let maszynyKontenerHtml = '';
      if (maszynyKlienta.length > 0) {
        const liMaszyny = maszynyKlienta.map(m => {
          const sn = (m.nrSeryjny && m.nrSeryjny !== '---') ? m.nrSeryjny : '---';
          const naz = (m.typMaszyny || '') + ' ' + (m.model || '');
          return `
            <li data-id="${m.id}">
              <span>${naz} (S/N: ${sn})</span>
              <a href="#" class="machine-history-link" data-maszyna-id="${m.id}" data-maszyna-nazwa="${naz}">Pokaż historię</a>
            </li>
          `;
        }).join("");

        maszynyKontenerHtml = `
          <div id="${maszynyListaId}" class="client-machine-list-container collapsed">
            <ul class="client-machine-list">
              ${liMaszyny}
            </ul>
          </div>
        `;
      } else {
        maszynyKontenerHtml = `
          <div id="${maszynyListaId}" class="client-machine-list-container collapsed">
            <p style="font-size: 0.8rem; margin-left: 0; padding: 5px 0; color: var(--text-color-light);">Brak maszyn</p>
          </div>
        `;
      }

      // Strzałka toggle + nagłówek klienta
      const strzalkaHtml = `<span class="toggle-machines-arrow collapsed" data-target="${maszynyListaId}">▼</span>`;
      const nipTxt = klient.nip ? ` (NIP: ${klient.nip})` : "";

      klienciHtml += `
        <div class="client-group" data-id="${klient.id}">
          <div class="client-header-item">
            <div class="client-header-text">
              <strong>${klient.nazwa || '---'}</strong>${nipTxt}<br>
              <small>${klient.adres || '---'} | ${klient.telefon || '---'}</small>
            </div>
            ${strzalkaHtml}
            <div class="client-header-actions">             
              <button class="btn-edit edit-klient-btn">Edytuj</button>
              <button class="delete-btn">Usuń</button>
            </div>
          </div>
          ${maszynyKontenerHtml}
        </div>
      `;

      // selecty
      selectHtml += `<option value="${klient.id}">${klient.nazwa || '(bez nazwy)'}</option>`;
    });

    if (listaKlientowDiv) {
      listaKlientowDiv.innerHTML = klienciHtml || "<p>Brak klientów w bazie lub pasujących do wyszukiwania.</p>";
    }
    if (maszynaKlientSelect) maszynaKlientSelect.innerHTML = selectHtml;
    odswiezSelectKlientaDoZlecenia();
    if (zlecenieKlientSelect) {
      const poprzedniWybor = zlecenieKlientSelect.value;
      zlecenieKlientSelect.innerHTML = selectZleceniaHtml;
      const istniejePoprzedniaOpcja = Array.from(zlecenieKlientSelect.options).some(option => option.value === poprzedniWybor);
      if (istniejePoprzedniaOpcja) {
        zlecenieKlientSelect.value = poprzedniWybor;
      }
      zlecenieKlientSelect.dispatchEvent(new Event('change'));
    }

    const assignKlientSelect = document.getElementById('assign-klient-select');
    if (assignKlientSelect) assignKlientSelect.innerHTML = selectHtml;

  } catch (err) {
    console.error("wyswietlKlientow() — błąd:", err);
    if (listaKlientowDiv) {
      listaKlientowDiv.innerHTML = `<p style="color:#e74c3c">Błąd renderowania listy klientów: ${String(err)}</p>`;
    }
  }
}

function nasluchujNaKlientow() {
  onSnapshot(
    query(collection(db, "klienci"), orderBy("nazwa")),
    (snapshot) => {
      _wszystkieKlienciCache = [];  // odśwież cache
      snapshot.forEach((docSnap) => {
        _wszystkieKlienciCache.push({ id: docSnap.id, ...docSnap.data() });
      });
      // Po załadowaniu klientów przerysuj listy, które ich potrzebują:
      wyswietlMaszyny();   // żeby przypiąć maszyny pod klientów
      wyswietlKlientow();  // żeby wyrenderować listę klientów + selecty
    }
  );
}
async function obslugaListyKlientow(event) {
  // 1) próbujemy znaleźć klikniętą strzałkę albo jej rodzica z data-target
  const arrow = event.target.closest('.toggle-machines-arrow');
  if (arrow) {
    const targetId = arrow.getAttribute('data-target');
    const kontener = document.getElementById(targetId);
    if (!kontener) {
      console.warn('[KLienci] Nie znaleziono kontenera maszyn dla', targetId);
      return;
    }
    arrow.classList.toggle('collapsed');
    kontener.classList.toggle('collapsed');
    // log pomocniczy:
    console.log('[Klienci] toggle', { targetId, collapsed: kontener.classList.contains('collapsed') });
    return;
  }

  // 2) klik w cały nagłówek wiersza klienta (poza przyciskami)
  const headerItem = event.target.closest('.client-header-item');
  if (headerItem &&
      !event.target.classList.contains('edit-klient-btn') &&
      !event.target.classList.contains('delete-btn')) {
    const arrow2 = headerItem.querySelector('.toggle-machines-arrow');
    if (arrow2) {
      const targetId2 = arrow2.getAttribute('data-target');
      const kontener2 = document.getElementById(targetId2);
      if (!kontener2) {
        console.warn('[Klienci] (header) brak kontenera', targetId2);
        return;
      }
      arrow2.classList.toggle('collapsed');
      kontener2.classList.toggle('collapsed');
      console.log('[Klienci] (header) toggle', { targetId: targetId2, collapsed: kontener2.classList.contains('collapsed') });
    }
    return;
  }

  // 3) przyciski akcji
  const clientGroup = event.target.closest('.client-group');
  if (!clientGroup) return;
  const klientId = clientGroup.dataset.id;

  if (event.target.classList.contains('machine-history-link')) {
    event.preventDefault();
    const maszynaId = event.target.dataset.maszynaId;
    const maszynaNazwa = event.target.dataset.maszynaNazwa;
    pokazHistorieSerwisowaMaszyny(maszynaId, maszynaNazwa);
    return;
  }

  if (event.target.classList.contains('delete-btn')) {
    if (confirm("Usunięcie klienta usunie też wszystkie jego maszyny i zlecenia. Kontynuować?")) {
      await deleteDoc(doc(db, "klienci", klientId));
      wyswietlMaszyny();
    }
    return;
  }

  if (event.target.classList.contains('edit-klient-btn')) {
    otworzModalEdycjiKlienta(klientId);
    return;
  }
}

        async function pokazHistorieSerwisowaMaszyny(maszynaId, maszynaNazwa) {
        document.getElementById('machine-history-title').textContent = `Historia Serwisowa: ${maszynaNazwa}`;
        machineHistoryList.innerHTML = '<p>Ładowanie historii...</p>';
        machineHistoryModal.style.display = 'block';

        try {
            const qMasz = query(
                collection(db, "zlecenia"),
                where("maszynaId", "==", maszynaId),
                where("status", "==", "ukończone"),
                orderBy("dataUkonczenia", "desc")
            );
            const querySnapshot = await getDocs(qMasz);

            let historiaHtml = '';
            if (querySnapshot.empty) {
                historiaHtml = '<p>Brak historii serwisowej (zakończonych zleceń) dla tej maszyny.</p>';
            } else {
                querySnapshot.forEach((d) => {
                    const zlecenie = d.data();
                    const uzyteCzesciHtml = zlecenie.uzyteCzesci?.length > 0
                        ? `<br><small>Użyto: ${zlecenie.uzyteCzesci.map(c => `${c.nazwa} (x${c.ilosc})`).join(', ')}</small>`
                        : '';
                    const wzHtml = zlecenie.zakonczenieNumerWZ ? `<br><small>WZ: ${zlecenie.zakonczenieNumerWZ}</small>` : '';                        
                    const notatkaHtml = zlecenie.zakonczenieNotatka ? `<br><small>📝 ${zlecenie.zakonczenieNotatka}</small>` : '';
                    historiaHtml += `
                        <li data-id="${d.id}">
                            <span>
                                <strong>Nr: ${zlecenie.nrZlecenia}</strong> (Ukończono: ${zlecenie.dataUkonczenia || 'b.d.'})<br>
                                <em>Opis: ${zlecenie.opis || 'Brak'}</em><br>
                                Fakturowano: <strong>${zlecenie.wyfakturowaneGodziny || 0}h</strong> | Typ: <strong>${zlecenie.typZlecenia || '?'}</strong>
                                ${uzyteCzesciHtml}${wzHtml}${notatkaHtml}
                            </span>
                            <div>
                                <button class="btn-details details-zlecenie-btn">Szczegóły</button>
                                <button class="btn-edit edit-zlecenie-btn">Edytuj</button>
                            </div>
                        </li>`;
                });
                historiaHtml = `<ul>${historiaHtml}</ul>`;
            }

            machineHistoryList.innerHTML = historiaHtml;
            machineHistoryList.removeEventListener('click', obslugaListyZlecenWModaluHistorii);
            machineHistoryList.addEventListener('click', obslugaListyZlecenWModaluHistorii);

        } catch (error) {
            console.error("Błąd podczas pobierania historii serwisowej:", error);
            machineHistoryList.innerHTML = '<p style="color: red;">Wystąpił błąd podczas ładowania historii.</p>';
        }
    }

    function obslugaListyZlecenWModaluHistorii(event) {
        const li = event.target.closest('li');
        if (!li) return;
        const docId = li.dataset.id;
        if (event.target.classList.contains('details-zlecenie-btn')) {
            otworzModalSzczegolowZlecenia(docId);
        }
        if (event.target.classList.contains('edit-zlecenie-btn')) {
            otworzModalEdycjiZlecenia(docId);
        }
    }

    function otworzModalEdycjiKlienta(klientId) {
        const klient = _wszystkieKlienciCache.find(k => k.id === klientId);
        if (!klient) return;
        editKlientForm['edit-klient-id'].value = klient.id;
        editKlientForm['edit-klient-nazwa'].value = klient.nazwa;
        editKlientForm['edit-klient-nip'].value = klient.nip === '---' ? '' : klient.nip;
        editKlientForm['edit-klient-adres'].value = klient.adres === '---' ? '' : klient.adres;
        editKlientForm['edit-klient-telefon'].value = klient.telefon === '---' ? '' : klient.telefon;
        editKlientModal.style.display = 'block';
    }

    async function zapiszEdycjeKlienta(event) {
        event.preventDefault();
        const klientId = editKlientForm['edit-klient-id'].value;
        const stareDane = _wszystkieKlienciCache.find(k => k.id === klientId);
        if (!stareDane) {
            console.error("Nie znaleziono starych danych klienta w cache!");
            alert("Wystąpił błąd podczas zapisu - nie znaleziono danych klienta.");
            return;
        }
        const nowaNazwa = editKlientForm['edit-klient-nazwa'].value;

        const dane = {
            nazwa: nowaNazwa,
            nip: editKlientForm['edit-klient-nip'].value || '---',
            adres: editKlientForm['edit-klient-adres'].value || '---',
            telefon: editKlientForm['edit-klient-telefon'].value || '---',
        };
        try {
            await updateDoc(doc(db, "klienci", klientId), dane);

            if (stareDane.nazwa !== nowaNazwa) {
                const qMaszyny = query(collection(db, "maszyny"), where("klientId", "==", klientId));
                const maszynySnap = await getDocs(qMaszyny);
                const batchMaszyny = runTransaction(db, async (transaction) => {
                    maszynySnap.forEach(maszynaDoc => {
                        transaction.update(maszynaDoc.ref, { klientNazwa: nowaNazwa });
                    });
                });

                const qZlecenia = query(collection(db, "zlecenia"), where("klientId", "==", klientId));
                const zleceniaSnap = await getDocs(qZlecenia);
                const batchZlecenia = runTransaction(db, async (transaction) => {
                    zleceniaSnap.forEach(zlecenieDoc => {
                        transaction.update(zlecenieDoc.ref, { klientNazwa: nowaNazwa });
                    });
                });

                const powiazaneZleceniaIds = _wszystkieZleceniaCache
                    .filter(z => z.klientId === klientId)
                    .map(z => z.id);

                if (powiazaneZleceniaIds.length > 0) {
                    const qGodziny = query(collection(db, "godziny_pracy"), where("zlecenieId", "in", powiazaneZleceniaIds));
                    const godzinySnap = await getDocs(qGodziny);
                    const batchGodziny = runTransaction(db, async (transaction) => {
                        godzinySnap.forEach(godzinaDoc => {
                            transaction.update(godzinaDoc.ref, { klientNazwa: nowaNazwa });
                        });
                    });
                    await Promise.all([batchMaszyny, batchZlecenia, batchGodziny]);
                } else {
                    await Promise.all([batchMaszyny, batchZlecenia]);
                }
            }

            editKlientModal.style.display = 'none';
        } catch (e) {
            console.error("Błąd aktualizacji klienta lub powiązanych dokumentów:", e);
            alert("Wystąpił błąd podczas zapisywania zmian. Sprawdź konsolę.");
        }
    }

    // --- MASZYNY ---
    async function dodajMaszyne(event) {
        event.preventDefault();
        const wybranyKlientId = maszynaKlientSelect.value;
        if (!wybranyKlientId) { alert("Proszę wybrać klienta!"); return; }
        const klient = _wszystkieKlienciCache.find(k => k.id === wybranyKlientId);
        if (!klient) { alert("Błąd: Nie znaleziono danych wybranego klienta."); return; }

        const dane = {
            klientId: wybranyKlientId, klientNazwa: klient.nazwa,
            typMaszyny: maszynaForm['maszyna-typ'].value,
            model: maszynaForm['maszyna-model'].value,
            nrSeryjny: maszynaForm['maszyna-serial'].value || '---',
            rokProdukcji: Number(maszynaForm['maszyna-rok'].value) || null,
            motogodziny: Number(maszynaForm['maszyna-mth'].value) || 0,
            createdAt: new Date()
        };
        try { await addDoc(collection(db, "maszyny"), dane); maszynaForm.reset(); }
        catch (e) { console.error("Błąd dodawania maszyny: ", e); }
    }

    function wyswietlMaszyny() {
        if (_wszystkieKlienciCache.length === 0 && _wszystkieMaszynyCache.length > 0) {
            listaMaszynDiv.innerHTML = "<p>Ładowanie danych klientów...</p>";
            return;
        }
        const frazaWyszukiwania = maszynaSearchInput.value.toLowerCase();
        wszystkieMaszyny = [];

        const przefiltrowaneMaszyny = _wszystkieMaszynyCache.filter(maszyna => {
            if (!frazaWyszukiwania) return true;
            const tekst = `${maszyna.klientNazwa} ${maszyna.typMaszyny} ${maszyna.model} ${maszyna.nrSeryjny}`.toLowerCase();
            return tekst.includes(frazaWyszukiwania);
        });

        const pogrupowaneMaszyny = przefiltrowaneMaszyny.reduce((acc, maszyna) => {
            (acc[maszyna.klientNazwa] = acc[maszyna.klientNazwa] || []).push(maszyna);
            return acc;
        }, {});
        let maszynyHtml = '';
        for (const klientNazwa in pogrupowaneMaszyny) {
            maszynyHtml += `<div class="client-group">
                <div class="client-header"><h4>${klientNazwa}</h4><span class="arrow">▶</span></div>
                <ul class="machine-list">
                    ${pogrupowaneMaszyny[klientNazwa].map(maszyna =>
                        `<li data-id="${maszyna.id}">
                            <span>${maszyna.typMaszyny} ${maszyna.model} (S/N: ${maszyna.nrSeryjny})</span>
                            <div>
                                <a href="#" class="machine-history-link" data-maszyna-id="${maszyna.id}" data-maszyna-nazwa="${maszyna.typMaszyny} ${maszyna.model}">Historia</a>
                                <button class="btn-edit edit-maszyna-btn">Edytuj</button>
                                <button class="delete-btn">Usuń</button>
                            </div>
                        </li>`).join('')}
                </ul></div>`;
        }
        listaMaszynDiv.innerHTML = maszynyHtml || "<p>Brak maszyn w bazie lub pasujących do wyszukiwania.</p>";
        zlecenieKlientSelect.dispatchEvent(new Event('change'));
    }

    function aktualizujMaszynyDlaZlecenia() {
        if (!zlecenieMaszynaSelect) return;

        const wybranyKlientId = zlecenieKlientSelect.value;

        if (!wybranyKlientId) {
            zlecenieMaszynaSelect.innerHTML = '<option value="">-- Najpierw wybierz klienta --</option>';
            zlecenieMaszynaSelect.disabled = true;
            return;
        }

        if (wybranyKlientId === 'szybkie-zlecenie') {
            zlecenieMaszynaSelect.innerHTML = '<option value="">-- Szybkie zlecenie (bez maszyny) --</option>';
            zlecenieMaszynaSelect.disabled = true;
            return;
        }

        const maszynyKlienta = _wszystkieMaszynyCache
            .filter(maszyna => maszyna.klientId === wybranyKlientId)
            .sort((a, b) => {
                const typPorownanie = (a.typMaszyny || '').localeCompare(b.typMaszyny || '');
                if (typPorownanie !== 0) return typPorownanie;
                return (a.model || '').localeCompare(b.model || '');
            });

        if (maszynyKlienta.length === 0) {
            zlecenieMaszynaSelect.innerHTML = '<option value="">-- Brak maszyn dla klienta --</option>';
            zlecenieMaszynaSelect.disabled = true;
            return;
        }

        const opcjeMaszyn = maszynyKlienta
            .map(maszyna => {
                const sn = maszyna.nrSeryjny && maszyna.nrSeryjny !== '---' ? ` (S/N: ${maszyna.nrSeryjny})` : '';
                return `<option value="${maszyna.id}">${maszyna.typMaszyny || ''} ${maszyna.model || ''}${sn}</option>`;
            })
            .join('');

        zlecenieMaszynaSelect.innerHTML = `<option value="">-- Wybierz maszynę --</option>${opcjeMaszyn}`;
        zlecenieMaszynaSelect.disabled = false;
    }


    function nasluchujNaMaszyny() {
        onSnapshot(query(collection(db, "maszyny"), orderBy("klientNazwa")), (snapshot) => {
            _wszystkieMaszynyCache = [];
            wszystkieMaszyny = [];
            snapshot.forEach(docSnap => {
                const maszyna = { id: docSnap.id, ...docSnap.data() };
                _wszystkieMaszynyCache.push(maszyna);
                wszystkieMaszyny.push(maszyna);
            });
            wyswietlMaszyny();
            wyswietlKlientow();
        });
    }

    async function obslugaListyMaszyn(event) {
  const el = event.target;

  // Klik w pasek .client-header (grupa maszyn danego klienta)
  const header = el.closest('.client-header');
  if (header) {
    header.classList.toggle('open');
    const list = header.nextElementSibling; // powinno być ul.machine-list
    if (list && list.classList.contains('machine-list')) {
      list.classList.toggle('open');
    }
    return;
  }

  if (el.classList.contains('machine-history-link')) {
    event.preventDefault();
    const maszynaId = el.dataset.maszynaId;
    const maszynaNazwa = el.dataset.maszynaNazwa;
    pokazHistorieSerwisowaMaszyny(maszynaId, maszynaNazwa);
    return;
  }

  const li = el.closest('li');
  if (!li) return;
  const maszynaId = li.dataset.id;

  if (el.classList.contains('delete-btn')) {
    if (confirm("Usunięcie maszyny usunie też jej zlecenia. Kontynuować?")) {
      await deleteDoc(doc(db, "maszyny", maszynaId));
      wyswietlKlientow();
    }
    return;
  }

  if (el.classList.contains('edit-maszyna-btn')) {
    otworzModalEdycjiMaszyny(maszynaId);
    return;
  }
}

function otworzModalEdycjiMaszyny(maszynaId) {
    const maszyna = _wszystkieMaszynyCache.find(m => m.id === maszynaId);
    if (!maszyna) return;
    editMaszynaForm['edit-maszyna-id'].value = maszyna.id;
    document.getElementById('edit-maszyna-klient-nazwa').textContent = maszyna.klientNazwa;
    editMaszynaForm['edit-maszyna-typ'].value = maszyna.typMaszyny;
    editMaszynaForm['edit-maszyna-model'].value = maszyna.model;
    editMaszynaForm['edit-maszyna-serial'].value = maszyna.nrSeryjny === '---' ? '' : maszyna.nrSeryjny;
    editMaszynaForm['edit-maszyna-rok'].value = maszyna.rokProdukcji || '';
    editMaszynaForm['edit-maszyna-mth'].value = maszyna.motogodziny || 0;
    editMaszynaModal.style.display = 'block';
}

async function zapiszEdycjeMaszyny(event) {
    event.preventDefault();
    const maszynaId = editMaszynaForm['edit-maszyna-id'].value;
    const stareDane = _wszystkieMaszynyCache.find(m => m.id === maszynaId);
    if (!stareDane) {
        console.error("Nie znaleziono starych danych maszyny w cache!");
        alert("Wystąpił błąd podczas zapisu - nie znaleziono danych maszyny.");
        return;
    }
    const nowyModel = editMaszynaForm['edit-maszyna-model'].value;
    const nowyTyp = editMaszynaForm['edit-maszyna-typ'].value;

    const dane = {
        typMaszyny: nowyTyp,
        model: nowyModel,
        nrSeryjny: editMaszynaForm['edit-maszyna-serial'].value || '---',
        rokProdukcji: Number(editMaszynaForm['edit-maszyna-rok'].value) || null,
        motogodziny: Number(editMaszynaForm['edit-maszyna-mth'].value) || 0,
    };
    try {
        await updateDoc(doc(db, "maszyny", maszynaId), dane);

        if (stareDane.model !== nowyModel || stareDane.typMaszyny !== nowyTyp) {
            const qZlecenia = query(collection(db, "zlecenia"), where("maszynaId", "==", maszynaId));
            await runTransaction(db, async (transaction) => {
                const zleceniaSnap = await getDocs(qZlecenia);
                zleceniaSnap.forEach(zlecenieDoc => {
                    transaction.update(zlecenieDoc.ref, { model: nowyModel, typMaszyny: nowyTyp });
                });
            });
        }

        editMaszynaModal.style.display = 'none';
    } catch (e) {
        console.error("Błąd aktualizacji maszyny lub powiązanych zleceń:", e);
        alert("Wystąpił błąd podczas zapisywania zmian. Sprawdź konsolę.");
    }
}

// --- PRZEJAZDY (placeholdery) ---
function wyswietlPrzejazdy() {}
function filtrujIwyswietlPrzejazdy() {}
async function dodajLubEdytujPrzejazd(event) { event.preventDefault(); }
async function obslugaListyPrzejazdow(event) {}

// --- ZLECENIA ---
function wyswietlZlecenia() {
    if (_wszystkieMaszynyCache.length === 0 && _wszystkieZleceniaCache.length > 0) {
        aktywneZleceniaLista.innerHTML = "<p>Ładowanie danych maszyn...</p>";
        ukonczoneZleceniaLista.innerHTML = "<p>Ładowanie danych maszyn...</p>";
        return;
    }

    const frazaWyszukiwania = zlecenieSearchInput.value.toLowerCase();
    wszystkieZlecenia = [];
    let aktywneHtml = '', ukonczoneHtml = '';

    const przefiltrowaneZlecenia = _wszystkieZleceniaCache.filter(zlecenie => {
        if (!frazaWyszukiwania) return true;
        const maszyna = _wszystkieMaszynyCache.find(m => m.id === zlecenie.maszynaId);
        const klient = _wszystkieKlienciCache.find(k => k.id === zlecenie.klientId);
        const nazwa = klient ? `${klient.nazwa} - ${maszyna ? maszyna.typMaszyny : ''} ${maszyna ? maszyna.model : ''}` : (zlecenie.nrZlecenia || 'Szybkie zlecenie');
        const tekst = `${nazwa} ${zlecenie.nrZlecenia} ${klient ? klient.nazwa : ''} ${maszyna ? maszyna.model : ''} ${maszyna ? maszyna.typMaszyny : ''}`.toLowerCase();
        return tekst.includes(frazaWyszukiwania);
    });

    przefiltrowaneZlecenia.forEach(zlecenie => {
        wszystkieZlecenia.push(zlecenie);

        const maszyna = _wszystkieMaszynyCache.find(m => m.id === zlecenie.maszynaId);
        const klient = _wszystkieKlienciCache.find(k => k.id === zlecenie.klientId);
        const nazwa = klient ? `${klient.nazwa} - ${maszyna ? maszyna.typMaszyny : ''} ${maszyna ? maszyna.model : ''}` : (zlecenie.nrZlecenia || 'Szybkie zlecenie');

        if (zlecenie.status === 'aktywne' || zlecenie.status === 'nieprzypisane') {
            const przycisk = zlecenie.status === 'nieprzypisane'
                ? `<button class="assign-btn btn-edit">Przypisz</button>`
                : `<button class="complete-btn">Zakończ</button>`;
            aktywneHtml += `<li data-id="${zlecenie.id}">
                <span><strong>${nazwa}</strong><br><em>${zlecenie.opis || ''}</em></span>
                <div>
                    <button class="btn-details details-zlecenie-btn">Szczegóły</button>
                    ${przycisk}
                    <button class="delete-btn">Usuń</button>
                </div>
            </li>`;
        } else {
            const nazwaMaszyny = klient ? `${klient.nazwa} - ${maszyna ? maszyna.typMaszyny : ''} ${maszyna ? maszyna.model : ''}` : 'Zlecenie usuniętej maszyny';
            const uzyteCzesciHtml = zlecenie.uzyteCzesci?.length > 0 ? `<br><small>Użyto: ${zlecenie.uzyteCzesci.map(c => `${c.nazwa} (x${c.ilosc})`).join(', ')}</small>` : '';
                        const wzHtml = zlecenie.zakonczenieNumerWZ ? `<br><small>WZ: ${zlecenie.zakonczenieNumerWZ}</small>` : '';
            const notatkaHtml = zlecenie.zakonczenieNotatka ? `<br><small>📝 ${zlecenie.zakonczenieNotatka}</small>` : '';
            ukonczoneHtml += `<li data-id="${zlecenie.id}">
                <span>
                    <strong>${nazwaMaszyny}</strong> (Nr: ${zlecenie.nrZlecenia})<br>
                    <em>Ukończono (${zlecenie.dataUkonczenia||'b.d.'})</em><br>
                    Fakturowano: <strong>${zlecenie.wyfakturowaneGodziny||0}h</strong> | Typ: <strong>${zlecenie.typZlecenia||'?'}</strong>
                    ${uzyteCzesciHtml}${wzHtml}${notatkaHtml}
                </span>
                <div>
                    <button class="btn-details details-zlecenie-btn">Szczegóły</button>
                    <button class="btn-edit edit-zlecenie-btn">Edytuj</button>
                    <button class="btn-edit reopen-btn">Otwórz ponownie</button>
                    <button class="delete-btn">Usuń</button>
                </div>
            </li>`;
        }
    });

    aktywneZleceniaLista.innerHTML = aktywneHtml ? `<ul>${aktywneHtml}</ul>` : "<p>Brak aktywnych zleceń lub pasujących do wyszukiwania.</p>";
    ukonczoneZleceniaLista.innerHTML = ukonczoneHtml ? `<ul>${ukonczoneHtml}</ul>` : "<p>Brak ukończonych zleceń lub pasujących do wyszukiwania.</p>";
    obliczIPokazPodsumowanieFinansowe();
}

function nasluchujNaZlecenia() {
    onSnapshot(query(collection(db, "zlecenia"), orderBy("createdAt", "desc")), (snapshot) => {
        _wszystkieZleceniaCache = [];
        wszystkieZlecenia = [];
        snapshot.forEach(docSnap => {
            const zlecenie = { id: docSnap.id, ...docSnap.data() };
            _wszystkieZleceniaCache.push(zlecenie);
            wszystkieZlecenia.push(zlecenie);
        });
        wyswietlZlecenia();
        wyswietlWpisyKalendarza();
    });
}

async function dodajZlecenie(event) {
    event.preventDefault();
    const wybranyKlientId = zlecenieKlientSelect.value;
    const wybranaMaszynaId = zlecenieMaszynaSelect.value;
    const dataRozpoczecia = null;
    const dataZakonczenia = null;

    const historia = [{ timestamp: new Date().toISOString(), akcja: "Utworzono zlecenie" }];

    let dane;
    if (wybranyKlientId === "szybkie-zlecenie") {
        dane = {
            status: 'nieprzypisane',
            nrZlecenia: zlecenieForm['nr-zlecenia'].value,
            opis: zlecenieForm['opis-usterki'].value,
            dataRozpoczecia, dataZakonczenia,
            historia,
            createdAt: new Date(),
            zakonczenieNotatka: null,
            zakonczenieNumerWZ: null
        };
    } else if (wybranyKlientId && wybranaMaszynaId) {
        const maszyna = _wszystkieMaszynyCache.find(m => m.id === wybranaMaszynaId);
        const klient = _wszystkieKlienciCache.find(k => k.id === wybranyKlientId);
        if (!maszyna || !klient) { alert("Błąd: Nie znaleziono danych klienta lub maszyny."); return; }

        dane = {
            maszynaId: wybranaMaszynaId, klientId: klient.id, klientNazwa: klient.nazwa,
            typMaszyny: maszyna.typMaszyny, model: maszyna.model, status: 'aktywne',
            nrZlecenia: zlecenieForm['nr-zlecenia'].value, opis: zlecenieForm['opis-usterki'].value,
            motogodziny: Number(zlecenieForm.motogodziny.value) || maszyna.motogodziny,
            dataRozpoczecia, dataZakonczenia,
            historia,
            createdAt: new Date(),
            zakonczenieNotatka: null,
            zakonczenieNumerWZ: null
        };
    } else { alert("Wybierz klienta i maszynę LUB opcję 'Szybkie Zlecenie'."); return; }

    try {
        await addDoc(collection(db, "zlecenia"), dane);
        if (dane.maszynaId && zlecenieForm.motogodziny.value) {
            await updateDoc(doc(db, "maszyny", dane.maszynaId), { motogodziny: dane.motogodziny });
        }
        zlecenieForm.reset();
        zlecenieKlientSelect.value = '';
        zlecenieMaszynaSelect.innerHTML = '<option value="">-- Najpierw wybierz klienta --</option>';
        zlecenieMaszynaSelect.disabled = true;
        zlecenieKlientSelect.dispatchEvent(new Event('change'));
    } catch (e) { console.error("Błąd dodawania zlecenia: ", e); }
}

function obliczIPokazPodsumowanieFinansowe() {
    const podsumowanie = obliczPodsumowanieFinansowe(miesiacSummaryInput.value, wszystkieZlecenia);
    summaryContainer.innerHTML = `
        <p>Suma godzin: <strong>${podsumowanie.sumaGodzin.toFixed(2)} h</strong></p>
        <p>Wartość Brutto: <strong>${podsumowanie.sumaBrutto.toFixed(2)} zł</strong></p>
        <p>Wartość Netto (po 30%): <strong>${podsumowanie.sumaNetto.toFixed(2)} zł</strong></p>`;
}

async function obslugaListyZlecen(event) {
    const li = event.target.closest('li'); if (!li) return;
    const docId = li.dataset.id;

    if (event.target.classList.contains('delete-btn')) {
        if (confirm("Na pewno usunąć?")) { await deleteDoc(doc(db, "zlecenia", docId)); }
        return;
    }
    if (event.target.classList.contains('details-zlecenie-btn')) {
        otworzModalSzczegolowZlecenia(docId);
        return;
    }
    if (event.target.classList.contains('assign-btn')) {
        const zlecenie = _wszystkieZleceniaCache.find(z => z.id === docId);
        if (zlecenie) {
            document.getElementById('assign-zlecenie-id').value = docId;
            document.getElementById('assign-zlecenie-opis').textContent = zlecenie.nrZlecenia;
            document.getElementById('assign-machine-section').style.display = 'none';
            assignForm.reset();
            assignModal.style.display = 'block';
        }
        return;
    }
    if (event.target.classList.contains('complete-btn')) {
        const docSnap = await getDoc(doc(db, "zlecenia", docId));
        if (docSnap.exists()) {
            const zlecenie = docSnap.data();
            const maszyna = _wszystkieMaszynyCache.find(m => m.id === zlecenie.maszynaId);
            const klient = _wszystkieKlienciCache.find(k => k.id === zlecenie.klientId);
            const nazwaMaszyny = klient ? `${klient.nazwa} - ${maszyna ? maszyna.typMaszyny : ''} ${maszyna ? maszyna.model : ''}` : (zlecenie.nrZlecenia || 'Nieprzypisane');
            document.getElementById('modal-klient').textContent = nazwaMaszyny;
            document.getElementById('modal-nr-zlecenia').textContent = zlecenie.nrZlecenia;
            completeModalForm.reset();         
            document.getElementById('complete-zlecenie-id').value = docId;
            czesciDoZlecenia = [];
            renderCzesciDoZlecenia();
            renderMagazynWModalu();
            ensureZakonczenieNotatkaField();
            completeModal.style.display = 'block';
        }
        return;
    }
    if (event.target.classList.contains('edit-zlecenie-btn')) {
        const zlecenie = _wszystkieZleceniaCache.find(z => z.id === docId);
        if (zlecenie && zlecenie.status === 'ukończone') {
            otworzModalEdycjiZlecenia(docId);
        } else if (zlecenie) {
            alert("Można edytować tylko zakończone zlecenia.");
        }
        return;
    }
    if (event.target.classList.contains('reopen-btn')) {
        const reopenReason = prompt("Powód ponownego otwarcia (opcjonalnie):", "");
        try {
            const zlecenieRef = doc(db, "zlecenia", docId);
            const snap = await getDoc(zlecenieRef);
            if (!snap.exists()) return;
            const data = snap.data();
            const nowaHistoria = [...(data.historia || []), {
                timestamp: new Date().toISOString(),
                akcja: `Ponownie otwarto zlecenie${reopenReason ? `: ${reopenReason}` : ''}`
            }];
            await updateDoc(zlecenieRef, {
                status: 'aktywne',
                dataUkonczenia: null,
                wyfakturowaneGodziny: null,
                typZlecenia: null,
                zakonczenieNotatka: null,
                zakonczenieNumerWZ: null,               
                historia: nowaHistoria
            });
        } catch (e) {
            console.error("Błąd przy ponownym otwieraniu:", e);
            alert("Nie udało się ponownie otworzyć zlecenia.");
        }
        return;
    }
}

function otworzModalEdycjiZlecenia(zlecenieId) {
    const zlecenie = _wszystkieZleceniaCache.find(z => z.id === zlecenieId);
    if (!zlecenie) return;
    const maszyna = _wszystkieMaszynyCache.find(m => m.id === zlecenie.maszynaId);
    const klient = _wszystkieKlienciCache.find(k => k.id === zlecenie.klientId);
    const nazwaMaszyny = klient ? `${klient.nazwa} - ${maszyna ? maszyna.typMaszyny : ''} ${maszyna ? maszyna.model : ''}` : (zlecenie.nrZlecenia || 'Nieprzypisane');

    editZlecenieForm['edit-zlecenie-id'].value = zlecenie.id;
    document.getElementById('edit-zlecenie-klient').textContent = nazwaMaszyny;
    document.getElementById('edit-zlecenie-nr').textContent = zlecenie.nrZlecenia;
    editZlecenieForm['edit-wyfakturowane-godziny'].value = zlecenie.wyfakturowaneGodziny || 0;
    editZlecenieForm['edit-typ-zlecenia'].value = zlecenie.typZlecenia || 'S';
    editZlecenieForm['edit-zakonczenie-wz'].value = zlecenie.zakonczenieNumerWZ || '';
    
    editZlecenieModal.style.display = 'block';
}

async function zapiszEdycjeZlecenia(event) {
    event.preventDefault();
    const zlecenieId = editZlecenieForm['edit-zlecenie-id'].value;
    const noweGodziny = Number(editZlecenieForm['edit-wyfakturowane-godziny'].value);
    const nowyTyp = editZlecenieForm['edit-typ-zlecenia'].value;
    const nowyNumerWz = editZlecenieForm['edit-zakonczenie-wz'].value.trim();

    if (isNaN(noweGodziny) || noweGodziny < 0) {
        alert("Podaj poprawną liczbę godzin.");
        return;
    }

    const zlecenieRef = doc(db, "zlecenia", zlecenieId);
    try {
        const zlecenieSnap = await getDoc(zlecenieRef);
        const zlecenieData = zlecenieSnap.data();
        const staraHistoria = zlecenieData.historia || [];
        const staryTyp = zlecenieData.typZlecenia;
        const stareGodziny = zlecenieData.wyfakturowaneGodziny;
        const staryNumerWz = zlecenieData.zakonczenieNumerWZ || '';

        let wpisHistorii = `Edytowano zakończone zlecenie: `;
        const zmiany = [];
        if (stareGodziny !== noweGodziny) zmiany.push(`Godziny zmieniono z ${stareGodziny}h na ${noweGodziny}h`);
        if (staryTyp !== nowyTyp) zmiany.push(`Typ zmieniono z ${staryTyp} na ${nowyTyp}`);
                const staryTekst = staryNumerWz ? staryNumerWz : 'brak';
            const nowyTekst = nowyNumerWz ? nowyNumerWz : 'brak';
            zmiany.push(`Numer WZ zmieniono z ${staryTekst} na ${nowyTekst}`);
        }
         if (staryNumerWz !== nowyNumerWz) {
            const staryTekst = staryNumerWz ? staryNumerWz : 'brak';
            const nowyTekst = nowyNumerWz ? nowyNumerWz : 'brak';
            zmiany.push(`Numer WZ zmieniono z ${staryTekst} na ${nowyTekst}`);
        }
        if (zmiany.length === 0) {
            editZlecenieModal.style.display = 'none';
            return;
        }
        wpisHistorii += zmiany.join('; ');
        const nowaHistoria = [...staraHistoria, { timestamp: new Date().toISOString(), akcja: wpisHistorii }];

        await updateDoc(zlecenieRef, {
            wyfakturowaneGodziny: noweGodziny,
            typZlecenia: nowyTyp,
            zakonczenieNumerWZ: nowyNumerWz || null,
            historia: nowaHistoria
        });
        editZlecenieModal.style.display = 'none';
        alert("Zlecenie zaktualizowane.");
    } catch (e) {
        console.error("Błąd aktualizacji zlecenia:", e);
        alert("Wystąpił błąd podczas zapisywania zmian. Sprawdź konsolę.");
    }
}

async function otworzModalSzczegolowZlecenia(zlecenieId) {
    const zlecenie = _wszystkieZleceniaCache.find(z => z.id === zlecenieId);
    if (!zlecenie) { alert("Nie znaleziono zlecenia!"); return; }
    const maszyna = _wszystkieMaszynyCache.find(m => m.id === zlecenie.maszynaId);
    const klient = _wszystkieKlienciCache.find(k => k.id === zlecenie.klientId);

    document.getElementById('details-zlecenie-title').textContent = `Szczegóły Zlecenia #${zlecenie.nrZlecenia}`;

    const infoDiv = document.getElementById('details-zlecenie-info');
    infoDiv.innerHTML = `
        <div class="details-group"><strong>Klient:</strong> <p>${klient ? klient.nazwa : '---'}</p></div>
        <div class="details-group"><strong>Maszyna:</strong> <p>${maszyna ? `${maszyna.typMaszyny} ${maszyna.model}` : '---'}</p></div>
        <div class="details-group"><strong>Data Rozpoczęcia:</strong> <p>${zlecenie.dataRozpoczecia || 'Brak'}</p></div>
        <div class="details-group"><strong>Data Zakończenia:</strong> <p>${zlecenie.dataZakonczenia || 'Brak'}</p></div>
        <div class="details-group"><strong>Status:</strong> <p>${zlecenie.status}</p></div>
        <div class="details-group"><strong>Opis:</strong> <p>${zlecenie.opis || 'Brak opisu'}</p></div>
    `;

    if (zlecenie.status === 'ukończone') {
         const wzHtml = zlecenie.zakonczenieNumerWZ ? `<div class="details-group"><strong>Numer WZ:</strong> <p>${zlecenie.zakonczenieNumerWZ}</p></div>` : '';       
        const notatkaHtml = zlecenie.zakonczenieNotatka ? `<div class="details-group"><strong>Notatka przy zakończeniu:</strong> <p>${zlecenie.zakonczenieNotatka}</p></div>` : '';
        infoDiv.innerHTML += `
            <div class="details-group"><strong>Data Faktycznego Zakończenia:</strong> <p>${zlecenie.dataUkonczenia}</p></div>
            <div class="details-group"><strong>Fakturowane Godziny:</strong> <p>${zlecenie.wyfakturowaneGodziny || 0} h</p></div>
            <div class="details-group"><strong>Typ Zlecenia:</strong> <p>${zlecenie.typZlecenia} (${STAWKI[zlecenie.typZlecenia]?.nazwa || 'Nieznany'})</p></div>
            <div class="details-group"><strong>Użyte Części:</strong> <p>${zlecenie.uzyteCzesci?.length > 0 ? zlecenie.uzyteCzesci.map(c => `${c.nazwa} (x${c.ilosc})`).join(', ') : 'Brak'}</p></div>
            ${wzHtml}${notatkaHtml}
            ${wzHtml}${notatkaHtml}           
        `;
    }

    const historiaDiv = document.getElementById('details-zlecenie-historia');
    if (zlecenie.historia && zlecenie.historia.length > 0) {
        historiaDiv.innerHTML = zlecenie.historia
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .map(wpis => `
                <div class="history-item">
                    <span class="date">[${new Date(wpis.timestamp).toLocaleString('pl-PL')}]</span>
                    ${wpis.akcja}
                </div>
            `).join('');
    } else { historiaDiv.innerHTML = '<p>Brak historii dla tego zlecenia.</p>'; }

    const kalendarzDiv = document.getElementById('details-zlecenie-kalendarz');
    kalendarzDiv.innerHTML = '<p>Ładowanie wpisów z kalendarza...</p>';
    const qKalendarz = query(collection(db, "godziny_pracy"), where("zlecenieId", "==", zlecenieId), orderBy("id", "desc"));
    const querySnapshotKalendarz = await getDocs(qKalendarz);
    let kalendarzHtml = '';
    querySnapshotKalendarz.forEach((docSnap) => {
        const wpis = docSnap.data();
        const dataWpisu = docSnap.id;
        kalendarzHtml += `
            <div class="calendar-entry-item">
                <span class="date">[${dataWpisu}]</span>
                Praca: ${wpis.praca || 0}h | Fakturowane: ${wpis.fakturowane || 0}h | Nadgodziny: ${wpis.nadgodziny || 0}h | Jazda: ${wpis.jazda || 0}h
                ${wpis.notatka ? `<br><small>Notatka: ${wpis.notatka}</small>` : ''}
            </div>`;
    });
    kalendarzDiv.innerHTML = kalendarzHtml || '<p>Brak powiązanych wpisów w kalendarzu.</p>';

    detailsZlecenieModal.style.display = 'block';
}

async function zapiszPrzypisanie(event) {
    event.preventDefault();
    const zlecenieId = assignForm['assign-zlecenie-id'].value;
    let klientId = assignForm['assign-klient-select'].value;
    let maszynaId = assignForm['assign-maszyna-select'].value;
    const nowyKlientNazwa = assignForm['assign-nowy-klient'].value.trim();
    const nowaMaszynaTyp = assignForm['assign-nowa-maszyna-typ'].value;
    const nowaMaszynaModel = assignForm['assign-nowa-maszyna-model'].value.trim();
    try {
        if (!klientId && nowyKlientNazwa) {
            const nowyKlientDoc = await addDoc(collection(db, "klienci"), { nazwa: nowyKlientNazwa, createdAt: new Date() });
            klientId = nowyKlientDoc.id;
        }
        if (!klientId) { alert("Musisz wybrać lub dodać klienta."); return; }
        if (!maszynaId && nowaMaszynaModel && nowaMaszynaTyp) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const klient = _wszystkieKlienciCache.find(k => k.id === klientId);
            if (!klient) { alert("Błąd: Nie znaleziono danych nowo dodanego klienta. Spróbuj ponownie."); return; }
            const nowaMaszynaDoc = await addDoc(collection(db, "maszyny"), {
                klientId: klientId, klientNazwa: klient.nazwa,
                typMaszyny: nowaMaszynaTyp, model: nowaMaszynaModel, createdAt: new Date()
            });
            maszynaId = nowaMaszynaDoc.id;
        }
        if (!maszynaId) { alert("Musisz wybrać lub dodać maszynę."); return; }

        await new Promise(resolve => setTimeout(resolve, 700));

        const maszyna = _wszystkieMaszynyCache.find(m => m.id === maszynaId);
        if (!maszyna) { alert("Błąd: Nie znaleziono danych wybranej/dodanej maszyny. Spróbuj ponownie."); return; }

        const zlecenieRef = doc(db, "zlecenia", zlecenieId);
        const zlecenieSnap = await getDoc(zlecenieRef);
        if (!zlecenieSnap.exists()) { alert("Błąd: Nie znaleziono zlecenia do przypisania."); return; }
        const zlecenieData = zlecenieSnap.data();
        const nowaHistoria = [...(zlecenieData.historia || []), {
            timestamp: new Date().toISOString(),
            akcja: `Przypisano do klienta: ${maszyna.klientNazwa} (Maszyna: ${maszyna.model})`
        }];

        const daneDoAktualizacji = {
            maszynaId: maszynaId, klientId: maszyna.klientId,
            klientNazwa: maszyna.klientNazwa, typMaszyny: maszyna.typMaszyny,
            model: maszyna.model, status: 'aktywne',
            historia: nowaHistoria
        };
        await updateDoc(zlecenieRef, daneDoAktualizacji);
        assignModal.style.display = 'none';
    } catch (error) {
        console.error("Błąd podczas przypisywania:", error);
        alert(`Wystąpił błąd: ${error.message}`);
    }
}

function renderMagazynWModalu() {
    modalMagazynLista.innerHTML = wszystkieProdukty
        .filter(p => p.ilosc > 0)
        .map(p => `<div class="modal-stock-item" data-id="${p.id}" data-name="${p.nazwa}" data-qty="${p.ilosc}" data-is-oil="${p.jestOlejem || false}">
            <span>${p.nazwa}</span><span class="item-qty">Na stanie: ${p.ilosc}</span></div>`).join('');
}

function dodajCzescDoZlecenia(event) {
    const itemDiv = event.target.closest('.modal-stock-item'); if (!itemDiv) return;
    const id = itemDiv.dataset.id, nazwa = itemDiv.dataset.name, iloscNaStanie = Number(itemDiv.dataset.qty), isOil = itemDiv.dataset.isOil === 'true';
    const iloscText = prompt(`Ile sztuk "${nazwa}" chcesz zdjąć ze stanu?`, "1");
    if (iloscText === null) return;
    const ilosc = Number(iloscText);
    if (isNaN(ilosc) || ilosc <= 0) { alert("Wpisz poprawną, dodatnią liczbę."); return; }
    if (!isOil && ilosc % 1 !== 0) { alert("Dla tego produktu można podawać tylko liczby całkowite."); return; }
    if (ilosc > iloscNaStanie) { alert(`Błąd: Na stanie jest tylko ${iloscNaStanie} szt.`); return; }
    if (czesciDoZlecenia.some(c => c.id === id)) { alert("Ta część jest już na liście do zdjęcia."); return; }
    czesciDoZlecenia.push({ id, nazwa, ilosc, isOil });
    renderCzesciDoZlecenia();
}

function renderCzesciDoZlecenia() {
    partsToRemoveList.innerHTML = czesciDoZlecenia.length > 0
        ? czesciDoZlecenia.map(c => `<li class="part-list-item" data-id="${c.id}">
            <span>${c.nazwa} - <strong>${c.ilosc} szt.</strong></span>
            <div class="actions"><button type="button" class="btn-edit edit-part-btn">Edytuj</button>
            <button type="button" class="btn-remove remove-part-btn">Usuń</button></div></li>`).join('')
        : '<li style="color: #888; border: none; justify-content: center;">Brak części do zdjęcia.</li>';
}

async function obslugaListyCzesci(event) {
    const li = event.target.closest('li'); if (!li) return;
    const id = li.dataset.id;
    if (event.target.classList.contains('remove-part-btn')) {
        czesciDoZlecenia = czesciDoZlecenia.filter(c => c.id !== id);
        renderCzesciDoZlecenia();
    }
    if (event.target.classList.contains('edit-part-btn')) {
        const czesc = czesciDoZlecenia.find(c => c.id === id);
        const produkt = wszystkieProdukty.find(p => p.id === id);
        const iloscText = prompt(`Edytuj ilość dla "${czesc.nazwa}":`, czesc.ilosc);
        if (iloscText === null) return;
        const nowaIlosc = Number(iloscText);
        if (isNaN(nowaIlosc) || nowaIlosc <= 0) { alert("Wpisz poprawną, dodatnią liczbę."); return; }
        if (!czesc.isOil && nowaIlosc % 1 !== 0) { alert("Dla tego produktu można podawać tylko liczby całkowite."); return; }
        if (!produkt) { alert("Błąd: Nie znaleziono produktu w magazynie."); return; }
        if (nowaIlosc > produkt.ilosc) { alert(`Błąd: Na stanie jest tylko ${produkt.ilosc} szt.`); return; }
        czesc.ilosc = nowaIlosc;
        renderCzesciDoZlecenia();
    }
}

async function obslugaZakonczeniaZlecenia(event) {
    event.preventDefault();
    const docId = document.getElementById('complete-zlecenie-id').value;
    const numerWz = (document.getElementById('zakonczenie-wz')?.value || '').trim();
    const notatka = (document.getElementById('zakonczenie-notatka')?.value || '').trim();
    const dane = {
        status: 'ukończone',
        wyfakturowaneGodziny: Number(document.getElementById('wyfakturowane-godziny').value),
        typZlecenia: document.getElementById('typ-zlecenia').value,
        dataUkonczenia: new Date().toISOString().split('T')[0],
        uzyteCzesci: czesciDoZlecenia,
        zakonczenieNotatka: notatka || null,
        zakonczenieNumerWZ: numerWz || null
    };
    try {
        await runTransaction(db, async (t) => {
            const zlecenieRef = doc(db, "zlecenia", docId);
            const zlecenieSnap = await t.get(zlecenieRef);
            if (!zlecenieSnap.exists()) throw "Zlecenie nie istnieje!";
            const zlecenieData = zlecenieSnap.data();
            let wpisHistorii = `Zakończono zlecenie. Godziny: ${dane.wyfakturowaneGodziny}h. Typ: ${dane.typZlecenia}.`;
            if (dane.zakonczenieNumerWZ) wpisHistorii += ` WZ: ${dane.zakonczenieNumerWZ}.`;
            if (notatka) wpisHistorii += ` Notatka: ${notatka}`;            
            const nowaHistoria = [...(zlecenieData.historia || []), {
                timestamp: new Date().toISOString(),
                akcja: wpisHistorii
            dane.historia = nowaHistoria;

            const partPromises = czesciDoZlecenia.map(czesc => t.get(doc(db, "magazyn", czesc.id)));
            const partDocs = await Promise.all(partPromises);
            t.update(zlecenieRef, dane);
            for (let i = 0; i < czesciDoZlecenia.length; i++) {
                const czesc = czesciDoZlecenia[i];
                const produktDoc = partDocs[i];
                if (!produktDoc.exists()) throw `Produkt ${czesc.nazwa} nie istnieje!`;
                const nowaIlosc = produktDoc.data().ilosc - czesc.ilosc;
                if (nowaIlosc < 0) throw `Za mało produktu ${czesc.nazwa} na stanie!`;
                t.update(doc(db, "magazyn", czesc.id), { ilosc: nowaIlosc });
            }
        });
        alert("Zlecenie zakończone, stan magazynowy zaktualizowany!");
        completeModal.style.display = 'none';
        completeModalForm.reset();
    } catch (error) {
        console.error("BŁĄD TRANSAKCJI: ", error);
        alert(`Wystąpił błąd: ${error.message || error}`);
    }
}

/* ... (Część 3/3 – funkcje magazynu + eventy i inicjalizacja) ... */
    // --- POMOCNICZE: pola dodatkowe w modalu zakończenia ---
    function ensureZakonczenieNotatkaField() {
        if (!completeModalForm) return;
        let anchorRow = completeModalForm.querySelector('#typ-zlecenia')?.closest('.form-group');

        const insertAfter = (element) => {
            if (anchorRow && anchorRow.parentNode) {
                anchorRow.parentNode.insertBefore(element, anchorRow.nextSibling);
            } else {
                completeModalForm.appendChild(element);
            }
            anchorRow = element;
        };

        if (!document.getElementById('zakonczenie-wz')) {
            const blockWz = document.createElement('div');
            blockWz.className = 'form-group';
            blockWz.innerHTML = `
                <label for="zakonczenie-wz">Numer WZ (opcjonalnie):</label>
                <input type="text" id="zakonczenie-wz" placeholder="Np. WZ/05/2024">
            `;
            insertAfter(blockWz);
        }

        if (!document.getElementById('zakonczenie-notatka')) {
            const block = document.createElement('div');
            block.className = 'form-group';
            block.innerHTML = `
                <label for="zakonczenie-notatka">Notatka (opcjonalnie):</label>
                <textarea id="zakonczenie-notatka" rows="3" placeholder="Krótki opis wykonanych prac, czynności, uwagi..."></textarea>
            `;
            insertAfter(block);
        }
    }

    // --- MAGAZYN: dodawanie / masowe / oleje / konwerter / tabela / zmiana stanu / nasłuchiwanie ---
    async function dodajProduktDoMagazynu(event) {
        event.preventDefault();
        const dane = {
            index: magazynForm['item-index'].value,
            nazwa: magazynForm['item-name'].value,
            ilosc: Number(magazynForm['item-ilosc'].value),
            klient: magazynForm['item-klient'].value || '---',
            createdAt: new Date()
        };
        try {
            await addDoc(collection(db, "magazyn"), dane);
            magazynForm.reset();
        } catch (e) {
            console.error("Błąd dodawania do magazynu: ", e);
        }
    }

    async function dodajMasowo(event) {
        event.preventDefault();
        const klient = bulkAddForm['bulk-klient'].value;
        const itemsText = bulkAddForm['bulk-items'].value.trim();
        if (!itemsText) return;
        const lines = itemsText.split('\n');
        let dodaneCount = 0;
        try {
            for (const line of lines) {
                const parts = line.split(';');
                if (parts.length === 3) {
                    const [index, nazwa, ilosc] = parts;
                    await addDoc(collection(db, "magazyn"), {
                        index: index.trim(),
                        nazwa: nazwa.trim(),
                        ilosc: Number(ilosc.trim()),
                        klient,
                        createdAt: new Date()
                    });
                    dodaneCount++;
                } else {
                    console.warn("Pominięto linię (nieprawidłowy format):", line);
                }
            }
            alert(`Pomyślnie dodano ${dodaneCount} produktów.`);
            bulkAddForm.reset();
        } catch (error) {
            console.error("Błąd masowego dodawania:", error);
            alert("Wystąpił błąd.");
        }
    }

    async function dodajOlej() {
        const typ = oilTypeSelect.value;
        const pojemnosc = Number(oilContainerSizeSelect.value);
        const dane = {
            index: `OLEJ-${typ}-${pojemnosc}L`,
            nazwa: `Olej ${typ} ${pojemnosc}L`,
            ilosc: 1,
            klient: '---',
            jestOlejem: true,
            pojemnosc,
            createdAt: new Date()
        };
        try {
            await addDoc(collection(db, "magazyn"), dane);
        } catch (e) {
            console.error("Błąd dodawania oleju: ", e);
        }
    }

    function przeliczOlej(event) {
        const pojemnosc = Number(oilContainerSizeSelect.value);
        if (isNaN(pojemnosc) || pojemnosc <= 0) return;
        const source = event.target;
        if (source.id === 'converter-litry') {
            converterSztukiInput.value = '';
            const litry = Number(source.value);
            resultSztuki.textContent = litry > 0 ? `${(litry / pojemnosc).toFixed(3)} szt.` : '0.00 szt.';
            resultLitry.textContent = litry > 0 ? source.value + ' L' : '0.00 L';
        } else if (source.id === 'converter-sztuki') {
            converterLitryInput.value = '';
            const sztuki = Number(source.value);
            resultLitry.textContent = sztuki > 0 ? `${(sztuki * pojemnosc).toFixed(2)} L` : '0.00 L';
            resultSztuki.textContent = sztuki > 0 ? source.value + ' szt.' : '0.00 szt.';
        } else {
            converterLitryInput.value = '';
            converterSztukiInput.value = '';
            resultLitry.textContent = '0.00 L';
            resultSztuki.textContent = '0.00 szt.';
        }
    }

    async function obslugaTabeliMagazynu(event) {
        const tr = event.target.closest('tr'); if (!tr) return;
        const docId = tr.dataset.id;
        if (event.target.classList.contains('delete-btn')) {
            if (confirm("Na pewno usunąć?")) { await deleteDoc(doc(db, "magazyn", docId)); }
        } else if (event.target.classList.contains('add-stock-btn') || event.target.classList.contains('remove-stock-btn')) {
            stockChangeOperation = event.target.classList.contains('add-stock-btn') ? 'add' : 'remove';
            document.getElementById('stock-modal-title').textContent = stockChangeOperation === 'add' ? 'Dodaj do stanu' : 'Zdejmij ze stanu';
            document.getElementById('stock-modal-name').textContent = tr.dataset.name;
            document.getElementById('stock-modal-current-qty').textContent = Number(tr.dataset.qty).toFixed(2) + ' szt.';
            document.getElementById('stock-change-id').value = docId;
            const qtyInput = document.getElementById('stock-change-qty');
            qtyInput.step = tr.dataset.isOil === 'true' ? "0.01" : "1";
            qtyInput.placeholder = tr.dataset.isOil === 'true' ? "np. 0.5" : "Tylko liczby całkowite";
            qtyInput.value = '';
            stockModal.style.display = 'block';
        }
    }

    async function obslugaZmianyStanu(event) {
        event.preventDefault();
        const docId = document.getElementById('stock-change-id').value;
        const changeQty = Number(document.getElementById('stock-change-qty').value);
        if (changeQty <= 0) { alert("Ilość musi być dodatnia."); return; }
        const docRef = doc(db, "magazyn", docId);
        try {
            await runTransaction(db, async (t) => {
                const sfDoc = await t.get(docRef);
                if (!sfDoc.exists()) { throw "Dokument nie istnieje!"; }
                const produktData = sfDoc.data();
                const currentQty = produktData.ilosc;
                if (!produktData.jestOlejem && changeQty % 1 !== 0) {
                    throw "Dla tego produktu można podawać tylko liczby całkowite.";
                }
                let newQty = stockChangeOperation === 'add' ? currentQty + changeQty : currentQty - changeQty;
                if (newQty < 0) { throw "Nie można zdjąć więcej niż jest na stanie!"; }
                t.update(docRef, { ilosc: newQty });
            });
            stockModal.style.display = 'none';
            stockModalForm.reset();
        } catch (e) {
            console.error("Błąd transakcji: ", e);
            alert(`Wystąpił błąd: ${e.message || e}`);
        }
    }

    function wyswietlMagazyn() {
        onSnapshot(query(collection(db, "magazyn"), orderBy("createdAt", "desc")), (snapshot) => {
            let html = '';
            wszystkieProdukty = [];
            if (snapshot.empty) { magazynLista.innerHTML = '<tr><td colspan="6">Magazyn pusty.</td></tr>'; return; }
            snapshot.forEach((docSnap) => {
                const produkt = docSnap.data();
                produkt.id = docSnap.id;
                wszystkieProdukty.push(produkt);
                const iloscWLitrach = produkt.jestOlejem ? (produkt.ilosc * produkt.pojemnosc).toFixed(2) + ' L' : '---';
                const iloscFormatowana = produkt.ilosc.toFixed(2);
                html += `<tr data-id="${produkt.id}" data-name="${produkt.nazwa}" data-qty="${produkt.ilosc}" data-is-oil="${produkt.jestOlejem || false}">
                    <td>${produkt.index}</td>
                    <td>${produkt.nazwa}</td>
                    <td>${iloscFormatowana} szt.</td>
                    <td>${iloscWLitrach}</td>
                    <td>${produkt.klient}</td>
                    <td>
                        <button class="add-stock-btn">Dodaj</button>
                        <button class="remove-stock-btn">Zdejmij</button>
                        <button class="delete-btn">Usuń</button>
                    </td>
                </tr>`;
            });
            magazynLista.innerHTML = html;
        });
    }

   // --- PODPIĘCIE EVENTÓW ---
klientForm.addEventListener('submit', dodajKlienta);
listaKlientowDiv.addEventListener('click', obslugaListyKlientow);

maszynaForm.addEventListener('submit', dodajMaszyne);
listaMaszynDiv.addEventListener('click', obslugaListyMaszyn);

// ZLECENIA
zlecenieForm.addEventListener('submit', dodajZlecenie);
zlecenieKlientSelect.addEventListener('change', aktualizujMaszynyDlaZlecenia);
zlecenieKlientSelect.addEventListener('change', aktualizujMaszynyDlaZlecenia);
aktywneZleceniaLista.addEventListener('click', obslugaListyZlecen);
ukonczoneZleceniaLista.addEventListener('click', obslugaListyZlecen);

zlecenieKlientSelect.dispatchEvent(new Event('change'));

completeModalForm.addEventListener('submit', obslugaZakonczeniaZlecenia);
closeModalButton.onclick = () => { completeModal.style.display = "none"; };

miesiacSummaryInput.addEventListener('change', obliczIPokazPodsumowanieFinansowe);
document.getElementById('export-zlecenia-btn').addEventListener('click', () => {
  const miesiac = miesiacSummaryInput.value;
  const dane = _wszystkieZleceniaCache
    .filter(z => z.status === 'ukończone' && z.dataUkonczenia && z.dataUkonczenia.startsWith(miesiac))
    .map(({ id, createdAt, status, uzyteCzesci, historia, ...rest }) => ({
      ...rest,
      uzyte_czesci: uzyteCzesci ? uzyteCzesci.map(c => c.nazwa).join(', ') : ''
    }));
  eksportujDoCSV(dane, `zlecenia_${miesiac}.csv`);
});

// MAGAZYN
magazynForm.addEventListener('submit', dodajProduktDoMagazynu);
bulkAddForm.addEventListener('submit', dodajMasowo);
magazynLista.addEventListener('click', obslugaTabeliMagazynu);

stockModalForm.addEventListener('submit', obslugaZmianyStanu);
stockModalCloseButton.onclick = () => { stockModal.style.display = "none"; };

addOilBtn.addEventListener('click', dodajOlej);
converterLitryInput.addEventListener('input', przeliczOlej);
converterSztukiInput.addEventListener('input', przeliczOlej);
oilContainerSizeSelect.addEventListener('change', () => { przeliczOlej({ target: { id: '' } }); });

// KALENDARZ (modal + klik w kalendarzu)
kalendarzForm.addEventListener('submit', obslugaZapisuGodzin);
kalendarzContainer.addEventListener('click', obslugaKalendarza);
kalendarzModal.querySelector('.close-button').onclick = () => { kalendarzModal.style.display = 'none'; };

// WYSZUKIWANIA
klientSearchInput.addEventListener('input', wyswietlKlientow);
maszynaSearchInput.addEventListener('input', wyswietlMaszyny);
zlecenieSearchInput.addEventListener('input', wyswietlZlecenia);

// EDYCJE (modale)
editKlientForm.addEventListener('submit', zapiszEdycjeKlienta);
editMaszynaForm.addEventListener('submit', zapiszEdycjeMaszyny);
editZlecenieForm.addEventListener('submit', zapiszEdycjeZlecenia);

editKlientModal.querySelector('.close-button').onclick = () => { editKlientModal.style.display = 'none'; };
editMaszynaModal.querySelector('.close-button').onclick = () => { editMaszynaModal.style.display = 'none'; };
detailsZlecenieModal.querySelector('.close-button').onclick = () => { detailsZlecenieModal.style.display = 'none'; };
editZlecenieModal.querySelector('.close-button').onclick = () => { editZlecenieModal.style.display = 'none'; };
machineHistoryModal.querySelector('.close-button').onclick = () => { machineHistoryModal.style.display = 'none'; };

// Klik poza modal zamyka go
window.onclick = (event) => {
  if (
    event.target == completeModal ||
    event.target == stockModal ||
    event.target == kalendarzModal ||
    event.target == assignModal ||
    event.target == editKlientModal ||
    event.target == editMaszynaModal ||
    event.target == detailsZlecenieModal ||
    event.target == editZlecenieModal ||
    event.target == machineHistoryModal
  ) {
    event.target.style.display = "none";
  }
};

// --- INICJALIZACJA (MUSI BYĆ WEWNĄTRZ initializeApp) ---
inicjalizujKalendarz();
nasluchujNaKlientow();
nasluchujNaMaszyny();
nasluchujNaZlecenia();
wyswietlPrzejazdy(); // puste – OK
wyswietlMagazyn();

} // koniec initializeApp()