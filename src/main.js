import { db } from './firebase-config.js';
import { collection, query, orderBy, onSnapshot, doc, deleteDoc, updateDoc, getDoc, runTransaction, addDoc, setDoc, where, getDocs, serverTimestamp } from "firebase/firestore";
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
    const fhOf = (event) => (event?.extendedProps?.typ === 'LEAVE') ? 0 : Number(event?.extendedProps?.fh || 0);
    function ymNow() {
        const d = new Date();
        return { y: d.getFullYear(), m: d.getMonth() + 1 };
    }
    function lastMonths(y, m, n = 3) {
        const out = [];
        for (let i = 1; i <= n; i++) {
            const d = new Date(y, m - 1 - i, 1);
            out.push({ y: d.getFullYear(), m: d.getMonth() + 1 });
        }
        return out;
    }
    function getFH(y, m) {
        const list = (window.ostatnieZestawienieMiesieczne?.miesiace) || [];
        const rec = list.find(r => (r.rok === y || r.year === y) && ((r.miesiac === m) || (r.month === m) || (r.mm === m)));
        if (rec && rec.wyfakturowaneGodziny != null) return Number(rec.wyfakturowaneGodziny) || 0;
        try {
            if (window.calendar?.getEvents) {
                const s = new Date(y, m - 1, 1);
                const e = new Date(y, m, 0, 23, 59, 59, 999);
                return window.calendar.getEvents().reduce((acc, ev) => {
                    const st = ev.start;
                    if (st && st >= s && st <= e) acc += fhOf(ev);
                    return acc;
                }, 0);
            }
        } catch (_) { }
        return 0;
    }
    function ymFromMonthInput() {
        const el = document.getElementById('miesiac-summary');
        if (el && el.value) {
            const [y, m] = el.value.split('-').map(Number);
            return { y, m };
        }
        const d = new Date();
        return { y: d.getFullYear(), m: d.getMonth() + 1 };
    }
    function lastMonthsInclusive(y, m, n = 4) {
        const out = [];
        for (let i = n - 1; i >= 0; i--) {
            const d = new Date(y, m - 1 - i, 1);
            out.push({ y: d.getFullYear(), m: d.getMonth() + 1 });
        }
        return out;
    }
    function getFHfromSummary(y, m) {
        const list = (window.ostatnieZestawienieMiesieczne?.miesiace) || [];
        const rec = list.find(r => {
            let recordYear = Number(r?.rok ?? r?.year);
            let recordMonth = Number(r?.month ?? r?.mm);
            if (Number.isNaN(recordYear)) recordYear = null;
            if (Number.isNaN(recordMonth)) recordMonth = null;
            const rawMiesiac = r?.miesiac;
            if (!recordYear || !recordMonth) {
                if (typeof rawMiesiac === 'string') {
                    const normalized = rawMiesiac.replace(/[./]/g, '-');
                    const [yPart, mPart] = normalized.split('-');
                    if (!recordYear && yPart && yPart.length >= 4) recordYear = Number(yPart);
                    if (!recordMonth && mPart) recordMonth = Number(mPart);
                } else if (typeof rawMiesiac === 'number') {
                    recordMonth = recordMonth ?? Number(rawMiesiac);
                }
            }
            return recordYear === y && recordMonth === m;
        });
        if (rec && rec.wyfakturowaneGodziny != null) return Number(rec.wyfakturowaneGodziny) || 0;
        try {
            if (window.calendar?.getEvents) {
                const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
                const end = new Date(y, m, 0, 23, 59, 59, 999);
                return window.calendar.getEvents().reduce((s, e) => {
                    const d = e.start;
                    if (d && d >= start && d <= end) s += fhOf(e);
                    return s;
                }, 0);
            }
        } catch (_) { }
        return 0;
    }
    function renderFH3M(host, y, m) {
        if (!host) return;
        const months = lastMonthsInclusive(y, m, 4);
        const vals = months.map(({ y, m }) => getFHfromSummary(y, m));
        const max = Math.max(...vals, 1);
        const labels = months.map(({ y, m }) => `${String(m).padStart(2, '0')}.${String(y).slice(-2)}`);
        const curr = vals[3];
        const avg3 = (vals[0] + vals[1] + vals[2]) / 3;
        const deltaPct = avg3 > 0 ? ((curr - avg3) / avg3) * 100 : 0;
        host.innerHTML = `
    <div class="fh3m fh3m--trend">
      <div class="row">
        <div><strong>Wyfakturowane – ostatnie 3 mies.</strong></div>
        <div class="delta ${deltaPct >= 0 ? 'up' : 'down'}">${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(0)}%</div>
      </div>
      <div class="bars">
        ${vals.map((v, i) => `<div class="bar ${i < 3 ? 'dim' : ''}" style="height:${(v / max) * 100}%;" title="${labels[i]}: ${v.toFixed(1)} h"></div>`).join('')}
      </div>
      <div class="legend">
        <span>${labels[0]}</span><span>${labels[1]}</span><span>${labels[2]}</span><span>${labels[3]}</span>
      </div>
    </div>`;
    }
    const stripEwidencjaPrefix = (title = '') => (title || '').replace(/^Ewidencja dnia\s*[:•-]?\s*/i, '');
    const LEAVE_TITLE_MAP = {
        URL: 'Urlop',
        WOLNE: 'Wolne',
        L4: 'L4',
        SWIETO: 'Dzień wolny od pracy'
    };
    const LEAVE_ICON = { URL: '🌿', L4: '🩺', SWIETO: '🏳️' };
    const BAZA_MIESIECZNA_GODZIN = 168;
    const LEAVE_EVENT_PREFIX = 'leave_';
    const DAY_LEAVE_NONE = 'NONE';
    const DAY_LEAVE_VALUES = [DAY_LEAVE_NONE, 'URL', 'L4', 'SWIETO'];
    function obliczAbsorpcja(wyfakturowaneGodziny) {
        const v = Number(wyfakturowaneGodziny || 0);
        return v <= 0 ? 0 : (v / BAZA_MIESIECZNA_GODZIN) * 100;
    }
    function fmtPct(x, places = 1) {
        return `${(Number(x) || 0).toFixed(places)}%`;
    }
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
    window.ostatnieZestawienieMiesieczne = ostatnieZestawienieMiesieczne;
    let _wszystkieKlienciCache = [], _wszystkieMaszynyCache = [], _wszystkieZleceniaCache = [];
    const NISKI_STAN_MAGAZYNOWY = 5;
    let calendar;
    window.calendar = null;
    let workEvents = [];
    let leaveEvents = [];
    let leaveEventsReady = false;
    let edytowanyPrzejazdId = null;
    let stockChangeOperation = null;
    let multiZlecenia = [];
    let multiEdytowanyIndex = null;
    let manualFakturowaneValue = 0;

    // ✅ POPRAWKA: Dodano zmienne do zarządzania unsubscribe
    let unsubscribeKlienci = null;
    let unsubscribeMaszyny = null;
    let unsubscribeZlecenia = null;
    let unsubscribeGodziny = null;
    let unsubscribeUrlopy = null;

    const toDateSafe = (value) => {
        if (!value) return null;
        if (value.toDate && typeof value.toDate === 'function') {
            return value.toDate();
        }
        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : value;
        }
        if (typeof value === 'string' || typeof value === 'number') {
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        return null;
    };

    const formatDateTimeLabel = (value, fallback = '—') => {
        const date = toDateSafe(value);
        if (!date) return fallback;
        const datePart = date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timePart = date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
        return `${datePart} ${timePart}`;
    };

    const formatDatetimeLocalInput = (date) => {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
        const offset = date.getTimezoneOffset();
        const local = new Date(date.getTime() - offset * 60000);
        return local.toISOString().slice(0, 16);
    };

    const parseDatetimeInput = (value) => {
        if (!value) return null;
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const walidujPrzedzialCzasu = (startValue, endValue, options = {}) => {
        const { allowEndBeforeStart = false } = options;
        const startDate = toDateSafe(startValue);
        const endDate = toDateSafe(endValue);
        if (startDate && endDate && startDate > endDate) {
            if (allowEndBeforeStart) {
                alert('Zamykasz zlecenie datą wcześniejszą niż dodanie.');
                return true;
            }
            alert('Data zakończenia nie może być wcześniejsza niż rozpoczęcie.');
            return false;
        }
        return true;
    };

    // --- SELEKTORY ---
    const miesiacSummaryInput = document.getElementById('miesiac-summary');
    const zlecenieKlientSelect = document.getElementById('zlecenie-klient-select');
    const zlecenieKlientFilterInput = document.getElementById('zlecenie-klient-filter');
    const zlecenieMaszynaSelect = document.getElementById('zlecenie-maszyna-select');
    const kalendarzContainer = document.getElementById('kalendarz');
    const kalendarzModal = document.getElementById('kalendarz-modal');
    const kalendarzForm = document.getElementById('kalendarz-form');
    const kalendarzModalTitle = document.getElementById('kalendarz-modal-title');
    const kalendarzModalCloseButton = kalendarzModal ? kalendarzModal.querySelector('.close-button') : null;
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
    const closeModalButton = completeModal ? completeModal.querySelector('.close-button') : null;
    const zakonczoneSummaryContainer = document.getElementById('summary-container');
    const ordersSummaryControls = document.querySelector('#zakonczone-zlecenia-content .summary-controls');
    const annualSummaryContainer = document.getElementById('annual-summary');
    const modalMagazynLista = document.getElementById('modal-magazyn-lista');
    const partsToRemoveList = document.getElementById('parts-to-remove-list');
    const magazynForm = document.getElementById('magazyn-form');
    const magazynLista = document.getElementById('magazyn-lista');
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
    const zlecenieSearchInput = document.getElementById('zlecenie-search-input');
    const kalendarzMultiWrapper = document.getElementById('kalendarz-zlecenia-multi');
    const kalendarzMultiSelect = kalendarzMultiWrapper ? kalendarzMultiWrapper.querySelector('.multi-zlecenie-select') : null;
    const kalendarzMultiHoursInput = kalendarzMultiWrapper ? kalendarzMultiWrapper.querySelector('.multi-zlecenie-fh') : null;
    const kalendarzMultiAddButton = kalendarzMultiWrapper ? kalendarzMultiWrapper.querySelector('.multi-add') : null;
    const kalendarzMultiList = document.getElementById('kalendarz-zlecenia-list');
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
    const editZlecenieCloseButton = editZlecenieModal ? editZlecenieModal.querySelector('.close-button') : null;
    const machineHistoryCloseButton = machineHistoryModal ? machineHistoryModal.querySelector('.close-button') : null;
    const magazynTab = document.getElementById('magazyn');
    const magazynSummaryBox = document.getElementById('magazyn-summary');

    const normalizeAllDayDate = (value) => {
        if (!value) return null;
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    };

    const formatDateForStorage = (date) => {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const addDaysToDate = (date, days) => {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
        const clone = new Date(date.getTime());
        clone.setDate(clone.getDate() + days);
        return clone;
    };

    const normalizeDayLeaveValue = (value) => {
        const upper = (value ?? '').toString().trim().toUpperCase();
        if (!upper) return DAY_LEAVE_NONE;
        if (upper === 'WOLNE') return 'URL';
        return DAY_LEAVE_VALUES.includes(upper) ? upper : DAY_LEAVE_NONE;
    };

    const setDayLeaveValue = (value) => {
        if (!kalendarzForm) return;
        const normalized = normalizeDayLeaveValue(value);
        let matched = false;
        kalendarzForm.querySelectorAll('input[name="dayLeave"]').forEach(radio => {
            const radioValue = normalizeDayLeaveValue(radio.value);
            const isMatch = radioValue === normalized;
            radio.checked = isMatch;
            if (isMatch) matched = true;
        });
        if (!matched) {
            const fallback = kalendarzForm.querySelector('input[name="dayLeave"][value="NONE"]');
            if (fallback) fallback.checked = true;
        }
    };

    const getSelectedDayLeaveValue = () => {
        if (!kalendarzForm) return null;
        const checked = kalendarzForm.querySelector('input[name="dayLeave"]:checked');
        if (!checked) return null;
        const normalized = normalizeDayLeaveValue(checked.value);
        return normalized === DAY_LEAVE_NONE ? null : normalized;
    };

    const getLeaveKindClass = (value) => {
        const lower = (value || '').toLowerCase();
        return lower === 'url' ? 'wolne' : lower;
    };

    function addLeaveBadgeToCell(info) {
        if (!info?.event || !info.el) return;
        const iconKey = info.event.extendedProps?.leaveKind;
        if (!iconKey) return;
        const kind = getLeaveKindClass(iconKey);
        const icon = LEAVE_ICON[String(iconKey).toUpperCase()] || '•';

        let host = info.el.closest('.fc-daygrid-day');
        let frameSelector = '.fc-daygrid-day-frame';
        if (!host) {
            host = info.el.closest('.fc-timegrid-col');
            frameSelector = '.fc-timegrid-col-frame';
        }
        if (!host) return;

        const frame = host.querySelector(frameSelector) || host;
        frame.style.position = 'relative';
        frame.querySelectorAll('.leave-badge').forEach(node => node.remove());

        const badge = document.createElement('span');
        badge.className = `leave-badge ${kind}`;
        badge.textContent = icon;
        frame.appendChild(badge);
    }

    function ensureLeaveBadgesForBackgroundEvents() {
        if (!calendar) return;
        document.querySelectorAll('.fc .leave-badge').forEach(node => node.remove());
        calendar.getEvents().forEach(event => {
            if (event.extendedProps?.typ !== 'LEAVE') return;
            const selector = `.fc-daygrid-day[data-date="${event.startStr}"] .fc-daygrid-day-frame`;
            const timeSelector = `.fc-timegrid-col[data-date="${event.startStr}"] .fc-timegrid-col-frame`;
            const cell = document.querySelector(selector) || document.querySelector(timeSelector);
            if (cell) {
                addLeaveBadgeToCell({ el: cell, event });
            }
        });
    }

    const getLeaveEventDocId = (dateKey) => `${LEAVE_EVENT_PREFIX}${dateKey}`;

    async function syncLeaveEventForDay(dateKey, leaveKind) {
        if (!dateKey) return;
        const normalizedKind = normalizeDayLeaveValue(leaveKind || '');
        const leaveDocId = getLeaveEventDocId(dateKey);
        const leaveDocRef = doc(db, 'events', leaveDocId);
        if (!normalizedKind || normalizedKind === DAY_LEAVE_NONE) {
            try {
                await deleteDoc(leaveDocRef);
            } catch (_) { /* brak wpisu – pomijamy */ }
            const nextEvents = leaveEvents.filter(event => event.id !== leaveDocId);
            if (nextEvents.length !== leaveEvents.length) {
                leaveEvents = nextEvents;
                przerysujZdarzeniaKalendarza({ skipSummary: true });
            }
            return;
        }
        const startDate = normalizeAllDayDate(dateKey);
        if (!startDate) return;
        const payload = {
            title: LEAVE_TITLE_MAP[normalizedKind] || 'Urlop',
            start: formatDateForStorage(startDate),
            end: formatDateForStorage(addDaysToDate(startDate, 1)),
            allDay: true,
            display: 'background',
            extendedProps: { typ: 'LEAVE', leaveKind: normalizedKind }
        };
        await setDoc(leaveDocRef, payload);
        const withoutCurrent = leaveEvents.filter(event => event.id !== leaveDocId);
        leaveEvents = [...withoutCurrent, { id: leaveDocId, ...payload }];
        przerysujZdarzeniaKalendarza({ skipSummary: true });
    }

    const trackedModals = [];
    [kalendarzModal, completeModal, stockModal, assignModal, editKlientModal, editMaszynaModal, detailsZlecenieModal, editZlecenieModal, machineHistoryModal]
        .forEach(modal => { if (modal) trackedModals.push(modal); });

    const modalBackdrop = document.createElement('div');
    modalBackdrop.classList.add('modal-backdrop');
    document.body.appendChild(modalBackdrop);

    const showBackdrop = () => { modalBackdrop.style.display = 'block'; };
    const hideBackdrop = () => { modalBackdrop.style.display = 'none'; };
    const isAnyModalOpen = () => trackedModals.some(modal => modal && modal.style.display === 'block');

    const ensureMagazynSummaryPlacement = () => {
        if (magazynTab && magazynSummaryBox && magazynTab.firstElementChild !== magazynSummaryBox) {
            magazynTab.insertBefore(magazynSummaryBox, magazynTab.firstChild);
        }
    };

    function moveOrdersSearchBetweenSections() {
        const search = document.querySelector('#orders-search');
        const activeSection = document.querySelector('.orders-active');
        const finishedSection = document.querySelector('.orders-finished');
        if (!search || !activeSection || !finishedSection) return;

        let mid = document.querySelector('#orders-search-mid');
        if (!mid) {
            mid = document.createElement('div');
            mid.id = 'orders-search-mid';
            mid.className = 'orders-search-mid';
            finishedSection.parentElement.insertBefore(mid, finishedSection);
        }

        mid.appendChild(search);
    }

    const closeAllModals = (exceptModal = null) => {
        trackedModals.forEach(modal => {
            if (modal && modal !== exceptModal) {
                modal.style.display = 'none';
            }
        });
        if (!isAnyModalOpen()) {
            hideBackdrop();
        }
    };

    const openModal = (modal) => {
        if (!modal) return;
        closeAllModals(modal);
        modal.style.display = 'block';
        showBackdrop();
    };

    const hideModal = (modal) => {
        if (!modal) return;
        modal.style.display = 'none';
        if (!isAnyModalOpen()) {
            hideBackdrop();
        }
    };

    modalBackdrop.addEventListener('click', () => closeAllModals());

    const debounce = (fn, wait = 200) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(null, args), wait);
        };
    };

    const throttle = (fn, wait = 200) => {
        let last = 0;
        let timeout;
        return (...args) => {
            const now = Date.now();
            const remaining = wait - (now - last);
            if (remaining <= 0) {
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                last = now;
                fn.apply(null, args);
            } else if (!timeout) {
                timeout = setTimeout(() => {
                    last = Date.now();
                    timeout = null;
                    fn.apply(null, args);
                }, remaining);
            }
        };
    };

    ensureMagazynSummaryPlacement();

    // --- INICJALIZACJA UI / TABS / MOTYW ---
    window.openTab = (evt, tabName) => {
        document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
        document.querySelectorAll('.tab-button').forEach(button => button.classList.remove('active'));
        document.getElementById(tabName).style.display = 'block';
        evt.currentTarget.classList.add('active');
        if (tabName === 'magazyn') {
            ensureMagazynSummaryPlacement();
        }
    };
    const now = new Date();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    const currentMonth = `${year}-${month}`;
    if (miesiacSummaryInput) miesiacSummaryInput.value = currentMonth;
    const firstTabButton = document.querySelector('.tab-button');
    if (firstTabButton) {
        firstTabButton.click();
    }
    inicjujCiemnyMotyw();
    inicjujZwijanie();
    ensureZakonczenieNotatkaField();

    const odswiezSelectDebounced = debounce(() => odswiezSelectKlientaDoZlecenia(), 220);
    if (zlecenieKlientFilterInput) {
        zlecenieKlientFilterInput.addEventListener('input', odswiezSelectDebounced);
    }
    odswiezSelectKlientaDoZlecenia();

    const isMobileCalendarView = () => window.matchMedia('(max-width: 640px)').matches;
    const getCalendarHeaderToolbar = () => (isMobileCalendarView()
        ? { left: 'prev,next', center: 'title', right: 'listWeek,dayGridMonth' }
        : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,listWeek' });

    // --- KALENDARZ ---
    function inicjalizujKalendarz() {
        if (!kalendarzContainer) return;
        const initialView = isMobileCalendarView() ? 'listWeek' : 'dayGridMonth';
        calendar = new FullCalendar.Calendar(kalendarzContainer, {
            initialView,
            locale: 'pl',
            headerToolbar: getCalendarHeaderToolbar(),
            height: 'auto',
            contentHeight: 'auto',
            dayMaxEvent