import { db, auth } from './firebase-config.js';
import { collection, query, orderBy, onSnapshot, doc, deleteDoc, updateDoc, getDoc, runTransaction, addDoc, setDoc, where, getDocs, serverTimestamp, startAt, endBefore, limit } from "firebase/firestore";
import Papa from 'papaparse';
import './styles.css';
import './styles/desktop-only.css';
import './styles/calendar-fixes.css';
import './styles/calendar.css';
import { initCalendar, updateCalendarData } from './calendar/initCalendar.js';
import { aggregateDayData, computeDayTotals, configureDayTotals } from './calendar/computeDayTotals.js';
import { loadYearReportingData } from './reporting/reportingData.js';
import { computeYearReport } from './reporting/reportingAggregation.js';
import { exportYearlyOrdersCsv, exportYearlyPdf, exportYearlySummaryCsv } from './reporting/reportingRender.js';

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MIN_DATE = '2026-01-01';
const normalizeDayKey = (value, context = '') => {
    if (!value) return null;
    let key = null;
    if (typeof value === 'string') {
        key = value.slice(0, 10);
    } else if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const yyyy = value.getFullYear();
        const mm = String(value.getMonth() + 1).padStart(2, '0');
        const dd = String(value.getDate()).padStart(2, '0');
        key = `${yyyy}-${mm}-${dd}`;
    }
    if (!key || key.length !== 10 || !DATE_KEY_RE.test(key)) {
        console.error('[calendar] invalid day key', { context, value, key });
        return null;
    }
    return key;
};

const isoDay = (d, context = 'isoDay') => normalizeDayKey(d, context);

const parsePlNumber = (v) => {
    if (v == null) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
};


const setDecorations = (decorations) => {
    window.__calendarDecorations = decorations;
    if (window.calendar) {
        window.__fcCalendar = window.calendar;
    }
    try { window.__fcCalendar?.rerenderDates?.(); } catch (_) { }
    try { window.__fcCalendar?.refetchEvents?.(); } catch (_) { }
    try { window.__applyCalendarDecorations?.(); } catch (_) { }
};


export const startApp = () => {
    initializeApp();
};


