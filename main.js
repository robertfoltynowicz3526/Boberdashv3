import { db } from './firebase-config.js';
import { collection, query, orderBy, onSnapshot, doc, deleteDoc, updateDoc, getDoc, runTransaction, addDoc, setDoc, where, getDocs } from "firebase/firestore"; // Dodano 'where' i 'getDocs'
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
    const listaKlientowDiv = document.getElementById('lista-klientow'); // Zmieniono z UL
    const maszynaKlientSelect = document.getElementById('maszyna-klient-select');
    const maszynaForm = document.getElementById('maszyna-form');
    const listaMaszynDiv = document.getElementById('lista-maszyn'); // Zmieniono z UL
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
    const klientSearchInput = document.getElementById('klient-search-input'); // NOWY
    const maszynaSearchInput = document.getElementById('maszyna-search-input'); // NOWY
    const listaKlientowHeader = document.getElementById('lista-klientow-header'); // NOWY
    const listaKlientowContent = document.getElementById('lista-klientow-content'); // NOWY
    const listaMaszynHeader = document.getElementById('lista-maszyn-header'); // NOWY
    const listaMaszynContent = document.getElementById('lista-maszyn-content'); // NOWY
    const editZlecenieModal = document.getElementById('edit-zlecenie-modal'); // NOWY
    const editZlecenieForm = document.getElementById('edit-zlecenie-form'); // NOWY
    
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
            eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false }, // Format czasu
            displayEventEnd: true, // Pokaż czas zakończenia jeśli jest
            // --- POPRAWIONA FUNKCJA --- (eventContent)
            eventContent: (arg) => {
                let eventEl = document.createElement('div');
                eventEl.innerHTML = `<div>${arg.event.title}</div>`; // Tytuł (godziny lub zlecenie)

                // Logika dla wpisów godzinowych (z przyciskami edycji/usuwania)
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

    // --- ZMODYFIKOWANA FUNKCJA --- (otworzModalGodzin)
    async function otworzModalGodzin(data) {
        kalendarzModalTitle.textContent = `Ewidencja Czasu - ${data}`;
        kalendarzForm.reset();
        document.getElementById('kalendarz-data').value = data;

        const zlecenieSelect = kalendarzForm['kalendarz-zlecenie-select'];
        zlecenieSelect.innerHTML = '<option value="">-- Brak --</option>'; 
        wszystkieZlecenia
            .filter(z => z.status === 'aktywne' || z.status === 'nieprzypisane')
            .forEach(z => {
                const nazwa = z.klientNazwa ? `${z.klientNazwa} (${z.model || z.nrZlecenia})` : z.nrZlecenia;
                const option = document.createElement('option');
                option.value = z.id;
                option.textContent = nazwa;
                option.dataset.klientNazwa = z.klientNazwa || nazwa; // Przechowaj nazwę klienta
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

    // --- ZMODYFIKOWANA FUNKCJA --- (obslugaZapisuGodzin) - Używa nazwy klienta
    async function obslugaZapisuGodzin(event) {
        event.preventDefault();
        const data = kalendarzForm['kalendarz-data'].value;
        const zlecenieSelect = kalendarzForm['kalendarz-zlecenie-select'];
        const zlecenieId = zlecenieSelect.value;
        // Pobierz nazwę klienta z atrybutu data-* wybranej opcji
        const klientNazwa = zlecenieId ? zlecenieSelect.options[zlecenieSelect.selectedIndex].dataset.klientNazwa : null;

        const dane = { 
            praca: Number(kalendarzForm['godziny-pracy'].value) || 0, 
            fakturowane: Number(kalendarzForm['godziny-fakturowane'].value) || 0, 
            nadgodziny: Number(kalendarzForm['nadgodziny'].value) || 0, 
            jazda: Number(kalendarzForm['czas-jazdy'].value) || 0, 
            notatka: kalendarzForm['kalendarz-notatka'].value || '',
            zlecenieId: zlecenieId || null, 
            klientNazwa: klientNazwa // Zapisz nazwę klienta
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
                    // Użyj zapisanej nazwy klienta, jeśli istnieje
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
            
            // 2. Dodaj zlecenia do listy wydarzeń (przywrócona logika)
            wszystkieZlecenia.forEach(zlecenie => {
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
        themeToggle.checked = (savedTheme === 'dark');
        themeToggle.addEventListener('change', () => {
            const newTheme = themeToggle.checked ? 'dark' : 'light';
            applyTheme(newTheme);
            localStorage.setItem('theme', newTheme);
        });
    }
    
    function applyTheme(theme) {
        document.body.dataset.theme = theme;
    }

    // --- POPRAWIONA FUNKCJA ZWIJANIA (dodano dla list klientów i maszyn) ---
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
    async function dodajKlienta(event) {
        event.preventDefault();
        const dane = { nazwa: klientForm['klient-nazwa'].value, nip: klientForm['klient-nip'].value || '---', adres: klientForm['klient-adres'].value || '---', telefon: klientForm['klient-telefon'].value || '---', createdAt: new Date() };
        try { await addDoc(collection(db, "klienci"), dane); klientForm.reset(); } catch (e) { console.error("Błąd dodawania klienta: ", e); }
    }

    // --- ZMODYFIKOWANA FUNKCJA --- (wyswietlKlientow) - Dodano wyszukiwarkę i maszyny/historię
    function wyswietlKlientow() {
        const frazaWyszukiwania = klientSearchInput.value.toLowerCase(); // NOWA
        onSnapshot(query(collection(db, "klienci"), orderBy("nazwa")), (snapshot) => {
            wszystkieKlienci = [];
            let klienciHtml = '', selectHtml = '<option value="">-- Wybierz klienta --</option>', selectZleceniaHtml = '<option value="">-- Wybierz klienta --</option><option value="szybkie-zlecenie">-- SZYBKIE ZLECENIE (bez klienta) --</option>';
            snapshot.forEach(doc => {
                const klient = { id: doc.id, ...doc.data() };
                wszystkieKlienci.push(klient);

                // NOWA logika wyszukiwania
                const tekstDoWyszukania = `${klient.nazwa} ${klient.nip} ${klient.adres} ${klient.telefon}`.toLowerCase();
                if (frazaWyszukiwania && !tekstDoWyszukania.includes(frazaWyszukiwania)) {
                    return; 
                }

                // Pobierz maszyny tego klienta
                const maszynyKlienta = wszystkieMaszyny.filter(m => m.klientId === klient.id);
                const maszynyListaHtml = maszynyKlienta.length > 0
                    ? `<ul class="client-machine-list">
                        ${maszynyKlienta.map(m => `<li>${m.typMaszyny} ${m.model} (S/N: ${m.nrSeryjny}) <a href="#" class="machine-history-link" data-maszyna-id="${m.id}" data-maszyna-nazwa="${m.typMaszyny} ${m.model}">Pokaż historię</a></li>`).join('')}
                       </ul>`
                    : '<p style="font-size: 0.8rem; margin-left: 15px; color: var(--text-color-light);">Brak maszyn</p>';

                klienciHtml += `
                    <div class="client-group" data-id="${klient.id}"> 
                        <div class="client-header-item"> <span><strong>${klient.nazwa}</strong> (NIP: ${klient.nip})<br><small>${klient.adres} | ${klient.telefon}</small></span>
                            <div><button class="btn-edit edit-klient-btn">Edytuj</button><button class="delete-btn">Usuń</button></div>
                        </div>
                        ${maszynyListaHtml}
                    </div>`;
                selectHtml += `<option value="${klient.id}">${klient.nazwa}</option>`;
                selectZleceniaHtml += `<option value="${klient.id}">${klient.nazwa}</option>`;
            });
            listaKlientowDiv.innerHTML = klienciHtml || "<p>Brak klientów w bazie.</p>"; // Zmieniono selektor
            maszynaKlientSelect.innerHTML = selectHtml;
            zlecenieKlientSelect.innerHTML = selectZleceniaHtml;
            document.getElementById('assign-klient-select').innerHTML = selectHtml;
        });
    }

    // --- ZMODYFIKOWANA FUNKCJA --- (obslugaListyKlientow) - Dodano obsługę linku historii
    async function obslugaListyKlientow(event) {
        const clientGroup = event.target.closest('.client-group'); if (!clientGroup) return;
        const klientId = clientGroup.dataset.id;

        // Obsługa linku historii maszyny
        if (event.target.classList.contains('machine-history-link')) {
            event.preventDefault();
            const maszynaId = event.target.dataset.maszynaId;
            const maszynaNazwa = event.target.dataset.maszynaNazwa;
            pokazHistorieSerwisowaMaszyny(maszynaId, maszynaNazwa);
            return; // Zakończ, aby nie obsłużyć innych przycisków
        }

        // Obsługa przycisków Edytuj/Usuń
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

    // --- NOWA FUNKCJA --- (pokazHistorieSerwisowaMaszyny) - Otwiera modal szczegółów zlecenia
    async function pokazHistorieSerwisowaMaszyny(maszynaId, maszynaNazwa) {
        // Ta funkcja na razie tylko wyświetli listę zakończonych zleceń w konsoli
        // Docelowo można by otworzyć dedykowany modal z historią
        console.log(`Pobieranie historii dla maszyny: ${maszynaNazwa} (ID: ${maszynaId})`);
        const q = query(collection(db, "zlecenia"), where("maszynaId", "==", maszynaId), where("status", "==", "ukończone"), orderBy("dataUkonczenia", "desc"));
        const querySnapshot = await getDocs(q);
        const historia = [];
        querySnapshot.forEach((doc) => {
            historia.push({ id: doc.id, ...doc.data() });
        });

        if (historia.length > 0) {
             // Przykład: Otwórz szczegóły pierwszego zlecenia z historii
             console.log("Znaleziono zlecenia:", historia);
             alert(`Znaleziono ${historia.length} zakończonych zleceń dla tej maszyny. Szczegóły pierwszego: Zlecenie #${historia[0].nrZlecenia}, Data: ${historia[0].dataUkonczenia}. Pełna lista w konsoli.`);
             otworzModalSzczegolowZlecenia(historia[0].id); // Otwórz modal dla pierwszego
        } else {
             alert(`Brak historii serwisowej (zakończonych zleceń) dla maszyny: ${maszynaNazwa}`);
        }
    }


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
            // TODO: Transakcja aktualizująca klientNazwa w maszynach i zleceniach
            editKlientModal.style.display = 'none';
        } catch (e) { console.error("Błąd aktualizacji klienta:", e); }
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

    // --- ZMODYFIKOWANA FUNKCJA --- (wyswietlMaszyny) - Dodano wyszukiwarkę i link historii
    function wyswietlMaszyny() {
        const frazaWyszukiwania = maszynaSearchInput.value.toLowerCase(); // NOWA
        onSnapshot(query(collection(db, "maszyny"), orderBy("klientNazwa")), (snapshot) => {
            wszystkieMaszyny = [];
            snapshot.forEach(doc => { wszystkieMaszyny.push({ id: doc.id, ...doc.data() }); });
  
            // Filtrowanie przed grupowaniem
            const przefiltrowaneMaszyny = wszystkieMaszyny.filter(maszyna => {
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
            listaMaszynDiv.innerHTML = maszynyHtml || "<p>Brak maszyn w bazie lub pasujących do wyszukiwania.</p>"; // Zmieniono selektor
            zlecenieKlientSelect.dispatchEvent(new Event('change')); // Aktualizuj select w zleceniach
        });
    }

    // --- ZMODYFIKOWANA FUNKCJA --- (obslugaListyMaszyn) - Dodano obsługę linku historii
    async function obslugaListyMaszyn(event) {
        const element = event.target;

        // Obsługa nagłówka klienta
        if (element.closest('.client-header')) {
            const header = element.closest('.client-header');
            header.classList.toggle('open');
            header.nextElementSibling.classList.toggle('open');
            return;
        }

        // Obsługa linku historii
        if (element.classList.contains('machine-history-link')) {
             event.preventDefault();
            const maszynaId = element.dataset.maszynaId;
            const maszynaNazwa = element.dataset.maszynaNazwa;
            pokazHistorieSerwisowaMaszyny(maszynaId, maszynaNazwa);
            return;
        }

        // Obsługa przycisków Edytuj/Usuń
        const li = element.closest('li'); if (!li) return;
        const maszynaId = li.dataset.id;
        if (element.classList.contains('delete-btn')) { 
            if (confirm("Usunięcie maszyny usunie też jej zlecenia. Kontynuować?")) { 
                // TODO: Transakcja usuwająca zlecenia
                await deleteDoc(doc(db, "maszyny", maszynaId)); 
            } 
        }
        if (element.classList.contains('edit-maszyna-btn')) {
            otworzModalEdycjiMaszyny(maszynaId);
        }
    }

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
            // TODO: Transakcja aktualizująca dane maszyny w zleceniach
            editMaszynaModal.style.display = 'none';
        } catch (e) { console.error("Błąd aktualizacji maszyny:", e); }
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
                } else { // Zakończone
                    const nazwaMaszyny = zlecenie.klientNazwa ? `${zlecenie.klientNazwa} - ${zlecenie.typMaszyny} ${zlecenie.model}` : 'Zlecenie usuniętej maszyny';
                    const uzyteCzesciHtml = zlecenie.uzyteCzesci?.length > 0 ? `<br><small>Użyto: ${zlecenie.uzyteCzesci.map(c => `${c.nazwa} (x${c.ilosc})`).join(', ')}</small>` : '';
                    // NOWY Przycisk Edytuj dla zakończonych
                    ukonczoneHtml += `<li data-id="${zlecenie.id}"><span><strong>${nazwaMaszyny}</strong> (Nr: ${zlecenie.nrZlecenia})<br><em>Ukończono (${zlecenie.dataUkonczenia||'b.d.'})</em><br>Fakturowano: <strong>${zlecenie.wyfakturowaneGodziny||0}h</strong> | Typ: <strong>${zlecenie.typZlecenia||'?'}</strong>${uzyteCzesciHtml}</span><div><button class="btn-details details-zlecenie-btn">Szczegóły</button><button class="btn-edit edit-zlecenie-btn">Edytuj</button><button class="delete-btn">Usuń</button></div></li>`;
                }
            });
            aktywneZleceniaLista.innerHTML = aktywneHtml ? `<ul>${aktywneHtml}</ul>` : "<p>Brak aktywnych zleceň.</p>";
            ukonczoneZleceniaLista.innerHTML = ukonczoneHtml ? `<ul>${ukonczoneHtml}</ul>` : "<p>Brak ukończonych zleceň.</p>";
            obliczIPokazPodsumowanieFinansowe();
            wyswietlWpisyKalendarza(); 
        });
    }
    
    async function dodajZlecenie(event) {
        event.preventDefault();
        const wybranyKlientId = zlecenieKlientSelect.value;
        const wybranaMaszynaId = zlecenieMaszynaSelect.value;
        const dataRozpoczecia = zlecenieForm['zlecenie-data-start'].value || null; 
        const dataZakonczenia = zlecenieForm['zlecenie-data-koniec'].value || null; 

        if (dataZakonczenia && !dataRozpoczecia) { alert("Nie można podać daty zakończenia bez daty rozpoczęcia."); return; }
        if (dataRozpoczecia && dataZakonczenia && dataZakonczenia < dataRozpoczecia) { alert("Data zakończenia nie może być wcześniejsza niż data rozpoczęcia."); return; }

        const historia = [{ timestamp: new Date().toISOString(), akcja: "Utworzono zlecenie" }];

        let dane;
        if (wybranyKlientId === "szybkie-zlecenie") {
            dane = { status: 'nieprzypisane', nrZlecenia: zlecenieForm['nr-zlecenia'].value, opis: zlecenieForm['opis-usterki'].value, dataRozpoczecia: dataRozpoczecia, dataZakonczenia: dataZakonczenia, historia: historia, createdAt: new Date() };
        } else if (wybranyKlientId && wybranaMaszynaId) {
            const maszyna = wszystkieMaszyny.find(m => m.id === wybranaMaszynaId);
            dane = {
                maszynaId: wybranaMaszynaId, klientId: maszyna.klientId, klientNazwa: maszyna.klientNazwa,
                typMaszyny: maszyna.typMaszyny, model: maszyna.model, status: 'aktywne',
                nrZlecenia: zlecenieForm['nr-zlecenia'].value, opis: zlecenieForm['opis-usterki'].value,
                motogodziny: Number(zlecenieForm.motogodziny.value) || maszyna.motogodziny, 
                dataRozpoczecia: dataRozpoczecia, dataZakonczenia: dataZakonczenia, historia: historia, 
                createdAt: new Date()
            };
        } else { alert("Wybierz klienta i maszynę LUB opcję 'Szybkie Zlecenie'."); return; }
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
    
    // --- ZMODYFIKOWANA FUNKCJA --- (obslugaListyZlecen) - Dodano obsługę edycji zakończonego
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
                // ... (reszta kodu bez zmian) ...
                assignModal.style.display = 'block';
            }
        }
        if (event.target.classList.contains('complete-btn')) {
            const docSnap = await getDoc(doc(db, "zlecenia", docId));
            if (docSnap.exists()) {
                // ... (reszta kodu bez zmian) ...
                completeModal.style.display = 'block';
            }
        }
        // NOWA: Obsługa edycji zakończonego zlecenia
        if (event.target.classList.contains('edit-zlecenie-btn')) {
             const zlecenie = wszystkieZlecenia.find(z => z.id === docId);
             // Sprawdźmy, czy na pewno jest zakończone (chociaż przycisk jest tylko przy zakończonych)
             if (zlecenie && zlecenie.status === 'ukończone') {
                 otworzModalEdycjiZlecenia(docId);
             } else if (zlecenie) {
                 alert("Można edytować tylko zakończone zlecenia.");
             }
        }
    }

    // --- NOWA FUNKCJA --- (otworzModalEdycjiZlecenia)
    function otworzModalEdycjiZlecenia(zlecenieId) {
        const zlecenie = wszystkieZlecenia.find(z => z.id === zlecenieId);
        if (!zlecenie) return;

        editZlecenieForm['edit-zlecenie-id'].value = zlecenie.id;
        document.getElementById('edit-zlecenie-klient').textContent = `${zlecenie.klientNazwa} - ${zlecenie.typMaszyny} ${zlecenie.model}`;
        document.getElementById('edit-zlecenie-nr').textContent = zlecenie.nrZlecenia;
        editZlecenieForm['edit-wyfakturowane-godziny'].value = zlecenie.wyfakturowaneGodziny || 0;
        editZlecenieForm['edit-typ-zlecenia'].value = zlecenie.typZlecenia || 'S'; // Domyślnie S, jeśli brak

        editZlecenieModal.style.display = 'block';
    }

    // --- NOWA FUNKCJA --- (zapiszEdycjeZlecenia)
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
            const wpisHistorii = `Edytowano zakończone zlecenie: Godziny zmieniono z ${stareGodziny} na ${noweGodziny}. Typ zmieniono z ${staryTyp} na ${nowyTyp}.`;
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
            alert("Wystąpił błąd podczas zapisywania zmian.");
        }
    }


    // --- ZMODYFIKOWANA FUNKCJA --- (otworzModalSzczegolowZlecenia) - Dodano wpisy kalendarza
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
        
        if (zlecenie.status === 'ukończone') { /* ... (reszta bez zmian) ... */ }

        const historiaDiv = document.getElementById('details-zlecenie-historia');
        if (zlecenie.historia && zlecenie.historia.length > 0) { /* ... (reszta bez zmian) ... */ } 
        else { historiaDiv.innerHTML = '<p>Brak historii dla tego zlecenia.</p>'; }

        // NOWA: Załaduj powiązane wpisy z kalendarza
        const kalendarzDiv = document.getElementById('details-zlecenie-kalendarz');
        kalendarzDiv.innerHTML = '<p>Ładowanie wpisów z kalendarza...</p>';
        const qKalendarz = query(collection(db, "godziny_pracy"), where("zlecenieId", "==", zlecenieId), orderBy("id", "desc")); // 'id' to data
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
    
    async function zapiszPrzypisanie(event) { /* ... (bez zmian) ... */ }
    
    function renderMagazynWModalu() { /* ... (bez zmian) ... */ }
    function dodajCzescDoZlecenia(event) { /* ... (bez zmian) ... */ }
    function renderCzesciDoZlecenia() { /* ... (bez zmian) ... */ }
    async function obslugaListyCzesci(event) { /* ... (bez zmian) ... */ }
    async function obslugaZakonczeniaZlecenia(event) { /* ... (bez zmian - historia dodawana poprawnie) ... */ }
    
    // --- MAGAZYN --- (bez zmian w funkcjach magazynu)
    async function dodajProduktDoMagazynu(event) { /* ... */ }
    async function dodajMasowo(event) { /* ... */ }
    async function dodajOlej() { /* ... */ }
    function przeliczOlej(event) { /* ... */ }
    async function obslugaTabeliMagazynu(event) { /* ... */ }
    async function obslugaZmianyStanu(event) { /* ... */ }
    function wyswietlMagazyn() { /* ... */ }
    
    // --- PODPIĘCIE EVENTÓW ---
    klientForm.addEventListener('submit', dodajKlienta);
    listaKlientowDiv.addEventListener('click', obslugaListyKlientow); // Zmieniono selektor
    maszynaForm.addEventListener('submit', dodajMaszyne);
    listaMaszynDiv.addEventListener('click', obslugaListyMaszyn); // Zmieniono selektor
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
    oilContainerSizeSelect.addEventListener('change', () => { /* ... */ });
  
    modalMagazynLista.addEventListener('click', dodajCzescDoZlecenia);
    partsToRemoveList.addEventListener('click', obslugaListyCzesci);
    zlecenieKlientSelect.addEventListener('change', (event) => { /* ... (bez zmian) ... */ });
    assignForm.addEventListener('submit', zapiszPrzypisanie);
    assignModal.querySelector('.close-button').onclick = () => { assignModal.style.display = 'none'; };
    document.getElementById('assign-klient-select').addEventListener('change', (event) => { /* ... (bez zmian) ... */ });
    kalendarzForm.addEventListener('submit', obslugaZapisuGodzin);
    kalendarzContainer.addEventListener('click', obslugaKalendarza);
    kalendarzModal.querySelector('.close-button').onclick = () => { kalendarzModal.style.display = 'none'; };

    // --- NOWE LISTENERY ---
    klientSearchInput.addEventListener('input', wyswietlKlientow); // Wyszukiwarka klientów
    maszynaSearchInput.addEventListener('input', wyswietlMaszyny); // Wyszukiwarka maszyn
    zlecenieSearchInput.addEventListener('input', wyswietlZlecenia); 

    editKlientForm.addEventListener('submit', zapiszEdycjeKlienta);
    editMaszynaForm.addEventListener('submit', zapiszEdycjeMaszyny);
    editZlecenieForm.addEventListener('submit', zapiszEdycjeZlecenia); // NOWY listener
    
    editKlientModal.querySelector('.close-button').onclick = () => { editKlientModal.style.display = 'none'; };
    editMaszynaModal.querySelector('.close-button').onclick = () => { editMaszynaModal.style.display = 'none'; };
    detailsZlecenieModal.querySelector('.close-button').onclick = () => { detailsZlecenieModal.style.display = 'none'; };
    editZlecenieModal.querySelector('.close-button').onclick = () => { editZlecenieModal.style.display = 'none'; }; // NOWY

    window.onclick = (event) => { 
        if (event.target == completeModal || 
            event.target == stockModal || 
            event.target == kalendarzModal || 
            event.target == assignModal ||
            event.target == editKlientModal || 
            event.target == editMaszynaModal || 
            event.target == detailsZlecenieModal ||
            event.target == editZlecenieModal // NOWY
        ) { 
            event.target.style.display = "none"; 
        } 
    };

    // --- INICJALIZACJA ---
    inicjalizujKalendarz();
    wyswietlKlientow();
    wyswietlMaszyny();
    wyswietlPrzejazdy();
    wyswietlZlecenia(); 
    wyswietlMagazyn();
}