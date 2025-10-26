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
        if (_wszystkieZleceniaCache.length === 0) {
            console.log("Czekam na załadowanie danych zleceń dla kalendarza...");
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
        // Zwijanie zakończonych zleceń
        zakonczoneZleceniaHeader.classList.add('collapsed');
        zakonczoneZleceniaContent.classList.add('collapsed');
        zakonczoneZleceniaHeader.addEventListener('click', () => {
            zakonczoneZleceniaHeader.classList.toggle('collapsed');
            zakonczoneZleceniaContent.classList.toggle('collapsed');
        });

        // Zwijanie listy klientów
        listaKlientowHeader.classList.add('collapsed');
        listaKlientowContent.classList.add('collapsed');
        listaKlientowHeader.addEventListener('click', () => {
            listaKlientowHeader.classList.toggle('collapsed');
            listaKlientowContent.classList.toggle('collapsed');
        });

        // Zwijanie listy maszyn (główny kontener)
        listaMaszynHeader.classList.add('collapsed');
        listaMaszynContent.classList.add('collapsed');
        listaMaszynHeader.addEventListener('click', () => {
            listaMaszynHeader.classList.toggle('collapsed');
            listaMaszynContent.classList.toggle('collapsed');
        });
    }
    // --- KLIENCI ---
    async function dodajKlienta(event) { /* ... (bez zmian) ... */ }

    function wyswietlKlientow() {
        const frazaWyszukiwania = klientSearchInput.value.toLowerCase(); 
        wszystkieKlienci = []; 
        let klienciHtml = '', selectHtml = '<option value="">-- Wybierz klienta --</option>', selectZleceniaHtml = '<option value="">-- Wybierz klienta --</option><option value="szybkie-zlecenie">-- SZYBKIE ZLECENIE (bez klienta) --</option>';

        // Sprawdź czy cache maszyn jest załadowany
        if (_wszystkieMaszynyCache.length === 0) {
            console.log("Czekam na maszyny przed renderowaniem klientów...");
            listaKlientowDiv.innerHTML = "<p>Ładowanie danych maszyn...</p>"; // Informacja dla użytkownika
            return; // Poczekaj na załadowanie maszyn
        }

        const przefiltrowaniKlienci = _wszystkieKlienciCache.filter(klient => { 
             if (!frazaWyszukiwania) return true;
             const tekstDoWyszukania = `${klient.nazwa} ${klient.nip} ${klient.adres} ${klient.telefon}`.toLowerCase();
             return tekstDoWyszukania.includes(frazaWyszukiwania);
        });

        przefiltrowaniKlienci.forEach(klient => {
            wszystkieKlienci.push(klient); 
            const maszynyKlienta = _wszystkieMaszynyCache.filter(m => m.klientId === klient.id); 
            const maszynyListaHtml = maszynyKlienta.length > 0
                ? `<ul class="client-machine-list">
                    ${maszynyKlienta.map(m => `<li>${m.typMaszyny} ${m.model} (S/N: ${m.nrSeryjny}) <a href="#" class="machine-history-link" data-maszyna-id="${m.id}" data-maszyna-nazwa="${m.typMaszyny} ${m.model}">Pokaż historię</a></li>`).join('')}
                    </ul>`
                : '<p style="font-size: 0.8rem; margin-left: 15px; color: var(--text-color-light);">Brak maszyn</p>';

            klienciHtml += `
                <div class="client-group" data-id="${klient.id}"> 
                    <div class="client-header-item"> 
                        <span><strong>${klient.nazwa}</strong> (NIP: ${klient.nip})<br><small>${klient.adres} | ${klient.telefon}</small></span>
                        <div><button class="btn-edit edit-klient-btn">Edytuj</button><button class="delete-btn">Usuń</button></div>
                    </div>
                    ${maszynyListaHtml}
                </div>`;
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
        const clientGroup = event.target.closest('.client-group'); if (!clientGroup) return;
        const klientId = clientGroup.dataset.id;

        if (event.target.classList.contains('machine-history-link')) {
            event.preventDefault();
            const maszynaId = event.target.dataset.maszynaId;
            const maszynaNazwa = event.target.dataset.maszynaNazwa;
            pokazHistorieSerwisowaMaszyny(maszynaId, maszynaNazwa);
            return; 
        }
        if (event.target.classList.contains('delete-btn')) { /* ... */ }
        if (event.target.classList.contains('edit-klient-btn')) { /* ... */ }
    }

    async function pokazHistorieSerwisowaMaszyny(maszynaId, maszynaNazwa) {
        document.getElementById('machine-history-title').textContent = `Historia Serwisowa: ${maszynaNazwa}`;
        machineHistoryList.innerHTML = '<p>Ładowanie historii...</p>';
        machineHistoryModal.style.display = 'block';

        const q = query(collection(db, "zlecenia"), where("maszynaId", "==", maszynaId), where("status", "==", "ukończone"), orderBy("dataUkonczenia", "desc"));
        const querySnapshot = await getDocs(q);
        let historiaHtml = '';
        querySnapshot.forEach((doc) => {
            const zlecenie = doc.data();
            const uzyteCzesciHtml = zlecenie.uzyteCzesci?.length > 0 ? `<br><small>Użyto: ${zlecenie.uzyteCzesci.map(c => `${c.nazwa} (x${c.ilosc})`).join(', ')}</small>` : '';
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

        machineHistoryList.innerHTML = historiaHtml ? `<ul>${historiaHtml}</ul>` : '<p>Brak historii serwisowej (zakończonych zleceń) dla tej maszyny.</p>';
        
        machineHistoryList.querySelectorAll('.details-zlecenie-btn').forEach(btn => btn.addEventListener('click', (e) => otworzModalSzczegolowZlecenia(e.target.closest('li').dataset.id)));
        machineHistoryList.querySelectorAll('.edit-zlecenie-btn').forEach(btn => btn.addEventListener('click', (e) => otworzModalEdycjiZlecenia(e.target.closest('li').dataset.id)));
    }


    function otworzModalEdycjiKlienta(klientId) { /* ... (bez zmian) ... */ }
    async function zapiszEdycjeKlienta(event) { /* ... (bez zmian) ... */ }

    // --- MASZYNY ---
    async function dodajMaszyne(event) { /* ... (bez zmian) ... */ }

    function wyswietlMaszyny() {
        const frazaWyszukiwania = maszynaSearchInput.value.toLowerCase(); 
        wszystkieMaszyny = []; 

        const przefiltrowaneMaszyny = _wszystkieMaszynyCache.filter(maszyna => { 
                if (!frazaWyszukiwania) return true;
                const tekstDoWyszukania = `${maszyna.klientNazwa} ${maszyna.typMaszyny} ${maszyna.model} ${maszyna.nrSeryjny}`.toLowerCase();
                return tekstDoWyszukania.includes(frazaWyszukiwania);
        });

        const pogrupowaneMaszyny = przefiltrowaneMaszyny.reduce((acc, maszyna) => { (acc[maszyna.klientNazwa] = acc[maszyna.klientNazwa] || []).push(maszyna); return acc; }, {});
        let maszynyHtml = '';
        for (const klientNazwa in pogrupowaneMaszyny) {
            maszynyHtml += `<div class="client-group"><div class="client-header"><h4>${klientNazwa}</h4><span class="arrow">▶</span></div><ul class="machine-list">${pogrupowaneMaszyny[klientNazwa].map(maszyna => 
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
            wyswietlMaszyny();
            wyswietlKlientow(); // Ważne po załadowaniu maszyn
        });
    }

    async function obslugaListyMaszyn(event) {
        const element = event.target;

        if (element.closest('.client-header')) { /* ... */ return; }
        if (element.classList.contains('machine-history-link')) { 
            event.preventDefault();
            const maszynaId = element.dataset.maszynaId;
            const maszynaNazwa = element.dataset.maszynaNazwa;
            pokazHistorieSerwisowaMaszyny(maszynaId, maszynaNazwa);
            return; 
        }
        const li = element.closest('li'); if (!li) return;
        const maszynaId = li.dataset.id;
        if (element.classList.contains('delete-btn')) { /* ... */ }
        if (element.classList.contains('edit-maszyna-btn')) { /* ... */ }
    }

    function otworzModalEdycjiMaszyny(maszynaId) { /* ... (bez zmian) ... */ }
    async function zapiszEdycjeMaszyny(event) { /* ... (bez zmian) ... */ }
    
    // --- PRZEJAZDY --- (bez zmian)
    function wyswietlPrzejazdy() { /* ... */ }
    function filtrujIwyswietlPrzejazdy() { /* ... */ }
    async function dodajLubEdytujPrzejazd(event) { /* ... */ }
    async function obslugaListyPrzejazdow(event) { /* ... */ }
    
    // --- ZLECENIA ---
    function wyswietlZlecenia() {
        const frazaWyszukiwania = zlecenieSearchInput.value.toLowerCase(); 
        wszystkieZlecenia = []; 
        let aktywneHtml = '', ukonczoneHtml = '';

        const przefiltrowaneZlecenia = _wszystkieZleceniaCache.filter(zlecenie => { 
            if (!frazaWyszukiwania) return true;
            const nazwa = zlecenie.klientNazwa ? `${zlecenie.klientNazwa} - ${zlecenie.typMaszyny} ${zlecenie.model}` : zlecenie.nrZlecenia;
            const tekstDoWyszukania = `${nazwa} ${zlecenie.nrZlecenia} ${zlecenie.klientNazwa} ${zlecenie.model} ${zlecenie.typMaszyny}`.toLowerCase();
            return tekstDoWyszukania.includes(frazaWyszukiwania);
        });

        przefiltrowaneZlecenia.forEach(zlecenie => {
            wszystkieZlecenia.push(zlecenie); 
            const nazwa = zlecenie.klientNazwa ? `${zlecenie.klientNazwa} - ${zlecenie.typMaszyny} ${zlecenie.model}` : zlecenie.nrZlecenia;
            
            if (zlecenie.status === 'aktywne' || zlecenie.status === 'nieprzypisane') {
                const przycisk = zlecenie.status === 'nieprzypisane' ? `<button class="assign-btn btn-edit">Przypisz</button>` : `<button class="complete-btn">Zakończ</button>`;
                aktywneHtml += `<li data-id="${zlecenie.id}"><span><strong>${nazwa}</strong><br><em>${zlecenie.opis || ''}</em></span><div><button class="btn-details details-zlecenie-btn">Szczegóły</button>${przycisk}<button class="delete-btn">Usuń</button></div></li>`;
            } else { // Zakończone
                const nazwaMaszyny = zlecenie.klientNazwa ? `${zlecenie.klientNazwa} - ${zlecenie.typMaszyny} ${zlecenie.model}` : 'Zlecenie usuniętej maszyny';
                const uzyteCzesciHtml = zlecenie.uzyteCzesci?.length > 0 ? `<br><small>Użyto: ${zlecenie.uzyteCzesci.map(c => `${c.nazwa} (x${c.ilosc})`).join(', ')}</small>` : '';
                ukonczoneHtml += `<li data-id="${zlecenie.id}"><span><strong>${nazwaMaszyny}</strong> (Nr: ${zlecenie.nrZlecenia})<br><em>Ukończono (${zlecenie.dataUkonczenia||'b.d.'})</em><br>Fakturowano: <strong>${zlecenie.wyfakturowaneGodziny||0}h</strong> | Typ: <strong>${zlecenie.typZlecenia||'?'}</strong>${uzyteCzesciHtml}</span><div><button class="btn-details details-zlecenie-btn">Szczegóły</button><button class="btn-edit edit-zlecenie-btn">Edytuj</button><button class="delete-btn">Usuń</button></div></li>`;
            }
        });
        aktywneZleceniaLista.innerHTML = aktywneHtml ? `<ul>${aktywneHtml}</ul>` : "<p>Brak aktywnych zleceň.</p>";
        ukonczoneZleceniaLista.innerHTML = ukonczoneHtml ? `<ul>${ukonczoneHtml}</ul>` : "<p>Brak ukończonych zleceň.</p>";
        obliczIPokazPodsumowanieFinansowe();
        // Nie wywołuj wyswietlWpisyKalendarza stąd bezpośrednio, poczekaj na listener
    }

    // Zmieniono nazwę zmiennej globalnej cache i funkcji nasłuchującej
    let _wszystkieZleceniaCache = []; 
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
             wyswietlWpisyKalendarza(); // Ważne po załadowaniu zleceń
        });
    }

    async function dodajZlecenie(event) { /* ... (bez zmian) ... */ }
    function obliczIPokazPodsumowanieFinansowe() { /* ... (bez zmian) ... */ }
    async function obslugaListyZlecen(event) { /* ... (bez zmian) ... */ }
    function otworzModalEdycjiZlecenia(zlecenieId) { /* ... (bez zmian) ... */ }
    async function zapiszEdycjeZlecenia(event) { /* ... (bez zmian) ... */ }
    async function otworzModalSzczegolowZlecenia(zlecenieId) { /* ... (bez zmian) ... */ }
    async function zapiszPrzypisanie(event) { /* ... (bez zmian) ... */ }
    
    function renderMagazynWModalu() { /* ... (bez zmian) ... */ }
    function dodajCzescDoZlecenia(event) { /* ... (bez zmian) ... */ }
    function renderCzesciDoZlecenia() { /* ... (bez zmian) ... */ }
    async function obslugaListyCzesci(event) { /* ... (bez zmian) ... */ }
    async function obslugaZakonczeniaZlecenia(event) { /* ... (bez zmian) ... */ }
    // --- MAGAZYN ---
    async function dodajProduktDoMagazynu(event) {
        event.preventDefault();
        const dane = { index: magazynForm['item-index'].value, nazwa: magazynForm['item-name'].value, ilosc: Number(magazynForm['item-ilosc'].value), klient: magazynForm['item-klient'].value || '---', createdAt: new Date() };
        try { await addDoc(collection(db, "magazyn"), dane); magazynForm.reset(); } catch (e) { console.error("Błąd dodawania do magazynu: ", e); }
     }
    async function dodajMasowo(event) {
        event.preventDefault();
        const klient = bulkAddForm['bulk-klient'].value; const itemsText = bulkAddForm['bulk-items'].value.trim(); if (!itemsText) return;
        const lines = itemsText.split('\n'); let dodaneCount = 0;
        try {
            for (const line of lines) {
                const parts = line.split(';');
                if (parts.length === 3) {
                    const [index, nazwa, ilosc] = parts;
                    await addDoc(collection(db, "magazyn"), { index: index.trim(), nazwa: nazwa.trim(), ilosc: Number(ilosc.trim()), klient: klient, createdAt: new Date() });
                    dodaneCount++;
                }
            }
            alert(`Pomyślnie dodano ${dodaneCount} produktów.`); bulkAddForm.reset();
        } catch (error) { console.error("Błąd masowego dodawania:", error); alert("Wystąpił błąd."); }
     }
    async function dodajOlej() {
        const typ = oilTypeSelect.value;
        const pojemnosc = Number(oilContainerSizeSelect.value);
        const dane = { index: `OLEJ-${typ}-${pojemnosc}L`, nazwa: `Olej ${typ} ${pojemnosc}L`, ilosc: 1, klient: '---', jestOlejem: true, pojemnosc: pojemnosc, createdAt: new Date() };
        try { await addDoc(collection(db, "magazyn"), dane); } catch (e) { console.error("Błąd dodawania oleju: ", e); }
     }
    function przeliczOlej(event) {
        const pojemnosc = Number(oilContainerSizeSelect.value);
        if (isNaN(pojemnosc) || pojemnosc <= 0) return; // Zabezpieczenie
        const source = event.target;
        if (source.id === 'converter-litry') {
            converterSztukiInput.value = '';
            const litry = Number(source.value);
            resultSztuki.textContent = litry > 0 ? `${(litry / pojemnosc).toFixed(3)} szt.` : '0.00 szt.';
            if(litry <= 0) resultLitry.textContent = '0.00 L';
        } else if (source.id === 'converter-sztuki') {
            converterLitryInput.value = '';
            const sztuki = Number(source.value);
            resultLitry.textContent = sztuki > 0 ? `${(sztuki * pojemnosc).toFixed(2)} L` : '0.00 L';
            if(sztuki <= 0) resultSztuki.textContent = '0.00 szt.';
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
            document.getElementById('stock-modal-current-qty').textContent = tr.dataset.qty + ' szt.';
            document.getElementById('stock-change-id').value = docId;
            const qtyInput = document.getElementById('stock-change-qty');
            qtyInput.step = tr.dataset.isOil === 'true' ? "0.01" : "1";
            qtyInput.placeholder = tr.dataset.isOil === 'true' ? "np. 0.5" : "Tylko liczby całkowite";
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
                const currentQty = sfDoc.data().ilosc;
                let newQty = stockChangeOperation === 'add' ? currentQty + changeQty : currentQty - changeQty;
                if (newQty < 0) { throw "Nie można zdjąć więcej niż jest na stanie!"; }
                t.update(docRef, { ilosc: newQty });
            });
            stockModal.style.display = 'none';
            stockModalForm.reset();
        } catch (e) { console.error("Błąd transakcji: ", e); alert(`Wystąpił błąd: ${e}`); }
     }
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
                html += `<tr data-id="${produkt.id}" data-name="${produkt.nazwa}" data-qty="${produkt.ilosc}" data-is-oil="${produkt.jestOlejem || false}"><td>${produkt.index}</td><td>${produkt.nazwa}</td><td>${produkt.ilosc.toFixed(2)} szt.</td><td>${iloscWLitrach}</td><td>${produkt.klient}</td><td><button class="add-stock-btn">Dodaj</button><button class="remove-stock-btn">Zdejmij</button><button class="delete-btn">Usuń</button></td></tr>`;
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
    document.getElementById('export-przejazdy-btn').addEventListener('click', () => { /* ... */ });
    zlecenieForm.addEventListener('submit', dodajZlecenie);
    aktywneZleceniaLista.addEventListener('click', obslugaListyZlecen);
    ukonczoneZleceniaLista.addEventListener('click', obslugaListyZlecen); 
    completeModalForm.addEventListener('submit', obslugaZakonczeniaZlecenia);
    closeModalButton.onclick = () => { completeModal.style.display = "none"; };
    miesiacSummaryInput.addEventListener('change', () => { obliczIPokazPodsumowanieFinansowe(); });
    document.getElementById('export-zlecenia-btn').addEventListener('click', () => { /* ... */ });
    magazynForm.addEventListener('submit', dodajProduktDoMagazynu);
    bulkAddForm.addEventListener('submit', dodajMasowo);
    magazynLista.addEventListener('click', obslugaTabeliMagazynu);
    stockModalForm.addEventListener('submit', obslugaZmianyStanu);
    stockModalCloseButton.onclick = () => { stockModal.style.display = "none"; };
    addOilBtn.addEventListener('click', dodajOlej);
    converterLitryInput.addEventListener('input', przeliczOlej);
    converterSztukiInput.addEventListener('input', przeliczOlej);
    oilContainerSizeSelect.addEventListener('change', () => { converterLitryInput.value = ''; converterSztukiInput.value = ''; przeliczOlej({target:{id:''}}); }); 
  
    modalMagazynLista.addEventListener('click', dodajCzescDoZlecenia);
    partsToRemoveList.addEventListener('click', obslugaListyCzesci);
    zlecenieKlientSelect.addEventListener('change', (event) => { /* ... */ });
    assignForm.addEventListener('submit', zapiszPrzypisanie);
    assignModal.querySelector('.close-button').onclick = () => { assignModal.style.display = 'none'; };
    document.getElementById('assign-klient-select').addEventListener('change', (event) => { /* ... */ });
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
    nasluchujNaKlientow(); 
    nasluchujNaMaszyny();   
    nasluchujNaZlecenia();  
    wyswietlPrzejazdy();
    wyswietlMagazyn();
}