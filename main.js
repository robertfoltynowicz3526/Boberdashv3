import { db } from './firebase-config.js';
import { collection, query, orderBy, onSnapshot, doc, deleteDoc, updateDoc, getDoc, runTransaction, addDoc, setDoc } from "firebase/firestore";
import Papa from 'papaparse';

initializeApp();

function initializeApp() {
    // --- STAŁE I ZMIENNE GLOBALNE ---
    const STAWKI = { S: { nazwa: "Wyjazdowe", stawka: 45 }, W: { nazwa: "Warsztat", stawka: 35 }, G: { nazwa: "Gwarancja", stawka: 35 }, Z: { nazwa: "Zbrojenie", stawka: 30 }, P: { nazwa: "Poprawka", stawka: 0 } };
    let wszystkieZlecenia = [], wszystkieProdukty = [], wszystkiePrzejazdy = [], czesciDoZlecenia = [], wszystkieMaszyny = [], wszystkieKlienci = [], wszystkieWpisyKalendarza = [];
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
    const listaKlientowUl = document.getElementById('lista-klientow');
    const maszynaKlientSelect = document.getElementById('maszyna-klient-select');
    const maszynaForm = document.getElementById('maszyna-form');
    const listaMaszynUl = document.getElementById('lista-maszyn');
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

    // --- NOWE SELEKTORY ---
    const themeToggle = document.getElementById('theme-toggle');
    const zakonczoneZleceniaHeader = document.getElementById('zakonczone-zlecenia-header');
    const zakonczoneZleceniaContent = document.getElementById('zakonczone-zlecenia-content');
    const zlecenieSearchInput = document.getElementById('zlecenie-search-input');
    const editKlientModal = document.getElementById('edit-klient-modal');
    const editKlientForm = document.getElementById('edit-klient-form');
    const editMaszynaModal = document.getElementById('edit-maszyna-modal');
    const editMaszynaForm = document.getElementById('edit-maszyna-form');
    const detailsZlecenieModal = document.getElementById('details-zlecenie-modal');
    
    // --- INICJALIZACJA ---
    window.openTab = (evt, tabName) => { document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none'); document.querySelectorAll('.tab-button').forEach(button => button.classList.remove('active')); document.getElementById(tabName).style.display = 'block'; evt.currentTarget.classList.add('active'); };
    const now = new Date();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    const currentMonth = `${year}-${month}`;
    if(miesiacSummaryInput) miesiacSummaryInput.value = currentMonth;
    if(miesiacPrzejazdyInput) miesiacPrzejazdyInput.value = currentMonth;
    document.querySelector('.tab-button').click();
    inicjujCiemnyMotyw(); // NOWA: Inicjalizacja motywu
    inicjujZwijanie(); // NOWA: Inicjalizacja zwijanej sekcji

    // --- KALENDARZ ---
    function inicjalizujKalendarz() {
        if (!kalendarzContainer) return;
        calendar = new FullCalendar.Calendar(kalendarzContainer, {
            initialView: 'dayGridMonth', locale: 'pl',
            headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth' },
            // --- POPRAWIONA FUNKCJA --- (eventContent) - Przywrócona logika renderowania obu typów eventów
            eventContent: (arg) => {
                let eventEl = document.createElement('div');
                eventEl.innerHTML = `<div>${arg.event.title}</div>`;

                // Logika dla wpisów godzinowych (z przyciskami edycji/usuwania)
                if (arg.event.extendedProps.type === 'godziny_pracy') {
                    if (arg.event.extendedProps.notatka) { eventEl.innerHTML += ` <small title="${arg.event.extendedProps.notatka}">📝</small>`; }
                    let actionsEl = document.createElement('div');
                    actionsEl.classList.add('event-actions');
                    actionsEl.innerHTML = `<button type="button" class="btn-edit event-edit-btn" data-date="${arg.event.startStr}">E</button><button type="button" class="btn-remove event-delete-btn" data-date="${arg.event.startStr}">X</button>`;
                    eventEl.appendChild(actionsEl);
                }
                // Dla zleceń nie dodajemy przycisków edycji/usuwania w tym widoku
                return { domNodes: [eventEl] };
            },
            dateClick: (info) => otworzModalGodzin(info.dateStr),
            datesSet: (view) => { obliczSumeGodzinZKalendarza(view.view.currentStart, view.view.currentEnd); }
        });
        calendar.render();
        // Wywołanie wyswietlWpisyKalendarza nastąpi po załadowaniu zleceń
    }

    // --- ZMODYFIKOWANA FUNKCJA --- (otworzModalGodzin)
    async function otworzModalGodzin(data) {
        kalendarzModalTitle.textContent = `Ewidencja Czasu - ${data}`;
        kalendarzForm.reset();
        document.getElementById('kalendarz-data').value = data;

        // NOWA: Wypełnij listę aktywnych zleceń
        const zlecenieSelect = kalendarzForm['kalendarz-zlecenie-select'];
        zlecenieSelect.innerHTML = '<option value="">-- Brak --</option>'; // Resetuj
        wszystkieZlecenia
            .filter(z => z.status === 'aktywne' || z.status === 'nieprzypisane')
            .forEach(z => {
                const nazwa = z.klientNazwa ? `${z.klientNazwa} (${z.model || z.nrZlecenia})` : z.nrZlecenia;
                const option = document.createElement('option');
                option.value = z.id;
                option.textContent = nazwa;
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

    // --- ZMODYFIKOWANA FUNKCJA --- (obslugaZapisuGodzin)
    async function obslugaZapisuGodzin(event) {
        event.preventDefault();
        const data = kalendarzForm['kalendarz-data'].value;
        const zlecenieSelect = kalendarzForm['kalendarz-zlecenie-select'];
        const zlecenieId = zlecenieSelect.value;
        const zlecenieNazwa = zlecenieId ? zlecenieSelect.options[zlecenieSelect.selectedIndex].text : null;

        const dane = { 
            praca: Number(kalendarzForm['godziny-pracy'].value) || 0, 
            fakturowane: Number(kalendarzForm['godziny-fakturowane'].value) || 0, 
            nadgodziny: Number(kalendarzForm['nadgodziny'].value) || 0, 
            jazda: Number(kalendarzForm['czas-jazdy'].value) || 0, 
            notatka: kalendarzForm['kalendarz-notatka'].value || '',
            zlecenieId: zlecenieId || null, 
            zlecenieNazwa: zlecenieNazwa 
        };
        try { await setDoc(doc(db, "godziny_pracy", data), dane); kalendarzModal.style.display = 'none'; } catch (e) { console.error("Błąd zapisu godzin: ", e); }
    }

    // --- POPRAWIONA FUNKCJA --- (wyswietlWpisyKalendarza) - Ładuje OBA typy wydarzeń
    function wyswietlWpisyKalendarza() {
        onSnapshot(collection(db, "godziny_pracy"), (snapshotGodziny) => {
            wszystkieWpisyKalendarza = [];
            const events = [];

            // 1. Przetwórz wpisy godzinowe
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
                    title += `<hr style='margin: 2px 0; border-color: rgba(255,255,255,0.5)'><strong>${dane.zlecenieNazwa || 'Zlecenie?'}</strong>`;
                    className = 'fc-event-godziny-zlecenie'; // Zmieniona klasa, jeśli przypisane do zlecenia
                }

                if (title) { 
                    events.push({ 
                        id: `godziny_${id}`, // Unikalne ID dla typu
                        title: title.trim(), 
                        start: id, 
                        allDay: true, 
                        classNames: [className], 
                        extendedProps: { notatka: dane.notatka, type: 'godziny_pracy' } // Dodajemy typ
                    }); 
                }
            });
            
            // 2. Dodaj zlecenia do listy wydarzeń (przywrócona logika)
            wszystkieZlecenia.forEach(zlecenie => {
                const dataStart = zlecenie.dataRozpoczecia;
                const dataKoniec = zlecenie.dataZakonczenia;
                
                if (dataStart) {
                    const eventData = {
                        id: `zlecenie_${zlecenie.id}`, // Unikalne ID dla typu
                        title: `Zlecenie: ${zlecenie.klientNazwa || zlecenie.nrZlecenia}`,
                        start: dataStart,
                        allDay: true,
                        classNames: ['fc-event-zlecenie'], // Klasa dla zleceń
                        extendedProps: { type: 'zlecenie' } // Dodajemy typ
                    };
                    
                    // Jeśli jest data zakończenia, dodaj ją (FullCalendar obsłuży zakres)
                    if (dataKoniec && dataKoniec >= dataStart) {
                        // FullCalendar wymaga, aby data 'end' była *po* ostatnim dniu wydarzenia
                        const endDate = new Date(dataKoniec);
                        endDate.setDate(endDate.getDate() + 1); 
                        eventData.end = endDate.toISOString().split('T')[0];
                    }
                    
                    events.push(eventData);
                }
            });

            // 3. Renderuj kalendarz
            if (calendar) {
                calendar.removeAllEvents();
                calendar.addEventSource(events);
                obliczSumeGodzinZKalendarza(calendar.view.currentStart, calendar.view.currentEnd);
            }
        });
    }

    // --- ZMODYFIKOWANA FUNKCJA --- (obliczSumeGodzinZKalendarza)
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
    function aktualizujPulpit() { /* Pusta - nieużywana */ }

    // --- ZMODYFIKOWANA FUNKCJA --- (obliczPodsumowanieFinansowe)
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

    // --- NOWA FUNKCJA --- (Ciemny Motyw)
    function inicjujCiemnyMotyw() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        applyTheme(savedTheme);
        themeToggle.checked = (savedTheme === 'dark');
        themeToggle.addEventListener('change', () => {
            const newTheme = themeToggle.checked ? 'dark' : 'light';
            applyTheme(newTheme);
            localStorage.setItem('theme', newTheme);
        });
    }
    
    // --- NOWA FUNKCJA --- (Ciemny Motyw)
    function applyTheme(theme) {
        document.body.dataset.theme = theme;
    }

    // --- NOWA FUNKCJA --- (Inicjalizacja Zwijania)
    function inicjujZwijanie() {
        zakonczoneZleceniaHeader.classList.add('collapsed');
        zakonczoneZleceniaContent.classList.add('collapsed');

        zakonczoneZleceniaHeader.addEventListener('click', () => {
            zakonczoneZleceniaHeader.classList.toggle('collapsed');
            zakonczoneZleceniaContent.classList.toggle('collapsed');
        });
    }
    
    // --- KLIENCI ---
    async function dodajKlienta(event) {
        event.preventDefault();
        const dane = { nazwa: klientForm['klient-nazwa'].value, nip: klientForm['klient-nip'].value || '---', adres: klientForm['klient-adres'].value || '---', telefon: klientForm['klient-telefon'].value || '---', createdAt: new Date() };
        try { await addDoc(collection(db, "klienci"), dane); klientForm.reset(); } catch (e) { console.error("Błąd dodawania klienta: ", e); }
    }

    // --- ZMODYFIKOWANA FUNKCJA --- (wyswietlKlientow)
    function wyswietlKlientow() {
        onSnapshot(query(collection(db, "klienci"), orderBy("nazwa")), (snapshot) => {
            wszystkieKlienci = [];
            let klienciHtml = '', selectHtml = '<option value="">-- Wybierz klienta --</option>', selectZleceniaHtml = '<option value="">-- Wybierz klienta --</option><option value="szybkie-zlecenie">-- SZYBKIE ZLECENIE (bez klienta) --</option>';
            snapshot.forEach(doc => {
                const klient = { id: doc.id, ...doc.data() };
                wszystkieKlienci.push(klient);
                klienciHtml += `<li data-id="${klient.id}"><span><strong>${klient.nazwa}</strong> (NIP: ${klient.nip})<br><small>${klient.adres} | ${klient.telefon}</small></span><div><button class="btn-edit edit-klient-btn">Edytuj</button><button class="delete-btn">Usuń</button></div></li>`;
                selectHtml += `<option value="${klient.id}">${klient.nazwa}</option>`;
                selectZleceniaHtml += `<option value="${klient.id}">${klient.nazwa}</option>`;
            });
            listaKlientowUl.innerHTML = klienciHtml ? `<ul>${klienciHtml}</ul>` : "<p>Brak klientów w bazie.</p>";
            maszynaKlientSelect.innerHTML = selectHtml;
            zlecenieKlientSelect.innerHTML = selectZleceniaHtml;
            document.getElementById('assign-klient-select').innerHTML = selectHtml;
        });
    }

    // --- ZMODYFIKOWANA FUNKCJA --- (obslugaListyKlientow)
    async function obslugaListyKlientow(event) {
        const li = event.target.closest('li'); if (!li) return;
        const klientId = li.dataset.id;
        if (event.target.classList.contains('delete-btn')) { 
            if (confirm("Usunięcie klienta usunie też wszystkie jego maszyny i zlecenia. Kontynuować?")) { 
                // TODO: Dodać transakcję usuwającą maszyny i zlecenia
                await deleteDoc(doc(db, "klienci", klientId)); 
            } 
        }
        if (event.target.classList.contains('edit-klient-btn')) {
            otworzModalEdycjiKlienta(klientId);
        }
    }

    // --- NOWA FUNKCJA --- (otworzModalEdycjiKlienta)
    function otworzModalEdycjiKlienta(klientId) {
        const klient = wszystkieKlienci.find(k => k.id === klientId);
        if (!klient) return;
        editKlientForm['edit-klient-id'].value = klient.id;
        editKlientForm['edit-klient-nazwa'].value = klient.nazwa;
        editKlientForm['edit-klient-nip'].value = klient.nip;
        editKlientForm['edit-klient-adres'].value = klient.adres;
        editKlientForm['edit-klient-telefon'].value = klient.telefon;
        editKlientModal.style.display = 'block';
    }

    // --- NOWA FUNKCJA --- (zapiszEdycjeKlienta)
    async function zapiszEdycjeKlienta(event) {
        event.preventDefault();
        const klientId = editKlientForm['edit-klient-id'].value;
        const dane = {
            nazwa: editKlientForm['edit-klient-nazwa'].value,
            nip: editKlientForm['edit-klient-nip'].value,
            adres: editKlientForm['edit-klient-adres'].value,
            telefon: editKlientForm['edit-klient-telefon'].value,
        };
        try {
            await updateDoc(doc(db, "klienci", klientId), dane);
            // TODO: Dodać transakcję aktualizującą klientNazwa we wszystkich maszynach i zleceniach
            editKlientModal.style.display = 'none';
        } catch (e) {
            console.error("Błąd aktualizacji klienta:", e);
        }
    }

    // --- MASZYNY ---
    async function dodajMaszyne(event) {
        event.preventDefault();
        const wybranyKlientId = maszynaKlientSelect.value;
        if (!wybranyKlientId) { alert("Proszę wybrać klienta!"); return; }
        const klient = wszystkieKlienci.find(k => k.id === wybranyKlientId);
        const dane = {
            klientId: wybranyKlientId, klientNazwa: klient.nazwa, typMaszyny: maszynaForm['maszyna-typ'].value,
            model: maszynaForm['maszyna-model'].value, nrSeryjny: maszynaForm['maszyna-serial'].value || '---',
            rokProdukcji: Number(maszynaForm['maszyna-rok'].value) || null, motogodziny: Number(maszynaForm['maszyna-mth'].value) || 0, createdAt: new Date()
        };
        try { await addDoc(collection(db, "maszyny"), dane); maszynaForm.reset(); } catch (e) { console.error("Błąd dodawania maszyny: ", e); }
    }

    // --- ZMODYFIKOWANA FUNKCJA --- (wyswietlMaszyny)
    function wyswietlMaszyny() {
        onSnapshot(query(collection(db, "maszyny"), orderBy("klientNazwa")), (snapshot) => {
            wszystkieMaszyny = [];
            snapshot.forEach(doc => { wszystkieMaszyny.push({ id: doc.id, ...doc.data() }); });
            const pogrupowaneMaszyny = wszystkieMaszyny.reduce((acc, maszyna) => { (acc[maszyna.klientNazwa] = acc[maszyna.klientNazwa] || []).push(maszyna); return acc; }, {});
            let maszynyHtml = '';
            for (const klientNazwa in pogrupowaneMaszyny) {
                maszynyHtml += `<div class="client-group"><div class="client-header"><h4>${klientNazwa}</h4><span class="arrow">▶</span></div><ul class="machine-list">${pogrupowaneMaszyny[klientNazwa].map(maszyna => `<li data-id="${maszyna.id}"><span>${maszyna.typMaszyny} ${maszyna.model} (S/N: ${maszyna.nrSeryjny})</span><div><button class="btn-edit edit-maszyna-btn">Edytuj</button><button class="delete-btn">Usuń</button></div></li>`).join('')}</ul></div>`;
            }
            listaMaszynUl.innerHTML = maszynyHtml || "<p>Brak maszyn w bazie.</p>";
            zlecenieKlientSelect.dispatchEvent(new Event('change'));
        });
    }

    // --- ZMODYFIKOWANA FUNKCJA --- (obslugaListyMaszyn)
    async function obslugaListyMaszyn(event) {
        const element = event.target;
        if (element.closest('.client-header')) {
            const header = element.closest('.client-header');
            header.classList.toggle('open');
            header.nextElementSibling.classList.toggle('open');
            return;
        }
        const li = element.closest('li'); if (!li) return;
        const maszynaId = li.dataset.id;
        if (element.classList.contains('delete-btn')) { 
            if (confirm("Usunięcie maszyny usunie też jej zlecenia. Kontynuować?")) { 
                // TODO: Dodać transakcję usuwającą zlecenia
                await deleteDoc(doc(db, "maszyny", maszynaId)); 
            } 
        }
        if (element.classList.contains('edit-maszyna-btn')) {
            otworzModalEdycjiMaszyny(maszynaId);
        }
    }

    // --- NOWA FUNKCJA --- (otworzModalEdycjiMaszyny)
    function otworzModalEdycjiMaszyny(maszynaId) {
        const maszyna = wszystkieMaszyny.find(m => m.id === maszynaId);
        if (!maszyna) return;
        editMaszynaForm['edit-maszyna-id'].value = maszyna.id;
        document.getElementById('edit-maszyna-klient-nazwa').textContent = maszyna.klientNazwa;
        editMaszynaForm['edit-maszyna-typ'].value = maszyna.typMaszyny;
        editMaszynaForm['edit-maszyna-model'].value = maszyna.model;
        editMaszynaForm['edit-maszyna-serial'].value = maszyna.nrSeryjny;
        editMaszynaForm['edit-maszyna-rok'].value = maszyna.rokProdukcji;
        editMaszynaForm['edit-maszyna-mth'].value = maszyna.motogodziny;
        editMaszynaModal.style.display = 'block';
    }

    // --- NOWA FUNKCJA --- (zapiszEdycjeMaszyny)
    async function zapiszEdycjeMaszyny(event) {
        event.preventDefault();
        const maszynaId = editMaszynaForm['edit-maszyna-id'].value;
        const dane = {
            typMaszyny: editMaszynaForm['edit-maszyna-typ'].value,
            model: editMaszynaForm['edit-maszyna-model'].value,
            nrSeryjny: editMaszynaForm['edit-maszyna-serial'].value,
            rokProdukcji: Number(editMaszynaForm['edit-maszyna-rok'].value),
            motogodziny: Number(editMaszynaForm['edit-maszyna-mth'].value),
        };
        try {
            await updateDoc(doc(db, "maszyny", maszynaId), dane);
            // TODO: Dodać transakcję aktualizującą dane maszyny w zleceniach
            editMaszynaModal.style.display = 'none';
        } catch (e) {
            console.error("Błąd aktualizacji maszyny:", e);
        }
    }
    
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
        const frazaWyszukiwania = zlecenieSearchInput.value.toLowerCase(); 
        onSnapshot(query(collection(db, "zlecenia"), orderBy("createdAt", "desc")), (snapshot) => {
            let aktywneHtml = '', ukonczoneHtml = '';
            wszystkieZlecenia = [];
            snapshot.forEach((doc) => {
                const zlecenie = doc.data();
                zlecenie.id = doc.id;
                wszystkieZlecenia.push(zlecenie);

                const nazwa = zlecenie.klientNazwa ? `${zlecenie.klientNazwa} - ${zlecenie.typMaszyny} ${zlecenie.model}` : zlecenie.nrZlecenia;
                const tekstDoWyszukania = `${nazwa} ${zlecenie.nrZlecenia} ${zlecenie.klientNazwa} ${zlecenie.model} ${zlecenie.typMaszyny}`.toLowerCase();
                if (frazaWyszukiwania && !tekstDoWyszukania.includes(frazaWyszukiwania)) {
                    return; 
                }
                
                if (zlecenie.status === 'aktywne' || zlecenie.status === 'nieprzypisane') {
                    const przycisk = zlecenie.status === 'nieprzypisane' ? `<button class="assign-btn btn-edit">Przypisz</button>` : `<button class="complete-btn">Zakończ</button>`;
                    aktywneHtml += `<li data-id="${zlecenie.id}"><span><strong>${nazwa}</strong><br><em>${zlecenie.opis || ''}</em></span><div><button class="btn-details details-zlecenie-btn">Szczegóły</button>${przycisk}<button class="delete-btn">Usuń</button></div></li>`;
                } else {
                    const nazwaMaszyny = zlecenie.klientNazwa ? `${zlecenie.klientNazwa} - ${zlecenie.typMaszyny} ${zlecenie.model}` : 'Zlecenie usuniętej maszyny';
                    const uzyteCzesciHtml = zlecenie.uzyteCzesci?.length > 0 ? `<br><small>Użyto: ${zlecenie.uzyteCzesci.map(c => `${c.nazwa} (x${c.ilosc})`).join(', ')}</small>` : '';
                    ukonczoneHtml += `<li data-id="${zlecenie.id}"><span><strong>${nazwaMaszyny}</strong> (Nr: ${zlecenie.nrZlecenia})<br><em>Ukończono (${zlecenie.dataUkonczenia||'b.d.'})</em><br>Fakturowano: <strong>${zlecenie.wyfakturowaneGodziny||0}h</strong> | Typ: <strong>${zlecenie.typZlecenia||'?'}</strong>${uzyteCzesciHtml}</span><div><button class="btn-details details-zlecenie-btn">Szczegóły</button><button class="delete-btn">Usuń</button></div></li>`;
                }
            });
            aktywneZleceniaLista.innerHTML = aktywneHtml ? `<ul>${aktywneHtml}</ul>` : "<p>Brak aktywnych zleceň.</p>";
            ukonczoneZleceniaLista.innerHTML = ukonczoneHtml ? `<ul>${ukonczoneHtml}</ul>` : "<p>Brak ukończonych zleceň.</p>";
            obliczIPokazPodsumowanieFinansowe();
            wyswietlWpisyKalendarza(); // Odśwież kalendarz po załadowaniu zleceń
        });
    }
    
    // --- ZMODYFIKOWANA FUNKCJA --- (dodajZlecenie) - Usunięto datę obowiązkową, dodano opcjonalne
    async function dodajZlecenie(event) {
        event.preventDefault();
        const wybranyKlientId = zlecenieKlientSelect.value;
        const wybranaMaszynaId = zlecenieMaszynaSelect.value;
        const dataRozpoczecia = zlecenieForm['zlecenie-data-start'].value || null; // Opcjonalne
        const dataZakonczenia = zlecenieForm['zlecenie-data-koniec'].value || null; // Opcjonalne

        if (dataZakonczenia && !dataRozpoczecia) {
            alert("Nie można podać daty zakończenia bez daty rozpoczęcia.");
            return;
        }
         if (dataRozpoczecia && dataZakonczenia && dataZakonczenia < dataRozpoczecia) {
            alert("Data zakończenia nie może być wcześniejsza niż data rozpoczęcia.");
            return;
        }

        const historia = [{
            timestamp: new Date().toISOString(),
            akcja: "Utworzono zlecenie"
        }];

        let dane;
        if (wybranyKlientId === "szybkie-zlecenie") {
            dane = { 
                status: 'nieprzypisane', 
                nrZlecenia: zlecenieForm['nr-zlecenia'].value, 
                opis: zlecenieForm['opis-usterki'].value, 
                dataRozpoczecia: dataRozpoczecia, // NOWE
                dataZakonczenia: dataZakonczenia, // NOWE
                historia: historia, 
                createdAt: new Date() 
            };
        } else if (wybranyKlientId && wybranaMaszynaId) {
            const maszyna = wszystkieMaszyny.find(m => m.id === wybranaMaszynaId);
            dane = {
                maszynaId: wybranaMaszynaId, klientId: maszyna.klientId, klientNazwa: maszyna.klientNazwa,
                typMaszyny: maszyna.typMaszyny, model: maszyna.model, status: 'aktywne',
                nrZlecenia: zlecenieForm['nr-zlecenia'].value, opis: zlecenieForm['opis-usterki'].value,
                motogodziny: Number(zlecenieForm.motogodziny.value) || maszyna.motogodziny, 
                dataRozpoczecia: dataRozpoczecia, // NOWE
                dataZakonczenia: dataZakonczenia, // NOWE
                historia: historia, 
                createdAt: new Date()
            };
        } else {
            alert("Wybierz klienta i maszynę LUB opcję 'Szybkie Zlecenie'."); return;
        }
        try {
            await addDoc(collection(db, "zlecenia"), dane);
            if (dane.maszynaId && zlecenieForm.motogodziny.value) { await updateDoc(doc(db, "maszyny", dane.maszynaId), { motogodziny: dane.motogodziny }); }
            zlecenieForm.reset();
            zlecenieKlientSelect.value = '';
            zlecenieMaszynaSelect.innerHTML = '<option value="">-- Najpierw wybierz klienta --</option>';
            zlecenieMaszynaSelect.disabled = true;
        } catch (e) { console.error("Błąd dodawania zlecenia: ", e); }
    }
    
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
            const zlecenie = wszystkieZlecenia.find(z => z.id === docId);
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
                document.getElementById('modal-klient').textContent = `${zlecenie.klientNazwa} - ${zlecenie.typMaszyny} ${zlecenie.model}`;
                document.getElementById('modal-nr-zlecenia').textContent = zlecenie.nrZlecenia;
                document.getElementById('complete-zlecenie-id').value = docId;
                czesciDoZlecenia = [];
                renderCzesciDoZlecenia();
                renderMagazynWModalu();
                completeModal.style.display = 'block';
            }
        }
    }

    // --- ZMODYFIKOWANA FUNKCJA --- (otworzModalSzczegolowZlecenia) - Dodano daty
    async function otworzModalSzczegolowZlecenia(zlecenieId) {
        const zlecenie = wszystkieZlecenia.find(z => z.id === zlecenieId);
        if (!zlecenie) { alert("Nie znaleziono zlecenia!"); return; }

        document.getElementById('details-zlecenie-title').textContent = `Szczegóły Zlecenia #${zlecenie.nrZlecenia}`;
        
        const infoDiv = document.getElementById('details-zlecenie-info');
        infoDiv.innerHTML = `
            <div class="details-group"><strong>Klient:</strong> <p>${zlecenie.klientNazwa || '---'}</p></div>
            <div class="details-group"><strong>Maszyna:</strong> <p>${zlecenie.typMaszyny || ''} ${zlecenie.model || '---'}</p></div>
            <div class="details-group"><strong>Data Rozpoczęcia:</strong> <p>${zlecenie.dataRozpoczecia || 'Brak'}</p></div>
            <div class="details-group"><strong>Data Zakończenia:</strong> <p>${zlecenie.dataZakonczenia || 'Brak'}</p></div>
            <div class="details-group"><strong>Status:</strong> <p>${zlecenie.status}</p></div>
            <div class="details-group"><strong>Opis:</strong> <p>${zlecenie.opis || 'Brak opisu'}</p></div>
        `;
        
        if (zlecenie.status === 'ukończone') {
            infoDiv.innerHTML += `
                <div class="details-group"><strong>Data Faktycznego Zakończenia:</strong> <p>${zlecenie.dataUkonczenia}</p></div>
                <div class="details-group"><strong>Fakturowane Godziny:</strong> <p>${zlecenie.wyfakturowaneGodziny} h</p></div>
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
        } else {
            historiaDiv.innerHTML = '<p>Brak historii dla tego zlecenia.</p>';
        }

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
                const klient = wszystkieKlienci.find(k => k.id === klientId);
                const nowaMaszynaDoc = await addDoc(collection(db, "maszyny"), {
                    klientId: klientId, klientNazwa: klient.nazwa,
                    typMaszyny: nowaMaszynaTyp, model: nowaMaszynaModel, createdAt: new Date()
                });
                maszynaId = nowaMaszynaDoc.id;
            }
            if (!maszynaId) { alert("Musisz wybrać lub dodać maszynę."); return; }
            setTimeout(async () => {
                const maszyna = wszystkieMaszyny.find(m => m.id === maszynaId);
                if (!maszyna) { alert("Błąd: Nie znaleziono danych maszyny. Spróbuj ponownie."); return; }

                const zlecenieRef = doc(db, "zlecenia", zlecenieId);
                const zlecenieSnap = await getDoc(zlecenieRef);
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
            }, 700);
        } catch (error) { console.error("Błąd podczas przypisywania:", error); }
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

    // --- ZMODYFIKOWANA FUNKCJA --- (obslugaZakonczeniaZlecenia)
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
        } catch (error) { console.error("BŁĄD TRANSAKCJI: ", error); alert(`Wystąpił błąd: ${error}`); }
    }
    
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
    listaKlientowUl.addEventListener('click', obslugaListyKlientow);
    maszynaForm.addEventListener('submit', dodajMaszyne);
    listaMaszynUl.addEventListener('click', obslugaListyMaszyn);
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
        const dane = wszystkieZlecenia.filter(z => z.status === 'ukończone' && z.dataUkonczenia && z.dataUkonczenia.startsWith(miesiac))
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
    oilContainerSizeSelect.addEventListener('change', () => { converterLitryInput.value = ''; converterSztukiInput.value = ''; przeliczOlej({target:{id:''}}); });
  
    modalMagazynLista.addEventListener('click', dodajCzescDoZlecenia);
    partsToRemoveList.addEventListener('click', obslugaListyCzesci);
    zlecenieKlientSelect.addEventListener('change', (event) => {
        const wybranyKlientId = event.target.value;
        if (wybranyKlientId === "szybkie-zlecenie" || !wybranyKlientId) {
            zlecenieMaszynaSelect.disabled = true;
            zlecenieMaszynaSelect.innerHTML = `<option value="">${wybranyKlientId ? '-- N/A --' : '-- Najpierw wybierz klienta --'}</option>`;
        } else {
            const maszynyKlienta = wszystkieMaszyny.filter(m => m.klientId === wybranyKlientId);
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
        const maszynyKlienta = wszystkieMaszyny.filter(m => m.klientId === klientId);
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

    // --- NOWE LISTENERY ---
    zlecenieSearchInput.addEventListener('input', () => {
        wyswietlZlecenia(); 
    });

    editKlientForm.addEventListener('submit', zapiszEdycjeKlienta);
    editMaszynaForm.addEventListener('submit', zapiszEdycjeMaszyny);
    
    editKlientModal.querySelector('.close-button').onclick = () => { editKlientModal.style.display = 'none'; };
    editMaszynaModal.querySelector('.close-button').onclick = () => { editMaszynaModal.style.display = 'none'; };
    detailsZlecenieModal.querySelector('.close-button').onclick = () => { detailsZlecenieModal.style.display = 'none'; };

    window.onclick = (event) => { 
        if (event.target == completeModal || 
            event.target == stockModal || 
            event.target == kalendarzModal || 
            event.target == assignModal ||
            event.target == editKlientModal || 
            event.target == editMaszynaModal || 
            event.target == detailsZlecenieModal 
        ) { 
            event.target.style.display = "none"; 
        } 
    };

    // --- INICJALIZACJA ---
    inicjalizujKalendarz();
    wyswietlKlientow();
    wyswietlMaszyny();
    wyswietlPrzejazdy();
    wyswietlZlecenia(); // To wywoła też wyswietlWpisyKalendarza po załadowaniu zleceń
    wyswietlMagazyn();
}