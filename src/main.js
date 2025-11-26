import { db } from './firebase-config.js';
import { collection, query, orderBy, onSnapshot, doc, deleteDoc, updateDoc, getDoc, runTransaction, addDoc, setDoc, where, getDocs, serverTimestamp } from "firebase/firestore";
import Papa from 'papaparse';
import './styles/desktop-only.css';
import './styles/calendar-fixes.css';

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
    const fhOf = (event) => {
        const evType = event?.extendedProps?.type || event?.extendedProps?.typ;
        const isLeave = typeof evType === 'string' && evType.startsWith('LEAVE');
        return isLeave ? 0 : Number(event?.extendedProps?.fh || 0);
    };
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
    const LEAVE_ICON = { URL: '🌿', L4: '🩺', SWIETO: '🏁' };
    const BAZA_MIESIECZNA_GODZIN = 168;
    const DEFAULT_VACATION_ALLOWANCE = 26;
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
        l4Days: 0,
        urlopDays: 0,
        urlopDaysUsed: 0,
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
        lata: [],
        yearlyGrouped: {},
        years: []
    };
    let selectedSummaryYear = ymNow().y;
    let selectedVacationYear = ymNow().y;
    window.ostatnieZestawienieMiesieczne = ostatnieZestawienieMiesieczne;
    let _wszystkieKlienciCache = [], _wszystkieMaszynyCache = [], _wszystkieZleceniaCache = []; // Cache z Firebase
    const NISKI_STAN_MAGAZYNOWY = 5;
    let calendar;
    window.calendar = null;
    const handleCalendarResize = () => {
        try {
            calendar?.updateSize();
        } catch (_) { }
    };
    let workEvents = [];
    let leaveEvents = [];
    let leaveEventsReady = false;
    let edytowanyPrzejazdId = null;
    let stockChangeOperation = null;
    let multiZlecenia = [];
    let multiEdytowanyIndex = null;
    let manualFakturowaneValue = 0;

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
    const l4SummaryContainer = document.getElementById('l4-summary');
    const summaryYearSelect = document.getElementById('summary-year-select');
    const vacationYearSelect = document.getElementById('vacation-year');
    const vacationAllowanceInput = document.getElementById('vacation-allowance-input');
    const vacationAllowanceSaveBtn = document.getElementById('vacation-allowance-save');
    const vacationUsedSpan = document.getElementById('vacation-used');
    const vacationRemainingSpan = document.getElementById('vacation-remaining');
    const vacationAdjustmentsTotalSpan = document.getElementById('vacation-adjustments-total');
    const vacationAdjustmentForm = document.getElementById('vacation-adjustment-form');
    const vacationAdjustmentDateInput = document.getElementById('vacation-adjustment-date');
    const vacationAdjustmentDaysInput = document.getElementById('vacation-adjustment-days');
    const vacationAdjustmentNoteInput = document.getElementById('vacation-adjustment-note');
    const vacationAdjustmentsDiv = document.getElementById('vacation-adjustments');
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
                przerysujZdarzeniaKalendarza();
            }
            return;
        }
        const startDate = normalizeAllDayDate(dateKey);
        if (!startDate) return;
        const type = normalizedKind === 'L4'
            ? 'LEAVE_L4'
            : (normalizedKind === 'SWIETO' ? 'LEAVE_HOLIDAY' : 'LEAVE_FREE');
        const payload = {
            title: LEAVE_TITLE_MAP[normalizedKind] || 'Urlop',
            start: formatDateForStorage(startDate),
            end: formatDateForStorage(addDaysToDate(startDate, 1)),
            allDay: true,
            display: 'block',
            typ: type,
            type,
            extendedProps: { typ: type, type, leaveKind: normalizedKind }
        };
        await setDoc(leaveDocRef, payload);
        const withoutCurrent = leaveEvents.filter(event => event.id !== leaveDocId);
        leaveEvents = [...withoutCurrent, { id: leaveDocId, ...payload }];
        przerysujZdarzeniaKalendarza();
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
        firstTabButton.click(); // Otwórz pierwszą zakładkę
    }
    inicjujCiemnyMotyw();
    inicjujZwijanie();
    ensureZakonczenieNotatkaField(); // wstrzyknięcie pola notatki do modala (index.html bez zmian)

    const odswiezSelectDebounced = debounce(() => odswiezSelectKlientaDoZlecenia(), 220);
    if (zlecenieKlientFilterInput) {
        zlecenieKlientFilterInput.addEventListener('input', odswiezSelectDebounced);
    }
    odswiezSelectKlientaDoZlecenia();

    const dayGridPlugin = (window.dayGrid && window.dayGrid.default) || FullCalendar?.dayGridPlugin || FullCalendar?.dayGrid;
    const interactionPlugin = (window.interaction && window.interaction.default) || FullCalendar?.interactionPlugin || FullCalendar?.interaction;
    const calendarPlugins = [dayGridPlugin, interactionPlugin].filter(Boolean);

    function fmt(n) {
        const v = Math.round((n ?? 0) * 10) / 10;
        return v.toFixed(1);
    }

    function normalizeDayKey(value) {
        if (!value) return null;
        if (typeof value === 'string') return value.slice(0, 10);
        if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
        return null;
    }

    function buildEventSourceWithDailySummaries(baseEvents = []) {
        const byDay = {};
        const cleanEvents = baseEvents.filter(ev => {
            const classNames = ev?.className || ev?.classNames || [];
            if (Array.isArray(classNames) && classNames.includes('day-summary')) return false;
            if ((ev?.extendedProps?.kind || ev?.kind) === 'SUMMARY') return false;
            return true;
        });

        cleanEvents.forEach(ev => {
            const dayKey = normalizeDayKey(ev?.start || ev?.date);
            if (!dayKey) return;
            const t = ev?.extendedProps?.type || ev?.extendedProps?.typ;
            if (t === 'LEAVE_L4' || t === 'LEAVE_FREE' || t === 'LEAVE_HOLIDAY') {
                return;
            }
            if (!byDay[dayKey]) byDay[dayKey] = { work: 0, drive: 0, billed: 0, hasAny: false };
            const workHours = Number(ev?.extendedProps?.workHours ?? 0);
            const driveHours = Number(ev?.extendedProps?.driveHours ?? 0);
            const billedHours = Number(ev?.extendedProps?.billedHours ?? 0);
            byDay[dayKey].work += workHours;
            byDay[dayKey].drive += driveHours;
            byDay[dayKey].billed += billedHours;
            byDay[dayKey].hasAny = byDay[dayKey].hasAny || Boolean(workHours || driveHours || billedHours);
        });

        const summaryEvents = Object.entries(byDay)
            .filter(([, tot]) => tot.hasAny)
            .map(([day, tot]) => ({
                id: `sum-${day}`,
                start: day,
                allDay: true,
                display: 'block',
                className: ['day-summary'],
                title: `• Praca: ${fmt(tot.work)}h • Jazda: ${fmt(tot.drive)}h • Fakturowane: ${fmt(tot.billed)}h`,
                extendedProps: { kind: 'SUMMARY' }
            }));

        return [...cleanEvents, ...summaryEvents];
    }

    const openEwidencja = (dateStr) => {
        const normalized = dateStr || '';
        if (normalized) {
            otworzModalGodzin(normalized);
            if (calendar && typeof calendar.unselect === 'function') {
                calendar.unselect();
            }
        }
    };

    // --- KALENDARZ ---
    function inicjalizujKalendarz() {
        if (!kalendarzContainer) return;
        calendar = new FullCalendar.Calendar(kalendarzContainer, {
            plugins: calendarPlugins,
            initialView: 'dayGridMonth',
            headerToolbar: false,
            height: '100%',          // wypełnij kartę i nie wychodź poza nią
            expandRows: true,
            dayMaxEventRows: true,
            moreLinkClick: 'popover',
            handleWindowResize: true,
            firstDay: 1,
            locale: 'pl',
            selectable: true,
            selectMirror: true,
            unselectAuto: true,
            eventClassNames: (arg) => {
                const t = arg.event.extendedProps?.type;
                if (t === 'LEAVE_L4') return ['leave-event', 'leave-l4'];
                if (t === 'LEAVE_FREE') return ['leave-event', 'leave-free'];
                if (t === 'LEAVE_HOLIDAY') return ['leave-event', 'leave-holiday'];
                return [];
            },
            eventContent: (arg) => {
                const isSummary = arg.event.classNames?.includes('day-summary') || arg.event.extendedProps?.kind === 'SUMMARY';
                if (isSummary) {
                    return { html: `<div class="fc-event-title">${arg.event.title}</div>` };
                }
                const t = arg.event.extendedProps?.type;
                if (t?.startsWith('LEAVE_')) {
                    const icon = t === 'LEAVE_L4' ? '🩺' : (t === 'LEAVE_HOLIDAY' ? '🏳️' : '🌿');
                    return { html: `<div class="leave-icon">${icon}</div>` };
                }
                return { html: `<div class="evt">${arg.event.title}</div>` };
            },
            eventDidMount(info) {
                const ext = info.event.extendedProps || {};
                const rawType = (ext.type || ext.typ || '').toString().toUpperCase();
                const title = (info.event.title || '').toLowerCase();
                let leaveType = null;

                if (rawType === 'LEAVE_L4') leaveType = 'L4';
                else if (rawType === 'LEAVE_FREE') leaveType = 'WOLNE';
                else if (rawType === 'LEAVE_HOLIDAY') leaveType = 'SWIETO';

                if (!leaveType && typeof ext.leaveType === 'string') {
                    const v = ext.leaveType.toUpperCase();
                    if (v === 'L4' || v === 'WOLNE' || v === 'ŚWIĘTO' || v === 'SWIETO') {
                        leaveType = v === 'ŚWIĘTO' ? 'SWIETO' : v;
                    }
                }

                if (!leaveType && typeof ext.leaveKind === 'string') {
                    const kind = ext.leaveKind.toUpperCase();
                    if (kind === 'L4' || kind === 'WOLNE' || kind === 'ŚWIĘTO' || kind === 'SWIETO') {
                        leaveType = kind === 'ŚWIĘTO' ? 'SWIETO' : kind;
                    }
                }

                if (!leaveType) {
                    if (title.includes('l4')) leaveType = 'L4';
                    else if (title.includes('wolny') || title.includes('wolne')) leaveType = 'WOLNE';
                    else if (title.includes('święto') || title.includes('swieto')) leaveType = 'SWIETO';
                }

                if (leaveType) {
                    const frame = info.el.closest('.fc-daygrid-day-frame');
                    if (frame && !frame.querySelector('.leave-badge')) {
                        frame.classList.add('has-leave-label');
                        const badge = document.createElement('div');
                        badge.className = 'leave-badge ' + (
                            leaveType === 'L4' ? 'leave-badge--l4' :
                            leaveType === 'WOLNE' ? 'leave-badge--wolne' :
                            'leave-badge--swieto'
                        );

                        const svgL4 = `
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="L4">
                            <rect x="3" y="3" width="18" height="18" rx="4"></rect>
                            <path d="M12 7v10M7 12h10"></path>
                          </svg>`;
                        const svgLeaf = `
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="Wolne">
                            <path d="M3 21c7-1 12-6 12-13 3 0 6 3 6 6 0 6-6 10-12 10-2 0-4-1-6-3z"></path>
                            <path d="M9 15c1-3 3-5 6-6"></path>
                          </svg>`;
                        const svgFlag = `
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="Święto">
                            <path d="M4 22V4"></path>
                            <path d="M4 4h10l-2 3 2 3H4"></path>
                          </svg>`;

                        badge.innerHTML = leaveType === 'L4' ? svgL4 : (leaveType === 'WOLNE' ? svgLeaf : svgFlag);
                        frame.appendChild(badge);
                    }

                    info.el.style.display = 'none';
                }
            },
            events: buildEventSourceWithDailySummaries([...workEvents, ...leaveEvents]),
            datesSet(viewInfo) {
                if (viewInfo?.view?.currentStart && viewInfo?.view?.currentEnd) {
                    obliczSumeGodzinZKalendarza(viewInfo.view.currentStart, viewInfo.view.currentEnd);
                }
            },
            eventDataTransform(event) {
                if (event && typeof event.title === 'string') {
                    event.title = stripEwidencjaPrefix(event.title);
                }
                if (event?.extendedProps?.client && typeof event.extendedProps.client === 'string') {
                    event.extendedProps.client = stripEwidencjaPrefix(event.extendedProps.client);
                }
                return event;
            },
            windowResize() {
                handleCalendarResize();
            },
            dateClick: (info) => openEwidencja(info.dateStr),
            select(info) {
                const startDate = normalizeAllDayDate(info?.start);
                const normalized = info?.startStr || (startDate ? formatDateForStorage(startDate) : '');
                if (normalized) {
                    otworzModalGodzin(normalized);
                }
                if (calendar && typeof calendar.unselect === 'function') {
                    calendar.unselect();
                }
            }
        });
        window.calendar = calendar;
        calendar.render();
        const calendarShell = document.getElementById('calendar-shell') || kalendarzContainer;
        if (calendarShell) {
            const applySize = () => handleCalendarResize();
            applySize();
            // Bezpieczne tworzenie obserwatora (bez optional chaining po 'new')
            const RO = (typeof window !== 'undefined' && window.ResizeObserver) ? window.ResizeObserver : null;
            let ro = null;
            if (RO) {
                ro = new RO(() => applySize());
                ro.observe(calendarShell);
            } else {
                // Fallback dla starszych przeglądarek/środowisk: nasłuchuj resize
                const onResize = () => applySize();
                window.addEventListener('resize', onResize);
                // sprzątanie przy odmontowaniu komórki
                const observer = new MutationObserver((mutations) => {
                    for (const m of mutations) {
                        m.removedNodes && m.removedNodes.forEach((n) => {
                            if (n === calendarShell || (n.contains && n.contains(calendarShell))) {
                                window.removeEventListener('resize', onResize);
                                observer.disconnect();
                            }
                        });
                    }
                });
                observer.observe(calendarShell.parentNode || document.body, { childList: true });
            }
        }
        setTimeout(() => {
            calendar.updateSize();
            calendar.updateDates();
            window.dispatchEvent(new Event('resize'));
        }, 0);
        window.addEventListener('resize', handleCalendarResize);
    }

    async function otworzModalGodzin(data) {
        if (!kalendarzForm || !kalendarzModal || !kalendarzModalTitle) return;
        kalendarzModalTitle.textContent = `Ewidencja Czasu - ${data}`;
        kalendarzForm.reset();
        setDayLeaveValue(DAY_LEAVE_NONE);
        const kalendarzDataInput = document.getElementById('kalendarz-data');
        if (kalendarzDataInput) kalendarzDataInput.value = data;

        multiZlecenia = [];
        multiEdytowanyIndex = null;
        manualFakturowaneValue = 0;
        przygotujOpcjeMultiZlecen();
        resetujFormularzMulti();
        renderMultiZlecenia();


        const docRef = doc(db, "godziny_pracy", data);
        try {
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const dane = docSnap.data();
                const normalized = normalizeDayRecord(data, dane);
                kalendarzForm['godziny-pracy'].value = normalized.work || 0;
                kalendarzForm['nadgodziny'].value = dane.nadgodziny || 0;
                kalendarzForm['czas-jazdy'].value = normalized.drive || 0;
                kalendarzForm['kalendarz-notatka'].value = dane.notatka || '';
                manualFakturowaneValue = Number(dane.fakturowane ?? normalized.billed) || 0;
                const { powiazane, suma, maPowiazania } = normalizujPowiazaneZlecenia(dane);
                multiZlecenia = powiazane;
                if (maPowiazania) {
                    manualFakturowaneValue = suma;
                }
                renderMultiZlecenia();
                if (kalendarzForm['godziny-fakturowane'] && !maPowiazania) {
                    aktualizujPoleFakturowane(manualFakturowaneValue, false);
                }
                const leaveToSet = normalized.leaveKind || (normalized.flags?.urlop ? 'URL' : normalized.flags?.l4 ? 'L4' : normalized.flags?.swieto ? 'SWIETO' : DAY_LEAVE_NONE);
                setDayLeaveValue(leaveToSet || DAY_LEAVE_NONE);
            }
        } catch (error) {
            console.error("Błąd podczas pobierania danych ewidencji:", error);
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
        if (kalendarzMultiAddButton) kalendarzMultiAddButton.textContent = 'Dodaj';
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
        const target = event.target;
        const li = target.closest('li');
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

        const selectedLeaveKind = getSelectedDayLeaveValue();
        const flags = {
            urlop: selectedLeaveKind === 'URL',
            l4: selectedLeaveKind === 'L4',
            swieto: selectedLeaveKind === 'SWIETO'
        };
        const dane = {
            date: data,
            work: Number(kalendarzForm['godziny-pracy'].value) || 0,
            drive: Number(kalendarzForm['czas-jazdy'].value) || 0,
            billed: fakturowaneDoZapisu,
            praca: Number(kalendarzForm['godziny-pracy'].value) || 0,
            fakturowane: fakturowaneDoZapisu,
            nadgodziny: Number(kalendarzForm['nadgodziny'].value) || 0,
            jazda: Number(kalendarzForm['czas-jazdy'].value) || 0,
            notatka: kalendarzForm['kalendarz-notatka'].value || '',
            zleceniaPowiazane: powiazane,
            zlecenieId: powiazane.length === 1 ? powiazane[0].zlecenieId : null,
            klientNazwa: powiazane.length === 1 ? (powiazane[0].klientNazwa || null) : null,
            leaveKind: selectedLeaveKind || null,
            flags
        };
        try {
            await setDoc(doc(db, "godziny_pracy", data), dane);
            await syncLeaveEventForDay(data, selectedLeaveKind);
            const localRecord = normalizeDayRecord(data, dane);
            localRecord.fakturowane = fakturowaneDoZapisu;
            localRecord.billed = fakturowaneDoZapisu;
            localRecord.nadgodziny = Number(kalendarzForm['nadgodziny'].value) || 0;
            const existingIndex = wszystkieWpisyKalendarza.findIndex(w => w.id === data);
            if (existingIndex >= 0) {
                wszystkieWpisyKalendarza[existingIndex] = { ...wszystkieWpisyKalendarza[existingIndex], ...localRecord };
            } else {
                wszystkieWpisyKalendarza.push(localRecord);
            }
            hideModal(kalendarzModal);
            await odswiezPodsumowania({ skipRender: true });
            renderPulpit();
            renderZlecenia();
            renderPodsumowanie();
        } catch (e) {
            console.error("Błąd zapisu godzin: ", e);
        }
    }

    function przerysujZdarzeniaKalendarza(options = {}) {
        const { skipSummary = false } = options;
        if (!calendar) return;
        const combined = skipSummary ? [...workEvents, ...leaveEvents] : buildEventSourceWithDailySummaries([...workEvents, ...leaveEvents]);
        calendar.removeAllEvents();
        if (combined.length) {
            calendar.addEventSource(combined);
        }
        if (!skipSummary && calendar.view) {
            obliczSumeGodzinZKalendarza(calendar.view.currentStart, calendar.view.currentEnd);
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
                const normalizedDay = normalizeDayRecord(id, dane);
                const { powiazane, suma } = normalizujPowiazaneZlecenia(dane);
                const fakturowaneValue = powiazane.length > 0 ? suma : (Number(normalizedDay.billed) || 0);
                const workValue = Number(normalizedDay.work) || 0;
                const driveValue = Number(normalizedDay.drive) || 0;
                const billedHoursForSummary = powiazane.length > 0 ? 0 : fakturowaneValue;
                const baseHoursProps = {
                    workHours: workValue,
                    driveHours: driveValue,
                    billedHours: billedHoursForSummary
                };
                const wpis = {
                    ...normalizedDay,
                    billed: fakturowaneValue,
                    fakturowane: fakturowaneValue,
                    nadgodziny: Number(dane?.nadgodziny) || 0,
                    zleceniaPowiazane: powiazane
                };
                wszystkieWpisyKalendarza.push(wpis);
                if (leaveEventsReady) {
                    const normalizedLeave = normalizedDay.leaveKind ? normalizeDayLeaveValue(normalizedDay.leaveKind) : null;
                    const leaveEventId = getLeaveEventDocId(id);
                    const existingLeaveEvent = leaveEvents.find(event => event.id === leaveEventId) || null;
                    const existingKind = existingLeaveEvent?.extendedProps?.leaveKind || existingLeaveEvent?.leaveKind || '';
                    const normalizedExisting = existingKind ? normalizeDayLeaveValue(existingKind) : null;
                    if (normalizedLeave) {
                        if (normalizedExisting !== normalizedLeave) {
                            syncLeaveEventForDay(id, normalizedLeave).catch(err => {
                                console.warn('Nie udało się zsynchronizować urlopu dla dnia', id, err);
                            });
                        }
                    } else if (existingLeaveEvent) {
                        syncLeaveEventForDay(id, null).catch(err => {
                            console.warn('Nie udało się usunąć urlopu dla dnia', id, err);
                        });
                    }
                }

                if (powiazane.length) {
                    powiazane.forEach((powiazanie, index) => {
                        const zlecenie = _wszystkieZleceniaCache.find(z => z.id === powiazanie.zlecenieId) || null;
                        const maszyna = zlecenie?.maszynaId ? _wszystkieMaszynyCache.find(m => m.id === zlecenie.maszynaId) : null;
                        const machineModel = maszyna ? `${maszyna.typMaszyny || ''} ${maszyna.model || ''}`.trim() : (zlecenie?.maszynaModel || '');
                        const klientLabel = powiazanie.klientNazwa || pobierzNazwePowiazania(powiazanie.zlecenieId);
                        const typZlecenia = zlecenie?.typZlecenia || null;
                        events.push({
                            id: `powiazane_${id}_${powiazanie.zlecenieId || 'brak'}_${index}`,
                            title: klientLabel,
                            start: id,
                            allDay: true,
                            extendedProps: {
                                client: klientLabel,
                                machineModel,
                                fh: Number(powiazanie.fakturowane) || 0,
                                typ: typZlecenia,
                                workHours: 0,
                                driveHours: 0,
                                billedHours: Number(powiazanie.fakturowane) || 0
                            }
                        });
                    });
                }
                events.push({
                    id: `godziny_${id}`,
                    title: 'Ewidencja dnia',
                    start: id,
                    allDay: true,
                    className: ['strip-summary'],
                    extendedProps: {
                        client: 'Ewidencja dnia',
                        machineModel: null,
                        fh: (!powiazane.length && fakturowaneValue > 0) ? fakturowaneValue : null,
                        typ: null,
                        ...baseHoursProps
                    }
                });
            });
            workEvents = events;
            przerysujZdarzeniaKalendarza();
            odswiezPodsumowania();
        });
    }

    function nasluchujNaUrlopy() {
        try {
            onSnapshot(collection(db, 'events'), (snapshot) => {
                leaveEvents = snapshot.docs.map(docSnap => {
                    const data = docSnap.data() || {};
                    const baseProps = data.extendedProps || {};
                    const rawKind = baseProps.leaveKind || data.leaveKind || '';
                    const normalizedKind = rawKind ? String(rawKind).toUpperCase() : '';
                    const rawType = baseProps.type || data.type || baseProps.typ || data.typ;
                    const normalizedType = rawType && String(rawType).startsWith('LEAVE')
                        ? String(rawType)
                        : (normalizedKind ? (normalizedKind === 'L4' ? 'LEAVE_L4' : (normalizedKind === 'SWIETO' ? 'LEAVE_HOLIDAY' : 'LEAVE_FREE')) : null);
                    const isLeave = Boolean(normalizedType);
                    if (!isLeave || !data.start || !data.end) return null;
                    return {
                        id: docSnap.id,
                        title: data.title || LEAVE_TITLE_MAP[normalizedKind] || 'Urlop',
                        start: data.start,
                        end: data.end,
                        allDay: typeof data.allDay === 'boolean' ? data.allDay : true,
                        display: data.display || 'block',
                        extendedProps: {
                            typ: normalizedType,
                            type: normalizedType,
                            leaveKind: normalizedKind || ''
                        }
                    };
                }).filter(Boolean);
                przerysujZdarzeniaKalendarza();
                leaveEventsReady = true;
            });
        } catch (error) {
            console.error('Nie udało się pobrać urlopów:', error);
        }
    }

    function obliczSumeGodzinZKalendarza(start, end) {
        const wpisyZMiesiaca = wszystkieWpisyKalendarza.filter(wpis => {
            const dataWpisu = new Date(wpis.id);
            return dataWpisu >= start && dataWpisu < end;
        });
        const sumyMies = wpisyZMiesiaca.reduce((acc, wpis) => {
            const wpisType = wpis?.extendedProps?.type || wpis?.extendedProps?.typ || wpis?.typ;
            if (wpis?.leaveKind) {
                return acc;
            }
            if (wpis?.flags?.urlop || wpis?.flags?.l4 || wpis?.flags?.swieto) {
                return acc;
            }
            if (typeof wpisType === 'string' && wpisType.startsWith('LEAVE')) {
                return acc;
            }
            acc.praca += wpis.praca || 0;
            acc.wyfakturowaneGodziny += wpis.fakturowane || 0;
            acc.nadgodziny += wpis.nadgodziny || 0;
            acc.jazda += wpis.jazda || 0;
            return acc;
        }, { praca: 0, wyfakturowaneGodziny: 0, nadgodziny: 0, jazda: 0 });
        const absorpcja = obliczAbsorpcja(sumyMies.wyfakturowaneGodziny);

        if (!kalendarzPodsumowanieDiv) return;
        const metricsHTML = `
  <div class="metric"><div class="label">Praca w miesiącu</div><div class="value num">${(sumyMies.praca || 0).toFixed(1)} h</div></div>
  <div class="metric"><div class="label">Fakturowane</div><div class="value num">${(sumyMies.wyfakturowaneGodziny || 0).toFixed(1)} h</div></div>
  <div class="metric"><div class="label">Nadgodziny</div><div class="value num">${(sumyMies.nadgodziny || 0).toFixed(1)} h</div></div>
  <div class="metric"><div class="label">Czas jazdy</div><div class="value num">${(sumyMies.jazda || 0).toFixed(1)} h</div></div>
  <div class="metric"><div class="label">Absorpcja</div><div class="value num">${fmtPct(obliczAbsorpcja(sumyMies.wyfakturowaneGodziny))}</div></div>
`;
        kalendarzPodsumowanieDiv.innerHTML = `
  <div class="metrics-row">
    <div class="metrics-left"><div class="metrics-grid">${metricsHTML}</div></div>
    <div class="metrics-right"><div id="fh3m-pulpit"></div></div>
  </div>`;
        const { y, m } = ymFromMonthInput();
        renderFH3M(document.getElementById('fh3m-pulpit'), y, m);
    }

    async function obslugaKalendarza(event) {
        const target = event.target;
        if (target.classList.contains('event-edit-btn')) { otworzModalGodzin(target.dataset.date); }
        if (target.classList.contains('event-delete-btn')) {
            const data = target.dataset.date;
            if (confirm(`Czy na pewno chcesz usunąć wpis z dnia ${data}?`)) {
                await deleteDoc(doc(db, "godziny_pracy", data));
                await syncLeaveEventForDay(data, null);
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


    const normalizeDayFlags = (flags = {}, leaveKind = null) => {
        const normalizedKind = normalizeDayLeaveValue(leaveKind || '');
        return {
            urlop: Boolean(flags.urlop) || normalizedKind === 'URL',
            l4: Boolean(flags.l4) || normalizedKind === 'L4',
            swieto: Boolean(flags.swieto) || normalizedKind === 'SWIETO'
        };
    };

    function normalizeDayRecord(id, dane = {}) {
        const leaveKindNormalized = normalizeDayLeaveValue(dane.leaveKind || dane.dayLeave || '');
        const flags = normalizeDayFlags(dane.flags || {}, leaveKindNormalized);
        return {
            ...dane,
            id,
            date: dane.date || id || '',
            work: Number(dane.work ?? dane.praca) || 0,
            drive: Number(dane.drive ?? dane.jazda) || 0,
            billed: Number(dane.billed ?? dane.fakturowane) || 0,
            flags,
            leaveKind: leaveKindNormalized && leaveKindNormalized !== DAY_LEAVE_NONE ? leaveKindNormalized : null
        };
    }


    function formatujIloscMagazynu(ilosc) {
        const wartosc = wartoscLiczbowa(ilosc);
        return wartosc.toFixed(2);
    }

    function getAllDaysRange() {
        const days = Array.isArray(wszystkieWpisyKalendarza) ? wszystkieWpisyKalendarza : [];
        const dates = days
            .map(day => toDateSafe(day.date || day.id))
            .filter(Boolean)
            .map(date => date.getTime());
        if (!dates.length) {
            return { days: [], minDate: null, maxDate: null };
        }
        const minDate = new Date(Math.min(...dates));
        const maxDate = new Date(Math.max(...dates));
        return { days: [...days], minDate, maxDate };
    }

    function groupByYearMonth(days) {
        const grouped = {};
        if (!Array.isArray(days)) return grouped;
        days.forEach(day => {
            const normalized = normalizeDayRecord(day.id || day.date, day);
            const date = toDateSafe(normalized.date || normalized.id);
            if (!date) return;
            const year = date.getFullYear();
            const month = date.getMonth() + 1;
            if (!grouped[year]) grouped[year] = {};
            if (!grouped[year][month]) grouped[year][month] = [];
            grouped[year][month].push(normalized);
        });
        return grouped;
    }

    function monthStats(monthDays = []) {
        const uniqByDate = new Map();
        let work = 0, drive = 0, billed = 0, l4Days = 0, urlopDays = 0;

        (monthDays || []).forEach(day => {
            const normalized = normalizeDayRecord(day.id || day.date, day);
            work += Number(normalized.work) || 0;
            drive += Number(normalized.drive) || 0;
            billed += Number(normalized.billed) || 0;

            const key = normalized.date;
            if (!key) return;
            if (!uniqByDate.has(key)) uniqByDate.set(key, { l4: false, urlop: false });
            const agg = uniqByDate.get(key);
            if (normalized.flags?.l4) agg.l4 = true;
            if (normalized.flags?.urlop) agg.urlop = true;
        });

        for (const v of uniqByDate.values()) {
            if (v.l4) l4Days++;
            if (v.urlop) urlopDays++;
        }

        const absorpcja = billed ? Math.round((billed / BAZA_MIESIECZNA_GODZIN) * 100) : 0;
        return { work, drive, billed, l4Days, urlopDays, urlopDaysUsed: urlopDays, absorpcja };
    }

    function obliczPodsumowaniaMiesieczne(wpisy) {
        const grouped = groupByYearMonth(wpisy || []);
        const miesiace = [];
        const sumyRocznePerRok = [];
        const lata = Object.keys(grouped).map(Number).sort((a, b) => a - b);
        const globalTotals = { work: 0, drive: 0, billed: 0, l4Days: 0, urlopDays: 0 };
        const yearsDetailed = [];

        lata.forEach(year => {
            const months = grouped[year];
            const monthNumbers = Object.keys(months).map(Number).sort((a, b) => a - b);
            const yearSum = { work: 0, drive: 0, billed: 0, l4Days: 0, urlopDays: 0 };
            let absorpcjaSuma = 0;
            const yearMonths = [];

            monthNumbers.forEach(month => {
                const stats = monthStats(months[month]);
                absorpcjaSuma += stats.absorpcja;
                const miesiacKey = `${year}-${String(month).padStart(2, '0')}`;
                const label = formatujMiesiac(miesiacKey);
                const monthRecord = {
                    miesiac: miesiacKey,
                    year,
                    month,
                    mm: month,
                    label,
                    work: stats.work,
                    drive: stats.drive,
                    billed: stats.billed,
                    l4Days: stats.l4Days,
                    urlopDays: stats.urlopDays,
                    absorpcja: stats.absorpcja,
                    wyfakturowaneGodziny: stats.billed,
                    praca: stats.work,
                    jazda: stats.drive,
                    urlopDaysUsed: stats.urlopDays
                };
                miesiace.push(monthRecord);
                yearMonths.push(monthRecord);

                yearSum.work += stats.work;
                yearSum.drive += stats.drive;
                yearSum.billed += stats.billed;
                yearSum.l4Days += stats.l4Days;
                yearSum.urlopDays += stats.urlopDays;
            });

            const avgAbsorpcja = monthNumbers.length ? absorpcjaSuma / monthNumbers.length : 0;
            sumyRocznePerRok.push({
                rok: year,
                praca: yearSum.work,
                jazda: yearSum.drive,
                wyfakturowaneGodziny: yearSum.billed,
                l4Days: yearSum.l4Days,
                urlopDaysUsed: yearSum.urlopDays,
                work: yearSum.work,
                drive: yearSum.drive,
                billed: yearSum.billed,
                urlopDays: yearSum.urlopDays,
                miesiace: monthNumbers.length,
                absorpcja: avgAbsorpcja
            });
            yearsDetailed.push({ year, months: yearMonths, sum: { ...yearSum, absorpcja: avgAbsorpcja } });

            globalTotals.work += yearSum.work;
            globalTotals.drive += yearSum.drive;
            globalTotals.billed += yearSum.billed;
            globalTotals.l4Days += yearSum.l4Days;
            globalTotals.urlopDays += yearSum.urlopDays;
        });

        const sumyRoczne = {
            work: globalTotals.work,
            drive: globalTotals.drive,
            billed: globalTotals.billed,
            l4Days: globalTotals.l4Days,
            urlopDays: globalTotals.urlopDays,
            praca: globalTotals.work,
            jazda: globalTotals.drive,
            wyfakturowaneGodziny: globalTotals.billed,
            urlopDaysUsed: globalTotals.urlopDays,
            absorpcja: obliczAbsorpcja(globalTotals.billed)
        };

        return { miesiace, sumyRoczne, sumyRocznePerRok, lata, yearlyGrouped: grouped, years: yearsDetailed };
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
    function getSelectedMonth() {
        const now = new Date();
        const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        if (!miesiacSummaryInput) {
            return fallback;
        }
        const value = (miesiacSummaryInput.value || '').trim();
        if (!value) {
            miesiacSummaryInput.value = fallback;
            return fallback;
        }
        return value;
    }


    function obliczPodsumowanieFinansowe(miesiac, wszystkieZlecenia) {
        const pustyWynik = { sumaGodzin: 0, sumaBrutto: 0, sumaNetto: 0 };
        if (!miesiac) return pustyWynik;


        return wszystkieZlecenia
            .filter(z => z?.status === 'ukończone' && z.dataUkonczenia?.startsWith(miesiac))
            .reduce((acc, z) => {
                const godziny = Number(z.wyfakturowaneGodziny) || 0;
                const stawka = STAWKI[z.typZlecenia]?.stawka || 0;
                const kwotaBrutto = godziny * stawka;
                acc.sumaGodzin += godziny;
                acc.sumaBrutto += kwotaBrutto;
                acc.sumaNetto += kwotaBrutto * 0.7;
                return acc;
            }, { ...pustyWynik });
    }

    function obliczIPokazPodsumowanieFinansowe() {
        const wybranyMiesiac = getSelectedMonth();
        const finansowe = obliczPodsumowanieFinansowe(wybranyMiesiac, _wszystkieZleceniaCache);
        if (!zakonczoneSummaryContainer) return;

        const { sumaGodzin, sumaBrutto, sumaNetto } = finansowe;
        const absorpcja = obliczAbsorpcja(sumaGodzin);

        zakonczoneSummaryContainer.classList.add('orders-summary');

        Array.from(zakonczoneSummaryContainer.children)
            .filter(child => child.classList.contains('metrics-grid') || child.classList.contains('chart'))
            .forEach(el => el.remove());

        const metricsGrid = document.createElement('div');
        metricsGrid.className = 'metrics-grid';
        metricsGrid.innerHTML = `
    <div class="metric"><div class="label">Godziny wyfakturowane</div><div class="value num">${(sumaGodzin || 0).toFixed(1)} h</div></div>
    <div class="metric"><div class="label">Wartość brutto</div><div class="value num">${(sumaBrutto || 0).toFixed(2)} zł</div></div>
    <div class="metric"><div class="label">Wartość netto</div><div class="value num">${(sumaNetto || 0).toFixed(2)} zł</div></div>
    <div class="metric"><div class="label">Absorpcja</div><div class="value num">${fmtPct(absorpcja)}</div></div>
  `;

        const chart = document.createElement('div');
        chart.className = 'chart';
        chart.innerHTML = `
    <h4>Wyfakturowane — ostatnie 3 mies.</h4>
    <div id="fh3m-zlecenia"></div>
  `;

        zakonczoneSummaryContainer.append(metricsGrid, chart);

        const { y, m } = typeof ymFromMonthInput === 'function' ? ymFromMonthInput() : ymNow();
        renderFH3M(document.getElementById('fh3m-zlecenia'), y, m);
    }

    function renderRocznePodsumowanie() {
        if (!annualSummaryContainer) return;
        const years = (ostatnieZestawienieMiesieczne.years || []).sort((a, b) => a.year - b.year);
        if (!years.length) {
            annualSummaryContainer.innerHTML = '<p>Brak danych do wyświetlenia.</p>';
            return;
        }

        annualSummaryContainer.innerHTML = years.map(y => `
  <div class="year-section">
    <div class="year-title">Rok ${y.year}</div>
    <table class="tbl">
      <thead><tr>
        <th>Miesiąc</th><th>Godziny pracy</th><th>Czas jazdy</th>
        <th>Wyfakturowane</th><th>Absorpcja</th><th>L4 (dni)</th><th>Urlop (dni)</th>
      </tr></thead>
      <tbody>
        ${y.months.map(m=>`
          <tr>
            <td>${m.label}</td>
            <td>${m.work.toFixed(2)} h</td>
            <td>${m.drive.toFixed(2)} h</td>
            <td>${m.billed.toFixed(2)} h</td>
            <td><span class="badge-value">${Math.round(m.billed/168*100)}%</span></td>
            <td>${m.l4Days}</td>
            <td>${m.urlopDays}</td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td>Razem</td>
          <td>${y.sum.work.toFixed(2)} h</td>
          <td>${y.sum.drive.toFixed(2)} h</td>
          <td>${y.sum.billed.toFixed(2)} h</td>
          <td><span class="badge-value">${Math.round(y.sum.billed/(168*12)*100)}%</span></td>
          <td>${y.sum.l4Days}</td>
          <td>${y.sum.urlopDays}</td>
        </tr>
      </tfoot>
    </table>
  </div>
`).join('');
    }

    const calcVacationRemaining = (allowance, usedFromCalendar, adjustmentsSum) => {
        return (Number(allowance) || 0) - (Number(usedFromCalendar) || 0) + (Number(adjustmentsSum) || 0);
    };

    function updateYearSelectOptions(selectEl, years, selectedValue) {
        if (!selectEl) return;
        const uniqueYears = [...new Set(years)].sort((a, b) => a - b);
        selectEl.innerHTML = uniqueYears.map(y => `<option value="${y}">${y}</option>`).join('');
        if (uniqueYears.length && (selectedValue == null || !uniqueYears.includes(Number(selectedValue)))) {
            selectEl.value = uniqueYears[uniqueYears.length - 1];
        } else if (selectedValue != null) {
            selectEl.value = String(selectedValue);
        }
    }

    function getYearTotals(year) {
        return (ostatnieZestawienieMiesieczne.sumyRocznePerRok || []).find(r => Number(r.rok) === Number(year)) || null;
    }

    function renderL4Summary() {
        if (!l4SummaryContainer) return;
        const yearData = (ostatnieZestawienieMiesieczne.years || []).find(y => Number(y.year) === Number(selectedSummaryYear)) || null;
        if (!yearData || !yearData.months.length) {
            l4SummaryContainer.innerHTML = '<p>Brak danych dla wybranego roku.</p>';
            return;
        }
        const total = yearData.sum.l4Days;
        const rows = yearData.months.map(m => `<tr><td>${m.label}</td><td class="num">${m.l4Days}</td></tr>`).join('');
        l4SummaryContainer.innerHTML = `
            <table class="tbl">
                <thead><tr><th>Miesiąc</th><th>L4 (dni)</th></tr></thead>
                <tbody>${rows}</tbody>
                <tfoot><tr><td>Suma roczna</td><td class="num">${total}</td></tr></tfoot>
            </table>`;
    }

    async function getVacationAllowance(year) {
        const snap = await getDoc(doc(db, 'vacation_allowance', String(year)));
        if (snap.exists()) {
            return Number(snap.data()?.totalDays) || DEFAULT_VACATION_ALLOWANCE;
        }
        return DEFAULT_VACATION_ALLOWANCE;
    }

    async function setVacationAllowance(year, totalDays) {
        await setDoc(doc(db, 'vacation_allowance', String(year)), { totalDays: Number(totalDays) || 0 });
    }

    const getVacationAdjustmentsCollection = (year) => collection(db, 'vacation_adjustments', String(year), 'items');

    async function listVacationAdjustments(year) {
        const snap = await getDocs(getVacationAdjustmentsCollection(year));
        return snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data(), days: Number(docSnap.data()?.days) || 0 }));
    }

    async function addAdjustment(year, adj) {
        const payload = {
            date: adj.date || null,
            days: Number(adj.days) || 0,
            note: adj.note || '',
            createdAt: serverTimestamp()
        };
        const ref = await addDoc(getVacationAdjustmentsCollection(year), payload);
        return { id: ref.id, ...payload };
    }

    async function removeAdjustment(id, year) {
        await deleteDoc(doc(db, 'vacation_adjustments', String(year), 'items', id));
    }

    async function renderVacationSummary() {
        if (!vacationAllowanceInput || !vacationUsedSpan || !vacationRemainingSpan || !vacationAdjustmentsDiv) return;
        const allowance = await getVacationAllowance(selectedVacationYear);
        vacationAllowanceInput.value = allowance;

        const adjustments = await listVacationAdjustments(selectedVacationYear);
        const adjustmentsSum = adjustments.reduce((acc, adj) => acc + (Number(adj.days) || 0), 0);
        const yearTotals = getYearTotals(selectedVacationYear);
        const usedFromCalendar = Number(yearTotals?.urlopDaysUsed) || 0;
        const remaining = calcVacationRemaining(allowance, usedFromCalendar, adjustmentsSum);

        vacationUsedSpan.textContent = formatujLiczbe(usedFromCalendar);
        vacationAdjustmentsTotalSpan.textContent = formatujLiczbe(adjustmentsSum);
        vacationRemainingSpan.textContent = formatujLiczbe(remaining);

        vacationAdjustmentsDiv.innerHTML = adjustments.length
            ? `<ul class="adjustments-list">${adjustments.map(adj => `
                <li data-id="${adj.id}">
                    <span>${adj.date || 'brak daty'} — ${formatujLiczbe(adj.days)} dni ${adj.note ? `(${adj.note})` : ''}</span>
                    <button type="button" class="btn-remove adjustment-remove" data-id="${adj.id}">Usuń</button>
                </li>`).join('')}</ul>`
            : '<p>Brak korekt urlopu.</p>';
    }

    async function renderPodsumowanie() {
        renderRocznePodsumowanie();
        renderL4Summary();
        await renderVacationSummary();
    }

    function renderPulpit() {
        if (calendar?.view) {
            obliczSumeGodzinZKalendarza(calendar.view.currentStart, calendar.view.currentEnd);
        }
    }

    function renderZlecenia() { wyswietlZlecenia(); }

    async function odswiezPodsumowania(options = {}) {
        const { skipRender = false } = options;
        ostatnieZestawienieMiesieczne = obliczPodsumowaniaMiesieczne(wszystkieWpisyKalendarza);
        window.ostatnieZestawienieMiesieczne = ostatnieZestawienieMiesieczne;
        if (miesiacSummaryInput && ostatnieZestawienieMiesieczne.miesiace.length) {
            const miesiace = ostatnieZestawienieMiesieczne.miesiace;
            const aktualny = miesiacSummaryInput.value;
            if (!aktualny || !miesiace.some(m => m.miesiac === aktualny)) {
                miesiacSummaryInput.value = miesiace[miesiace.length - 1].miesiac;
            }
        }
        const lata = ostatnieZestawienieMiesieczne.lata.length ? ostatnieZestawienieMiesieczne.lata : [ymNow().y];
        if (!lata.includes(selectedSummaryYear)) {
            selectedSummaryYear = lata[lata.length - 1];
        }
        if (!lata.includes(selectedVacationYear)) {
            selectedVacationYear = lata[lata.length - 1];
        }
        updateYearSelectOptions(summaryYearSelect, lata, selectedSummaryYear);
        updateYearSelectOptions(vacationYearSelect, lata, selectedVacationYear);
        if (summaryYearSelect) summaryYearSelect.value = String(selectedSummaryYear);
        if (vacationYearSelect) vacationYearSelect.value = String(selectedVacationYear);
        if (!skipRender) {
            await renderPodsumowanie();
        }
        obliczIPokazPodsumowanieFinansowe();
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
  if (zakonczoneZleceniaHeader && ukonczoneZleceniaLista) {
    zakonczoneZleceniaHeader.dataset.collapsed = 'true';
    ukonczoneZleceniaLista.classList.add('collapsed');
    zakonczoneZleceniaHeader.addEventListener('click', () => {
     const isCollapsed = ukonczoneZleceniaLista.classList.toggle('collapsed');
      zakonczoneZleceniaHeader.dataset.collapsed = isCollapsed ? 'true' : 'false'; 
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
        if (!machineHistoryModal || !machineHistoryList) return;
        const historyTitle = document.getElementById('machine-history-title');
        if (historyTitle) historyTitle.textContent = `Historia Serwisowa: ${maszynaNazwa}`;
        machineHistoryList.innerHTML = '<p>Ładowanie historii...</p>';
        openModal(machineHistoryModal);

        try {
            const qMasz = query(
                collection(db, "zlecenia"),
                where("maszynaId", "==", maszynaId),
                where("status", "==", "ukończone"),
                orderBy("dataUkonczenia", "desc")
            );
            const querySnapshot = await getDocs(qMasz);


            let rowsHtml = '';
            if (!querySnapshot.empty) {
                querySnapshot.forEach((d) => {
                    const zlecenie = d.data();
                    const uzyteCzesciHtml = zlecenie.uzyteCzesci?.length > 0
                        ? `<br><small>Użyto: ${zlecenie.uzyteCzesci.map(c => `${c.nazwa} (x${c.ilosc})`).join(', ')}</small>`
                        : '';
                    const wzHtml = zlecenie.zakonczenieNumerWZ ? `<br><small>WZ: ${zlecenie.zakonczenieNumerWZ}</small>` : '';
                    const notatkaHtml = zlecenie.zakonczenieNotatka ? `<br><small>📝 ${zlecenie.zakonczenieNotatka}</small>` : '';
                    const motoHoursVal = Number.isFinite(Number(zlecenie.motoHours)) ? Number(zlecenie.motoHours) : 0;
                    rowsHtml += `
                        <tr data-id="${d.id}">
                            <td>${zlecenie.dataUkonczenia || 'b.d.'}</td>
                            <td>${zlecenie.nrZlecenia || '—'}</td>
                            <td>
                                <div><em>${zlecenie.opis || 'Brak'}</em></div>
                                <div>Fakturowano: <strong>${zlecenie.wyfakturowaneGodziny || 0}h</strong> | Typ: <strong>${zlecenie.typZlecenia || '?'}</strong>${uzyteCzesciHtml}${wzHtml}${notatkaHtml}</div>
                            </td>
                            <td>${motoHoursVal.toFixed(1)} h</td>
                            <td class="actions">
                                <button type="button" class="btn-szczegoly details-zlecenie-btn" data-id="${d.id}">Szczegóły</button>
                                <button type="button" class="btn-edit edit-zlecenie-btn" data-id="${d.id}">Edytuj</button>
                            </td>
                        </tr>`;
                });
            }

            machineHistoryList.innerHTML = rowsHtml
                ? `<table class="table machine-history-table"><thead><tr><th>Data</th><th>Nr zlecenia</th><th>Opis</th><th>Motogodziny</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table>`
                : '<p>Brak historii serwisowej (zakończonych zleceń) dla tej maszyny.</p>';


        } catch (error) {
            console.error("Błąd podczas pobierania historii serwisowej:", error);
            machineHistoryList.innerHTML = '<p style="color: red;">Wystąpił błąd podczas ładowania historii.</p>';
        }
    }

    function obslugaListyZlecenWModaluHistorii(event) {
        const target = event.target;
        const row = target.closest('tr') || target.closest('li');
        const docId = target.dataset.id || row?.dataset.id;
        if (!docId) return;
        if (target.classList.contains('details-zlecenie-btn')) {
            handleDetailsButtonClick(docId, event);
        }
        if (target.classList.contains('edit-zlecenie-btn')) {
            otworzModalEdycjiZlecenia(docId);
        }
    }

    function otworzModalEdycjiKlienta(klientId) {
        if (!editKlientForm) return;
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

            hideModal(editKlientModal);
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
        const frazaWyszukiwania = (maszynaSearchInput?.value || '').toLowerCase();
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
       if (listaMaszynDiv) {
            listaMaszynDiv.innerHTML = maszynyHtml || "<p>Brak maszyn w bazie lub pasujących do wyszukiwania.</p>";
        }
        if (zlecenieKlientSelect) {
            zlecenieKlientSelect.dispatchEvent(new Event('change'));
        }
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
    if (!editMaszynaForm || !editMaszynaModal) return;
    const maszyna = _wszystkieMaszynyCache.find(m => m.id === maszynaId);
    if (!maszyna) return;
    editMaszynaForm['edit-maszyna-id'].value = maszyna.id;
    document.getElementById('edit-maszyna-klient-nazwa').textContent = maszyna.klientNazwa;
    editMaszynaForm['edit-maszyna-typ'].value = maszyna.typMaszyny;
    editMaszynaForm['edit-maszyna-model'].value = maszyna.model;
    editMaszynaForm['edit-maszyna-serial'].value = maszyna.nrSeryjny === '---' ? '' : maszyna.nrSeryjny;
    editMaszynaForm['edit-maszyna-rok'].value = maszyna.rokProdukcji || '';
    editMaszynaForm['edit-maszyna-mth'].value = maszyna.motogodziny || 0;
    openModal(editMaszynaModal);
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

        hideModal(editMaszynaModal);
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
function renderListInBatches(container, elements, emptyMessage) {
    if (!container) return;
    if (!elements || elements.length === 0) {
        container.innerHTML = `<p>${emptyMessage}</p>`;
        return;
    }
    container.innerHTML = '';
    const ul = document.createElement('ul');
    container.appendChild(ul);
    const chunkSize = 20;
    let index = 0;
    const renderChunk = () => {
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < chunkSize && index < elements.length; i += 1, index += 1) {
            fragment.appendChild(elements[index]);
        }
        ul.appendChild(fragment);
        if (index < elements.length) {
            requestAnimationFrame(renderChunk);
        }
    };
    requestAnimationFrame(renderChunk);
}

function createZlecenieListItem(zlecenie, bodyHtml, actionsHtml) {
    const li = document.createElement('li');
    li.dataset.id = zlecenie.id;
    const span = document.createElement('span');
    span.innerHTML = bodyHtml;
    const actions = document.createElement('div');
    actions.innerHTML = actionsHtml;
    li.appendChild(span);
    li.appendChild(actions);
    return li;
}

function wyswietlZlecenia() {
    if (_wszystkieMaszynyCache.length === 0 && _wszystkieZleceniaCache.length > 0) {
        if (aktywneZleceniaLista) aktywneZleceniaLista.innerHTML = "<p>Ładowanie danych maszyn...</p>";
        if (ukonczoneZleceniaLista) ukonczoneZleceniaLista.innerHTML = "<p>Ładowanie danych maszyn...</p>";
        return;
    }

    const frazaWyszukiwania = (zlecenieSearchInput?.value || '').toLowerCase();
    const selectedMonth = getSelectedMonth();
    wszystkieZlecenia = [];
    const aktywneElements = [];
    const ukonczoneElements = [];

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
        const startLabel = formatDateTimeLabel(zlecenie.startAt, '');
        const endLabel = formatDateTimeLabel(zlecenie.endAt, '');
        const timelineHtml = (startLabel || endLabel)
            ? `<br><small>Start: ${startLabel || '—'}${endLabel ? ` → Koniec: ${endLabel}` : ''}</small>`
            : '';

        if (zlecenie.status === 'aktywne' || zlecenie.status === 'nieprzypisane') {
            const przycisk = zlecenie.status === 'nieprzypisane'
                ? `<button type="button" class="assign-btn btn-edit" data-id="${zlecenie.id}">Przypisz</button>`
                : `<button type="button" class="complete-btn" data-id="${zlecenie.id}">Zakończ</button>`;
            const opisHtml = `<em>${zlecenie.opis || 'Brak opisu'}</em>`;
            aktywneElements.push(createZlecenieListItem(
                zlecenie,
                `<strong>${nazwa}</strong><br>${opisHtml}${timelineHtml}`,
                `
                    <button type="button" class="btn-szczegoly details-zlecenie-btn" data-id="${zlecenie.id}">Szczegóły</button>
                    ${przycisk}
                    <button type="button" class="delete-btn" data-id="${zlecenie.id}">Usuń</button>
                `
            ));
        } else if (zlecenie.status === 'ukończone') {
            const dataUkonczenia = zlecenie.dataUkonczenia || '';
            if (!dataUkonczenia.startsWith(selectedMonth)) {
                return;
            }
            const nazwaMaszyny = klient ? `${klient.nazwa} - ${maszyna ? maszyna.typMaszyny : ''} ${maszyna ? maszyna.model : ''}` : 'Zlecenie usuniętej maszyny';
            const uzyteCzesciHtml = zlecenie.uzyteCzesci?.length > 0 ? `<br><small>Użyto: ${zlecenie.uzyteCzesci.map(c => `${c.nazwa} (x${c.ilosc})`).join(', ')}</small>` : '';
            const wzHtml = zlecenie.zakonczenieNumerWZ ? `<br><small>WZ: ${zlecenie.zakonczenieNumerWZ}</small>` : '';
            const notatkaHtml = zlecenie.zakonczenieNotatka ? `<br><small>📝 ${zlecenie.zakonczenieNotatka}</small>` : '';
            const motoHoursVal = Number.isFinite(Number(zlecenie.motoHours)) ? Number(zlecenie.motoHours) : 0;
            const motoHtml = `<div class="job-foot"><span class="badge badge-done">Zakończone</span><span class="meta">Motogodziny: ${motoHoursVal.toFixed(1)} h</span></div>`;
            ukonczoneElements.push(createZlecenieListItem(
                zlecenie,
                `
                    <strong>${nazwaMaszyny}</strong> (Nr: ${zlecenie.nrZlecenia})<br>
                    <em>Ukończono (${zlecenie.dataUkonczenia || 'b.d.'})</em><br>
                    Fakturowano: <strong>${zlecenie.wyfakturowaneGodziny || 0}h</strong> | Typ: <strong>${zlecenie.typZlecenia || '?'}</strong>
                    ${uzyteCzesciHtml}${wzHtml}${notatkaHtml}${timelineHtml}
                    ${motoHtml}
                `,
                `
                    <button type="button" class="btn-szczegoly details-zlecenie-btn" data-id="${zlecenie.id}">Szczegóły</button>
                    <button type="button" class="btn-edit edit-zlecenie-btn" data-id="${zlecenie.id}">Edytuj</button>
                    <button type="button" class="btn-edit reopen-btn" data-id="${zlecenie.id}">Otwórz ponownie</button>
                    <button type="button" class="delete-btn" data-id="${zlecenie.id}">Usuń</button>
                `
            ));
        }
    });

    renderListInBatches(
        aktywneZleceniaLista,
        aktywneElements,
        "Brak aktywnych zleceń lub pasujących do wyszukiwania."
    );
    renderListInBatches(
        ukonczoneZleceniaLista,
        ukonczoneElements,
        "Brak ukończonych zleceń lub pasujących do wyszukiwania."
    );
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
        odswiezPodsumowania();
        przeprowadzMigracjeStartEnd().catch(err => console.error('[Migracja start/end] Błąd aktualizacji:', err));
    });
}

let migracjaStartEndWykonana = false;

async function przeprowadzMigracjeStartEnd() {
    if (migracjaStartEndWykonana) return;
    migracjaStartEndWykonana = true;
    const aktualizacje = [];
    for (const zlecenie of _wszystkieZleceniaCache) {
        const payload = {};
        if (!zlecenie.startAt) {
            // Migracja 2024-05: dla starszych zleceń zapisujemy start na podstawie createdAt lub bieżącego czasu serwera.
            payload.startAt = zlecenie.createdAt || serverTimestamp();
        }
        if (!zlecenie.endAt && zlecenie.status === 'ukończone' && zlecenie.dataUkonczenia) {
            const parsed = new Date(`${zlecenie.dataUkonczenia}T12:00:00`);
            if (!Number.isNaN(parsed.getTime())) {
                payload.endAt = parsed;
            }
        }
        if (Object.keys(payload).length > 0) {
            aktualizacje.push(
                updateDoc(doc(db, "zlecenia", zlecenie.id), payload)
                    .catch(err => console.error('[Migracja start/end 2024-05] Nie udało się zaktualizować', zlecenie.id, err))
            );
        }
    }
    if (aktualizacje.length > 0) {
        await Promise.all(aktualizacje);
    }
}

async function dodajZlecenie(event) {
    event.preventDefault();
    const wybranyKlientId = zlecenieKlientSelect.value;
    const wybranaMaszynaId = zlecenieMaszynaSelect.value;
    const historia = [{ timestamp: new Date().toISOString(), akcja: "Utworzono zlecenie" }];
    // Start zlecenia zapisujemy automatycznie w chwili utworzenia (brak inicjacji z widoku kalendarza),
    // dlatego bazujemy na serverTimestamp(), który odpowiada czasowi zapisowemu na serwerze.
    const startAtFieldValue = serverTimestamp();

    let dane;
    if (wybranyKlientId === "szybkie-zlecenie") {
        dane = {
            status: 'nieprzypisane',
            nrZlecenia: zlecenieForm['nr-zlecenia'].value,
            opis: zlecenieForm['opis-usterki'].value,
            motoHours: 0,
            startAt: startAtFieldValue,
            endAt: null,
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
            motoHours: Number(zlecenieForm.motogodziny.value) || 0,
            startAt: startAtFieldValue,
            endAt: null,
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

function handleDetailsButtonClick(docId, event) {
    if (!docId || !detailsZlecenieModal) return;
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const infoDiv = document.getElementById('details-zlecenie-info');
    const historiaDiv = document.getElementById('details-zlecenie-historia');
    const kalendarzDiv = document.getElementById('details-zlecenie-kalendarz');
    if (infoDiv) infoDiv.innerHTML = '<p>Ładowanie danych zlecenia...</p>';
    if (historiaDiv) historiaDiv.innerHTML = '';
    if (kalendarzDiv) kalendarzDiv.innerHTML = '';
    closeAllModals();
    openModal(detailsZlecenieModal);
    otworzModalSzczegolowZlecenia(docId, { skipOpen: true });
}

async function obslugaListyZlecen(event) {
    const target = event.target;
    const li = target.closest('li');
    const docId = target?.dataset.id || li?.dataset.id;
    if (!docId) return;

    if (target.classList.contains('delete-btn')) {
        if (confirm("Na pewno usunąć?")) { await deleteDoc(doc(db, "zlecenia", docId)); }
        return;
    }
    if (target.classList.contains('details-zlecenie-btn')) {
        handleDetailsButtonClick(docId, event);
        return;
    }
    if (target.classList.contains('assign-btn')) {
        const zlecenie = _wszystkieZleceniaCache.find(z => z.id === docId);
        if (zlecenie && assignForm && assignModal) {
            const assignIdInput = assignForm.querySelector('#assign-zlecenie-id');
            const assignOpis = document.getElementById('assign-zlecenie-opis');
            const assignMachineSection = document.getElementById('assign-machine-section');
            if (assignIdInput) assignIdInput.value = docId;
            if (assignOpis) assignOpis.textContent = zlecenie.nrZlecenia;
            if (assignMachineSection) assignMachineSection.style.display = 'none';
            assignForm.reset();
            openModal(assignModal);
        }
        return;
    }
        if (target.classList.contains('complete-btn')) {
        if (!completeModal || !completeModalForm) return;
        const docSnap = await getDoc(doc(db, "zlecenia", docId));
        if (docSnap.exists()) {
            const zlecenie = docSnap.data();
            const maszyna = _wszystkieMaszynyCache.find(m => m.id === zlecenie.maszynaId);
            const klient = _wszystkieKlienciCache.find(k => k.id === zlecenie.klientId);
            const nazwaMaszyny = klient ? `${klient.nazwa} - ${maszyna ? maszyna.typMaszyny : ''} ${maszyna ? maszyna.model : ''}` : (zlecenie.nrZlecenia || 'Nieprzypisane');
            const modalKlient = document.getElementById('modal-klient');
            const modalNrZlecenia = document.getElementById('modal-nr-zlecenia');
            if (modalKlient) modalKlient.textContent = nazwaMaszyny;
            if (modalNrZlecenia) modalNrZlecenia.textContent = zlecenie.nrZlecenia;
            completeModalForm.reset();
            const completeIdInput = document.getElementById('complete-zlecenie-id');
            if (completeIdInput) completeIdInput.value = docId;
            const completeEndInput = document.getElementById('complete-zlecenie-end-at');
            if (completeEndInput) {
                completeEndInput.value = formatDatetimeLocalInput(new Date());
            }
            czesciDoZlecenia = [];
            renderCzesciDoZlecenia();
            renderMagazynWModalu();
            ensureZakonczenieNotatkaField();
            openModal(completeModal);
        }
        return;
    }
    if (target.classList.contains('edit-zlecenie-btn')) {
        const zlecenie = _wszystkieZleceniaCache.find(z => z.id === docId);
        if (zlecenie && zlecenie.status === 'ukończone') {
            otworzModalEdycjiZlecenia(docId);
        } else if (zlecenie) {
            alert("Można edytować tylko zakończone zlecenia.");
        }
        return;
    }
    if (target.classList.contains('reopen-btn')) {
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
                endAt: null,
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
    if (!editZlecenieForm || !editZlecenieModal) return;
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
    const editStartInput = editZlecenieForm['edit-start-at'];
    if (editStartInput) {
        editStartInput.value = formatDatetimeLocalInput(toDateSafe(zlecenie.startAt));
    }
    const editEndInput = editZlecenieForm['edit-end-at'];
    if (editEndInput) {
        editEndInput.value = formatDatetimeLocalInput(toDateSafe(zlecenie.endAt));
    }

    openModal(editZlecenieModal);
}

async function zapiszEdycjeZlecenia(event) {
    if (!editZlecenieForm) return;
    event.preventDefault();
    const zlecenieId = editZlecenieForm['edit-zlecenie-id'].value;
    const noweGodziny = Number(editZlecenieForm['edit-wyfakturowane-godziny'].value);
    const nowyTyp = editZlecenieForm['edit-typ-zlecenia'].value;
    const nowyNumerWz = editZlecenieForm['edit-zakonczenie-wz'].value.trim();
    const noweStartAt = parseDatetimeInput(editZlecenieForm['edit-start-at']?.value || '');
    const noweEndAt = parseDatetimeInput(editZlecenieForm['edit-end-at']?.value || '');

    if (isNaN(noweGodziny) || noweGodziny < 0) {
        alert("Podaj poprawną liczbę godzin.");
        return;
    }
    if (!walidujPrzedzialCzasu(noweStartAt, noweEndAt)) {
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
        const staryStartAt = toDateSafe(zlecenieData.startAt);
        const staryEndAt = toDateSafe(zlecenieData.endAt);
        const staryStartMs = staryStartAt ? staryStartAt.getTime() : null;
        const staryEndMs = staryEndAt ? staryEndAt.getTime() : null;
        const nowyStartMs = noweStartAt ? noweStartAt.getTime() : null;
        const nowyEndMs = noweEndAt ? noweEndAt.getTime() : null;

        let wpisHistorii = `Edytowano zakończone zlecenie: `;
        const zmiany = [];
        if (stareGodziny !== noweGodziny) zmiany.push(`Godziny zmieniono z ${stareGodziny}h na ${noweGodziny}h`);
        if (staryTyp !== nowyTyp) zmiany.push(`Typ zmieniono z ${staryTyp} na ${nowyTyp}`);
        if (staryNumerWz !== nowyNumerWz) {
            const staryTekst = staryNumerWz ? staryNumerWz : 'brak';
            const nowyTekst = nowyNumerWz ? nowyNumerWz : 'brak';
            zmiany.push(`Numer WZ zmieniono z ${staryTekst} na ${nowyTekst}`);
        }
        if (staryStartMs !== nowyStartMs) {
            const staryTekst = formatDateTimeLabel(staryStartAt, 'brak');
            const nowyTekst = formatDateTimeLabel(noweStartAt, 'brak');
            zmiany.push(`Start zmieniono z ${staryTekst} na ${nowyTekst}`);
        }
        if (staryEndMs !== nowyEndMs) {
            const staryTekst = formatDateTimeLabel(staryEndAt, 'brak');
            const nowyTekst = formatDateTimeLabel(noweEndAt, 'brak');
            zmiany.push(`Koniec zmieniono z ${staryTekst} na ${nowyTekst}`);
        }
        if (zmiany.length === 0) {
            hideModal(editZlecenieModal);
            return;
        }
        wpisHistorii += zmiany.join('; ');
        const nowaHistoria = [...staraHistoria, { timestamp: new Date().toISOString(), akcja: wpisHistorii }];

        await updateDoc(zlecenieRef, {
            wyfakturowaneGodziny: noweGodziny,
            typZlecenia: nowyTyp,
            zakonczenieNumerWZ: nowyNumerWz || null,
            startAt: noweStartAt || null,
            endAt: noweEndAt || null,
            historia: nowaHistoria
        });
        hideModal(editZlecenieModal);
        alert("Zlecenie zaktualizowane.");
    } catch (e) {
        console.error("Błąd aktualizacji zlecenia:", e);
        alert("Wystąpił błąd podczas zapisywania zmian. Sprawdź konsolę.");
    }
}

async function otworzModalSzczegolowZlecenia(zlecenieId, { skipOpen = false } = {}) {
    const zlecenie = _wszystkieZleceniaCache.find(z => z.id === zlecenieId);
    if (!zlecenie) { alert("Nie znaleziono zlecenia!"); return; }
    const titleEl = document.getElementById('details-zlecenie-title');
    const infoDiv = document.getElementById('details-zlecenie-info');
    const historiaDiv = document.getElementById('details-zlecenie-historia');
    const kalendarzDiv = document.getElementById('details-zlecenie-kalendarz');
    if (!detailsZlecenieModal || !titleEl || !infoDiv || !historiaDiv || !kalendarzDiv) return;
    closeAllModals(detailsZlecenieModal);
    const maszyna = _wszystkieMaszynyCache.find(m => m.id === zlecenie.maszynaId);
    const klient = _wszystkieKlienciCache.find(k => k.id === zlecenie.klientId);
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

    titleEl.textContent = `Szczegóły Zlecenia #${zlecenie.nrZlecenia}`;
    infoDiv.innerHTML = `
        <div class="details-group"><strong>Klient:</strong> <p>${klient ? klient.nazwa : '---'}</p></div>
        <div class="details-group"><strong>Maszyna:</strong> <p>${maszyna ? `${maszyna.typMaszyny} ${maszyna.model}` : '---'}</p></div>
        <div class="details-group"><strong>Start:</strong> <p>${formatDateTimeLabel(zlecenie.startAt)}</p></div>
        <div class="details-group"><strong>Koniec:</strong> <p>${zlecenie.endAt ? formatDateTimeLabel(zlecenie.endAt) : '—'}</p></div>
        <div class="details-group"><strong>Status:</strong> <p>${zlecenie.status}</p></div>
        <div class="details-group"><strong>Opis:</strong> <p>${zlecenie.opis || 'Brak opisu'}</p></div>
    `;

    if (zlecenie.status === 'ukończone') {
         const wzHtml = zlecenie.zakonczenieNumerWZ ? `<div class="details-group"><strong>Numer WZ:</strong> <p>${zlecenie.zakonczenieNumerWZ}</p></div>` : '';       
        const notatkaHtml = zlecenie.zakonczenieNotatka ? `<div class="details-group"><strong>Notatka przy zakończeniu:</strong> <p>${zlecenie.zakonczenieNotatka}</p></div>` : '';
        infoDiv.innerHTML += `
            <div class="details-group"><strong>Data Faktycznego Zakończenia:</strong> <p>${zlecenie.dataUkonczenia}</p></div>
            <div class="details-group"><strong>Fakturowane Godziny:</strong> <p>${zlecenie.wyfakturowaneGodziny || 0} h</p></div>
            <div class="details-group"><strong>Motogodziny:</strong> <p>${(zlecenie.motoHours ?? 0).toFixed(1)} h</p></div>
            <div class="details-group"><strong>Typ Zlecenia:</strong> <p>${zlecenie.typZlecenia} (${typStawkiOpis})</p></div>
            <div class="details-group"><strong>Użyte Części:</strong> <p>${uzyteCzesciOpis}</p></div>
            ${wzHtml}${notatkaHtml}
        `;
    }

    if (historiaDiv) {
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
    }

    if (kalendarzDiv) {
        kalendarzDiv.innerHTML = '<p>Ładowanie wpisów z kalendarza...</p>';
    }
    const qKalendarz = query(
        collection(db, "godziny_pracy"),
        orderBy("__name__", "desc")
    );
    const querySnapshotKalendarz = await getDocs(qKalendarz);
    let kalendarzHtml = '';
    querySnapshotKalendarz.forEach((docSnap) => {
        const wpis = docSnap.data();
        const { powiazane } = normalizujPowiazaneZlecenia(wpis);
        const powiazanie = powiazane.find(p => p.zlecenieId === zlecenieId);
        if (!powiazanie) return;
        const dataWpisu = docSnap.id;
        kalendarzHtml += `
            <div class="calendar-entry-item">
                <span class="date">[${dataWpisu}]</span>
                Praca: ${formatujLiczbe(wpis.praca || 0)}h | Fakturowane dla zlecenia: ${formatujLiczbe(powiazanie.fakturowane)}h | Nadgodziny: ${formatujLiczbe(wpis.nadgodziny || 0)}h | Jazda: ${formatujLiczbe(wpis.jazda || 0)}h
                ${wpis.notatka ? `<br><small>Notatka: ${wpis.notatka}</small>` : ''}
            </div>`;
    });
    if (kalendarzDiv) {
        kalendarzDiv.innerHTML = kalendarzHtml || '<p>Brak powiązanych wpisów w kalendarzu.</p>';
    }

    if (!skipOpen) {
        openModal(detailsZlecenieModal);
    }
}

async function zapiszPrzypisanie(event) {
    if (!assignForm || !assignModal) return;
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
        hideModal(assignModal);
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
    if (!partsToRemoveList) return;
    partsToRemoveList.innerHTML = czesciDoZlecenia.length > 0
        ? czesciDoZlecenia.map(c => `<li class="part-list-item" data-id="${c.id}">
            <span>${c.nazwa} - <strong>${formatujIloscMagazynu(c.ilosc)} szt.</strong></span>
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
        if (!completeModalForm || !completeModal) return;
        event.preventDefault();
        const docId = document.getElementById('complete-zlecenie-id').value;
        const numerWzValue = (document.getElementById('zakonczenie-wz')?.value || '').trim();
        const zakonczenieWzInput = document.getElementById('zakonczenie-wz');
        const zakonczenieNotatkaInput = document.getElementById('zakonczenie-notatka');
        const notatka = zakonczenieNotatkaInput && 'value' in zakonczenieNotatkaInput ? zakonczenieNotatkaInput.value.trim() : '';
        const manualEndAt = parseDatetimeInput(document.getElementById('complete-zlecenie-end-at')?.value || '');
        const motoHoursRaw = Number(document.getElementById('moto-hours')?.value);
        if (Number.isNaN(motoHoursRaw) || motoHoursRaw < 0) {
            alert('Motogodziny muszą być liczbą większą lub równą 0.');
            return;
        }
        const motoHours = Number.isFinite(motoHoursRaw) ? motoHoursRaw : 0;
        const zlecenieRef = doc(db, "zlecenia", docId);

        try {
            const zlecenieStartSnap = await getDoc(zlecenieRef);
            if (!zlecenieStartSnap.exists()) {
                alert("Nie znaleziono zlecenia do zakończenia.");
                return;
            }
            const startAtDate = toDateSafe(zlecenieStartSnap.data().startAt);
            if (!walidujPrzedzialCzasu(startAtDate, manualEndAt, { allowEndBeforeStart: true })) {
                return;
            }
        } catch (error) {
            console.error("Błąd walidacji czasu zakończenia:", error);
            alert("Nie udało się zweryfikować czasu zakończenia. Spróbuj ponownie.");
            return;
        }

        const fallbackEndAtDate = manualEndAt || new Date();
        const endAtValue = manualEndAt || serverTimestamp();
        const dane = {
            status: 'ukończone',
            wyfakturowaneGodziny: Number(document.getElementById('wyfakturowane-godziny').value),
            motoHours: Number(motoHours),
            typZlecenia: document.getElementById('typ-zlecenia').value,
            dataUkonczenia: fallbackEndAtDate.toISOString().split('T')[0],
            endAt: endAtValue,
            closedAt: serverTimestamp(),
            uzyteCzesci: czesciDoZlecenia,
            zakonczenieNotatka: notatka || null,
            zakonczenieNumerWZ: numerWzValue || null
        };
        let zamykaneZlecenieData = null;
        try {
            await runTransaction(db, async (t) => {
                const zlecenieSnap = await t.get(zlecenieRef);
                if (!zlecenieSnap.exists()) throw "Zlecenie nie istnieje!";
                const zlecenieData = zlecenieSnap.data();
                zamykaneZlecenieData = zlecenieData;
                let wpisHistorii = `Zakończono zlecenie. Godziny: ${dane.wyfakturowaneGodziny}h. Typ: ${dane.typZlecenia}. Motogodziny: ${motoHours.toFixed(1)}h.`;
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
            if (zamykaneZlecenieData) {
                const historiaPayload = {
                    orderId: docId,
                    clientId: zamykaneZlecenieData.klientId || null,
                    machineId: zamykaneZlecenieData.maszynaId || null,
                    orderNo: zamykaneZlecenieData.nrZlecenia || '',
                    description: zamykaneZlecenieData.opis || '',
                    motoHours: Number(motoHours),
                    closedAt: serverTimestamp()
                };
                try {
                    await addDoc(collection(db, 'orders_history'), historiaPayload);
                } catch (historyErr) {
                    console.warn('Nie udało się zapisać historii zlecenia:', historyErr);
                }
            }
            alert("Zlecenie zakończone, stan magazynowy zaktualizowany!");
            hideModal(completeModal);
            completeModalForm.reset();
        } catch (error) {
            console.error("BŁĄD TRANSAKCJI: ", error);
            alert(`Wystąpił błąd: ${error.message || error}`);
        }
    }

    // --- MAGAZYN: dodawanie / masowe / oleje / konwerter / tabela / zmiana stanu / nasłuchiwanie ---
    async function dodajProduktDoMagazynu(event) {
        event.preventDefault();
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
        const source = event.target;
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
        const tr = event.target.closest('tr'); if (!tr) return;
        const docId = tr.dataset.id;
        if (event.target.classList.contains('delete-btn')) {
            if (confirm("Na pewno usunąć?")) { await deleteDoc(doc(db, "magazyn", docId)); }
        } else if (event.target.classList.contains('add-stock-btn') || event.target.classList.contains('remove-stock-btn')) {
            if (!stockModal) return;
            const titleEl = document.getElementById('stock-modal-title');
            const nameEl = document.getElementById('stock-modal-name');
            const currentQtyEl = document.getElementById('stock-modal-current-qty');
            const idInput = document.getElementById('stock-change-id');
            const qtyInput = document.getElementById('stock-change-qty');
            if (!titleEl || !nameEl || !currentQtyEl || !idInput || !qtyInput) return;

            stockChangeOperation = event.target.classList.contains('add-stock-btn') ? 'add' : 'remove';
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
            if (stockModal) hideModal(stockModal);
            stockModalForm.reset();
        } catch (e) {
            console.error("Błąd transakcji: ", e);
            alert(`Wystąpił błąd: ${e.message || e}`);
        }
    }

    function wyswietlMagazyn() {
        if (!magazynLista) return;
        onSnapshot(query(collection(db, "magazyn"), orderBy("createdAt", "desc")), (snapshot) => {
            let html = '';
            const emptyRowHtml = '<tr class="empty-row"><td data-label="Informacja" colspan="6">Magazyn pusty.</td></tr>';
            wszystkieProdukty = [];
            if (snapshot.empty) { magazynLista.innerHTML = emptyRowHtml; return; }
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
                html += `<tr data-id="${produkt.id}" data-name="${produkt.nazwa}" data-qty="${datasetQty}" data-is-oil="${jestOlejem}">
                    <td data-label="Index">${produkt.index}</td>
                    <td data-label="Nazwa">${produkt.nazwa}</td>
                    <td data-label="Ilość (szt.)">${iloscFormatowana} szt.</td>
                    <td data-label="Ilość (Litry)">${iloscWLitrach}</td>
                    <td data-label="Klient">${produkt.klient}</td>
                    <td data-label="Akcje">
                        <button class="add-stock-btn">Dodaj</button>
                        <button class="remove-stock-btn">Zdejmij</button>
                        <button class="delete-btn">Usuń</button>
                    </td>
                </tr>`;
            });
            magazynLista.innerHTML = html || emptyRowHtml;
            renderMagazynWModalu();
        });
    }

   // --- PODPIĘCIE EVENTÓW ---
    if (klientForm) klientForm.addEventListener('submit', dodajKlienta);
    if (listaKlientowDiv) listaKlientowDiv.addEventListener('click', obslugaListyKlientow);

    if (maszynaForm) maszynaForm.addEventListener('submit', dodajMaszyne);
    if (listaMaszynDiv) listaMaszynDiv.addEventListener('click', obslugaListyMaszyn);

    // ZLECENIA
    if (zlecenieForm) zlecenieForm.addEventListener('submit', dodajZlecenie);
    if (zlecenieKlientSelect) {
        zlecenieKlientSelect.addEventListener('change', aktualizujMaszynyDlaZlecenia);
        zlecenieKlientSelect.dispatchEvent(new Event('change'));
    }
    if (aktywneZleceniaLista) aktywneZleceniaLista.addEventListener('click', obslugaListyZlecen);
    if (ukonczoneZleceniaLista) ukonczoneZleceniaLista.addEventListener('click', obslugaListyZlecen);
    if (machineHistoryList) machineHistoryList.addEventListener('click', obslugaListyZlecenWModaluHistorii);

    if (completeModalForm) completeModalForm.addEventListener('submit', obslugaZakonczeniaZlecenia);
    if (closeModalButton && completeModal) {
        closeModalButton.onclick = () => { hideModal(completeModal); };
    }

    if (miesiacSummaryInput) {
        miesiacSummaryInput.addEventListener('change', () => {
            getSelectedMonth();
            wyswietlZlecenia();
            obliczIPokazPodsumowanieFinansowe();
            const { y, m } = ymFromMonthInput();
            const hostP = document.getElementById('fh3m-pulpit');
            if (hostP) renderFH3M(hostP, y, m);
            const hostZ = document.getElementById('fh3m-zlecenia');
            if (hostZ) renderFH3M(hostZ, y, m);
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
    }

    // MAGAZYN
    if (magazynForm) magazynForm.addEventListener('submit', dodajProduktDoMagazynu);
    if (bulkAddForm) bulkAddForm.addEventListener('submit', dodajMasowo);
    if (magazynLista) magazynLista.addEventListener('click', obslugaTabeliMagazynu);

    if (modalMagazynLista) modalMagazynLista.addEventListener('click', dodajCzescDoZlecenia);
    if (partsToRemoveList) partsToRemoveList.addEventListener('click', obslugaListyCzesci);
    if (stockModalForm) stockModalForm.addEventListener('submit', obslugaZmianyStanu);
    if (stockModalCloseButton && stockModal) {
        stockModalCloseButton.onclick = () => { hideModal(stockModal); };
    }

    if (summaryYearSelect) {
        summaryYearSelect.addEventListener('change', () => {
            selectedSummaryYear = Number(summaryYearSelect.value) || ymNow().y;
            renderL4Summary();
        });
    }

    if (vacationYearSelect) {
        vacationYearSelect.addEventListener('change', () => {
            selectedVacationYear = Number(vacationYearSelect.value) || ymNow().y;
            renderVacationSummary();
        });
    }

    if (vacationAllowanceSaveBtn) {
        vacationAllowanceSaveBtn.addEventListener('click', async () => {
            const totalDays = Number(vacationAllowanceInput?.value) || DEFAULT_VACATION_ALLOWANCE;
            await setVacationAllowance(selectedVacationYear, totalDays);
            await renderVacationSummary();
        });
    }

    if (vacationAdjustmentForm) {
        vacationAdjustmentForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const days = Number(vacationAdjustmentDaysInput?.value);
            if (!Number.isFinite(days) || days === 0) { alert('Podaj liczbę dni (może być dodatnia lub ujemna).'); return; }
            await addAdjustment(selectedVacationYear, {
                date: vacationAdjustmentDateInput?.value || null,
                days,
                note: vacationAdjustmentNoteInput?.value || ''
            });
            vacationAdjustmentForm.reset();
            await renderVacationSummary();
        });
    }

    if (vacationAdjustmentsDiv) {
        vacationAdjustmentsDiv.addEventListener('click', async (event) => {
            const target = event.target.closest('.adjustment-remove');
            if (!target?.dataset?.id) return;
            await removeAdjustment(target.dataset.id, selectedVacationYear);
            await renderVacationSummary();
        });
    }

    if (addOilBtn) addOilBtn.addEventListener('click', dodajOlej);
    if (converterLitryInput) converterLitryInput.addEventListener('input', przeliczOlej);
    if (converterSztukiInput) converterSztukiInput.addEventListener('input', przeliczOlej);
    if (oilContainerSizeSelect) {
        oilContainerSizeSelect.addEventListener('change', () => { przeliczOlej({ target: { id: '' } }); });
    }

    // KALENDARZ (modal + klik w kalendarzu)
    if (kalendarzForm) kalendarzForm.addEventListener('submit', obslugaZapisuGodzin);
    if (kalendarzForm && kalendarzForm['godziny-fakturowane']) {
        kalendarzForm['godziny-fakturowane'].addEventListener('input', () => {
            if (multiZlecenia.length === 0) {
                manualFakturowaneValue = Number(kalendarzForm['godziny-fakturowane'].value) || 0;
            }
        });
    }
    if (kalendarzContainer) kalendarzContainer.addEventListener('click', obslugaKalendarza);
    if (kalendarzModalCloseButton && kalendarzModal) {
        kalendarzModalCloseButton.onclick = () => { hideModal(kalendarzModal); };
    }
    if (kalendarzMultiAddButton) kalendarzMultiAddButton.addEventListener('click', dodajLubZapiszMultiZlecenie);
    if (kalendarzMultiList) kalendarzMultiList.addEventListener('click', obslugaListyMulti);

    const wyswietlKlientowDebounced = debounce(() => wyswietlKlientow(), 200);
    const wyswietlMaszynyDebounced = debounce(() => wyswietlMaszyny(), 200);
    const wyswietlZleceniaThrottled = throttle(() => wyswietlZlecenia(), 150);

    // WYSZUKIWANIA
    if (klientSearchInput) klientSearchInput.addEventListener('input', wyswietlKlientowDebounced);
    if (maszynaSearchInput) maszynaSearchInput.addEventListener('input', wyswietlMaszynyDebounced);
    if (zlecenieSearchInput) zlecenieSearchInput.addEventListener('input', wyswietlZleceniaThrottled);

    // EDYCJE (modale)
    if (editKlientForm) editKlientForm.addEventListener('submit', zapiszEdycjeKlienta);
    if (editMaszynaForm) editMaszynaForm.addEventListener('submit', zapiszEdycjeMaszyny);
    if (editZlecenieForm) editZlecenieForm.addEventListener('submit', zapiszEdycjeZlecenia);

    if (editKlientCloseButton && editKlientModal) {
        editKlientCloseButton.onclick = () => { hideModal(editKlientModal); };
    }
    if (editMaszynaCloseButton && editMaszynaModal) {
        editMaszynaCloseButton.onclick = () => { hideModal(editMaszynaModal); };
    }
    if (detailsZlecenieCloseButton && detailsZlecenieModal) {
        detailsZlecenieCloseButton.onclick = () => { hideModal(detailsZlecenieModal); };
    }
    if (editZlecenieCloseButton && editZlecenieModal) {
        editZlecenieCloseButton.onclick = () => { hideModal(editZlecenieModal); };
    }
    if (machineHistoryCloseButton && machineHistoryModal) {
        machineHistoryCloseButton.onclick = () => { hideModal(machineHistoryModal); };
    }

    // Klik poza modal zamyka go
    window.onclick = (event) => {
        if (trackedModals.includes(event.target)) {
            hideModal(event.target);
        }
    };

    // --- INICJALIZACJA (MUSI BYĆ WEWNĄTRZ initializeApp) ---
    moveOrdersSearchBetweenSections();
    inicjalizujKalendarz();
    wyswietlWpisyKalendarza();
    nasluchujNaUrlopy();
    nasluchujNaKlientow();
    nasluchujNaMaszyny();
    nasluchujNaZlecenia();
    wyswietlPrzejazdy(); // puste – OK
    wyswietlMagazyn();

} // koniec initializeApp()