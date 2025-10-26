import { db } from './firebase-config.js';
import { collection, query, orderBy, onSnapshot, doc, deleteDoc, updateDoc, getDoc, runTransaction, addDoc, setDoc, where, getDocs } from "firebase/firestore";
import Papa from 'papaparse';

initializeApp();

function initializeApp() {
    // --- STAŁE I ZMIENNE GLOBALNE ---
    const STAWKI = { S: { nazwa: "Wyjazdowe", stawka: 45 }, W: { nazwa: "Warsztat", stawka: 35 }, G: { nazwa: "Gwarancja", stawka: 35 }, Z: { nazwa: "Zbrojenie", stawka: 30 }, P: { nazwa: "Poprawka", stawka: 0 } };
    let wszystkieZlecenia = [], wszystkieProdukty = [], wszystkiePrzejazdy = [], czesciDoZlecenia = [], wszystkieMaszyny = [], wszystkieKlienci = [], wszystkieWpisyKalendarza = [];
    let _wszystkieKlienciCache = [], _wszystkieMaszynyCache = [], _wszystkieZleceniaCache = []; // Cache dla danych z Firebase
    const NISKI_STAN_MAGAZYNOWY = 5;
    let calendar;
    let edytowanyPrzejazdId = null;
    let stockChangeOperation = null;

    // --- SELEKTORY ---
    const miesiacSummaryInput = document.getElementById('miesiac-summary');
    const miesiacPrzejazdyInput = document.getElementById('miesiac-przejazdy');
    const zlecenieKlientSelect = document.getElementById('zlecenie-klient-select');
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
    const przejazdForm = document.getElementById('przejazd-form');
    const listaPrzejazdowDiv = document.getElementById('lista-przejazdow');
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
    
    // --- INICJALIZACJA ---
    window.openTab = (evt, tabName) => { document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none'); document.querySelectorAll('.tab-button').forEach(button => button.classList.remove('active')); document.getElementById(tabName).style.display = 'block'; evt.currentTarget.classList.add('active'); };
    const now = new Date();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    const currentMonth = `${year}-${month}`;
    if(miesiacSummaryInput) miesiacSummaryInput.value = currentMonth;
    if(miesiacPrzejazdyInput) miesiacPrzejazdyInput.value = currentMonth;
    document.querySelector('.tab-button').click();
    inicjujCiemnyMotyw();
    inicjujZwijanie();

    // --- KALENDARZ ---
    function inicjalizujKalendarz() {
        if (!kalendarzContainer) return;
        calendar = new FullCalendar.Calendar(kalendarzContainer, {
            initialView: 'dayGridMonth', locale: 'pl',
            headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth' },
            eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
            displayEventEnd: true,
            eventContent: (arg) => {
                let eventEl = document.createElement('div');
                eventEl.innerHTML = `<div>${arg.event.title}</div>`; 

                if (arg.event.extendedProps.type === 'godziny_pracy') {
                    if (arg.event.extendedProps.notatka) { eventEl.innerHTML += ` <small title="${arg.event.extendedProps.notatka}">📝</small>`; }
                    let actionsEl = document.createElement('div');
                    actionsEl.classList.add('event-actions');
                    actionsEl.innerHTML = `<button type="button" class="btn-edit event-edit-btn" data-date="${arg.event.startStr}">E</button><button type="button" class="btn-remove event-delete-btn" data-date="${arg.event.startStr}">X</button>`;
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
                const nazwa = z.klientNazwa ? `${z.klientNazwa} (${z.model || z.nrZlecenia})` : z.nrZlecenia;
                const option = document.createElement('option');
                option.value = z.id;
                option.textContent = nazwa;
                option.dataset.klientNazwa = z.klientNazwa || nazwa;
                zlecenieSelect.appendChild(option);
            });

        const docSnap = await getDoc(doc(db, "godziny_pracy", data));
        if (docSnap.exists()) {
            const dane = docSnap.data();
            kalendarzForm['godziny-pracy'].value = dane.praca || 0;
            kalendarzForm['godziny-fakturowane'].value = dane.fakturowane || 0;
            kalendarzForm['nadgodziny'].value = dane.nadgodziny || 0;
            kalendarzForm['czas-jazdy'].value = dane.jazda || 0;
            kalendarzForm['kalendarz-notatka'].value = dane.notatka || '';
            kalendarzForm['kalendarz-zlecenie-select'].value = dane.zlecenieId || '';
        }
        kalendarzModal.style.display = 'block';
    }

    async function obslugaZapisuGodzin(event) {
        event.preventDefault();
        const data = kalendarzForm['kalendarz-data'].value;
        const zlecenieSelect = kalendarzForm['kalendarz-zlecenie-select'];
        const zlecenieId = zlecenieSelect.value;
        const klientNazwa = zlecenieId ? zlecenieSelect.options[zlecenieSelect.selectedIndex].dataset.klientNazwa : null;

        const dane = {
            praca: Number(kalendarzForm['godziny-pracy'].value) || 0,
            fakturowane: Number(kalendarzForm['godziny-fakturowane'].value) || 0,
            nadgodziny: Number(kalendarzForm['nadgodziny'].value) || 0,
            jazda: Number(kalendarzForm['czas-jazdy'].value) || 0,
            notatka: kalendarzForm['kalendarz-notatka'].value || '',
            zlecenieId: zlecenieId || null,
            klientNazwa: klientNazwa
        };
        try { await setDoc(doc(db, "godziny_pracy", data), dane); kalendarzModal.style.display = 'none'; } catch (e) { console.error("Błąd zapisu godzin: ", e); }
    }

    function wyswietlWpisyKalendarza() {
        if (_wszystkieZleceniaCache.length === 0 && _wszystkieKlienciCache.length > 0 && _wszystkieMaszynyCache.length > 0) {
            console.log("Czekam na załadowanie danych zleceń dla kalendarza...");
            if(calendar) {
                 calendar.removeAllEvents();
            }
            return;
        }

        onSnapshot(collection(db, "godziny_pracy"), (snapshotGodziny) => {
            wszystkieWpisyKalendarza = [];
            const events = [];

            snapshotGodziny.forEach(doc => {
                const dane = doc.data(); const id = doc.id;
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

            // Dodaj zlecenia do listy wydarzeń
            _wszystkieZleceniaCache.forEach(zlecenie => {
                const dataStart = zlecenie.dataRozpoczecia;
                const dataKoniec = zlecenie.dataZakonczenia;
                if (dataStart) {
                    const eventData = {
                        id: `zlecenie_${zlecenie.id}`,
                        title: `Zlecenie: ${zlecenie.klientNazwa || zlecenie.nrZlecenia}`,
                        start: dataStart,
                        allDay: true,
                        classNames: ['fc-event-zlecenie'],
                        extendedProps: { type: 'zlecenie' }
                    };

                    if (dataKoniec && dataKoniec >= dataStart) {
                        const endDate = new Date(dataKoniec);
                        endDate.setDate(endDate.getDate() + 1);
                        eventData.end = endDate.toISOString().split('T')[0];
                    }

                    events.push(eventData);
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
        const wpisyZMiesiaca = wszystkieWpisyKalendarza.filter(wpis => { const dataWpisu = new Date(wpis.id); return dataWpisu >= start && dataWpisu < end; });
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
            if (confirm(`Czy na pewno chcesz usunąć wpis z dnia ${data}?`)) { await deleteDoc(doc(db, "godziny_pracy", data)); }
        }
    }

    // --- FUNKCJE OGÓLNE ---
    function obliczPodsumowanieFinansowe(wybranyMiesiac, zlecenia) { /* ... (bez zmian) ... */ }
    function eksportujDoCSV(dane, nazwaPliku) { /* ... (bez zmian) ... */ }
    function inicjujCiemnyMotyw() { /* ... (bez zmian) ... */ }
    function applyTheme(theme) { /* ... (bez zmian) ... */ }
    function inicjujZwijanie() {
        zakonczoneZleceniaHeader.classList.add('collapsed');
        zakonczoneZleceniaContent.classList.add('collapsed');
        zakonczoneZleceniaHeader.addEventListener('click', () => {
            zakonczoneZleceniaHeader.classList.toggle('collapsed');
            zakonczoneZleceniaContent.classList.toggle('collapsed');
        });
        listaKlientowHeader.classList.add('collapsed');
        listaKlientowContent.classList.add('collapsed');
        listaKlientowHeader.addEventListener('click', () => {
            listaKlientowHeader.classList.toggle('collapsed');
            listaKlientowContent.classList.toggle('collapsed');
        });
        listaMaszynHeader.classList.add('collapsed');
        listaMaszynContent.classList.add('collapsed');
        listaMaszynHeader.addEventListener('click', () => {
            listaMaszynHeader.classList.toggle('collapsed');
            listaMaszynContent.classList.toggle('collapsed');
        });
    }
    // --- KLIENCI ---
    async function dodajKlienta(event) {
         event.preventDefault();
         const dane = { nazwa: klientForm['klient-nazwa'].value, nip: klientForm['klient-nip'].value || '---', adres: klientForm['klient-adres'].value || '---', telefon: klientForm['klient-telefon'].value || '---', createdAt: new Date() };
         try { await addDoc(collection(db, "klienci"), dane); klientForm.reset(); } catch (e) { console.error("Błąd dodawania klienta: ", e); }
     }

    function wyswietlKlientow() {
        if (_wszystkieMaszynyCache.length === 0 && _wszystkieKlienciCache.length > 0) {
             console.log("Czekam na maszyny przed renderowaniem klientów...");
             listaKlientowDiv.innerHTML = "<p>Ładowanie danych maszyn...</p>";
             return;
        }

        const frazaWyszukiwania = klientSearchInput.value.toLowerCase();
        wszystkieKlienci = [];
        let klienciHtml = '', selectHtml = '<option value="">-- Wybierz klienta --</option>', selectZleceniaHtml = '<option value="">-- Wybierz klienta --</option><option value="szybkie-zlecenie">-- SZYBKIE ZLECENIE (bez klienta) --</option>';

        const przefiltrowaniKlienci = _wszystkieKlienciCache.filter(klient => {
             if (!frazaWyszukiwania) return true;
             const tekstDoWyszukania = `${klient.nazwa} ${klient.nip} ${klient.adres} ${klient.telefon}`.toLowerCase();
             return tekstDoWyszukania.includes(frazaWyszukiwania);
        });

        przefiltrowaniKlienci.forEach(klient => {
            wszystkieKlienci.push(klient);
            const maszynyKlienta = _wszystkieMaszynyCache.filter(m => m.klientId === klient.id);
            const maszynyListaId = `client-${klient.id}-machines`;
            const maszynyKontenerHtml = maszynyKlienta.length > 0
                ? `<div id="${maszynyListaId}" class="client-machine-list-container collapsed"> <ul class="client-machine-list">
                    ${maszynyKlienta.map(m => `<li>${m.typMaszyny} ${m.model} (S/N: ${m.nrSeryjny}) <a href="#" class="machine-history-link" data-maszyna-id="${m.id}" data-maszyna-nazwa="${m.typMaszyny} ${m.model}">Pokaż historię</a></li>`).join('')}
                    </ul>
                   </div>` // Domyślnie zwinięte
                : `<div id="${maszynyListaId}" class="client-machine-list-container collapsed"> <p style="font-size: 0.8rem; margin-left: 0; padding: 5px 0; color: var(--text-color-light);">Brak maszyn</p>
                   </div>`;

            const strzalkaHtml = `<span class="toggle-machines-arrow collapsed" data-target="${maszynyListaId}">▼</span>`; // Zawsze pokazuj strzałkę, domyślnie zwiniętą

            klienciHtml += `
                <div class="client-group" data-id="${klient.id}">
                    <div class="client-header-item">
                        <span><strong>${klient.nazwa}</strong> (NIP: ${klient.nip})<br><small>${klient.adres} | ${klient.telefon}</small> ${strzalkaHtml}</span> <div><button class="btn-edit edit-klient-btn">Edytuj</button><button class="delete-btn">Usuń</button></div>
                    </div>
                    ${maszynyKontenerHtml} </div>`;
            selectHtml += `<option value="${klient.id}">${klient.nazwa}</option>`;
            selectZleceniaHtml += `<option value="${klient.id}">${klient.nazwa}</option>`;
        });

        listaKlientowDiv.innerHTML = klienciHtml || "<p>Brak klientów w bazie lub pasujących do wyszukiwania.</p>";
        maszynaKlientSelect.innerHTML = selectHtml;
        zlecenieKlientSelect.innerHTML = selectZleceniaHtml;
        document.getElementById('assign-klient-select').innerHTML = selectHtml;
    }

    function nasluchujNaKlientow() {
        onSnapshot(query(collection(db, "klienci"), orderBy("nazwa")), (snapshot) => {
             _wszystkieKlienciCache = [];
             snapshot.forEach(doc => { _wszystkieKlienciCache.push({ id: doc.id, ...doc.data() }); });
             wyswietlKlientow();
        });
    }

    async function obslugaListyKlientow(event) {
        if (event.target.classList.contains('toggle-machines-arrow')) {
            const strzalka = event.target;
            const targetId = strzalka.dataset.target;
            const kontenerMaszyn = document.getElementById(targetId);
            if (kontenerMaszyn) {
                strzalka.classList.toggle('collapsed');
                kontenerMaszyn.classList.toggle('collapsed');
            }
            return;
        }
        const clientGroup = event.target.closest('.client-group'); if (!clientGroup) return;
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
                // TODO: Dodać transakcję usuwającą maszyny i zlecenia powiązane z klientem
                await deleteDoc(doc(db, "klienci", klientId));
                 wyswietlMaszyny(); // Odśwież widok maszyn
            }
        }
        if (event.target.classList.contains('edit-klient-btn')) {
             otworzModalEdycjiKlienta(klientId);
        }
    }

    async function pokazHistorieSerwisowaMaszyny(maszynaId, maszynaNazwa) {
        document.getElementById('machine-history-title').textContent = `Historia Serwisowa: ${maszynaNazwa}`;
        machineHistoryList.innerHTML = '<p>Ładowanie historii...</p>';
        machineHistoryModal.style.display = 'block';

        try {
            const q = query(
                collection(db, "zlecenia"),
                where("maszynaId", "==", maszynaId),
                where("status", "==", "ukończone"),
                orderBy("dataUkonczenia", "desc")
            );
            const querySnapshot = await getDocs(q);

            let historiaHtml = '';
            if (querySnapshot.empty) {
                historiaHtml = '<p>Brak historii serwisowej (zakończonych zleceń) dla tej maszyny.</p>';
            } else {
                querySnapshot.forEach((doc) => {
                    const zlecenie = doc.data();
                    const uzyteCzesciHtml = zlecenie.uzyteCzesci?.length > 0
                        ? `<br><small>Użyto: ${zlecenie.uzyteCzesci.map(c => `${c.nazwa} (x${c.ilosc})`).join(', ')}</small>`
                        : '';
                    historiaHtml += `
                        <li data-id="${doc.id}">
                            <span>
                                <strong>Nr: ${zlecenie.nrZlecenia}</strong> (Ukończono: ${zlecenie.dataUkonczenia || 'b.d.'})<br>
                                <em>Opis: ${zlecenie.opis || 'Brak'}</em><br>
                                Fakturowano: <strong>${zlecenie.wyfakturowaneGodziny || 0}h</strong> | Typ: <strong>${zlecenie.typZlecenia || '?'}</strong>
                                ${uzyteCzesciHtml}
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
        editKlientForm['edit-klient-nip'].value = klient.nip === '---' ? '' : klient.nip; // Usuń placeholder
        editKlientForm['edit-klient-adres'].value = klient.adres === '---' ? '' : klient.adres;
        editKlientForm['edit-klient-telefon'].value = klient.telefon === '---' ? '' : klient.telefon;
        editKlientModal.style.display = 'block';
    }
    async function zapiszEdycjeKlienta(event) {
        event.preventDefault();
        const klientId = editKlientForm['edit-klient-id'].value;
        const stareDane = _wszystkieKlienciCache.find(k => k.id === klientId); // Pobierz stare dane z cache
        if (!stareDane) {
             console.error("Nie znaleziono starych danych klienta w cache!");
             alert("Wystąpił błąd podczas zapisu - nie znaleziono danych klienta.");
             return;
        }
        const nowaNazwa = editKlientForm['edit-klient-nazwa'].value;

        const dane = {
            nazwa: nowaNazwa,
            nip: editKlientForm['edit-klient-nip'].value || '---', // Dodaj placeholder z powrotem, jeśli puste
            adres: editKlientForm['edit-klient-adres'].value || '---',
            telefon: editKlientForm['edit-klient-telefon'].value || '---',
        };
        try {
            await updateDoc(doc(db, "klienci", klientId), dane);

            // Jeśli nazwa klienta się zmieniła, zaktualizuj ją w maszynach i zleceniach (transakcje)
            if (stareDane.nazwa !== nowaNazwa) {
                console.log(`Zmieniono nazwę klienta z "${stareDane.nazwa}" na "${nowaNazwa}". Rozpoczynam aktualizację powiązanych dokumentów...`);

                // Aktualizacja maszyn (użyj transakcji, aby zapewnić spójność)
                const qMaszyny = query(collection(db, "maszyny"), where("klientId", "==", klientId));
                await runTransaction(db, async (transaction) => {
                    const maszynySnap = await getDocs(qMaszyny); // Pobierz wewnątrz transakcji
                    maszynySnap.forEach(maszynaDoc => {
                        transaction.update(maszynaDoc.ref, { klientNazwa: nowaNazwa });
                    });
                     console.log(`Przygotowano aktualizację dla ${maszynySnap.size} maszyn.`);
                });


                // Aktualizacja zleceń
                const qZlecenia = query(collection(db, "zlecenia"), where("klientId", "==", klientId));
                 await runTransaction(db, async (transaction) => {
                     const zleceniaSnap = await getDocs(qZlecenia); // Pobierz wewnątrz transakcji
                    zleceniaSnap.forEach(zlecenieDoc => {
                        transaction.update(zlecenieDoc.ref, { klientNazwa: nowaNazwa });
                    });
                     console.log(`Przygotowano aktualizację dla ${zleceniaSnap.size} zleceń.`);
                });

                // Aktualizacja wpisów w kalendarzu (godziny_pracy)
                // Znajdź najpierw ID zleceń powiązanych z klientem
                const powiazaneZleceniaIds = _wszystkieZleceniaCache
                    .filter(z => z.klientId === klientId)
                    .map(z => z.id);

                if (powiazaneZleceniaIds.length > 0) {
                     // Zapytanie o wpisy godzinowe powiązane z tymi zleceniami
                     const qGodziny = query(collection(db, "godziny_pracy"), where("zlecenieId", "in", powiazaneZleceniaIds));
                     await runTransaction(db, async (transaction) => {
                         const godzinySnap = await getDocs(qGodziny); // Pobierz wewnątrz transakcji
                         godzinySnap.forEach(godzinaDoc => {
                             transaction.update(godzinaDoc.ref, { klientNazwa: nowaNazwa });
                         });
                         console.log(`Przygotowano aktualizację dla ${godzinySnap.size} wpisów kalendarza.`);
                     });
                } else {
                     console.log("Brak zleceń powiązanych z tym klientem, pomijam aktualizację kalendarza.");
                }

                console.log("Aktualizacja nazw zakończona.");
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
         // Użyj cache
         const klient = _wszystkieKlienciCache.find(k => k.id === wybranyKlientId);
         if (!klient) { alert("Błąd: Nie znaleziono danych wybranego klienta."); return;}

         const dane = {
             klientId: wybranyKlientId, klientNazwa: klient.nazwa, typMaszyny: maszynaForm['maszyna-typ'].value,
             model: maszynaForm['maszyna-model'].value, nrSeryjny: maszynaForm['maszyna-serial'].value || '---',
             rokProdukcji: Number(maszynaForm['maszyna-rok'].value) || null, motogodziny: Number(maszynaForm['maszyna-mth'].value) || 0, createdAt: new Date()
         };
         try { await addDoc(collection(db, "maszyny"), dane); maszynaForm.reset(); } catch (e) { console.error("Błąd dodawania maszyny: ", e); }
     }

    function wyswietlMaszyny() {
        if (_wszystkieKlienciCache.length === 0 && _wszystkieMaszynyCache.length > 0) {
            console.log("Czekam na klientów przed renderowaniem maszyn...");
            listaMaszynDiv.innerHTML = "<p>Ładowanie danych klientów...</p>";
            return;
        }

        const frazaWyszukiwania = maszynaSearchInput.value.toLowerCase();
        wszystkieMaszyny = []; // Resetuj globalną tablicę (używamy cache do renderowania)

        const przefiltrowaneMaszyny = _wszystkieMaszynyCache.filter(maszyna => {
                if (!frazaWyszukiwania) return true;
                const tekstDoWyszukania = `${maszyna.klientNazwa} ${maszyna.typMaszyny} ${maszyna.model} ${maszyna.nrSeryjny}`.toLowerCase();
                return tekstDoWyszukania.includes(frazaWyszukiwania);
        });

        const pogrupowaneMaszyny = przefiltrowaneMaszyny.reduce((acc, maszyna) => { (acc[maszyna.klientNazwa] = acc[maszyna.klientNazwa] || []).push(maszyna); return acc; }, {});
        let maszynyHtml = '';
        for (const klientNazwa in pogrupowaneMaszyny) {
            // Dodano klasę 'open', aby nowe grupy były domyślnie rozwinięte
            maszynyHtml += `<div class="client-group"><div class="client-header open"><h4>${klientNazwa}</h4><span class="arrow">▶</span></div><ul class="machine-list open">${pogrupowaneMaszyny[klientNazwa].map(maszyna =>
                    `<li data-id="${maszyna.id}">
                        <span>${maszyna.typMaszyny} ${maszyna.model} (S/N: ${maszyna.nrSeryjny})</span>
                        <div>
                            <a href="#" class="machine-history-link" data-maszyna-id="${maszyna.id}" data-maszyna-nazwa="${maszyna.typMaszyny} ${maszyna.model}">Historia</a>
                            <button class="btn-edit edit-maszyna-btn">Edytuj</button>
                            <button class="delete-btn">Usuń</button>
                        </div>
                    </li>`).join('')}</ul></div>`;
        }
        listaMaszynDiv.innerHTML = maszynyHtml || "<p>Brak maszyn w bazie lub pasujących do wyszukiwania.</p>";
        // Aktualizuj select w formularzu zleceń (nie trzeba już aktualizować klientów stąd)
        zlecenieKlientSelect.dispatchEvent(new Event('change'));
    }

    function nasluchujNaMaszyny() {
        onSnapshot(query(collection(db, "maszyny"), orderBy("klientNazwa")), (snapshot) => {
            _wszystkieMaszynyCache = [];
            wszystkieMaszyny = [];
            snapshot.forEach(doc => {
                 const maszyna = { id: doc.id, ...doc.data() };
                 _wszystkieMaszynyCache.push(maszyna);
                 wszystkieMaszyny.push(maszyna);
            });
            // Po załadowaniu/aktualizacji maszyn, przerysuj listę maszyn ORAZ listę klientów
            wyswietlMaszyny();
            wyswietlKlientow(); // Ważne, aby zaktualizować listę klientów z poprawnymi maszynami
        });
    }

    async function obslugaListyMaszyn(event) {
        const element = event.target;

        if (element.closest('.client-header')) {
            const header = element.closest('.client-header');
            header.classList.toggle('open');
            header.nextElementSibling.classList.toggle('open'); // Toggle dla ul.machine-list
            return;
        }
        if (element.classList.contains('machine-history-link')) {
            event.preventDefault();
            const maszynaId = element.dataset.maszynaId;
            const maszynaNazwa = element.dataset.maszynaNazwa;
            pokazHistorieSerwisowaMaszyny(maszynaId, maszynaNazwa);
            return;
        }
        const li = element.closest('li'); if (!li) return;
        const maszynaId = li.dataset.id;
        if (element.classList.contains('delete-btn')) {
            if (confirm("Usunięcie maszyny usunie też jej zlecenia. Kontynuować?")) {
                // TODO: Transakcja usuwająca zlecenia powiązane z maszyną
                await deleteDoc(doc(db, "maszyny", maszynaId));
                 wyswietlKlientow(); // Odśwież widok klientów po usunięciu maszyny
            }
        }
        if (element.classList.contains('edit-maszyna-btn')) {
             otworzModalEdycjiMaszyny(maszynaId);
        }
    }

    function otworzModalEdycjiMaszyny(maszynaId) { /* ... (bez zmian) ... */ }
    async function zapiszEdycjeMaszyny(event) { /* ... (bez zmian - aktualizacja zleceń dodana) ... */ }
    // --- PRZEJAZDY ---
    function wyswietlPrzejazdy() {
        onSnapshot(query(collection(db, "przejazdy"), orderBy("data", "desc")), (snapshot) => {
            wszystkiePrzejazdy = [];
            snapshot.forEach(doc => wszystkiePrzejazdy.push({ id: doc.id, ...doc.data() }));
            filtrujIwyswietlPrzejazdy();
        });
    }
    function filtrujIwyswietlPrzejazdy() {
        const przefiltrowane = wszystkiePrzejazdy.filter(p => p.data && p.data.startsWith(miesiacPrzejazdyInput.value));
        listaPrzejazdowDiv.innerHTML = przefiltrowane.length === 0 ? "<p>Brak przejazdów w tym miesiącu.</p>" : `<ul>${przefiltrowane.map(p => `<li data-id="${p.id}"><span><strong>${p.data}</strong>: ${p.skad} → ${p.dokad} (<strong>${p.dystans} km</strong>)</span><div><button class="btn-edit edit-przejazd-btn">Edytuj</button><button class="delete-btn">Usuń</button></div></li>`).join('')}</ul>`;
    }
    async function dodajLubEdytujPrzejazd(event) {
        event.preventDefault();
        const dane = { data: przejazdForm.data.value, skad: przejazdForm.skad.value, dokad: przejazdForm.dokad.value, dystans: Number(przejazdForm.dystans.value) };
        try {
            if (edytowanyPrzejazdId) { await updateDoc(doc(db, "przejazdy", edytowanyPrzejazdId), dane); edytowanyPrzejazdId = null; }
            else { dane.createdAt = new Date(); await addDoc(collection(db, "przejazdy"), dane); }
            przejazdForm.reset(); przejazdForm.querySelector('button').textContent = 'Zapisz Przejazd';
        } catch (e) { console.error("Błąd zapisu przejazdu: ", e); }
    }
    async function obslugaListyPrzejazdow(event) {
        const li = event.target.closest('li'); if (!li) return;
        const docId = li.dataset.id;
        if (event.target.classList.contains('delete-btn')) { if (confirm("Na pewno usunąć?")) { await deleteDoc(doc(db, "przejazdy", docId)); } }
        if (event.target.classList.contains('edit-przejazd-btn')) {
            const przejazd = wszystkiePrzejazdy.find(p => p.id === docId);
            if (przejazd) {
                przejazdForm.data.value = przejazd.data; przejazdForm.skad.value = przejazd.skad;
                przejazdForm.dokad.value = przejazd.dokad; przejazdForm.dystans.value = przejazd.dystans;
                edytowanyPrzejazdId = docId;
                przejazdForm.querySelector('button').textContent = 'Zaktualizuj Przejazd';
                window.scrollTo(0, 0);
            }
        }
    }
    // --- ZLECENIA ---
    function wyswietlZlecenia() {
         if (_wszystkieMaszynyCache.length === 0 && _wszystkieZleceniaCache.length > 0) {
             console.log("Czekam na maszyny przed renderowaniem zleceń...");
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
            const nazwa = klient ? `${klient.nazwa} - ${maszyna ? maszyna.typMaszyny : ''} ${maszyna ? maszyna.model : ''}` : zlecenie.nrZlecenia;
            const tekstDoWyszukania = `${nazwa} ${zlecenie.nrZlecenia} ${klient ? klient.nazwa : ''} ${maszyna ? maszyna.model : ''} ${maszyna ? maszyna.typMaszyny : ''}`.toLowerCase();
            return tekstDoWyszukania.includes(frazaWyszukiwania);
        });

        przefiltrowaneZlecenia.forEach(zlecenie => {
            wszystkieZlecenia.push(zlecenie);
            const maszyna = _wszystkieMaszynyCache.find(m => m.id === zlecenie.maszynaId);
            const klient = _wszystkieKlienciCache.find(k => k.id === zlecenie.klientId);
            const nazwa = klient ? `${klient.nazwa} - ${maszyna ? maszyna.typMaszyny : ''} ${maszyna ? maszyna.model : ''}` : zlecenie.nrZlecenia;

            if (zlecenie.status === 'aktywne' || zlecenie.status === 'nieprzypisane') {
                const przycisk = zlecenie.status === 'nieprzypisane' ? `<button class="assign-btn btn-edit">Przypisz</button>` : `<button class="complete-btn">Zakończ</button>`;
                aktywneHtml += `<li data-id="${zlecenie.id}"><span><strong>${nazwa}</strong><br><em>${zlecenie.opis || ''}</em></span><div><button class="btn-details details-zlecenie-btn">Szczegóły</button>${przycisk}<button class="delete-btn">Usuń</button></div></li>`;
            } else { // Zakończone
                const nazwaMaszyny = klient ? `${klient.nazwa} - ${maszyna ? maszyna.typMaszyny : ''} ${maszyna ? maszyna.model : ''}` : 'Zlecenie usuniętej maszyny';
                const uzyteCzesciHtml = zlecenie.uzyteCzesci?.length > 0 ? `<br><small>Użyto: ${zlecenie.uzyteCzesci.map(c => `${c.nazwa} (x${c.ilosc})`).join(', ')}</small>` : '';
                ukonczoneHtml += `<li data-id="${zlecenie.id}"><span><strong>${nazwaMaszyny}</strong> (Nr: ${zlecenie.nrZlecenia})<br><em>Ukończono (${zlecenie.dataUkonczenia||'b.d.'})</em><br>Fakturowano: <strong>${zlecenie.wyfakturowaneGodziny||0}h</strong> | Typ: <strong>${zlecenie.typZlecenia||'?'}</strong>${uzyteCzesciHtml}</span><div><button class="btn-details details-zlecenie-btn">Szczegóły</button><button class="btn-edit edit-zlecenie-btn">Edytuj</button><button class="delete-btn">Usuń</button></div></li>`;
            }
        });
        aktywneZleceniaLista.innerHTML = aktywneHtml ? `<ul>${aktywneHtml}</ul>` : "<p>Brak aktywnych zleceň lub pasujących do wyszukiwania.</p>";
        ukonczoneZleceniaLista.innerHTML = ukonczoneHtml ? `<ul>${ukonczoneHtml}</ul>` : "<p>Brak ukończonych zleceň lub pasujących do wyszukiwania.</p>";
        obliczIPokazPodsumowanieFinansowe();
    }

    function nasluchujNaZlecenia() {
        onSnapshot(query(collection(db, "zlecenia"), orderBy("createdAt", "desc")), (snapshot) => {
             _wszystkieZleceniaCache = [];
             wszystkieZlecenia = [];
             snapshot.forEach(doc => {
                 const zlecenie = { id: doc.id, ...doc.data() };
                 _wszystkieZleceniaCache.push(zlecenie);
                 wszystkieZlecenia.push(zlecenie);
             });
             wyswietlZlecenia();
             wyswietlWpisyKalendarza();
        });
    }

    async function dodajZlecenie(event) { /* ... (bez zmian) ... */ }
function obliczIPokazPodsumowanieFinansowe() {
        const podsumowanie = obliczPodsumowanieFinansowe(miesiacSummaryInput.value, wszystkieZlecenia);
        summaryContainer.innerHTML = `<p>Suma godzin: <strong>${podsumowanie.sumaGodzin.toFixed(2)} h</strong></p><p>Wartość Brutto: <strong>${podsumowanie.sumaBrutto.toFixed(2)} zł</strong></p><p>Wartość Netto (po 30%): <strong>${podsumowanie.sumaNetto.toFixed(2)} zł</strong></p>`;
    }
    
    async function obslugaListyZlecen(event) {
        const li = event.target.closest('li'); if (!li) return;
        const docId = li.dataset.id;
        if (event.target.classList.contains('delete-btn')) { if (confirm("Na pewno usunąć?")) { await deleteDoc(doc(db, "zlecenia", docId)); } }
        if (event.target.classList.contains('details-zlecenie-btn')) {
            otworzModalSzczegolowZlecenia(docId);
        }
        if (event.target.classList.contains('assign-btn')) {
            // Użyj cache zleceń
            const zlecenie = _wszystkieZleceniaCache.find(z => z.id === docId); 
            if (zlecenie) {
                document.getElementById('assign-zlecenie-id').value = docId;
                document.getElementById('assign-zlecenie-opis').textContent = zlecenie.nrZlecenia;
                document.getElementById('assign-machine-section').style.display = 'none';
                assignForm.reset();
                assignModal.style.display = 'block';
            }
        }
        if (event.target.classList.contains('complete-btn')) {
            const docSnap = await getDoc(doc(db, "zlecenia", docId));
            if (docSnap.exists()) {
                 const zlecenie = docSnap.data();
                 // Użyj cache maszyn do pobrania nazwy
                 const maszyna = _wszystkieMaszynyCache.find(m => m.id === zlecenie.maszynaId);
                 const klient = _wszystkieKlienciCache.find(k => k.id === zlecenie.klientId);
                 const nazwaMaszyny = klient ? `${klient.nazwa} - ${maszyna ? maszyna.typMaszyny : ''} ${maszyna ? maszyna.model : ''}` : 'Nieprzypisane';
                 document.getElementById('modal-klient').textContent = nazwaMaszyny;
                 document.getElementById('modal-nr-zlecenia').textContent = zlecenie.nrZlecenia;
                 document.getElementById('complete-zlecenie-id').value = docId;
                 czesciDoZlecenia = [];
                 renderCzesciDoZlecenia();
                 renderMagazynWModalu();
                 completeModal.style.display = 'block';
            }
        }
        if (event.target.classList.contains('edit-zlecenie-btn')) {
             // Użyj cache zleceń
             const zlecenie = _wszystkieZleceniaCache.find(z => z.id === docId); 
             if (zlecenie && zlecenie.status === 'ukończone') {
                 otworzModalEdycjiZlecenia(docId);
             } else if (zlecenie) {
                 alert("Można edytować tylko zakończone zlecenia.");
             }
        }
     }

    function otworzModalEdycjiZlecenia(zlecenieId) {
        // Użyj cache
        const zlecenie = _wszystkieZleceniaCache.find(z => z.id === zlecenieId); 
        if (!zlecenie) return;
        const maszyna = _wszystkieMaszynyCache.find(m => m.id === zlecenie.maszynaId);
        const klient = _wszystkieKlienciCache.find(k => k.id === zlecenie.klientId);
        const nazwaMaszyny = klient ? `${klient.nazwa} - ${maszyna ? maszyna.typMaszyny : ''} ${maszyna ? maszyna.model : ''}` : 'Nieprzypisane';

        editZlecenieForm['edit-zlecenie-id'].value = zlecenie.id;
        document.getElementById('edit-zlecenie-klient').textContent = nazwaMaszyny;
        document.getElementById('edit-zlecenie-nr').textContent = zlecenie.nrZlecenia;
        editZlecenieForm['edit-wyfakturowane-godziny'].value = zlecenie.wyfakturowaneGodziny || 0;
        editZlecenieForm['edit-typ-zlecenia'].value = zlecenie.typZlecenia || 'S'; 

        editZlecenieModal.style.display = 'block';
    }

    async function zapiszEdycjeZlecenia(event) {
        event.preventDefault();
        const zlecenieId = editZlecenieForm['edit-zlecenie-id'].value;
        const noweGodziny = Number(editZlecenieForm['edit-wyfakturowane-godziny'].value);
        const nowyTyp = editZlecenieForm['edit-typ-zlecenia'].value;

        if (isNaN(noweGodziny) || noweGodziny < 0) {
            alert("Podaj poprawną liczbę godzin.");
            return;
        }

        const zlecenieRef = doc(db, "zlecenia", zlecenieId);
        try {
            // Pobierz aktualną historię
            const zlecenieSnap = await getDoc(zlecenieRef);
            const zlecenieData = zlecenieSnap.data();
            const staraHistoria = zlecenieData.historia || [];
            const staryTyp = zlecenieData.typZlecenia;
            const stareGodziny = zlecenieData.wyfakturowaneGodziny;

            // Dodaj wpis do historii
            let wpisHistorii = `Edytowano zakończone zlecenie: `;
            const zmiany = [];
            if (stareGodziny !== noweGodziny) {
                 zmiany.push(`Godziny zmieniono z ${stareGodziny}h na ${noweGodziny}h`);
            }
            if (staryTyp !== nowyTyp) {
                 zmiany.push(`Typ zmieniono z ${staryTyp} na ${nowyTyp}`);
            }
            if (zmiany.length === 0) {
                 editZlecenieModal.style.display = 'none';
                 return; // Nic do zapisania
            }
            wpisHistorii += zmiany.join('; ');

            const nowaHistoria = [...staraHistoria, {
                timestamp: new Date().toISOString(),
                akcja: wpisHistorii
            }];

            // Zaktualizuj dokument
            await updateDoc(zlecenieRef, {
                wyfakturowaneGodziny: noweGodziny,
                typZlecenia: nowyTyp,
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
        // Użyj cache
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
            infoDiv.innerHTML += `
                <div class="details-group"><strong>Data Faktycznego Zakończenia:</strong> <p>${zlecenie.dataUkonczenia}</p></div>
                <div class="details-group"><strong>Fakturowane Godziny:</strong> <p>${zlecenie.wyfakturowaneGodziny || 0} h</p></div>
                <div class="details-group"><strong>Typ Zlecenia:</strong> <p>${zlecenie.typZlecenia} (${STAWKI[zlecenie.typZlecenia]?.nazwa || 'Nieznany'})</p></div>
                <div class="details-group"><strong>Użyte Części:</strong> <p>${zlecenie.uzyteCzesci?.length > 0 ? zlecenie.uzyteCzesci.map(c => `${c.nazwa} (x${c.ilosc})`).join(', ') : 'Brak'}</p></div>
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
        }
        else { historiaDiv.innerHTML = '<p>Brak historii dla tego zlecenia.</p>'; }

        const kalendarzDiv = document.getElementById('details-zlecenie-kalendarz');
        kalendarzDiv.innerHTML = '<p>Ładowanie wpisów z kalendarza...</p>';
        const qKalendarz = query(collection(db, "godziny_pracy"), where("zlecenieId", "==", zlecenieId), orderBy("id", "desc")); 
        const querySnapshotKalendarz = await getDocs(qKalendarz);
        let kalendarzHtml = '';
        querySnapshotKalendarz.forEach((doc) => {
            const wpis = doc.data();
            const dataWpisu = doc.id;
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
                await new Promise(resolve => setTimeout(resolve, 500)); // Daj czas na aktualizację cache
                // Użyj cache klientów
                const klient = _wszystkieKlienciCache.find(k => k.id === klientId); 
                if (!klient) { alert("Błąd: Nie znaleziono danych nowo dodanego klienta. Spróbuj ponownie."); return;}
                const nowaMaszynaDoc = await addDoc(collection(db, "maszyny"), {
                    klientId: klientId, klientNazwa: klient.nazwa,
                    typMaszyny: nowaMaszynaTyp, model: nowaMaszynaModel, createdAt: new Date()
                });
                maszynaId = nowaMaszynaDoc.id;
            }
            if (!maszynaId) { alert("Musisz wybrać lub dodać maszynę."); return; }
            
            // Daj Firebase chwilę na przetworzenie dodania maszyny, zanim pobierzesz jej dane
            await new Promise(resolve => setTimeout(resolve, 700)); 
            
            // Użyj cache maszyn
            const maszyna = _wszystkieMaszynyCache.find(m => m.id === maszynaId); 
            if (!maszyna) { alert("Błąd: Nie znaleziono danych wybranej/dodanej maszyny. Spróbuj ponownie."); return; }

            const zlecenieRef = doc(db, "zlecenia", zlecenieId);
            const zlecenieSnap = await getDoc(zlecenieRef);
            if (!zlecenieSnap.exists()) { alert("Błąd: Nie znaleziono zlecenia do przypisania."); return;}
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
        } catch (error) { console.error("Błąd podczas przypisywania:", error); alert(`Wystąpił błąd: ${error.message}`);}
     }
    
    function renderMagazynWModalu() {
        modalMagazynLista.innerHTML = wszystkieProdukty.filter(p => p.ilosc > 0).map(p => `<div class="modal-stock-item" data-id="${p.id}" data-name="${p.nazwa}" data-qty="${p.ilosc}" data-is-oil="${p.jestOlejem || false}"><span>${p.nazwa}</span><span class="item-qty">Na stanie: ${p.ilosc}</span></div>`).join('');
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
            ? czesciDoZlecenia.map(c => `<li class="part-list-item" data-id="${c.id}"><span>${c.nazwa} - <strong>${c.ilosc} szt.</strong></span><div class="actions"><button type="button" class="btn-edit edit-part-btn">Edytuj</button><button type="button" class="btn-remove remove-part-btn">Usuń</button></div></li>`).join('')
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
            if (nowaIlosc > produkt.ilosc) { alert(`Błąd: Na stanie jest tylko ${produkt.ilosc} szt.`); return; }
            czesc.ilosc = nowaIlosc;
            renderCzesciDoZlecenia();
        }
    }
    async function obslugaZakonczeniaZlecenia(event) {
        event.preventDefault();
        const docId = document.getElementById('complete-zlecenie-id').value;
        const dane = { status: 'ukończone', wyfakturowaneGodziny: Number(document.getElementById('wyfakturowane-godziny').value), typZlecenia: document.getElementById('typ-zlecenia').value, dataUkonczenia: new Date().toISOString().split('T')[0], uzyteCzesci: czesciDoZlecenia };
        try {
            await runTransaction(db, async (t) => {
                const zlecenieRef = doc(db, "zlecenia", docId);
                const zlecenieSnap = await t.get(zlecenieRef);
                const zlecenieData = zlecenieSnap.data();
                const nowaHistoria = [...(zlecenieData.historia || []), {
                    timestamp: new Date().toISOString(),
                    akcja: `Zakończono zlecenie. Godziny: ${dane.wyfakturowaneGodziny}h. Typ: ${dane.typZlecenia}.`
                }];
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
        } catch (error) { console.error("BŁĄD TRANSAKCJI: ", error); alert(`Wystąpił błąd: ${error.message}`); }
    }
// --- MAGAZYN ---
    async function dodajProduktDoMagazynu(event) { /* ... */ }
    async function dodajMasowo(event) { /* ... */ }
    async function dodajOlej() { /* ... */ }
    function przeliczOlej(event) { /* ... */ }
    async function obslugaTabeliMagazynu(event) { /* ... */ }
    async function obslugaZmianyStanu(event) { /* ... */ }
    function wyswietlMagazyn() {
        onSnapshot(query(collection(db, "magazyn"), orderBy("createdAt", "desc")), (snapshot) => {
            let html = '';
            wszystkieProdukty = [];
            if (snapshot.empty) { magazynLista.innerHTML = '<tr><td colspan="6">Magazyn pusty.</td></tr>'; return; }
            snapshot.forEach((doc) => {
                const produkt = doc.data();
                produkt.id = doc.id;
                wszystkieProdukty.push(produkt);
                const iloscWLitrach = produkt.jestOlejem ? (produkt.ilosc * produkt.pojemnosc).toFixed(2) + ' L' : '---';
                const iloscFormatowana = produkt.ilosc.toFixed(2);
                html += `<tr data-id="${produkt.id}" data-name="${produkt.nazwa}" data-qty="${produkt.ilosc}" data-is-oil="${produkt.jestOlejem || false}"><td>${produkt.index}</td><td>${produkt.nazwa}</td><td>${iloscFormatowana} szt.</td><td>${iloscWLitrach}</td><td>${produkt.klient}</td><td><button class="add-stock-btn">Dodaj</button><button class="remove-stock-btn">Zdejmij</button><button class="delete-btn">Usuń</button></td></tr>`;
            });
            magazynLista.innerHTML = html;
        });
     }
    
    // --- PODPIĘCIE EVENTÓW ---
    klientForm.addEventListener('submit', dodajKlienta);
    listaKlientowDiv.addEventListener('click', obslugaListyKlientow); 
    maszynaForm.addEventListener('submit', dodajMaszyne);
    listaMaszynDiv.addEventListener('click', obslugaListyMaszyn); 
    przejazdForm.addEventListener('submit', dodajLubEdytujPrzejazd);
    listaPrzejazdowDiv.addEventListener('click', obslugaListyPrzejazdow);
    miesiacPrzejazdyInput.addEventListener('change', filtrujIwyswietlPrzejazdy);
    document.getElementById('export-przejazdy-btn').addEventListener('click', () => { 
        const miesiac = miesiacPrzejazdyInput.value;
        const dane = wszystkiePrzejazdy.filter(p => p.data.startsWith(miesiac)).map(({id, createdAt, ...reszta}) => reszta);
        eksportujDoCSV(dane, `przejazdy_${miesiac}.csv`);
    });
    zlecenieForm.addEventListener('submit', dodajZlecenie);
    aktywneZleceniaLista.addEventListener('click', obslugaListyZlecen);
    ukonczoneZleceniaLista.addEventListener('click', obslugaListyZlecen); 
    completeModalForm.addEventListener('submit', obslugaZakonczeniaZlecenia);
    closeModalButton.onclick = () => { completeModal.style.display = "none"; };
    miesiacSummaryInput.addEventListener('change', () => { obliczIPokazPodsumowanieFinansowe(); });
    document.getElementById('export-zlecenia-btn').addEventListener('click', () => { 
        const miesiac = miesiacSummaryInput.value;
        const dane = _wszystkieZleceniaCache.filter(z => z.status === 'ukończone' && z.dataUkonczenia && z.dataUkonczenia.startsWith(miesiac)) 
            .map(({id, createdAt, status, uzyteCzesci, historia, ...reszta}) => ({...reszta, uzyte_czesci: uzyteCzesci ? uzyteCzesci.map(c => c.nazwa).join(', ') : ''}));
        eksportujDoCSV(dane, `zlecenia_${miesiac}.csv`);
    });
    magazynForm.addEventListener('submit', dodajProduktDoMagazynu);
    bulkAddForm.addEventListener('submit', dodajMasowo);
    magazynLista.addEventListener('click', obslugaTabeliMagazynu);
    stockModalForm.addEventListener('submit', obslugaZmianyStanu);
    stockModalCloseButton.onclick = () => { stockModal.style.display = "none"; };
    addOilBtn.addEventListener('click', dodajOlej);
    converterLitryInput.addEventListener('input', przeliczOlej);
    converterSztukiInput.addEventListener('input', przeliczOlej);
    oilContainerSizeSelect.addEventListener('change', () => { przeliczOlej({target:{id:''}}); }); // Wywołaj przeliczanie przy zmianie pojemnika
  
    modalMagazynLista.addEventListener('click', dodajCzescDoZlecenia);
    partsToRemoveList.addEventListener('click', obslugaListyCzesci);
    zlecenieKlientSelect.addEventListener('change', (event) => { 
        const wybranyKlientId = event.target.value;
        if (wybranyKlientId === "szybkie-zlecenie" || !wybranyKlientId) {
            zlecenieMaszynaSelect.disabled = true;
            zlecenieMaszynaSelect.innerHTML = `<option value="">${wybranyKlientId ? '-- N/A --' : '-- Najpierw wybierz klienta --'}</option>`;
        } else {
            const maszynyKlienta = _wszystkieMaszynyCache.filter(m => m.klientId === wybranyKlientId); 
            let maszynySelectHtml = '<option value="">-- Wybierz maszynę --</option>';
            if (maszynyKlienta.length > 0) {
                maszynySelectHtml += maszynyKlienta.map(m => `<option value="${m.id}">${m.typMaszyny} ${m.model}</option>`).join('');
                zlecenieMaszynaSelect.disabled = false;
            } else {
                maszynySelectHtml = '<option value="">-- Ten klient nie ma maszyn --</option>';
                zlecenieMaszynaSelect.disabled = true;
            }
            zlecenieMaszynaSelect.innerHTML = maszynySelectHtml;
        }
    });
    assignForm.addEventListener('submit', zapiszPrzypisanie);
    assignModal.querySelector('.close-button').onclick = () => { assignModal.style.display = 'none'; };
    document.getElementById('assign-klient-select').addEventListener('change', (event) => { 
        const klientId = event.target.value;
        const maszynyKlienta = _wszystkieMaszynyCache.filter(m => m.klientId === klientId); 
        const maszynySelect = document.getElementById('assign-maszyna-select');
        let html = '<option value="">-- Wybierz istniejącą --</option>';
        if(klientId) {
            html += maszynyKlienta.map(m => `<option value="${m.id}">${m.typMaszyny} ${m.model}</option>`).join('');
            document.getElementById('assign-machine-section').style.display = 'block';
        } else {
            document.getElementById('assign-machine-section').style.display = 'none';
        }
        maszynySelect.innerHTML = html;
    });
    kalendarzForm.addEventListener('submit', obslugaZapisuGodzin);
    kalendarzContainer.addEventListener('click', obslugaKalendarza);
    kalendarzModal.querySelector('.close-button').onclick = () => { kalendarzModal.style.display = 'none'; };

    klientSearchInput.addEventListener('input', wyswietlKlientow); 
    maszynaSearchInput.addEventListener('input', wyswietlMaszyny); 
    zlecenieSearchInput.addEventListener('input', wyswietlZlecenia); 

    editKlientForm.addEventListener('submit', zapiszEdycjeKlienta);
    editMaszynaForm.addEventListener('submit', zapiszEdycjeMaszyny);
    editZlecenieForm.addEventListener('submit', zapiszEdycjeZlecenia);
    
    editKlientModal.querySelector('.close-button').onclick = () => { editKlientModal.style.display = 'none'; };
    editMaszynaModal.querySelector('.close-button').onclick = () => { editMaszynaModal.style.display = 'none'; };
    detailsZlecenieModal.querySelector('.close-button').onclick = () => { detailsZlecenieModal.style.display = 'none'; };
    editZlecenieModal.querySelector('.close-button').onclick = () => { editZlecenieModal.style.display = 'none'; }; 
    machineHistoryModal.querySelector('.close-button').onclick = () => { machineHistoryModal.style.display = 'none'; }; 

    window.onclick = (event) => { 
        if (event.target == completeModal || 
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

    // --- INICJALIZACJA ---
    inicjalizujKalendarz();
    // Kolejność nasłuchiwania jest ważna!
    nasluchujNaKlientow(); // Ładuje klientów i wywołuje wyswietlKlientow
    nasluchujNaMaszyny();   // Ładuje maszyny i wywołuje wyswietlMaszyny -> wyswietlKlientow
    nasluchujNaZlecenia();  // Ładuje zlecenia i wywołuje wyswietlZlecenia -> wyswietlWpisyKalendarza
    wyswietlPrzejazdy();
    wyswietlMagazyn();
} // KONIEC initializeApp()