import { db } from './firebase-config.js';
import { collection, query, orderBy, onSnapshot, doc, deleteDoc, updateDoc, getDoc, runTransaction, addDoc, setDoc, where, getDocs } from "firebase/firestore";
import Papa from 'papaparse';

function getClosest(evt, selector) {
    const t = evt?.target ?? evt?.srcElement;
    if (!t || !(t instanceof Element)) {
        return null;
    }
    return t.closest(selector);
}

function openTab(evt, tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById(tabName)?.classList.add('active');
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    evt?.currentTarget?.classList?.add('active');
}

window.openTab = openTab;

async function initializeApp() {
    // --- STAŁE I ZMIENNE GLOBALNE ---
    const STAWKI = {
        S: { nazwa: "Wyjazdowe", stawka: 45 },
        W: { nazwa: "Warsztat",  stawka: 35 },
        G: { nazwa: "Gwarancja", stawka: 35 },
        Z: { nazwa: "Zbrojenie", stawka: 30 },
        P: { nazwa: "Poprawka",  stawka: 0  }
    };
    const utworzPustyRekordMiesieczny = () => ({
        praca: 0,
        nadgodziny: 0,
        jazda: 0,
        wyfakturowaneGodziny: 0,
        brutto: 0,
        netto: 0,
        absorpcja: 0
    });
    let wszystkieZlecenia = [], wszystkieProdukty = [], wszystkiePrzejazdy = [],
        czesciDoZlecenia = [], wszystkieMaszyny = [], wszystkieKlienci = [], wszystkieWpisyKalendarza = [];
    let ostatnieZestawienieMiesieczne = {
        miesiace: [],
        sumyRoczne: utworzPustyRekordMiesieczny(),
        sumyRocznePerRok: [],
        lata: []
    };
    let _wszystkieKlienciCache = [], _wszystkieMaszynyCache = [], _wszystkieZleceniaCache = []; // Cache z Firebase
    const NISKI_STAN_MAGAZYNOWY = 5;
    let calendar;
    let edytowanyPrzejazdId = null;
    let stockChangeOperation = null;
    let multiZlecenia = [];
    let multiEdytowanyIndex = null;
    let manualFakturowaneValue = 0;
    let bodyOverflowBeforeModal = document.body.style.overflow || '';

    const focusTrapState = new WeakMap();
    const focusableSelectors = [
        'a[href]',
        'button:not([disabled])',
        'textarea:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        '[tabindex]:not([tabindex="-1"])'
    ].join(',');

    const getFocusableElements = (container) => {
        if (!container) {
            return [];
        }
        return Array.from(container.querySelectorAll(focusableSelectors))
            .filter((el) => el instanceof HTMLElement && el.tabIndex !== -1 && el.getAttribute('aria-hidden') !== 'true');
    };

    const activateFocusTrap = (modal) => {
        if (!(modal instanceof HTMLElement)) {
            return;
        }
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const handleKeyDown = (event) => {
            if (event.key !== 'Tab') {
                return;
            }
            const focusable = getFocusableElements(modal);
            if (focusable.length === 0) {
                event.preventDefault();
                modal.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            if (event.shiftKey) {
                if (active === first || !modal.contains(active)) {
                    event.preventDefault();
                    last.focus();
                }
            } else if (active === last) {
                event.preventDefault();
                first.focus();
            }
        };

        modal.addEventListener('keydown', handleKeyDown);
        focusTrapState.set(modal, { handleKeyDown, previousFocus });

        const focusable = getFocusableElements(modal);
        const focusTarget = focusable[0] || modal.querySelector('.close-button');
        if (focusTarget instanceof HTMLElement) {
            focusTarget.focus();
        } else {
            modal.setAttribute('tabindex', '-1');
            modal.focus();
        }
    };

    const deactivateFocusTrap = (modal) => {
        const state = focusTrapState.get(modal);
        if (state) {
            modal.removeEventListener('keydown', state.handleKeyDown);
            const { previousFocus } = state;
            if (previousFocus && document.contains(previousFocus)) {
                previousFocus.focus();
            }
            focusTrapState.delete(modal);
        }
        if (modal instanceof HTMLElement && modal.hasAttribute('tabindex')) {
            modal.removeAttribute('tabindex');
        }
    };

    const getEl = (id) => document.getElementById(id);

    // --- SELEKTORY ---
    const miesiacSummaryInput = getEl('miesiac-summary');
    const zakonczoneMiesiacInput = getEl('zakonczone-miesiac');
    const zlecenieKlientSelect = getEl('zlecenie-klient-select');
    const zlecenieKlientFilterInput = getEl('zlecenie-klient-filter');
    const zlecenieMaszynaSelect = getEl('zlecenie-maszyna-select');
    const kalendarzContainer = getEl('kalendarz');
    if (!kalendarzContainer) {
        console.warn('Brak #kalendarz');
    }
    const kalendarzModal = getEl('kalendarz-modal');
    const kalendarzForm = getEl('kalendarz-form');
    const kalendarzModalTitle = getEl('kalendarz-modal-title');
    const kalendarzModalCloseButton = kalendarzModal ? kalendarzModal.querySelector('.close-button') : null;
    const kalendarzPodsumowanieDiv = document.getElementById('kalendarz-podsumowanie');
    const assignModal = getEl('assign-zlecenie-modal');
    const assignForm = getEl('assign-zlecenie-form');
    const assignKlientSelect = getEl('assign-klient-select');
    const assignMaszynaSelect = getEl('assign-maszyna-select');
    const klientForm = getEl('klient-form');
    const listaKlientowDiv = getEl('lista-klientow');
    if (!listaKlientowDiv) {
        console.warn('Brak #lista-klientow');
    }
    const maszynaKlientSelect = getEl('maszyna-klient-select');
    const maszynaForm = getEl('maszyna-form');
    const listaMaszynDiv = getEl('lista-maszyn');
    if (!listaMaszynDiv) {
        console.warn('Brak #lista-maszyn');
    }
    const zlecenieForm = getEl('zlecenie-form');
    const aktywneZleceniaLista = getEl('aktywne-zlecenia-lista');
    if (!aktywneZleceniaLista) {
        console.warn('Brak #aktywne-zlecenia-lista');
    }
    const ukonczoneZleceniaLista = getEl('ukonczone-zlecenia-lista');
    if (!ukonczoneZleceniaLista) {
        console.warn('Brak #ukonczone-zlecenia-lista');
    }
    const completeModal = document.getElementById('complete-zlecenie-modal');
    const completeModalForm = document.getElementById('complete-zlecenie-form');
    const closeModalButton = completeModal ? completeModal.querySelector('.close-button') : null;
    const zakonczoneTopSummary = document.getElementById('zakonczone-top-summary');
    const zakonczoneMonthSummary = document.getElementById('zakonczone-month-summary');
    const finishedMiniSummary = document.getElementById('finished-mini-summary');
    const annualSummaryContainer = document.getElementById('annual-summary');
    const modalMagazynLista = document.getElementById('modal-magazyn-lista');
    const partsToRemoveList = document.getElementById('parts-to-remove-list');
    const magazynForm = document.getElementById('magazyn-form');
    const magazynLista = document.getElementById('magazyn-lista');
    const magazynMetricsContainer = document.getElementById('magazyn-metrics');
    const bulkAddForm = document.getElementById('bulk-add-form');
    const stockModal = document.getElementById('stock-change-modal');
    const stockModalForm = document.getElementById('stock-change-form');
    const stockModalCloseButton = stockModal ? stockModal.querySelector('.close-button') : null;
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
    const kalendarzMultiWrapper = document.getElementById('kalendarz-zlecenia-multi');
    const kalendarzMultiSelect = kalendarzMultiWrapper ? kalendarzMultiWrapper.querySelector('.multi-zlecenie-select') : null;
    const kalendarzMultiHoursInput = kalendarzMultiWrapper ? kalendarzMultiWrapper.querySelector('.multi-zlecenie-fh') : null;
    const kalendarzMultiAddButton = kalendarzMultiWrapper ? kalendarzMultiWrapper.querySelector('.multi-add') : null;
    const kalendarzMultiList = document.getElementById('kalendarz-zlecenia-list');
    const dashboardNoweZlecenia = document.getElementById('kpi-nowe-zlecenia-value');
    const dashboardOtwarteZlecenia = document.getElementById('kpi-otwarte-zlecenia-value');
    const dashboardWyfakturowane = document.getElementById('kpi-hours-month-value');
    const dashboardWyfakturowaneZmiana = document.getElementById('kpi-hours-change-value');
    const dashboardAbsorpcja = document.getElementById('kpi-absorpcja-value');
    const weekPracaValue = document.getElementById('week-praca-value');
    const weekJazdaValue = document.getElementById('week-jazda-value');
    const weekNadgodzinyValue = document.getElementById('week-nadgodziny-value');
    const hoursChartContainer = document.getElementById('hours-chart');
    const calendarAbsorpcjaTag = document.getElementById('calendar-absorpcja');
    const podsumowaniaMetryki = document.getElementById('podsumowania-metryki');
    const isPodsumowaniaViewMounted = () => Boolean(document.getElementById('podsumowania-view'))
    const editKlientModal = document.getElementById('edit-klient-modal');
    const editKlientForm = document.getElementById('edit-klient-form');
    const editMaszynaModal = document.getElementById('edit-maszyna-modal');
    const editMaszynaForm = document.getElementById('edit-maszyna-form');
    const detailsZlecenieModal = document.getElementById('details-zlecenie-modal');
    const editKlientCloseButton = editKlientModal ? editKlientModal.querySelector('.close-button') : null;
    const editMaszynaCloseButton = editMaszynaModal ? editMaszynaModal.querySelector('.close-button') : null;
    const detailsZlecenieCloseButton = detailsZlecenieModal ? detailsZlecenieModal.querySelector('.close-button') : null;
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
    const manualCloseDateInput = document.getElementById('manual-close-date');
    const editZlecenieCloseButton = editZlecenieModal ? editZlecenieModal.querySelector('.close-button') : null;
    const machineHistoryCloseButton = machineHistoryModal ? machineHistoryModal.querySelector('.close-button') : null;

    function warnIfMissing(element, label) {
        if (!element) {
            console.warn(`[UI] Element ${label} nie istnieje w DOM.`);
        }
        return element;
    }

    function addListenerSafely(element, eventName, handler, label) {
        if (element) {
            element.addEventListener(eventName, handler);
        } else {
            console.warn(`[UI] Pominięto nasłuch (${label}) – element nie istnieje w DOM.`);
        }
    }

    const modalsToCheck = [
        ['#kalendarz-modal', kalendarzModal],
        ['#assign-zlecenie-modal', assignModal],
        ['#complete-zlecenie-modal', completeModal],
        ['#stock-change-modal', stockModal],
        ['#edit-klient-modal', editKlientModal],
        ['#edit-maszyna-modal', editMaszynaModal],
        ['#details-zlecenie-modal', detailsZlecenieModal],
        ['#edit-zlecenie-modal', editZlecenieModal],
        ['#machine-history-modal', machineHistoryModal]
    ];
    modalsToCheck.forEach(([label, element]) => warnIfMissing(element, label));

    let hasWarnedAboutDb = false;
    const ensureDb = () => {
        if (db) {
            return true;
        }
        if (!hasWarnedAboutDb) {
            console.error('[Firebase] Brak połączenia z Firestore – akcja została pominięta.');
            hasWarnedAboutDb = true;
        }
        return false;
    };

    function openModal(modal) {
        if (!(modal instanceof HTMLElement)) {
            return;
        }
        if (!document.body.classList.contains('modal-open')) {
            bodyOverflowBeforeModal = document.body.style.overflow || '';
        }
        modal.style.display = 'block';
        modal.style.setProperty('display', 'flex', 'important');
        modal.classList.add('open');
        document.body.classList.add('modal-open');
        document.body.style.overflow = 'hidden';
        activateFocusTrap(modal);
    }

    function closeModal(modal) {
        if (!(modal instanceof HTMLElement)) {
            return;
        }
        modal.classList.remove('open');
        modal.style.setProperty('display', 'none', 'important');
        deactivateFocusTrap(modal);
        if (!document.querySelector('.modal.open')) {
            document.body.classList.remove('modal-open');
            document.body.style.overflow = bodyOverflowBeforeModal;
        }
    }

    const ensureDbOrNotify = () => {
        if (ensureDb()) {
            return true;
        }
        alert('Brak połączenia z bazą danych. Operacja nie może zostać wykonana.');
        return false;
    };

    const getCurrentMonthString = () => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    };

    const getCurrentDateString = () => new Date().toISOString().split('T')[0];

    // --- INICJALIZACJA UI / TABS / MOTYW ---
    document.querySelectorAll('#sidebar .tab-button').forEach(button => {
        button.addEventListener('click', (event) => {
            if (button.dataset.tab) {
                setActiveTab(button.dataset.tab, event);
            }
        });
    });

    function setActiveTab(tabName, evt) {
        if (!tabName) {
            return;
        }
        const tabElement = document.getElementById(tabName);
        if (!tabElement) {
            console.warn(`[UI] Zakładka ${tabName} nie istnieje w DOM.`);
        }
        document.querySelectorAll('.tab-content').forEach((tab) => {
            tab.classList.toggle('active', tab === tabElement);
        });
        document.querySelectorAll('.tab-button').forEach((button) => {
            button.classList.toggle('active', button.dataset.tab === tabName);
        });
         evt?.currentTarget?.classList?.add('active');
    }
    const currentMonth = getCurrentMonthString();
    if (miesiacSummaryInput && !miesiacSummaryInput.value) {
        miesiacSummaryInput.value = currentMonth;
    }
    if (zakonczoneMiesiacInput && !zakonczoneMiesiacInput.value) {
        zakonczoneMiesiacInput.value = currentMonth;
    }
    if (miesiacSummaryInput) {
        miesiacSummaryInput.max = currentMonth;
    }
    if (zakonczoneMiesiacInput) {
        zakonczoneMiesiacInput.max = currentMonth;
    }
    synchronizujWyborMiesiaca(pobierzWartoscMiesiaca(miesiacSummaryInput || zakonczoneMiesiacInput));
    if (manualCloseDateInput) {
        manualCloseDateInput.value = getCurrentDateString();
    }
    const firstTabButton = document.querySelector('.tab-button');
    firstTabButton?.click();
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
        const calendarElement = document.getElementById('kalendarz');
        const CalendarCtor = window.FullCalendar?.Calendar;
        if (!calendarElement) {
            console.warn('Pominięto inicjalizację kalendarza – brak kontenera #kalendarz.');
            return;
        }
        if (!CalendarCtor) {
            console.error('FullCalendar nie został załadowany.');
            return;
        }
        calendar = new CalendarCtor(calendarElement, {
            initialView: 'dayGridMonth',
            headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth' },
            eventContent: (arg) => {
                const container = document.createElement('div');
                container.classList.add('fc-event-inner');
                const linie = Array.isArray(arg.event.extendedProps.linie) ? arg.event.extendedProps.linie : [];
                const powiazane = Array.isArray(arg.event.extendedProps.powiazaneLinie) ? arg.event.extendedProps.powiazaneLinie : [];

                if (arg.event.extendedProps.type === 'godziny_pracy') {
                    const icon = document.createElement('span');
                    icon.classList.add('event-icon');
                    icon.textContent = '📝';
                    container.appendChild(icon);
                }

                if (linie.length > 0) {
                    linie.forEach(tekst => {
                        const linia = document.createElement('div');
                        linia.textContent = tekst;
                        container.appendChild(linia);
                    });
                } else {
                    const fallback = document.createElement('div');
                    fallback.textContent = arg.event.title || '';
                    container.appendChild(fallback);
                }

                if (powiazane.length > 0) {
                    const separator = document.createElement('hr');
                    separator.style.margin = '4px 0';
                    separator.style.borderColor = 'rgba(255,255,255,0.35)';
                    container.appendChild(separator);
                    powiazane.forEach(tekst => {
                        const linia = document.createElement('div');
                        linia.textContent = tekst;
                        container.appendChild(linia);
                    });
                }
                if (arg.event.extendedProps.type === 'godziny_pracy') {
                    if (arg.event.extendedProps.notatka) {
                     const note = document.createElement('div');
                        note.textContent = `Notatka: ${arg.event.extendedProps.notatka}`;
                        note.classList.add('event-note');
                        container.appendChild(note);   
                    }
                    const actionsEl = document.createElement('div');
                    actionsEl.classList.add('event-actions');
                    const editBtn = document.createElement('button');
                    editBtn.type = 'button';
                    editBtn.className = 'btn-edit event-edit-btn';
                    editBtn.dataset.date = arg.event.startStr;
                    editBtn.textContent = 'E';
                    const deleteBtn = document.createElement('button');
                    deleteBtn.type = 'button';
                    deleteBtn.className = 'btn-remove event-delete-btn';
                    deleteBtn.dataset.date = arg.event.startStr;
                    deleteBtn.textContent = 'X';
                    actionsEl.appendChild(editBtn);
                    actionsEl.appendChild(deleteBtn);
                    container.appendChild(actionsEl);
                }
                return { domNodes: [container] };
            },
            dateClick: (info) => otworzModalGodzin(info.dateStr),
            datesSet: (view) => { obliczSumeGodzinZKalendarza(view.view.currentStart, view.view.currentEnd); }
        });
        calendar.render();
    }

    async function otworzModalGodzin(data) {
        if (!kalendarzForm || !kalendarzModal || !kalendarzModalTitle) return;
        kalendarzModalTitle.textContent = `Ewidencja Czasu - ${data}`;
        kalendarzForm.reset();
        const kalendarzDataInput = document.getElementById('kalendarz-data');
        if (kalendarzDataInput) kalendarzDataInput.value = data;

        multiZlecenia = [];
        multiEdytowanyIndex = null;
        manualFakturowaneValue = 0;
        przygotujOpcjeMultiZlecen();
        resetujFormularzMulti();
        renderMultiZlecenia();


        if (ensureDb()) {
            const docRef = doc(db, "godziny_pracy", data);
            try {
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const dane = docSnap.data();
                    kalendarzForm['godziny-pracy'].value = dane.praca || 0;
                    kalendarzForm['nadgodziny'].value = dane.nadgodziny || 0;
                    kalendarzForm['czas-jazdy'].value = dane.jazda || 0;
                    kalendarzForm['kalendarz-notatka'].value = dane.notatka || '';
                    manualFakturowaneValue = Number(dane.fakturowane) || 0;
                    const { powiazane, suma, maPowiazania } = normalizujPowiazaneZlecenia(dane);
                    multiZlecenia = powiazane;
                    if (maPowiazania) {
                        manualFakturowaneValue = suma;
                    }
                    renderMultiZlecenia();
                    if (kalendarzForm['godziny-fakturowane'] && !maPowiazania) {
                        aktualizujPoleFakturowane(manualFakturowaneValue, false);
                    }
                }
            } catch (error) {
                console.error("Błąd podczas pobierania danych ewidencji:", error);               
            }
        }
        openModal(kalendarzModal);
    }

    function przygotujOpcjeMultiZlecen() {
        if (!kalendarzMultiSelect) return;
        kalendarzMultiSelect.innerHTML = '<option value="">-- Wybierz zlecenie --</option>';
        _wszystkieZleceniaCache
            .filter(z => z && (z.status === 'aktywne' || z.status === 'nieprzypisane'))
            .sort((a, b) => (a.klientNazwa || a.nrZlecenia || '').localeCompare(b.klientNazwa || b.nrZlecenia || ''))
            .forEach(z => {
                const label = pobierzNazweZlecenia(z);
                const option = document.createElement('option');
                option.value = z.id;
                option.textContent = label;
                option.dataset.klientNazwa = z.klientNazwa || label;
                kalendarzMultiSelect.appendChild(option);
            });
        zapewnijOpcjePowiazanych();
    }

    function resetujFormularzMulti() {
        multiEdytowanyIndex = null;
        if (kalendarzMultiSelect) kalendarzMultiSelect.value = '';
        if (kalendarzMultiHoursInput) kalendarzMultiHoursInput.value = '';
        if (kalendarzMultiAddButton) kalendarzMultiAddButton.textContent = 'Dodaj kolejne zlecenie';
    }

    function aktualizujPoleFakturowane(wartosc, tylkoOdczyt = false) {
        if (!kalendarzForm || !kalendarzForm['godziny-fakturowane']) return;
        const liczba = Number(wartosc) || 0;
        kalendarzForm['godziny-fakturowane'].value = liczba.toFixed(2);
        kalendarzForm['godziny-fakturowane'].readOnly = Boolean(tylkoOdczyt);
    }

    function renderMultiZlecenia() {
        if (!kalendarzMultiList) return;
        zapewnijOpcjePowiazanych();
        const itemsHtml = multiZlecenia.length
            ? multiZlecenia.map((pozycja, index) => {
                const nazwa = pozycja.klientNazwa || pobierzNazwePowiazania(pozycja.zlecenieId);
                return `<li data-index="${index}">
                    <span>F: <strong>${formatujLiczbe(pozycja.fakturowane)}</strong> h — ${nazwa || pozycja.zlecenieId}</span>
                    <div class="actions">
                        <button type="button" class="btn-edit multi-edit">Edytuj</button>
                        <button type="button" class="btn-remove multi-remove">Usuń</button>
                    </div>
                </li>`;
            }).join('')
            : '<li class="empty">Brak powiązanych zleceń.</li>';
        kalendarzMultiList.innerHTML = itemsHtml;
        const suma = multiZlecenia.reduce((acc, el) => acc + (Number(el.fakturowane) || 0), 0);
        if (multiZlecenia.length > 0) {
            manualFakturowaneValue = suma;
            aktualizujPoleFakturowane(suma, true);
        } else {
            aktualizujPoleFakturowane(manualFakturowaneValue, false);
        }
    }

    function zapewnijOpcjePowiazanych() {
        if (!kalendarzMultiSelect) return;
        const istniejące = new Set(Array.from(kalendarzMultiSelect.options).map(opt => opt.value));
        multiZlecenia.forEach(pozycja => {
            if (!pozycja?.zlecenieId || istniejące.has(pozycja.zlecenieId)) return;
            const label = pozycja.klientNazwa || pobierzNazwePowiazania(pozycja.zlecenieId);
            const option = document.createElement('option');
            option.value = pozycja.zlecenieId;
            option.textContent = label || pozycja.zlecenieId;
            option.dataset.klientNazwa = label || pozycja.zlecenieId;
            kalendarzMultiSelect.appendChild(option);
            istniejące.add(pozycja.zlecenieId);
        });
    }

    function dodajLubZapiszMultiZlecenie() {
        if (!kalendarzMultiSelect || !kalendarzMultiHoursInput) return;
        const zlecenieId = kalendarzMultiSelect.value;
        const godziny = Number(kalendarzMultiHoursInput.value);
        if (!zlecenieId) {
            alert('Wybierz zlecenie do powiązania.');
            return;
        }
        if (!Number.isFinite(godziny) || godziny <= 0) {
            alert('Podaj dodatnią liczbę godzin.');
            return;
        }
        const klientNazwa = (kalendarzMultiSelect.options[kalendarzMultiSelect.selectedIndex]?.dataset.klientNazwa)
            || pobierzNazwePowiazania(zlecenieId);
        if (multiEdytowanyIndex !== null) {
            const istnieje = multiZlecenia.some((poz, idx) => idx !== multiEdytowanyIndex && poz.zlecenieId === zlecenieId);
            if (istnieje) {
                alert('To zlecenie jest już powiązane z tym dniem.');
                return;
            }
            multiZlecenia[multiEdytowanyIndex] = {
                zlecenieId,
                klientNazwa,
                fakturowane: Number(godziny) || 0
            };
        } else {
            const istnieje = multiZlecenia.some(poz => poz.zlecenieId === zlecenieId);
            if (istnieje) {
                alert('To zlecenie jest już powiązane z tym dniem.');
                return;
            }
            multiZlecenia.push({
                zlecenieId,
                klientNazwa,
                fakturowane: Number(godziny) || 0
            });
        }
        resetujFormularzMulti();
        renderMultiZlecenia();
    }

    function obslugaListyMulti(event) {
        const target = event?.target;
        if (!(target instanceof Element)) {
            return;
        }
        const li = getClosest(event, 'li');
        if (!li || !li.dataset.index) return;
        const index = Number(li.dataset.index);
        if (Number.isNaN(index)) return;

        if (target.classList.contains('multi-remove')) {
            multiZlecenia.splice(index, 1);
            resetujFormularzMulti();
            renderMultiZlecenia();
            return;
        }

        if (target.classList.contains('multi-edit')) {
            const pozycja = multiZlecenia[index];
            if (!pozycja) return;
            multiEdytowanyIndex = index;
            zapewnijOpcjePowiazanych();
            if (kalendarzMultiSelect) {
                if (!Array.from(kalendarzMultiSelect.options).some(opt => opt.value === pozycja.zlecenieId)) {
                    const option = document.createElement('option');
                    const label = pozycja.klientNazwa || pobierzNazwePowiazania(pozycja.zlecenieId);
                    option.value = pozycja.zlecenieId;
                    option.textContent = label || pozycja.zlecenieId;
                    option.dataset.klientNazwa = label || pozycja.zlecenieId;
                    kalendarzMultiSelect.appendChild(option);
                }
                kalendarzMultiSelect.value = pozycja.zlecenieId;
            }
            if (kalendarzMultiHoursInput) kalendarzMultiHoursInput.value = Number(pozycja.fakturowane) || 0;
            if (kalendarzMultiAddButton) kalendarzMultiAddButton.textContent = 'Zapisz';
        }
    }

    async function obslugaZapisuGodzin(event) {
        if (!kalendarzForm || !kalendarzModal) return;
        event.preventDefault();
        const data = kalendarzForm['kalendarz-data'].value;
        const powiazane = multiZlecenia.map(p => ({
            zlecenieId: p.zlecenieId,
            klientNazwa: p.klientNazwa || pobierzNazwePowiazania(p.zlecenieId),
            fakturowane: Number(p.fakturowane) || 0
        }));
        const sumaFakturowane = powiazane.reduce((acc, el) => acc + (Number(el.fakturowane) || 0), 0);
        const wartoscZFormularza = Number(kalendarzForm['godziny-fakturowane'].value) || 0;
        const fakturowaneDoZapisu = powiazane.length > 0 ? sumaFakturowane : wartoscZFormularza;
        manualFakturowaneValue = fakturowaneDoZapisu;

        const dane = {
            praca: Number(kalendarzForm['godziny-pracy'].value) || 0,
            fakturowane: fakturowaneDoZapisu,
            nadgodziny: Number(kalendarzForm['nadgodziny'].value) || 0,
            jazda: Number(kalendarzForm['czas-jazdy'].value) || 0,
            notatka: kalendarzForm['kalendarz-notatka'].value || '',
            zleceniaPowiazane: powiazane,
            zlecenieId: powiazane.length === 1 ? powiazane[0].zlecenieId : null,
            klientNazwa: powiazane.length === 1 ? (powiazane[0].klientNazwa || null) : null
        };
        if (!ensureDb()) {
            alert('Brak połączenia z bazą danych. Spróbuj ponownie, gdy Firestore będzie dostępny.');
            return;
        }
        try {
            await setDoc(doc(db, "godziny_pracy", data), dane);
            closeModal(kalendarzModal);
        } catch (e) {
            console.error("Błąd zapisu godzin: ", e);
        }
    }

    function wyswietlWpisyKalendarza() {
        if (_wszystkieZleceniaCache.length === 0 && (_wszystkieKlienciCache.length > 0 || _wszystkieMaszynyCache.length > 0)) {
            if (calendar) calendar.removeAllEvents();
            return;
        }
        if (!ensureDb()) {
            if (calendar) {
                calendar.removeAllEvents();
            }
            odswiezPodsumowania();
            return;
        }
        onSnapshot(collection(db, "godziny_pracy"), (snapshotGodziny) => {
            wszystkieWpisyKalendarza = [];
            const events = [];

            snapshotGodziny.forEach(docSnap => {
                const dane = docSnap.data();
                const id = docSnap.id;
                const { powiazane, suma } = normalizujPowiazaneZlecenia(dane);
                const wpis = {
                    id,
                    ...dane,
                    fakturowane: suma,
                    zleceniaPowiazane: powiazane
                };
                wszystkieWpisyKalendarza.push(wpis);

                const linie = [];
                if (dane.praca > 0) linie.push(`Praca: ${formatujLiczbe(dane.praca)} h`);
                if (suma > 0) linie.push(`Fakturowane: ${formatujLiczbe(suma)} h`);
                if (dane.nadgodziny > 0) linie.push(`Nadgodziny: ${formatujLiczbe(dane.nadgodziny)} h`);
                if (dane.jazda > 0) linie.push(`Jazda: ${formatujLiczbe(dane.jazda)} h`);

                const powiazaneLinie = powiazane.map(p => `F: ${formatujLiczbe(p.fakturowane)} h — ${p.klientNazwa || pobierzNazwePowiazania(p.zlecenieId)}`);
                let className = powiazaneLinie.length > 0 ? 'fc-event-godziny-zlecenie' : 'fc-event-godziny';

                events.push({
                    id: `godziny_${id}`,
                    title: linie.join(' | ') || 'Ewidencja czasu',
                    start: id,
                    allDay: true,
                    classNames: [className],
                    extendedProps: {
                        notatka: dane.notatka,
                        type: 'godziny_pracy',
                        zleceniaPowiazane: powiazane,
                        linie,
                        powiazaneLinie
                    }
                });
            });

            if (calendar) {
                calendar.removeAllEvents();
                calendar.addEventSource(events);
                obliczSumeGodzinZKalendarza(calendar.view.currentStart, calendar.view.currentEnd);
            }
            odswiezPodsumowania();
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

        const absorpcja = obliczAbsorpcje(sumy.fakturowane);
        if (!kalendarzPodsumowanieDiv) return;
        const pracaTxt = `${formatujLiczbe(sumy.praca)} h`;
        const fakturowaneTxt = `${formatujLiczbe(sumy.fakturowane)} h`;
        const jazdaTxt = `${formatujLiczbe(sumy.jazda)} h`;
        const nadgodzinyTxt = `${formatujLiczbe(sumy.nadgodziny)} h`;
        const statsText = `Praca ${pracaTxt} • Fakturowane ${fakturowaneTxt} • Jazda ${jazdaTxt} • Nadg. ${nadgodzinyTxt}`;
        kalendarzPodsumowanieDiv.innerHTML = `
           <div class="calendar-summary-bar">
                <p class="calendar-summary-stats">${statsText}</p>
                <div class="calendar-absorpcja-card">
                    <span class="label">Absorpcja</span>
                    <span class="value">${formatujProcent(absorpcja)}%</span>
                    <span class="hint">= Fakturowane / 168h</span>
                </div>
            </div>
            <div class="calendar-summary-grid">
                <div class="summary-item"><span class="summary-label">Praca</span><span class="summary-value">${pracaTxt}</span></div>
                <div class="summary-item"><span class="summary-label">Fakturowane</span><span class="summary-value">${fakturowaneTxt}</span></div>
                <div class="summary-item"><span class="summary-label">Jazda</span><span class="summary-value">${jazdaTxt}</span></div>
                <div class="summary-item"><span class="summary-label">Nadgodziny</span><span class="summary-value">${nadgodzinyTxt}</span></div>
                <div class="summary-item"><span class="summary-label">Absorpcja</span><span class="summary-value">${formatujProcent(absorpcja)}%</span></div>
            </div> 
        `;
         if (calendarAbsorpcjaTag) {
            calendarAbsorpcjaTag.textContent = `Absorpcja: ${formatujProcent(absorpcja)}%`;
        }
    }

    async function obslugaKalendarza(event) {
        const target = event?.target;
        if (!(target instanceof Element)) {
            return;
        }

        const editButton = getClosest(event, '.event-edit-btn');
        if (editButton) {
            const data = editButton.dataset.date;
            if (data) {
                otworzModalGodzin(data);
            }
        }

        const deleteButton = getClosest(event, '.event-delete-btn');
        if (deleteButton) {
            const data = deleteButton.dataset.date;
            if (data && confirm(`Czy na pewno chcesz usunąć wpis z dnia ${data}?`)) {
                if (!ensureDbOrNotify()) {
                    return;
                }
                await deleteDoc(doc(db, "godziny_pracy", data));
            }
        }
    }

    // --- FUNKCJE OGÓLNE ---
    function normalizujMiesiac(wartosc) {
        if (!wartosc) return '';

        let data = null;
        if (typeof wartosc?.toDate === 'function') {
            data = wartosc.toDate();
        } else if (wartosc instanceof Date) {
            data = wartosc;
        } else if (typeof wartosc === 'number') {
            data = new Date(wartosc);
        } else if (typeof wartosc === 'string') {
            const trimmed = wartosc.trim();
            const normalized = trimmed.replace(/[./]/g, '-');
            const candidate = normalized.length >= 10 ? normalized.slice(0, 10) : normalized;
            data = new Date(candidate);
            if (!Number.isNaN(data.getTime())) {
                const miesiac = String(data.getMonth() + 1).padStart(2, '0');
                return `${data.getFullYear()}-${miesiac}`;
            }
            const [rok, miesiac] = candidate.split('-');
            if (rok && miesiac) {
                return `${rok}-${miesiac.padStart(2, '0')}`;
            }
            return '';
        } else {
            data = new Date(wartosc);
        }

        if (data && !Number.isNaN(data.getTime())) {
            const miesiac = String(data.getMonth() + 1).padStart(2, '0');
            return `${data.getFullYear()}-${miesiac}`;
        }
        return '';
    }

    function wartoscLiczbowa(wartosc) {
        if (typeof wartosc === 'number' && Number.isFinite(wartosc)) return wartosc;
        const parsed = Number(wartosc);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function konwertujNaDate(wartosc) {
        if (!wartosc) return null;
        if (typeof wartosc.toDate === 'function') {
            return wartosc.toDate();
        }
        if (wartosc instanceof Date) {
            return wartosc;
        }
        const parsed = new Date(wartosc);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function formatujDateCzas(data) {
        if (!(data instanceof Date) || Number.isNaN(data.getTime())) {
            return 'brak danych';
        }
        return data.toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
    }


    function pobierzZakonczoneZleceniaWMiesiacu(zlecenia, miesiac) {
        if (!miesiac) return [];
        return (zlecenia || []).filter(z => {
            if (!z || z.status !== 'ukończone') return false;
            const data = typeof z.dataUkonczenia === 'string'
                ? z.dataUkonczenia
                : normalizujMiesiac(z.dataUkonczenia);
            return typeof data === 'string' && data.startsWith(miesiac);
        });
    }

    function obliczFinanseZlecen(zlecenia) {
        return (zlecenia || []).reduce((acc, z) => {
            const godziny = Number(z?.wyfakturowaneGodziny) || 0;
            const stawka = STAWKI[z?.typZlecenia]?.stawka || 0;
            const brutto = godziny * stawka;
            acc.godziny += godziny;
            acc.brutto += brutto;
            acc.netto += brutto * 0.7;
            acc.liczba += 1;
            const typ = (z?.typZlecenia || 'inne').toUpperCase();
            acc.typy[typ] = (acc.typy[typ] || 0) + 1;
            return acc;
        }, { godziny: 0, brutto: 0, netto: 0, liczba: 0, typy: {} });
    }

    function pobierzSumyKalendarza(miesiac) {
        if (!miesiac) return { praca: 0, jazda: 0, nadgodziny: 0, fakturowane: 0 };
        return wszystkieWpisyKalendarza
            .filter(wpis => wpis?.id && wpis.id.startsWith(miesiac))
            .reduce((acc, wpis) => {
                acc.praca += Number(wpis.praca) || 0;
                acc.jazda += Number(wpis.jazda) || 0;
                acc.nadgodziny += Number(wpis.nadgodziny) || 0;
                acc.fakturowane += Number(wpis.fakturowane) || 0;
                return acc;
            }, { praca: 0, jazda: 0, nadgodziny: 0, fakturowane: 0 });
    }

    function obliczAbsorpcje(godziny) {
        const wynik = ((Number(godziny) || 0) / 168) * 100;
        return Number.isFinite(wynik) ? Number(wynik.toFixed(1)) : 0;
    }

    function obliczPoprzedniMiesiac(miesiac) {
        if (!miesiac) return '';
        const [rok, mies] = miesiac.split('-').map(Number);
        if (!rok || !mies) return '';
        const data = new Date(rok, mies - 1, 1);
        data.setMonth(data.getMonth() - 1);
        const y = data.getFullYear();
        const m = String(data.getMonth() + 1).padStart(2, '0');
        return `${y}-${m}`;
    }

    function obliczPodsumowanieTygodnia() {
        if (!wszystkieWpisyKalendarza.length) {
            return { praca: 0, jazda: 0, nadgodziny: 0 };
        }
        const teraz = new Date();
        const dzien = teraz.getDay();
        const przesuniecie = dzien === 0 ? 6 : dzien - 1; // poniedziałek jako początek tygodnia
        const poczatek = new Date(teraz);
        poczatek.setHours(0, 0, 0, 0);
        poczatek.setDate(teraz.getDate() - przesuniecie);
        const koniec = new Date(poczatek);
        koniec.setDate(poczatek.getDate() + 7);

        return wszystkieWpisyKalendarza.reduce((acc, wpis) => {
            if (!wpis?.id) return acc;
            const data = new Date(wpis.id);
            if (Number.isNaN(data.getTime())) return acc;
            if (data >= poczatek && data < koniec) {
                acc.praca += Number(wpis.praca) || 0;
                acc.jazda += Number(wpis.jazda) || 0;
                acc.nadgodziny += Number(wpis.nadgodziny) || 0;
            }
            return acc;
        }, { praca: 0, jazda: 0, nadgodziny: 0 });
    }

    function formatujProcent(wartosc) {
        return (Number(wartosc) || 0).toFixed(1);
    }
    function pobierzNazweZlecenia(zlecenie) {
        if (!zlecenie) return '';
        const klient = _wszystkieKlienciCache.find(k => k.id === zlecenie.klientId);
        const maszyna = _wszystkieMaszynyCache.find(m => m.id === zlecenie.maszynaId);
        const klientLabel = zlecenie.klientNazwa || klient?.nazwa || '';
        const maszynaLabel = maszyna ? `${maszyna.typMaszyny || ''} ${maszyna.model || ''}`.trim() : '';
        const nrZlecenia = zlecenie.nrZlecenia || zlecenie.id;
        if (klientLabel && maszynaLabel) {
            return `${klientLabel} — ${maszynaLabel}`;
        }
        if (klientLabel) {
            return `${klientLabel} — ${nrZlecenia}`;
        }
        return nrZlecenia;
    }

    function pobierzNazwePowiazania(zlecenieId) {
        if (!zlecenieId) return '';
        const zlecenie = _wszystkieZleceniaCache.find(z => z.id === zlecenieId);
        return pobierzNazweZlecenia(zlecenie) || zlecenieId;
    }

    function normalizujPowiazaneZlecenia(dane) {
        const lista = Array.isArray(dane?.zleceniaPowiazane) ? dane.zleceniaPowiazane : [];
        const powiazane = lista
            .filter(p => p && p.zlecenieId)
            .map(p => ({
                zlecenieId: p.zlecenieId,
                klientNazwa: p.klientNazwa || pobierzNazwePowiazania(p.zlecenieId),
                fakturowane: Number(p.fakturowane) || 0
            }));

        if (!powiazane.length && dane?.zlecenieId) {
            powiazane.push({
                zlecenieId: dane.zlecenieId,
                klientNazwa: dane.klientNazwa || pobierzNazwePowiazania(dane.zlecenieId),
                fakturowane: Number(dane.fakturowane) || 0
            });
        }

        const sumaPowiazanych = powiazane.reduce((acc, el) => acc + (Number(el.fakturowane) || 0), 0);
        const maPowiazania = powiazane.length > 0;
        const fallback = Number(dane?.fakturowane) || 0;
        const suma = maPowiazania ? sumaPowiazanych : fallback;
        return { powiazane, suma, maPowiazania };
    }


    function formatujIloscMagazynu(ilosc) {
        const wartosc = wartoscLiczbowa(ilosc);
       return wartosc.toFixed(2);
    }

    function obliczPodsumowaniaMiesieczne(wpisy, zlecenia) {
        const mapa = {};
        const pustyRekord = () => ({ praca: 0, nadgodziny: 0, jazda: 0, wyfakturowaneGodziny: 0, brutto: 0, netto: 0, absorpcja: 0 });
        const pobierzRekord = (miesiac) => {
            if (!mapa[miesiac]) {
                mapa[miesiac] = pustyRekord();
            }
            return mapa[miesiac];
        };

        wpisy.forEach(wpis => {
            if (!wpis?.id) return;
            const miesiac = normalizujMiesiac(wpis.id);
            if (!miesiac) return;
            const rekord = pobierzRekord(miesiac);
            rekord.praca += Number(wpis.praca) || 0;
            rekord.nadgodziny += Number(wpis.nadgodziny) || 0;
            rekord.jazda += Number(wpis.jazda) || 0;
            rekord.wyfakturowaneGodziny += Number(wpis.fakturowane) || 0;
        });


        zlecenia.forEach(zlecenie => {
            if (!zlecenie || zlecenie.status !== 'ukończone' || !zlecenie.dataUkonczenia) return;
            const miesiac = normalizujMiesiac(zlecenie.dataUkonczenia);
            if (!miesiac) return;
            const rekord = pobierzRekord(miesiac);
            const godziny = Number(zlecenie.wyfakturowaneGodziny) || 0;
            const stawka = STAWKI[zlecenie.typZlecenia]?.stawka || 0;
            const brutto = godziny * stawka;
            rekord.brutto += brutto;
            rekord.netto += brutto * 0.70;
        });

        const miesiace = Object.keys(mapa)
            .sort()
            .map(miesiac => {
                const rekord = mapa[miesiac];
                const absorpcja = obliczAbsorpcje(rekord.wyfakturowaneGodziny);
                return { miesiac, ...rekord, absorpcja };
            });

        const sumyRoczne = miesiace.reduce((acc, rekord) => {
            acc.praca += rekord.praca;
            acc.nadgodziny += rekord.nadgodziny;
            acc.jazda += rekord.jazda;
            acc.wyfakturowaneGodziny += rekord.wyfakturowaneGodziny;
            acc.brutto += rekord.brutto;
            acc.netto += rekord.netto;
            return acc;
        }, pustyRekord());
        sumyRoczne.absorpcja = obliczAbsorpcje(sumyRoczne.wyfakturowaneGodziny);

        return { miesiace, sumyRoczne };
    }

    function formatujMiesiac(miesiac) {
        if (!miesiac) return '';
        try {
            const data = new Date(`${miesiac}-01T00:00:00`);
            return data.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
        } catch (e) {
            return miesiac;
        }
    }

    function formatujLiczbe(wartosc) {
        return (Number(wartosc) || 0).toFixed(2);
    }

    function pobierzWartoscMiesiaca(input) {
        const fallback = getCurrentMonthString();
        if (!input) {
            return fallback;
        }
        const value = (input.value || '').trim();
        if (!value) {
            input.value = fallback;
            return fallback;
        }
        return value;
    }

    function synchronizujWyborMiesiaca(wartosc) {
        if (miesiacSummaryInput && miesiacSummaryInput.value !== wartosc) {
            miesiacSummaryInput.value = wartosc;
        }
        if (zakonczoneMiesiacInput && zakonczoneMiesiacInput.value !== wartosc) {
            zakonczoneMiesiacInput.value = wartosc;
        }
    }

    function getSelectedMonth() {
        return pobierzWartoscMiesiaca(miesiacSummaryInput);
    }

    function getSelectedFinishedMonth() {
        if (zakonczoneMiesiacInput) {
            return pobierzWartoscMiesiaca(zakonczoneMiesiacInput);
        }
        return getSelectedMonth();
    }


    function obliczPodsumowanieFinansowe(miesiac, wszystkieZlecenia) {
        if (!miesiac) {
            return { sumaGodzin: 0, sumaBrutto: 0, sumaNetto: 0, liczba: 0, typy: {} };
        }
        const dane = obliczFinanseZlecen(pobierzZakonczoneZleceniaWMiesiacu(wszystkieZlecenia, miesiac));
        return {
            sumaGodzin: dane.godziny,
            sumaBrutto: dane.brutto,
            sumaNetto: dane.netto,
            liczba: dane.liczba,
            typy: dane.typy
        };
    }

    function renderRocznePodsumowanie() {
        if (!isPodsumowaniaViewMounted() || !annualSummaryContainer) return;
        const { miesiace, sumyRoczne } = ostatnieZestawienieMiesieczne;
        if (!miesiace.length) {
            annualSummaryContainer.innerHTML = '<p>Brak danych do wyświetlenia.</p>';
            return;
        }

        const wiersze = miesiace.map(rekord => `
            <tr>
                <td>${formatujMiesiac(rekord.miesiac)}</td>
                <td>${formatujLiczbe(rekord.praca)} h</td>
                <td>${formatujLiczbe(rekord.nadgodziny)} h</td>
                <td>${formatujLiczbe(rekord.jazda)} h</td>
                <td>${formatujLiczbe(rekord.wyfakturowaneGodziny)} h</td>
                <td>${formatujProcent(rekord.absorpcja)}%</td>
                <td>${formatujLiczbe(rekord.brutto)} zł</td>
                <td>${formatujLiczbe(rekord.netto)} zł</td>
            </tr>
        `).join('');

        const suma = `
            <tr>
                <td>Razem</td>
                <td>${formatujLiczbe(sumyRoczne.praca)} h</td>
                <td>${formatujLiczbe(sumyRoczne.nadgodziny)} h</td>
                <td>${formatujLiczbe(sumyRoczne.jazda)} h</td>
                <td>${formatujLiczbe(sumyRoczne.wyfakturowaneGodziny)} h</td>
                <td>${formatujProcent(sumyRoczne.absorpcja)}%</td>
                <td>${formatujLiczbe(sumyRoczne.brutto)} zł</td>
                <td>${formatujLiczbe(sumyRoczne.netto)} zł</td>
            </tr>`;

        annualSummaryContainer.innerHTML = `
            <div class="table-responsive">
                <table class="summary-table">
                    <thead>
                        <tr>
                            <th>Miesiąc</th>
                            <th>Godziny pracy</th>
                            <th>Nadgodziny</th>
                            <th>Czas jazdy</th>
                            <th>Godziny wyfakturowane</th>
                            <th>Absorpcja</th>
                            <th>Brutto</th>
                            <th>Netto</th>
                        </tr>
                    </thead>
                    <tbody>${wiersze}</tbody>
                    <tfoot>${suma}</tfoot>
                </table>
            </div>`;
    }

    function updateFinishedMonthOptions() {
        if (!miesiacSummaryInput && !zakonczoneMiesiacInput) return;
        const fallback = getCurrentMonthString();
        const miesiaceSet = new Set();
        (_wszystkieZleceniaCache || []).forEach(zlecenie => {
            if (zlecenie?.status === 'ukończone' && zlecenie.dataUkonczenia) {
                miesiaceSet.add(zlecenie.dataUkonczenia.slice(0, 7));
            }
        });
        if (!miesiaceSet.size) {
            miesiaceSet.add(fallback);
        }
        const posortowane = Array.from(miesiaceSet).sort();
        const min = posortowane[0];
        const max = posortowane[posortowane.length - 1];
        const obecna = miesiacSummaryInput?.value?.trim() || zakonczoneMiesiacInput?.value?.trim() || '';
        if (min) {
            if (miesiacSummaryInput) miesiacSummaryInput.min = min;
            if (zakonczoneMiesiacInput) zakonczoneMiesiacInput.min = min;
        }
        if (max) {
            if (miesiacSummaryInput) miesiacSummaryInput.max = max;
            if (zakonczoneMiesiacInput) zakonczoneMiesiacInput.max = max;
        }
        const docelowy = (!obecna || !miesiaceSet.has(obecna)) ? (max || fallback) : obecna;
        synchronizujWyborMiesiaca(docelowy);
        const joined = posortowane.join(',');
        if (miesiacSummaryInput) {
            miesiacSummaryInput.dataset.availableMonths = joined;
        }
        if (zakonczoneMiesiacInput) {
            zakonczoneMiesiacInput.dataset.availableMonths = joined;
        }
    }

    function renderFinishedMiniSummary(miesiac, zlecenia) {
        if (!finishedMiniSummary) return;
        const lista = Array.isArray(zlecenia) ? zlecenia : [];
        const agregaty = lista.reduce((acc, zlecenie) => {
            const godziny = Number(zlecenie.wyfakturowaneGodziny) || 0;
            const stawka = STAWKI[zlecenie.typZlecenia]?.stawka || 0;
            acc.godziny += godziny;
            acc.brutto += godziny * stawka;
            return acc;
        }, { godziny: 0, brutto: 0 });

        const netto = agregaty.brutto * 0.7;
        const absorpcja = agregaty.godziny > 0 ? (agregaty.godziny / 168) * 100 : 0;

        const items = [
            { label: 'Godziny wyfakturowane', value: `${formatujLiczbe(agregaty.godziny)} h` },
            { label: 'Brutto', value: `${formatujLiczbe(agregaty.brutto)} zł` },
            { label: 'Netto', value: `${formatujLiczbe(netto)} zł` },
            { label: 'Absorpcja', value: `${formatujProcent(absorpcja)}%` }
        ];

        finishedMiniSummary.setAttribute('data-month', miesiac);
        finishedMiniSummary.innerHTML = items.map(item => `
            <div class="mini-summary-item">
                <span>${item.label}</span>
                <strong>${item.value}</strong>
            </div>
        `).join('');
    }

    function renderZakonczoneSekcja() {
        if (!isPodsumowaniaViewMounted() || (!zakonczoneTopSummary && !zakonczoneMonthSummary)) {
            return;
        }

        const wybranyMiesiac = getSelectedFinishedMonth();
        const finansowe = obliczPodsumowanieFinansowe(wybranyMiesiac, _wszystkieZleceniaCache);
        const kalendarz = pobierzSumyKalendarza(wybranyMiesiac);
        const absorpcja = obliczAbsorpcje(kalendarz.fakturowane);

        if (zakonczoneTopSummary) {
            const cards = [
                { label: 'Godziny wyfakturowane', value: `${formatujLiczbe(finansowe.sumaGodzin)} h` },
                { label: 'Wartość brutto', value: `${formatujLiczbe(finansowe.sumaBrutto)} zł` },
                { label: 'Wartość netto', value: `${formatujLiczbe(finansowe.sumaNetto)} zł` }
            ].map(card => `
                <div class="metric-card">
                    <h4>${card.label}</h4>
                    <strong>${card.value}</strong>
                </div>
            `).join('');
            zakonczoneTopSummary.innerHTML = cards;
        }

        if (zakonczoneMonthSummary) {
            zakonczoneMonthSummary.innerHTML = `
                <div class="summary-item"><span class="summary-label">Suma godzin</span><span class="summary-value">${formatujLiczbe(finansowe.sumaGodzin)} h</span></div>
                <div class="summary-item"><span class="summary-label">Wartość brutto</span><span class="summary-value">${formatujLiczbe(finansowe.sumaBrutto)} zł</span></div>
                <div class="summary-item"><span class="summary-label">Wartość netto</span><span class="summary-value">${formatujLiczbe(finansowe.sumaNetto)} zł</span></div>
                <div class="summary-item"><span class="summary-label">Absorpcja</span><span class="summary-value">${formatujProcent(absorpcja)}%</span></div>
            `;
        }
    }

    function renderDashboard() {
        if (!dashboardNoweZlecenia && !dashboardAbsorpcja && !hoursChartContainer) return;
        const teraz = new Date();
        const aktualnyMiesiac = `${teraz.getFullYear()}-${String(teraz.getMonth() + 1).padStart(2, '0')}`;
        const poprzedniMiesiac = obliczPoprzedniMiesiac(aktualnyMiesiac);

        const sumaKalendarzaAktualny = pobierzSumyKalendarza(aktualnyMiesiac);
        const sumaKalendarzaPoprzedni = pobierzSumyKalendarza(poprzedniMiesiac);
        const absorpcja = obliczAbsorpcje(sumaKalendarzaAktualny.fakturowane);

        const noweZlecenia = (_wszystkieZleceniaCache || []).filter(z => normalizujMiesiac(z?.createdAt) === aktualnyMiesiac).length;
        const otwarteZlecenia = (_wszystkieZleceniaCache || []).filter(z => z?.status === 'aktywne' || z?.status === 'nieprzypisane').length;

        const diff = sumaKalendarzaAktualny.fakturowane - (sumaKalendarzaPoprzedni.fakturowane || 0);
        const procentZmiany = (sumaKalendarzaPoprzedni.fakturowane || 0) === 0
            ? (sumaKalendarzaAktualny.fakturowane > 0 ? 100 : 0)
            : (diff / sumaKalendarzaPoprzedni.fakturowane) * 100;

        if (dashboardNoweZlecenia) dashboardNoweZlecenia.textContent = noweZlecenia.toString();
        if (dashboardOtwarteZlecenia) dashboardOtwarteZlecenia.textContent = otwarteZlecenia.toString();
        if (dashboardWyfakturowane) dashboardWyfakturowane.textContent = `${formatujLiczbe(sumaKalendarzaAktualny.fakturowane)} h`;
        if (dashboardWyfakturowaneZmiana) {
            const znak = procentZmiany > 0 ? '+' : '';
            dashboardWyfakturowaneZmiana.textContent = `${znak}${formatujProcent(procentZmiany)}% vs poprzedni`;
        }
        if (dashboardAbsorpcja) dashboardAbsorpcja.textContent = `${formatujProcent(absorpcja)}%`;

        const tydzien = obliczPodsumowanieTygodnia();
        if (weekPracaValue) weekPracaValue.textContent = `${formatujLiczbe(tydzien.praca)} h`;
        if (weekJazdaValue) weekJazdaValue.textContent = `${formatujLiczbe(tydzien.jazda)} h`;
        if (weekNadgodzinyValue) weekNadgodzinyValue.textContent = `${formatujLiczbe(tydzien.nadgodziny)} h`;

        if (hoursChartContainer) {
            const miesiaceDoWyswietlenia = [];
            for (let i = 2; i >= 0; i--) {
                const data = new Date(teraz.getFullYear(), teraz.getMonth() - i, 1);
                const mies = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
                miesiaceDoWyswietlenia.push(mies);
            }
            const daneWykresu = miesiaceDoWyswietlenia.map(mies => {
            const kalendarz = pobierzSumyKalendarza(mies);
                return { miesiac: mies, godziny: kalendarz.fakturowane };    
            });
            const maxGodziny = Math.max(0, ...daneWykresu.map(d => d.godziny));
            if (maxGodziny === 0) {
                hoursChartContainer.innerHTML = '<p>Brak danych do wyświetlenia.</p>';
            } else {
                hoursChartContainer.innerHTML = daneWykresu.map(dane => {
                    const wysokosc = maxGodziny === 0 ? 0 : Math.max(8, (dane.godziny / maxGodziny) * 100);
                    return `
                        <div class="bar">
                            <div class="bar-fill" style="height:${wysokosc}%"></div>
                            <strong>${formatujLiczbe(dane.godziny)}</strong>
                            <span>${formatujMiesiac(dane.miesiac)}</span>
                        </div>
                    `;
                }).join('');
            }
        }
    }

    function renderPodsumowanieSekcja() {
        if (!isPodsumowaniaViewMounted() || !podsumowaniaMetryki) return;
        const miesiac = getSelectedMonth();
        const zakonczone = pobierzZakonczoneZleceniaWMiesiacu(_wszystkieZleceniaCache, miesiac);
        const finanse = obliczFinanseZlecen(zakonczone);
        const kalendarz = pobierzSumyKalendarza(miesiac);
        const absorpcja = obliczAbsorpcje(kalendarz.fakturowane);
        const typy = finanse.typy || {};

        const s = typy.S || 0;
        const g = typy.G || 0;
        const w = typy.W || 0;
        const z = typy.Z || 0;

        podsumowaniaMetryki.innerHTML = `
            <div class="metric-card"><h4>Ukończone zlecenia</h4><strong>${finanse.liczba}</strong></div>
            <div class="metric-card"><h4>Godziny wyfakturowane</h4><strong>${formatujLiczbe(finanse.godziny)} h</strong></div>
            <div class="metric-card"><h4>Wartość brutto</h4><strong>${formatujLiczbe(finanse.brutto)} zł</strong></div>
            <div class="metric-card"><h4>Wartość netto</h4><strong>${formatujLiczbe(finanse.netto)} zł</strong></div>
            <div class="metric-card"><h4>Godziny pracy</h4><strong>${formatujLiczbe(kalendarz.praca)} h</strong></div>
            <div class="metric-card"><h4>Nadgodziny</h4><strong>${formatujLiczbe(kalendarz.nadgodziny)} h</strong></div>
            <div class="metric-card"><h4>Czas jazdy</h4><strong>${formatujLiczbe(kalendarz.jazda)} h</strong></div>
            <div class="metric-card"><h4>Struktura typów</h4><strong>S: ${s}, G: ${g}, W: ${w}, Z: ${z}</strong></div>
            <div class="metric-card"><h4>Absorpcja</h4><strong>${formatujProcent(absorpcja)}%</strong></div>
        `;
    }
    function odswiezPodsumowania() {
        ostatnieZestawienieMiesieczne = obliczPodsumowaniaMiesieczne(wszystkieWpisyKalendarza, _wszystkieZleceniaCache);
        if (miesiacSummaryInput && ostatnieZestawienieMiesieczne.miesiace.length) {
            const miesiace = ostatnieZestawienieMiesieczne.miesiace;
            const aktualny = miesiacSummaryInput.value;
            if (!aktualny || !miesiace.some(m => m.miesiac === aktualny)) {
                miesiacSummaryInput.value = miesiace[miesiace.length - 1].miesiac;
            }
        }
        renderRocznePodsumowanie();
        renderZakonczoneSekcja();
        renderPodsumowanieSekcja();
        renderDashboard();
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
        const savedTheme = localStorage.getItem('theme') || 'dark';
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
    
    function applyTheme(theme) {
        if (theme === 'dark') {
            document.body.dataset.theme = 'dark';
        } else {
            delete document.body.dataset.theme;
        }
    }


    function inicjujZwijanie() {
        if (zakonczoneZleceniaHeader && zakonczoneZleceniaContent) {
            zakonczoneZleceniaContent.classList.add('collapsed');
            zakonczoneZleceniaHeader.addEventListener('click', () => {
                zakonczoneZleceniaHeader.classList.toggle('collapsed');
                zakonczoneZleceniaContent.classList.toggle('collapsed');
            }, { passive: true });
        }

           if (listaKlientowHeader && listaKlientowContent) {
            listaKlientowHeader.classList.add('collapsed');
            listaKlientowContent.classList.add('collapsed');
            listaKlientowHeader.addEventListener('click', () => {
                listaKlientowHeader.classList.toggle('collapsed');
                listaKlientowContent.classList.toggle('collapsed');
            }, { passive: true });
        }

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
        if (!ensureDbOrNotify()) {
            return;
        }
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
        optionsHtml += "<option value=\"szybkie-zlecenie\">-- SZYBKIE ZLECENIE (bez klienta) --</option>";

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

    async function pobierzKlientaZCache(klientId) {
        if (!klientId) return null;
        const cached = _wszystkieKlienciCache.find(k => k.id === klientId);
        if (cached) return cached;
        if (!ensureDb()) {
            return null;
        }
        try {
            const snap = await getDoc(doc(db, 'klienci', klientId));
            if (!snap.exists()) return null;
            const klient = { id: snap.id, ...snap.data() };
            _wszystkieKlienciCache.push(klient);
            return klient;
        } catch (error) {
            console.error('[Klienci] Błąd pobierania klienta z Firestore:', error);
            return null;
        }
    }

    async function pobierzMaszynyKlientaZCache(klientId) {
        if (!klientId) return [];
        let maszyny = _wszystkieMaszynyCache.filter(m => m.klientId === klientId);
        if (maszyny.length) {
            return maszyny;
        }
        if (!ensureDb()) {
            return [];
        }
        try {
            const qMaszyny = query(collection(db, 'maszyny'), where('klientId', '==', klientId));
            const snap = await getDocs(qMaszyny);
            maszyny = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
            const nowe = maszyny.filter(m => !_wszystkieMaszynyCache.some(existing => existing.id === m.id));
            if (nowe.length) {
                _wszystkieMaszynyCache = _wszystkieMaszynyCache.concat(nowe);
            }
            return maszyny;
        } catch (error) {
            console.error('[Klienci] Błąd ładowania maszyn klienta:', error);
            return [];
        }
    }

    async function pobierzMaszyneZCache(maszynaId) {
        if (!maszynaId) return null;
        const cached = _wszystkieMaszynyCache.find(m => m.id === maszynaId);
        if (cached) return cached;
        if (!ensureDb()) {
            return null;
        }
        try {
            const snap = await getDoc(doc(db, 'maszyny', maszynaId));
            if (!snap.exists()) return null;
            const maszyna = { id: snap.id, ...snap.data() };
            _wszystkieMaszynyCache.push(maszyna);
            return maszyna;
        } catch (error) {
            console.error('[Maszyny] Błąd pobierania maszyny z Firestore:', error);
            return null;
        }
    }
   

    async function zaladujMaszynyKlienta(klientId, kontener) {
        if (!kontener || !klientId) return;
        if (kontener.dataset.loaded === 'true') return;
        kontener.innerHTML = '<p>Ładowanie maszyn...</p>';
        const maszynyKlienta = await pobierzMaszynyKlientaZCache(klientId);
        if (!maszynyKlienta.length) {
            kontener.innerHTML = '<p style="font-size: 0.85rem; color: var(--text-color-light);">Brak maszyn przypisanych do klienta.</p>';
            kontener.dataset.loaded = 'true';
            return;
        }
        const listaMaszynHtml = maszynyKlienta
            .sort((a, b) => (a.typMaszyny || '').localeCompare(b.typMaszyny || '', 'pl', { sensitivity: 'base' })
                || (a.model || '').localeCompare(b.model || '', 'pl', { sensitivity: 'base' }))
            .map(maszyna => {
                const typ = maszyna.typMaszyny || '---';
                const model = maszyna.model || '';
                const label = `${typ} ${model}`.trim();
                const nrSeryjny = maszyna.nrSeryjny && maszyna.nrSeryjny !== '---' ? maszyna.nrSeryjny : 'brak';
                return `
                    <li data-id="${maszyna.id}">
                        <span>${label || 'Maszyna'}</span>
                        <div>
                            <a href="#" class="machine-history-link" data-maszyna-id="${maszyna.id}" data-maszyna-nazwa="${label}">Historia</a>
                            <button type="button" class="btn-edit edit-maszyna-btn" data-id="${maszyna.id}">Edytuj</button>
                        </div>
                        <small>S/N: ${nrSeryjny}</small>
                    </li>`;
            }).join('');
        kontener.innerHTML = `<ul class="client-machine-list">${listaMaszynHtml}</ul>`;
        kontener.dataset.loaded = 'true';
    }

    function wyswietlKlientow() {
        try {
            const fraza = (klientSearchInput?.value || '').trim().toLowerCase();
            wszystkieKlienci = [];

            let klienciHtml = '';
            let selectHtml = '<option value="">-- Wybierz klienta --</option>';

            const posortowani = (_wszystkieKlienciCache || [])
                .filter(klient => {
                    if (!fraza) return true;
                    const tekst = [klient.nazwa, klient.nip, klient.adres, klient.telefon]
                        .filter(Boolean)
                        .join(' ')
                        .toLowerCase();
                    return tekst.includes(fraza);
                })
                .sort((a, b) => (a.nazwa || '').localeCompare(b.nazwa || '', 'pl', { sensitivity: 'base' }));

            posortowani.forEach(klient => {
                wszystkieKlienci.push(klient);
                const maszynyListaId = `client-${klient.id}-machines`;
                const nipTxt = klient.nip && klient.nip !== '---' ? ` (NIP: ${klient.nip})` : '';

                const maszynyKlienta = (_wszystkieMaszynyCache || [])
                    .filter(maszyna => maszyna.klientId === klient.id)
                    .sort((a, b) => (a.typMaszyny || '').localeCompare(b.typMaszyny || '', 'pl', { sensitivity: 'base' })
                        || (a.model || '').localeCompare(b.model || '', 'pl', { sensitivity: 'base' }));

                const maszynyHtml = maszynyKlienta.length
                    ? `<ul class="client-machine-list">${maszynyKlienta.map(maszyna => {
                        const typ = maszyna.typMaszyny || '---';
                        const model = maszyna.model || '';
                        const label = `${typ} ${model}`.trim();
                        const numerSeryjny = maszyna.nrSeryjny && maszyna.nrSeryjny !== '---' ? maszyna.nrSeryjny : 'brak';
                        const displayLabel = label || 'Maszyna';
                        return `
                            <li data-id="${maszyna.id}">
                                <span>
                                    <strong>${displayLabel}</strong><br>
                                    <small>S/N: ${numerSeryjny}</small>
                                </span>
                                <div>
                                    <a href="#" class="machine-history-link" data-maszyna-id="${maszyna.id}" data-maszyna-nazwa="${displayLabel}">Historia</a>
                                </div>
                            </li>`;
                    }).join('')}</ul>`
                    : '<p class="client-machine-empty">Brak maszyn</p>';

                klienciHtml += `
                    <div class="client-group" data-id="${klient.id}">
                        <div class="client-header" data-target="${maszynyListaId}">
                            <div class="client-header-text">
                                <strong>${klient.nazwa || '---'}</strong>${nipTxt}<br>
                                <small>${klient.adres || '---'} | ${klient.telefon || '---'}</small>
                            </div>
                            <span class="toggle-machines-arrow collapsed" data-target="${maszynyListaId}" data-client-id="${klient.id}">▼</span>
                            <div class="client-header-actions">
                                <button class="btn-edit edit-klient-btn" type="button">Edytuj</button>
                                <button class="delete-btn" type="button">Usuń</button>
                            </div>
                        </div>
                        <div id="${maszynyListaId}" class="client-machine-list-container collapsed" data-client-id="${klient.id}">
                            ${maszynyHtml}
                        </div>
                    </div>`;

                selectHtml += `<option value="${klient.id}">${klient.nazwa || '(bez nazwy)'}</option>`;
            });

            if (listaKlientowDiv) {
                listaKlientowDiv.innerHTML = klienciHtml || '<p>Brak klientów w bazie lub pasujących do wyszukiwania.</p>';
            }
            if (maszynaKlientSelect) {
                maszynaKlientSelect.innerHTML = selectHtml;
            }
            odswiezSelectKlientaDoZlecenia();
            if (assignKlientSelect) {
                assignKlientSelect.innerHTML = selectHtml;
                assignKlientSelect.dispatchEvent(new Event('change'));
            }
        } catch (error) {
            console.error('wyswietlKlientow() — błąd:', error);
            if (listaKlientowDiv) {
                listaKlientowDiv.innerHTML = `<p style="color:#e74c3c">Błąd renderowania listy klientów: ${String(error)}</p>`;
            }
        }
    }

    function nasluchujNaKlientow() {
        if (!ensureDb()) {
            if (listaKlientowDiv) {
                listaKlientowDiv.innerHTML = '<p>Brak połączenia z bazą danych.</p>';
            }
            return;
        }
        onSnapshot(
            query(collection(db, "klienci"), orderBy("nazwa")),
            (snapshot) => {
                _wszystkieKlienciCache = [];
                snapshot.forEach((docSnap) => {
                    _wszystkieKlienciCache.push({ id: docSnap.id, ...docSnap.data() });
                });
                wyswietlMaszyny();
                wyswietlKlientow();
            }
        );
    }

    async function obslugaListyKlientow(event) {
        const target = event?.target;
        if (!(target instanceof Element)) {
            return;
        }

        const header = getClosest(event, '.client-header');
        if (header && !getClosest(event, '.client-header-actions')) {
            const targetId = header.dataset.target || header.querySelector('.toggle-machines-arrow')?.dataset.target;
            const listaMaszyn = targetId ? document.getElementById(targetId) : header.nextElementSibling;
            const arrowEl = header.querySelector('.toggle-machines-arrow');
            toggleMaszynyGrupy(listaMaszyn, arrowEl, header);
            return;
        }

        const linkHistoriaMaszyny = getClosest(event, '.machine-history-link');
        if (linkHistoriaMaszyny) {
            event.preventDefault();
            const maszynaElement = getClosest(event, 'li[data-id]');
            const maszynaId = linkHistoriaMaszyny.dataset.maszynaId || maszynaElement?.dataset.id || '';
            const maszynaNazwa = linkHistoriaMaszyny.dataset.maszynaNazwa
                || maszynaElement?.querySelector('span')?.textContent?.trim()
                || '';
            if (maszynaId) {
                pokazHistorieSerwisowaMaszyny(maszynaId, maszynaNazwa);
            }
            return;
        }

        const btnEditKlient = getClosest(event, '.edit-klient-btn');
        if (btnEditKlient) {
            const klientGroup = getClosest(event, '.client-group');
            const klientId = klientGroup?.dataset.id;
            if (klientId) {
                otworzModalEdycjiKlienta(klientId);
            }
            return;
        }

        const btnDeleteKlient = getClosest(event, '.delete-btn');
        if (btnDeleteKlient) {
            const klientGroup = getClosest(event, '.client-group');
            const klientId = klientGroup?.dataset.id;
            if (klientId && confirm('Usunięcie klienta usunie też jego maszyny i zlecenia. Kontynuować?')) {
                if (!ensureDbOrNotify()) {
                    return;
                }
                await deleteDoc(doc(db, "klienci", klientId));
                wyswietlMaszyny();
                wyswietlKlientow();
            }
        }
    }

        async function pokazHistorieSerwisowaMaszyny(maszynaId, maszynaNazwa) {
        if (!machineHistoryModal || !machineHistoryList) {
            console.warn('[Maszyny] Brak elementów modala historii maszyn.');
            return;
        }
        const historyTitle = document.getElementById('machine-history-title');
        if (historyTitle) historyTitle.textContent = `Historia Serwisowa: ${maszynaNazwa}`;
        machineHistoryList.innerHTML = '<p>Ładowanie historii...</p>';
        openModal(machineHistoryModal);

        if (!ensureDb()) {
            machineHistoryList.innerHTML = '<p>Brak połączenia z bazą danych.</p>';
            return;
        }


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
                                Fakturowano: <strong>${zlecenie.wyfakturowaneGodziny || 0}h</strong> | Typ: <strong>${zlecenie.typZlecenia || '?'} </strong>
                                ${uzyteCzesciHtml}${wzHtml}${notatkaHtml}
                            </span>
                            <div>
                                <button type="button" class="btn-details details-zlecenie-btn" data-id="${d.id}">Szczegóły</button>
                                <button type="button" class="btn-edit edit-zlecenie-btn" data-id="${d.id}">Edytuj</button>
                            </div>
                        </li>`;
                });
                historiaHtml = `<ul>${historiaHtml}</ul>`;
            }

            machineHistoryList.innerHTML = historiaHtml || '<p>Brak historii serwisowej dla tej maszyny.</p>';

        } catch (error) {
            console.error("Błąd podczas pobierania historii serwisowej:", error);
            machineHistoryList.innerHTML = '<p style="color: red;">Wystąpił błąd podczas ładowania historii.</p>';
        }
    }
    async function obslugaListyZlecenWModaluHistorii(event) {
        const target = event?.target;
        if (!(target instanceof Element)) {
            return;
        }
        const btnDetailsModal = getClosest(event, '.details-zlecenie-btn');
        if (btnDetailsModal) {
            const zlecenieElement = getClosest(event, 'li[data-id]');
            const zlecenieIdModalDetails = zlecenieElement?.dataset.id;
            if (zlecenieIdModalDetails) {
                await otworzModalSzczegolowZlecenia(zlecenieIdModalDetails);
            }
            return;
        }
        
        const btnEditModal = getClosest(event, '.edit-zlecenie-btn');
        if (btnEditModal) {
            const zlecenieElement = getClosest(event, 'li[data-id]');
            const zlecenieIdModalEdit = zlecenieElement?.dataset.id;
            if (zlecenieIdModalEdit) {
                await otworzModalEdycjiZlecenia(zlecenieIdModalEdit);
            }
        }
    }

    function otworzModalEdycjiKlienta(klientId) {
        if (!editKlientForm || !editKlientModal) {
            console.warn('[Klienci] Brak formularza lub modala edycji klienta.');
            return;
        }
        const klient = _wszystkieKlienciCache.find(k => k.id === klientId);
        if (!klient) return;
        editKlientForm['edit-klient-id'].value = klient.id;
        editKlientForm['edit-klient-nazwa'].value = klient.nazwa;
        editKlientForm['edit-klient-nip'].value = klient.nip === '---' ? '' : klient.nip;
        editKlientForm['edit-klient-adres'].value = klient.adres === '---' ? '' : klient.adres;
        editKlientForm['edit-klient-telefon'].value = klient.telefon === '---' ? '' : klient.telefon;
        openModal(editKlientModal);
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
        if (!ensureDbOrNotify()) {
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

            closeModal(editKlientModal);
        } catch (e) {
            console.error("Błąd aktualizacji klienta lub powiązanych dokumentów:", e);
            alert("Wystąpił błąd podczas zapisywania zmian. Sprawdź konsolę.");
        }
    }

    // --- MASZYNY ---
    async function dodajMaszyne(event) {
        event.preventDefault();
        if (!ensureDbOrNotify()) {
            return;
        }
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

    function toggleMaszynyGrupy(listaElement, arrowElement, headerElement) {
        if (!listaElement || !headerElement) {
            return;
        }
        const jestOtwarte = headerElement.classList.contains('open');
        if (jestOtwarte) {
            headerElement.classList.remove('open');
            listaElement.classList.remove('open');
            arrowElement?.classList.add('collapsed');
        } else {
            headerElement.classList.add('open');
            listaElement.classList.add('open');
            arrowElement?.classList.remove('collapsed');
        }
    }

    function wyswietlMaszyny() {
        if (!listaMaszynDiv) return;
        if (_wszystkieKlienciCache.length === 0 && _wszystkieMaszynyCache.length > 0) {
            listaMaszynDiv.innerHTML = '<p>Ładowanie danych klientów...</p>';
            return;
        }
        
        const fraza = (maszynaSearchInput?.value || '').trim().toLowerCase();
        wszystkieMaszyny = [];

        const przefiltrowaneMaszyny = (_wszystkieMaszynyCache || []).filter(maszyna => {
            if (!fraza) return true;
            const tekst = `${maszyna.klientNazwa} ${maszyna.typMaszyny} ${maszyna.model} ${maszyna.nrSeryjny}`.toLowerCase();
            return tekst.includes(fraza);
        });

        const grupy = new Map();
        przefiltrowaneMaszyny.forEach((maszyna, index) => {
            wszystkieMaszyny.push(maszyna);
            const klientId = maszyna.klientId || '';
            const key = klientId || `nieprzypisany-${index}`;
            if (!grupy.has(key)) {
                const klient = _wszystkieKlienciCache.find(k => k.id === klientId);
                const nazwa = klient?.nazwa || maszyna.klientNazwa || 'Nieprzypisany klient';
                grupy.set(key, { klientId, nazwa, maszyny: [] });
            }
            grupy.get(key).maszyny.push(maszyna);
        });

        const zawartosc = Array.from(grupy.values())
            .sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl', { sensitivity: 'base' }))
            .map((grupa, idx) => {
                const suffix = grupa.klientId || `group-${idx}`;
                const targetId = `machines-${suffix}`;
                const listaMaszyn = grupa.maszyny
                    .sort((a, b) => (a.typMaszyny || '').localeCompare(b.typMaszyny || '', 'pl', { sensitivity: 'base' })
                        || (a.model || '').localeCompare(b.model || '', 'pl', { sensitivity: 'base' }))
                    .map(maszyna => {
                        const typ = maszyna.typMaszyny || '---';
                        const model = maszyna.model || '';
                        const label = `${typ} ${model}`.trim();
                        const numerSeryjny = maszyna.nrSeryjny && maszyna.nrSeryjny !== '---' ? maszyna.nrSeryjny : 'brak';
                        return `
                            <li data-id="${maszyna.id}">
                                <span>${label} (S/N: ${numerSeryjny})</span>
                                <div>
                                    <a href="#" class="machine-history-link" data-maszyna-id="${maszyna.id}" data-maszyna-nazwa="${label}">Historia</a>
                                    <button class="btn-edit edit-maszyna-btn">Edytuj</button>
                                    <button class="delete-btn">Usuń</button>
                                </div>
                            </li>`;
                    }).join('');

                return `
                    <div class="client-group" data-id="${grupa.klientId || ''}">
                        <div class="client-header" data-target="${targetId}">
                            <div class="client-header-text"><h4>${grupa.nazwa}</h4></div>
                            <span class="toggle-machines-arrow collapsed" data-target="${targetId}">▼</span>
                        </div>
                        <ul id="${targetId}" class="machine-list" data-client-id="${grupa.klientId || ''}">
                            ${listaMaszyn}
                        </ul>
                    </div>`;
            }).join('');

        listaMaszynDiv.innerHTML = zawartosc || '<p>Brak maszyn w bazie lub pasujących do wyszukiwania.</p>';
        if (zlecenieKlientSelect) {
            zlecenieKlientSelect.dispatchEvent(new Event('change'));
        }
    }

    function aktualizujMaszynyDlaZlecenia() {
        if (!zlecenieMaszynaSelect) return;

        const wybranyKlientId = zlecenieKlientSelect.value;

        if (wybranyKlientId === 'szybkie-zlecenie') {
            zlecenieMaszynaSelect.innerHTML = '<option value="">-- N/A --</option>';
            zlecenieMaszynaSelect.disabled = true;
            return;
        }


        if (!wybranyKlientId) {
            zlecenieMaszynaSelect.innerHTML = '<option value="">-- Najpierw wybierz klienta --</option>';
            zlecenieMaszynaSelect.disabled = true;
            return;
        }

        const maszynyKlienta = _wszystkieMaszynyCache
            .filter(maszyna => maszyna.klientId === wybranyKlientId)
            .sort((a, b) => {
                const typPorownanie = (a.typMaszyny || '').localeCompare(b.typMaszyny || '', 'pl', { sensitivity: 'base' });
                if (typPorownanie !== 0) return typPorownanie;
                return (a.model || '').localeCompare(b.model || '', 'pl', { sensitivity: 'base' });
            });

        if (maszynyKlienta.length === 0) {
            zlecenieMaszynaSelect.innerHTML = '<option value="">-- Ten klient nie ma maszyn --</option>';
            zlecenieMaszynaSelect.disabled = true;
            return;
        }

        const opcjeMaszyn = maszynyKlienta
            .map(maszyna => {
                const sn = maszyna.nrSeryjny && maszyna.nrSeryjny !== '---' ? ` (S/N: ${maszyna.nrSeryjny})` : '';
                const typ = maszyna.typMaszyny || '';
                const model = maszyna.model || '';
                return `<option value="${maszyna.id}">${[typ, model].filter(Boolean).join(' ')}${sn}</option>`;
            })
            .join('');

        zlecenieMaszynaSelect.innerHTML = `<option value="">-- Wybierz maszynę --</option>${opcjeMaszyn}`;
        zlecenieMaszynaSelect.disabled = false;
    }

    function aktualizujMaszynyDlaAssign(klientId) {
        if (!assignMaszynaSelect) {
            return;
        }
        const bazowaOpcja = '<option value="">-- Wybierz maszynę --</option>';
        if (!klientId) {
            assignMaszynaSelect.innerHTML = bazowaOpcja;
            assignMaszynaSelect.disabled = true;
            return;
        }
        const maszynyKlienta = (_wszystkieMaszynyCache || [])
            .filter(maszyna => maszyna.klientId === klientId)
            .sort((a, b) => (a.typMaszyny || '').localeCompare(b.typMaszyny || '', 'pl', { sensitivity: 'base' })
                || (a.model || '').localeCompare(b.model || '', 'pl', { sensitivity: 'base' }));
        if (maszynyKlienta.length === 0) {
            assignMaszynaSelect.innerHTML = `${bazowaOpcja}<option value="">-- Brak maszyn przypisanych --</option>`;
            assignMaszynaSelect.disabled = true;
            return;
        }
        const opcje = maszynyKlienta.map(maszyna => {
            const typ = maszyna.typMaszyny || '';
            const model = maszyna.model || '';
            const sn = maszyna.nrSeryjny && maszyna.nrSeryjny !== '---' ? ` (S/N: ${maszyna.nrSeryjny})` : '';
            const etykieta = [typ, model].filter(Boolean).join(' ') || 'Maszyna';
            return `<option value="${maszyna.id}">${etykieta}${sn}</option>`;
        }).join('');
        assignMaszynaSelect.innerHTML = `${bazowaOpcja}${opcje}`;
        assignMaszynaSelect.disabled = false;
    }


    function nasluchujNaMaszyny() {
        if (!ensureDb()) {
            if (listaMaszynDiv) {
                listaMaszynDiv.innerHTML = '<p>Brak połączenia z bazą danych.</p>';
            }
            return;
        }
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
        const target = event?.target;
        if (!(target instanceof Element)) {
            return;
        }
        const header = getClosest(event, '.client-header');
        if (header && !getClosest(event, '.client-header-actions')) {
            const arrowElement = header.querySelector('.toggle-machines-arrow');
            const targetId = header.dataset.target || arrowElement?.dataset.target;
            const listaElement = targetId ? document.getElementById(targetId) : header.nextElementSibling;
            toggleMaszynyGrupy(listaElement, arrowElement, header);
            return;
        }

    const linkHistoriaMaszyny = getClosest(event, '.machine-history-link');
        if (linkHistoriaMaszyny) {
            event.preventDefault();
            const maszynaElement = getClosest(event, 'li[data-id]');
            const maszynaId = linkHistoriaMaszyny.dataset.maszynaId || maszynaElement?.dataset.id || '';
            const maszynaNazwa = linkHistoriaMaszyny.dataset.maszynaNazwa
                || maszynaElement?.querySelector('span')?.textContent?.trim()
                || '';
            if (maszynaId) {
                pokazHistorieSerwisowaMaszyny(maszynaId, maszynaNazwa);
            }
            return;
        }

        const btnDetailsZlecenie = getClosest(event, '.details-zlecenie-btn, .btn-details');
        if (btnDetailsZlecenie) {
            const zlecenieElement = getClosest(event, 'li[data-id]');
            const zlecenieId = btnDetailsZlecenie.dataset.id || zlecenieElement?.dataset.id;
            if (zlecenieId) {
                await otworzModalSzczegolowZlecenia(zlecenieId);
            }
            return;
        }

    const btnDeleteMaszyna = getClosest(event, '.delete-btn');
    if (btnDeleteMaszyna) {
        const maszynaElement = getClosest(event, 'li[data-id]');
        const maszynaId = maszynaElement?.dataset.id;
        if (maszynaId && confirm('Usunąć tę maszynę (oraz jej zlecenia)?')) {
            if (!ensureDbOrNotify()) {
                return;
            }
            await deleteDoc(doc(db, "maszyny", maszynaId));
            wyswietlKlientow();
            wyswietlMaszyny();
        }
    }

async function otworzModalEdycjiMaszyny(maszynaId) {
    if (!editMaszynaForm || !editMaszynaModal) {
        console.warn('[Maszyny] Brak formularza lub modala edycji maszyny.');
        return;
    }
    try {
        const maszyna = await pobierzMaszyneZCache(maszynaId);
        if (!maszyna) {
            alert('Nie znaleziono danych maszyny do edycji.');
            return;
        }
        editMaszynaForm['edit-maszyna-id'].value = maszyna.id;
        const klientNazwaEl = document.getElementById('edit-maszyna-klient-nazwa');
        if (klientNazwaEl) klientNazwaEl.textContent = maszyna.klientNazwa || '';
        editMaszynaForm['edit-maszyna-typ'].value = maszyna.typMaszyny || '';
        editMaszynaForm['edit-maszyna-model'].value = maszyna.model || '';
        editMaszynaForm['edit-maszyna-serial'].value = maszyna.nrSeryjny === '---' ? '' : (maszyna.nrSeryjny || '');
        editMaszynaForm['edit-maszyna-rok'].value = maszyna.rokProdukcji || '';
        editMaszynaForm['edit-maszyna-mth'].value = maszyna.motogodziny || 0;
        openModal(editMaszynaModal);
    } catch (error) {
        console.error('Błąd podczas przygotowywania edycji maszyny:', error);
        alert('Nie udało się wczytać danych maszyny do edycji.');
    }
}

    async function zapiszEdycjeMaszyny(event) {
        if (!editMaszynaForm) return;
        event.preventDefault();
        const maszynaId = editMaszynaForm['edit-maszyna-id'].value;
        const stareDane = _wszystkieMaszynyCache.find(m => m.id === maszynaId);
        if (!stareDane) {
            console.error("Nie znaleziono starych danych maszyny w cache!");
            alert("Wystąpił błąd podczas zapisu - nie znaleziono danych maszyny.");
            return;
        }
        if (!ensureDbOrNotify()) {
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

        closeModal(editMaszynaModal);
        wyswietlKlientow();
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
        if (aktywneZleceniaLista) aktywneZleceniaLista.innerHTML = '<p>Ładowanie danych maszyn...</p>';
        if (ukonczoneZleceniaLista) ukonczoneZleceniaLista.innerHTML = '<p>Ładowanie danych maszyn...</p>';
        return;
    }

    const fraza = (zlecenieSearchInput?.value || '').trim().toLowerCase();
    const selectedMonth = getSelectedFinishedMonth();
    wszystkieZlecenia = [];
    const aktywneItems = [];
    const zakonczoneItems = [];
    const finishedForSummary = [];

    (_wszystkieZleceniaCache || []).forEach(zlecenie => {
        const maszyna = _wszystkieMaszynyCache.find(m => m.id === zlecenie.maszynaId);
        const klient = _wszystkieKlienciCache.find(k => k.id === zlecenie.klientId);
        const nazwa = klient
            ? `${klient.nazwa}${maszyna ? ' - ' + [maszyna.typMaszyny, maszyna.model].filter(Boolean).join(' ') : ''}`
            : (zlecenie.nrZlecenia || 'Szybkie zlecenie');
        const searchable = [nazwa, zlecenie.nrZlecenia, klient?.nazwa, klient?.nip, klient?.adres, maszyna?.nrSeryjny]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
        if (fraza && !searchable.includes(fraza)) {
            return;
        }

        wszystkieZlecenia.push(zlecenie);

        if (zlecenie.status === 'aktywne' || zlecenie.status === 'nieprzypisane') {
            const opisHtml = zlecenie.opis ? `<em>${zlecenie.opis}</em>` : '<em>Brak opisu</em>';
            const actionBtn = zlecenie.status === 'nieprzypisane'
                ? `<button type="button" class="assign-btn btn-edit" data-id="${zlecenie.id}">Przypisz</button>`
                : `<button type="button" class="complete-btn" data-id="${zlecenie.id}">Zakończ</button>`;
            aktywneItems.push(`
                <li data-id="${zlecenie.id}">
                    <span><strong>${nazwa}</strong><br>${opisHtml}</span>
                    <div>
                        <button type="button" class="btn-details details-zlecenie-btn" data-id="${zlecenie.id}">Szczegóły</button>
                        ${actionBtn}
                        <button type="button" class="delete-btn" data-id="${zlecenie.id}">Usuń</button>
                    </div>
                </li>`);
            return;
        }

        if (zlecenie.status === 'ukończone') {
            const dataUkonczenia = typeof zlecenie.dataUkonczenia === 'string' ? zlecenie.dataUkonczenia : '';
            if (selectedMonth && (!dataUkonczenia || !dataUkonczenia.startsWith(selectedMonth))) {
                return;
            }
           
            const nazwaMaszyny = klient
                ? `${klient.nazwa}${maszyna ? ' - ' + [maszyna.typMaszyny, maszyna.model].filter(Boolean).join(' ') : ''}`
                : 'Zlecenie usuniętej maszyny';
            const uzyteCzesciHtml = zlecenie.uzyteCzesci?.length
                ? `<br><small>Użyto: ${zlecenie.uzyteCzesci.map(c => `${c.nazwa} (x${c.ilosc})`).join(', ')}</small>`
                : '';
            const wzHtml = zlecenie.zakonczenieNumerWZ ? `<br><small>WZ: ${zlecenie.zakonczenieNumerWZ}</small>` : '';
            const notatkaHtml = zlecenie.zakonczenieNotatka ? `<br><small>📝 ${zlecenie.zakonczenieNotatka}</small>` : '';

            finishedForSummary.push(zlecenie);
            
            zakonczoneItems.push(`
                <li data-id="${zlecenie.id}">
                    <span>
                        <strong>${nazwaMaszyny}</strong> (Nr: ${zlecenie.nrZlecenia})<br>
                        <em>Ukończono: ${dataUkonczenia || 'b.d.'}</em><br>
                        Fakturowano: <strong>${zlecenie.wyfakturowaneGodziny || 0}h</strong> | Typ: <strong>${zlecenie.typZlecenia || '?'}</strong>
                        ${uzyteCzesciHtml}${wzHtml}${notatkaHtml}
                    </span>
                    <div>
                        <button type="button" class="btn-details details-zlecenie-btn" data-id="${zlecenie.id}">Szczegóły</button>
                        <button type="button" class="btn-edit edit-zlecenie-btn" data-id="${zlecenie.id}">Edytuj</button>
                        <button type="button" class="btn-edit reopen-btn" data-id="${zlecenie.id}">Otwórz ponownie</button>
                        <button type="button" class="delete-btn" data-id="${zlecenie.id}">Usuń</button>
                    </div>
                </li>`);
        }
    });

    if (aktywneZleceniaLista) {
        aktywneZleceniaLista.innerHTML = aktywneItems.length
            ? `<ul>${aktywneItems.join('')}</ul>`
            : '<p>Brak aktywnych zleceń lub pasujących do wyszukiwania.</p>';
    }
    if (ukonczoneZleceniaLista) {
       ukonczoneZleceniaLista.innerHTML = zakonczoneItems.length
            ? `<ul>${zakonczoneItems.join('')}</ul>`
            : '<p>Brak ukończonych zleceń dla wybranego miesiąca.</p>'; 
    }
    renderFinishedMiniSummary(selectedMonth, finishedForSummary);
    renderZakonczoneSekcja();
}

function nasluchujNaZlecenia() {
    if (!ensureDb()) {
        if (aktywneZleceniaLista) aktywneZleceniaLista.innerHTML = '<p>Brak połączenia z bazą danych.</p>';
        if (ukonczoneZleceniaLista) ukonczoneZleceniaLista.innerHTML = '<p>Brak połączenia z bazą danych.</p>';
        return;
    }
    onSnapshot(query(collection(db, "zlecenia"), orderBy("createdAt", "desc")), (snapshot) => {
        _wszystkieZleceniaCache = [];
        wszystkieZlecenia = [];
        snapshot.forEach(docSnap => {
            const zlecenie = { id: docSnap.id, ...docSnap.data() };
            _wszystkieZleceniaCache.push(zlecenie);
            wszystkieZlecenia.push(zlecenie);
        });
        updateFinishedMonthOptions();
        wyswietlZlecenia();
        odswiezPodsumowania();
    });
}

async function dodajZlecenie(event) {
    event.preventDefault();
    if (!ensureDbOrNotify()) {
        return;
    }
    const wybranyKlientId = zlecenieKlientSelect.value;
    const wybranaMaszynaId = zlecenieMaszynaSelect.value;
    const dataRozpoczecia = null;
    const dataZakonczenia = null;

    const historia = [{ timestamp: new Date().toISOString(), akcja: "Utworzono zlecenie" }];

    const nrZleceniaValue = zlecenieForm['nr-zlecenia'].value.trim();
    if (!nrZleceniaValue) {
        alert('Podaj numer zlecenia.');
        return;
    }

    const isQuickOrder = wybranyKlientId === 'szybkie-zlecenie';
    if (!wybranyKlientId) {
        alert('Wybierz klienta lub opcję "Szybkie zlecenie".');
        return;
    }

    let dane;

    if (isQuickOrder) {
        dane = {
            maszynaId: null,
            klientId: null,
            klientNazwa: null,
            typMaszyny: null,
            model: null,
            status: 'nieprzypisane',
            nrZlecenia: nrZleceniaValue,
            opis: zlecenieForm['opis-usterki'].value,
            motogodziny: Number(zlecenieForm.motogodziny.value) || 0,
            dataRozpoczecia,
            dataZakonczenia,
            historia,
            createdAt: new Date(),
            zakonczenieNotatka: null,
            zakonczenieNumerWZ: null
        };
    } else {
        if (!wybranaMaszynaId) {
            alert('Wybierz maszynę przypisaną do klienta.');
            return;
        }

        const maszyna = _wszystkieMaszynyCache.find(m => m.id === wybranaMaszynaId);
        const klient = _wszystkieKlienciCache.find(k => k.id === wybranyKlientId);
        if (!maszyna || !klient) {
            alert('Błąd: Nie znaleziono danych klienta lub maszyny.');
            return;
        }

        dane = {
            maszynaId: wybranaMaszynaId,
            klientId: klient.id,
            klientNazwa: klient.nazwa,
            typMaszyny: maszyna.typMaszyny,
            model: maszyna.model,
            status: 'aktywne',
            nrZlecenia: nrZleceniaValue,
            opis: zlecenieForm['opis-usterki'].value,
            motogodziny: Number(zlecenieForm.motogodziny.value) || maszyna.motogodziny,
            dataRozpoczecia,
            dataZakonczenia,
            historia,
            createdAt: new Date(),
            zakonczenieNotatka: null,
            zakonczenieNumerWZ: null
        };
    }
    try {
        await addDoc(collection(db, "zlecenia"), dane);
        if (!isQuickOrder && dane.maszynaId && zlecenieForm.motogodziny.value) {
            await updateDoc(doc(db, "maszyny", dane.maszynaId), { motogodziny: dane.motogodziny });
        }
        zlecenieForm.reset();
        zlecenieKlientSelect.value = '';
        zlecenieMaszynaSelect.innerHTML = '<option value="">-- Najpierw wybierz klienta --</option>';
        zlecenieMaszynaSelect.disabled = true;
        zlecenieKlientSelect.dispatchEvent(new Event('change'));
    } catch (e) { console.error("Błąd dodawania zlecenia: ", e); }
}

async function obslugaListyZlecen(event) {
    const target = event?.target;
    if (!(target instanceof Element)) {
        return;
    }

    const btnDeleteZlecenie = getClosest(event, '.delete-btn');
    if (btnDeleteZlecenie) {
        const zlecenieElement = getClosest(event, 'li[data-id]');
        const zlecenieIdDelete = btnDeleteZlecenie.dataset.id || zlecenieElement?.dataset.id;
        if (!zlecenieIdDelete) return;
        if (!confirm('Na pewno usunąć zlecenie?')) return;
        if (!ensureDbOrNotify()) {
            return;
        }
        await deleteDoc(doc(db, "zlecenia", zlecenieIdDelete));
        return;
    }

    const btnDetailsZlecenie = getClosest(event, '.details-zlecenie-btn');
    if (btnDetailsZlecenie) {
        const zlecenieElement = getClosest(event, 'li[data-id]');
        const zlecenieIdDetails = btnDetailsZlecenie.dataset.id || zlecenieElement?.dataset.id;
        if (!zlecenieIdDetails) return;
        await otworzModalSzczegolowZlecenia(zlecenieIdDetails);
        return;
    }

    const btnEditZlecenie = getClosest(event, '.edit-zlecenie-btn');
    if (btnEditZlecenie) {
        const zlecenieElement = getClosest(event, 'li[data-id]');
        const zlecenieIdEdit = btnEditZlecenie.dataset.id || zlecenieElement?.dataset.id;
        if (zlecenieIdEdit) {
            await otworzModalEdycjiZlecenia(zlecenieIdEdit);
        }
        return;
    }

    const assignButton = getClosest(event, '.assign-btn');
    if (assignButton) {
        const zlecenieElement = getClosest(event, 'li[data-id]');
        const zlecenieIdAssign = assignButton.dataset.id || zlecenieElement?.dataset.id;
        if (!zlecenieIdAssign) return;
        const zlecenie = _wszystkieZleceniaCache.find(z => z.id === zlecenieIdAssign);
        if (zlecenie && assignForm && assignModal) {
            assignForm.reset();
            const assignIdInput = assignForm.querySelector('#assign-zlecenie-id');
            const assignOpis = document.getElementById('assign-zlecenie-opis');
            if (assignIdInput) assignIdInput.value = zlecenieIdAssign;
            if (assignOpis) assignOpis.textContent = zlecenie.nrZlecenia;
            if (assignKlientSelect) {
                assignKlientSelect.value = zlecenie.klientId || '';
                aktualizujMaszynyDlaAssign(assignKlientSelect.value);
            }
            if (assignMaszynaSelect) {
                assignMaszynaSelect.value = zlecenie.maszynaId || '';
            }
            openModal(assignModal);
        }
        return;
    }

    const reopenButton = getClosest(event, '.reopen-btn');
    if (reopenButton) {
        const zlecenieElement = getClosest(event, 'li[data-id]');
        const reopenId = reopenButton.dataset.id || zlecenieElement?.dataset.id;
        if (!reopenId) return;
        await przywrocZlecenie(reopenId);
        return;
    }

    const btnCompleteZlecenie = getClosest(event, '.complete-btn');
    if (!btnCompleteZlecenie) return;
        const zlecenieElement = getClosest(event, 'li[data-id]');
        const zlecenieIdComplete = btnCompleteZlecenie.dataset.id || zlecenieElement?.dataset.id;
        if (!zlecenieIdComplete) return;
        if (!completeModal || !completeModalForm) {
            console.warn('[Zlecenia] Brakuje elementów modala zakończenia zlecenia.');
            return;
        }
        
        try {
            const docSnap = await getDoc(doc(db, "zlecenia", zlecenieIdComplete));
            if (!docSnap.exists()) {
                console.warn('Nie znaleziono zlecenia:', zlecenieIdComplete);
                return;
            }
            
            const zlecenie = docSnap.data();
            const maszyna = _wszystkieMaszynyCache.find(m => m.id === zlecenie.maszynaId);
            const klient = _wszystkieKlienciCache.find(k => k.id === zlecenie.klientId);
            const nazwaMaszyny = klient
                ? `${klient.nazwa} - ${maszyna ? maszyna.typMaszyny : ''} ${maszyna ? maszyna.model : ''}`
                : (zlecenie.nrZlecenia || 'Nieprzypisane');
            const modalKlient = document.getElementById('modal-klient');
            const modalNrZlecenia = document.getElementById('modal-nr-zlecenia');
            if (modalKlient) modalKlient.textContent = nazwaMaszyny;
            if (modalNrZlecenia) modalNrZlecenia.textContent = zlecenie.nrZlecenia;
            completeModalForm.reset();
            if (manualCloseDateInput) {
                manualCloseDateInput.value = getCurrentDateString();
            }
            const completeIdInput = document.getElementById('complete-zlecenie-id');
            if (completeIdInput) completeIdInput.value = zlecenieIdComplete;
            czesciDoZlecenia = [];
            renderCzesciDoZlecenia();
            renderMagazynWModalu();
            ensureZakonczenieNotatkaField();
            openModal(completeModal);
        } catch (error) {
            console.error('Błąd podczas otwierania modala zakończenia:', error);
            alert('Wystąpił błąd podczas otwierania formularza zakończenia zlecenia.');
        }
    }
}

async function przywrocZlecenie(zlecenieId) {
    if (!zlecenieId) return;
    if (!ensureDbOrNotify()) {
        return;
    }
    try {
        await runTransaction(db, async (transaction) => {
            const zlecenieRef = doc(db, 'zlecenia', zlecenieId);
            const snap = await transaction.get(zlecenieRef);
            if (!snap.exists()) {
                throw new Error('Zlecenie nie istnieje');
            }
            const dane = snap.data();
            const historia = Array.isArray(dane.historia) ? dane.historia.slice() : [];
            historia.push({
                timestamp: new Date().toISOString(),
                akcja: 'Przywrócono zlecenie do statusu aktywnego.'
            });
            transaction.update(zlecenieRef, {
                status: 'aktywne',
                dataUkonczenia: null,
                wyfakturowaneGodziny: dane.wyfakturowaneGodziny || 0,
                zakonczenieNotatka: null,
                zakonczenieNumerWZ: null,
                historia
            });
        });
    } catch (error) {
        console.error('Błąd przywracania zlecenia:', error);
        alert('Nie udało się przywrócić zlecenia.');
    }
}
async function otworzModalEdycjiZlecenia(zlecenieId) {
    if (!editZlecenieForm || !editZlecenieModal) {
        console.warn('[Zlecenia] Brak formularza lub modala edycji zlecenia.');
        return;
    }
    try {
        let zlecenie = _wszystkieZleceniaCache.find(z => z.id === zlecenieId);
        if (!zlecenie) {
            if (!ensureDbOrNotify()) {
                return;
            }
            const snap = await getDoc(doc(db, 'zlecenia', zlecenieId));
            if (!snap.exists()) {
                alert('Nie znaleziono danych zlecenia do edycji.');
                return;
            }
            zlecenie = { id: snap.id, ...snap.data() };
        }
        const maszyna = await pobierzMaszyneZCache(zlecenie.maszynaId);
        const klient = await pobierzKlientaZCache(zlecenie.klientId);
        const nazwaMaszyny = klient ? `${klient.nazwa} - ${maszyna ? maszyna.typMaszyny || '' : ''} ${maszyna ? maszyna.model || '' : ''}`.trim() : (zlecenie.nrZlecenia || 'Nieprzypisane');

        editZlecenieForm['edit-zlecenie-id'].value = zlecenie.id;
        const klientLabel = document.getElementById('edit-zlecenie-klient');
        if (klientLabel) klientLabel.textContent = nazwaMaszyny;
        const nrLabel = document.getElementById('edit-zlecenie-nr');
        if (nrLabel) nrLabel.textContent = zlecenie.nrZlecenia || zlecenie.id;
        editZlecenieForm['edit-wyfakturowane-godziny'].value = zlecenie.wyfakturowaneGodziny || 0;
        editZlecenieForm['edit-typ-zlecenia'].value = zlecenie.typZlecenia || 'S';
        editZlecenieForm['edit-zakonczenie-wz'].value = zlecenie.zakonczenieNumerWZ || '';

        openModal(editZlecenieModal);
    } catch (error) {
        console.error('Błąd podczas otwierania modala edycji zlecenia:', error);
        alert('Nie udało się otworzyć edycji zlecenia.');
    }  
}

async function zapiszEdycjeZlecenia(event) {
    if (!editZlecenieForm) return;
    event.preventDefault();
    const zlecenieId = editZlecenieForm['edit-zlecenie-id'].value;
    const noweGodziny = Number(editZlecenieForm['edit-wyfakturowane-godziny'].value);
    const nowyTyp = editZlecenieForm['edit-typ-zlecenia'].value;
    const nowyNumerWz = editZlecenieForm['edit-zakonczenie-wz'].value.trim();

    if (isNaN(noweGodziny) || noweGodziny < 0) {
        alert("Podaj poprawną liczbę godzin.");
        return;
    }

    if (!ensureDbOrNotify()) {
        return;
    }

    const zlecenieRef = doc(db, "zlecenia", zlecenieId);
    try {
        const zlecenieSnap = await getDoc(zlecenieRef);
        if (!zlecenieSnap.exists()) {
            alert('Nie znaleziono zlecenia do edycji.');
            return;
        }
        const zlecenieData = zlecenieSnap.data();
        const staraHistoria = zlecenieData.historia || [];
        const staryTyp = zlecenieData.typZlecenia;
        const stareGodziny = zlecenieData.wyfakturowaneGodziny;
        const staryNumerWz = zlecenieData.zakonczenieNumerWZ || '';

        let wpisHistorii = `Edytowano zakończone zlecenie: `;
        const zmiany = [];
        if (stareGodziny !== noweGodziny) zmiany.push(`Godziny zmieniono z ${stareGodziny}h na ${noweGodziny}h`);
        if (staryTyp !== nowyTyp) zmiany.push(`Typ zmieniono z ${staryTyp} na ${nowyTyp}`);
        if (staryNumerWz !== nowyNumerWz) {
            const staryTekst = staryNumerWz ? staryNumerWz : 'brak';
            const nowyTekst = nowyNumerWz ? nowyNumerWz : 'brak';
            zmiany.push(`Numer WZ zmieniono z ${staryTekst} na ${nowyTekst}`);
        }
        if (zmiany.length === 0) {
            closeModal(editZlecenieModal);
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
        closeModal(editZlecenieModal);
        alert("Zlecenie zaktualizowane.");
    } catch (e) {
        console.error("Błąd aktualizacji zlecenia:", e);
        alert("Wystąpił błąd podczas zapisywania zmian. Sprawdź konsolę.");
    }
}

async function otworzModalSzczegolowZlecenia(zlecenieId) {
    const titleEl = document.getElementById('details-zlecenie-title');
    const infoDiv = document.getElementById('details-zlecenie-info');
    const historiaDiv = document.getElementById('details-zlecenie-historia');
    const kalendarzDiv = document.getElementById('details-zlecenie-kalendarz');
    if (!detailsZlecenieModal || !titleEl || !infoDiv || !historiaDiv || !kalendarzDiv) {
        console.warn('[Zlecenia] Brakuje elementów modala szczegółów zlecenia.');
        return;
    }

        infoDiv.innerHTML = '<p>Ładowanie szczegółów zlecenia...</p>';
    historiaDiv.innerHTML = '';
    kalendarzDiv.innerHTML = '<p>Ładowanie wpisów z kalendarza...</p>';

    if (!ensureDb()) {
        infoDiv.innerHTML = '<p>Brak połączenia z bazą danych.</p>';
        historiaDiv.innerHTML = '';
        kalendarzDiv.innerHTML = '';
        openModal(detailsZlecenieModal);
        return;
    }


    try {
        const snap = await getDoc(doc(db, 'zlecenia', zlecenieId));
        if (!snap.exists()) {
            alert('Nie znaleziono zlecenia.');
            return;
        }
        const zlecenie = { id: snap.id, ...snap.data() };
        const maszyna = await pobierzMaszyneZCache(zlecenie.maszynaId);
        const klient = await pobierzKlientaZCache(zlecenie.klientId);
        const typStawkiOpis = STAWKI[zlecenie.typZlecenia]?.nazwa || 'Brak danych';
        const uzyteCzesci = Array.isArray(zlecenie.uzyteCzesci) ? zlecenie.uzyteCzesci : [];
        const uzyteCzesciOpis = uzyteCzesci.length > 0
            ? uzyteCzesci.map(czesc => {
                const ilosc = Number(czesc.ilosc);
                const wyswietlanaIlosc = Number.isFinite(ilosc) ? ilosc : 0;
                const oznaczenieOleju = czesc.jestOlejem ? ' (olej)' : '';
                return `${czesc.nazwa} (x${wyswietlanaIlosc})${oznaczenieOleju}`;
            }).join(', ')
            : 'Brak';

        titleEl.textContent = `Szczegóły Zlecenia #${zlecenie.nrZlecenia || zlecenie.id}`;
        const klientLabel = klient ? klient.nazwa : '---';
        const maszynaLabel = maszyna ? `${maszyna.typMaszyny || ''} ${maszyna.model || ''}`.trim() : '---';

        infoDiv.innerHTML = `
            <div class="details-group"><strong>Klient:</strong> <p>${klientLabel}</p></div>
            <div class="details-group"><strong>Maszyna:</strong> <p>${maszynaLabel}</p></div>
            <div class="details-group"><strong>Data Rozpoczęcia:</strong> <p>${zlecenie.dataRozpoczecia || 'Brak'}</p></div>
            <div class="details-group"><strong>Data Zakończenia:</strong> <p>${zlecenie.dataZakonczenia || 'Brak'}</p></div>
            <div class="details-group"><strong>Status:</strong> <p>${zlecenie.status || '---'}</p></div>
            <div class="details-group"><strong>Opis:</strong> <p>${zlecenie.opis || 'Brak opisu'}</p></div>
        `;

        if (zlecenie.status === 'ukończone') {
            const wzHtml = zlecenie.zakonczenieNumerWZ ? `<div class="details-group"><strong>Numer WZ:</strong> <p>${zlecenie.zakonczenieNumerWZ}</p></div>` : '';
            const notatkaHtml = zlecenie.zakonczenieNotatka ? `<div class="details-group"><strong>Notatka przy zakończeniu:</strong> <p>${zlecenie.zakonczenieNotatka}</p></div>` : '';
            infoDiv.innerHTML += `
                <div class="details-group"><strong>Data Faktycznego Zakończenia:</strong> <p>${zlecenie.dataUkonczenia || '---'}</p></div>
                <div class="details-group"><strong>Fakturowane Godziny:</strong> <p>${zlecenie.wyfakturowaneGodziny || 0} h</p></div>
                <div class="details-group"><strong>Typ Zlecenia:</strong> <p>${zlecenie.typZlecenia || '-'} (${typStawkiOpis})</p></div>
                <div class="details-group"><strong>Użyte Części:</strong> <p>${uzyteCzesciOpis}</p></div>
                ${wzHtml}${notatkaHtml}
            `;
        }

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


        const qKalendarz = query(
          collection(db, 'godziny_pracy'),
            where('zlecenieId', '==', zlecenieId)  
        );
        const querySnapshotKalendarz = await getDocs(qKalendarz);
        let wpisyKalendarza = querySnapshotKalendarz.docs
            .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
            .sort((a, b) => {
                const dataA = new Date(a.id);
                const dataB = new Date(b.id);
                const czasA = Number.isNaN(dataA.getTime()) ? 0 : dataA.getTime();
                const czasB = Number.isNaN(dataB.getTime()) ? 0 : dataB.getTime();
                if (czasA === czasB) {
                    return b.id.localeCompare(a.id);
                }
                return czasB - czasA;
            });

        if (!wpisyKalendarza.length) {
            wpisyKalendarza = wszystkieWpisyKalendarza
                .map(wpis => {
                    const { powiazane } = normalizujPowiazaneZlecenia(wpis);
                    const powiazanie = powiazane.find(p => p.zlecenieId === zlecenieId);
                    if (!powiazanie) return null;
                    return {
                        id: wpis.id,
                        praca: wpis.praca,
                        fakturowane: powiazanie.fakturowane,
                        nadgodziny: wpis.nadgodziny,
                        jazda: wpis.jazda,
                        notatka: wpis.notatka
                    };
                })
                .filter(Boolean)
                .sort((a, b) => {
                    const dataA = new Date(a.id);
                    const dataB = new Date(b.id);
                    const czasA = Number.isNaN(dataA.getTime()) ? 0 : dataA.getTime();
                    const czasB = Number.isNaN(dataB.getTime()) ? 0 : dataB.getTime();
                    if (czasA === czasB) {
                        return b.id.localeCompare(a.id);
                    }
                    return czasB - czasA;
                });
        }

        const kalendarzHtml = wpisyKalendarza.map(wpis => {
            const praca = formatujLiczbe(wpis.praca || 0);
            const fakturowane = formatujLiczbe(wpis.fakturowane || 0);
            const nadgodziny = formatujLiczbe(wpis.nadgodziny || 0);
            const jazda = formatujLiczbe(wpis.jazda || 0);
            const notatkaHtml = wpis.notatka ? `<br><small>Notatka: ${wpis.notatka}</small>` : '';
            return `
                <div class="calendar-entry-item">
                    <span class="date">[${wpis.id}]</span>
                    Praca: ${praca}h | Fakturowane: ${fakturowane}h | Nadgodziny: ${nadgodziny}h | Jazda: ${jazda}h
                    ${notatkaHtml}
                </div>`;
        }).join('');

        kalendarzDiv.innerHTML = kalendarzHtml || '<p>Brak powiązanych wpisów w kalendarzu.</p>';
        openModal(detailsZlecenieModal);
    } catch (error) {
        console.error('Błąd otwierania szczegółów zlecenia:', error);
        infoDiv.innerHTML = '<p style="color: #f87171;">Nie udało się wczytać szczegółów zlecenia.</p>';
        kalendarzDiv.innerHTML = '<p style="color: #f87171;">Nie udało się wczytać wpisów kalendarza.</p>';
        alert('Nie udało się wczytać szczegółów zlecenia.');
    }

}

   window.otworzModalSzczegolowZlecenia = otworzModalSzczegolowZlecenia;

 
async function zapiszPrzypisanie(event) {
    if (!assignForm || !assignModal) return;
    event.preventDefault();
    if (!ensureDbOrNotify()) {
        return;
    }
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
        closeModal(assignModal);
    } catch (error) {
        console.error("Błąd podczas przypisywania:", error);
        alert(`Wystąpił błąd: ${error.message}`);
    }
}

    function renderMagazynWModalu() {
        if (!modalMagazynLista) return;
        const itemsHtml = wszystkieProdukty
            .map(produkt => ({
                ...produkt,
                ilosc: wartoscLiczbowa(produkt.ilosc),
                jestOlejem: Boolean(produkt.jestOlejem)
            }))
            .filter(p => p.ilosc > 0)
            .map(p => `<div class="modal-stock-item" data-id="${p.id}" data-name="${p.nazwa}" data-qty="${p.ilosc}" data-is-oil="${p.jestOlejem}">
                <span>${p.nazwa}</span>
                <span class="item-qty">Na stanie: ${formatujIloscMagazynu(p.ilosc)} szt.</span>
            </div>`)
            .join('');
        modalMagazynLista.innerHTML = itemsHtml || '<p style="color:#94a3b8;">Brak części dostępnych na stanie.</p>';
    }

function dodajCzescDoZlecenia(event) {
    const itemDiv = getClosest(event, '.modal-stock-item'); if (!itemDiv) return;
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
    if (!partsToRemoveList) return;
    partsToRemoveList.innerHTML = czesciDoZlecenia.length > 0
        ? czesciDoZlecenia.map(c => `<li class="part-list-item" data-id="${c.id}">
            <span>${c.nazwa} - <strong>${formatujIloscMagazynu(c.ilosc)} szt.</strong></span>
            <div class="actions"><button type="button" class="btn-edit edit-part-btn">Edytuj</button>
            <button type="button" class="btn-remove remove-part-btn">Usuń</button></div></li>`).join('')
        : '<li style="color: #888; border: none; justify-content: center;">Brak części do zdjęcia.</li>';
}

async function obslugaListyCzesci(event) {
    const target = event?.target;
    if (!(target instanceof Element)) {
        return;
    }
    const li = getClosest(event, 'li'); if (!li) return;
    const id = li.dataset.id;
    if (target.classList.contains('remove-part-btn')) {
        czesciDoZlecenia = czesciDoZlecenia.filter(c => c.id !== id);
        renderCzesciDoZlecenia();
    }
    if (target.classList.contains('edit-part-btn')) {
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
    if (!completeModalForm || !completeModal) return;
    event.preventDefault();
    if (!ensureDbOrNotify()) {
        return;
    }
    const docId = document.getElementById('complete-zlecenie-id').value;
    if (!docId) { alert('Brak identyfikatora zlecenia.'); return; }
    const godzinyInput = document.getElementById('wyfakturowane-godziny');
    const typSelect = document.getElementById('typ-zlecenia');
    const numerWzInput = document.getElementById('zakonczenie-wz');
    const zakonczenieNotatkaInput = document.getElementById('zakonczenie-notatka');
    
    const wyfakturowane = Number(godzinyInput?.value || 0);
    if (!Number.isFinite(wyfakturowane) || wyfakturowane < 0) {
        alert('Podaj poprawną liczbę godzin.');
        return;
    }

    const manualDateValue = manualCloseDateInput && manualCloseDateInput.value ? manualCloseDateInput.value : getCurrentDateString();
    const dataZamkniecia = manualDateValue || getCurrentDateString();
    const numerWz = numerWzInput?.value.trim() || '';
    const notatka = zakonczenieNotatkaInput?.value.trim() || '';
    const dane = {
        status: 'ukończone',
        wyfakturowaneGodziny: wyfakturowane,
        typZlecenia: typSelect?.value || 'S',
        dataUkonczenia: dataZamkniecia,
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
            let wpisHistorii = `Zakończono zlecenie (data: ${dane.dataUkonczenia}). Godziny: ${dane.wyfakturowaneGodziny}h. Typ: ${dane.typZlecenia}.`;
            if (dane.zakonczenieNumerWZ) wpisHistorii += ` WZ: ${dane.zakonczenieNumerWZ}.`;
            if (notatka) wpisHistorii += ` Notatka: ${notatka}`;       
            const nowaHistoria = [...(zlecenieData.historia || []), {
                timestamp: new Date().toISOString(),
                akcja: wpisHistorii
               }];
            dane.historia = nowaHistoria;

            const partPromises = czesciDoZlecenia.map(czesc => t.get(doc(db, "magazyn", czesc.id)));
            const partDocs = await Promise.all(partPromises);
            t.update(zlecenieRef, dane);
            for (let i = 0; i < czesciDoZlecenia.length; i++) {
                const czesc = czesciDoZlecenia[i];
                const produktDoc = partDocs[i];
                if (!produktDoc.exists()) throw `Produkt ${czesc.nazwa} nie istnieje!`;
                const produktMagazynData = produktDoc.data();
                const aktualnaIlosc = Number(produktMagazynData.ilosc) || 0;
                const isOilProdukt = Boolean(produktMagazynData.jestOlejem);
                let nowaIlosc = aktualnaIlosc - czesc.ilosc;
                if (isOilProdukt) {
                    nowaIlosc = Number(nowaIlosc.toFixed(2));
                }
                if (nowaIlosc < 0) throw `Za mało produktu ${czesc.nazwa} na stanie!`;
                t.update(doc(db, "magazyn", czesc.id), { ilosc: nowaIlosc });
            }
        });
        alert("Zlecenie zakończone, stan magazynowy zaktualizowany!");
        closeModal(completeModal);
        completeModalForm.reset();
        if (manualCloseDateInput) {
            manualCloseDateInput.value = getCurrentDateString();
        }
    } catch (error) {
        console.error("BŁĄD TRANSAKCJI: ", error);
        alert(`Wystąpił błąd: ${error.message || error}`);
    }
}

    // --- MAGAZYN: dodawanie / masowe / oleje / konwerter / tabela / zmiana stanu / nasłuchiwanie ---
    async function dodajProduktDoMagazynu(event) {
        event.preventDefault();
        if (!ensureDbOrNotify()) {
            return;
        }
        const ilosc = Number(magazynForm['item-ilosc'].value);
        if (!Number.isFinite(ilosc) || ilosc <= 0) { alert("Podaj dodatnią ilość."); return; }
        if (!Number.isInteger(ilosc)) { alert("Ilość musi być liczbą całkowitą."); return; }
        const dane = {
            index: magazynForm['item-index'].value,
            nazwa: magazynForm['item-name'].value,
            ilosc,
            klient: magazynForm['item-klient'].value || '---',
            createdAt: new Date(),
            jestOlejem: false,
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
        if (!ensureDbOrNotify()) {
            return;
        }
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
                    const parsedIlosc = Number(ilosc.trim());
                    if (!Number.isFinite(parsedIlosc) || parsedIlosc <= 0) {
                        console.warn("Pominięto linię (nieprawidłowa ilość):", line);
                        continue;
                    }
                    if (!Number.isInteger(parsedIlosc)) {
                        console.warn("Pominięto linię (ilość musi być całkowita):", line);
                        continue;
                    }
                    await addDoc(collection(db, "magazyn"), {
                        index: index.trim(),
                        nazwa: nazwa.trim(),
                        ilosc: parsedIlosc,
                        klient,
                        jestOlejem: false,
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
        if (!oilTypeSelect || !oilContainerSizeSelect) return;
        if (!ensureDbOrNotify()) {
            return;
        }
        const typ = oilTypeSelect.value;
        const pojemnosc = Number(oilContainerSizeSelect.value);
        if (!Number.isFinite(pojemnosc) || pojemnosc <= 0) { alert("Wybierz poprawną pojemność."); return; }
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
        if (!oilContainerSizeSelect || !resultLitry || !resultSztuki) return;
        const pojemnosc = Number(oilContainerSizeSelect.value);
        if (isNaN(pojemnosc) || pojemnosc <= 0) return;
        const source = event?.target;
        if (!(source instanceof HTMLInputElement)) {
            return;
        }
        if (source.id === 'converter-litry') {
            if (converterSztukiInput) converterSztukiInput.value = '';
            const litry = Number(source.value);
            resultSztuki.textContent = litry > 0 ? `${(litry / pojemnosc).toFixed(3)} szt.` : '0.00 szt.';
            resultLitry.textContent = litry > 0 ? source.value + ' L' : '0.00 L';
        } else if (source.id === 'converter-sztuki') {
            if (converterLitryInput) converterLitryInput.value = '';
            const sztuki = Number(source.value);
            resultLitry.textContent = sztuki > 0 ? `${(sztuki * pojemnosc).toFixed(2)} L` : '0.00 L';
            resultSztuki.textContent = sztuki > 0 ? source.value + ' szt.' : '0.00 szt.';
        } else {
            if (converterLitryInput) converterLitryInput.value = '';
            if (converterSztukiInput) converterSztukiInput.value = '';
            resultLitry.textContent = '0.00 L';
            resultSztuki.textContent = '0.00 szt.';
        }
    }

    async function obslugaTabeliMagazynu(event) {
        const target = event?.target;
        if (!(target instanceof Element)) {
            return;
        }
        const tr = getClosest(event, 'tr'); if (!tr) return;
        const docId = tr.dataset.id;
        if (target.classList.contains('delete-btn')) {
            if (confirm("Na pewno usunąć?")) {
                if (!ensureDbOrNotify()) {
                    return;
                }
                await deleteDoc(doc(db, "magazyn", docId));
            }
        } else if (target.classList.contains('add-stock-btn') || target.classList.contains('remove-stock-btn')) {
            if (!stockModal) return;
            const titleEl = document.getElementById('stock-modal-title');
            const nameEl = document.getElementById('stock-modal-name');
            const currentQtyEl = document.getElementById('stock-modal-current-qty');
            const idInput = document.getElementById('stock-change-id');
            const qtyInput = document.getElementById('stock-change-qty');
            if (!titleEl || !nameEl || !currentQtyEl || !idInput || !qtyInput) return;

            stockChangeOperation = target.classList.contains('add-stock-btn') ? 'add' : 'remove';
            titleEl.textContent = stockChangeOperation === 'add' ? 'Dodaj do stanu' : 'Zdejmij ze stanu';
            nameEl.textContent = tr.dataset.name;
            currentQtyEl.textContent = Number(tr.dataset.qty).toFixed(2) + ' szt.';
            idInput.value = docId;
            qtyInput.step = tr.dataset.isOil === 'true' ? "0.01" : "1";
            qtyInput.placeholder = tr.dataset.isOil === 'true' ? "np. 0.5" : "Tylko liczby całkowite";
            qtyInput.value = '';
            openModal(stockModal);
        }
    }

    async function obslugaZmianyStanu(event) {
        if (!stockModalForm) return;
        event.preventDefault();
        if (!ensureDbOrNotify()) {
            return;
        }
        const docId = document.getElementById('stock-change-id').value;
        const changeInput = document.getElementById('stock-change-qty');
        if (!changeInput) return;
        const changeQty = Number(changeInput.value);
        if (!Number.isFinite(changeQty) || changeQty <= 0) { alert("Ilość musi być dodatnia liczbą."); return; }
        const docRef = doc(db, "magazyn", docId);
        try {
            await runTransaction(db, async (t) => {
                const sfDoc = await t.get(docRef);
                if (!sfDoc.exists()) { throw "Dokument nie istnieje!"; }
                const produktData = sfDoc.data();
                const currentQty = Number(produktData.ilosc) || 0;
                const isOil = Boolean(produktData.jestOlejem);
                if (!isOil && !Number.isInteger(changeQty)) {
                    throw "Dla tego produktu można podawać tylko liczby całkowite.";
                }
                let newQty = stockChangeOperation === 'add' ? currentQty + changeQty : currentQty - changeQty;
                if (isOil) {
                    newQty = Number(newQty.toFixed(2));
                }
                if (newQty < 0) { throw "Nie można zdjąć więcej niż jest na stanie!"; }
                t.update(docRef, { ilosc: newQty });
            });
            closeModal(stockModal);
            stockModalForm.reset();
        } catch (e) {
            console.error("Błąd transakcji: ", e);
            alert(`Wystąpił błąd: ${e.message || e}`);
        }
    }

    function wyswietlMagazyn() {
        if (!magazynLista) {
            console.warn('[UI] Element #magazyn-lista nie istnieje – pominięto render magazynu.');
            return;
        }
        if (!ensureDb()) {
            magazynLista.innerHTML = '<tr><td colspan="6">Brak połączenia z bazą danych.</td></tr>';
            renderMagazynPodsumowanie(0, 0, 0);
            return;
        }
        onSnapshot(query(collection(db, "magazyn"), orderBy("createdAt", "desc")), (snapshot) => {
            let html = '';
            wszystkieProdukty = [];
            let liczbaNiskich = 0;
            let sumaLitrowOlejow = 0;

            if (snapshot.empty) {
                magazynLista.innerHTML = '<tr><td colspan="6">Magazyn pusty.</td></tr>';
                renderMagazynPodsumowanie(0, 0, 0);
                return;
            }

            snapshot.forEach((docSnap) => {
                const produkt = docSnap.data();
                produkt.id = docSnap.id;
                produkt.ilosc = wartoscLiczbowa(produkt.ilosc);
                produkt.pojemnosc = wartoscLiczbowa(produkt.pojemnosc);
                const jestOlejem = Boolean(produkt.jestOlejem);
                produkt.jestOlejem = jestOlejem;
                const iloscFormatowana = formatujIloscMagazynu(produkt.ilosc);
                const iloscWLitrach = jestOlejem && produkt.pojemnosc
                    ? (produkt.ilosc * produkt.pojemnosc).toFixed(2) + ' L'
                    : '---';
                const datasetQty = produkt.ilosc;
                wszystkieProdukty.push(produkt);

                const iloscLiczbowa = Number(datasetQty) || 0;
                if (jestOlejem && produkt.pojemnosc) {
                    sumaLitrowOlejow += iloscLiczbowa * produkt.pojemnosc;
                }
                if (iloscLiczbowa <= NISKI_STAN_MAGAZYNOWY) {
                    liczbaNiskich += 1;
                }

                html += `
                    <tr data-id="${produkt.id}" data-name="${produkt.nazwa}" data-qty="${datasetQty}" data-is-oil="${jestOlejem}">
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

            magazynLista.innerHTML = html || '<tr><td colspan="6">Magazyn pusty.</td></tr>';
            renderMagazynPodsumowanie(wszystkieProdukty.length, sumaLitrowOlejow, liczbaNiskich);
            renderMagazynWModalu();
        });
    }

    function renderMagazynPodsumowanie(liczbaPozycji, sumaLitrowOlejow, liczbaNiskich) {
        if (!magazynMetricsContainer) {
            console.warn('[UI] Element .magazyn-metrics nie istnieje – pominięto podsumowanie magazynu.');
            return;
        }
        
        const lowStockClass = liczbaNiskich > 0 ? 'summary-value alert' : 'summary-value';
        const litryTxt = sumaLitrowOlejow > 0 ? `${formatujLiczbe(sumaLitrowOlejow)} L` : '---';

        magazynMetricsContainer.innerHTML = `
            <div class="summary-item">
                <span class="summary-label">Łączna liczba pozycji</span>
                <span class="summary-value">${liczbaPozycji}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Suma litrów (oleje)</span>
                <span class="summary-value">${litryTxt}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Pozycji poniżej progu (${NISKI_STAN_MAGAZYNOWY})</span>
                <span class="${lowStockClass}">${liczbaNiskich}</span>
            </div>
        `;
    }
  

    addListenerSafely(klientForm, 'submit', dodajKlienta, '#klient-form');
    addListenerSafely(listaKlientowDiv, 'click', obslugaListyKlientow, '#lista-klientow');

    addListenerSafely(maszynaForm, 'submit', dodajMaszyne, '#maszyna-form');
    addListenerSafely(listaMaszynDiv, 'click', obslugaListyMaszyn, '#lista-maszyn');

    // ZLECENIA
    addListenerSafely(zlecenieForm, 'submit', dodajZlecenie, '#zlecenie-form');
    addListenerSafely(assignForm, 'submit', zapiszPrzypisanie, '#assign-zlecenie-form');
    if (warnIfMissing(zlecenieKlientSelect, '#zlecenie-klient-select')) {
        zlecenieKlientSelect.addEventListener('change', aktualizujMaszynyDlaZlecenia);
        zlecenieKlientSelect.dispatchEvent(new Event('change'));
    }
    if (assignKlientSelect) {
        assignKlientSelect.addEventListener('change', () => {
            aktualizujMaszynyDlaAssign(assignKlientSelect.value);
        });
        aktualizujMaszynyDlaAssign(assignKlientSelect.value);
    }
    addListenerSafely(aktywneZleceniaLista, 'click', obslugaListyZlecen, '#aktywne-zlecenia-lista');
    addListenerSafely(ukonczoneZleceniaLista, 'click', obslugaListyZlecen, '#ukonczone-zlecenia-lista');
    addListenerSafely(machineHistoryList, 'click', obslugaListyZlecenWModaluHistorii, '#machine-history-list');

    addListenerSafely(completeModalForm, 'submit', obslugaZakonczeniaZlecenia, '#complete-zlecenie-form');
    if (closeModalButton && completeModal) {
        closeModalButton.onclick = () => { closeModal(completeModal); };
    }

    if (miesiacSummaryInput) {
        miesiacSummaryInput.addEventListener('change', () => {
            const wartosc = getSelectedMonth();
            synchronizujWyborMiesiaca(wartosc);
            wyswietlZlecenia();
            renderZakonczoneSekcja();
            renderPodsumowanieSekcja();
        });
    }
    if (zakonczoneMiesiacInput) {
        zakonczoneMiesiacInput.addEventListener('change', () => {
            const wartosc = getSelectedFinishedMonth();
            synchronizujWyborMiesiaca(wartosc);
            wyswietlZlecenia();
            renderZakonczoneSekcja();
            renderPodsumowanieSekcja();
        });
    }

    const exportZleceniaBtn = document.getElementById('export-zlecenia-btn');
    if (exportZleceniaBtn && miesiacSummaryInput) {
        exportZleceniaBtn.addEventListener('click', () => {
            const miesiac = getSelectedMonth();
            const dane = _wszystkieZleceniaCache
                .filter(z => z.status === 'ukończone' && z.dataUkonczenia && z.dataUkonczenia.startsWith(miesiac))
                .map(({ id, createdAt, status, uzyteCzesci, historia, ...rest }) => ({
                    ...rest,
                    uzyte_czesci: uzyteCzesci ? uzyteCzesci.map(c => c.nazwa).join(', ') : ''
                }));
            eksportujDoCSV(dane, `zlecenia_${miesiac}.csv`);
        });
    } else {
        if (!exportZleceniaBtn) console.warn('[UI] Element #export-zlecenia-btn nie istnieje w DOM.');
        if (!miesiacSummaryInput) console.warn('[UI] Element #miesiac-summary nie istnieje w DOM.');
    }

    // MAGAZYN
    addListenerSafely(magazynForm, 'submit', dodajProduktDoMagazynu, '#magazyn-form');
    addListenerSafely(bulkAddForm, 'submit', dodajMasowo, '#bulk-add-form');
    addListenerSafely(magazynLista, 'click', obslugaTabeliMagazynu, '#magazyn-lista');

    addListenerSafely(modalMagazynLista, 'click', dodajCzescDoZlecenia, '#modal-magazyn-lista');
    addListenerSafely(partsToRemoveList, 'click', obslugaListyCzesci, '#parts-to-remove-list');
    addListenerSafely(stockModalForm, 'submit', obslugaZmianyStanu, '#stock-change-form');
    if (stockModalCloseButton && stockModal) {
        stockModalCloseButton.onclick = () => { closeModal(stockModal); };
    } else if (!stockModalCloseButton) {
        console.warn('[UI] Przycisk zamykania w #stock-change-modal nie istnieje.');
    }
    

    addListenerSafely(addOilBtn, 'click', dodajOlej, '#add-oil-btn');
    addListenerSafely(converterLitryInput, 'input', przeliczOlej, '#converter-litry');
    addListenerSafely(converterSztukiInput, 'input', przeliczOlej, '#converter-sztuki');
    if (oilContainerSizeSelect) {
        oilContainerSizeSelect.addEventListener('change', () => { przeliczOlej({ target: { id: '' } }); });
       } else {
        console.warn('[UI] Element #oil-container-size nie istnieje w DOM.'); 
    }

    // KALENDARZ (modal + klik w kalendarzu)
    addListenerSafely(kalendarzForm, 'submit', obslugaZapisuGodzin, '#kalendarz-form');
    if (kalendarzForm && kalendarzForm['godziny-fakturowane']) {
        kalendarzForm['godziny-fakturowane'].addEventListener('input', () => {
            if (multiZlecenia.length === 0) {
                manualFakturowaneValue = Number(kalendarzForm['godziny-fakturowane'].value) || 0;
            }
        });
    }
    if (kalendarzContainer) kalendarzContainer.addEventListener('click', obslugaKalendarza);
    if (kalendarzModalCloseButton && kalendarzModal) {
        kalendarzModalCloseButton.onclick = () => { closeModal(kalendarzModal); };
        } else if (!kalendarzModalCloseButton) {
        console.warn('[UI] Przycisk zamknięcia modala kalendarza nie istnieje.');
    }
    addListenerSafely(kalendarzMultiAddButton, 'click', dodajLubZapiszMultiZlecenie, '.multi-add');
    addListenerSafely(kalendarzMultiList, 'click', obslugaListyMulti, '#kalendarz-zlecenia-list');

    // WYSZUKIWANIA
    addListenerSafely(klientSearchInput, 'input', wyswietlKlientow, '#klient-search-input');
    addListenerSafely(maszynaSearchInput, 'input', wyswietlMaszyny, '#maszyna-search-input');
    addListenerSafely(zlecenieSearchInput, 'input', wyswietlZlecenia, '#zlecenie-search-input');

    // EDYCJE (modale)
    addListenerSafely(editKlientForm, 'submit', zapiszEdycjeKlienta, '#edit-klient-form');
    addListenerSafely(editMaszynaForm, 'submit', zapiszEdycjeMaszyny, '#edit-maszyna-form');
    addListenerSafely(editZlecenieForm, 'submit', zapiszEdycjeZlecenia, '#edit-zlecenie-form');

    if (editKlientCloseButton && editKlientModal) {
        editKlientCloseButton.onclick = () => { closeModal(editKlientModal); };
    } else if (!editKlientCloseButton) {
        console.warn('[UI] Brak przycisku zamknięcia w modalu edycji klienta.');    
    }
    if (editMaszynaCloseButton && editMaszynaModal) {
        editMaszynaCloseButton.onclick = () => { closeModal(editMaszynaModal); };
    } else if (!editMaszynaCloseButton) {
        console.warn('[UI] Brak przycisku zamknięcia w modalu edycji maszyny.');
    }
    if (detailsZlecenieCloseButton && detailsZlecenieModal) {
        detailsZlecenieCloseButton.onclick = () => { closeModal(detailsZlecenieModal); };
     } else if (!detailsZlecenieCloseButton) {
        console.warn('[UI] Brak przycisku zamknięcia w szczegółach zlecenia.');
    }
    if (editZlecenieCloseButton && editZlecenieModal) {
        editZlecenieCloseButton.onclick = () => { closeModal(editZlecenieModal); };
    } else if (!editZlecenieCloseButton) {
        console.warn('[UI] Brak przycisku zamknięcia w modalu edycji zlecenia.');
    }
    if (machineHistoryCloseButton && machineHistoryModal) {
        machineHistoryCloseButton.onclick = () => { closeModal(machineHistoryModal); };
    } else if (!machineHistoryCloseButton) {
        console.warn('[UI] Brak przycisku zamknięcia w modalu historii maszyn.');
    }

    // Klik poza modal zamyka go
    document.addEventListener('click', (event) => {
        const targetElement = event?.target;
        if (!(targetElement instanceof Element)) {
            return;
        }

        const closeBtn = getClosest(event, '.close-button');
        if (closeBtn) {
            const modalWrapper = getClosest(event, '.modal');
            if (modalWrapper) {
                closeModal(modalWrapper);
            }
            return;
        }

        if (targetElement.classList.contains('modal') && targetElement.classList.contains('open')) {
            closeModal(targetElement);
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') {
            return;
        }
        document.querySelectorAll('.modal.open').forEach((modalElement) => {
            closeModal(modalElement);
        });
    });

    // --- INICJALIZACJA (MUSI BYĆ WEWNĄTRZ initializeApp) ---
    inicjalizujKalendarz();
    wyswietlWpisyKalendarza();
    nasluchujNaKlientow();
    nasluchujNaMaszyny();
    nasluchujNaZlecenia();
    wyswietlPrzejazdy(); // puste – OK
    wyswietlMagazyn();
    wyswietlZlecenia();
    renderZakonczoneSekcja();
    renderPodsumowanieSekcja();
} // koniec initializeApp()


document.addEventListener('DOMContentLoaded', () => {
    try {
        initializeApp();
    } catch (e) {
        console.error('Init error:', e);
    }
});