function initializeApp() {
    console.info('App bootstrap start');
    console.info('Firebase initialized:', Boolean(db && auth));
    // ZASADA: 3 warstwy i żadnych skrótów → DATA → AGREGACJA → RENDER.
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
        const props = event?.extendedProps || {};
        const billed = props.fh ?? props.billedHours ?? props.fakturowane ?? props.billH ?? 0;
        return isLeave ? 0 : (Number(billed) || 0);
    };
    function ymNow() {
        const d = new Date();
        return { y: d.getFullYear(), m: d.getMonth() + 1 };
    }
    const SELECTED_YEAR_STORAGE_KEY = 'summarySelectedYear';
    const SUMMARY_OPEN_YEARS_STORAGE_KEY = 'summaryOpenYears';
    const VACATION_TAB_STORAGE_KEY = 'vacationTab';
    const CALENDAR_VIEW_STORAGE_KEY = 'lastView';
    const CALENDAR_VIEW_STORAGE_LEGACY_KEY = 'lastCalendarView';
    const CALENDAR_DATE_STORAGE_KEY = 'lastFocusedDate';
    const CALENDAR_RETURN_VIEW_KEY = 'calendarReturnView';
    const CALENDAR_RETURN_DATE_KEY = 'calendarReturnDate';
    const CALENDAR_DAYGRID_VIEWS = new Set(['dayGridDay', 'dayGridWeek', 'dayGridMonth']);
    const SELECTED_YEAR_URL_PARAM = 'summaryYear';
    const getYearFromValue = (value) => {
        if (!value) return null;
        if (typeof value === 'string') {
            const candidate = value.slice(0, 10);
            if (DATE_KEY_RE.test(candidate)) {
                return Number(candidate.slice(0, 4));
            }
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed.getFullYear();
        }
        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : value.getFullYear();
        }
        if (value.toDate && typeof value.toDate === 'function') {
            const parsed = value.toDate();
            return Number.isNaN(parsed.getTime()) ? null : parsed.getFullYear();
        }
        if (typeof value === 'number') {
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed.getFullYear();
        }
        return null;
    };
    const getAvailableYears = (data = []) => {
        const years = new Set();
        (data || []).forEach((entry) => {
            if (!entry) return;
            const raw = entry?.date ?? entry?.id ?? entry?.dayStr ?? entry?.day ?? null;
            const year = getYearFromValue(raw);
            if (year) years.add(year);
        });
        return [...years];
    };
    const getYearsSortedDesc = (years = []) => [...new Set(years)].sort((a, b) => b - a);
    const getSelectedYearFromUrl = () => {
        try {
            const params = new URLSearchParams(window.location.search);
            const raw = params.get(SELECTED_YEAR_URL_PARAM) || params.get('year');
            const parsed = Number(raw);
            return Number.isFinite(parsed) ? parsed : null;
        } catch (_) {
            return null;
        }
    };
    const getSelectedYearFromStorage = () => {
        const stored = localStorage.getItem(SELECTED_YEAR_STORAGE_KEY);
        const parsed = Number(stored);
        return Number.isFinite(parsed) ? parsed : null;
    };
    const persistSelectedYear = (year) => {
        if (!Number.isFinite(year)) return;
        localStorage.setItem(SELECTED_YEAR_STORAGE_KEY, String(year));
        try {
            const url = new URL(window.location.href);
            url.searchParams.set(SELECTED_YEAR_URL_PARAM, String(year));
            window.history.replaceState(null, '', url);
        } catch (_) { }
    };
    const readOpenYearsFromStorage = () => {
        try {
            const raw = localStorage.getItem(SUMMARY_OPEN_YEARS_STORAGE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
        } catch (_) {
            return [];
        }
    };
    const persistOpenYears = (years = []) => {
        const unique = [...new Set((years || []).map(Number).filter(Number.isFinite))];
        localStorage.setItem(SUMMARY_OPEN_YEARS_STORAGE_KEY, JSON.stringify(unique));
    };
    const readVacationTabFromStorage = () => {
        try {
            return localStorage.getItem(VACATION_TAB_STORAGE_KEY) || 'used';
        } catch (_) {
            return 'used';
        }
    };
    const persistVacationTab = (tab) => {
        try {
            localStorage.setItem(VACATION_TAB_STORAGE_KEY, tab);
        } catch (_) { }
    };
    const calendarViewKeyToFc = (viewKey) => {
        switch (viewKey) {
            case 'day':
                return 'dayGridDay';
            case 'month':
                return 'dayGridMonth';
            case 'week':
            default:
                return 'dayGridWeek';
        }
    };
    const fcViewToCalendarKey = (viewType) => {
        if (viewType?.includes?.('Day')) return 'day';
        if (viewType?.includes?.('Week')) return 'week';
        return 'month';
    };
    const normalizeCalendarViewType = (viewType) => (CALENDAR_DAYGRID_VIEWS.has(viewType) ? viewType : null);
    const readCalendarViewFromStorage = () => {
        try {
            const stored = localStorage.getItem(CALENDAR_VIEW_STORAGE_KEY)
                || localStorage.getItem(CALENDAR_VIEW_STORAGE_LEGACY_KEY);
            return normalizeCalendarViewType(stored);
        } catch (_) {
            return null;
        }
    };
    const readCalendarDateFromStorage = () => {
        try {
            const stored = localStorage.getItem(CALENDAR_DATE_STORAGE_KEY);
            return DATE_KEY_RE.test(stored || '') ? stored : null;
        } catch (_) {
            return null;
        }
    };
    const persistCalendarView = (viewType) => {
        const normalized = normalizeCalendarViewType(viewType);
        if (!normalized) return;
        try {
            localStorage.setItem(CALENDAR_VIEW_STORAGE_KEY, normalized);
        } catch (_) { }
    };
    const persistCalendarDate = (dateStr) => {
        if (!DATE_KEY_RE.test(dateStr || '')) return;
        try {
            localStorage.setItem(CALENDAR_DATE_STORAGE_KEY, dateStr);
        } catch (_) { }
    };
    const persistCalendarReturnState = (viewKey, dateStr) => {
        if (viewKey) {
            try { localStorage.setItem(CALENDAR_RETURN_VIEW_KEY, viewKey); } catch (_) { }
        }
        if (DATE_KEY_RE.test(dateStr || '')) {
            try { localStorage.setItem(CALENDAR_RETURN_DATE_KEY, dateStr); } catch (_) { }
        }
    };
    const readCalendarReturnState = () => {
        try {
            const viewKey = localStorage.getItem(CALENDAR_RETURN_VIEW_KEY) || null;
            const dateStr = localStorage.getItem(CALENDAR_RETURN_DATE_KEY) || null;
            return {
                viewKey: viewKey === 'day' || viewKey === 'week' || viewKey === 'month' ? viewKey : null,
                dateStr: DATE_KEY_RE.test(dateStr || '') ? dateStr : null
            };
        } catch (_) {
            return { viewKey: null, dateStr: null };
        }
    };
    const clearCalendarReturnState = () => {
        try {
            localStorage.removeItem(CALENDAR_RETURN_VIEW_KEY);
            localStorage.removeItem(CALENDAR_RETURN_DATE_KEY);
        } catch (_) { }
    };
    const getYearRange = (year) => {
        const startKey = `${year}-01-01`;
        const endKey = `${year + 1}-01-01`;
        return { startKey, endKey };
    };
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
    const BAZA_MIESIECZNA_GODZIN = 168;
    const DEFAULT_VACATION_ALLOWANCE = 26;
    const LEAVE_EVENT_PREFIX = 'leave_';
    const DAY_LEAVE_NONE = 'NONE';
    const DAY_LEAVE_VALUES = [DAY_LEAVE_NONE, 'URL', 'WOLNE', 'L4', 'SWIETO', 'SZKOLENIE'];
    const LEAVE_LABELS = {
        URL: 'Urlop',
        WOLNE: 'Wolne',
        L4: 'L4',
        SWIETO: 'Święto',
        SZKOLENIE: 'Szkolenie'
    };
    const DAY_OFF_STATUSES = ['L4', 'URL', 'SWIETO', 'WOLNE', 'SZKOLENIE'];
    const QUICK_ACTIONS_CONFIG = [
        { id: 'add-order', label: 'Dodaj zlecenie', icon: '🧾', action: 'open-add-order', route: 'dodaj-zlecenie', note: 'Zlecenia' },
        { id: 'add-entry-today', label: 'Dodaj ewidencję (dziś)', icon: '🗓️', action: 'open-entry-today', route: 'kalendarz-tab', note: 'Ewidencja' },
        { id: 'calendar-today', label: 'Kalendarz (dziś)', icon: '📌', action: 'open-calendar-today', route: 'kalendarz-tab', note: 'Kalendarz' },
        { id: 'add-client', label: 'Dodaj klienta', icon: '👤', action: 'open-add-client', route: 'klienci', note: 'Klienci' },
        { id: 'add-machine', label: 'Dodaj maszynę', icon: '🚜', action: 'open-add-machine', route: 'maszyny', note: 'Maszyny' },
        { id: 'warehouse', label: 'Magazyn', icon: '📦', action: 'open-warehouse', route: 'magazyn', note: 'Stan i wyszukiwarka' }
    ];
    const PRODUCT_TYPE_ZMYWACZ = 'ZMYWACZ';
    const DEFAULT_STOCK_ITEMS = [
        { index: 'ZMYWACZ', nazwa: 'Zmywacz', jestOlejem: false, typProdukt: PRODUCT_TYPE_ZMYWACZ }
    ];
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
    const currentYear = ymNow().y;
    const initialSelectedYear = getSelectedYearFromUrl() ?? getSelectedYearFromStorage() ?? currentYear;
    let selectedYear = initialSelectedYear;
    let selectedYearEntries = [];
    let selectedYearSummary = null;
    let selectedYearTotals = null;
    let selectedYearNeedsRefresh = true;
    let selectedYearLoadedFor = null;
    let isExportingYearReport = false;
    let availableSummaryYears = [currentYear];
    let openSummaryYears = new Set();
    window.ostatnieZestawienieMiesieczne = ostatnieZestawienieMiesieczne;
    let _wszystkieKlienciCache = [], _wszystkieMaszynyCache = [], _wszystkieZleceniaCache = []; // Cache z Firebase
    const NISKI_STAN_MAGAZYNOWY = 5;
    let recentActivity = [];
    let weeklyMissingDays = [];
    let activityStatus = 'idle';
    let hasEnsuredDefaultStock = false;
    let calendar;
    window.calendar = null;
    window.__calendarApi = null;
    const getCalendarApi = () => calendar || window.__calendarApi || null;
    const setCalendarApi = (api) => {
        calendar = api || null;
        window.calendar = calendar;
        window.__calendarApi = calendar;
    };
    const CALENDAR_PANEL_PINNED_STORAGE_KEY = 'calendarDayPanelPinned';
    const CALENDAR_BREAKPOINTS = {
        desktop: 1100,
        laptop: 768,
        tablet: 640
    };
    const getCalendarBreakpoint = () => {
        const width = window.innerWidth || 0;
        if (width >= CALENDAR_BREAKPOINTS.desktop) return 'desktop';
        if (width >= CALENDAR_BREAKPOINTS.laptop) return 'laptop';
        if (width >= CALENDAR_BREAKPOINTS.tablet) return 'tablet';
        return 'mobile';
    };
    const isDesktopBreakpoint = () => getCalendarBreakpoint() === 'desktop';
    const isLaptopBreakpoint = () => getCalendarBreakpoint() === 'laptop';
    const isTabletBreakpoint = () => getCalendarBreakpoint() === 'tablet';
    const readPinnedPanelState = () => {
        try {
            return localStorage.getItem(CALENDAR_PANEL_PINNED_STORAGE_KEY) === 'true';
        } catch (_) {
            return false;
        }
    };
    const persistPinnedPanelState = (value) => {
        try {
            localStorage.setItem(CALENDAR_PANEL_PINNED_STORAGE_KEY, value ? 'true' : 'false');
        } catch (_) { }
    };

    const ENABLE_DAY_PANEL = false;
    let selectedDayPanelKey = null;
    let selectedCalendarDayKey = null;
    let dayPanelOpen = false;
    let dayPanelPinned = readPinnedPanelState();

    const getSummaryDisplayMode = () => calendarShell?.dataset?.summaryDisplay || 'short';

    const applyDayPanelState = () => {
        if (!calendarShell) return;
        if (!ENABLE_DAY_PANEL || !calendarDayPanel) {
            calendarShell.dataset.panelOpen = 'false';
            calendarShell.dataset.panelPinned = 'false';
            return;
        }
        const pinActive = isLaptopBreakpoint() && dayPanelPinned;
        const shouldBeOpen = isDesktopBreakpoint() || dayPanelOpen || pinActive;
        calendarShell.dataset.panelOpen = shouldBeOpen ? 'true' : 'false';
        calendarShell.dataset.panelPinned = pinActive ? 'true' : 'false';
        calendarDayPanel.dataset.panelPinned = pinActive ? 'true' : 'false';
    };

    const buildDayPanelData = (dayKey) => ({
        dayKey,
        dayDoc: dayDocsByDay.get(dayKey) || null,
        orders: Array.isArray(ordersByDay.get(dayKey)) ? ordersByDay.get(dayKey) : [],
        manual: manualByDay.get(dayKey) || {}
    });

    const renderDayPanel = () => {
        if (!ENABLE_DAY_PANEL || !calendarDayPanel) return;
        if (!selectedDayPanelKey) {
            renderDayDetailsPanel(calendarDayPanel, null);
            return;
        }
        const data = buildDayPanelData(selectedDayPanelKey);
        const model = buildDayDetailsModel({
            ...data,
            summaryMode: 'full'
        });
        renderDayDetailsPanel(calendarDayPanel, model);
        dockCalendarFormToPanel();
        const pinButton = calendarDayPanel.querySelector('[data-panel-action="pin"]');
        if (pinButton) {
            pinButton.setAttribute('aria-pressed', dayPanelPinned ? 'true' : 'false');
        }
    };

    const clearSelectedCalendarDay = () => {
        if (!calendarShell) return;
        calendarShell.querySelectorAll('.fc-daygrid-day.is-selected-day').forEach((cell) => {
            cell.classList.remove('is-selected-day');
        });
    };

    const setSelectedCalendarDay = (dayKey) => {
        if (!calendarShell || !dayKey) return;
        clearSelectedCalendarDay();
        const cell = calendarShell.querySelector(`.fc-daygrid-day[data-date="${dayKey}"]`);
        if (cell) {
            cell.classList.add('is-selected-day');
            selectedCalendarDayKey = dayKey;
        }
    };

    const focusDayPanelOrder = (orderId) => {
        if (!calendarDayPanel || !orderId) return;
        const safeId = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(orderId) : String(orderId).replace(/["\\]/g, '\\$&');
        const target = calendarDayPanel.querySelector(`[data-order-id="${safeId}"]`);
        if (target) {
            target.classList.add('is-focused');
            target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            window.setTimeout(() => target.classList.remove('is-focused'), 1200);
        }
    };

    const renderCalendarModalSummary = (dayKey) => {
        if (!kalendarzSummaryTiles) return;
        const result = computeDayTotals(dayKey);
        const totals = result?.totals || { work: 0, drive: 0, billed: 0, over: 0 };
        const tiles = [
            { label: 'Praca', value: totals.work },
            { label: 'Jazda', value: totals.drive },
            { label: 'Fakturowane', value: totals.billed },
            { label: 'Nadgodziny', value: totals.over }
        ];
        kalendarzSummaryTiles.innerHTML = tiles.map((tile) => `
            <div class="calendar-day-panel__summary-tile">
                <div class="calendar-day-panel__summary-label">${tile.label}</div>
                <div class="calendar-day-panel__summary-value">${formatujLiczbe(tile.value)} h</div>
            </div>
        `).join('');
        if (kalendarzStatusBadge) {
            const leaveKind = result?.leaveKind || null;
            if (leaveKind) {
                kalendarzStatusBadge.textContent = `Status: ${LEAVE_LABELS[leaveKind] || leaveKind}`;
                kalendarzStatusBadge.classList.remove('is-hidden');
            } else {
                kalendarzStatusBadge.textContent = '';
                kalendarzStatusBadge.classList.add('is-hidden');
            }
        }
    };

    const openDayPanel = (dayKey, options = {}) => {
        if (!dayKey) return;
        selectedDayPanelKey = dayKey;
        selectedCalendarDayKey = dayKey;
        dayPanelOpen = ENABLE_DAY_PANEL;
        persistCalendarDate(dayKey);
        setSelectedCalendarDay(dayKey);
        applyDayPanelState();
        renderDayPanel();
        restoreCalendarFormToModal();
        otworzModalGodzin(dayKey, { openModal: true, ...options });
    };

    const closeDayPanel = () => {
        if (!ENABLE_DAY_PANEL) return;
        if (isDesktopBreakpoint() || dayPanelPinned) return;
        dayPanelOpen = false;
        applyDayPanelState();
    };

    const toggleDayPanelPin = () => {
        if (!ENABLE_DAY_PANEL || !isLaptopBreakpoint()) return;
        dayPanelPinned = !dayPanelPinned;
        persistPinnedPanelState(dayPanelPinned);
        applyDayPanelState();
        renderDayPanel();
    };

    const applyCalendarResponsiveOptions = () => {
        const api = getCalendarApi();
        if (!api) return;
        const viewKey = fcViewToCalendarKey(api.view?.type);
        const width = window.innerWidth || 0;
        const monthRows = 2;
        const rows = viewKey === 'month'
            ? monthRows
            : (width >= CALENDAR_BREAKPOINTS.desktop ? 3 : width >= CALENDAR_BREAKPOINTS.laptop ? 2 : 1);
        const shouldLimit = viewKey === 'week' || viewKey === 'month';
        api.setOption('dayMaxEvents', shouldLimit);
        api.setOption('dayMaxEventRows', shouldLimit ? rows : false);
    };

    const CALENDAR_SHELL_MIN_HEIGHT = 420;
    const CALENDAR_MONTH_MIN_HEIGHT = '78vh';
    const CALENDAR_RESERVED_SPACE = 96;
    const syncCalendarShellHeight = () => {
        if (!calendarShell) return;
        if (calendarShell.offsetParent === null) return;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const mainContentEl = document.querySelector('main.mainContent') || document.querySelector('main');
        const headerHeight = document.querySelector('header')?.offsetHeight || 0;
        const navHeight = mainContentEl ? Math.max((mainContentEl.getBoundingClientRect().top || 0) - headerHeight, 0) : 0;
        const available = Math.max(viewportHeight - headerHeight - navHeight - CALENDAR_RESERVED_SPACE, CALENDAR_SHELL_MIN_HEIGHT);
        calendarShell.style.setProperty('--calendar-shell-height', `${Math.round(available)}px`);
        calendarShell.style.setProperty('--calendar-shell-min-height', CALENDAR_MONTH_MIN_HEIGHT);
    };

    const handleCalendarResize = () => {
        syncCalendarShellHeight();
        try {
            getCalendarApi()?.updateSize();
        } catch (_) { }
        applyCalendarResponsiveOptions();
        applyDayPanelState();
    };
    let workEvents = [];
    let edytowanyPrzejazdId = null;
    let stockChangeOperation = null;
    let magazynSort = { key: 'nazwa', dir: 'asc' };
    let stockStatus = 'loading';
    let hasLoadedStockOnce = false;
    let activeWarehouseProduct = null;
    let multiZlecenia = [];
    let multiEdytowanyIndex = null;
    let manualFakturowaneValue = 0;
    let manualByDay = new Map();
    let ordersByDay = new Map();
    let dayDocsByDay = new Map();
    let leaveByDay = new Map();
    let plannedLeaveByDay = new Map();
    let lastSummaryByDay = {};
    let lastLeaveByDay = {};
    let plannedLeaveEntries = [];
    let plannedLeaveEditId = null;
    let unfinishedDrawerOpen = false;
    let unfinishedSummary = {
        daysWithoutSummary: [],
        ordersWithoutBilling: [],
        plannedLeaveWithoutCalendar: [],
        total: 0
    };
    let unfinishedDrawerView = { mode: 'summary', days: [] };
    let ordersFilterMode = null;
    let unfinishedDrawer = null;
    let unfinishedButton = null;
    configureDayTotals({
        manualGetter: (dayKey) => manualByDay.get(dayKey) || null,
        ordersGetter: (dayKey) => ordersByDay.get(dayKey) || [],
        leaveGetter: (dayKey) => leaveByDay.get(dayKey) || null
    });

    const moduleInitState = {
        calendar: { initialized: false, inFlight: false },
        clients: { initialized: false, inFlight: false },
        machines: { initialized: false, inFlight: false },
        orders: { initialized: false, inFlight: false },
        stock: { initialized: false, inFlight: false },
        summary: { initialized: false, inFlight: false },
        activity: { initialized: false, inFlight: false }
    };
    let bootstrapReady = false;
    let pendingCalendarInit = false;

    const renderModuleError = (container, message) => {
        if (!container) return;
        const safeMsg = message || 'Moduł chwilowo niedostępny.';
        container.innerHTML = `<p class="loading-state">${safeMsg}</p>`;
    };

    const safeInitModule = async (name, container, initFn, errorMessage) => {
        if (!container) {
            console.info(`[${name}] pomijam init — brak kontenera DOM`);
            return { ok: false, reason: 'missing-container' };
        }
        const state = moduleInitState[name] || { initialized: false, inFlight: false };
        if (state.inFlight) return { ok: false, reason: 'in-flight' };
        if (state.initialized) return { ok: true, skipped: true };
        state.inFlight = true;
        moduleInitState[name] = state;
        try {
            await initFn();
            state.initialized = true;
            return { ok: true };
        } catch (error) {
            console.error(`[${name}] init error`, error);
            renderModuleError(container, errorMessage);
            return { ok: false, error };
        } finally {
            state.inFlight = false;
        }
    };

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

    const logActivityEvent = async ({ type, refId, label }) => {
        if (!type || !label) return;
        try {
            await addDoc(collection(db, "activity"), {
                type,
                refId: refId || null,
                label,
                timestamp: serverTimestamp()
            });
        } catch (error) {
            console.warn('[activity] Nie udało się zapisać zdarzenia:', error);
        }
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

    const UI_STORAGE_KEYS = {
        machinesExpanded: 'machines.openSections',
        machinesLast: 'ui:machines:lastClient',
        clientsExpanded: 'clients.openSections',
        clientsLast: 'ui:clients:lastClient'
    };

    const readExpandedSet = (key) => {
        try {
            const raw = localStorage.getItem(key);
            const parsed = raw ? JSON.parse(raw) : [];
            return new Set(Array.isArray(parsed) ? parsed : []);
        } catch (err) {
            console.warn('[UI] Nie udało się wczytać stanu akordeonu:', err);
            return new Set();
        }
    };

    const persistExpandedSet = (key, set) => {
        localStorage.setItem(key, JSON.stringify([...set]));
    };

    const readLastExpanded = (key) => localStorage.getItem(key) || '';

    const updateExpandedState = (expandedKey, lastKey, id, isOpen) => {
        const expanded = readExpandedSet(expandedKey);
        if (isOpen) {
            expanded.add(id);
            localStorage.setItem(lastKey, id);
        } else {
            expanded.delete(id);
        }
        persistExpandedSet(expandedKey, expanded);
    };

    // --- SELEKTORY ---
    const miesiacSummaryInput = document.getElementById('miesiac-summary');
    const zlecenieKlientInput = document.getElementById('zlecenie-klient-input');
    const zlecenieKlientIdInput = document.getElementById('zlecenie-klient-id');
    const zlecenieKlientDropdown = document.getElementById('zlecenie-klient-dropdown');
    const zlecenieKlientClearBtn = zlecenieKlientInput?.closest('.combobox')?.querySelector('.combobox-clear');
    const zlecenieMaszynaSelect = document.getElementById('zlecenie-maszyna-select');
    const kalendarzContainer = document.getElementById('kalendarz');
    const calendarShell = document.getElementById('calendar-shell') || kalendarzContainer;
    const kalendarzModal = document.getElementById('kalendarz-modal');
    const kalendarzForm = document.getElementById('kalendarz-form');
    const kalendarzModalTitle = document.getElementById('kalendarz-modal-title');
    const kalendarzModalCloseButton = kalendarzModal ? kalendarzModal.querySelector('.close-button') : null;
    const kalendarzSummaryTiles = document.getElementById('kalendarz-summary-tiles');
    const kalendarzStatusBadge = document.getElementById('kalendarz-status-badge');
    const kalendarzPodsumowanieDiv = document.getElementById('kalendarz-podsumowanie');
    const pulpitQuickActionsContainer = document.getElementById('pulpit-quick-actions');
    const pulpitWeeklyContainer = document.getElementById('pulpit-weekly-preview');
    const pulpitActivityList = document.getElementById('pulpit-activity-list');
    const calendarTitleEl = document.getElementById('calendar-title');
    const calendarToolbar = document.getElementById('calendar-toolbar');
    const calendarDayPanel = document.getElementById('calendar-day-panel');
    const calendarDayPanelBackdrop = document.getElementById('calendar-day-panel-backdrop');
    const calendarViewButtons = calendarToolbar ? calendarToolbar.querySelectorAll('[data-calendar-view]') : [];
    const calendarTodayBtn = document.getElementById('calendar-today-btn');
    const calendarBackBtn = document.getElementById('calendar-back-btn');
    const calendarFocusBtn = document.getElementById('calendar-focus-btn');
    const unfinishedButtonSlot = document.getElementById('unfinished-button-slot');
    const assignModal = document.getElementById('assign-zlecenie-modal');
    const assignForm = document.getElementById('assign-zlecenie-form');
    const klientForm = document.getElementById('klient-form');
    const klientAddBtn = document.getElementById('klient-add-btn');
    const listaKlientowDiv = document.getElementById('lista-klientow');
    const maszynaKlientInput = document.getElementById('maszyna-klient-input');
    const maszynaKlientIdInput = document.getElementById('maszyna-klient-id');
    const maszynaKlientDropdown = document.getElementById('maszyna-klient-dropdown');
    const maszynaKlientClearBtn = maszynaKlientInput?.closest('.combobox')?.querySelector('.combobox-clear');
    const maszynaClientFilterSelect = document.getElementById('maszyna-client-filter');
    const maszynaForm = document.getElementById('maszyna-form');
    const maszynaAddBtn = document.getElementById('maszyna-add-btn');
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
    const annualSummaryExportBtn = document.getElementById('annual-summary-export');
    const vacationYearSelect = document.getElementById('vacation-year');
    const vacationAllowanceInput = document.getElementById('vacation-allowance-input');
    const vacationAllowanceSaveBtn = document.getElementById('vacation-allowance-save');
    const vacationUsedSpan = document.getElementById('vacation-used');
    const vacationRemainingSpan = document.getElementById('vacation-remaining');
    const vacationAdjustmentsTotalSpan = document.getElementById('vacation-adjustments-total');
    const vacationTabs = document.getElementById('vacation-tabs');
    const vacationUsedList = document.getElementById('vacation-used-list');
    const vacationAdjustmentForm = document.getElementById('vacation-adjustment-form');
    const vacationAdjustmentDateInput = document.getElementById('vacation-adjustment-date');
    const vacationAdjustmentDaysInput = document.getElementById('vacation-adjustment-days');
    const vacationAdjustmentNoteInput = document.getElementById('vacation-adjustment-note');
    const vacationAdjustmentsDiv = document.getElementById('vacation-adjustments');
    const plannedLeaveForm = document.getElementById('planned-leave-form');
    const plannedLeaveStartInput = document.getElementById('planned-leave-start');
    const plannedLeaveEndInput = document.getElementById('planned-leave-end');
    const plannedLeaveTypeSelect = document.getElementById('planned-leave-type');
    const plannedLeaveNoteInput = document.getElementById('planned-leave-note');
    const plannedLeaveWorkingDaysInput = document.getElementById('planned-leave-working-days');
    const plannedLeaveSubmitBtn = document.getElementById('planned-leave-submit');
    const plannedLeaveCancelBtn = document.getElementById('planned-leave-cancel');
    const plannedLeaveList = document.getElementById('planned-leave-list');
    const plannedLeaveTotalSpan = document.getElementById('planned-leave-total');
    const modalMagazynLista = document.getElementById('modal-magazyn-lista');
    const partsToRemoveList = document.getElementById('parts-to-remove-list');
    const magazynForm = document.getElementById('magazyn-form');
    const magazynLista = document.getElementById('magazyn-lista');
    const magazynTable = document.getElementById('magazyn-table');
    const magazynSearchInput = document.getElementById('magazyn-search-input');
    const magazynFilterClient = document.getElementById('magazyn-filter-client');
    const magazynFilterOilType = document.getElementById('magazyn-filter-oil-type');
    const magazynFilterContainer = document.getElementById('magazyn-filter-container');
    const magazynAddBtn = document.getElementById('magazyn-add-btn');
    const magazynBulkBtn = document.getElementById('magazyn-bulk-btn');
    const magazynOilToolsBtn = document.getElementById('magazyn-oil-tools-btn');
    const bulkAddForm = document.getElementById('bulk-add-form');
    const stockModal = document.getElementById('stock-change-modal');
    const bulkItemsInput = document.getElementById('bulk-items');
    const bulkPreviewList = document.getElementById('bulk-preview-list');
    const bulkErrors = document.getElementById('bulk-errors');
    const bulkReport = document.getElementById('bulk-add-report');

    let orderClientCombobox = null;
    const ORDER_QUICK_OPTION = {
        id: 'szybkie-zlecenie',
        name: 'Szybkie zlecenie (bez klienta)',
        nip: '',
        isSpecial: true
    };
    const productDetailsModal = document.getElementById('product-details-modal');
    const productDetailsCloseButton = productDetailsModal ? productDetailsModal.querySelector('.close-button') : null;
    const productEditForm = document.getElementById('product-edit-form');
    const productEditId = document.getElementById('product-edit-id');
    const productEditIndex = document.getElementById('product-edit-index');
    const productEditName = document.getElementById('product-edit-name');
    const productEditClient = document.getElementById('product-edit-client');
    const productCurrentQty = document.getElementById('product-current-qty');
    const productCurrentLiters = document.getElementById('product-current-liters');
    const productLastChange = document.getElementById('product-last-change');
    const productChangeQtyInput = document.getElementById('product-change-qty');
    const productChangeUnit = document.getElementById('product-change-unit');
    const productAddBtn = document.getElementById('product-add-btn');
    const productRemoveBtn = document.getElementById('product-remove-btn');
    const productDeleteBtn = document.getElementById('product-delete-btn');
    const qtyToggleButtons = productDetailsModal ? productDetailsModal.querySelectorAll('.qty-toggle') : [];
    const productAddModal = document.getElementById('product-add-modal');
    const productAddCloseButton = productAddModal ? productAddModal.querySelector('.close-button') : null;
    const bulkAddModal = document.getElementById('bulk-add-modal');
    const bulkAddCloseButton = bulkAddModal ? bulkAddModal.querySelector('.close-button') : null;
    const itemIsOilCheckbox = document.getElementById('item-is-oil');
    const itemOilFields = document.getElementById('item-oil-fields');
    const itemOilTypeSelect = document.getElementById('item-oil-type');
    const itemOilContainerSelect = document.getElementById('item-oil-container');
    const itemProductTypeSelect = document.getElementById('item-product-type');
    const oilToolsDrawer = document.getElementById('oil-tools-drawer');
    const oilToolsTabs = oilToolsDrawer ? oilToolsDrawer.querySelectorAll('[data-drawer-tab]') : [];
    const oilToolsPanels = oilToolsDrawer ? oilToolsDrawer.querySelectorAll('[data-drawer-panel]') : [];
    const oilConverterContainer = document.getElementById('oil-converter-container');
    const oilConverterLitersInput = document.getElementById('oil-converter-liters');
    const oilConverterUnitsInput = document.getElementById('oil-converter-units');
    const oilQuickTypeSelect = document.getElementById('oil-quick-type');
    const oilQuickContainerSelect = document.getElementById('oil-quick-container');
    const oilQuickQuantityInput = document.getElementById('oil-quick-quantity');
    const oilQuickUnitSelect = document.getElementById('oil-quick-unit');
    const oilQuickClientInput = document.getElementById('oil-quick-client');
    const oilQuickSubmitBtn = document.getElementById('oil-quick-submit');
    const themeSelect = document.getElementById('theme-select');
    const zakonczoneZleceniaHeader = document.getElementById('zakonczone-zlecenia-header');
    const zlecenieSearchInput = document.getElementById('zlecenie-search-input');
    const kalendarzMultiWrapper = document.getElementById('kalendarz-zlecenia-multi');
    const kalendarzMultiSelect = kalendarzMultiWrapper ? kalendarzMultiWrapper.querySelector('.multi-zlecenie-select') : null;
    const kalendarzMultiHoursInput = kalendarzMultiWrapper ? kalendarzMultiWrapper.querySelector('.multi-zlecenie-fh') : null;
    const kalendarzMultiAddButton = kalendarzMultiWrapper ? kalendarzMultiWrapper.querySelector('.multi-add') : null;
    const kalendarzMultiList = document.getElementById('kalendarz-zlecenia-list');
    const clientDrawer = document.getElementById('client-drawer');
    const clientDrawerTitle = document.getElementById('client-drawer-title');
    const clientDeleteBtn = document.getElementById('client-delete-btn');
    const editKlientForm = document.getElementById('edit-klient-form');
    const machineDrawer = document.getElementById('machine-drawer');
    const machineDrawerTitle = document.getElementById('machine-drawer-title');
    const machineDeleteBtn = document.getElementById('machine-delete-btn');
    const editMaszynaForm = document.getElementById('edit-maszyna-form');
    const editMaszynaKlientInput = document.getElementById('edit-maszyna-klient-input');
    const editMaszynaKlientIdInput = document.getElementById('edit-maszyna-klient-id');
    const editMaszynaKlientDropdown = document.getElementById('edit-maszyna-klient-dropdown');
    const editMaszynaKlientClearBtn = editMaszynaKlientInput?.closest('.combobox')?.querySelector('.combobox-clear');
    const detailsZlecenieModal = document.getElementById('details-zlecenie-modal');
    const detailsZlecenieCloseButton = detailsZlecenieModal ? detailsZlecenieModal.querySelector('.close-button') : null;
    const klientSearchInput = document.getElementById('klient-search-input');
    const clientViewPanel = document.getElementById('client-view');
    const clientViewName = document.getElementById('client-view-name');
    const clientViewNip = document.getElementById('client-view-nip');
    const clientViewAddress = document.getElementById('client-view-address');
    const clientViewPhone = document.getElementById('client-view-phone');
    const clientViewEditBtn = document.getElementById('client-view-edit-btn');
    const clientEditCancelBtn = document.getElementById('client-edit-cancel-btn');
    const maszynaSearchInput = document.getElementById('maszyna-search-input');
    const editZlecenieModal = document.getElementById('edit-zlecenie-modal');
    const editZlecenieForm = document.getElementById('edit-zlecenie-form');
    const machineHistoryModal = document.getElementById('machine-history-modal');
    const machineHistoryList = document.getElementById('machine-history-list');
    const editZlecenieCloseButton = editZlecenieModal ? editZlecenieModal.querySelector('.close-button') : null;
    const machineHistoryCloseButton = machineHistoryModal ? machineHistoryModal.querySelector('.close-button') : null;
    const magazynTab = document.getElementById('magazyn');
    const magazynSummaryBox = document.getElementById('magazyn-summary');

    const getStockUiState = () => ({
        isStockLoading: stockStatus === 'loading' && !hasLoadedStockOnce,
        isStockReady: stockStatus === 'ready'
    });

    const renderMagazynSummary = () => {
        if (!magazynSummaryBox) return;
        const { isStockLoading } = getStockUiState();
        if (isStockLoading) {
            magazynSummaryBox.innerHTML = '<p class="loading-state">Ładowanie magazynu...</p>';
            return;
        }
        if (stockStatus === 'error') {
            magazynSummaryBox.innerHTML = '<p class="loading-state">Nie udało się załadować magazynu.</p>';
            return;
        }
        magazynSummaryBox.innerHTML = '';
    };

    const setBootstrapLoadingState = () => {
        if (listaKlientowDiv) listaKlientowDiv.innerHTML = '<p class="loading-state">Ładowanie klientów...</p>';
        if (listaMaszynDiv) listaMaszynDiv.innerHTML = '<p class="loading-state">Ładowanie maszyn...</p>';
        if (aktywneZleceniaLista) aktywneZleceniaLista.innerHTML = '<p class="loading-state">Ładowanie zleceń...</p>';
        if (ukonczoneZleceniaLista) ukonczoneZleceniaLista.innerHTML = '<p class="loading-state">Ładowanie zleceń...</p>';
        if (kalendarzPodsumowanieDiv) kalendarzPodsumowanieDiv.innerHTML = '<p class="loading-state">Ładowanie podsumowania...</p>';
        if (pulpitQuickActionsContainer) pulpitQuickActionsContainer.innerHTML = '<p class="loading-state">Ładowanie akcji...</p>';
        if (pulpitWeeklyContainer) pulpitWeeklyContainer.innerHTML = '<p class="loading-state">Ładowanie tygodnia...</p>';
        if (pulpitActivityList) pulpitActivityList.innerHTML = '<li class="loading-state">Ładowanie aktywności...</li>';
        if (zakonczoneSummaryContainer) zakonczoneSummaryContainer.innerHTML = '<p class="loading-state">Ładowanie podsumowania...</p>';
        if (annualSummaryContainer) annualSummaryContainer.innerHTML = '<p class="loading-state">Ładowanie podsumowania...</p>';
        if (l4SummaryContainer) l4SummaryContainer.innerHTML = '<p class="loading-state">Ładowanie podsumowania...</p>';
        renderMagazynSummary();
        if (magazynLista && getStockUiState().isStockLoading) {
            magazynLista.innerHTML = '<tr><td colspan="7" class="loading-state">Ładowanie magazynu...</td></tr>';
        }
    };

    setBootstrapLoadingState();

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

    const resolveServiceDate = (order) => {
        if (!order) return '';
        const raw = order.serviceDate || order.performedAt || order.dataUkonczenia || '';
        return typeof raw === 'string' ? raw : formatDateForStorage(toDateSafe(raw));
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

    const listDaysInRange = (start, end) => {
        const startDate = normalizeAllDayDate(start);
        const endDate = normalizeAllDayDate(end);
        if (!startDate || !endDate) return [];
        const days = [];
        const cursor = new Date(startDate.getTime());
        while (cursor < endDate) {
            days.push(formatDateForStorage(cursor));
            cursor.setDate(cursor.getDate() + 1);
        }
        return days;
    };

    const listDaysInclusive = (start, end) => {
        const startDate = normalizeAllDayDate(start);
        const endDate = normalizeAllDayDate(end);
        if (!startDate || !endDate) return [];
        const [from, to] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
        const days = [];
        let cursor = new Date(from.getTime());
        while (cursor <= to) {
            days.push(formatDateForStorage(cursor));
            cursor = addDaysToDate(cursor, 1);
            if (!cursor) break;
        }
        return days;
    };

    const isWeekendDay = (dayStr) => {
        const date = toDateSafe(dayStr);
        if (!date) return false;
        const day = date.getDay();
        return day === 0 || day === 6;
    };

    const isWeekend = (dayStr) => isWeekendDay(dayStr);

    const isOnOrAfterMinDate = (dayKey) => Boolean(dayKey) && dayKey >= MIN_DATE;

    const resolveDayStatus = (dayKey) => {
        const direct = leaveByDay.get(dayKey);
        if (direct) return direct;
        const dayDoc = dayDocsByDay.get(dayKey);
        if (!dayDoc) return null;
        const normalizedKind = normalizeDayLeaveValue(dayDoc?.leaveKind || dayDoc?.dayLeave || '');
        if (normalizedKind && normalizedKind !== DAY_LEAVE_NONE) return normalizedKind;
        const flags = dayDoc?.flags || {};
        if (flags.l4) return 'L4';
        if (flags.urlop) return 'URL';
        if (flags.swieto) return 'SWIETO';
        if (flags.wolne) return 'WOLNE';
        if (flags.szkolenie) return 'SZKOLENIE';
        return null;
    };

    const getChecklistRange = () => {
        const view = calendar?.view || window.__fcCalendar?.view;
        const today = normalizeAllDayDate(new Date());
        if (!today) return { start: null, end: null };
        const todayEnd = addDaysToDate(today, 1);
        const fallbackStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const viewStart = normalizeAllDayDate(view?.currentStart) || fallbackStart;
        const viewEnd = normalizeAllDayDate(view?.currentEnd) || todayEnd;
        const minDate = normalizeAllDayDate(MIN_DATE);
        const start = minDate && viewStart < minDate ? minDate : viewStart;
        const end = todayEnd && viewEnd > todayEnd ? todayEnd : viewEnd;
        return { start, end };
    };

    const buildUnfinishedSummary = () => {
        const { start: checklistStart, end: checklistEnd } = getChecklistRange();
        const daysInRange = checklistStart && checklistEnd ? listDaysInRange(checklistStart, checklistEnd) : [];
        const isDayOffStatus = (status) => DAY_OFF_STATUSES.includes(status);
        const hasAnyActivity = (dayKey) => {
            const ordersForDay = Array.isArray(ordersByDay.get(dayKey)) ? ordersByDay.get(dayKey) : [];
            if (ordersForDay.length > 0) return true;
            const manualTotals = manualByDay.get(dayKey) || {};
            const manualValue = Number(manualTotals.work || 0)
                + Number(manualTotals.drive || 0)
                + Number(manualTotals.billed || 0)
                + Number(manualTotals.over || 0);
            if (manualValue !== 0) return true;
            const dayDoc = dayDocsByDay.get(dayKey);
            const note = (dayDoc?.notatka || dayDoc?.note || '').toString().trim();
            return note.length > 0;
        };
        const buildDayData = (dayKey) => {
            const ordersForDay = Array.isArray(ordersByDay.get(dayKey)) ? ordersByDay.get(dayKey) : [];
            const manualTotals = manualByDay.get(dayKey) || {};
            const manualValue = Number(manualTotals.work || 0)
                + Number(manualTotals.drive || 0)
                + Number(manualTotals.billed || 0)
                + Number(manualTotals.over || 0);
            const orderValue = ordersForDay.reduce((acc, entry) => {
                const work = Number(entry?.work || 0);
                const drive = Number(entry?.drive || 0);
                const billed = Number(entry?.billed || 0);
                const over = Number(entry?.over || 0);
                return acc + work + drive + billed + over;
            }, 0);
            return {
                dayStr: dayKey,
                status: resolveDayStatus(dayKey),
                hasOrders: ordersForDay.length > 0,
                hasManualValue: manualValue !== 0,
                hasOrderValue: orderValue !== 0,
                hasAnyActivity: hasAnyActivity(dayKey),
            };
        };
        const dayData = daysInRange.map(buildDayData);
        const daysWithoutSummary = dayData.filter((day) => {
            if (!isOnOrAfterMinDate(day.dayStr)) return false;
            const eligible = !isWeekend(day.dayStr) || (isWeekend(day.dayStr) && day.hasAnyActivity);
            if (!eligible) return false;
            if (isDayOffStatus(day.status)) return false;
            const hasSummaryData = day.hasManualValue || day.hasOrderValue;
            return !hasSummaryData;
        }).map(day => day.dayStr);

        const ordersWithActivitySinceMinDate = new Set();
        ordersByDay.forEach((ordersForDay, dayKey) => {
            const normalizedDay = normalizeDayKey(dayKey, 'ordersByDay');
            if (!normalizedDay || !isOnOrAfterMinDate(normalizedDay)) return;
            (ordersForDay || []).forEach((entry) => {
                const orderId = entry?.orderId || entry?.zlecenieId || entry?.id || null;
                if (orderId) ordersWithActivitySinceMinDate.add(orderId);
            });
        });

        const ordersWithoutBilling = _wszystkieZleceniaCache
            .filter((order) => {
                const status = order?.status;
                if (!(status === 'ukończone' || status === 'ukonczone')) return false;
                if (!ordersWithActivitySinceMinDate.has(order.id)) return false;
                const billed = Number(order?.wyfakturowaneGodziny ?? order?.wyfakturowane ?? 0) || 0;
                return billed <= 0;
            })
            .map(order => order.id);

        const plannedLeaveWithoutCalendar = plannedLeaveEntries
            .filter((entry) => {
                const days = listDaysInclusive(entry.startDate, entry.endDate)
                    .filter(day => isOnOrAfterMinDate(day) && !isWeekend(day));
                if (!days.length) return false;
                const hasCalendarEntry = days.some(day => leaveByDay.has(day));
                return !hasCalendarEntry;
            })
            .map(entry => entry.id);

        const total = daysWithoutSummary.length + ordersWithoutBilling.length + plannedLeaveWithoutCalendar.length;

        return {
            daysWithoutSummary,
            ordersWithoutBilling,
            plannedLeaveWithoutCalendar,
            total
        };
    };

    const buildOrderIndex = () => new Map(
        _wszystkieZleceniaCache.map(order => [order.id, order])
    );

    const hashString = (value) => {
        const source = String(value || '');
        let hash = 0;
        for (let i = 0; i < source.length; i += 1) {
            hash = ((hash << 5) - hash) + source.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    };

    const resolveOrderClientName = (orderId, entryClientName, orderIndex) => {
        if (entryClientName) return entryClientName;
        const order = orderIndex.get(orderId);
        if (!order) return orderId || 'Zlecenie';
        const klient = _wszystkieKlienciCache.find(k => k.id === order.klientId);
        return order.klientNazwa || klient?.nazwa || orderId || 'Zlecenie';
    };

    const buildManualDayDoc = (dayDoc = {}) => ({
        work: parsePlNumber(dayDoc?.work ?? dayDoc?.praca ?? 0),
        drive: parsePlNumber(dayDoc?.drive ?? dayDoc?.jazda ?? 0),
        billed: parsePlNumber(dayDoc?.billed ?? dayDoc?.fakturowane ?? 0),
        over: parsePlNumber(dayDoc?.nadgodziny ?? 0),
    });

    const buildOrdersForDay = (dayDoc = {}, orderIndex) => {
        const { powiazane } = normalizujPowiazaneZlecenia(dayDoc || {});
        return powiazane.map(entry => ({
            orderId: entry.zlecenieId,
            clientName: resolveOrderClientName(entry.zlecenieId, entry.klientNazwa, orderIndex),
            work: parsePlNumber(entry?.work ?? 0),
            drive: parsePlNumber(entry?.drive ?? 0),
            billed: parsePlNumber(entry?.fakturowane ?? 0),
            over: parsePlNumber(entry?.over ?? 0),
        }));
    };

    const rebuildCalendarDecorations = (rangeStart, rangeEnd) => {
        const view = calendar?.view || window.__fcCalendar?.view;
        const start = rangeStart || view?.currentStart || null;
        const end = rangeEnd || view?.currentEnd || null;
        const summaryByDay = {};
        const leaveByDayOut = {};
        const clientsByDay = {};
        const orderEvents = [];
        const orderIndex = buildOrderIndex();
        const daysToRender = start && end ? listDaysInRange(start, end) : Array.from(new Set([
            ...manualByDay.keys(),
            ...ordersByDay.keys(),
            ...leaveByDay.keys(),
            ...dayDocsByDay.keys()
        ]));

        daysToRender.forEach((dayStr) => {
            const normalizedDay = normalizeDayKey(dayStr, 'rebuildCalendarDecorations');
            if (!normalizedDay) return;
            const { praca, jazda, fakturowane, nadgodziny, status, hasAnyData } = aggregateDayData(normalizedDay);
            if (status) {
                leaveByDayOut[normalizedDay] = status;
                return;
            }
            const dayDoc = dayDocsByDay.get(normalizedDay);
            const ordersForDay = Array.isArray(ordersByDay.get(normalizedDay)) ? ordersByDay.get(normalizedDay) : [];
            if (dayDoc) {
                const { powiazane } = normalizujPowiazaneZlecenia(dayDoc);
                const clientNamesForDay = [];
                powiazane.forEach((entry) => {
                    const clientName = resolveOrderClientName(entry.zlecenieId, entry.klientNazwa, orderIndex);
                    if (clientName) clientNamesForDay.push(clientName);
                    const idSuffix = entry.zlecenieId || hashString(clientName || 'client');
                    orderEvents.push({
                        id: `client_${normalizedDay}_${idSuffix}`,
                        start: normalizedDay,
                        allDay: true,
                        title: clientName || 'Zlecenie',
                        classNames: ['order-event', 'fc-client-chip', 'client-chip', 'bober-chip', 'bober-chip--client'],
                        extendedProps: { day: normalizedDay, orderId: entry.zlecenieId || null, type: 'client' },
                        sortOrder: 1
                    });
                });
                if (clientNamesForDay.length) {
                    clientsByDay[normalizedDay] = Array.from(new Set(clientNamesForDay));
                }
            }
            if (hasAnyData) {
                summaryByDay[normalizedDay] = {
                    praca,
                    jazda,
                    fakturowane,
                    nadgodziny,
                };
            }
        });

        lastSummaryByDay = summaryByDay;
        lastLeaveByDay = leaveByDayOut;
        setDecorations({ summaryByDay, leaveByDay: leaveByDayOut, plannedLeaveByDay: Object.fromEntries(plannedLeaveByDay), clientsByDay });
        console.log('orderEvents:', orderEvents.length, orderEvents.slice(0, 5));
        workEvents = [...orderEvents];
        updateCalendarData(calendar, workEvents, []);
        renderDayPanel();
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
            return;
        }
        const startDate = normalizeAllDayDate(dateKey);
        if (!startDate) return;
        const payload = {
            start: formatDateForStorage(startDate),
            end: formatDateForStorage(addDaysToDate(startDate, 1)),
            allDay: true,
            leaveKind: normalizedKind,
            typ: normalizedKind,
            type: normalizedKind
        };
        try {
            await setDoc(leaveDocRef, payload);
        } catch (error) {
            console.error('Błąd zapisu urlopu:', error);
        }
    }

    const trackedModals = [];
    [kalendarzModal, completeModal, stockModal, productDetailsModal, productAddModal, assignModal, detailsZlecenieModal, editZlecenieModal, machineHistoryModal]
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

    const calendarFormDock = {
        modalParent: kalendarzForm?.parentElement || null,
        modalNextSibling: kalendarzForm?.nextSibling || null,
        docked: false
    };

    const getCalendarPanelFormHost = () => calendarDayPanel?.querySelector('[data-panel-form-host]') || null;

    const dockCalendarFormToPanel = () => {
        if (!kalendarzForm) return;
        const host = getCalendarPanelFormHost();
        if (!host || host.contains(kalendarzForm)) return;
        host.appendChild(kalendarzForm);
        kalendarzForm.classList.add('calendar-day-form');
        calendarFormDock.docked = true;
    };

    const restoreCalendarFormToModal = () => {
        if (!kalendarzForm || !calendarFormDock.modalParent) return;
        if (calendarFormDock.modalParent.contains(kalendarzForm)) return;
        if (calendarFormDock.modalNextSibling && calendarFormDock.modalParent.contains(calendarFormDock.modalNextSibling)) {
            calendarFormDock.modalParent.insertBefore(kalendarzForm, calendarFormDock.modalNextSibling);
        } else {
            calendarFormDock.modalParent.appendChild(kalendarzForm);
        }
        calendarFormDock.docked = false;
    };

    const hideModal = (modal) => {
        if (!modal) return;
        modal.style.display = 'none';
        if (modal === kalendarzModal && ENABLE_DAY_PANEL) {
            dockCalendarFormToPanel();
        }
        if (!isAnyModalOpen()) {
            hideBackdrop();
        }
    };

    modalBackdrop.addEventListener('click', () => closeAllModals());

    const trackedDrawers = [clientDrawer, machineDrawer, oilToolsDrawer].filter(Boolean);
    const isAnyDrawerOpen = () => trackedDrawers.some(drawer => drawer.classList.contains('is-open'));
    const openDrawer = (drawer) => {
        if (!drawer) return;
        drawer.classList.add('is-open');
        drawer.setAttribute('aria-hidden', 'false');
        document.body.classList.add('drawer-open');
    };
    const closeDrawer = (drawer) => {
        if (!drawer) return;
        drawer.classList.remove('is-open');
        drawer.setAttribute('aria-hidden', 'true');
        if (!isAnyDrawerOpen()) {
            document.body.classList.remove('drawer-open');
        }
    };

    const showTab = (tabName) => {
        document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
        document.querySelectorAll('.tab-button').forEach(button => button.classList.remove('active'));
        const target = document.getElementById(tabName);
        if (target) target.style.display = 'block';
        const trigger = document.querySelector(`.tab-button[onclick*="'${tabName}'"]`);
        if (trigger) trigger.classList.add('active');
        handleTabActivation(tabName);
    };

    const handleTabActivation = (tabName) => {
        if (tabName === 'magazyn') {
            ensureMagazynSummaryPlacement();
        }
        if (tabName === 'pulpit' || tabName === 'kalendarz-tab') {
            syncCalendarShellHeight();
            if (!bootstrapReady) {
                pendingCalendarInit = true;
                return;
            }
            void initCalendarModule('tab-activation');
        }
    };

    const createUnfinishedButton = () => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'unfinished-button';
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-expanded', 'false');
        button.innerHTML = `
            <span class="unfinished-button-icon">⏳</span>
            <span class="unfinished-button-label">Niedokończone</span>
            <span class="unfinished-badge">0</span>
        `;
        button.addEventListener('click', () => {
            setUnfinishedDrawerView('summary');
            setUnfinishedDrawerOpen(true);
        });
        return button;
    };

    const createUnfinishedDrawer = () => {
        const drawer = document.createElement('div');
        drawer.id = 'unfinished-drawer';
        drawer.className = 'drawer drawer--unfinished';
        drawer.setAttribute('aria-hidden', 'true');
        drawer.innerHTML = `
            <div class="drawer-backdrop" data-drawer-close></div>
            <div class="drawer-panel" role="dialog" aria-label="Niedokończone zadania">
                <div class="drawer-header">
                    <div>
                        <p class="drawer-eyebrow">Pulpit</p>
                        <h3>Niedokończone</h3>
                        <p class="unfinished-note">Liczone od 01.01.2026</p>
                    </div>
                    <button type="button" class="drawer-close" data-drawer-close aria-label="Zamknij">×</button>
                </div>
                <div class="drawer-body">
                    <div class="unfinished-list" data-unfinished-list></div>
                    <div class="unfinished-empty" data-unfinished-empty>OK / Brak zaległości</div>
                </div>
            </div>
        `;
        return drawer;
    };

    const renderUnfinishedButton = () => {
        if (!unfinishedButton) return;
        const badge = unfinishedButton.querySelector('.unfinished-badge');
        if (!badge) return;
        badge.textContent = String(unfinishedSummary.total || 0);
        badge.classList.toggle('is-empty', (unfinishedSummary.total || 0) === 0);
    };

    const getUnfinishedItemConfig = () => ([
        {
            key: 'daysWithoutSummary',
            title: 'Dni bez podsumowania',
            description: 'Dni z wpisem bez wypełnionego podsumowania.',
            count: unfinishedSummary.daysWithoutSummary.length
        },
        {
            key: 'ordersWithoutBilling',
            title: 'Zlecenia bez fakturowania',
            description: 'Ukończone zlecenia bez wpisanych godzin fakturowanych.',
            count: unfinishedSummary.ordersWithoutBilling.length
        },
        {
            key: 'plannedLeaveWithoutCalendar',
            title: 'Planowany urlop bez wpisu do kalendarza',
            description: 'Plany urlopów nieodzwierciedlone w kalendarzu.',
            count: unfinishedSummary.plannedLeaveWithoutCalendar.length
        }
    ]);

    const renderUnfinishedDrawer = () => {
        if (!unfinishedDrawer) return;
        const list = unfinishedDrawer.querySelector('[data-unfinished-list]');
        const empty = unfinishedDrawer.querySelector('[data-unfinished-empty]');
        if (!list || !empty) return;
        if (unfinishedDrawerView.mode === 'week-missing') {
            const days = Array.isArray(unfinishedDrawerView.days) ? unfinishedDrawerView.days : [];
            list.innerHTML = `
                <div class="unfinished-subheader">
                    <button type="button" class="btn-ghost" data-unfinished-back>← Wróć</button>
                    <span>Braki w tym tygodniu</span>
                </div>
                ${days.map(day => `
                    <button type="button" class="unfinished-item" data-unfinished-day="${day}">
                        <div class="unfinished-item-header">
                            <span class="unfinished-item-title">${day}</span>
                            <span class="unfinished-item-count">Brak ewidencji</span>
                        </div>
                    </button>
                `).join('') || '<div class="unfinished-empty-inline">Brak braków w tym tygodniu.</div>'}
            `;
            empty.style.display = 'none';
            list.style.display = 'grid';
            return;
        }
        const items = getUnfinishedItemConfig();
        list.innerHTML = items.map(item => `
            <button type="button" class="unfinished-item" data-unfinished-item="${item.key}">
                <div class="unfinished-item-header">
                    <span class="unfinished-item-title">${item.title}</span>
                    <span class="unfinished-item-count">${item.count}</span>
                </div>
                <div class="unfinished-item-desc">${item.description}</div>
            </button>
        `).join('');
        const isEmpty = (unfinishedSummary.total || 0) === 0;
        empty.style.display = isEmpty ? 'block' : 'none';
        list.style.display = isEmpty ? 'none' : 'grid';
    };

    const setUnfinishedDrawerOpen = (isOpen) => {
        unfinishedDrawerOpen = Boolean(isOpen);
        if (!unfinishedDrawer) return;
        if (unfinishedButton) {
            unfinishedButton.setAttribute('aria-expanded', String(unfinishedDrawerOpen));
        }
        if (unfinishedDrawerOpen) {
            openDrawer(unfinishedDrawer);
        } else {
            closeDrawer(unfinishedDrawer);
        }
    };

    const setUnfinishedDrawerView = (mode = 'summary', days = []) => {
        unfinishedDrawerView = {
            mode,
            days: Array.isArray(days) ? days : []
        };
        renderUnfinishedDrawer();
    };

    const handleUnfinishedItemClick = (key) => {
        if (!key) return;
        if (key !== 'ordersWithoutBilling') {
            ordersFilterMode = null;
        }
        if (key === 'daysWithoutSummary') {
            showTab('kalendarz-tab');
            const target = unfinishedSummary.daysWithoutSummary[0];
            if (target && calendar?.gotoDate) {
                calendar.gotoDate(target);
            }
        }
        if (key === 'ordersWithoutBilling') {
            ordersFilterMode = 'unbilled';
            showTab('zlecenia');
            wyswietlZlecenia();
        }
        if (key === 'plannedLeaveWithoutCalendar') {
            showTab('podsumowanie');
            setActiveVacationTab('planned');
            plannedLeaveList?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        setUnfinishedDrawerOpen(false);
    };

    const updateUnfinishedSummary = () => {
        unfinishedSummary = buildUnfinishedSummary();
        renderUnfinishedButton();
        renderUnfinishedDrawer();
    };

    const setupUnfinishedUI = () => {
        if (!unfinishedButtonSlot) return;
        unfinishedButton = createUnfinishedButton();
        unfinishedButtonSlot.appendChild(unfinishedButton);
        unfinishedDrawer = createUnfinishedDrawer();
        document.body.appendChild(unfinishedDrawer);
        trackedDrawers.push(unfinishedDrawer);
        unfinishedDrawer.querySelectorAll('[data-drawer-close]').forEach(btn => {
            btn.addEventListener('click', () => setUnfinishedDrawerOpen(false));
        });
        unfinishedDrawer.addEventListener('click', (event) => {
            const backButton = event.target.closest('[data-unfinished-back]');
            if (backButton) {
                setUnfinishedDrawerView('summary');
                return;
            }
            const dayButton = event.target.closest('[data-unfinished-day]');
            if (dayButton) {
                const dayKey = dayButton.dataset.unfinishedDay;
                if (dayKey) {
                    showTab('kalendarz-tab');
                    focusCalendarDay(dayKey);
                }
                setUnfinishedDrawerOpen(false);
                return;
            }
            const target = event.target.closest('[data-unfinished-item]');
            if (!target) return;
            handleUnfinishedItemClick(target.dataset.unfinishedItem);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && unfinishedDrawerOpen) {
                setUnfinishedDrawerOpen(false);
            }
        });
        updateUnfinishedSummary();
    };

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
    setupUnfinishedUI();

    // --- INICJALIZACJA UI / TABS / MOTYW ---
    window.openTab = (evt, tabName) => {
        document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
        document.querySelectorAll('.tab-button').forEach(button => button.classList.remove('active'));
        const activeTab = document.getElementById(tabName);
        if (!activeTab) return;
        activeTab.style.display = activeTab.classList.contains('calendarSection') ? 'flex' : 'block';
        evt.currentTarget.classList.add('active');
        handleTabActivation(tabName);
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
    inicjujMotywJohnDeere();
    inicjujZwijanie();
    ensureZakonczenieNotatkaField(); // wstrzyknięcie pola notatki do modala (index.html bez zmian)

    odswiezSelectKlientaDoZlecenia();

    const dayGridPlugin = (window.dayGrid && window.dayGrid.default) || FullCalendar?.dayGridPlugin || FullCalendar?.dayGrid;
    const interactionPlugin = (window.interaction && window.interaction.default) || FullCalendar?.interactionPlugin || FullCalendar?.interaction;
    const calendarPlugins = [dayGridPlugin, interactionPlugin].filter(Boolean);
    const todayKey = formatDateForStorage(new Date());
    let calendarReturnState = readCalendarReturnState();

    const setCalendarViewClass = (viewKey) => {
        if (!calendarShell) return;
        calendarShell.classList.remove('view-day', 'view-week', 'view-month');
        if (viewKey) {
            calendarShell.classList.add(`view-${viewKey}`);
        }
    };

    const setCalendarToolbarDisabled = (disabled, tooltip = '') => {
        calendarViewButtons.forEach((button) => {
            button.disabled = disabled;
            if (disabled) {
                button.title = tooltip;
            } else if (button.title === tooltip) {
                button.title = '';
            }
        });
        if (calendarTodayBtn) {
            calendarTodayBtn.disabled = disabled;
            calendarTodayBtn.title = disabled ? tooltip : '';
        }
        if (calendarFocusBtn) {
            calendarFocusBtn.disabled = disabled;
            calendarFocusBtn.title = disabled ? tooltip : '';
        }
        if (calendarBackBtn) {
            calendarBackBtn.disabled = disabled;
            calendarBackBtn.title = disabled ? tooltip : '';
        }
    };

    const updateCalendarToolbarState = () => {
        if (!calendarToolbar) return;
        const api = getCalendarApi();
        if (!api) {
            setCalendarViewClass(null);
            setCalendarToolbarDisabled(true, 'Kalendarz się ładuje');
            if (calendarTitleEl) calendarTitleEl.textContent = 'Ładowanie...';
            return;
        }
        setCalendarToolbarDisabled(false);
        const viewKey = fcViewToCalendarKey(api.view?.type);
        setCalendarViewClass(viewKey);
        calendarViewButtons.forEach((button) => {
            const isActive = button.dataset.calendarView === viewKey;
            button.classList.toggle('is-active', isActive);
        });
        if (calendarTitleEl) {
            calendarTitleEl.textContent = api.view?.title || '';
        }
        if (calendarBackBtn) {
            const hasReturn = Boolean(calendarReturnState?.viewKey && calendarReturnState?.dateStr);
            calendarBackBtn.disabled = !hasReturn;
            calendarBackBtn.textContent = viewKey === 'day' ? 'Wróć do tygodnia' : 'Wróć';
        }
        if (calendarFocusBtn) {
            calendarFocusBtn.disabled = viewKey === 'day';
        }
        applyDayPanelState();
    };

    const focusCalendarDay = (dateStr, sourceViewKey = null) => {
        const api = getCalendarApi();
        if (!api || !dateStr) return;
        const currentViewKey = sourceViewKey || fcViewToCalendarKey(api.view?.type);
        if (currentViewKey !== 'day') {
            calendarReturnState = { viewKey: currentViewKey, dateStr };
            persistCalendarReturnState(currentViewKey, dateStr);
        }
        persistCalendarDate(dateStr);
        api.changeView(calendarViewKeyToFc('day'), dateStr);
        updateCalendarToolbarState();
    };

    const setCalendarView = (viewKey, dateStr) => {
        const api = getCalendarApi();
        if (!api) return;
        const targetView = calendarViewKeyToFc(viewKey);
        const targetDate = dateStr || api.getDate?.() || new Date();
        api.changeView(targetView, targetDate);
        persistCalendarView(targetView);
        if (dateStr) persistCalendarDate(dateStr);
        updateCalendarToolbarState();
    };

    const bindCalendarToolbar = () => {
        if (!calendarToolbar) return;
        calendarViewButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const viewKey = button.dataset.calendarView;
                if (viewKey) {
                    const focusDate = readCalendarDateFromStorage() || todayKey;
                    setCalendarView(viewKey, focusDate);
                }
            });
        });
        calendarTodayBtn?.addEventListener('click', () => {
            const api = getCalendarApi();
            if (!api) return;
            api.today();
            persistCalendarDate(todayKey);
            updateCalendarToolbarState();
        });
        calendarFocusBtn?.addEventListener('click', () => {
            const focusDate = readCalendarDateFromStorage() || todayKey;
            focusCalendarDay(focusDate);
        });
        calendarBackBtn?.addEventListener('click', () => {
            if (!calendarReturnState?.viewKey || !calendarReturnState?.dateStr) return;
            setCalendarView(calendarReturnState.viewKey, calendarReturnState.dateStr);
            calendarReturnState = { viewKey: null, dateStr: null };
            clearCalendarReturnState();
            updateCalendarToolbarState();
        });
    };

    const openEwidencja = (dateStr) => {
        const normalized = dateStr || '';
        if (normalized) {
            otworzModalGodzin(normalized);
            if (calendar && typeof calendar.unselect === 'function') {
                calendar.unselect();
            }
        }
    };

    const bindDayPanelEvents = () => {
        if (!kalendarzModal) return;
        kalendarzModal.addEventListener('click', (event) => {
            const actionEl = event.target.closest('[data-panel-action]');
            if (!actionEl || !kalendarzModal.contains(actionEl)) return;
            const action = actionEl.dataset.panelAction;
            if (!action) return;
            if (action === 'toggle-orders' || action === 'add') {
                if (kalendarzMultiWrapper) {
                    const shouldExpand = !kalendarzMultiWrapper.classList.contains('is-expanded');
                    kalendarzMultiWrapper.classList.toggle('is-expanded', shouldExpand);
                    if (shouldExpand && kalendarzMultiSelect) {
                        kalendarzMultiSelect.focus();
                    }
                }
                return;
            }
            if (action === 'edit') {
                const field = kalendarzForm?.querySelector?.('#godziny-pracy');
                field?.focus?.();
                field?.select?.();
            }
        });
    };

    window.addEventListener('calendar:summary-display-change', () => {
        renderDayPanel();
    });

    // --- KALENDARZ ---
    const getCalendarDom = () => {
        const container = document.getElementById('kalendarz');
        const shell = document.getElementById('calendar-shell') || container;
        return { container, shell };
    };

    const renderCalendarUnavailable = (message) => {
        const { container } = getCalendarDom();
        if (!container) return;
        let note = container.querySelector('.calendar-unavailable');
        if (!note) {
            note = document.createElement('div');
            note.className = 'calendar-unavailable';
            note.style.cssText = 'margin:12px;padding:12px;border-radius:10px;background:rgba(0,0,0,0.1);font-size:14px;';
            container.innerHTML = '';
            container.appendChild(note);
        }
        note.textContent = message;
    };

    async function inicjalizujKalendarz() {
        const { container: calendarContainer, shell: calendarShellEl } = getCalendarDom();
        if (!calendarContainer) {
            console.info('[calendar] pomijam init — brak kontenera');
            return;
        }
        const calendarTarget = calendarContainer;
        const storedViewType = 'dayGridMonth';
        const storedDateKey = readCalendarDateFromStorage() || todayKey;
        try {
            const result = await initCalendar(
                calendarTarget,
                workEvents,
                [],
                {
                    plugins: calendarPlugins,
                    timeZone: 'local',
                    firstDay: 1,
                    initialView: storedViewType,
                    initialDate: storedDateKey,
                    selectable: true,
                    selectMirror: true,
                    unselectAuto: true,
                    expandRows: true,
                    dayMaxEvents: true,
                    dayMaxEventRows: 3,
                    moreLinkText: (num) => `+${num}`,
                    eventDataTransform(event) {
                        if (event && typeof event.title === 'string') {
                            event.title = stripEwidencjaPrefix(event.title);
                        }
                        if (event?.extendedProps?.client && typeof event.extendedProps.client === 'string') {
                            event.extendedProps.client = stripEwidencjaPrefix(event.extendedProps.client);
                        }
                        return event;
                    },
                    eventClassNames(info) {
                        const eventType = info?.event?.extendedProps?.type;
                        return eventType === 'client'
                            ? ['fc-client-chip', 'client-chip', 'bober-chip', 'bober-chip--client']
                            : [];
                    },
                    dateClick: (info) => {
                        const targetDate = info?.dateStr;
                        if (targetDate) {
                            openDayPanel(targetDate);
                        }
                    },
                    select(info) {
                        const startDate = normalizeAllDayDate(info?.start);
                        const normalized = info?.startStr || (startDate ? formatDateForStorage(startDate) : '');
                        if (normalized) openDayPanel(normalized);
                        const api = getCalendarApi();
                        if (api && typeof api.unselect === 'function') {
                            api.unselect();
                        }
                    },
                    eventClick: (info) => {
                        const targetDate = info?.event?.extendedProps?.day
                            || (info?.event?.start ? formatDateForStorage(info.event.start) : null);
                        const orderId = info?.event?.extendedProps?.orderId || null;
                        if (targetDate) {
                            openDayPanel(targetDate, { focusOrderId: orderId });
                        }
                    },
                    moreLinkClick: (info) => {
                        const targetDate = info?.date ? formatDateForStorage(info.date) : info?.dateStr;
                        if (targetDate) {
                            openDayPanel(targetDate);
                        }
                        return 'none';
                    },
                    datesSet(viewInfo) {
                        if (viewInfo?.view?.currentStart && viewInfo?.view?.currentEnd) {
                            obliczSumeGodzinZKalendarza(viewInfo.view.currentStart, viewInfo.view.currentEnd);
                            rebuildCalendarDecorations(viewInfo.view.currentStart, viewInfo.view.currentEnd);
                        }
                        const viewKey = fcViewToCalendarKey(viewInfo?.view?.type);
                        persistCalendarView(viewInfo?.view?.type);
                        const focusDate = getCalendarApi()?.getDate?.();
                        const focusKey = focusDate ? formatDateForStorage(focusDate) : null;
                        if (focusKey) persistCalendarDate(focusKey);
                        updateCalendarToolbarState();
                        applyCalendarResponsiveOptions();
                        applyDayPanelState();
                        renderDayPanel();
                        if (selectedCalendarDayKey) {
                            setSelectedCalendarDay(selectedCalendarDayKey);
                        }
                    }
                }
            );
            if (!result?.ok || !result?.calendar) {
                console.info('[calendar] init failed', result?.message || 'unknown error');
                setCalendarApi(null);
                updateCalendarToolbarState();
                renderCalendarUnavailable('Kalendarz chwilowo niedostępny (odśwież / przejdź na inną zakładkę)');
                return;
            }
            setCalendarApi(result.calendar);
            console.info('[calendar] init ok');
        } catch (error) {
            console.error('[calendar] init failed', error);
            setCalendarApi(null);
            updateCalendarToolbarState();
            renderCalendarUnavailable('Kalendarz chwilowo niedostępny (odśwież / przejdź na inną zakładkę)');
            return;
        }
        updateCalendarToolbarState();
        if (calendarShellEl) {
            const applySize = () => handleCalendarResize();
            applySize();
            let ro = null;
            if (typeof window !== 'undefined' && 'ResizeObserver' in window) {
                ro = new window.ResizeObserver(() => applySize());
                ro.observe(calendarShellEl);
            } else {
                // Fallback dla starszych przeglądarek/środowisk: nasłuchuj resize
                const onResize = () => applySize();
                window.addEventListener('resize', onResize);
                // sprzątanie przy odmontowaniu komórki
                const observer = new MutationObserver((mutations) => {
                    for (const m of mutations) {
                        m.removedNodes && m.removedNodes.forEach((n) => {
                            if (n === calendarShellEl || (n.contains && n.contains(calendarShellEl))) {
                                window.removeEventListener('resize', onResize);
                                observer.disconnect();
                            }
                        });
                    }
                });
                observer.observe(calendarShellEl.parentNode || document.body, { childList: true });
            }
        }
        setTimeout(() => {
            const cal = window.__fcCalendar;
            if (cal && typeof cal.updateSize === 'function') {
                cal.updateSize();
            } else {
                console.warn('[calendar] updateSize skipped (calendar not ready)');
            }
            if (cal && typeof cal.updateDates === 'function') {
                cal.updateDates();
            }
            window.dispatchEvent(new Event('resize'));
        }, 0);
        window.addEventListener('resize', handleCalendarResize);
    }

    const initCalendarModule = async (source = 'bootstrap') => {
        const { container } = getCalendarDom();
        if (!container) {
            console.info('[calendar] brak kontenera — init odłożony');
            return;
        }
        if (moduleInitState.calendar.inFlight || moduleInitState.calendar.initialized) return;
        moduleInitState.calendar.inFlight = true;
        try {
            await inicjalizujKalendarz();
            moduleInitState.calendar.initialized = Boolean(getCalendarApi());
            if (!moduleInitState.calendar.initialized) {
                renderCalendarUnavailable('Kalendarz chwilowo niedostępny (odśwież / przejdź na inną zakładkę)');
            }
        } catch (error) {
            console.error(`[calendar] init failed (${source})`, error);
            renderCalendarUnavailable('Kalendarz chwilowo niedostępny (odśwież / przejdź na inną zakładkę)');
        } finally {
            moduleInitState.calendar.inFlight = false;
        }
    };

    async function otworzModalGodzin(data, options = {}) {
        if (!kalendarzForm || !kalendarzModal || !kalendarzModalTitle) return;
        const shouldOpenModal = options?.openModal !== false;
        const dayKey = isoDay(data, 'otworzModalGodzin');
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
        if (kalendarzMultiWrapper) {
            kalendarzMultiWrapper.classList.remove('is-expanded');
        }
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
                const leaveToSet = normalized.leaveKind || (normalized.flags?.urlop ? 'URL' : normalized.flags?.l4 ? 'L4' : normalized.flags?.swieto ? 'SWIETO' : normalized.flags?.wolne ? 'WOLNE' : normalized.flags?.szkolenie ? 'SZKOLENIE' : DAY_LEAVE_NONE);
                setDayLeaveValue(leaveToSet || DAY_LEAVE_NONE);
                if (dayKey) {
                    const orderIndex = buildOrderIndex();
                    const dayDocForTotals = buildDayDocForTotals({
                        ...normalizeDayRecord(dayKey, dane),
                        zleceniaPowiazane: normalizujPowiazaneZlecenia(dane).powiazane
                    });
                    dayDocsByDay.set(dayKey, dayDocForTotals);
                    manualByDay.set(dayKey, buildManualDayDoc(dayDocForTotals));
                    ordersByDay.set(dayKey, buildOrdersForDay(dayDocForTotals, orderIndex));
                    const leaveKindNormalized = normalizeDayLeaveValue(dayDocForTotals.leaveKind || '');
                    if (leaveKindNormalized && leaveKindNormalized !== DAY_LEAVE_NONE) {
                        leaveByDay.set(dayKey, leaveKindNormalized);
                    } else {
                        leaveByDay.delete(dayKey);
                    }
                }
            } else if (dayKey) {
                dayDocsByDay.delete(dayKey);
                manualByDay.delete(dayKey);
                ordersByDay.delete(dayKey);
                leaveByDay.delete(dayKey);
            }
        } catch (error) {
            console.error("Błąd podczas pobierania danych ewidencji:", error);
        }
        if (dayKey) {
            renderCalendarModalSummary(dayKey);
        }
        if (shouldOpenModal) {
            openModal(kalendarzModal);
        }
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
            swieto: selectedLeaveKind === 'SWIETO',
            wolne: selectedLeaveKind === 'WOLNE',
            szkolenie: selectedLeaveKind === 'SZKOLENIE'
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
            const dayKey = isoDay(data, 'obslugaZapisuGodzin');
            if (!dayKey) {
                console.error('[calendar] invalid save day key', { data });
                return;
            }
            const orderIndex = buildOrderIndex();
            const dayDocForTotals = buildDayDocForTotals({
                ...normalizeDayRecord(dayKey, dane),
                zleceniaPowiazane: normalizujPowiazaneZlecenia(dane).powiazane
            });
            dayDocsByDay.set(dayKey, dayDocForTotals);
            manualByDay.set(dayKey, buildManualDayDoc(dayDocForTotals));
            ordersByDay.set(dayKey, buildOrdersForDay(dayDocForTotals, orderIndex));
            const leaveKindNormalized = normalizeDayLeaveValue(selectedLeaveKind || '');
            if (leaveKindNormalized && leaveKindNormalized !== DAY_LEAVE_NONE) {
                leaveByDay.set(dayKey, leaveKindNormalized);
            } else {
                leaveByDay.delete(dayKey);
            }
            rebuildCalendarDecorations();
            updateUnfinishedSummary();

            await setDoc(doc(db, "godziny_pracy", data), dane);
            await syncLeaveEventForDay(data, selectedLeaveKind);
            await logActivityEvent({
                type: 'TIME_EDIT',
                refId: dayKey,
                label: `Ewidencja ${dayKey}: P ${dane.work}h, J ${dane.drive}h, F ${fakturowaneDoZapisu}h, N ${dane.nadgodziny}h`
            });
            const normalizedLeaveKind = normalizeDayLeaveValue(selectedLeaveKind || '');
            if (normalizedLeaveKind && normalizedLeaveKind !== DAY_LEAVE_NONE) {
                await logActivityEvent({
                    type: 'DAY_STATUS_SET',
                    refId: dayKey,
                    label: `Status dnia ${dayKey}: ${LEAVE_LABELS[normalizedLeaveKind] || normalizedLeaveKind}`
                });
            }
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

    function przerysujZdarzeniaKalendarza() {
        if (!calendar) return;
        updateCalendarData(calendar, workEvents, []);
        if (calendar.view) {
            obliczSumeGodzinZKalendarza(calendar.view.currentStart, calendar.view.currentEnd);
        }
    }

    const applyDayEntriesData = (entries = [], { render = true } = {}) => {
        wszystkieWpisyKalendarza = [];
        manualByDay = new Map();
        ordersByDay = new Map();
        dayDocsByDay = new Map();
        leaveByDay = new Map();
        window.__lastDayDocs = {};

        const orderIndex = buildOrderIndex();
        (entries || []).forEach(({ id, data }) => {
            const dane = data || {};
            const dayStr = normalizeDayKey(id, 'godziny_pracy.id');
            if (!dayStr) return;
            window.__lastDayDocs[dayStr] = dane;
            const normalizedDay = normalizeDayRecord(id, dane);
            const { powiazane, suma } = normalizujPowiazaneZlecenia(dane);
            const wpis = {
                ...normalizedDay,
                billed: suma,
                fakturowane: suma,
                nadgodziny: Number(dane?.nadgodziny ?? 0) || 0,
                zleceniaPowiazane: powiazane
            };
            wszystkieWpisyKalendarza.push(wpis);
            const dayDocForTotals = buildDayDocForTotals({ ...normalizedDay, zleceniaPowiazane: powiazane });
            dayDocsByDay.set(dayStr, dayDocForTotals);
            manualByDay.set(dayStr, buildManualDayDoc(dayDocForTotals));
            const ordersForDay = buildOrdersForDay(dayDocForTotals, orderIndex);
            ordersByDay.set(dayStr, ordersForDay);
            const leaveKind = normalizedDay.leaveKind || (normalizedDay.flags?.urlop ? 'URL' : normalizedDay.flags?.l4 ? 'L4' : normalizedDay.flags?.swieto ? 'SWIETO' : normalizedDay.flags?.wolne ? 'WOLNE' : normalizedDay.flags?.szkolenie ? 'SZKOLENIE' : null);
            if (leaveKind) {
                leaveByDay.set(dayStr, leaveKind);
            }
            computeDayTotals(dayStr);
        });

        if (render) {
            rebuildCalendarDecorations();
            updateUnfinishedSummary();
            selectedYearNeedsRefresh = true;
            odswiezPodsumowania();
        }
    };

    function wyswietlWpisyKalendarza() {
        if (_wszystkieZleceniaCache.length === 0 && (_wszystkieKlienciCache.length > 0 || _wszystkieMaszynyCache.length > 0)) {
            if (calendar) calendar.removeAllEvents();
            return;
        }
        onSnapshot(collection(db, "godziny_pracy"), (snapshotGodziny) => {
            const entries = snapshotGodziny.docs.map((docSnap) => ({
                id: docSnap.id,
                data: docSnap.data()
            }));
            applyDayEntriesData(entries);
        });
    }

    function nasluchujNaUrlopy() {
        // Źródłem prawdy dla statusu dnia jest dokument "godziny_pracy".
        // Zewnętrzne kolekcje (np. events) nie wpływają na dekoracje kalendarza.
    }

    function agregujPodsumowanieMiesiaca(start, end, wpisy) {
        const wpisyZMiesiaca = (wpisy || []).filter((wpis) => {
            const dataWpisu = new Date(wpis.id);
            return dataWpisu >= start && dataWpisu < end;
        });
        const sumyMies = wpisyZMiesiaca.reduce((acc, wpis) => {
            const wpisType = wpis?.extendedProps?.type || wpis?.extendedProps?.typ || wpis?.typ;
            if (wpis?.leaveKind) {
                return acc;
            }
            if (wpis?.flags?.urlop || wpis?.flags?.l4 || wpis?.flags?.swieto || wpis?.flags?.wolne || wpis?.flags?.szkolenie) {
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
        return {
            ...sumyMies,
            absorpcja: obliczAbsorpcja(sumyMies.wyfakturowaneGodziny)
        };
    }

    const getQuickActionsData = () => ({
        actions: QUICK_ACTIONS_CONFIG,
        hasCalendar: Boolean(kalendarzContainer),
        canAddClient: Boolean(clientDrawer && klientForm),
        canAddMachine: Boolean(machineDrawer && maszynaForm),
        canOpenWarehouse: Boolean(magazynTab),
        canOpenOrders: Boolean(zlecenieForm)
    });

    const buildQuickActionsModel = (data) => (data.actions || []).map((action) => {
        let disabled = false;
        if (action.action === 'open-entry-today' || action.action === 'open-calendar-today') {
            disabled = !data.hasCalendar;
        }
        if (action.action === 'open-add-client') {
            disabled = !data.canAddClient;
        }
        if (action.action === 'open-add-machine') {
            disabled = !data.canAddMachine;
        }
        if (action.action === 'open-warehouse') {
            disabled = !data.canOpenWarehouse;
        }
        if (action.action === 'open-add-order') {
            disabled = !data.canOpenOrders;
        }
        return { ...action, disabled };
    });

    const renderQuickActions = (model = []) => {
        if (!pulpitQuickActionsContainer) return;
        pulpitQuickActionsContainer.innerHTML = model.map(action => `
            <button type="button" class="quick-action-card" data-quick-action="${action.id}" ${action.disabled ? 'disabled' : ''}>
                <span class="quick-action-icon">${action.icon}</span>
                <span class="quick-action-label">
                    <span>${action.label}</span>
                    <span class="quick-action-note">${action.note || action.route}</span>
                </span>
            </button>
        `).join('') || '<p class="loading-state">Brak akcji do wyświetlenia.</p>';
    };

    function renderPulpitStatystykiMiesiaca(podsumowanie) {
        if (!kalendarzPodsumowanieDiv) return;
        const metricsHTML = `
  <div class="metric"><div class="label">Praca</div><div class="value num">${(podsumowanie.praca || 0).toFixed(1)} h</div></div>
  <div class="metric"><div class="label">Fakturowane</div><div class="value num">${(podsumowanie.wyfakturowaneGodziny || 0).toFixed(1)} h</div></div>
  <div class="metric"><div class="label">Nadgodziny</div><div class="value num">${(podsumowanie.nadgodziny || 0).toFixed(1)} h</div></div>
  <div class="metric"><div class="label">Jazda</div><div class="value num">${(podsumowanie.jazda || 0).toFixed(1)} h</div></div>
  <div class="metric"><div class="label">Absorpcja</div><div class="value num">${fmtPct(podsumowanie.absorpcja)}</div></div>
`;
        kalendarzPodsumowanieDiv.innerHTML = `<div class="metrics-grid">${metricsHTML}</div>`;
    }

    function renderPulpitWykresy() {
        const chartHost = document.getElementById('fh3m-pulpit');
        if (!chartHost) return;
        const { y, m } = ymFromMonthInput();
        renderFH3M(chartHost, y, m);
    }

    const getWeekPreviewData = () => {
        const today = normalizeAllDayDate(new Date());
        if (!today) return null;
        const day = today.getDay();
        const diffToMonday = day === 0 ? -6 : 1 - day;
        const weekStart = addDaysToDate(today, diffToMonday);
        const weekEnd = addDaysToDate(weekStart, 6);
        if (!weekStart || !weekEnd) return null;
        const days = listDaysInclusive(weekStart, weekEnd);
        const entries = (wszystkieWpisyKalendarza || []).filter((entry) => {
            const key = normalizeDayKey(entry?.id || entry?.date, 'weekPreview.entry');
            return key && days.includes(key);
        });
        return {
            days,
            entries,
            statuses: new Map(days.map(dayKey => [dayKey, resolveDayStatus(dayKey)]))
        };
    };

    const buildWeekPreviewModel = (data) => {
        if (!data) return null;
        const totals = data.entries.reduce((acc, entry) => {
            if (entry?.leaveKind || entry?.flags?.urlop || entry?.flags?.l4 || entry?.flags?.swieto || entry?.flags?.wolne || entry?.flags?.szkolenie) {
                return acc;
            }
            acc.praca += Number(entry.praca ?? entry.work ?? 0) || 0;
            acc.jazda += Number(entry.jazda ?? entry.drive ?? 0) || 0;
            acc.fakturowane += Number(entry.fakturowane ?? entry.billed ?? 0) || 0;
            acc.nadgodziny += Number(entry.nadgodziny ?? 0) || 0;
            return acc;
        }, { praca: 0, jazda: 0, fakturowane: 0, nadgodziny: 0 });
        const absorpcja = totals.praca > 0 ? (totals.fakturowane / totals.praca) * 100 : 0;

        const missingDaysList = data.days.filter((dayKey) => {
            const date = toDateSafe(dayKey);
            if (!date) return false;
            const dayOfWeek = date.getDay();
            if (dayOfWeek === 0 || dayOfWeek === 6) return false;
            const status = data.statuses.get(dayKey);
            if (status && DAY_OFF_STATUSES.includes(status)) return false;
            return !dayDocsByDay.has(dayKey);
        });

        const tiles = [
            { label: 'Praca', value: `${totals.praca.toFixed(1)} h` },
            { label: 'Jazda', value: `${totals.jazda.toFixed(1)} h` },
            { label: 'Fakturowane', value: `${totals.fakturowane.toFixed(1)} h` },
            { label: 'Nadgodziny', value: `${totals.nadgodziny.toFixed(1)} h` },
            { label: 'Absorpcja tygodnia', value: fmtPct(absorpcja) }
        ];

        return {
            totals,
            tiles,
            missingDaysCount: missingDaysList.length,
            missingDaysList
        };
    };

    const renderWeekPreview = (model) => {
        if (!pulpitWeeklyContainer) return;
        if (!model) {
            pulpitWeeklyContainer.innerHTML = '<p class="loading-state">Brak danych tygodniowych.</p>';
            weeklyMissingDays = [];
            return;
        }
        weeklyMissingDays = model.missingDaysList;
        const tilesHtml = model.tiles.map(tile => `
            <div class="metric">
                <div class="label">${tile.label}</div>
                <div class="value num">${tile.value}</div>
            </div>
        `).join('');
        pulpitWeeklyContainer.innerHTML = `
            <div class="metrics-grid">
                ${tilesHtml}
            </div>
            <button type="button" class="weekly-missing" data-weekly-missing>
                Braki: ${model.missingDaysCount} dni
            </button>
        `;
    };

    const getActivityData = () => ({
        entries: Array.isArray(recentActivity) ? recentActivity : []
    });

    const buildActivityModel = (data) => {
        const icons = {
            ORDER_CREATED: '🧾',
            ORDER_CLOSED: '✅',
            TIME_EDIT: '⏱️',
            DAY_STATUS_SET: '📌',
            STOCK_CHANGE: '📦',
            CLIENT_EDIT: '👤',
            MACHINE_EDIT: '🚜'
        };
        return (data.entries || []).map(entry => ({
            id: entry.id,
            refId: entry.refId,
            type: entry.type,
            label: entry.label || '—',
            time: formatDateTimeLabel(entry.timestamp),
            icon: icons[entry.type] || '•'
        }));
    };

    const renderActivity = (model = []) => {
        if (!pulpitActivityList) return;
        if (activityStatus === 'loading') {
            pulpitActivityList.innerHTML = '<li class="loading-state">Ładowanie aktywności...</li>';
            return;
        }
        if (activityStatus === 'error') {
            pulpitActivityList.innerHTML = '<li class="loading-state">Nie udało się załadować aktywności.</li>';
            return;
        }
        if (!model.length) {
            pulpitActivityList.innerHTML = '<li class="loading-state">Brak ostatnich działań.</li>';
            return;
        }
        pulpitActivityList.innerHTML = model.map(item => `
            <li class="activity-item" data-activity-id="${item.id}" data-activity-type="${item.type}" data-activity-ref="${item.refId || ''}">
                <span class="activity-icon">${item.icon}</span>
                <span class="activity-text">
                    <span>${item.label}</span>
                    <span class="activity-time">${item.time}</span>
                </span>
            </li>
        `).join('');
    };

    function obliczSumeGodzinZKalendarza(start, end) {
        const podsumowanie = agregujPodsumowanieMiesiaca(start, end, wszystkieWpisyKalendarza);
        renderPulpitStatystykiMiesiaca(podsumowanie);
        renderPulpitWykresy();
    }

    const waitForCalendarReady = async (attempts = 8, delayMs = 200) => {
        for (let i = 0; i < attempts; i += 1) {
            if (getCalendarApi()) return true;
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        return Boolean(getCalendarApi());
    };

    const runQuickAction = async (actionId) => {
        const todayKey = formatDateForStorage(new Date());
        if (!actionId) return;
        switch (actionId) {
            case 'add-order':
                showTab('dodaj-zlecenie');
                break;
            case 'add-entry-today':
                showTab('kalendarz-tab');
                if (!getCalendarApi()) {
                    await initCalendarModule('quick-action');
                    await waitForCalendarReady();
                }
                setCalendarView('day', todayKey);
                openEwidencja(todayKey);
                break;
            case 'calendar-today':
                showTab('kalendarz-tab');
                if (!getCalendarApi()) {
                    await initCalendarModule('quick-action');
                    await waitForCalendarReady();
                }
                setCalendarView('day', todayKey);
                break;
            case 'add-client':
                showTab('klienci');
                openClientDrawer(null, 'add');
                break;
            case 'add-machine':
                showTab('maszyny');
                maszynaForm?.reset();
                addMachineClientCombobox?.clear();
                setMachineDrawerMode('add');
                break;
            case 'warehouse':
                showTab('magazyn');
                magazynSearchInput?.focus();
                break;
            default:
                break;
        }
    };

    const handleQuickActionClick = (event) => {
        const button = event.target.closest('[data-quick-action]');
        if (!button) return;
        const actionId = button.dataset.quickAction;
        if (button.disabled) return;
        void runQuickAction(actionId);
    };

    const openWeeklyMissingDrawer = () => {
        setUnfinishedDrawerView('week-missing', weeklyMissingDays);
        setUnfinishedDrawerOpen(true);
    };

    const handleWeeklyMissingClick = (event) => {
        const trigger = event.target.closest('[data-weekly-missing]');
        if (!trigger) return;
        openWeeklyMissingDrawer();
    };

    const handleActivityClick = (event) => {
        const item = event.target.closest('[data-activity-id]');
        if (!item) return;
        const type = item.dataset.activityType;
        const refId = item.dataset.activityRef;
        if (!type || !refId) return;
        if (type === 'ORDER_CREATED' || type === 'ORDER_CLOSED') {
            showTab('zlecenia');
            handleDetailsButtonClick(refId);
            return;
        }
        if (type === 'TIME_EDIT' || type === 'DAY_STATUS_SET') {
            showTab('kalendarz-tab');
            if (!getCalendarApi()) {
                void initCalendarModule('activity');
            }
            focusCalendarDay(refId);
            return;
        }
        if (type === 'STOCK_CHANGE') {
            showTab('magazyn');
            const produkt = getProductById(refId);
            if (produkt) openProductDetailsModal(produkt, 'add');
            return;
        }
        if (type === 'CLIENT_EDIT') {
            showTab('klienci');
            openClientDrawer(refId, 'view');
            return;
        }
        if (type === 'MACHINE_EDIT') {
            showTab('maszyny');
            otworzModalEdycjiMaszyny(refId);
        }
    };

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

    function buildDayDocForTotals(dayDoc = {}) {
        const normalizedKind = normalizeDayLeaveValue(dayDoc?.leaveKind || dayDoc?.dayLeave || '');
        const leaveKind = normalizedKind && normalizedKind !== DAY_LEAVE_NONE ? normalizedKind : null;
        const powiazane = Array.isArray(dayDoc?.powiazane)
            ? dayDoc.powiazane
            : Array.isArray(dayDoc?.zleceniaPowiazane)
                ? dayDoc.zleceniaPowiazane
                : [];
        const flags = normalizeDayFlags(dayDoc?.flags || {}, leaveKind);
        return {
            ...dayDoc,
            leaveKind,
            flags,
            powiazane,
            zleceniaPowiazane: powiazane
        };
    }


    const normalizeDayFlags = (flags = {}, leaveKind = null) => {
        const normalizedKind = normalizeDayLeaveValue(leaveKind || '');
        return {
            urlop: Boolean(flags.urlop) || normalizedKind === 'URL',
            l4: Boolean(flags.l4) || normalizedKind === 'L4',
            swieto: Boolean(flags.swieto) || normalizedKind === 'SWIETO',
            wolne: Boolean(flags.wolne) || normalizedKind === 'WOLNE',
            szkolenie: Boolean(flags.szkolenie) || normalizedKind === 'SZKOLENIE'
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

    const monthYearFormatter = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' });

    function formatujMiesiac(miesiac) {
        if (!miesiac) return '';
        try {
            const data = new Date(`${miesiac}-01T00:00:00`);
            return monthYearFormatter.format(data).toLowerCase();
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
            .filter(z => z?.status === 'ukończone' && resolveServiceDate(z)?.startsWith(miesiac))
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

    const ensureOpenSummaryYears = (years = []) => {
        const available = new Set((years || []).map(Number).filter(Number.isFinite));
        const stored = readOpenYearsFromStorage().filter(year => available.has(year));
        const next = stored.length ? stored : [currentYear].filter(year => available.has(year));
        if (!next.length && years.length) next.push(Number(years[0]));
        openSummaryYears = new Set(next);
        persistOpenYears([...openSummaryYears]);
        return openSummaryYears;
    };

    const formatHours = (value) => `${(Number(value) || 0).toFixed(2)} h`;

    const buildExportMenuMarkup = (year) => `
        <div class="export-menu">
          <button type="button" class="export-trigger" data-export-year="${year}" aria-haspopup="true" aria-expanded="false">
            <span class="icon">⬇</span> Eksport
          </button>
          <div class="export-menu-panel" role="menu">
            <button type="button" class="export-menu-item" data-export-action="summary-csv">CSV – Podsumowanie roczne</button>
            <button type="button" class="export-menu-item" data-export-action="orders-csv">CSV – Zlecenia (rok)</button>
            <button type="button" class="export-menu-item" data-export-action="pdf">PDF – Raport roczny</button>
          </div>
        </div>
    `;

    function renderRocznePodsumowanie() {
        if (!annualSummaryContainer) return;
        const years = (ostatnieZestawienieMiesieczne.years || []).sort((a, b) => a.year - b.year);
        if (!years.length) {
            annualSummaryContainer.innerHTML = '<p>Brak danych do wyświetlenia.</p>';
            return;
        }

        const openYears = ensureOpenSummaryYears(years.map(y => y.year));
        annualSummaryContainer.innerHTML = years.map(y => `
  <div class="year-section ${openYears.has(y.year) ? 'is-open' : ''}" data-year="${y.year}">
    <div class="year-header">
      <button type="button" class="year-toggle" data-year="${y.year}" aria-expanded="${openYears.has(y.year)}" aria-controls="year-content-${y.year}">
        <span class="chevron">${openYears.has(y.year) ? '▼' : '▶'}</span>
        <span class="year-meta">
          <span class="year-title">Rok ${y.year}</span>
          <span class="year-quick-sums">
            <span>Praca: ${formatHours(y.sum.work)}</span>
            <span>Jazda: ${formatHours(y.sum.drive)}</span>
            <span>Wyfakturowane: ${formatHours(y.sum.billed)}</span>
            <span>Absorpcja: ${Math.round(y.sum.absorpcja ?? (y.sum.billed/(168*12)*100))}%</span>
            <span>L4: ${y.sum.l4Days} dni</span>
            <span>Urlop: ${y.sum.urlopDays} dni</span>
          </span>
        </span>
      </button>
      ${buildExportMenuMarkup(y.year)}
    </div>
    <div class="year-content" id="year-content-${y.year}">
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
  </div>
`).join('');
        if (annualSummaryExportBtn) {
            const latestYear = Math.max(...years.map(y => Number(y.year)).filter(Number.isFinite));
            annualSummaryExportBtn.dataset.exportYear = Number.isFinite(latestYear) ? String(latestYear) : '';
        }
    }

    const calcVacationRemaining = (allowance, usedFromCalendar, adjustmentsSum) => {
        return (Number(allowance) || 0) - (Number(usedFromCalendar) || 0) + (Number(adjustmentsSum) || 0);
    };

    function updateYearSelectOptions(selectEl, years, selectedValue) {
        if (!selectEl) return;
        const uniqueYears = getYearsSortedDesc(years);
        selectEl.innerHTML = uniqueYears.map(y => `<option value="${y}">${y}</option>`).join('');
        if (!uniqueYears.length) return;
        const resolved = uniqueYears.includes(Number(selectedValue)) ? Number(selectedValue) : uniqueYears[0];
        selectEl.value = String(resolved);
    }

    function getSelectedYearTotals() {
        return selectedYearTotals;
    }

    function renderL4Summary() {
        if (!l4SummaryContainer) return;
        const yearData = selectedYearSummary;
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

    const getUsedLeaveDays = (entries = [], year) => {
        const days = new Set();
        (entries || []).forEach(entry => {
            const normalized = normalizeDayRecord(entry.id || entry.date, entry);
            const isLeave = normalized.flags?.urlop || normalized.leaveKind === 'URL';
            if (!isLeave) return;
            const key = normalizeDayKey(normalized.date || normalized.id, 'vacation.used');
            if (!key) return;
            if (Number(key.slice(0, 4)) !== Number(year)) return;
            days.add(key);
        });
        return [...days].sort();
    };

    const groupDatesByMonth = (dates = []) => {
        const groups = new Map();
        (dates || []).forEach(dateStr => {
            const monthKey = dateStr.slice(0, 7);
            if (!groups.has(monthKey)) groups.set(monthKey, []);
            groups.get(monthKey).push(dateStr);
        });
        return groups;
    };

    const formatDateLabel = (value, fallback = '—') => {
        const date = toDateSafe(value);
        if (!date) return fallback;
        return date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    const countDaysInRange = (startDate, endDate, workingOnly = false) => {
        const days = listDaysInclusive(startDate, endDate);
        if (!workingOnly) return days.length;
        return days.filter(day => !isWeekendDay(day)).length;
    };

    const renderUsedLeaveList = () => {
        if (!vacationUsedList) return;
        const usedDays = getUsedLeaveDays(selectedYearEntries, selectedYear);
        if (!usedDays.length) {
            vacationUsedList.innerHTML = '<p>Brak wykorzystanych dni urlopu w wybranym roku.</p>';
            return;
        }
        const grouped = groupDatesByMonth(usedDays);
        const blocks = [];
        grouped.forEach((dates, monthKey) => {
            const label = formatujMiesiac(monthKey);
            const items = dates.map(day => `<li>${formatDateLabel(day)}</li>`).join('');
            blocks.push(`
                <div class="month-group">
                    <h5>${label}</h5>
                    <ul>${items}</ul>
                </div>
            `);
        });
        vacationUsedList.innerHTML = blocks.join('');
    };

    const setActiveVacationTab = (tabId = 'used') => {
        if (!vacationTabs) return;
        const target = tabId || 'used';
        vacationTabs.querySelectorAll('[data-vacation-tab]').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.vacationTab === target);
        });
        document.querySelectorAll('[data-vacation-panel]').forEach(panel => {
            panel.classList.toggle('is-active', panel.dataset.vacationPanel === target);
        });
        persistVacationTab(target);
    };

    const getPlannedLeaveCollection = () => collection(db, 'plannedLeave');

    const normalizePlannedLeaveEntry = (docSnap) => {
        const data = docSnap.data() || {};
        const startDate = normalizeDayKey(data.startDate || data.start || data.from || data.startAt || data.start_date, 'plannedLeave.start');
        const endDate = normalizeDayKey(data.endDate || data.end || data.to || data.endAt || data.end_date, 'plannedLeave.end');
        const resolvedYear = Number(data.year) || getYearFromValue(startDate) || selectedYear;
        return {
            id: docSnap.id,
            year: resolvedYear,
            startDate: startDate || '',
            endDate: endDate || startDate || '',
            note: data.note || '',
            type: data.type || 'Urlop planowany',
            countWorkingDays: Boolean(data.countWorkingDays),
            createdAt: data.createdAt || null
        };
    };

    async function listPlannedLeave(year) {
        const snap = await getDocs(query(getPlannedLeaveCollection(), where('year', '==', Number(year))));
        return snap.docs.map(normalizePlannedLeaveEntry)
            .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
    }

    const setPlannedLeaveFormState = (entry = null) => {
        const isEditing = Boolean(entry);
        plannedLeaveEditId = entry ? entry.id : null;
        if (plannedLeaveSubmitBtn) plannedLeaveSubmitBtn.textContent = isEditing ? 'Zapisz plan' : 'Dodaj plan';
        if (plannedLeaveCancelBtn) plannedLeaveCancelBtn.style.display = isEditing ? 'inline-flex' : 'none';
        if (!plannedLeaveForm) return;
        if (!entry) return;
        if (plannedLeaveStartInput) plannedLeaveStartInput.value = entry.startDate || '';
        if (plannedLeaveEndInput) plannedLeaveEndInput.value = entry.endDate || '';
        if (plannedLeaveTypeSelect) plannedLeaveTypeSelect.value = entry.type || 'Urlop planowany';
        if (plannedLeaveNoteInput) plannedLeaveNoteInput.value = entry.note || '';
        if (plannedLeaveWorkingDaysInput) plannedLeaveWorkingDaysInput.checked = Boolean(entry.countWorkingDays);
    };

    const clearPlannedLeaveForm = () => {
        if (plannedLeaveForm) plannedLeaveForm.reset();
        setPlannedLeaveFormState(null);
    };

    const refreshPlannedLeaveDecorations = () => {
        plannedLeaveByDay = new Map();
        plannedLeaveEntries.forEach(entry => {
            const days = listDaysInclusive(entry.startDate, entry.endDate);
            days.forEach(day => plannedLeaveByDay.set(day, entry.type || 'PLAN'));
        });
        setDecorations({ summaryByDay: lastSummaryByDay, leaveByDay: lastLeaveByDay, plannedLeaveByDay: Object.fromEntries(plannedLeaveByDay) });
    };

    const renderPlannedLeaveList = () => {
        if (!plannedLeaveList || !plannedLeaveTotalSpan) return;
        if (!plannedLeaveEntries.length) {
            plannedLeaveList.innerHTML = '<p>Brak zaplanowanych urlopów w wybranym roku.</p>';
            plannedLeaveTotalSpan.textContent = '0';
            refreshPlannedLeaveDecorations();
            return;
        }
        const totalDays = plannedLeaveEntries.reduce((acc, entry) => acc + countDaysInRange(entry.startDate, entry.endDate, entry.countWorkingDays), 0);
        plannedLeaveTotalSpan.textContent = formatujLiczbe(totalDays);
        plannedLeaveList.innerHTML = plannedLeaveEntries.map(entry => {
            const rangeLabel = `${entry.startDate || '—'} → ${entry.endDate || '—'}`;
            const count = countDaysInRange(entry.startDate, entry.endDate, entry.countWorkingDays);
            const metaBits = [
                `${formatujLiczbe(count)} dni`,
                entry.countWorkingDays ? 'dni robocze' : 'wszystkie dni'
            ];
            if (entry.note) metaBits.push(entry.note);
            return `
                <div class="planned-leave-item" data-id="${entry.id}">
                    <div><strong>${rangeLabel}</strong></div>
                    <div class="meta">${metaBits.map(bit => `<span>${bit}</span>`).join('')}</div>
                    <div class="actions">
                        <button type="button" class="btn-secondary" data-action="edit" data-id="${entry.id}">Edytuj</button>
                        <button type="button" class="btn-remove" data-action="delete" data-id="${entry.id}">Usuń</button>
                    </div>
                </div>
            `;
        }).join('');
        refreshPlannedLeaveDecorations();
    };

    async function refreshPlannedLeaveEntries() {
        plannedLeaveEntries = await listPlannedLeave(selectedYear);
        renderPlannedLeaveList();
        updateUnfinishedSummary();
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

    async function fetchSelectedYearEntries(year) {
        const { startKey, endKey } = getYearRange(year);
        const q = query(
            collection(db, "godziny_pracy"),
            orderBy("__name__"),
            startAt(startKey),
            endBefore(endKey)
        );
        const snapshot = await getDocs(q);
        const entries = [];
        snapshot.forEach((docSnap) => {
            const dane = docSnap.data();
            const normalizedDay = normalizeDayRecord(docSnap.id, dane);
            const { powiazane, suma } = normalizujPowiazaneZlecenia(dane);
            entries.push({
                ...normalizedDay,
                billed: suma,
                fakturowane: suma,
                nadgodziny: Number(dane?.nadgodziny ?? 0) || 0,
                zleceniaPowiazane: powiazane
            });
        });
        if (year === 2026) {
            console.info('[summary] selectedYear=2026 range', `${startKey}..${endKey}`, 'records', entries.length);
        }
        return entries;
    }

    async function ensureSelectedYearData() {
        if (!selectedYearNeedsRefresh && selectedYearLoadedFor === selectedYear) {
            return;
        }
        selectedYearNeedsRefresh = false;
        selectedYearLoadedFor = selectedYear;
        selectedYearEntries = await fetchSelectedYearEntries(selectedYear);
        const summary = obliczPodsumowaniaMiesieczne(selectedYearEntries);
        selectedYearSummary = (summary.years || []).find(y => Number(y.year) === Number(selectedYear)) || null;
        selectedYearTotals = (summary.sumyRocznePerRok || []).find(r => Number(r.rok) === Number(selectedYear)) || null;
    }

    async function renderVacationSummary() {
        if (!vacationAllowanceInput || !vacationUsedSpan || !vacationRemainingSpan || !vacationAdjustmentsDiv) return;
        const allowance = await getVacationAllowance(selectedYear);
        vacationAllowanceInput.value = allowance;

        const adjustments = await listVacationAdjustments(selectedYear);
        const adjustmentsSum = adjustments.reduce((acc, adj) => acc + (Number(adj.days) || 0), 0);
        const yearTotals = getSelectedYearTotals();
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

        renderUsedLeaveList();
        await refreshPlannedLeaveEntries();
    }

    async function renderPodsumowanie() {
        await ensureSelectedYearData();
        renderRocznePodsumowanie();
        renderL4Summary();
        await renderVacationSummary();
    }

    async function applySelectedYear(nextYear) {
        const parsed = Number(nextYear);
        selectedYear = Number.isFinite(parsed) ? parsed : currentYear;
        persistSelectedYear(selectedYear);
        selectedYearNeedsRefresh = true;
        updateYearSelectOptions(summaryYearSelect, availableSummaryYears, selectedYear);
        updateYearSelectOptions(vacationYearSelect, availableSummaryYears, selectedYear);
        await renderPodsumowanie();
    }

    function renderPulpit() {
        const quickActionsData = getQuickActionsData();
        const quickActionsModel = buildQuickActionsModel(quickActionsData);
        renderQuickActions(quickActionsModel);

        const weeklyData = getWeekPreviewData();
        const weeklyModel = buildWeekPreviewModel(weeklyData);
        renderWeekPreview(weeklyModel);

        const activityData = getActivityData();
        const activityModel = buildActivityModel(activityData);
        renderActivity(activityModel);

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
        const yearsFromData = getAvailableYears(wszystkieWpisyKalendarza);
        availableSummaryYears = getYearsSortedDesc([...yearsFromData, currentYear]);
        if (!availableSummaryYears.includes(selectedYear)) {
            selectedYear = currentYear;
            persistSelectedYear(selectedYear);
            selectedYearNeedsRefresh = true;
        }
        updateYearSelectOptions(summaryYearSelect, availableSummaryYears, selectedYear);
        updateYearSelectOptions(vacationYearSelect, availableSummaryYears, selectedYear);
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

    const setSummaryExportState = (isLoading) => {
        document.querySelectorAll('.export-menu-item').forEach((btn) => {
            btn.disabled = isLoading;
        });
    };

    const resolveExportYear = (year) => (Number.isFinite(year) ? year : currentYear);

    const runYearExport = async (type, year) => {
        if (isExportingYearReport) return;
        isExportingYearReport = true;
        setSummaryExportState(true);
        try {
            // Zasada na przyszłość: DATA → AGREGACJA → RENDER, bez skrótów.
            const resolvedYear = resolveExportYear(year);
            const reportData = await loadYearReportingData({
                db,
                year: resolvedYear,
                orderIndex: buildOrderIndex(),
                resolveClientName: resolveOrderClientName
            });
            const report = computeYearReport(reportData);
            if (type === 'summary-csv') exportYearlySummaryCsv(report);
            if (type === 'orders-csv') exportYearlyOrdersCsv(report);
            if (type === 'pdf') exportYearlyPdf(report);
        } catch (error) {
            console.error('[reporting] export failed', error);
            alert('Nie udało się wygenerować raportu. Spróbuj ponownie.');
        } finally {
            setSummaryExportState(false);
            isExportingYearReport = false;
        }
    };

    function inicjujMotywJohnDeere() {
        const savedTheme = localStorage.getItem('theme') || 'jd-dark';
        applyTheme(savedTheme);
        if (themeSelect) {
            themeSelect.value = savedTheme;
            themeSelect.addEventListener('change', () => {
                const newTheme = themeSelect.value || 'jd-dark';
                applyTheme(newTheme);
                localStorage.setItem('theme', newTheme);
            });
        } else {
            console.error("Nie znaleziono przełącznika motywu (themeSelect)");
        }
    }
    function applyTheme(theme) {
        const resolved = theme === 'jd-contrast' ? 'jd-contrast' : 'jd-dark';
        document.body.dataset.theme = resolved;
    }

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
        try {
            await addDoc(collection(db, "klienci"), dane);
            klientForm.reset();
            closeClientDrawer();
        }
        catch (e) { console.error("Błąd dodawania klienta: ", e); }
    }

    function odswiezSelectKlientaDoZlecenia() {
        if (!zlecenieKlientIdInput) return;
        const poprzedniWybor = zlecenieKlientIdInput.value;
        const klienci = getMachineClientOptions();
        const wybranyKlient = poprzedniWybor
            ? (poprzedniWybor === ORDER_QUICK_OPTION.id
                ? ORDER_QUICK_OPTION
                : klienci.find(klient => klient.id === poprzedniWybor))
            : null;

        if (wybranyKlient) {
            orderClientCombobox?.setSelection(wybranyKlient);
        } else if (poprzedniWybor) {
            orderClientCombobox?.clear();
        } else {
            orderClientCombobox?.refresh();
        }
    }

function wyswietlKlientow() {
  try {
    // Poczekaj na maszyny – bez nich nie budujemy list pod klientami
    if (_wszystkieMaszynyCache.length === 0 && _wszystkieKlienciCache.length > 0) {
      console.log("Czekam na maszyny przed renderowaniem klientów...");
      if (listaKlientowDiv) listaKlientowDiv.innerHTML = "<p>Ładowanie danych maszyn...</p>";
      return;
    }

    // DATA → AGREGACJA → RENDER
    const frazaWyszukiwania = (klientSearchInput?.value || "").toLowerCase();
    const wszyscyKlienci = _wszystkieKlienciCache || [];
    const wszystkieMaszynyLocal = _wszystkieMaszynyCache || [];
    wszystkieKlienci = [];

    // AGREGACJA
    const maszynyPoKliencie = new Map();
    wszystkieMaszynyLocal.forEach(maszyna => {
      if (!maszyna?.klientId) return;
      if (!maszynyPoKliencie.has(maszyna.klientId)) {
        maszynyPoKliencie.set(maszyna.klientId, []);
      }
      maszynyPoKliencie.get(maszyna.klientId).push(maszyna);
    });

    const przefiltrowaniKlienci = wszyscyKlienci.filter(klient => {
      if (!frazaWyszukiwania) return true;
      const tekst = [
        klient.nazwa || "",
        klient.nip || "",
        klient.adres || "",
        klient.telefon || ""
      ].join(" ").toLowerCase();
      return tekst.includes(frazaWyszukiwania);
    });

    const clientsView = przefiltrowaniKlienci.map(klient => {
      const maszynyKlienta = maszynyPoKliencie.get(klient.id) || [];
      return {
        klient,
        maszyny: maszynyKlienta,
        liczbaMaszyn: maszynyKlienta.length
      };
    });

    const expandedSet = new Set();

    const clientsForSelect = [...wszyscyKlienci].sort((a, b) => (a.nazwa || '').localeCompare(b.nazwa || ''));
    let selectHtml = '<option value="">-- Wybierz klienta --</option>';
    clientsForSelect.forEach(klient => {
      selectHtml += `<option value="${klient.id}">${klient.nazwa || '(bez nazwy)'}</option>`;
    });

    // RENDER
    const klienciHtml = clientsView.map(({ klient, maszyny, liczbaMaszyn }) => {
      wszystkieKlienci.push(klient);
      const nipTxt = klient.nip && klient.nip !== '---' ? `NIP: ${klient.nip}` : 'NIP: —';
      const adresTxt = klient.adres && klient.adres !== '---' ? klient.adres : 'Brak adresu';
      const telTxt = klient.telefon && klient.telefon !== '---' ? klient.telefon : 'Brak telefonu';
      const maszynyLinks = maszyny.length
        ? maszyny.map(m => {
          const sn = (m.nrSeryjny && m.nrSeryjny !== '---') ? m.nrSeryjny : '—';
          const naz = `${m.typMaszyny || ''} ${m.model || ''}`.trim();
          return `<button type="button" class="client-machine-link" data-maszyna-id="${m.id}" data-client-id="${klient.id}">${naz || 'Maszyna'} • S/N: ${sn}</button>`;
        }).join('')
        : '<span class="client-meta">Brak maszyn</span>';
      const isOpen = expandedSet.has(klient.id);
      return `
        <div class="client-accordion ${isOpen ? 'is-open' : ''}" data-client-id="${klient.id}">
          <div class="client-row">
            <button type="button" class="client-main" data-client-id="${klient.id}">
              <div class="client-title">
                <strong>${klient.nazwa || '---'}</strong>
                <span class="client-meta">${nipTxt}</span>
              </div>
            </button>
            <div class="client-actions">
              <span class="accordion-badge">${liczbaMaszyn} maszyn</span>
              <div class="row-action">
                <button type="button" class="row-action-btn" data-client-action="menu" aria-label="Akcje">⋯</button>
                <div class="row-action-menu" role="menu">
                  <button type="button" data-client-action="edit" data-client-id="${klient.id}">Edytuj</button>
                </div>
              </div>
              <button type="button" class="accordion-toggle" data-client-id="${klient.id}" aria-expanded="${String(isOpen)}">▼</button>
            </div>
          </div>
          <div class="client-body">
            <div class="client-contact">${adresTxt}</div>
            <div class="client-contact">${telTxt}</div>
            <div class="client-machines">${maszynyLinks}</div>
          </div>
        </div>
      `;
    }).join('');

    if (listaKlientowDiv) {
      listaKlientowDiv.innerHTML = klienciHtml || "<p>Brak klientów w bazie lub pasujących do wyszukiwania.</p>";
    }
    addMachineClientCombobox?.refresh();
    editMachineClientCombobox?.refresh();
    odswiezSelectKlientaDoZlecenia();

    const assignKlientSelect = document.getElementById('assign-klient-select');
    if (assignKlientSelect) assignKlientSelect.innerHTML = selectHtml;

    if (maszynaClientFilterSelect) {
      const currentValue = maszynaClientFilterSelect.value;
      const options = [''].concat(clientsForSelect.map(klient => klient.id));
      maszynaClientFilterSelect.innerHTML = options.map((id) => {
        if (!id) return '<option value="">Wszyscy</option>';
        const klient = clientsForSelect.find(item => item.id === id);
        return `<option value="${id}">${klient?.nazwa || '(bez nazwy)'}</option>`;
      }).join('');
      if (options.includes(currentValue)) {
        maszynaClientFilterSelect.value = currentValue;
      }
    }

  } catch (err) {
    console.error("wyswietlKlientow() — błąd:", err);
    if (listaKlientowDiv) {
      listaKlientowDiv.innerHTML = `<p style="color:#e74c3c">Błąd renderowania listy klientów: ${String(err)}</p>`;
    }
  }
}

const applyClientsData = (clients = [], { render = true } = {}) => {
  _wszystkieKlienciCache = Array.isArray(clients) ? clients : [];
  if (render) {
    wyswietlMaszyny();
    wyswietlKlientow();
  }
};

function nasluchujNaKlientow() {
  onSnapshot(
    query(collection(db, "klienci"), orderBy("nazwa")),
    (snapshot) => {
      const clients = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      // Po załadowaniu klientów przerysuj listy, które ich potrzebują:
      applyClientsData(clients);
    }
  );
}

let clientDrawerOpen = false;
let selectedClientId = null;
let clientDrawerMode = 'view';

const renderClientView = (klient) => {
    if (!clientViewPanel) return;
    const name = klient?.nazwa || '—';
    const nip = klient?.nip && klient.nip !== '---' ? klient.nip : '—';
    const address = klient?.adres && klient.adres !== '---' ? klient.adres : '—';
    const phone = klient?.telefon && klient.telefon !== '---' ? klient.telefon : '—';
    if (clientViewName) clientViewName.textContent = name;
    if (clientViewNip) clientViewNip.textContent = nip;
    if (clientViewAddress) clientViewAddress.textContent = address;
    if (clientViewPhone) clientViewPhone.textContent = phone;
};

const fillClientEditForm = (klient) => {
    if (!editKlientForm || !klient) return;
    editKlientForm['edit-klient-id'].value = klient.id;
    editKlientForm['edit-klient-nazwa'].value = klient.nazwa;
    editKlientForm['edit-klient-nip'].value = klient.nip === '---' ? '' : klient.nip;
    editKlientForm['edit-klient-adres'].value = klient.adres === '---' ? '' : klient.adres;
    editKlientForm['edit-klient-telefon'].value = klient.telefon === '---' ? '' : klient.telefon;
};

const setClientDrawerMode = (mode) => {
    if (!clientDrawer) return;
    clientDrawerMode = mode;
    const isAdd = mode === 'add';
    const isEdit = mode === 'edit';
    const isView = mode === 'view';
    if (clientDrawerTitle) {
        clientDrawerTitle.textContent = isAdd
            ? 'Dodaj klienta'
            : (isEdit ? 'Edytuj klienta' : 'Szczegóły klienta');
    }
    if (klientForm) klientForm.classList.toggle('is-hidden', !isAdd);
    if (editKlientForm) editKlientForm.classList.toggle('is-hidden', !isEdit);
    if (clientViewPanel) clientViewPanel.classList.toggle('is-hidden', !isView);
    if (isView) {
        const klient = _wszystkieKlienciCache.find(k => k.id === selectedClientId);
        renderClientView(klient);
    }
};

const openClientDrawer = (clientId = null, mode = 'view') => {
    if (!clientDrawer) return;
    selectedClientId = clientId;
    if (mode === 'add') {
        selectedClientId = null;
        klientForm?.reset();
    }
    if (mode === 'edit') {
        const klient = _wszystkieKlienciCache.find(k => k.id === selectedClientId);
        fillClientEditForm(klient);
    }
    if (mode === 'view') {
        const klient = _wszystkieKlienciCache.find(k => k.id === selectedClientId);
        renderClientView(klient);
    }
    setClientDrawerMode(mode);
    clientDrawerOpen = true;
    openDrawer(clientDrawer);
};

const closeClientDrawer = () => {
    if (!clientDrawer) return;
    clientDrawerOpen = false;
    selectedClientId = null;
    clientDrawerMode = 'view';
    closeDrawer(clientDrawer);
};

const setMachineDrawerMode = (mode) => {
    if (!machineDrawer) return;
    const isEdit = mode === 'edit';
    if (machineDrawerTitle) {
        machineDrawerTitle.textContent = isEdit ? 'Edytuj maszynę' : 'Dodaj maszynę';
    }
    if (maszynaForm) maszynaForm.classList.toggle('is-hidden', isEdit);
    if (editMaszynaForm) editMaszynaForm.classList.toggle('is-hidden', !isEdit);
    openDrawer(machineDrawer);
};
const closeClientActionMenus = (except = null) => {
    if (!listaKlientowDiv) return;
    listaKlientowDiv.querySelectorAll('.row-action').forEach(menu => {
        if (menu !== except) menu.classList.remove('is-open');
    });
};
async function obslugaListyKlientow(event) {
  const menuTrigger = event.target.closest('[data-client-action="menu"]');
  if (menuTrigger) {
    const menu = menuTrigger.closest('.row-action');
    const isOpen = menu?.classList.toggle('is-open');
    closeClientActionMenus(isOpen ? menu : null);
    return;
  }

  const menuAction = event.target.closest('[data-client-action]');
  if (menuAction && menuAction.dataset.clientAction !== 'menu') {
    event.stopPropagation();
    const klientId = menuAction.dataset.clientId;
    if (klientId && menuAction.dataset.clientAction === 'edit') {
      openClientDrawer(klientId, 'edit');
    }
    closeClientActionMenus();
    return;
  }

  const toggle = event.target.closest('.accordion-toggle');
  if (toggle) {
    const klientId = toggle.dataset.clientId;
    const accordion = toggle.closest('.client-accordion');
    if (!accordion || !klientId) return;
    const isOpen = accordion.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(isOpen));
    return;
  }

  const machineLink = event.target.closest('.client-machine-link');
  if (machineLink) {
    const maszynaId = machineLink.dataset.maszynaId;
    const klientId = machineLink.dataset.clientId;
    if (klientId) localStorage.setItem(UI_STORAGE_KEYS.machinesLast, klientId);
    if (maszynaId) otworzModalEdycjiMaszyny(maszynaId);
    return;
  }

  const clientMain = event.target.closest('.client-main');
  if (clientMain) {
    const klientId = clientMain.dataset.clientId;
    if (klientId) {
      openClientDrawer(klientId, 'view');
    }
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
                orderBy("serviceDate", "desc")
            );
            const querySnapshot = await getDocs(qMasz);


            let rowsHtml = '';
            if (!querySnapshot.empty) {
                querySnapshot.forEach((d) => {
                    const zlecenie = d.data();
                    const serviceDate = resolveServiceDate(zlecenie);
                    const uzyteCzesciHtml = zlecenie.uzyteCzesci?.length > 0
                        ? `<br><small>Użyto: ${zlecenie.uzyteCzesci.map(c => `${c.nazwa} (x${c.ilosc})`).join(', ')}</small>`
                        : '';
                    const wzHtml = zlecenie.zakonczenieNumerWZ ? `<br><small>WZ: ${zlecenie.zakonczenieNumerWZ}</small>` : '';
                    const notatkaHtml = zlecenie.zakonczenieNotatka ? `<br><small>📝 ${zlecenie.zakonczenieNotatka}</small>` : '';
                    const motoHoursVal = Number.isFinite(Number(zlecenie.motoHours)) ? Number(zlecenie.motoHours) : 0;
                    rowsHtml += `
                        <tr data-id="${d.id}">
                            <td>${serviceDate || 'b.d.'}</td>
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

            const updatedClient = { ...stareDane, ...dane, id: klientId };
            const cacheIndex = _wszystkieKlienciCache.findIndex(k => k.id === klientId);
            if (cacheIndex >= 0) {
                _wszystkieKlienciCache[cacheIndex] = updatedClient;
            }
            renderClientView(updatedClient);
            setClientDrawerMode('view');
            await logActivityEvent({
                type: 'CLIENT_EDIT',
                refId: klientId,
                label: `Zmieniono klienta ${updatedClient.nazwa || ''}`.trim()
            });
        } catch (e) {
            console.error("Błąd aktualizacji klienta lub powiązanych dokumentów:", e);
            alert("Wystąpił błąd podczas zapisywania zmian. Sprawdź konsolę.");
        }
    }

    const usunKlienta = async () => {
        if (!editKlientForm) return;
        const klientId = editKlientForm['edit-klient-id'].value;
        if (!klientId) return;
        if (!confirm("Usunięcie klienta usunie też wszystkie jego maszyny i zlecenia. Kontynuować?")) return;
        try {
            await deleteDoc(doc(db, "klienci", klientId));
            closeClientDrawer();
            wyswietlMaszyny();
        } catch (error) {
            console.error("Błąd usuwania klienta:", error);
            alert("Nie udało się usunąć klienta.");
        }
    };

    const MACHINE_CLIENT_RECENT_KEY = 'machineForm.recentClients';
    const MACHINE_CLIENT_RECENT_LIMIT = 5;

    const readRecentMachineClients = () => {
        try {
            const raw = localStorage.getItem(MACHINE_CLIENT_RECENT_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (err) {
            console.warn('[machines] Nie udało się wczytać ostatnich klientów:', err);
            return [];
        }
    };

    const writeRecentMachineClients = (clientIds) => {
        localStorage.setItem(MACHINE_CLIENT_RECENT_KEY, JSON.stringify(clientIds));
    };

    const pushRecentMachineClient = (clientId) => {
        if (!clientId) return;
        const current = readRecentMachineClients();
        const next = [clientId, ...current.filter(id => id !== clientId)].slice(0, MACHINE_CLIENT_RECENT_LIMIT);
        writeRecentMachineClients(next);
    };

    function getMachineClientOptions() {
        return (_wszystkieKlienciCache || []).map((client) => ({
            id: client.id,
            name: client.nazwa || '(bez nazwy)',
            nip: client.nip && client.nip !== '---' ? client.nip : ''
        }));
    }

    const createClientCombobox = ({ input, hiddenInput, dropdown, clearBtn, getOptions, extraOptions = [] }) => {
        if (!input || !hiddenInput || !dropdown) return null;
        const state = {
            isOpen: false,
            activeIndex: -1,
            items: [],
            selectedName: ''
        };
        const baseOptions = () => (typeof getOptions === 'function' ? getOptions() : []);
        const allOptions = () => [...extraOptions, ...baseOptions()];

        const updateClearButton = () => {
            if (!clearBtn) return;
            clearBtn.classList.toggle('is-visible', Boolean(input.value));
        };

        const closeDropdown = () => {
            dropdown.classList.remove('is-open');
            state.isOpen = false;
            state.activeIndex = -1;
        };

        const openDropdown = () => {
            dropdown.classList.add('is-open');
            state.isOpen = true;
        };

        const setActiveIndex = (index) => {
            state.activeIndex = index;
            const options = [...dropdown.querySelectorAll('.combobox-option')];
            options.forEach((option, idx) => {
                option.classList.toggle('is-active', idx === state.activeIndex);
            });
            const activeOption = options[state.activeIndex];
            if (activeOption) {
                activeOption.scrollIntoView({ block: 'nearest' });
            }
        };

        const applySelection = (client, { trackRecent = true } = {}) => {
            if (!client) return;
            hiddenInput.value = client.id;
            input.value = client.name;
            state.selectedName = client.name;
            updateClearButton();
            if (trackRecent && !client.isSpecial) {
                pushRecentMachineClient(client.id);
            }
            closeDropdown();
            hiddenInput.dispatchEvent(new Event('change'));
        };

        const selectClient = (client) => applySelection(client, { trackRecent: true });

        const clearSelection = () => {
            hiddenInput.value = '';
            input.value = '';
            state.selectedName = '';
            updateClearButton();
            closeDropdown();
            hiddenInput.dispatchEvent(new Event('change'));
        };

        const renderDropdown = () => {
            // DATA
            const query = input.value.trim();
            const queryLower = query.toLowerCase();
            const clients = allOptions();
            const baseClients = baseOptions();
            const recentIds = readRecentMachineClients();

            // AGREGACJA
            const matches = clients.filter((client) => {
                if (!queryLower) return true;
                const haystack = `${client.name} ${client.nip}`.toLowerCase();
                return haystack.includes(queryLower);
            });
            const startsWith = matches.filter((client) => client.name.toLowerCase().startsWith(queryLower));
            const contains = matches.filter((client) => !client.name.toLowerCase().startsWith(queryLower));
            let sortedMatches = [...startsWith, ...contains];

            const recentClients = !queryLower
                ? recentIds
                    .map(id => baseClients.find(client => client.id === id))
                    .filter(Boolean)
                : [];

            if (!queryLower && recentClients.length) {
                const recentSet = new Set(recentClients.map(client => client.id));
                sortedMatches = sortedMatches.filter(client => client.isSpecial || !recentSet.has(client.id));
            }

            // RENDER
            dropdown.innerHTML = '';
            state.items = [];
            let itemIndex = 0;
            const fragment = document.createDocumentFragment();

            const appendSection = (title) => {
                const section = document.createElement('div');
                section.className = 'combobox-section';
                section.textContent = title;
                fragment.appendChild(section);
            };

            const appendItems = (items) => {
                items.forEach((client) => {
                    const option = document.createElement('button');
                    option.type = 'button';
                    option.className = 'combobox-option';
                    option.dataset.index = String(itemIndex);
                    option.title = client.name;
                    option.innerHTML = `
                        <span>${client.name}</span>
                        ${client.nip ? `<small>NIP: ${client.nip}</small>` : ''}
                    `;
                    option.addEventListener('click', () => selectClient(client));
                    fragment.appendChild(option);
                    state.items.push(client);
                    itemIndex += 1;
                });
            };

            if (recentClients.length) {
                appendSection('Ostatnio używani');
                appendItems(recentClients);
            }

            if (sortedMatches.length) {
                if (recentClients.length) {
                    appendSection('Wszyscy klienci');
                }
                appendItems(sortedMatches);
            } else if (!recentClients.length) {
                const empty = document.createElement('div');
                empty.className = 'combobox-empty';
                empty.textContent = 'Brak wyników';
                fragment.appendChild(empty);
            }

            dropdown.appendChild(fragment);
            if (state.items.length) {
                setActiveIndex(0);
            } else {
                state.activeIndex = -1;
            }
        };

        const handleInput = () => {
            if (hiddenInput.value) {
                hiddenInput.value = '';
                state.selectedName = '';
            }
            openDropdown();
            renderDropdown();
            updateClearButton();
        };

        const handleKeyDown = (event) => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (!state.isOpen) {
                    openDropdown();
                    renderDropdown();
                }
                if (!state.items.length) return;
                const nextIndex = Math.min(state.items.length - 1, state.activeIndex + 1);
                setActiveIndex(Math.max(nextIndex, 0));
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (!state.isOpen) {
                    openDropdown();
                    renderDropdown();
                }
                if (!state.items.length) return;
                const prevIndex = Math.max(0, state.activeIndex - 1);
                setActiveIndex(prevIndex);
            }
            if (event.key === 'Enter') {
                if (!state.isOpen) return;
                event.preventDefault();
                const selected = state.items[state.activeIndex] || state.items[0];
                if (selected) selectClient(selected);
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                closeDropdown();
            }
        };

        const root = input.closest('.combobox');

        input.addEventListener('input', handleInput);
        input.addEventListener('focus', () => {
            openDropdown();
            renderDropdown();
        });
        input.addEventListener('click', () => {
            openDropdown();
            renderDropdown();
        });
        input.addEventListener('keydown', handleKeyDown);
        clearBtn?.addEventListener('click', clearSelection);

        document.addEventListener('click', (event) => {
            if (!root?.contains(event.target)) {
                closeDropdown();
            }
        });

        updateClearButton();

        return {
            clear: clearSelection,
            selectClient,
            refresh: () => {
                if (state.isOpen) renderDropdown();
            },
            getSelectedId: () => hiddenInput.value,
            setSelection: (client) => applySelection(client, { trackRecent: false })
        };
    };

    const addMachineClientCombobox = createClientCombobox({
        input: maszynaKlientInput,
        hiddenInput: maszynaKlientIdInput,
        dropdown: maszynaKlientDropdown,
        clearBtn: maszynaKlientClearBtn,
        getOptions: getMachineClientOptions
    });

    const editMachineClientCombobox = createClientCombobox({
        input: editMaszynaKlientInput,
        hiddenInput: editMaszynaKlientIdInput,
        dropdown: editMaszynaKlientDropdown,
        clearBtn: editMaszynaKlientClearBtn,
        getOptions: getMachineClientOptions
    });

    orderClientCombobox = createClientCombobox({
        input: zlecenieKlientInput,
        hiddenInput: zlecenieKlientIdInput,
        dropdown: zlecenieKlientDropdown,
        clearBtn: zlecenieKlientClearBtn,
        getOptions: getMachineClientOptions,
        extraOptions: [ORDER_QUICK_OPTION]
    });
    odswiezSelectKlientaDoZlecenia();

    // --- MASZYNY ---
    async function dodajMaszyne(event) {
        event.preventDefault();
        const wybranyKlientId = maszynaKlientIdInput?.value || '';
        if (!wybranyKlientId) { alert("Proszę wybrać klienta!"); return; }
        const klient = _wszystkieKlienciCache.find(k => k.id === wybranyKlientId);
        if (!klient) { alert("Błąd: Nie znaleziono danych wybranego klienta."); return; }

        const dane = {
            klientId: wybranyKlientId,
            klientNazwa: klient.nazwa || '(bez nazwy)',
            typMaszyny: maszynaForm['maszyna-typ'].value,
            model: maszynaForm['maszyna-model'].value,
            nrSeryjny: maszynaForm['maszyna-serial'].value || '---',
            rokProdukcji: Number(maszynaForm['maszyna-rok'].value) || null,
            motogodziny: Number(maszynaForm['maszyna-mth'].value) || 0,
            createdAt: new Date()
        };
        try {
            await addDoc(collection(db, "maszyny"), dane);
            maszynaForm.reset();
            addMachineClientCombobox?.clear();
            closeDrawer(machineDrawer);
        }
        catch (e) { console.error("Błąd dodawania maszyny: ", e); }
    }

    function wyswietlMaszyny() {
        if (_wszystkieKlienciCache.length === 0 && _wszystkieMaszynyCache.length > 0) {
            listaMaszynDiv.innerHTML = "<p>Ładowanie danych klientów...</p>";
            return;
        }
        // DATA → AGREGACJA → RENDER
        const frazaWyszukiwania = (maszynaSearchInput?.value || '').toLowerCase();
        const selectedClientId = maszynaClientFilterSelect?.value || '';
        const wszystkieMaszynyLocal = _wszystkieMaszynyCache || [];
        const wszystkieKlienciLocal = _wszystkieKlienciCache || [];
        wszystkieMaszyny = [];

        // AGREGACJA
        const klientMap = new Map(wszystkieKlienciLocal.map(klient => [klient.id, klient]));
        const przefiltrowaneMaszyny = wszystkieMaszynyLocal.filter(maszyna => {
            if (selectedClientId && maszyna.klientId !== selectedClientId) return false;
            if (!frazaWyszukiwania) return true;
            const tekst = `${maszyna.klientNazwa} ${maszyna.typMaszyny} ${maszyna.model} ${maszyna.nrSeryjny}`.toLowerCase();
            return tekst.includes(frazaWyszukiwania);
        });

        const pogrupowaneMaszyny = new Map();
        przefiltrowaneMaszyny.forEach(maszyna => {
            const klientId = maszyna.klientId || 'unknown';
            const klient = klientMap.get(klientId);
            const klientNazwa = klient?.nazwa || maszyna.klientNazwa || 'Nieznany klient';
            if (!pogrupowaneMaszyny.has(klientId)) {
                pogrupowaneMaszyny.set(klientId, { klientId, klientNazwa, maszyny: [] });
            }
            pogrupowaneMaszyny.get(klientId).maszyny.push(maszyna);
        });

        const grupyMaszyn = [...pogrupowaneMaszyny.values()].sort((a, b) => (a.klientNazwa || '').localeCompare(b.klientNazwa || ''));
        const expandedStored = readExpandedSet(UI_STORAGE_KEYS.machinesExpanded);
        const validIds = new Set(grupyMaszyn.map(group => group.klientId));
        const expandedSet = new Set([...expandedStored].filter(id => validIds.has(id)));

        // RENDER
        const maszynyHtml = grupyMaszyn.map((group) => {
            const isOpen = expandedSet.has(group.klientId);
            const rows = group.maszyny.map(maszyna => {
                const sn = (maszyna.nrSeryjny && maszyna.nrSeryjny !== '---') ? maszyna.nrSeryjny : '—';
                const metaParts = [`S/N: ${sn}`];
                if (maszyna.rokProdukcji) metaParts.push(`Rok: ${maszyna.rokProdukcji}`);
                if (maszyna.motogodziny) metaParts.push(`MTH: ${maszyna.motogodziny}`);
                return `
                    <div class="machine-row" data-id="${maszyna.id}" data-client-id="${group.klientId}" data-maszyna-nazwa="${maszyna.typMaszyny} ${maszyna.model}">
                        <div class="machine-row-main">
                            <strong>${maszyna.typMaszyny} ${maszyna.model}</strong>
                            <div class="machine-row-meta">${metaParts.join(' • ')}</div>
                        </div>
                        <div class="machine-row-actions">
                            <button type="button" class="machine-edit-link" data-maszyna-id="${maszyna.id}">Edytuj</button>
                        </div>
                    </div>
                `;
            }).join('');
            return `
                <section class="accordion-section ${isOpen ? 'is-open' : ''}" data-client-id="${group.klientId}">
                    <button type="button" class="accordion-header" data-client-id="${group.klientId}" aria-expanded="${String(isOpen)}">
                        <div class="accordion-title">
                            <span>${group.klientNazwa}</span>
                            <span class="accordion-badge">${group.maszyny.length} maszyn</span>
                        </div>
                        <span class="accordion-chevron">▼</span>
                    </button>
                    <div class="accordion-body">
                        ${rows}
                    </div>
                </section>
            `;
        }).join('');
       if (listaMaszynDiv) {
            listaMaszynDiv.innerHTML = maszynyHtml || "<p>Brak maszyn w bazie lub pasujących do wyszukiwania.</p>";
        }
        if (zlecenieKlientIdInput) {
            zlecenieKlientIdInput.dispatchEvent(new Event('change'));
        }
    }

    function aktualizujMaszynyDlaZlecenia() {
        if (!zlecenieMaszynaSelect) return;

        const wybranyKlientId = zlecenieKlientIdInput?.value || '';

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

    const applyMachinesData = (machines = [], { render = true } = {}) => {
        _wszystkieMaszynyCache = Array.isArray(machines) ? machines : [];
        wszystkieMaszyny = Array.isArray(machines) ? machines : [];
        if (render) {
            wyswietlMaszyny();
            wyswietlKlientow();
        }
    };


    function nasluchujNaMaszyny() {
        onSnapshot(query(collection(db, "maszyny"), orderBy("klientNazwa")), (snapshot) => {
            const machines = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
            applyMachinesData(machines);
        });
    }

    async function obslugaListyMaszyn(event) {
  const el = event.target;

  const accordionHeader = el.closest('.accordion-header');
  if (accordionHeader) {
    const klientId = accordionHeader.dataset.clientId;
    const section = accordionHeader.closest('.accordion-section');
    if (!section || !klientId) return;
    const isOpen = section.classList.toggle('is-open');
    accordionHeader.setAttribute('aria-expanded', String(isOpen));
    updateExpandedState(UI_STORAGE_KEYS.machinesExpanded, UI_STORAGE_KEYS.machinesLast, klientId, isOpen);
    return;
  }

  if (el.classList.contains('machine-edit-link')) {
    event.preventDefault();
    event.stopPropagation();
    const maszynaId = el.dataset.maszynaId;
    if (!maszynaId) return;
    otworzModalEdycjiMaszyny(maszynaId);
    return;
  }

  const row = el.closest('.machine-row');
  if (!row) return;
  const maszynaId = row.dataset.id;
  const klientId = row.dataset.clientId;
  const maszynaNazwa = row.dataset.maszynaNazwa;
  if (!maszynaId) return;
  if (klientId) {
    updateExpandedState(UI_STORAGE_KEYS.machinesExpanded, UI_STORAGE_KEYS.machinesLast, klientId, true);
  }
  pokazHistorieSerwisowaMaszyny(maszynaId, maszynaNazwa);
}

function otworzModalEdycjiMaszyny(maszynaId) {
    if (!editMaszynaForm) return;
    const maszyna = _wszystkieMaszynyCache.find(m => m.id === maszynaId);
    if (!maszyna) return;
    const klient = _wszystkieKlienciCache.find(k => k.id === maszyna.klientId);
    const klientNazwa = klient?.nazwa || maszyna.klientNazwa || '(bez nazwy)';
    const klientNip = klient?.nip && klient.nip !== '---' ? klient.nip : '';
    editMaszynaForm['edit-maszyna-id'].value = maszyna.id;
    editMachineClientCombobox?.setSelection({
        id: maszyna.klientId,
        name: klientNazwa,
        nip: klientNip
    });
    editMaszynaForm['edit-maszyna-typ'].value = maszyna.typMaszyny;
    editMaszynaForm['edit-maszyna-model'].value = maszyna.model;
    editMaszynaForm['edit-maszyna-serial'].value = maszyna.nrSeryjny === '---' ? '' : maszyna.nrSeryjny;
    editMaszynaForm['edit-maszyna-rok'].value = maszyna.rokProdukcji || '';
    editMaszynaForm['edit-maszyna-mth'].value = maszyna.motogodziny || 0;
    setMachineDrawerMode('edit');
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
    const wybranyKlientId = editMaszynaKlientIdInput?.value || '';
    if (!wybranyKlientId) {
        alert("Proszę wybrać klienta!");
        return;
    }
    const klient = _wszystkieKlienciCache.find(k => k.id === wybranyKlientId);
    if (!klient) {
        alert("Błąd: Nie znaleziono danych wybranego klienta.");
        return;
    }

    const dane = {
        klientId: wybranyKlientId,
        klientNazwa: klient.nazwa || '(bez nazwy)',
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

        await logActivityEvent({
            type: 'MACHINE_EDIT',
            refId: maszynaId,
            label: `Zmieniono maszynę ${nowyTyp || ''} ${nowyModel || ''}`.trim()
        });
        closeDrawer(machineDrawer);
    } catch (e) {
        console.error("Błąd aktualizacji maszyny lub powiązanych zleceń:", e);
        alert("Wystąpił błąd podczas zapisywania zmian. Sprawdź konsolę.");
    }
}

const usunMaszyne = async () => {
    if (!editMaszynaForm) return;
    const maszynaId = editMaszynaForm['edit-maszyna-id'].value;
    if (!maszynaId) return;
    if (!confirm("Usunięcie maszyny usunie też jej zlecenia. Kontynuować?")) return;
    try {
        await deleteDoc(doc(db, "maszyny", maszynaId));
        closeDrawer(machineDrawer);
        wyswietlKlientow();
    } catch (error) {
        console.error("Błąd usuwania maszyny:", error);
        alert("Nie udało się usunąć maszyny.");
    }
};

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
        if (ordersFilterMode === 'unbilled') {
            const status = zlecenie?.status;
            if (!(status === 'ukończone' || status === 'ukonczone')) return false;
            const billed = Number(zlecenie?.wyfakturowaneGodziny ?? zlecenie?.wyfakturowane ?? 0) || 0;
            if (billed > 0) return false;
        }
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
            const serviceDate = resolveServiceDate(zlecenie);
            if (!serviceDate.startsWith(selectedMonth)) {
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
                    <em>Wykonano (${serviceDate || 'b.d.'})</em><br>
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




const applyOrdersData = (orders = [], { render = true } = {}) => {
    _wszystkieZleceniaCache = Array.isArray(orders) ? orders : [];
    wszystkieZlecenia = Array.isArray(orders) ? orders : [];
    if (render) {
        wyswietlZlecenia();
        odswiezPodsumowania();
        rebuildCalendarDecorations();
        updateUnfinishedSummary();
        przeprowadzMigracjeStartEnd().catch(err => console.error('[Migracja start/end] Błąd aktualizacji:', err));
    }
};

const applyActivityData = (entries = [], { render = true, status = 'ready' } = {}) => {
    recentActivity = Array.isArray(entries) ? entries : [];
    activityStatus = status;
    if (render) {
        renderPulpit();
    }
};

function nasluchujNaActivity() {
    activityStatus = 'loading';
    onSnapshot(
        query(collection(db, "activity"), orderBy("timestamp", "desc"), limit(20)),
        (snapshot) => {
            const entries = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
            applyActivityData(entries, { status: 'ready' });
        },
        (error) => {
            console.error('Błąd ładowania aktywności:', error);
            applyActivityData([], { status: 'error' });
        }
    );
}

function nasluchujNaZlecenia() {
    onSnapshot(query(collection(db, "zlecenia"), orderBy("createdAt", "desc")), (snapshot) => {
        const orders = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        applyOrdersData(orders);
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
        if (!zlecenie.serviceDate) {
            const fallbackDate = zlecenie.dataUkonczenia || (zlecenie.createdAt ? formatDateForStorage(toDateSafe(zlecenie.createdAt)) : '');
            if (fallbackDate) {
                payload.serviceDate = fallbackDate;
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
    const wybranyKlientId = zlecenieKlientIdInput?.value || '';
    const wybranaMaszynaId = zlecenieMaszynaSelect.value;
    const historia = [{ timestamp: new Date().toISOString(), akcja: "Utworzono zlecenie" }];
    // Start zlecenia zapisujemy automatycznie w chwili utworzenia (brak inicjacji z widoku kalendarza),
    // dlatego bazujemy na serverTimestamp(), który odpowiada czasowi zapisowemu na serwerze.
    const startAtFieldValue = serverTimestamp();

    const serviceDate = formatDateForStorage(new Date());
    let dane;
    if (wybranyKlientId === "szybkie-zlecenie") {
        dane = {
            status: 'nieprzypisane',
            nrZlecenia: zlecenieForm['nr-zlecenia'].value,
            opis: zlecenieForm['opis-usterki'].value,
            motoHours: 0,
            startAt: startAtFieldValue,
            endAt: null,
            serviceDate,
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
            serviceDate,
            historia,
            createdAt: new Date(),
            zakonczenieNotatka: null,
            zakonczenieNumerWZ: null
        };
    } else { alert("Wybierz klienta i maszynę LUB opcję 'Szybkie Zlecenie'."); return; }

    try {
        const docRef = await addDoc(collection(db, "zlecenia"), dane);
        if (dane.maszynaId && zlecenieForm.motogodziny.value) {
            await updateDoc(doc(db, "maszyny", dane.maszynaId), { motogodziny: dane.motogodziny });
        }
        await logActivityEvent({
            type: 'ORDER_CREATED',
            refId: docRef.id,
            label: `Utworzono zlecenie ${dane.nrZlecenia || '(bez numeru)'}`
        });
        zlecenieForm.reset();
        orderClientCombobox?.clear();
        zlecenieMaszynaSelect.innerHTML = '<option value="">-- Najpierw wybierz klienta --</option>';
        zlecenieMaszynaSelect.disabled = true;
        zlecenieKlientIdInput?.dispatchEvent(new Event('change'));
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
            const completeServiceDateInput = document.getElementById('complete-zlecenie-service-date');
            if (completeServiceDateInput) {
                const resolvedServiceDate = resolveServiceDate(zlecenie) || formatDateForStorage(new Date());
                completeServiceDateInput.value = resolvedServiceDate;
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
                serviceDate: null,
                endAt: null,
                closeDate: null,
                closedAt: null,
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
    const opisDiv = document.getElementById('details-zlecenie-opis');
    if (!detailsZlecenieModal || !titleEl || !infoDiv || !historiaDiv || !kalendarzDiv || !opisDiv) return;
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
    const serviceDate = resolveServiceDate(zlecenie);

    titleEl.textContent = `Szczegóły Zlecenia #${zlecenie.nrZlecenia}`;
    infoDiv.innerHTML = `
        <div class="details-group"><strong>Klient:</strong> <p>${klient ? klient.nazwa : '---'}</p></div>
        <div class="details-group"><strong>Maszyna:</strong> <p>${maszyna ? `${maszyna.typMaszyny} ${maszyna.model}` : '---'}</p></div>
        <div class="details-group"><strong>Utworzono:</strong> <p>${formatDateTimeLabel(zlecenie.createdAt)}</p></div>
        <div class="details-group"><strong>Wykonano:</strong> <p>${serviceDate ? formatDateLabel(serviceDate) : '—'}</p></div>
        <div class="details-group"><strong>Start:</strong> <p>${formatDateTimeLabel(zlecenie.startAt)}</p></div>
        <div class="details-group"><strong>Koniec:</strong> <p>${zlecenie.endAt ? formatDateTimeLabel(zlecenie.endAt) : '—'}</p></div>
        <div class="details-group"><strong>Status:</strong> <p>${zlecenie.status}</p></div>
    `;

    if (zlecenie.status === 'ukończone') {
         const wzHtml = zlecenie.zakonczenieNumerWZ ? `<div class="details-group"><strong>Numer WZ:</strong> <p>${zlecenie.zakonczenieNumerWZ}</p></div>` : '';       
        const notatkaHtml = zlecenie.zakonczenieNotatka ? `<div class="details-group"><strong>Notatka przy zakończeniu:</strong> <p>${zlecenie.zakonczenieNotatka}</p></div>` : '';
        infoDiv.innerHTML += `
            <div class="details-group"><strong>Data wykonania:</strong> <p>${serviceDate || '—'}</p></div>
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
    opisDiv.innerHTML = zlecenie.opis ? `<p>${zlecenie.opis}</p>` : '<p>Brak opisu.</p>';

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
        const serviceDateInput = document.getElementById('complete-zlecenie-service-date');
        const serviceDateRaw = serviceDateInput?.value || '';
        const normalizedServiceDate = normalizeDayKey(serviceDateRaw, 'serviceDate');
        if (serviceDateRaw && !normalizedServiceDate) {
            alert('Wybierz poprawną datę wykonania.');
            return;
        }
        const serviceDateKey = normalizedServiceDate || formatDateForStorage(new Date());
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
        const closeDateKey = formatDateForStorage(fallbackEndAtDate);
        const dane = {
            status: 'ukończone',
            wyfakturowaneGodziny: Number(document.getElementById('wyfakturowane-godziny').value),
            motoHours: Number(motoHours),
            typZlecenia: document.getElementById('typ-zlecenia').value,
            dataUkonczenia: serviceDateKey,
            serviceDate: serviceDateKey,
            endAt: endAtValue,
            closedAt: endAtValue,
            closeDate: closeDateKey,
            uzyteCzesci: czesciDoZlecenia,
            zakonczenieNotatka: notatka || null,
            zakonczenieNumerWZ: numerWzValue || null
        };
        let zamykaneZlecenieData = null;
        let staraDataWykonania = null;
        try {
            await runTransaction(db, async (t) => {
                const zlecenieSnap = await t.get(zlecenieRef);
                if (!zlecenieSnap.exists()) throw "Zlecenie nie istnieje!";
                const zlecenieData = zlecenieSnap.data();
                zamykaneZlecenieData = zlecenieData;
                staraDataWykonania = resolveServiceDate(zlecenieData);
                let wpisHistorii = `Zakończono zlecenie. Godziny: ${dane.wyfakturowaneGodziny}h. Typ: ${dane.typZlecenia}. Motogodziny: ${motoHours.toFixed(1)}h. Wykonano: ${serviceDateKey}.`;
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
                    closedAt: endAtValue
                };
                try {
                    await addDoc(collection(db, 'orders_history'), historiaPayload);
                } catch (historyErr) {
                    console.warn('Nie udało się zapisać historii zlecenia:', historyErr);
                }
                await logActivityEvent({
                    type: 'ORDER_CLOSED',
                    refId: docId,
                    label: `Zamknięto zlecenie ${zamykaneZlecenieData.nrZlecenia || ''} (wykonano ${serviceDateKey})`
                });
                if (staraDataWykonania && staraDataWykonania !== serviceDateKey) {
                    await logActivityEvent({
                        type: 'ORDER_CLOSED',
                        refId: docId,
                        label: `Zmieniono datę wykonania z ${staraDataWykonania} na ${serviceDateKey}`
                    });
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
    const normalizeClientName = (value) => {
        const trimmed = (value || '').trim();
        if (!trimmed || trimmed === '---') return 'Brak';
        return trimmed;
    };


    const parseOilMeta = (produkt = {}) => {
        let typOleju = produkt.typOleju || produkt.typOlej || produkt.typ;
        let pojemnosc = Number(produkt.pojemnosc) || null;
        if (!typOleju || !pojemnosc) {
            const index = String(produkt.index || '');
            const match = index.match(/OLEJ-([A-Z0-9]+)-(\d+(?:\.\d+)?)L/i);
            if (match) {
                typOleju = typOleju || match[1];
                pojemnosc = pojemnosc || Number(match[2]);
            }
        }
        if (!typOleju || !pojemnosc) {
            const name = String(produkt.nazwa || '');
            const matchName = name.match(/Olej\s+([A-Z0-9]+)\s+(\d+(?:\.\d+)?)L/i);
            if (matchName) {
                typOleju = typOleju || matchName[1];
                pojemnosc = pojemnosc || Number(matchName[2]);
            }
        }
        return {
            typOleju: typOleju || '',
            pojemnosc: Number.isFinite(pojemnosc) ? pojemnosc : null
        };
    };

    const resolveWarehouseType = (produkt = {}) => {
        if (!produkt) return '';
        if (produkt.jestOlejem) {
            const { typOleju } = parseOilMeta(produkt);
            return typOleju || '';
        }
        if (produkt.typProdukt) return produkt.typProdukt;
        const index = String(produkt.index || '').toUpperCase();
        const name = String(produkt.nazwa || '').toUpperCase();
        if (index.includes(PRODUCT_TYPE_ZMYWACZ) || name.includes('ZMYWACZ')) {
            return PRODUCT_TYPE_ZMYWACZ;
        }
        return '';
    };

    const formatWarehouseDate = (value) => {
        const date = toDateSafe(value);
        if (!date) return '—';
        return date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    const setOilFieldsVisibility = (visible) => {
        if (!itemOilFields) return;
        itemOilFields.classList.toggle('is-visible', visible);
    };

    const resetProductAddForm = () => {
        if (!magazynForm) return;
        magazynForm.reset();
        if (itemIsOilCheckbox) itemIsOilCheckbox.checked = false;
        if (itemProductTypeSelect) itemProductTypeSelect.value = '';
        setOilFieldsVisibility(false);
    };

    const ensureDefaultStockItems = async (items = []) => {
        if (hasEnsuredDefaultStock) return;
        const existingIndexes = new Set((items || []).map(item => (item.index || '').toLowerCase()));
        const existingNames = new Set((items || []).map(item => (item.nazwa || '').toLowerCase()));
        const missing = DEFAULT_STOCK_ITEMS.filter(item => {
            const indexKey = item.index.toLowerCase();
            const nameKey = item.nazwa.toLowerCase();
            return !existingIndexes.has(indexKey) && !existingNames.has(nameKey);
        });
        if (!missing.length) {
            hasEnsuredDefaultStock = true;
            return;
        }
        try {
            for (const item of missing) {
                await addDoc(collection(db, "magazyn"), {
                    index: item.index,
                    nazwa: item.nazwa,
                    ilosc: 0,
                    klient: '---',
                    jestOlejem: Boolean(item.jestOlejem),
                    typProdukt: item.typProdukt || null,
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
            }
        } catch (error) {
            console.warn('[magazyn] Nie udało się dodać domyślnych produktów:', error);
        } finally {
            hasEnsuredDefaultStock = true;
        }
    };

    async function dodajProduktDoMagazynu(event) {
        event.preventDefault();
        if (!magazynForm) return;
        const index = magazynForm['item-index'].value.trim();
        const nazwa = magazynForm['item-name'].value.trim();
        const klient = magazynForm['item-klient'].value.trim();
        const ilosc = Number(magazynForm['item-ilosc'].value || 0);
        const isOil = Boolean(itemIsOilCheckbox?.checked);
        const pojemnosc = Number(itemOilContainerSelect?.value || '');
        const typOleju = itemOilTypeSelect?.value || '';
        const typProdukt = itemProductTypeSelect?.value || '';

        if (!index || !nazwa) { alert("Index i nazwa są wymagane."); return; }
        if (wszystkieProdukty.some(p => (p.index || '').toLowerCase() === index.toLowerCase())) {
            alert("Index musi być unikalny."); return;
        }
        if (!Number.isFinite(ilosc) || ilosc < 0) { alert("Podaj poprawną ilość (>= 0)."); return; }
        if (!isOil && !Number.isInteger(ilosc)) { alert("Ilość musi być liczbą całkowitą."); return; }
        if (isOil && (!typOleju || !Number.isFinite(pojemnosc) || pojemnosc <= 0)) {
            alert("Uzupełnij typ oleju i pojemnik."); return;
        }

        const dane = {
            index,
            nazwa,
            ilosc: Number(ilosc),
            klient: klient || '---',
            createdAt: new Date(),
            updatedAt: new Date(),
            jestOlejem: isOil,
            typOleju: isOil ? typOleju : null,
            pojemnosc: isOil ? pojemnosc : null,
            typProdukt: isOil ? typOleju : (typProdukt || null)
        };
        try {
            const docRef = await addDoc(collection(db, "magazyn"), dane);
            await logActivityEvent({
                type: 'STOCK_CHANGE',
                refId: docRef.id,
                label: `Dodano produkt ${dane.index} (${dane.nazwa})`
            });
            resetProductAddForm();
            if (productAddModal) hideModal(productAddModal);
        } catch (e) {
            console.error("Błąd dodawania do magazynu: ", e);
        }
    }

    const parseBulkItems = (text) => {
        const lines = (text || '').split('\n').map(line => line.trim()).filter(Boolean);
        const seen = new Set();
        return lines.map((line, idx) => {
            const parts = line.split(';').map(p => p.trim());
            if (parts.length < 3) {
                return { line, index: idx + 1, valid: false, error: 'Nieprawidłowy format (brak pól).' };
            }
            const [index, nazwa, ilosc] = parts;
            const parsedIlosc = Number(ilosc);
            if (!index) return { line, index: idx + 1, valid: false, error: 'Brak indexu.' };
            if (!nazwa) return { line, index: idx + 1, valid: false, error: 'Brak nazwy.' };
            const normalizedIndex = index.toLowerCase();
            if (seen.has(normalizedIndex)) {
                return { line, index: idx + 1, valid: false, error: 'Duplikat indexu w liście.' };
            }
            seen.add(normalizedIndex);
            if (wszystkieProdukty.some(p => (p.index || '').toLowerCase() === normalizedIndex)) {
                return { line, index: idx + 1, valid: false, error: 'Index już istnieje.' };
            }
            if (!Number.isFinite(parsedIlosc) || parsedIlosc < 0) {
                return { line, index: idx + 1, valid: false, error: 'Nieprawidłowa ilość.' };
            }
            if (!Number.isInteger(parsedIlosc)) {
                return { line, index: idx + 1, valid: false, error: 'Ilość musi być liczbą całkowitą.' };
            }
            return { line, index: idx + 1, valid: true, data: { index, nazwa, ilosc: parsedIlosc } };
        });
    };

    const renderBulkPreview = () => {
        if (!bulkItemsInput || !bulkPreviewList || !bulkErrors) return;
        const parsed = parseBulkItems(bulkItemsInput.value);
        bulkPreviewList.innerHTML = parsed.map(item => `
            <li>
                <span>${item.index}. ${item.data ? `${item.data.index} • ${item.data.nazwa}` : item.line}</span>
                <span class="${item.valid ? 'status-ok' : 'status-error'}">${item.valid ? 'OK' : item.error}</span>
            </li>
        `).join('') || '<li>Brak danych do podglądu.</li>';
        const errors = parsed.filter(item => !item.valid);
        bulkErrors.textContent = errors.length ? `Błędy: ${errors.length}. Popraw dane przed zapisem.` : '';
        if (bulkReport) bulkReport.textContent = '';
    };

    async function dodajMasowo(event) {
        event.preventDefault();
        const klient = (bulkAddForm?.['bulk-klient']?.value || '').trim() || '---';
        const itemsText = bulkItemsInput?.value || '';
        if (!itemsText.trim()) return;
        const parsed = parseBulkItems(itemsText);
        const validItems = parsed.filter(item => item.valid && item.data);
        const invalidItems = parsed.filter(item => !item.valid);
        if (!validItems.length) {
            alert("Nie znaleziono poprawnych rekordów do dodania.");
            return;
        }
        let dodaneCount = 0;
        const skipped = [];
        try {
            for (const item of validItems) {
                const existing = wszystkieProdukty.find(p => (p.index || '').toLowerCase() === item.data.index.toLowerCase());
                if (existing) {
                    skipped.push(`${item.data.index}: duplikat indexu`);
                    continue;
                }
                await addDoc(collection(db, "magazyn"), {
                    index: item.data.index,
                    nazwa: item.data.nazwa,
                    ilosc: item.data.ilosc,
                    klient,
                    jestOlejem: false,
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                dodaneCount++;
            }
            const invalidReasons = invalidItems.map(item => `${item.index}: ${item.error}`);
            const skippedCount = invalidItems.length + skipped.length;
            if (bulkReport) {
                bulkReport.innerHTML = `
                    <strong>Raport:</strong> dodano ${dodaneCount}, pominięto ${skippedCount}.
                    ${skippedCount ? `<div>Powody: ${[...invalidReasons, ...skipped].join(' • ')}</div>` : ''}
                `;
            }
            bulkAddForm?.reset();
            if (bulkPreviewList) bulkPreviewList.innerHTML = '';
            if (bulkErrors) bulkErrors.textContent = '';
            if (bulkAddModal) hideModal(bulkAddModal);
        } catch (error) {
            console.error("Błąd masowego dodawania:", error);
            alert("Wystąpił błąd.");
        }
    }

    const OIL_TYPE_DEFAULTS = ['HYGARD', 'PLUS50', 'COOLGARD', 'EXTGARD'];
    const OIL_CONTAINER_DEFAULTS = [20, 55, 209];

    const buildOilProductData = ({ typ, pojemnosc, klient, ilosc }) => ({
        index: `OLEJ-${typ}-${pojemnosc}L`,
        nazwa: `Olej ${typ} ${pojemnosc}L`,
        ilosc,
        klient: klient || '---',
        jestOlejem: true,
        typOleju: typ,
        pojemnosc,
        createdAt: new Date(),
        updatedAt: new Date()
    });

    const syncOilToolOptions = () => {
        const types = new Set(OIL_TYPE_DEFAULTS);
        const containers = new Set(OIL_CONTAINER_DEFAULTS.map(String));
        wszystkieProdukty.forEach((produkt) => {
            const { typOleju, pojemnosc } = parseOilMeta(produkt);
            if (typOleju) types.add(typOleju);
            if (pojemnosc) containers.add(String(pojemnosc));
        });
        const prevType = oilQuickTypeSelect?.value || '';
        const prevQuickContainer = oilQuickContainerSelect?.value || '';
        const prevConverterContainer = oilConverterContainer?.value || '';
        const typeOptions = [...types].filter(Boolean).sort();
        const containerOptions = [...containers]
            .filter(Boolean)
            .map(val => Number(val))
            .filter(Number.isFinite)
            .sort((a, b) => a - b)
            .map(val => String(val));
        const optionHtml = (items, formatter = (v) => v) => items.map(val => `<option value="${val}">${formatter(val)}</option>`).join('');
        if (oilQuickTypeSelect) oilQuickTypeSelect.innerHTML = optionHtml(typeOptions);
        if (oilQuickContainerSelect) oilQuickContainerSelect.innerHTML = optionHtml(containerOptions, v => `${v} L`);
        if (oilConverterContainer) oilConverterContainer.innerHTML = optionHtml(containerOptions, v => `${v} L`);
        if (oilQuickTypeSelect && typeOptions.includes(prevType)) oilQuickTypeSelect.value = prevType;
        if (oilQuickContainerSelect && containerOptions.includes(prevQuickContainer)) oilQuickContainerSelect.value = prevQuickContainer;
        if (oilConverterContainer && containerOptions.includes(prevConverterContainer)) oilConverterContainer.value = prevConverterContainer;
    };

    const updateOilConverter = (source) => {
        if (!oilConverterContainer || !oilConverterLitersInput || !oilConverterUnitsInput) return;
        const pojemnosc = Number(oilConverterContainer.value);
        if (!Number.isFinite(pojemnosc) || pojemnosc <= 0) return;
        if (source.value === '') {
            if (source === oilConverterLitersInput) oilConverterUnitsInput.value = '';
            if (source === oilConverterUnitsInput) oilConverterLitersInput.value = '';
            return;
        }
        const isLiters = source === oilConverterLitersInput;
        const rawValue = Number(source.value);
        if (!Number.isFinite(rawValue)) {
            if (isLiters) oilConverterUnitsInput.value = '';
            if (!isLiters) oilConverterLitersInput.value = '';
            return;
        }
        if (isLiters) {
            const units = rawValue / pojemnosc;
            oilConverterUnitsInput.value = Number.isFinite(units) ? units.toFixed(2) : '';
        } else {
            const liters = rawValue * pojemnosc;
            oilConverterLitersInput.value = Number.isFinite(liters) ? liters.toFixed(2) : '';
        }
    };

    const setOilToolsTab = (tabId) => {
        oilToolsTabs?.forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.drawerTab === tabId);
        });
        oilToolsPanels?.forEach(panel => {
            panel.classList.toggle('is-active', panel.dataset.drawerPanel === tabId);
        });
    };

    const adjustWarehouseStock = async ({ docId, changeQty, operation }) => {
        if (!docId) return;
        const docRef = doc(db, "magazyn", docId);
        const produkt = getProductById(docId);
        const produktLabel = produkt ? `${produkt.index || ''} ${produkt.nazwa || ''}`.trim() : 'produkt';
        await runTransaction(db, async (t) => {
            const sfDoc = await t.get(docRef);
            if (!sfDoc.exists()) { throw "Dokument nie istnieje!"; }
            const produktData = sfDoc.data();
            const currentQty = Number(produktData.ilosc) || 0;
            const isOil = Boolean(produktData.jestOlejem);
            if (!isOil && !Number.isInteger(changeQty)) {
                throw "Dla tego produktu można podawać tylko liczby całkowite.";
            }
            let newQty = operation === 'add' ? currentQty + changeQty : currentQty - changeQty;
            if (isOil) {
                newQty = Number(newQty.toFixed(2));
            }
            if (newQty < 0) { throw "Nie można zdjąć więcej niż jest na stanie!"; }
            t.update(docRef, { ilosc: newQty, updatedAt: new Date() });
        });
        await logActivityEvent({
            type: 'STOCK_CHANGE',
            refId: docId,
            label: `Zmiana stanu: ${produktLabel} (${operation === 'add' ? '+' : '-'}${changeQty} szt.)`
        });
    };

    const findOilProduct = ({ typ, pojemnosc, klient }) => {
        return wszystkieProdukty.find((produkt) => {
            const meta = parseOilMeta(produkt);
            const clientMatch = klient ? normalizeClientName(produkt.klient) === normalizeClientName(klient) : true;
            return meta.typOleju === typ && Number(meta.pojemnosc) === Number(pojemnosc) && clientMatch;
        });
    };

    const handleOilQuickAdd = async () => {
        if (!oilQuickTypeSelect || !oilQuickContainerSelect || !oilQuickQuantityInput || !oilQuickUnitSelect) return;
        const typ = oilQuickTypeSelect.value;
        const pojemnosc = Number(oilQuickContainerSelect.value);
        const unit = oilQuickUnitSelect.value;
        const rawQty = Number(oilQuickQuantityInput.value);
        const klient = oilQuickClientInput?.value.trim();
        if (!typ || !Number.isFinite(pojemnosc) || pojemnosc <= 0) { alert("Uzupełnij typ i pojemność."); return; }
        if (!Number.isFinite(rawQty) || rawQty <= 0) { alert("Podaj poprawną ilość."); return; }
        const qtyInUnits = unit === 'L' ? rawQty / pojemnosc : rawQty;
        const normalizedQty = Number(qtyInUnits.toFixed(2));
        if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) { alert("Ilość po przeliczeniu jest nieprawidłowa."); return; }

        const existing = findOilProduct({ typ, pojemnosc, klient });
        try {
            if (existing) {
                await adjustWarehouseStock({ docId: existing.id, changeQty: normalizedQty, operation: 'add' });
            } else {
                const docRef = await addDoc(collection(db, "magazyn"), buildOilProductData({
                    typ,
                    pojemnosc,
                    klient,
                    ilosc: normalizedQty
                }));
                await logActivityEvent({
                    type: 'STOCK_CHANGE',
                    refId: docRef.id,
                    label: `Dodano olej ${typ} ${pojemnosc}L (${normalizedQty} szt.)`
                });
            }
            if (oilQuickQuantityInput) oilQuickQuantityInput.value = '';
            if (oilQuickClientInput) oilQuickClientInput.value = '';
        } catch (e) {
            console.error("Błąd szybkiego dodawania oleju: ", e);
            alert(`Wystąpił błąd: ${e.message || e}`);
        }
    };

    const updateSortButtons = () => {
        if (!magazynTable) return;
        magazynTable.querySelectorAll('.sort-btn').forEach(btn => {
            const key = btn.dataset.sort;
            if (!key) return;
            btn.classList.toggle('is-active', magazynSort.key === key);
            btn.classList.toggle('is-desc', magazynSort.dir === 'desc' && magazynSort.key === key);
        });
    };

    const applyMagazynFilters = (items) => {
        const search = (magazynSearchInput?.value || '').trim().toLowerCase();
        const clientFilter = magazynFilterClient?.value || '';
        const productTypeFilter = magazynFilterOilType?.value || '';
        const containerFilter = magazynFilterContainer?.value || '';
        return (items || []).filter(item => {
            const clientName = normalizeClientName(item.klient);
            const matchesSearch = !search || [item.index, item.nazwa, clientName].some(val => String(val || '').toLowerCase().includes(search));
            const { pojemnosc } = parseOilMeta(item);
            const productType = resolveWarehouseType(item);
            const matchesClient = !clientFilter || clientName === clientFilter;
            const matchesProductType = !productTypeFilter || productType === productTypeFilter;
            const matchesContainer = !containerFilter || (pojemnosc && String(pojemnosc) === containerFilter);
            return matchesSearch && matchesClient && matchesProductType && matchesContainer;
        });
    };

    const sortMagazynItems = (items) => {
        const dir = magazynSort.dir === 'desc' ? -1 : 1;
        const getLiters = (item) => {
            const { pojemnosc } = parseOilMeta(item);
            return pojemnosc ? (Number(item.ilosc) || 0) * pojemnosc : 0;
        };
        return [...items].sort((a, b) => {
            switch (magazynSort.key) {
                case 'ilosc':
                    return ((Number(a.ilosc) || 0) - (Number(b.ilosc) || 0)) * dir;
                case 'litry':
                    return (getLiters(a) - getLiters(b)) * dir;
                case 'klient':
                    return normalizeClientName(a.klient).localeCompare(normalizeClientName(b.klient), 'pl') * dir;
                case 'index':
                    return (a.index || '').localeCompare(b.index || '', 'pl') * dir;
                case 'updatedAt': {
                    const aDate = toDateSafe(a.updatedAt || a.createdAt);
                    const bDate = toDateSafe(b.updatedAt || b.createdAt);
                    return ((aDate?.getTime() || 0) - (bDate?.getTime() || 0)) * dir;
                }
                case 'nazwa':
                default:
                    return (a.nazwa || '').localeCompare(b.nazwa || '', 'pl') * dir;
            }
        });
    };

    const renderMagazynTable = () => {
        if (!magazynLista) return;
        renderMagazynSummary();
        const { isStockLoading } = getStockUiState();
        if (isStockLoading) {
            magazynLista.innerHTML = '<tr><td colspan="7" class="loading-state">Ładowanie magazynu...</td></tr>';
            updateSortButtons();
            return;
        }
        if (stockStatus === 'error' && !wszystkieProdukty.length) {
            magazynLista.innerHTML = '<tr class="empty-row"><td data-label="Informacja" colspan="7">Nie udało się załadować magazynu.</td></tr>';
            updateSortButtons();
            return;
        }
        const filtered = sortMagazynItems(applyMagazynFilters(wszystkieProdukty));
        const emptyRowHtml = '<tr class="empty-row"><td data-label="Informacja" colspan="7">Brak pozycji w magazynie.</td></tr>';
        if (!filtered.length) {
            magazynLista.innerHTML = emptyRowHtml;
            updateSortButtons();
            return;
        }
        const rows = filtered.map((produkt) => {
            const jestOlejem = Boolean(produkt.jestOlejem);
            const { pojemnosc, typOleju } = parseOilMeta(produkt);
            const productType = resolveWarehouseType(produkt);
            const iloscFormatowana = formatujIloscMagazynu(produkt.ilosc);
            const litersValue = jestOlejem && pojemnosc ? (Number(produkt.ilosc) * pojemnosc) : null;
            const iloscWSztukach = `<span class="qty-cell">${iloscFormatowana} szt</span>`;
            const iloscWLitrach = litersValue === null
                ? '—'
                : `<span class="qty-cell">${formatujIloscMagazynu(litersValue)} L</span>`;
            const klientDisplay = normalizeClientName(produkt.klient);
            const lastChange = formatWarehouseDate(produkt.updatedAt || produkt.createdAt);
            return `<tr data-id="${produkt.id}" data-name="${produkt.nazwa}" data-qty="${produkt.ilosc}" data-is-oil="${jestOlejem}" data-index="${produkt.index}" data-client="${klientDisplay}" data-oil-type="${typOleju}" data-product-type="${productType}" data-container="${pojemnosc || ''}">
                    <td data-label="Index">${produkt.index}</td>
                    <td data-label="Nazwa">${produkt.nazwa}</td>
                    <td data-label="Klient">${klientDisplay}</td>
                    <td data-label="Ilość (szt.)" class="num">${iloscWSztukach}</td>
                    <td data-label="Ilość (L)" class="num">${iloscWLitrach}</td>
                    <td data-label="Ostatnia zmiana" class="date-col">${lastChange}</td>
                    <td data-label="Akcje" class="actions-col">
                        <div class="row-action">
                            <button type="button" class="row-action-btn" data-action="menu" aria-label="Akcje">⋯</button>
                        </div>
                    </td>
                </tr>`;
        }).join('');
        magazynLista.innerHTML = rows || emptyRowHtml;
        updateSortButtons();
    };

    const refreshMagazynFilters = () => {
        if (!magazynFilterClient || !magazynFilterOilType || !magazynFilterContainer) return;
        const prevClient = magazynFilterClient.value;
        const prevOilType = magazynFilterOilType.value;
        const prevContainer = magazynFilterContainer.value;
        const clients = new Set();
        const productTypes = new Set();
        const containers = new Set();
        wszystkieProdukty.forEach(item => {
            clients.add(normalizeClientName(item.klient));
            const { pojemnosc } = parseOilMeta(item);
            const productType = resolveWarehouseType(item);
            if (productType) productTypes.add(productType);
            if (pojemnosc) containers.add(String(pojemnosc));
        });
        const clientOptions = [''].concat([...clients].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pl')));
        magazynFilterClient.innerHTML = clientOptions.map(val => `<option value="${val}">${val || 'Wszyscy'}</option>`).join('');
        const typeOptions = [''].concat([...productTypes].filter(Boolean).sort());
        magazynFilterOilType.innerHTML = typeOptions.map(val => `<option value="${val}">${val || 'Wszystkie'}</option>`).join('');
        const containerOptions = [''].concat([...containers].filter(Boolean).sort((a, b) => Number(a) - Number(b)));
        magazynFilterContainer.innerHTML = containerOptions.map(val => `<option value="${val}">${val ? `${val} L` : 'Wszystkie'}</option>`).join('');
        if (clientOptions.includes(prevClient)) magazynFilterClient.value = prevClient;
        if (typeOptions.includes(prevOilType)) magazynFilterOilType.value = prevOilType;
        if (containerOptions.includes(prevContainer)) magazynFilterContainer.value = prevContainer;
        syncOilToolOptions();
    };

    const openProductDetailsModal = (produkt, operation = 'add') => {
        if (!produkt || !productDetailsModal) return;
        activeWarehouseProduct = produkt;
        const jestOlejem = Boolean(produkt.jestOlejem);
        const { pojemnosc } = parseOilMeta(produkt);
        const iloscFormatowana = formatujIloscMagazynu(produkt.ilosc);
        const litersValue = jestOlejem && pojemnosc ? (Number(produkt.ilosc) * pojemnosc) : null;
        if (productEditId) productEditId.value = produkt.id;
        if (productEditIndex) productEditIndex.value = produkt.index || '';
        if (productEditName) productEditName.value = produkt.nazwa || '';
        if (productEditClient) productEditClient.value = normalizeClientName(produkt.klient) === 'Brak' ? '' : produkt.klient;
        if (productCurrentQty) productCurrentQty.textContent = iloscFormatowana;
        if (productCurrentLiters) productCurrentLiters.textContent = litersValue === null ? '—' : `${litersValue.toFixed(2)} L`;
        if (productLastChange) productLastChange.textContent = formatWarehouseDate(produkt.updatedAt || produkt.createdAt);
        if (productChangeQtyInput) {
            productChangeQtyInput.value = '';
            productChangeQtyInput.step = jestOlejem ? '0.01' : '1';
            productChangeQtyInput.placeholder = jestOlejem ? 'np. 0.5' : 'np. 2';
        }
        if (productChangeUnit) productChangeUnit.textContent = 'szt';
        qtyToggleButtons?.forEach(btn => btn.classList.toggle('is-active', btn.dataset.op === operation));
        stockChangeOperation = operation;
        openModal(productDetailsModal);
    };

    const getProductById = (id) => wszystkieProdukty.find(p => p.id === id);

    let magazynMenuPortal = null;
    let magazynMenuState = { productId: null, trigger: null };

    const buildMagazynMenuItems = (produkt) => {
        const items = [
            { action: 'details', label: 'Szczegóły' },
            { action: 'add', label: 'Dodaj' },
            { action: 'remove', label: 'Zdejmij' }
        ];
        if (produkt?.jestOlejem) {
            items.push(
                { action: 'add-oil', label: 'Dodaj olej' },
                { action: 'remove-oil', label: 'Zdejmij olej' }
            );
        }
        return items;
    };

    const ensureMagazynMenuPortal = () => {
        if (magazynMenuPortal) return magazynMenuPortal;
        const menu = document.createElement('div');
        menu.className = 'row-action-menu row-action-menu--portal';
        menu.setAttribute('role', 'menu');
        menu.style.display = 'none';
        menu.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            const produkt = getProductById(magazynMenuState.productId);
            if (!produkt) return;
            closeMagazynRowMenu();
            if (action === 'details') {
                openProductDetailsModal(produkt, 'add');
                return;
            }
            if (action === 'add' || action === 'add-oil') {
                openProductDetailsModal(produkt, 'add');
                return;
            }
            if (action === 'remove' || action === 'remove-oil') {
                openProductDetailsModal(produkt, 'remove');
            }
        });
        document.body.appendChild(menu);
        magazynMenuPortal = menu;
        return menu;
    };

    const closeMagazynRowMenu = () => {
        if (!magazynMenuPortal) return;
        magazynMenuPortal.style.display = 'none';
        magazynMenuPortal.style.left = '';
        magazynMenuPortal.style.top = '';
        magazynMenuPortal.style.visibility = '';
        magazynMenuState = { productId: null, trigger: null };
    };

    const positionMagazynMenu = (menu, trigger) => {
        const rect = trigger.getBoundingClientRect();
        const spacing = 8;
        menu.style.visibility = 'hidden';
        menu.style.display = 'grid';
        const menuRect = menu.getBoundingClientRect();
        let top = rect.bottom + spacing;
        let left = rect.right - menuRect.width;
        if (top + menuRect.height > window.innerHeight - spacing) {
            top = rect.top - menuRect.height - spacing;
        }
        if (left < spacing) {
            left = spacing;
        }
        if (left + menuRect.width > window.innerWidth - spacing) {
            left = window.innerWidth - menuRect.width - spacing;
        }
        menu.style.top = `${Math.max(spacing, top)}px`;
        menu.style.left = `${Math.max(spacing, left)}px`;
        menu.style.visibility = 'visible';
    };

    const openMagazynRowMenu = (trigger, produkt) => {
        if (!trigger || !produkt) return;
        const menu = ensureMagazynMenuPortal();
        const items = buildMagazynMenuItems(produkt);
        menu.innerHTML = items.map(item => `<button type="button" data-action="${item.action}">${item.label}</button>`).join('');
        magazynMenuState = { productId: produkt.id, trigger };
        positionMagazynMenu(menu, trigger);
    };

    const closeRowActionMenus = (except = null) => {
        if (magazynTable) {
            magazynTable.querySelectorAll('.row-action').forEach(menu => {
                if (menu !== except) menu.classList.remove('is-open');
            });
        }
        closeMagazynRowMenu();
    };

    const handleMagazynRowClick = (event) => {
        const tr = event.target.closest('tr');
        if (!tr || !tr.dataset.id) return;
        const produkt = getProductById(tr.dataset.id);
        if (!produkt) return;

        const actionButton = event.target.closest('[data-action]');
        if (actionButton) {
            const action = actionButton.dataset.action;
            if (action === 'menu') {
                closeRowActionMenus();
                openMagazynRowMenu(actionButton, produkt);
                return;
            }
            closeRowActionMenus();
            if (action === 'details') {
                openProductDetailsModal(produkt, 'add');
                return;
            }
            if (action === 'add' || action === 'add-oil') {
                openProductDetailsModal(produkt, 'add');
                return;
            }
            if (action === 'remove' || action === 'remove-oil') {
                openProductDetailsModal(produkt, 'remove');
                return;
            }
        }

        closeRowActionMenus();
        openProductDetailsModal(produkt, 'add');
    };

    const updateStockOperation = (op) => {
        stockChangeOperation = op;
        qtyToggleButtons?.forEach(btn => btn.classList.toggle('is-active', btn.dataset.op === op));
    };

    const handleProductEditSubmit = async (event) => {
        event.preventDefault();
        if (!productEditId) return;
        const docId = productEditId.value;
        const index = productEditIndex?.value.trim();
        const nazwa = productEditName?.value.trim();
        const klient = productEditClient?.value.trim();
        if (!index || !nazwa) { alert('Index i nazwa są wymagane.'); return; }
        const duplicate = wszystkieProdukty.find(p => p.id !== docId && (p.index || '').toLowerCase() === index.toLowerCase());
        if (duplicate) { alert('Index musi być unikalny.'); return; }
        try {
            await updateDoc(doc(db, "magazyn", docId), {
                index,
                nazwa,
                klient: klient || '---',
                updatedAt: new Date()
            });
        } catch (e) {
            console.error("Błąd aktualizacji produktu: ", e);
            alert(`Wystąpił błąd: ${e.message || e}`);
        }
    };

    const handleStockChange = async (operation) => {
        if (!productEditId || !productChangeQtyInput) return;
        const docId = productEditId.value;
        const changeQty = Number(productChangeQtyInput.value);
        if (!Number.isFinite(changeQty) || changeQty <= 0) { alert("Ilość musi być dodatnią liczbą."); return; }
        try {
            await adjustWarehouseStock({ docId, changeQty, operation });
            if (productDetailsModal) {
                const updated = getProductById(docId);
                if (updated) openProductDetailsModal(updated, operation);
            }
        } catch (e) {
            console.error("Błąd transakcji: ", e);
            alert(`Wystąpił błąd: ${e.message || e}`);
        }
    };

    const handleProductDelete = async () => {
        if (!productEditId) return;
        const docId = productEditId.value;
        if (!docId) return;
        if (confirm("Na pewno usunąć produkt?")) {
            await deleteDoc(doc(db, "magazyn", docId));
            if (productDetailsModal) hideModal(productDetailsModal);
        }
    };

    const applyStockData = (products = [], { render = true, status = 'ready' } = {}) => {
        wszystkieProdukty = Array.isArray(products) ? products : [];
        hasLoadedStockOnce = true;
        stockStatus = status;
        if (status === 'ready') {
            void ensureDefaultStockItems(wszystkieProdukty);
        }
        if (render) {
            refreshMagazynFilters();
            renderMagazynSummary();
            renderMagazynTable();
            renderMagazynWModalu();
        }
    };

    function wyswietlMagazyn() {
        if (!magazynLista) return;
        stockStatus = 'loading';
        hasLoadedStockOnce = false;
        renderMagazynSummary();
        renderMagazynTable();
        onSnapshot(query(collection(db, "magazyn"), orderBy("createdAt", "desc")), (snapshot) => {
            if (snapshot.empty) {
                applyStockData([]);
                return;
            }
            const products = snapshot.docs.map((docSnap) => {
                const produkt = docSnap.data();
                return {
                    ...produkt,
                    id: docSnap.id,
                    ilosc: wartoscLiczbowa(produkt.ilosc),
                    pojemnosc: wartoscLiczbowa(produkt.pojemnosc),
                    jestOlejem: Boolean(produkt.jestOlejem)
                };
            });
            applyStockData(products);
        }, (error) => {
            console.error('Błąd ładowania magazynu:', error);
            applyStockData([], { status: 'error' });
        });
    }

   // --- PODPIĘCIE EVENTÓW ---
    if (pulpitQuickActionsContainer) pulpitQuickActionsContainer.addEventListener('click', handleQuickActionClick);
    if (pulpitWeeklyContainer) pulpitWeeklyContainer.addEventListener('click', handleWeeklyMissingClick);
    if (pulpitActivityList) pulpitActivityList.addEventListener('click', handleActivityClick);
    if (klientForm) klientForm.addEventListener('submit', dodajKlienta);
    if (klientAddBtn) {
        klientAddBtn.addEventListener('click', () => {
            openClientDrawer(null, 'add');
        });
    }
    if (listaKlientowDiv) listaKlientowDiv.addEventListener('click', obslugaListyKlientow);

    if (maszynaForm) maszynaForm.addEventListener('submit', dodajMaszyne);
    if (maszynaAddBtn) {
        maszynaAddBtn.addEventListener('click', () => {
            maszynaForm?.reset();
            addMachineClientCombobox?.clear();
            setMachineDrawerMode('add');
        });
    }
    if (listaMaszynDiv) listaMaszynDiv.addEventListener('click', obslugaListyMaszyn);

    // ZLECENIA
    if (zlecenieForm) zlecenieForm.addEventListener('submit', dodajZlecenie);
    if (zlecenieKlientIdInput) {
        zlecenieKlientIdInput.addEventListener('change', aktualizujMaszynyDlaZlecenia);
        zlecenieKlientIdInput.dispatchEvent(new Event('change'));
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
                .filter(z => z.status === 'ukończone' && resolveServiceDate(z) && resolveServiceDate(z).startsWith(miesiac))
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
    if (bulkItemsInput) bulkItemsInput.addEventListener('input', renderBulkPreview);
    if (magazynLista) magazynLista.addEventListener('click', handleMagazynRowClick);
    if (magazynSearchInput) magazynSearchInput.addEventListener('input', renderMagazynTable);
    if (magazynFilterClient) magazynFilterClient.addEventListener('change', renderMagazynTable);
    if (magazynFilterOilType) magazynFilterOilType.addEventListener('change', renderMagazynTable);
    if (magazynFilterContainer) magazynFilterContainer.addEventListener('change', renderMagazynTable);
    if (magazynTable) {
        magazynTable.addEventListener('click', (event) => {
            const btn = event.target.closest('.sort-btn');
            if (!btn) return;
            const key = btn.dataset.sort;
            if (!key) return;
            if (magazynSort.key === key) {
                magazynSort.dir = magazynSort.dir === 'asc' ? 'desc' : 'asc';
            } else {
                magazynSort = { key, dir: 'asc' };
            }
            renderMagazynTable();
        });
    }
    if (magazynAddBtn) magazynAddBtn.addEventListener('click', () => { resetProductAddForm(); openModal(productAddModal); });
    if (magazynBulkBtn) magazynBulkBtn.addEventListener('click', () => { openModal(bulkAddModal); });
    if (magazynOilToolsBtn) {
        magazynOilToolsBtn.addEventListener('click', () => {
            syncOilToolOptions();
            setOilToolsTab('converter');
            openDrawer(oilToolsDrawer);
        });
    }
    if (itemIsOilCheckbox) {
        itemIsOilCheckbox.addEventListener('change', () => setOilFieldsVisibility(itemIsOilCheckbox.checked));
    }
    if (itemProductTypeSelect) {
        itemProductTypeSelect.addEventListener('change', () => {
            if (!magazynForm) return;
            if (itemProductTypeSelect.value !== PRODUCT_TYPE_ZMYWACZ) return;
            const indexInput = magazynForm['item-index'];
            const nameInput = magazynForm['item-name'];
            if (indexInput && !indexInput.value) indexInput.value = PRODUCT_TYPE_ZMYWACZ;
            if (nameInput && !nameInput.value) nameInput.value = 'Zmywacz';
        });
    }
    if (productDetailsCloseButton && productDetailsModal) {
        productDetailsCloseButton.onclick = () => { hideModal(productDetailsModal); };
    }
    if (productAddCloseButton && productAddModal) {
        productAddCloseButton.onclick = () => { hideModal(productAddModal); };
    }
    if (bulkAddCloseButton && bulkAddModal) {
        bulkAddCloseButton.onclick = () => { hideModal(bulkAddModal); };
    }
    qtyToggleButtons?.forEach(btn => {
        btn.addEventListener('click', () => updateStockOperation(btn.dataset.op || 'add'));
    });
    if (productEditForm) productEditForm.addEventListener('submit', handleProductEditSubmit);
    if (productAddBtn) productAddBtn.addEventListener('click', () => handleStockChange('add'));
    if (productRemoveBtn) productRemoveBtn.addEventListener('click', () => handleStockChange('remove'));
    if (productDeleteBtn) productDeleteBtn.addEventListener('click', handleProductDelete);
    if (productChangeQtyInput) {
        productChangeQtyInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                handleStockChange(stockChangeOperation || 'add');
            }
        });
    }

    if (modalMagazynLista) modalMagazynLista.addEventListener('click', dodajCzescDoZlecenia);
    if (partsToRemoveList) partsToRemoveList.addEventListener('click', obslugaListyCzesci);

    if (summaryYearSelect) {
        summaryYearSelect.addEventListener('change', () => {
            applySelectedYear(summaryYearSelect.value);
        });
    }

    if (vacationYearSelect) {
        vacationYearSelect.addEventListener('change', () => {
            applySelectedYear(vacationYearSelect.value);
        });
    }

    if (vacationAllowanceSaveBtn) {
        vacationAllowanceSaveBtn.addEventListener('click', async () => {
            const totalDays = Number(vacationAllowanceInput?.value) || DEFAULT_VACATION_ALLOWANCE;
            await setVacationAllowance(selectedYear, totalDays);
            await renderVacationSummary();
        });
    }

    if (vacationAdjustmentForm) {
        vacationAdjustmentForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const days = Number(vacationAdjustmentDaysInput?.value);
            if (!Number.isFinite(days) || days === 0) { alert('Podaj liczbę dni (może być dodatnia lub ujemna).'); return; }
            await addAdjustment(selectedYear, {
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
            await removeAdjustment(target.dataset.id, selectedYear);
            await renderVacationSummary();
        });
    }

    if (annualSummaryContainer) {
        annualSummaryContainer.addEventListener('click', (event) => {
            const toggle = event.target.closest('.year-toggle');
            if (!toggle) return;
            const year = Number(toggle.dataset.year);
            if (!Number.isFinite(year)) return;
            const section = annualSummaryContainer.querySelector(`.year-section[data-year="${year}"]`);
            if (!section) return;
            const isOpen = section.classList.toggle('is-open');
            toggle.setAttribute('aria-expanded', String(isOpen));
            const chevron = toggle.querySelector('.chevron');
            if (chevron) chevron.textContent = isOpen ? '▼' : '▶';
            if (isOpen) {
                openSummaryYears.add(year);
            } else {
                openSummaryYears.delete(year);
            }
            persistOpenYears([...openSummaryYears]);
        });
    }
    document.addEventListener('click', (event) => {
        if (!event.target.closest('.row-action') && !event.target.closest('.row-action-menu--portal')) {
            closeRowActionMenus();
            closeClientActionMenus();
        }
        const exportTrigger = event.target.closest('.export-trigger');
        const exportItem = event.target.closest('.export-menu-item');
        const openMenus = document.querySelectorAll('.export-menu.is-open');
        const closeMenus = (except) => {
            openMenus.forEach(menu => {
                if (menu !== except) menu.classList.remove('is-open');
            });
        };
        if (exportTrigger) {
            const menu = exportTrigger.closest('.export-menu');
            if (!menu) return;
            const isOpen = menu.classList.toggle('is-open');
            exportTrigger.setAttribute('aria-expanded', String(isOpen));
            closeMenus(menu);
            return;
        }
        if (exportItem) {
            const menu = exportItem.closest('.export-menu');
            const trigger = menu?.querySelector('.export-trigger');
            const year = Number(trigger?.dataset.exportYear);
            const action = exportItem.dataset.exportAction;
            if (menu) menu.classList.remove('is-open');
            if (action) runYearExport(action, year);
            return;
        }
        if (openMenus.length) closeMenus();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeMagazynRowMenu();
        }
    });

    if (vacationTabs) {
        setActiveVacationTab(readVacationTabFromStorage());
        vacationTabs.addEventListener('click', (event) => {
            const tabBtn = event.target.closest('[data-vacation-tab]');
            if (!tabBtn) return;
            setActiveVacationTab(tabBtn.dataset.vacationTab);
        });
    }

    if (plannedLeaveCancelBtn) {
        plannedLeaveCancelBtn.addEventListener('click', () => {
            clearPlannedLeaveForm();
        });
    }

    if (plannedLeaveForm) {
        setPlannedLeaveFormState(null);
        plannedLeaveForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const startDate = plannedLeaveStartInput?.value || '';
            const endDate = plannedLeaveEndInput?.value || '';
            const startParsed = toDateSafe(startDate);
            const endParsed = toDateSafe(endDate);
            if (!startParsed || !endParsed) { alert('Wybierz poprawny zakres dat.'); return; }
            if (startParsed > endParsed) { alert('Data końcowa nie może być wcześniejsza niż początkowa.'); return; }
            const payload = {
                year: Number(selectedYear),
                startDate,
                endDate,
                type: plannedLeaveTypeSelect?.value || 'Urlop planowany',
                note: plannedLeaveNoteInput?.value || '',
                countWorkingDays: Boolean(plannedLeaveWorkingDaysInput?.checked)
            };
            if (plannedLeaveEditId) {
                await updateDoc(doc(db, 'plannedLeave', plannedLeaveEditId), {
                    ...payload,
                    updatedAt: serverTimestamp()
                });
            } else {
                await addDoc(getPlannedLeaveCollection(), { ...payload, createdAt: serverTimestamp() });
            }
            clearPlannedLeaveForm();
            await refreshPlannedLeaveEntries();
        });
    }

    if (plannedLeaveList) {
        plannedLeaveList.addEventListener('click', async (event) => {
            const btn = event.target.closest('[data-action]');
            if (!btn?.dataset?.id) return;
            const entry = plannedLeaveEntries.find(item => item.id === btn.dataset.id);
            if (!entry) return;
            if (btn.dataset.action === 'edit') {
                setPlannedLeaveFormState(entry);
            } else if (btn.dataset.action === 'delete') {
                if (!confirm('Usunąć zaplanowany urlop?')) return;
                await deleteDoc(doc(db, 'plannedLeave', entry.id));
                await refreshPlannedLeaveEntries();
            }
        });
    }

    if (oilToolsTabs) {
        oilToolsTabs.forEach(btn => {
            btn.addEventListener('click', () => setOilToolsTab(btn.dataset.drawerTab));
        });
    }
    if (oilConverterLitersInput) oilConverterLitersInput.addEventListener('input', () => updateOilConverter(oilConverterLitersInput));
    if (oilConverterUnitsInput) oilConverterUnitsInput.addEventListener('input', () => updateOilConverter(oilConverterUnitsInput));
    if (oilConverterContainer) {
        oilConverterContainer.addEventListener('change', () => {
            if (oilConverterLitersInput?.value) {
                updateOilConverter(oilConverterLitersInput);
            } else if (oilConverterUnitsInput?.value) {
                updateOilConverter(oilConverterUnitsInput);
            }
        });
    }
    if (oilQuickSubmitBtn) oilQuickSubmitBtn.addEventListener('click', handleOilQuickAdd);

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
    if (maszynaClientFilterSelect) maszynaClientFilterSelect.addEventListener('change', wyswietlMaszyny);
    if (zlecenieSearchInput) {
        zlecenieSearchInput.addEventListener('input', () => {
            ordersFilterMode = null;
            wyswietlZleceniaThrottled();
        });
    }

    // EDYCJE (modale)
    if (editKlientForm) editKlientForm.addEventListener('submit', zapiszEdycjeKlienta);
    if (editMaszynaForm) editMaszynaForm.addEventListener('submit', zapiszEdycjeMaszyny);
    if (editZlecenieForm) editZlecenieForm.addEventListener('submit', zapiszEdycjeZlecenia);

    if (clientViewEditBtn) {
        clientViewEditBtn.addEventListener('click', () => {
            if (!selectedClientId) return;
            openClientDrawer(selectedClientId, 'edit');
        });
    }
    if (clientEditCancelBtn) {
        clientEditCancelBtn.addEventListener('click', () => {
            setClientDrawerMode('view');
        });
    }

    if (clientDeleteBtn) clientDeleteBtn.addEventListener('click', usunKlienta);
    if (machineDeleteBtn) machineDeleteBtn.addEventListener('click', usunMaszyne);
    if (detailsZlecenieCloseButton && detailsZlecenieModal) {
        detailsZlecenieCloseButton.onclick = () => { hideModal(detailsZlecenieModal); };
    }
    if (editZlecenieCloseButton && editZlecenieModal) {
        editZlecenieCloseButton.onclick = () => { hideModal(editZlecenieModal); };
    }
    if (machineHistoryCloseButton && machineHistoryModal) {
        machineHistoryCloseButton.onclick = () => { hideModal(machineHistoryModal); };
    }

    [clientDrawer, machineDrawer, oilToolsDrawer].forEach((drawer) => {
        drawer?.querySelectorAll('[data-drawer-close]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (drawer === clientDrawer) {
                    closeClientDrawer();
                    return;
                }
                closeDrawer(drawer);
            });
        });
    });

    // Klik poza modal zamyka go
    window.onclick = (event) => {
        if (trackedModals.includes(event.target)) {
            hideModal(event.target);
        }
    };

    const loadInitialData = async () => {
        const safeLoad = async (label, loader) => {
            try {
                const data = await loader();
                return { ok: true, data };
            } catch (error) {
                console.error(`[bootstrap] nie udało się załadować ${label}`, error);
                return { ok: false, data: [] };
            }
        };

        const [clients, machines, orders, stock, dayEntries, activity] = await Promise.all([
            safeLoad('klientów', async () => {
                const snapshot = await getDocs(query(collection(db, "klienci"), orderBy("nazwa")));
                return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
            }),
            safeLoad('maszyn', async () => {
                const snapshot = await getDocs(query(collection(db, "maszyny"), orderBy("klientNazwa")));
                return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
            }),
            safeLoad('zleceń', async () => {
                const snapshot = await getDocs(query(collection(db, "zlecenia"), orderBy("createdAt", "desc")));
                return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
            }),
            safeLoad('magazynu', async () => {
                const snapshot = await getDocs(query(collection(db, "magazyn"), orderBy("createdAt", "desc")));
                return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
            }),
            safeLoad('ewidencji czasu', async () => {
                const snapshot = await getDocs(collection(db, "godziny_pracy"));
                return snapshot.docs.map(docSnap => ({ id: docSnap.id, data: docSnap.data() }));
            }),
            safeLoad('aktywności', async () => {
                const snapshot = await getDocs(query(collection(db, "activity"), orderBy("timestamp", "desc"), limit(20)));
                return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
            })
        ]);

        return { clients, machines, orders, stock, dayEntries, activity };
    };

    const aggregateInitialData = (loaded) => {
        applyClientsData(loaded.clients.data, { render: false });
        applyMachinesData(loaded.machines.data, { render: false });
        applyOrdersData(loaded.orders.data, { render: false });

        const normalizedStock = loaded.stock.data.map((produkt) => ({
            ...produkt,
            ilosc: wartoscLiczbowa(produkt.ilosc),
            pojemnosc: wartoscLiczbowa(produkt.pojemnosc),
            jestOlejem: Boolean(produkt.jestOlejem)
        }));
        applyStockData(normalizedStock, { render: false, status: loaded.stock.ok ? 'ready' : 'error' });

        applyDayEntriesData(loaded.dayEntries.data, { render: false });
        applyActivityData(loaded.activity.data, { render: false, status: loaded.activity.ok ? 'ready' : 'error' });
        rebuildCalendarDecorations();
        updateUnfinishedSummary();
        selectedYearNeedsRefresh = true;
    };

    const renderInitialViews = async (loaded) => {
        if (loaded.clients.ok) {
            wyswietlKlientow();
        } else {
            renderModuleError(listaKlientowDiv, 'Nie udało się załadować klientów.');
        }
        if (loaded.machines.ok) {
            wyswietlMaszyny();
        } else {
            renderModuleError(listaMaszynDiv, 'Nie udało się załadować maszyn.');
        }
        if (loaded.orders.ok) {
            wyswietlZlecenia();
        } else {
            const ordersContainer = aktywneZleceniaLista || ukonczoneZleceniaLista;
            renderModuleError(ordersContainer, 'Nie udało się załadować zleceń.');
        }
        renderMagazynSummary();
        renderMagazynTable();
        renderMagazynWModalu();
        await odswiezPodsumowania();
        renderPulpit();
        przeprowadzMigracjeStartEnd().catch(err => console.error('[Migracja start/end] Błąd aktualizacji:', err));
    };

    const initModules = () => {
        try { nasluchujNaUrlopy(); } catch (error) { console.error('[urlopy] init error', error); }
        safeInitModule('clients', listaKlientowDiv, () => nasluchujNaKlientow(), 'Moduł klientów niedostępny.');
        safeInitModule('machines', listaMaszynDiv, () => nasluchujNaMaszyny(), 'Moduł maszyn niedostępny.');
        safeInitModule('orders', aktywneZleceniaLista || ukonczoneZleceniaLista, () => nasluchujNaZlecenia(), 'Moduł zleceń niedostępny.');
        safeInitModule('stock', magazynLista || magazynTable || magazynSummaryBox, () => wyswietlMagazyn(), 'Moduł magazynu niedostępny.');
        safeInitModule('summary', zakonczoneSummaryContainer || annualSummaryContainer || l4SummaryContainer, () => odswiezPodsumowania(), 'Moduł podsumowań niedostępny.');
        safeInitModule('activity', pulpitActivityList, () => nasluchujNaActivity(), 'Moduł aktywności niedostępny.');
        try {
            wyswietlWpisyKalendarza();
        } catch (error) {
            console.error('[calendar-data] init error', error);
        }
    };

    // --- INICJALIZACJA (MUSI BYĆ WEWNĄTRZ initializeApp) ---
    moveOrdersSearchBetweenSections();
    bindCalendarToolbar();
    bindDayPanelEvents();
    updateCalendarToolbarState();
    applyDayPanelState();
    renderDayPanel();
    wyswietlPrzejazdy(); // puste – OK

    const bootstrapApp = async () => {
        const initialData = await loadInitialData();
        aggregateInitialData(initialData);
        await renderInitialViews(initialData);
        bootstrapReady = true;
        if (pendingCalendarInit) {
            pendingCalendarInit = false;
            void initCalendarModule('bootstrap');
        }
        initModules();
        console.info('Subscriptions started: clients/machines/orders/stock/dayEntries');
    };

    void bootstrapApp();

} // koniec initializeApp()
