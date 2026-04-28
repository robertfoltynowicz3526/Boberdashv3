import { db, auth } from './firebase-config.js';
import { collection, query, orderBy, onSnapshot, doc, deleteDoc, updateDoc, getDoc, runTransaction, addDoc, setDoc, where, getDocs, serverTimestamp, startAt, endBefore, limit, deleteField } from "firebase/firestore";
import Papa from 'papaparse';
import './styles.css';
import './styles/desktop-only.css';
import './styles/calendar-fixes.css';
import './styles/calendar.css';
import { initCalendar, updateCalendarData } from './calendar/initCalendar.js';
import { aggregateDayData, computeDayTotals, configureDayTotals } from './calendar/computeDayTotals.js';
import { aggregateMonthlyDriveHours, getMonthlyDriveHoursFromCalendar } from './calendar/driveHoursAggregation.js';
import { loadYearReportingData } from './reporting/reportingData.js';
import { computeYearReport } from './reporting/reportingAggregation.js';
import { exportYearlyOrdersCsv, exportYearlyPdf, exportYearlySummaryCsv } from './reporting/reportingRender.js';
import { createNotesDataLayer, mapNoteDoc, NOTE_LINK_TYPES } from './notes/notesData.js';
import { buildNotesViewModel, buildNoteOrderOptionsModel, filterNoteOrderOptions } from './notes/notesAggregation.js';
import { buildNoteTxt, renderNotesListView } from './notes/notesRender.js';
import { aggregateMonthStats, createMonthStatsCache } from './dashboard/monthStatsAggregation.js';
import { renderMonthStats, renderMonthStatsSkeleton } from './dashboard/monthStatsRender.js';
import { normalizeDateOnly } from './orders/orderDates.js';
import {
    getFinanceMonthsForYear,
    aggregateAgroEffectYear,
    aggregateOvertimeYear,
    getFinanceYearOptions
} from './finance/financeAggregation.js';
import {
    isFinanceUnlockedInSession,
    setFinanceUnlockedInSession,
    verifyFinancePassword,
    loadAgroEffectYear,
    saveAgroEffectMonth,
    listOvertimeEntriesForYear,
    addOvertimeEntry,
    updateOvertimeEntry,
    deleteOvertimeEntry
} from './finance/financeData.js';
import {
    renderAgroEffectRowsHtml,
    renderAgroEffectTotalsHtml,
    renderOvertimeMonthlyCardsHtml,
    renderOvertimeYearSummaryHtml,
    renderOvertimeClientTotalsHtml
} from './finance/financeRender.js';
import {
    buildInvoiceStatsByMonth,
    normalizeMonthKey,
    normalizeOrderForBilling,
    resolveOrderSettlementMonth,
    resolveOrderBillingMonth,
    getOrderInvoicedHours,
    getOrderGrossAmount,
    getOrderNetAmount,
    computeOrderAmounts,
    isOrderClosed
} from './orders/invoiceStats.js';

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


const deriveBillingMonthFromCompletionDate = (completionDate) => {
    const normalized = normalizeDateOnly(completionDate || '');
    return normalized ? normalized.slice(0, 7) : '';
};

const normalizeHalfDayValue = (value, { min = 0, fallback = 0 } = {}) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    const rounded = Math.round(num * 2) / 2;
    return Math.max(min, rounded);
};

const formatDaysValue = (value) => {
    const normalized = normalizeHalfDayValue(value, { min: 0, fallback: 0 });
    if (normalized === 1) return '1 dzień';
    return `${normalized.toFixed((normalized % 1) === 0 ? 0 : 1)} dni`;
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
    const MACHINE_TYPE_OPTIONS = ['Traktor', 'Kombajn', 'Prasa', 'Sieczkarnia', 'Opryskiwacz', 'Inna'];
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
    const BILLING_MONTH_MIGRATION_KEY = 'migrationBillingMonthFromCompletionDate.v1';
    const ORDER_DEDUP_MIGRATION_KEY = 'ordersDedupByRootId.v1';
    const CALENDAR_VIEW_STORAGE_KEY = 'lastView';
    const CALENDAR_VIEW_STORAGE_LEGACY_KEY = 'lastCalendarView';
    const CALENDAR_DATE_STORAGE_KEY = 'lastFocusedDate';
    const CALENDAR_RETURN_VIEW_KEY = 'calendarReturnView';
    const CALENDAR_RETURN_DATE_KEY = 'calendarReturnDate';
    const CALENDAR_DAYGRID_VIEWS = new Set(['dayGridDay', 'dayGridWeek', 'dayGridMonth']);
    const SUMMARY_INVOICED_DEBUG_MONTH = import.meta.env.DEV ? '2026-02' : '';
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
        const months = lastMonthsInclusive(y, m, 3);
        const vals = months.map(({ y, m }) => getFHfromSummary(y, m));
        const max = Math.max(...vals, 1);
        const labels = months.map(({ y, m }) => `${String(m).padStart(2, '0')}.${String(y).slice(-2)}`);
        const curr = vals[2];
        const prev = vals[1];
        const deltaPct = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
        host.innerHTML = `
    <div class="fh3m fh3m--trend">
      <div class="bars">
        ${vals.map((v, i) => `<div class="bar ${i < 2 ? 'dim' : ''}" style="height:${(v / max) * 100}%;" title="${labels[i]}: ${v.toFixed(1)} h"></div>`).join('')}
      </div>
      <div class="legend">
        <span>${labels[0]}</span><span>${labels[1]}</span><span>${labels[2]}</span>
      </div>
      <p class="trend-note">Zmiana vs poprzedni miesiąc: <span class="delta ${deltaPct >= 0 ? 'up' : 'down'}">${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(0)}%</span></p>
    </div>`;
    }
    const stripEwidencjaPrefix = (title = '') => (title || '').replace(/^Ewidencja dnia\s*[:•-]?\s*/i, '');
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
    const NOTES_STORAGE_KEY = 'notesActivityCollapsed';
    function obliczAbsorpcja(wyfakturowaneGodziny, przepracowaneGodziny) {
        const billed = Number(wyfakturowaneGodziny || 0);
        const worked = Number(przepracowaneGodziny || 0);
        if (billed <= 0 || worked <= 0) return 0;
        return (billed / worked) * 100;
    }
    const ABSORPTION_MONTHLY_BASE_HOURS = 168;
    function obliczAbsorpcjaDoBazy(wyfakturowaneGodziny, baseHours) {
        const billed = Number(wyfakturowaneGodziny || 0);
        const base = Number(baseHours || 0);
        if (billed <= 0 || base <= 0) return 0;
        return (billed / base) * 100;
    }
    function getElapsedMonthsForYearAbsorption(year, now = new Date()) {
        const targetYear = Number(year);
        if (!Number.isFinite(targetYear)) return 0;
        const currentYear = now.getFullYear();
        if (targetYear < currentYear) return 12;
        if (targetYear > currentYear) return 0;
        return now.getMonth();
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
    let summaryBillingMode = 'calendar';
    let availableSummaryYears = [currentYear];
    let openSummaryYears = new Set();
    window.ostatnieZestawienieMiesieczne = ostatnieZestawienieMiesieczne;
    let _wszystkieKlienciCache = [], _wszystkieMaszynyCache = [], _wszystkieZleceniaCache = []; // Cache z Firebase
    const NISKI_STAN_MAGAZYNOWY = 5;
    let recentActivity = [];
    let weeklyMissingDays = [];
    let activityStatus = 'idle';
    let allNotes = [];
    let notesStatus = 'idle';
    let selectedNoteId = null;
    let notesActivityCollapsed = true;
    let hasEnsuredDefaultStock = false;
    const monthStatsCache = createMonthStatsCache();
    const invalidateMonthStatsCache = () => monthStatsCache.clear();
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
        const monthRows = width >= 1440 ? 2 : width >= 1024 ? 1 : 1;
        const rows = viewKey === 'month'
            ? monthRows
            : (width >= CALENDAR_BREAKPOINTS.desktop ? 3 : width >= CALENDAR_BREAKPOINTS.laptop ? 2 : 1);
        const shouldLimit = viewKey === 'week' || viewKey === 'month';
        api.setOption('dayMaxEvents', shouldLimit);
        api.setOption('dayMaxEventRows', shouldLimit ? rows : false);
    };

    const CALENDAR_SHELL_MIN_HEIGHT = 420;
    const CALENDAR_SHELL_BOTTOM_GUTTER = 24;
    const syncCalendarShellHeight = () => {
        if (!calendarShell) return;
        if (calendarShell.offsetParent === null) return;
        const rect = calendarShell.getBoundingClientRect();
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || rect.bottom || 0;
        const available = Math.max(viewportHeight - rect.top - CALENDAR_SHELL_BOTTOM_GUTTER, CALENDAR_SHELL_MIN_HEIGHT);
        calendarShell.style.setProperty('--calendar-shell-height', `${Math.round(available)}px`);
        calendarShell.style.setProperty('--calendar-shell-min-height', `${CALENDAR_SHELL_MIN_HEIGHT}px`);
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
    const LOW_STOCK_UNITS_THRESHOLD = 1;
    const LOW_STOCK_OIL_LITERS_DEFAULT_THRESHOLD = 5;
    const LOW_STOCK_OIL_LITERS_BY_CONTAINER = {
        20: 5,
        50: 10,
        55: 10,
        208: 25
    };
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
    let vacationSectionCollapsed = true;
    let l4SectionCollapsed = true;
    let unfinishedDrawerOpen = false;
    let unfinishedSummary = {
        daysWithoutSummary: [],
        ordersWithoutBilling: [],
        plannedLeaveWithoutCalendar: [],
        total: 0
    };
    let unfinishedDrawerView = { mode: 'summary', days: [] };
    let ordersFilterMode = null;
    let expandedActiveOrderIds = new Set();
    let expandedClosedOrderIds = new Set();
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
    const dayLeaveAmountInput = document.getElementById('day-leave-amount');
    const kalendarzPodsumowanieDiv = document.getElementById('kalendarz-podsumowanie');
    const pulpitQuickActionsContainer = document.getElementById('pulpit-quick-actions');
    const pulpitWeeklyContainer = document.getElementById('pulpit-weekly-preview');
    const pulpitActivityList = document.getElementById('pulpit-activity-list');
    const pulpitActivityContainer = document.getElementById('pulpit-activity');
    const pulpitActivityTitle = document.getElementById('pulpit-activity-title');
    const pulpitActivityToggle = document.getElementById('pulpit-activity-toggle');
    const notesListContainer = document.getElementById('notes-list');
    const notesSearchInput = document.getElementById('notes-search');
    const notesFilterType = document.getElementById('notes-filter-type');
    const notesFilterOrder = document.getElementById('notes-filter-order');
    const notesAddBtn = document.getElementById('notes-add-btn');
    const notesQuickCreateInput = document.getElementById('notes-quick-create');
    const notesExportSelectedBtn = document.getElementById('notes-export-selected');
    const notesExportFilteredBtn = document.getElementById('notes-export-filtered');
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
    const assignCloseButton = assignModal ? assignModal.querySelector('.close-button') : null;
    const assignModeSelect = document.getElementById('assign-tryb-select');
    const assignClientGroup = document.getElementById('assign-client-group');
    const assignCancelBtn = document.getElementById('assign-cancel-btn');
    const assignMachineModelInput = document.getElementById('assign-machine-model-text');
    const assignFormError = document.getElementById('assign-form-error');
    const assignTrybHint = document.getElementById('assign-tryb-hint');
    const klientForm = document.getElementById('klient-form');
    const clientAddMachineToggle = document.getElementById('client-add-machine-toggle');
    const clientAddMachineFields = document.getElementById('client-add-machine-fields');
    const clientMachineTypInput = document.getElementById('client-machine-typ');
    const clientMachineModelInput = document.getElementById('client-machine-model');
    const clientMachineSerialInput = document.getElementById('client-machine-serial');
    const clientMachineYearInput = document.getElementById('client-machine-rok');
    const clientMachineMthInput = document.getElementById('client-machine-mth');
    const maszynaTypSelect = document.getElementById('maszyna-typ');
    const editMaszynaTypSelect = document.getElementById('edit-maszyna-typ');
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
    const clientStatsSearchInput = document.getElementById('client-stats-search');
    const clientStatsSortSelect = document.getElementById('client-stats-sort');
    const clientStatsRangeSelect = document.getElementById('client-stats-range');
    const clientStatsSummary = document.getElementById('client-stats-summary');
    const clientStatsTop = document.getElementById('client-stats-top');
    const clientStatsRanking = document.getElementById('client-stats-ranking');
    const clientStatsDetails = document.getElementById('client-stats-details');
    const ordersSummaryControls = document.querySelector('#zakonczone-zlecenia-content .summary-controls');
    const annualSummaryContainer = document.getElementById('annual-summary');
    const quarterlyBonusSummaryContainer = document.getElementById('quarterly-bonus-summary');
    const l4SummaryContainer = document.getElementById('l4-summary');
    const l4SectionToggle = document.getElementById('l4-section-toggle');
    const l4SectionContent = document.getElementById('l4-section-content');
    const l4SectionCounter = document.getElementById('l4-section-counter');
    const summaryYearSelect = document.getElementById('summary-year-select');
    const annualSummaryExportBtn = document.getElementById('annual-summary-export');
    const summaryBillingModeSelect = document.getElementById('summary-billing-mode');
    const vacationYearSelect = document.getElementById('vacation-year');
    const vacationSectionToggle = document.getElementById('vacation-section-toggle');
    const vacationSectionContent = document.getElementById('vacation-section-content');
    const vacationAllowanceInput = document.getElementById('vacation-allowance-input');
    const vacationAllowanceSaveBtn = document.getElementById('vacation-allowance-save');
    const vacationUsedSpan = document.getElementById('vacation-used');
    const vacationRemainingSpan = document.getElementById('vacation-remaining');
    const vacationAdjustmentsTotalSpan = document.getElementById('vacation-adjustments-total');
    const vacationCollapsedRemainingSpan = document.getElementById('vacation-collapsed-remaining');
    const vacationCollapsedUsedSpan = document.getElementById('vacation-collapsed-used');
    const vacationCollapsedPlannedSpan = document.getElementById('vacation-collapsed-planned');
    const vacationCollapsedAdjustmentsSpan = document.getElementById('vacation-collapsed-adjustments');
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
    const plannedLeaveDaysInput = document.getElementById('planned-leave-days');
    const plannedLeaveSubmitBtn = document.getElementById('planned-leave-submit');
    const plannedLeaveCancelBtn = document.getElementById('planned-leave-cancel');
    const plannedLeaveList = document.getElementById('planned-leave-list');
    const plannedLeaveTotalSpan = document.getElementById('planned-leave-total');
    const plannedLeaveTotalPanelSpan = document.getElementById('planned-leave-total-panel');
    const financeView = document.getElementById('finance-view');
    const modalMagazynLista = document.getElementById('modal-magazyn-lista');
    const partsToRemoveList = document.getElementById('parts-to-remove-list');
    const magazynForm = document.getElementById('magazyn-form');
    const magazynLista = document.getElementById('magazyn-lista');
    const magazynTable = document.getElementById('magazyn-table');
    const magazynSearchInput = document.getElementById('magazyn-search-input');
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
    const bulkInsertExampleBtn = document.getElementById('bulk-insert-example');
    const bulkValidCount = document.getElementById('bulk-valid-count');
    const magazynLowStockOnly = document.getElementById('magazyn-low-stock-only');
    const magazynLowStockToggle = document.getElementById('magazyn-low-stock-toggle');
    const magazynClearFiltersBtn = document.getElementById('magazyn-clear-filters-btn');
    const oilConverterPresets = document.getElementById('oil-converter-presets');

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
    let quarterlyBonusExpanded = false;
    let quarterlyBonusHistoryExpanded = false;
    let financeUnlocked = isFinanceUnlockedInSession();
    let financeInnerTab = 'agro';
    let financeYear = 2026;
    let financeOvertimeYear = 2026;
    let financeAgroRowsByMonth = {};
    let financeOvertimeEntries = [];
    let financeOvertimeEditId = null;
    let financeAgroEditingMonth = null;
    let financeAgroDraft = null;
    let financeOvertimeExpandedMonths = new Set();
    let financeOvertimeFormMonth = null;
    const oilToolsTabs = oilToolsDrawer ? oilToolsDrawer.querySelectorAll('[data-drawer-tab]') : [];
    const oilToolsPanels = oilToolsDrawer ? oilToolsDrawer.querySelectorAll('[data-drawer-panel]') : [];
    const oilConverterContainer = document.getElementById('oil-converter-container');
    const oilConverterLitersInput = document.getElementById('oil-converter-liters');
    const oilConverterUnitsInput = document.getElementById('oil-converter-units');
    const oilQuickTypeSelect = document.getElementById('oil-quick-type');
    const oilQuickContainerSelect = document.getElementById('oil-quick-container');
    const oilQuickQuantityInput = document.getElementById('oil-quick-quantity');
    const oilQuickUnitSelect = document.getElementById('oil-quick-unit');
    const oilQuickSubmitBtn = document.getElementById('oil-quick-submit');
    const themeSelect = document.getElementById('theme-select');
    const zakonczoneZleceniaHeader = document.getElementById('zakonczone-zlecenia-header');
    const zlecenieSearchInput = document.getElementById('zlecenie-search-input');
    const kalendarzMultiWrapper = document.getElementById('kalendarz-zlecenia-multi');
    const kalendarzMultiSelect = kalendarzMultiWrapper ? kalendarzMultiWrapper.querySelector('.multi-zlecenie-select') : null;
    const kalendarzMultiHoursInput = kalendarzMultiWrapper ? kalendarzMultiWrapper.querySelector('.multi-zlecenie-fh') : null;
    const kalendarzMultiDriveInput = kalendarzMultiWrapper ? kalendarzMultiWrapper.querySelector('.multi-zlecenie-drive') : null;
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
    const editZlecenieDocId = document.getElementById('edit-zlecenie-doc-id');
    const editZlecenieClientSelect = document.getElementById('edit-zlecenie-client-select');
    const editZlecenieMachineSelect = document.getElementById('edit-zlecenie-machine-select');
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
        if (zakonczoneSummaryContainer) {
            zakonczoneSummaryContainer.innerHTML = `
              <div class="orders-summary-loading" aria-live="polite" aria-busy="true">
                <div class="metric-skeleton"></div>
                <div class="metric-skeleton"></div>
                <div class="metric-skeleton"></div>
                <div class="metric-skeleton"></div>
                <div class="metric-skeleton orders-summary-loading__chart"></div>
              </div>
            `;
        }
        if (annualSummaryContainer) annualSummaryContainer.innerHTML = '<p class="loading-state">Ładowanie podsumowania...</p>';
        if (l4SummaryContainer) l4SummaryContainer.innerHTML = '<p class="loading-state">Ładowanie podsumowania...</p>';
        renderMagazynSummary();
        if (magazynLista && getStockUiState().isStockLoading) {
            magazynLista.innerHTML = '<tr><td colspan="7" class="loading-state">Ładowanie magazynu...</td></tr>';
        }
    };

    setBootstrapLoadingState();
    try { notesActivityCollapsed = localStorage.getItem(NOTES_STORAGE_KEY) !== '0'; } catch (_) { notesActivityCollapsed = true; }

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
        const raw = order.completionDate || order.serviceDate || order.performedAt || order.dataUkonczenia || formatDateForStorage(toDateSafe(order.completedAt)) || '';
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
        syncDayLeaveAmountState();
    };

    const getSelectedDayLeaveValue = () => {
        if (!kalendarzForm) return null;
        const checked = kalendarzForm.querySelector('input[name="dayLeave"]:checked');
        if (!checked) return null;
        const normalized = normalizeDayLeaveValue(checked.value);
        return normalized === DAY_LEAVE_NONE ? null : normalized;
    };

    const parseLeaveAmount = (value, fallback = 1) => {
        const amount = Number(value);
        if (!Number.isFinite(amount) || amount <= 0) return fallback;
        return amount === 0.5 ? 0.5 : 1;
    };

    const setDayLeaveAmountValue = (value = 1) => {
        if (!dayLeaveAmountInput) return;
        dayLeaveAmountInput.value = String(parseLeaveAmount(value, 1));
    };

    const syncDayLeaveAmountState = () => {
        if (!dayLeaveAmountInput) return;
        const selectedLeaveKind = getSelectedDayLeaveValue();
        const enabled = selectedLeaveKind === 'URL';
        dayLeaveAmountInput.disabled = !enabled;
        if (!enabled) setDayLeaveAmountValue(1);
    };

    const copyTextToClipboard = async (value) => {
        const text = String(value || '').trim();
        if (!text) return false;
        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_) { }
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.setAttribute('readonly', '');
        temp.style.position = 'absolute';
        temp.style.left = '-9999px';
        document.body.appendChild(temp);
        temp.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(temp);
        return copied;
    };

    const showCopyFeedback = (button, text = 'Skopiowano') => {
        if (!button) return;
        const previous = button.dataset.copyLabel || button.textContent || '';
        button.dataset.copyLabel = previous;
        button.textContent = text;
        clearTimeout(button._copyTimer);
        button._copyTimer = setTimeout(() => {
            button.textContent = previous;
        }, 1200);
    };

    const showToastMessage = (message = '') => {
        const text = String(message || '').trim();
        if (!text) return;
        let toast = document.getElementById('app-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'app-toast';
            toast.className = 'app-toast';
            toast.setAttribute('aria-live', 'polite');
            document.body.appendChild(toast);
        }
        toast.textContent = text;
        toast.classList.add('is-visible');
        clearTimeout(showToastMessage._timer);
        showToastMessage._timer = setTimeout(() => {
            toast.classList.remove('is-visible');
        }, 1600);
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
                if (!(status === 'zakończone' || status === 'zakonczone')) return false;
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
            drive: parsePlNumber(entry?.drive ?? entry?.jazda ?? 0),
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
                powiazane.forEach((entry) => {
                    try {
                        const clientName = resolveOrderClientName(entry.zlecenieId, entry.klientNazwa, orderIndex);
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
                    } catch (error) {
                        console.error('[rebuildCalendarDecorations] Pomijam wpis powiązanego zlecenia po błędzie', {
                            day: normalizedDay,
                            orderId: entry?.zlecenieId,
                            error
                        });
                    }
                });
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
        setDecorations({ summaryByDay, leaveByDay: leaveByDayOut, plannedLeaveByDay: Object.fromEntries(plannedLeaveByDay) });
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
            document.body.classList.remove('modal-open');
        }
    };

    const openModal = (modal) => {
        if (!modal) return;
        closeAllModals(modal);
        modal.style.display = 'block';
        showBackdrop();
        document.body.classList.add('modal-open');
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
            document.body.classList.remove('modal-open');
        }
    };


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
        const trigger = document.querySelector(`.tab-button[data-tab="${tabName}"]`);
        if (trigger) trigger.classList.add('active');
        handleTabActivation(tabName);
    };

    const handleTabActivation = (tabName) => {
        if (tabName === 'magazyn') {
            ensureMagazynSummaryPlacement();
        }
        if (tabName === 'finanse') {
            void initFinanceModule();
        }
        if (tabName === 'kalendarz-tab') {
            syncCalendarShellHeight();
            if (!bootstrapReady) {
                pendingCalendarInit = true;
                return;
            }
            void initCalendarModule('tab-activation');
        }
    };

    const bindTabNavigation = () => {
        document.querySelectorAll('.tab-button[data-tab]').forEach((button) => {
            button.addEventListener('click', () => {
                const tabName = button.dataset.tab;
                if (!tabName) return;
                showTab(tabName);
            });
        });
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
    bindTabNavigation();
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
            calendarTitleEl.textContent = window.__calendarRangeTitle || api.view?.title || '';
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
        setDayLeaveAmountValue(1);
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
                setDayLeaveAmountValue(dane.leaveAmount || 1);
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
                option.dataset.klientNazwa = pobierzKlientaZlecenia(z) || z.klientNazwa || '';
                kalendarzMultiSelect.appendChild(option);
            });
        zapewnijOpcjePowiazanych();
    }

    function resetujFormularzMulti() {
        multiEdytowanyIndex = null;
        if (kalendarzMultiSelect) kalendarzMultiSelect.value = '';
        if (kalendarzMultiHoursInput) kalendarzMultiHoursInput.value = '';
        if (kalendarzMultiDriveInput) kalendarzMultiDriveInput.value = '';
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
                    <span>F: <strong>${formatujLiczbe(pozycja.fakturowane)}</strong> h • J: <strong>${formatujLiczbe(pozycja.jazda)}</strong> h — ${nazwa || pozycja.zlecenieId}</span>
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
            const zlecenie = _wszystkieZleceniaCache.find(z => z.id === pozycja.zlecenieId);
            const label = pobierzNazweZlecenia(zlecenie) || pozycja.klientNazwa || pozycja.zlecenieId;
            const option = document.createElement('option');
            option.value = pozycja.zlecenieId;
            option.textContent = label || pozycja.zlecenieId;
            option.dataset.klientNazwa = pozycja.klientNazwa || pobierzKlientaZlecenia(zlecenie) || '';
            kalendarzMultiSelect.appendChild(option);
            istniejące.add(pozycja.zlecenieId);
        });
    }

    function dodajLubZapiszMultiZlecenie() {
        if (!kalendarzMultiSelect || !kalendarzMultiHoursInput || !kalendarzMultiDriveInput) return;
        const zlecenieId = kalendarzMultiSelect.value;
        const godziny = Number(kalendarzMultiHoursInput.value);
        const czasJazdy = Number(kalendarzMultiDriveInput.value || 0);
        if (!zlecenieId) {
            alert('Wybierz zlecenie do powiązania.');
            return;
        }
        if (!Number.isFinite(godziny) || godziny <= 0) {
            alert('Podaj dodatnią liczbę godzin.');
            return;
        }
        if (!Number.isFinite(czasJazdy) || czasJazdy < 0) {
            alert('Podaj poprawny czas jazdy (0 lub więcej).');
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
                entryId: multiZlecenia[multiEdytowanyIndex]?.entryId || (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${zlecenieId}:${Date.now()}`),
                zlecenieId,
                klientNazwa,
                fakturowane: Number(godziny) || 0,
                jazda: Number(czasJazdy) || 0
            };
        } else {
            const istnieje = multiZlecenia.some(poz => poz.zlecenieId === zlecenieId);
            if (istnieje) {
                alert('To zlecenie jest już powiązane z tym dniem.');
                return;
            }
            multiZlecenia.push({
                entryId: (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${zlecenieId}:${Date.now()}`),
                zlecenieId,
                klientNazwa,
                fakturowane: Number(godziny) || 0,
                jazda: Number(czasJazdy) || 0
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
                    const zlecenie = _wszystkieZleceniaCache.find(z => z.id === pozycja.zlecenieId);
                    const label = pobierzNazweZlecenia(zlecenie) || pozycja.klientNazwa || pozycja.zlecenieId;
                    option.value = pozycja.zlecenieId;
                    option.textContent = label || pozycja.zlecenieId;
                    option.dataset.klientNazwa = pozycja.klientNazwa || pobierzKlientaZlecenia(zlecenie) || '';
                    kalendarzMultiSelect.appendChild(option);
                }
                kalendarzMultiSelect.value = pozycja.zlecenieId;
            }
            if (kalendarzMultiHoursInput) kalendarzMultiHoursInput.value = Number(pozycja.fakturowane) || 0;
            if (kalendarzMultiDriveInput) kalendarzMultiDriveInput.value = Number(pozycja.jazda) || 0;
            if (kalendarzMultiAddButton) kalendarzMultiAddButton.textContent = 'Zapisz';
        }
    }

    async function obslugaZapisuGodzin(event) {
        if (!kalendarzForm || !kalendarzModal) return;
        event.preventDefault();
        const data = kalendarzForm['kalendarz-data'].value;
        const powiazane = multiZlecenia.map((p, index) => ({
            entryId: String(p.entryId || `${data}:${p.zlecenieId}:${index}`),
            zlecenieId: p.zlecenieId,
            klientNazwa: p.klientNazwa || pobierzNazwePowiazania(p.zlecenieId),
            fakturowane: Number(p.fakturowane) || 0,
            jazda: Number(p.jazda) || 0
        }));
        const sumaFakturowane = powiazane.reduce((acc, el) => acc + (Number(el.fakturowane) || 0), 0);
        const wartoscZFormularza = Number(kalendarzForm['godziny-fakturowane'].value) || 0;
        const fakturowaneDoZapisu = powiazane.length > 0 ? sumaFakturowane : wartoscZFormularza;
        manualFakturowaneValue = fakturowaneDoZapisu;

        const selectedLeaveKind = getSelectedDayLeaveValue();
        const leaveAmount = selectedLeaveKind === 'URL' ? parseLeaveAmount(dayLeaveAmountInput?.value, 1) : 0;
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
            leaveAmount,
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
            invalidateMonthStatsCache();
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
            absorpcja: obliczAbsorpcja(sumyMies.wyfakturowaneGodziny, sumyMies.praca)
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
        renderMonthStats(kalendarzPodsumowanieDiv, podsumowanie);
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
            <span class="weekly-missing" data-weekly-missing>Braki: ${model.missingDaysCount} dni</span>
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


    const notesData = createNotesDataLayer(db);
    const notesModal = document.getElementById('notes-editor-modal');
    const notesEditorForm = document.getElementById('notes-editor-form');
    const notesEditorId = document.getElementById('notes-editor-id');
    const notesEditorTitle = document.getElementById('notes-editor-title');
    const notesEditorContent = document.getElementById('notes-editor-content');
    const notesToolbar = document.getElementById('notes-toolbar');
    const notesEditorPinned = document.getElementById('notes-editor-pinned');
    const notesEditorColor = document.getElementById('notes-editor-color');
    const notesEditorOrder = document.getElementById('notes-editor-order');
    const notesEditorOrderInput = document.getElementById('notes-editor-order-input');
    const notesEditorOrderDropdown = document.getElementById('notes-editor-order-dropdown');
    const notesEditorOrderClear = document.getElementById('notes-editor-order-clear');
    const notesEditorOrderGroup = document.getElementById('notes-editor-order-group');
    const notesEditorCancel = document.getElementById('notes-editor-cancel');
    const notesEditorDelete = document.getElementById('notes-editor-delete');
    const notesEditorExport = document.getElementById('notes-editor-export');
    const notesModalClose = document.getElementById('notes-modal-close');
    const notesModalTitle = document.getElementById('notes-modal-title');
    const notesEditorMeta = document.getElementById('notes-editor-meta');
    const notesEditorCreated = document.getElementById('notes-editor-created');
    const notesEditorUpdated = document.getElementById('notes-editor-updated');
    let notesDirty = false;
    let notesOrderOptions = [];
    let notesOrderLabelsById = new Map();

    const toDateLabel = (value) => {
        if (!value) return '—';
        const d = toDateSafe(value);
        return d ? d.toLocaleDateString('pl-PL') : '—';
    };
    const notesFilename = (note) => {
        const date = normalizeDateOnly(note?.updatedAt || new Date());
        const slug = (note?.title || 'bez-tytulu').toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'bez-tytulu';
        return `notatka_${date}_${slug}.txt`;
    };
    const exportSingleNote = (note) => {
        if (!note) return;
        const orderLabel = notesOrderOptions.find((option) => option.id === note.linkedOrderId)?.label || note.linkedOrderId || '';
        const text = buildNoteTxt(note, orderLabel);
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = notesFilename(note);
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };
    const exportManyNotes = (notes = [], filename = 'notatki.txt') => {
        if (!notes.length) return alert('Brak notatek do eksportu.');
        const text = notes.map((note) => buildNoteTxt(note, notesOrderOptions.find((option) => option.id === note.linkedOrderId)?.label || '')).join('\n\n---\n\n');
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };
    const readNotesFilters = () => ({
        linkType: notesFilterType?.value || 'all',
        linkedOrderId: notesFilterOrder?.value || '',
        search: notesSearchInput?.value || ''
    });
    const getNotesViewModel = () => {
        const filters = readNotesFilters();
        filters.orderLabelsById = notesOrderLabelsById;
        return buildNotesViewModel({ notes: allNotes, filters });
    };
    const buildNotesOrdersModel = () => buildNoteOrderOptionsModel({
        orders: _wszystkieZleceniaCache || [],
        clients: _wszystkieKlienciCache || [],
        machines: _wszystkieMaszynyCache || []
    });
    const syncNotesEditorOrderInput = () => {
        if (!notesEditorOrderInput) return;
        const selected = notesOrderOptions.find((option) => option.id === notesEditorOrder.value);
        notesEditorOrderInput.value = selected?.label || '';
        updateNotesEditorOrderClear();
    };
    const updateNotesEditorOrderClear = () => {
        if (!notesEditorOrderClear || !notesEditorOrderInput) return;
        notesEditorOrderClear.classList.toggle('is-visible', Boolean(notesEditorOrderInput.value));
    };
    const renderNotesOrderDropdown = () => {
        if (!notesEditorOrderDropdown) return;
        const filtered = filterNoteOrderOptions({ options: notesOrderOptions, query: notesEditorOrderInput?.value || '' });
        if (!filtered.length) {
            notesEditorOrderDropdown.innerHTML = '<div class="combobox-empty">Brak wyników</div>';
            notesEditorOrderDropdown.classList.add('is-open');
            return;
        }
        notesEditorOrderDropdown.innerHTML = filtered.map((option, index) => `<button type="button" class="combobox-option" data-order-option-id="${option.id}" data-order-option-index="${index}"><span>${option.label}</span></button>`).join('');
        notesEditorOrderDropdown.classList.add('is-open');
    };
    const fillNotesOrderFilter = () => {
        if (!notesFilterOrder || !notesEditorOrder) return;
        const current = notesFilterOrder.value;
        const currentModal = notesEditorOrder.value;
        notesOrderOptions = buildNotesOrdersModel();
        notesOrderLabelsById = new Map(notesOrderOptions.map((option) => [option.id, option.label]));
        const filterOptions = ['<option value="">Wszystkie zlecenia</option>'].concat(
            notesOrderOptions.map((option) => `<option value="${option.id}">${option.label}</option>`)
        );
        notesFilterOrder.innerHTML = filterOptions.join('');
        notesFilterOrder.value = current || '';
        notesEditorOrder.value = currentModal || '';
        syncNotesEditorOrderInput();
    };
    const renderNotesList = () => {
        if (!notesListContainer) return;
        if (notesStatus === 'loading') {
            notesListContainer.innerHTML = '<p class="loading-state">Ładowanie notatek...</p>';
            return;
        }
        const vm = getNotesViewModel();
        renderNotesListView({ host: notesListContainer, model: vm, selectedNoteId });
    };
    const openNoteEditor = (note = null) => {
        if (!notesModal || !notesEditorForm) return;
        const draft = note || { id: '', title: '', contentHtml: '', contentText: '', linkType: NOTE_LINK_TYPES.NONE, linkedOrderId: '', pinned: false, color: '#ffffff' };
        notesEditorId.value = draft.id || '';
        notesEditorTitle.value = draft.title || '';
        notesEditorContent.innerHTML = draft.contentHtml || '';
        if (notesEditorPinned) notesEditorPinned.checked = Boolean(draft.pinned);
        if (notesEditorColor) notesEditorColor.value = draft.color || '#ffffff';
        notesEditorOrder.value = draft.linkedOrderId || '';
        syncNotesEditorOrderInput();
        const type = draft.linkType || NOTE_LINK_TYPES.NONE;
        const radio = notesEditorForm.querySelector(`input[name="notes-link-type"][value="${type}"]`);
        if (radio) radio.checked = true;
        notesEditorOrderGroup.hidden = type !== NOTE_LINK_TYPES.ORDER;
        notesEditorDelete.hidden = !draft.id;
        if (notesModalTitle) notesModalTitle.textContent = draft.id ? 'Edytuj notatkę' : 'Nowa notatka';
        if (notesEditorMeta) {
            notesEditorMeta.hidden = false;
            if (notesEditorCreated) notesEditorCreated.textContent = toDateLabel(draft.createdAt);
            if (notesEditorUpdated) notesEditorUpdated.textContent = toDateLabel(draft.updatedAt);
        }
        notesDirty = false;
        openModal(notesModal);
    };
    const closeNoteEditor = () => {
        if (!notesModal) return;
        if (notesDirty && !window.confirm('Masz niezapisane zmiany. Zamknąć?')) return;
        hideModal(notesModal);
    };

    function setActivityCollapsed(collapsed) {
        notesActivityCollapsed = Boolean(collapsed);
        if (pulpitActivityContainer) pulpitActivityContainer.hidden = notesActivityCollapsed;
        if (pulpitActivityToggle) pulpitActivityToggle.textContent = notesActivityCollapsed ? 'Pokaż' : 'Ukryj';
        const count = Array.isArray(recentActivity) ? recentActivity.length : 0;
        if (pulpitActivityTitle) pulpitActivityTitle.textContent = `Ostatnie działania (${count})`;
        try { localStorage.setItem(NOTES_STORAGE_KEY, notesActivityCollapsed ? '1' : '0'); } catch (_) { }
    }

    const renderActivitySummaryHeader = () => {
        const count = Array.isArray(recentActivity) ? recentActivity.length : 0;
        if (pulpitActivityTitle) pulpitActivityTitle.textContent = `Ostatnie działania (${count})`;
    };

    setActivityCollapsed(notesActivityCollapsed);

    function obliczSumeGodzinZKalendarza(start, end) {
        const monthKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
        const cached = monthStatsCache.read(monthKey);
        if (cached?.value) renderPulpitStatystykiMiesiaca(cached.value);
        else renderMonthStatsSkeleton(kalendarzPodsumowanieDiv);
        const startedAt = performance.now();
        setTimeout(() => {
            const closedOrderIds = new Set((_wszystkieZleceniaCache || []).filter((o) => isOrderClosed(o)).map((o) => String(o.id)));
            const podsumowanie = aggregateMonthStats(wszystkieWpisyKalendarza, monthKey, { closedOrderIds });
            const invoiceStats = buildInvoiceStatsByMonth(_wszystkieZleceniaCache);
            podsumowanie.fakturowaneRozliczone = invoiceStats.monthStats.get(monthKey)?.invoicedHours ?? 0;
            podsumowanie.absorpcja = podsumowanie.praca > 0 ? (podsumowanie.fakturowaneRozliczone / podsumowanie.praca) * 100 : 0;
            monthStatsCache.write(monthKey, podsumowanie);
            renderPulpitStatystykiMiesiaca(podsumowanie);
            if (import.meta.env.DEV) console.info('[perf] month-stats', monthKey, `${Math.round(performance.now() - startedAt)}ms`);
            renderPulpitWykresy();
        }, 0);
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

    function pobierzNumerEtykietaZlecenia(zlecenie) {
        const numer = String(zlecenie?.nrZlecenia || zlecenie?.id || '').trim();
        return numer ? `#${numer}` : '#—';
    }

    function pobierzKlientaZlecenia(zlecenie) {
        if (!zlecenie) return '';
        const klient = _wszystkieKlienciCache.find(k => k.id === zlecenie.klientId);
        return zlecenie.klientNazwa || klient?.nazwa || '';
    }

    function pobierzNazweZlecenia(zlecenie) {
        if (!zlecenie) return '';
        const maszyna = _wszystkieMaszynyCache.find(m => m.id === zlecenie.maszynaId);
        const klientLabel = pobierzKlientaZlecenia(zlecenie);
        const maszynaLabel = maszyna ? `${maszyna.typMaszyny || ''} ${maszyna.model || ''}`.trim() : '';
        const numerLabel = pobierzNumerEtykietaZlecenia(zlecenie);
        return [numerLabel, klientLabel, maszynaLabel].filter(Boolean).join(' — ');
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
            .map((p, index) => ({
                entryId: String(p.entryId || p.id || `${dane?.date || dane?.id || 'unknown-day'}:${p.zlecenieId}:${index}`),
                zlecenieId: p.zlecenieId,
                klientNazwa: p.klientNazwa || pobierzNazwePowiazania(p.zlecenieId),
                fakturowane: Number(p.invoicedForOrderHours ?? p.fakturowaneDlaZlecenia ?? p.fakturowane) || 0,
                jazda: Number(p.driveForOrderHours ?? p.czasJazdyDlaZlecenia ?? p.jazda) || 0
            }));

        if (!powiazane.length && dane?.zlecenieId) {
            powiazane.push({
                entryId: String(dane?.entryId || dane?.id || `${dane?.date || dane?.zlecenieId || 'unknown-day'}:${dane.zlecenieId}:0`),
                zlecenieId: dane.zlecenieId,
                klientNazwa: dane.klientNazwa || pobierzNazwePowiazania(dane.zlecenieId),
                fakturowane: Number(dane.invoicedForOrderHours ?? dane.fakturowaneDlaZlecenia ?? dane.fakturowane) || 0,
                jazda: Number(dane.driveForOrderHours ?? dane.czasJazdyDlaZlecenia ?? dane.jazda) || 0
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
            leaveKind: leaveKindNormalized && leaveKindNormalized !== DAY_LEAVE_NONE ? leaveKindNormalized : null,
            leaveAmount: leaveKindNormalized === 'URL' ? parseLeaveAmount(dane.leaveAmount, 1) : 0
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
        let work = 0, l4Days = 0, urlopDays = 0;

        (monthDays || []).forEach(day => {
            const normalized = normalizeDayRecord(day.id || day.date, day);
            work += Number(normalized.work) || 0;

            const key = normalized.date;
            if (!key) return;
            if (!uniqByDate.has(key)) uniqByDate.set(key, { l4: false, urlop: 0 });
            const agg = uniqByDate.get(key);
            if (normalized.flags?.l4) agg.l4 = true;
            if (normalized.flags?.urlop) agg.urlop = Math.min(1, Number(agg.urlop || 0) + parseLeaveAmount(normalized.leaveAmount, 1));
        });

        for (const v of uniqByDate.values()) {
            if (v.l4) l4Days++;
            urlopDays += Number(v.urlop) || 0;
        }

        return { work, l4Days, urlopDays, urlopDaysUsed: urlopDays, absorpcja: 0 };
    }

    async function obliczPodsumowaniaMiesieczne(wpisy) {
        const grouped = groupByYearMonth(wpisy || []);
        const invoiceStats = buildInvoiceStatsByMonth(_wszystkieZleceniaCache);
        const invoiceByMonth = invoiceStats.monthStats;
        invoiceByMonth.forEach((_, monthKey) => {
            const [yearStr, monthStr] = monthKey.split('-');
            const year = Number(yearStr);
            const month = Number(monthStr);
            if (!Number.isFinite(year) || !Number.isFinite(month)) return;
            if (!grouped[year]) grouped[year] = {};
            if (!grouped[year][month]) grouped[year][month] = [];
        });

        const miesiace = [];
        const sumyRocznePerRok = [];
        const lata = Object.keys(grouped).map(Number).sort((a, b) => a - b);
        const globalTotals = { work: 0, drive: 0, billed: 0, gross: 0, net: 0, l4Days: 0, urlopDays: 0 };
        const yearsDetailed = [];

        lata.forEach(year => {
            const months = grouped[year];
            const monthNumbers = Object.keys(months).map(Number).sort((a, b) => a - b);
            const yearSum = { work: 0, drive: 0, billed: 0, gross: 0, net: 0, l4Days: 0, urlopDays: 0 };
            const yearMonths = [];

            monthNumbers.forEach(month => {
                const stats = monthStats(months[month]);
                const miesiacKey = `${year}-${String(month).padStart(2, '0')}`;
                const invoiceMonth = invoiceByMonth.get(miesiacKey) || { invoicedHours: 0, grossAmount: 0, netAmount: 0 };
                const monthlyDriveHours = getMonthlyDriveHoursFromCalendar(months[month], miesiacKey);
                const baseGross = Number(invoiceMonth.grossAmount) || 0;
                const baseNet = Number(invoiceMonth.netAmount) || 0;
                stats.billed = Number(invoiceMonth.invoicedHours) || 0;
                stats.drive = monthlyDriveHours;
                stats.gross = baseGross;
                stats.net = baseNet;
                stats.absorpcja = obliczAbsorpcjaDoBazy(stats.billed, ABSORPTION_MONTHLY_BASE_HOURS);
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
                    gross: stats.gross,
                    net: stats.net,
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
                yearSum.gross += stats.gross;
                yearSum.net += stats.net;
                yearSum.l4Days += stats.l4Days;
                yearSum.urlopDays += stats.urlopDays;
            });

            const elapsedMonths = getElapsedMonthsForYearAbsorption(year);
            const yearlyBaseHours = elapsedMonths * ABSORPTION_MONTHLY_BASE_HOURS;
            const yearAbsorpcja = obliczAbsorpcjaDoBazy(yearSum.billed, yearlyBaseHours);
            sumyRocznePerRok.push({
                rok: year,
                praca: yearSum.work,
                jazda: yearSum.drive,
                wyfakturowaneGodziny: yearSum.billed,
                gross: yearSum.gross,
                net: yearSum.net,
                l4Days: yearSum.l4Days,
                urlopDaysUsed: yearSum.urlopDays,
                work: yearSum.work,
                drive: yearSum.drive,
                billed: yearSum.billed,
                urlopDays: yearSum.urlopDays,
                miesiace: monthNumbers.length,
                absorpcja: yearAbsorpcja,
                absorpcjaBaseHours: yearlyBaseHours,
                absorpcjaElapsedMonths: elapsedMonths
            });
            yearsDetailed.push({
                year,
                months: yearMonths,
                sum: {
                    ...yearSum,
                    absorpcja: yearAbsorpcja,
                    absorpcjaBaseHours: yearlyBaseHours,
                    absorpcjaElapsedMonths: elapsedMonths
                }
            });

            globalTotals.work += yearSum.work;
            globalTotals.drive += yearSum.drive;
            globalTotals.billed += yearSum.billed;
            globalTotals.gross += yearSum.gross;
            globalTotals.net += yearSum.net;
            globalTotals.l4Days += yearSum.l4Days;
            globalTotals.urlopDays += yearSum.urlopDays;
        });

        const sumyRoczne = {
            work: globalTotals.work,
            drive: globalTotals.drive,
            billed: globalTotals.billed,
            gross: globalTotals.gross,
            net: globalTotals.net,
            l4Days: globalTotals.l4Days,
            urlopDays: globalTotals.urlopDays,
            praca: globalTotals.work,
            jazda: globalTotals.drive,
            wyfakturowaneGodziny: globalTotals.billed,
            urlopDaysUsed: globalTotals.urlopDays,
            absorpcja: obliczAbsorpcja(globalTotals.billed, globalTotals.work)
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

        if (import.meta.env.DEV) {
            const debugOrders = (wszystkieZlecenia || []).filter(z => isOrderClosed(z)).slice(0, 3);
            debugOrders.forEach((order) => {
                const amounts = computeOrderAmounts(order);
                console.info('[billing-debug]', {
                    id: order?.id,
                    wyfakturowaneGodziny: getOrderInvoicedHours(order),
                    stawka: order?.stawka ?? STAWKI[order?.typZlecenia]?.stawka ?? null,
                    grossOrder: order?.grossAmount ?? order?.kwotaBrutto ?? order?.brutto ?? order?.gross ?? order?.valueGross ?? null,
                    netOrder: order?.netAmount ?? order?.kwotaNetto ?? order?.netto ?? order?.net ?? order?.valueNet ?? null,
                    grossComputed: amounts.grossCents / 100,
                    netComputed: amounts.netCents / 100,
                    source: amounts.source
                });
            });
        }

        return wszystkieZlecenia
            .filter(z => isOrderClosed(z) && resolveOrderSettlementMonth(z) === miesiac)
            .reduce((acc, z) => {
                const amounts = computeOrderAmounts(z);
                acc.sumaGodzin += getOrderInvoicedHours(z);
                acc.sumaBrutto += amounts.grossCents / 100;
                acc.sumaNetto += amounts.netCents / 100;
                return acc;
            }, { ...pustyWynik });
    }

    function pobierzPraceZMiesiaca(miesiac) {
        if (!miesiac) return 0;
        return (wszystkieWpisyKalendarza || []).reduce((acc, wpis) => {
            const normalized = normalizeDayRecord(wpis.id || wpis.date, wpis);
            if (String(normalized.date || '').slice(0, 7) !== miesiac) return acc;
            return acc + (Number(normalized.work) || 0);
        }, 0);
    }

    function obliczIPokazPodsumowanieFinansowe() {
        const wybranyMiesiac = getSelectedMonth();
        const finansowe = obliczPodsumowanieFinansowe(wybranyMiesiac, _wszystkieZleceniaCache);
        if (!zakonczoneSummaryContainer) return;

        const { sumaGodzin, sumaBrutto, sumaNetto } = finansowe;
        const absorpcja = obliczAbsorpcja(sumaGodzin, pobierzPraceZMiesiaca(wybranyMiesiac));

        zakonczoneSummaryContainer.classList.add('orders-summary');

        zakonczoneSummaryContainer.innerHTML = '';

        const metricsGrid = document.createElement('div');
        metricsGrid.className = 'metrics-grid';
        metricsGrid.innerHTML = `
    <div class="metric"><div class="label">Wyfakturowane</div><div class="value num">${(sumaGodzin || 0).toFixed(1)} h</div></div>
    <div class="metric"><div class="label">Brutto</div><div class="value num">${(sumaBrutto || 0).toFixed(2)} zł</div></div>
    <div class="metric"><div class="label">Netto</div><div class="value num">${(sumaNetto || 0).toFixed(2)} zł</div></div>
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
        const shouldIgnoreStoredAllOpen = stored.length > 0 && stored.length === available.size;
        const next = shouldIgnoreStoredAllOpen ? [] : stored;
        openSummaryYears = new Set(next);
        persistOpenYears([...openSummaryYears]);
        return openSummaryYears;
    };

    const formatHours = (value) => `${(Number(value) || 0).toFixed(2)} h`;
    const QUARTERLY_BONUS_THRESHOLDS = [
        { name: 'I', min: 84, max: 108, rate: 2 },
        { name: 'II', min: 109, max: 133, rate: 5 },
        { name: 'III', min: 134, max: 168, rate: 7 }
    ];
    const PL_MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];

    const monthKeyToParts = (monthKey = '') => {
        const [yearStr, monthStr] = String(monthKey).split('-');
        const year = Number(yearStr);
        const month = Number(monthStr);
        if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
        return { year, month };
    };

    const makeMonthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

    const shiftMonth = (year, month, offset = 0) => {
        const base = new Date(Date.UTC(year, month - 1 + offset, 1));
        return { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1 };
    };

    const shiftQuarterlyPeriodStart = (startYear, startMonth, offset = 0) => {
        const shifted = shiftMonth(startYear, startMonth, offset);
        return { startYear: shifted.year, startMonth: shifted.month };
    };

    const resolveQuarterlyPeriodForMonth = (year, month) => {
        if (month >= 2 && month <= 4) return { startYear: year, startMonth: 2 };
        if (month >= 5 && month <= 7) return { startYear: year, startMonth: 5 };
        if (month >= 8 && month <= 10) return { startYear: year, startMonth: 8 };
        if (month >= 11) return { startYear: year, startMonth: 11 };
        return { startYear: year - 1, startMonth: 11 };
    };

    const buildQuarterlyPeriod = ({ startYear, startMonth }) => {
        const months = [0, 1, 2].map((offset) => {
            const shifted = shiftMonth(startYear, startMonth, offset);
            return {
                ...shifted,
                key: makeMonthKey(shifted.year, shifted.month),
                label: `${PL_MONTHS[shifted.month - 1]} ${shifted.year}`
            };
        });
        const end = months[2];
        const endDate = new Date(end.year, end.month, 0);
        return {
            id: `${startYear}-${String(startMonth).padStart(2, '0')}`,
            startYear,
            startMonth,
            months,
            endDate,
            label: `${PL_MONTHS[months[0].month - 1]} – ${PL_MONTHS[end.month - 1]} ${end.year}`
        };
    };

    const resolveQuarterlyThreshold = (averageHours) => QUARTERLY_BONUS_THRESHOLDS.find((threshold) => averageHours >= threshold.min && averageHours <= threshold.max) || null;

    const countBusinessDaysInclusive = (startDate, endDate) => {
        if (!(startDate instanceof Date) || !(endDate instanceof Date) || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) return 0;
        let count = 0;
        const day = new Date(startDate);
        while (day <= endDate) {
            const weekDay = day.getDay();
            if (weekDay !== 0 && weekDay !== 6) count += 1;
            day.setDate(day.getDate() + 1);
        }
        return count;
    };

    const computeQuarterlyBonusModel = () => {
        const invoiceByMonth = buildInvoiceStatsByMonth(_wszystkieZleceniaCache).monthStats;
        const driveByMonth = aggregateMonthlyDriveHours(wszystkieWpisyKalendarza || []);

        const knownMonths = new Set([...invoiceByMonth.keys(), ...driveByMonth.keys()]);
        const now = new Date();
        knownMonths.add(makeMonthKey(now.getFullYear(), now.getMonth() + 1));
        const sortedMonths = [...knownMonths]
            .map(monthKeyToParts)
            .filter(Boolean)
            .sort((a, b) => (a.year - b.year) || (a.month - b.month));
        if (!sortedMonths.length) return null;

        const startPeriod = resolveQuarterlyPeriodForMonth(sortedMonths[0].year, sortedMonths[0].month);
        const endPeriod = resolveQuarterlyPeriodForMonth(sortedMonths[sortedMonths.length - 1].year, sortedMonths[sortedMonths.length - 1].month);
        const periods = [];
        let cursor = { ...startPeriod };
        while ((cursor.startYear < endPeriod.startYear) || (cursor.startYear === endPeriod.startYear && cursor.startMonth <= endPeriod.startMonth)) {
            periods.push(buildQuarterlyPeriod(cursor));
            cursor = shiftQuarterlyPeriodStart(cursor.startYear, cursor.startMonth, 3);
        }

        const summary = periods.map((period) => {
            const months = period.months.map((item) => {
                const invoice = invoiceByMonth.get(item.key);
                const billed = Number(invoice?.invoicedHours) || 0;
                const drive = Number(driveByMonth.get(item.key)) || 0;
                return { ...item, billed, drive, total: billed + drive };
            });
            const totals = months.reduce((acc, item) => {
                acc.billed += item.billed;
                acc.drive += item.drive;
                acc.total += item.total;
                return acc;
            }, { billed: 0, drive: 0, total: 0 });
            const average = totals.total / 3;
            const threshold = resolveQuarterlyThreshold(average);
            const grossBonus = average * 3 * (threshold?.rate || 0);
            const netBonus = grossBonus * 0.7;
            const nextThreshold = QUARTERLY_BONUS_THRESHOLDS.find((item) => average < item.min) || null;
            const missingHours = nextThreshold ? Math.max(0, (nextThreshold.min * 3) - totals.total) : 0;
            return { period, months, totals, average, threshold, nextThreshold, missingHours, grossBonus, netBonus };
        });

        const currentPeriodMeta = resolveQuarterlyPeriodForMonth(now.getFullYear(), now.getMonth() + 1);
        const currentPeriodId = `${currentPeriodMeta.startYear}-${String(currentPeriodMeta.startMonth).padStart(2, '0')}`;
        const current = summary.find((item) => item.period.id === currentPeriodId) || null;
        if (!current) return { current: null, history: summary.reverse() };

        const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const remainingBusinessDays = countBusinessDaysInclusive(tomorrow, current.period.endDate);
        const neededPerDay = current.nextThreshold && remainingBusinessDays > 0
            ? current.missingHours / remainingBusinessDays
            : 0;

        return {
            current: { ...current, remainingBusinessDays, neededPerDay },
            history: summary.filter((item) => item.period.id !== current.period.id).reverse()
        };
    };

    const renderQuarterlyBonusSummary = () => {
        if (!quarterlyBonusSummaryContainer) return;
        const model = computeQuarterlyBonusModel();
        if (!model || !model.current) {
            quarterlyBonusSummaryContainer.innerHTML = '<p>Brak danych do wyliczenia premii kwartalnej.</p>';
            return;
        }
        const current = model.current;
        const hasAnyCurrentData = current.months.some((month) => month.billed > 0 || month.drive > 0);
        if (!hasAnyCurrentData) {
            quarterlyBonusSummaryContainer.innerHTML = '<p>Brak danych do wyliczenia premii kwartalnej.</p>';
            return;
        }
        const historyPreviewLimit = 3;
        const visibleHistory = quarterlyBonusHistoryExpanded
            ? model.history
            : model.history.slice(0, historyPreviewLimit);
        const hasMoreHistory = model.history.length > historyPreviewLimit;
        const periodRange = current.threshold
            ? `${current.threshold.min}–${current.threshold.max}`
            : 'poza progami';
        const nextThresholdText = current.nextThreshold
            ? `${current.missingHours.toFixed(2)} h do progu ${current.nextThreshold.name}`
            : 'Najwyższy próg osiągnięty';
        const neededPerDayText = current.nextThreshold
            ? `${current.neededPerDay.toFixed(2)} h/dzień (pozostałe dni robocze: ${current.remainingBusinessDays})`
            : '0.00 h/dzień';
        quarterlyBonusSummaryContainer.innerHTML = `
            <section class="quarterly-bonus ${quarterlyBonusExpanded ? 'is-open' : ''}">
                <button type="button" class="quarterly-bonus__toggle" aria-expanded="${quarterlyBonusExpanded}" aria-controls="quarterly-bonus-content">
                    <span class="quarterly-bonus__toggle-left">
                        <span class="quarterly-bonus__chevron" aria-hidden="true">${quarterlyBonusExpanded ? '▼' : '▶'}</span>
                        <span class="quarterly-bonus__title">Premia kwartalna</span>
                    </span>
                    <span class="quarterly-bonus__summary">
                        <span class="quarterly-bonus__summary-chip"><em>Okres</em><strong>${current.period.label}</strong></span>
                        <span class="quarterly-bonus__summary-chip"><em>Próg</em><strong>${current.threshold ? current.threshold.name : 'poza progami'}</strong></span>
                        <span class="quarterly-bonus__summary-chip"><em>Premia brutto</em><strong>${current.grossBonus.toFixed(2)} zł</strong></span>
                        <span class="quarterly-bonus__summary-chip"><em>Do kolejnego progu</em><strong>${current.nextThreshold ? `${current.missingHours.toFixed(2)} h` : '0.00 h'}</strong></span>
                    </span>
                </button>
                ${quarterlyBonusExpanded ? `
                <div class="quarterly-bonus__content" id="quarterly-bonus-content">
                    <div class="quarterly-bonus__top-metrics">
                        <div class="metric"><div class="label">Wyfakturowane</div><div class="value num">${current.totals.billed.toFixed(2)} h</div></div>
                        <div class="metric"><div class="label">Czas jazdy</div><div class="value num">${current.totals.drive.toFixed(2)} h</div></div>
                        <div class="metric"><div class="label">Suma do premii</div><div class="value num">${current.totals.total.toFixed(2)} h</div></div>
                        <div class="metric"><div class="label">Średnia z 3 miesięcy</div><div class="value num">${current.average.toFixed(2)} h</div></div>
                    </div>
                    <div class="quarterly-bonus__bonus-grid">
                        <div class="quarterly-bonus__mini-card"><span>Próg</span><strong>${current.threshold ? current.threshold.name : 'poza progami'} <small>${periodRange}</small></strong></div>
                        <div class="quarterly-bonus__mini-card"><span>Stawka</span><strong>${(current.threshold?.rate || 0).toFixed(2)} zł</strong></div>
                        <div class="quarterly-bonus__mini-card"><span>Premia brutto</span><strong>${current.grossBonus.toFixed(2)} zł</strong></div>
                        <div class="quarterly-bonus__mini-card"><span>Premia po -30%</span><strong>${current.netBonus.toFixed(2)} zł</strong></div>
                    </div>
                    <div class="quarterly-bonus__focus">
                        <div class="quarterly-bonus__focus-box">
                            <span>Do kolejnego progu</span>
                            <strong>${nextThresholdText}</strong>
                        </div>
                        <div class="quarterly-bonus__focus-box">
                            <span>Ile godzin dziennie potrzeba</span>
                            <strong>${neededPerDayText}</strong>
                        </div>
                    </div>
                    <div class="quarterly-bonus__table-wrap">
                        <table class="tbl tbl--light">
                            <thead><tr><th>Miesiąc</th><th>Wyfakturowane</th><th>Jazda</th><th>Suma</th></tr></thead>
                            <tbody>
                                ${current.months.map((month) => `<tr><td>${month.label}</td><td>${month.billed.toFixed(2)} h</td><td>${month.drive.toFixed(2)} h</td><td>${month.total.toFixed(2)} h</td></tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div class="quarterly-bonus__history-head">
                        <h4>Historia premii</h4>
                        ${hasMoreHistory ? `<button type="button" class="quarterly-bonus__history-toggle">${quarterlyBonusHistoryExpanded ? 'Pokaż mniej' : 'Pokaż więcej'}</button>` : ''}
                    </div>
                    <div class="quarterly-bonus__table-wrap">
                        <table class="tbl tbl--light">
                            <thead><tr><th>Okres</th><th>Średnia</th><th>Próg</th><th>Stawka</th><th>Premia brutto</th><th>Premia po -30%</th></tr></thead>
                            <tbody>
                                ${visibleHistory.map((item) => `<tr><td>${item.period.label}</td><td>${item.average.toFixed(2)} h</td><td>${item.threshold ? item.threshold.name : '—'}</td><td>${(item.threshold?.rate || 0).toFixed(2)} zł</td><td>${item.grossBonus.toFixed(2)} zł</td><td>${item.netBonus.toFixed(2)} zł</td></tr>`).join('') || '<tr><td colspan="6">Brak zakończonych okresów.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>
                ` : ''}
            </section>
        `;
    };


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
        if (summaryBillingModeSelect) summaryBillingModeSelect.value = 'calendar';
        const years = (ostatnieZestawienieMiesieczne.years || []).sort((a, b) => a.year - b.year);
        if (!years.length) {
            annualSummaryContainer.innerHTML = '<p>Brak danych do wyświetlenia.</p>';
            return;
        }

        const openYears = ensureOpenSummaryYears(years.map(y => y.year));
        annualSummaryContainer.innerHTML = `
${years.map(y => `
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
            <span>Brutto: ${(Number(y.sum.gross)||0).toFixed(2)} zł</span>
            <span>Netto: ${(Number(y.sum.net)||0).toFixed(2)} zł</span>
            <span>Absorpcja: ${(Number(y.sum.absorpcja)||0).toFixed(1)}%</span>
            <span>L4: ${formatDaysValue(y.sum.l4Days)}</span>
            <span>Urlop: ${formatDaysValue(y.sum.urlopDays)}</span>
          </span>
        </span>
      </button>
      ${buildExportMenuMarkup(y.year)}
    </div>
    <div class="year-content" id="year-content-${y.year}">
      <table class="tbl">
        <thead><tr>
          <th>Miesiąc</th><th>Godziny pracy</th><th>Czas jazdy</th>
          <th>Wyfakturowane</th><th>Brutto (zł)</th><th>Netto (zł)</th><th>Absorpcja</th><th>L4 (dni)</th><th>Urlop (dni)</th>
        </tr></thead>
        <tbody>
          ${y.months.map(m=>`
            <tr>
              <td>${m.label}</td>
              <td>${m.work.toFixed(2)} h</td>
              <td>${m.drive.toFixed(2)} h</td>
              <td>${m.billed.toFixed(2)} h</td>
              <td>${(Number(m.gross)||0).toFixed(2)} zł</td>
              <td>${(Number(m.net)||0).toFixed(2)} zł</td>
              <td><span class="badge-value">${(Number(m.absorpcja)||0).toFixed(1)}%</span></td>
              <td>${m.l4Days}</td>
              <td>${formatDaysValue(m.urlopDays)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td>Razem/Rok</td>
            <td>${y.sum.work.toFixed(2)} h</td>
            <td>${y.sum.drive.toFixed(2)} h</td>
            <td>${y.sum.billed.toFixed(2)} h</td>
            <td>${(Number(y.sum.gross)||0).toFixed(2)} zł</td>
            <td>${(Number(y.sum.net)||0).toFixed(2)} zł</td>
            <td><span class="badge-value">${(Number(y.sum.absorpcja)||0).toFixed(1)}%</span></td>
            <td>${y.sum.l4Days}</td>
            <td>${formatDaysValue(y.sum.urlopDays)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
`).join('')}`;
        if (annualSummaryExportBtn) {
            const latestYear = Math.max(...years.map(y => Number(y.year)).filter(Number.isFinite));
            annualSummaryExportBtn.dataset.exportYear = Number.isFinite(latestYear) ? String(latestYear) : '';
        }
    }

    const getPlannedLeaveTotal = (entries = []) => {
        return (entries || []).reduce((acc, entry) => acc + countDaysInRange(entry.startDate, entry.endDate, entry.leaveDays), 0);
    };

    const calcVacationRemaining = (allowance, usedFromCalendar, plannedDays, adjustmentsSum) => {
        return (Number(allowance) || 0) - (Number(usedFromCalendar) || 0) - (Number(plannedDays) || 0) + (Number(adjustmentsSum) || 0);
    };

    const setVacationCollapsedSummary = ({ remaining = 0, used = 0, planned = 0, adjustments = 0 } = {}) => {
        if (vacationCollapsedRemainingSpan) vacationCollapsedRemainingSpan.textContent = formatujLiczbe(remaining);
        if (vacationCollapsedUsedSpan) vacationCollapsedUsedSpan.textContent = formatujLiczbe(used);
        if (vacationCollapsedPlannedSpan) vacationCollapsedPlannedSpan.textContent = formatujLiczbe(planned);
        if (vacationCollapsedAdjustmentsSpan) vacationCollapsedAdjustmentsSpan.textContent = formatujLiczbe(adjustments);
    };

    const setSummarySectionCollapsed = ({ cardId, toggleEl, contentEl, collapsed = false }) => {
        const card = cardId ? document.getElementById(cardId) : null;
        if (!toggleEl || !contentEl || !card) return;
        card.classList.toggle('is-collapsed', Boolean(collapsed));
        toggleEl.setAttribute('aria-expanded', String(!collapsed));
        contentEl.hidden = Boolean(collapsed);
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
            if (l4SectionCounter) l4SectionCounter.textContent = '0 wpisów';
            return;
        }
        const total = yearData.sum.l4Days;
        const monthsWithL4 = yearData.months.filter(m => Number(m.l4Days) > 0).length;
        if (l4SectionCounter) l4SectionCounter.textContent = `${monthsWithL4} mies. / ${formatDaysValue(total)} dni`;
        const rows = yearData.months.map(m => `<tr><td>${m.label}</td><td class="num">${m.l4Days}</td></tr>`).join('');
        l4SummaryContainer.innerHTML = `
            <table class="tbl">
                <thead><tr><th>Miesiąc</th><th>L4 (dni)</th></tr></thead>
                <tbody>${rows}</tbody>
                <tfoot><tr><td>Suma roczna</td><td class="num">${total}</td></tr></tfoot>
            </table>`;
    }

    const getUsedLeaveDays = (entries = [], year) => {
        const days = new Map();
        (entries || []).forEach(entry => {
            const normalized = normalizeDayRecord(entry.id || entry.date, entry);
            const isLeave = normalized.flags?.urlop || normalized.leaveKind === 'URL';
            if (!isLeave) return;
            const key = normalizeDayKey(normalized.date || normalized.id, 'vacation.used');
            if (!key) return;
            if (Number(key.slice(0, 4)) !== Number(year)) return;
            const amount = parseLeaveAmount(normalized.leaveAmount, 1);
            days.set(key, Math.max(Number(days.get(key) || 0), amount));
        });
        return [...days.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, amount]) => ({ date, amount }));
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

    const countDaysInRange = (startDate, endDate, explicitDays = null) => {
        const explicit = normalizeHalfDayValue(explicitDays, { min: 0, fallback: 0 });
        if (explicit > 0) return explicit;
        const days = listDaysInclusive(startDate, endDate);
        return days.filter(day => !isWeekendDay(day)).length;
    };

    const renderUsedLeaveList = () => {
        if (!vacationUsedList) return;
        const usedDays = getUsedLeaveDays(selectedYearEntries, selectedYear);
        if (!usedDays.length) {
            vacationUsedList.innerHTML = '<p>Brak wykorzystanych dni urlopu w wybranym roku.</p>';
            return;
        }
        const grouped = groupDatesByMonth(usedDays.map(item => item.date));
        const blocks = [];
        grouped.forEach((dates, monthKey) => {
            const label = formatujMiesiac(monthKey);
            const items = dates.map(day => {
                const matched = usedDays.find(item => item.date === day);
                const suffix = matched && Number(matched.amount) < 1 ? ` (${formatDaysValue(matched.amount)})` : '';
                return `<li>${formatDateLabel(day)}${suffix}</li>`;
            }).join('');
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
            leaveDays: normalizeHalfDayValue(data.leaveDays, { min: 0, fallback: 0 }) > 0
                ? normalizeHalfDayValue(data.leaveDays, { min: 0.5, fallback: 0.5 })
                : null,
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
        if (plannedLeaveDaysInput) plannedLeaveDaysInput.value = entry.leaveDays ? String(entry.leaveDays) : '';
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
            plannedLeaveList.innerHTML = '<p class="empty-state">Brak zaplanowanych urlopów w wybranym roku.</p>';
            plannedLeaveTotalSpan.textContent = '0';
            if (plannedLeaveTotalPanelSpan) plannedLeaveTotalPanelSpan.textContent = '0';
            refreshPlannedLeaveDecorations();
            return 0;
        }
        const totalDays = getPlannedLeaveTotal(plannedLeaveEntries);
        const formattedTotal = formatujLiczbe(totalDays);
        plannedLeaveTotalSpan.textContent = formattedTotal;
        if (plannedLeaveTotalPanelSpan) plannedLeaveTotalPanelSpan.textContent = formattedTotal;
        plannedLeaveList.innerHTML = plannedLeaveEntries.map(entry => {
            const count = countDaysInRange(entry.startDate, entry.endDate, entry.leaveDays);
            const rangeLabel = `${formatDateLabel(entry.startDate)} → ${formatDateLabel(entry.endDate)}`;
            const noteText = entry.note || 'Brak notatki';
            return `
                <div class="planned-leave-item" data-id="${entry.id}">
                    <div class="planned-leave-item__head">
                        <strong>${rangeLabel}</strong>
                        <span class="planned-leave-item__type">${entry.type || '—'}</span>
                    </div>
                    <div class="planned-leave-item__meta">
                        <span><b>${formatDaysValue(count)}</b> dni</span>
                        <span>liczono dni robocze</span>
                    </div>
                    <p class="planned-leave-item__note">Notatka: ${noteText}</p>
                    <div class="actions">
                        <button type="button" class="btn-secondary" data-action="edit" data-id="${entry.id}">Edytuj</button>
                        <button type="button" class="btn-remove" data-action="delete" data-id="${entry.id}">Usuń</button>
                    </div>
                </div>
            `;
        }).join('');
        refreshPlannedLeaveDecorations();
        return totalDays;
    };

    async function refreshPlannedLeaveEntries() {
        plannedLeaveEntries = await listPlannedLeave(selectedYear);
        const total = renderPlannedLeaveList();
        updateUnfinishedSummary();
        return Number(total) || 0;
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
        const summary = await obliczPodsumowaniaMiesieczne(selectedYearEntries);
        selectedYearSummary = (summary.years || []).find(y => Number(y.year) === Number(selectedYear)) || null;
        selectedYearTotals = (summary.sumyRocznePerRok || []).find(r => Number(r.rok) === Number(selectedYear)) || null;
    }

    async function renderVacationSummary() {
        if (!vacationAllowanceInput || !vacationUsedSpan || !vacationRemainingSpan || !vacationAdjustmentsDiv) return;
        const allowance = await getVacationAllowance(selectedYear);
        vacationAllowanceInput.value = allowance;
        let plannedTotal = 0;
        try {
            plannedTotal = await refreshPlannedLeaveEntries();
        } catch (error) {
            console.error('[vacation] refresh planned leave failed', error);
        }

        const adjustments = await listVacationAdjustments(selectedYear);
        const adjustmentsSum = adjustments.reduce((acc, adj) => acc + (Number(adj.days) || 0), 0);
        const yearTotals = getSelectedYearTotals();
        const usedFromCalendar = Number(yearTotals?.urlopDaysUsed) || 0;
        const remaining = calcVacationRemaining(allowance, usedFromCalendar, plannedTotal, adjustmentsSum);

        vacationUsedSpan.textContent = formatujLiczbe(usedFromCalendar);
        if (vacationAdjustmentsTotalSpan) vacationAdjustmentsTotalSpan.textContent = formatujLiczbe(adjustmentsSum);
        vacationRemainingSpan.textContent = formatujLiczbe(remaining);
        setVacationCollapsedSummary({
            remaining,
            used: usedFromCalendar,
            planned: plannedTotal,
            adjustments: adjustmentsSum
        });

        vacationAdjustmentsDiv.innerHTML = adjustments.length
            ? `<ul class="adjustments-list">${adjustments.map(adj => `
                <li data-id="${adj.id}">
                    <div class="adjustment-content">
                        <span class="adjustment-date">${formatDateLabel(adj.date, 'Brak daty')}</span>
                        <span class="adjustment-days">${formatDaysValue(adj.days)}</span>
                        <span class="adjustment-note">${adj.note || 'Bez notatki'}</span>
                    </div>
                    <button type="button" class="btn-remove adjustment-remove" data-id="${adj.id}">Usuń</button>
                </li>`).join('')}</ul>`
            : '<p class="empty-state">Brak korekt urlopu.</p>';

        renderUsedLeaveList();
    }

    async function renderPodsumowanie() {
        await ensureSelectedYearData();
        try { renderRocznePodsumowanie(); } catch (error) { console.error('[summary] annual render failed', error); }
        try { renderQuarterlyBonusSummary(); } catch (error) { console.error('[summary] quarterly render failed', error); }
        try { renderL4Summary(); } catch (error) { console.error('[summary] L4 render failed', error); }
        try { await renderVacationSummary(); } catch (error) { console.error('[summary] vacation render failed', error); }
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
        ostatnieZestawienieMiesieczne = await obliczPodsumowaniaMiesieczne(wszystkieWpisyKalendarza);
        window.ostatnieZestawienieMiesieczne = ostatnieZestawienieMiesieczne;
        if (miesiacSummaryInput && ostatnieZestawienieMiesieczne.miesiace.length) {
            const miesiace = ostatnieZestawienieMiesieczne.miesiace;
            const aktualny = miesiacSummaryInput.value;
            if (!aktualny || !miesiace.some(m => m.miesiac === aktualny)) {
                miesiacSummaryInput.value = miesiace[miesiace.length - 1].miesiac;
            }
        }
        const yearsFromData = getAvailableYears(wszystkieWpisyKalendarza);
        const yearsFromInvoices = (ostatnieZestawienieMiesieczne.lata || []).map(Number).filter(Number.isFinite);
        availableSummaryYears = getYearsSortedDesc([...yearsFromData, ...yearsFromInvoices, currentYear]);
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

    const renderFinanceLockScreen = (errorMsg = '') => {
        if (!financeView) return;
        financeView.innerHTML = `
            <section class="summary-container-subtle finance-lock">
                <h3>Finanse</h3>
                <p>Ta sekcja jest dodatkowo zabezpieczona.</p>
                <form id="finance-unlock-form" class="finance-lock-form">
                    <input type="password" id="finance-password" placeholder="Hasło" autocomplete="current-password" required>
                    <button type="submit">Odblokuj</button>
                </form>
                <p id="finance-unlock-error" class="form-error">${errorMsg || ''}</p>
            </section>
        `;
    };

    const getFinanceAgroAggregation = () => {
        const months = getFinanceMonthsForYear(financeYear, 2026, 1);
        return aggregateAgroEffectYear(months, financeAgroRowsByMonth);
    };

    const renderFinanceAgroTab = () => {
        if (!financeView) return;
        const years = getFinanceYearOptions(2026);
        const { rows, totals } = getFinanceAgroAggregation();
        if (financeAgroEditingMonth && !rows.some((row) => row.monthKey === financeAgroEditingMonth)) {
            financeAgroEditingMonth = null;
            financeAgroDraft = null;
        }
        financeView.innerHTML = `
            <section class="summary-container-subtle finance-panel">
                <div class="finance-topbar">
                    <div class="finance-tabs" id="finance-inner-tabs">
                        <button type="button" class="btn-ghost ${financeInnerTab === 'agro' ? 'is-active' : ''}" data-finance-tab="agro">Agro-Efekt</button>
                        <button type="button" class="btn-ghost ${financeInnerTab === 'overtime' ? 'is-active' : ''}" data-finance-tab="overtime">Praca po godzinach</button>
                    </div>
                    <button type="button" class="btn-secondary" id="finance-lock-btn">Zablokuj finanse</button>
                </div>
                <div class="finance-toolbar">
                    <label for="finance-year">Rok:</label>
                    <select id="finance-year">${years.map((year) => `<option value="${year}" ${year === financeYear ? 'selected' : ''}>${year}</option>`).join('')}</select>
                </div>
                ${renderAgroEffectTotalsHtml(totals)}
                ${renderAgroEffectRowsHtml(rows, financeAgroEditingMonth, financeAgroDraft)}
            </section>
        `;
    };

    const renderFinanceOvertimeTab = () => {
        if (!financeView) return;
        const years = getFinanceYearOptions(2026);
        const yearly = aggregateOvertimeYear(financeOvertimeEntries, financeOvertimeYear);
        const existingMonthKeys = new Set(yearly.monthly.map((row) => row.monthKey));
        financeOvertimeExpandedMonths = new Set([...financeOvertimeExpandedMonths].filter((key) => existingMonthKeys.has(key)));
        if (financeOvertimeFormMonth && !existingMonthKeys.has(financeOvertimeFormMonth)) {
            financeOvertimeFormMonth = null;
            financeOvertimeEditId = null;
        }
        const activeEditingEntry = financeOvertimeEntries.find((entry) => entry.id === financeOvertimeEditId) || null;
        financeView.innerHTML = `
            <section class="summary-container-subtle finance-panel">
                <div class="finance-topbar">
                    <div class="finance-tabs" id="finance-inner-tabs">
                        <button type="button" class="btn-ghost ${financeInnerTab === 'agro' ? 'is-active' : ''}" data-finance-tab="agro">Agro-Efekt</button>
                        <button type="button" class="btn-ghost ${financeInnerTab === 'overtime' ? 'is-active' : ''}" data-finance-tab="overtime">Praca po godzinach</button>
                    </div>
                    <button type="button" class="btn-secondary" id="finance-lock-btn">Zablokuj finanse</button>
                </div>
                <div class="finance-toolbar">
                    <label for="finance-overtime-year">Rok:</label>
                    <select id="finance-overtime-year">${years.map((year) => `<option value="${year}" ${year === financeOvertimeYear ? 'selected' : ''}>${year}</option>`).join('')}</select>
                </div>
                ${renderOvertimeYearSummaryHtml({
                    totalNet: yearly.totalNet,
                    totalEntries: yearly.totalEntries,
                    bestMonth: yearly.bestMonth,
                    bestClient: yearly.clientsRanking[0] || null
                })}
                ${renderOvertimeMonthlyCardsHtml({
                    monthly: yearly.monthly,
                    expandedMonths: financeOvertimeExpandedMonths,
                    activeFormMonth: financeOvertimeFormMonth,
                    editingEntry: activeEditingEntry
                })}
                ${renderOvertimeClientTotalsHtml(yearly.clientsRanking)}
            </section>
        `;
    };

    const renderFinanceView = () => {
        if (!financeUnlocked) {
            renderFinanceLockScreen('');
            return;
        }
        if (financeInnerTab === 'overtime') {
            renderFinanceOvertimeTab();
            return;
        }
        renderFinanceAgroTab();
    };

    const loadFinanceData = async () => {
        financeAgroRowsByMonth = await loadAgroEffectYear(db, financeYear);
        financeOvertimeEntries = await listOvertimeEntriesForYear(db, financeOvertimeYear);
    };

    const initFinanceModule = async () => {
        if (!financeView) return;
        financeYear = Number.isFinite(financeYear) ? financeYear : 2026;
        financeOvertimeYear = Number.isFinite(financeOvertimeYear) ? financeOvertimeYear : 2026;
        try {
            await loadFinanceData();
        } catch (error) {
            console.error('[finance] load failed', error);
        }
        renderFinanceView();
    };

    const saveAgroMonth = async (monthKey, values = {}) => {
        if (!monthKey) return;
        const current = financeAgroRowsByMonth[monthKey] || { baseNet: 0, bonusNet: 0 };
        const next = {
            ...current,
            baseNet: Math.max(0, Number(values.baseNet) || 0),
            bonusNet: Math.max(0, Number(values.bonusNet) || 0)
        };
        financeAgroRowsByMonth = { ...financeAgroRowsByMonth, [monthKey]: next };
        await saveAgroEffectMonth(db, financeYear, monthKey, next);
        renderFinanceView();
    };

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
            const report = computeYearReport({ ...reportData, orders: _wszystkieZleceniaCache });
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

  const shouldSkipCollapseToggle = (target) => Boolean(
    target?.closest?.('select, option, input, textarea, button, a, [data-no-collapse="true"]')
  );

  if (vacationSectionToggle && vacationSectionContent) {
    setSummarySectionCollapsed({
      cardId: 'sum-urlop',
      toggleEl: vacationSectionToggle,
      contentEl: vacationSectionContent,
      collapsed: vacationSectionCollapsed
    });
    vacationSectionToggle.addEventListener('click', (event) => {
      if (shouldSkipCollapseToggle(event.target)) return;
      vacationSectionCollapsed = !vacationSectionCollapsed;
      setSummarySectionCollapsed({
        cardId: 'sum-urlop',
        toggleEl: vacationSectionToggle,
        contentEl: vacationSectionContent,
        collapsed: vacationSectionCollapsed
      });
    });
    vacationSectionToggle.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      vacationSectionCollapsed = !vacationSectionCollapsed;
      setSummarySectionCollapsed({
        cardId: 'sum-urlop',
        toggleEl: vacationSectionToggle,
        contentEl: vacationSectionContent,
        collapsed: vacationSectionCollapsed
      });
    });
  }

  if (l4SectionToggle && l4SectionContent) {
    setSummarySectionCollapsed({
      cardId: 'sum-l4',
      toggleEl: l4SectionToggle,
      contentEl: l4SectionContent,
      collapsed: l4SectionCollapsed
    });
    l4SectionToggle.addEventListener('click', (event) => {
      if (shouldSkipCollapseToggle(event.target)) return;
      l4SectionCollapsed = !l4SectionCollapsed;
      setSummarySectionCollapsed({
        cardId: 'sum-l4',
        toggleEl: l4SectionToggle,
        contentEl: l4SectionContent,
        collapsed: l4SectionCollapsed
      });
    });
    l4SectionToggle.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      l4SectionCollapsed = !l4SectionCollapsed;
      setSummarySectionCollapsed({
        cardId: 'sum-l4',
        toggleEl: l4SectionToggle,
        contentEl: l4SectionContent,
        collapsed: l4SectionCollapsed
      });
    });
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

    const normalizeMachineType = (value = '') => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const found = MACHINE_TYPE_OPTIONS.find((option) => option.toLowerCase() === raw.toLowerCase());
        return found || raw;
    };

    const populateMachineTypeSelect = (selectElement, { includePlaceholder = false } = {}) => {
        if (!selectElement) return;
        const currentValue = normalizeMachineType(selectElement.value);
        const options = [];
        if (includePlaceholder) {
            options.push('<option value="">-- Wybierz typ --</option>');
        }
        MACHINE_TYPE_OPTIONS.forEach((option) => {
            options.push(`<option value="${option}">${option}</option>`);
        });
        const shouldAppendCurrent = currentValue && !MACHINE_TYPE_OPTIONS.includes(currentValue);
        if (shouldAppendCurrent) {
            options.push(`<option value="${currentValue}">${currentValue}</option>`);
        }
        selectElement.innerHTML = options.join('');
        selectElement.value = currentValue;
    };

    const initializeMachineTypeSelects = () => {
        populateMachineTypeSelect(maszynaTypSelect, { includePlaceholder: true });
        populateMachineTypeSelect(editMaszynaTypSelect);
        populateMachineTypeSelect(clientMachineTypInput, { includePlaceholder: true });
    };

    // --- KLIENCI ---
    async function dodajKlienta(event) {
        event.preventDefault();
        const shouldCreateMachine = Boolean(clientAddMachineToggle?.checked);
        const machineType = normalizeMachineType(clientMachineTypInput?.value || '');
        const machineModel = (clientMachineModelInput?.value || '').trim();
        if (shouldCreateMachine && (!machineType || !machineModel)) {
            alert('Aby dodać klienta z maszyną, uzupełnij przynajmniej typ i model maszyny.');
            return;
        }
        const dane = {
            nazwa: klientForm['klient-nazwa'].value,
            nip: klientForm['klient-nip'].value || '---',
            adres: klientForm['klient-adres'].value || '---',
            telefon: klientForm['klient-telefon'].value || '---',
            createdAt: new Date()
        };
        try {
            const clientRef = await addDoc(collection(db, "klienci"), dane);
            if (shouldCreateMachine) {
                await addDoc(collection(db, "maszyny"), {
                    klientId: clientRef.id,
                    klientNazwa: dane.nazwa || '(bez nazwy)',
                    typMaszyny: machineType,
                    model: machineModel,
                    nrSeryjny: (clientMachineSerialInput?.value || '').trim() || '---',
                    rokProdukcji: Number(clientMachineYearInput?.value) || null,
                    motogodziny: Number(clientMachineMthInput?.value) || 0,
                    createdAt: new Date()
                });
            }
            klientForm.reset();
            if (clientAddMachineFields) clientAddMachineFields.hidden = true;
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
          return `
            <div class="client-machine-row">
              <button type="button" class="client-machine-link" data-maszyna-id="${m.id}" data-client-id="${klient.id}">${naz || 'Maszyna'} • S/N: ${sn}</button>
              <button type="button" class="btn-secondary btn-small copy-serial-btn" data-serial="${sn}" title="Kopiuj numer seryjny">Kopiuj numer seryjny</button>
            </div>
          `;
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
    renderClientStatsView();
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
let selectedClientStatsId = null;

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
        if (clientAddMachineToggle) clientAddMachineToggle.checked = false;
        if (clientAddMachineFields) clientAddMachineFields.hidden = true;
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
    if (clientAddMachineToggle) clientAddMachineToggle.checked = false;
    if (clientAddMachineFields) clientAddMachineFields.hidden = true;
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
  const copySerialBtn = event.target.closest('.copy-serial-btn');
  if (copySerialBtn) {
    event.preventDefault();
    event.stopPropagation();
    const serial = copySerialBtn.dataset.serial;
    if (!serial || serial === '—') {
      alert('Brak numeru seryjnego do skopiowania.');
      return;
    }
    const copied = await copyTextToClipboard(serial);
    if (copied) {
      showCopyFeedback(copySerialBtn, 'Skopiowano');
      showToastMessage('Skopiowano numer seryjny');
    } else {
      alert('Nie udało się skopiować numeru seryjnego.');
    }
    return;
  }

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
            const machineId = String(maszynaId || '').trim();
            const closedStatuses = ['zakończone', 'zakonczone', 'ukończone', 'closed'];
            console.debug('[machines:history] start', { machineId, closedStatuses });
            if (!machineId) {
                machineHistoryList.innerHTML = '<p style="color: red;">Nieprawidłowy identyfikator maszyny.</p>';
                return;
            }

            const historySnapshots = await Promise.allSettled([
                getDocs(query(
                    collection(db, "zlecenia"),
                    where("maszynaId", "==", machineId),
                    where("status", "in", closedStatuses)
                )),
                getDocs(query(
                    collection(db, "zlecenia"),
                    where("machineId", "==", machineId),
                    where("status", "in", closedStatuses)
                ))
            ]);

            const historyDocsMap = new Map();
            let hasAtLeastOneQuerySuccess = false;
            historySnapshots.forEach((result) => {
                if (result.status !== 'fulfilled') return;
                hasAtLeastOneQuerySuccess = true;
                result.value.forEach((docSnap) => {
                    historyDocsMap.set(docSnap.id, docSnap);
                });
            });
            if (!hasAtLeastOneQuerySuccess) {
                const firstError = historySnapshots.find((res) => res.status === 'rejected')?.reason;
                throw firstError || new Error('Nie udało się pobrać historii serwisowej.');
            }

            const historyDocs = [...historyDocsMap.values()];
            console.debug('[machines:history] query result', { machineId, records: historyDocs.length });

            const fallbackHistory = historyDocs.length === 0
                ? (_wszystkieZleceniaCache || [])
                    .filter((order) => {
                        const orderMachineId = String(order?.maszynaId || order?.machineId || '').trim();
                        return orderMachineId === machineId && (isOrderClosed(order) || closedStatuses.includes((order?.status || '').toLowerCase()));
                    })
                    .map((order) => ({ id: order.id, data: () => order }))
                : [];
            const historyRows = historyDocs.length > 0 ? historyDocs : fallbackHistory;

            historyRows.sort((a, b) => {
                const aDate = resolveServiceDate(a.data()) || '';
                const bDate = resolveServiceDate(b.data()) || '';
                return bDate.localeCompare(aDate);
            });

            let rowsHtml = '';
            if (historyRows.length > 0) {
                historyRows.forEach((d) => {
                    const zlecenie = d.data();
                    const serviceDate = resolveServiceDate(zlecenie);
                    const klient = _wszystkieKlienciCache.find((item) => item.id === zlecenie.klientId);
                    const clientLabel = zlecenie.klientNazwa || klient?.nazwa || '—';
                    const invoicedHours = Number(zlecenie.wyfakturowaneGodziny ?? zlecenie.invoicedHours ?? 0) || 0;
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
                            <td>${clientLabel}</td>
                            <td><strong>${invoicedHours}h</strong></td>
                            <td>
                                <div><em>${zlecenie.opis || 'Brak'}</em></div>
                                <div>Typ: <strong>${zlecenie.typZlecenia || '?'}</strong>${uzyteCzesciHtml}${wzHtml}${notatkaHtml}</div>
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
                ? `<table class="table machine-history-table"><thead><tr><th>Data</th><th>Nr zlecenia</th><th>Klient</th><th>Fakturowane godziny</th><th>Opis</th><th>Motogodziny</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table>`
                : '<p>Brak historii serwisowej dla tej maszyny.</p>';


        } catch (error) {
            console.error("Błąd podczas pobierania historii serwisowej:", error?.message || error);
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
            typMaszyny: normalizeMachineType(maszynaForm['maszyna-typ'].value),
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
                            <button type="button" class="btn-secondary btn-small copy-serial-btn" data-serial="${sn}" title="Kopiuj numer seryjny">Kopiuj numer seryjny</button>
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
            renderClientStatsView();
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

  const copySerialBtn = el.closest('.copy-serial-btn');
  if (copySerialBtn) {
    event.preventDefault();
    event.stopPropagation();
    const serial = copySerialBtn.dataset.serial;
    if (!serial || serial === '—') {
      alert('Brak numeru seryjnego do skopiowania.');
      return;
    }
    const copied = await copyTextToClipboard(serial);
    if (copied) {
      showCopyFeedback(copySerialBtn, 'Skopiowano');
      showToastMessage('Skopiowano numer seryjny');
    } else {
      alert('Nie udało się skopiować numeru seryjnego.');
    }
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
    populateMachineTypeSelect(editMaszynaTypSelect);
    editMaszynaForm['edit-maszyna-typ'].value = normalizeMachineType(maszyna.typMaszyny);
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
    const nowyTyp = normalizeMachineType(editMaszynaForm['edit-maszyna-typ'].value);
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

function resolveOrderIdentity(order = {}) {
    const explicitRoot = String(order.rootOrderId || order.mainOrderId || '').trim();
    if (explicitRoot) return explicitRoot;
    const normalizedNumber = String(order.nrZlecenia || '').trim().toLowerCase();
    if (normalizedNumber) return `nr:${normalizedNumber}`;
    return String(order.id || '').trim();
}

function resolveOrderLastChangeTs(order = {}) {
    const historyTs = Array.isArray(order.historia)
        ? order.historia.reduce((latest, entry) => {
            const ts = Date.parse(entry?.timestamp || '');
            if (!Number.isFinite(ts)) return latest;
            return ts > latest ? ts : latest;
        }, 0)
        : 0;
    const candidates = [
        order.updatedAt,
        order.completionDate,
        order.completedOn,
        order.serviceDate,
        order.dataUkonczenia,
        order.completedAt,
        order.createdOn,
        order.createdDate,
        order.createdAt
    ]
        .map((value) => Date.parse(value || ''))
        .filter((value) => Number.isFinite(value));
    return Math.max(historyTs, ...candidates, 0);
}

function mergeOrderHistory(group = []) {
    const dedupe = new Map();
    group.forEach((order) => {
        const historyEntries = Array.isArray(order?.historia) ? order.historia : [];
        historyEntries.forEach((entry) => {
            const timestamp = entry?.timestamp || '';
            const action = entry?.akcja || '';
            const key = `${timestamp}|${action}`;
            if (!dedupe.has(key)) dedupe.set(key, { timestamp, akcja: action });
        });
    });
    return [...dedupe.values()].sort((a, b) => Date.parse(a.timestamp || '') - Date.parse(b.timestamp || ''));
}

function buildCanonicalOrders(orders = []) {
    const groups = new Map();
    (orders || []).forEach((order) => {
        const key = resolveOrderIdentity(order);
        if (!key) return;
        const current = groups.get(key) || [];
        current.push(order);
        groups.set(key, current);
    });

    const canonical = [];
    const duplicates = [];
    groups.forEach((group, identity) => {
        if (!group.length) return;
        const sortedGroup = group.slice().sort((a, b) => {
            const diff = resolveOrderLastChangeTs(b) - resolveOrderLastChangeTs(a);
            if (diff !== 0) return diff;
            const aPriority = a?.status === 'aktywne' ? 1 : 0;
            const bPriority = b?.status === 'aktywne' ? 1 : 0;
            return bPriority - aPriority;
        });
        const leader = sortedGroup[0];
        const mergedHistory = mergeOrderHistory(sortedGroup);
        canonical.push({
            ...leader,
            rootOrderId: leader?.rootOrderId || leader?.id || null,
            historia: mergedHistory
        });
        if (sortedGroup.length > 1) {
            duplicates.push({
                identity,
                leaderId: leader?.id || null,
                duplicateIds: sortedGroup.slice(1).map((entry) => entry?.id).filter(Boolean)
            });
        }
    });

    return { canonical, duplicates };
}

function createZlecenieListItem(zlecenie, { headerHtml = '', bodyHtml = '', metaHtml = '', actionsHtml = '', status = '' } = {}) {
    const li = document.createElement('li');
    li.dataset.id = zlecenie.id;
    li.className = `order-list-item ${status ? `is-${status}` : ''}`;
    const content = document.createElement('div');
    content.className = 'order-list-item__content';
    if (headerHtml) {
        const header = document.createElement('div');
        header.className = 'order-list-item__header';
        header.innerHTML = headerHtml;
        content.appendChild(header);
    }
    if (bodyHtml) {
        const body = document.createElement('div');
        body.className = 'order-list-item__body';
        body.dataset.expandSection = 'body';
        body.innerHTML = bodyHtml;
        content.appendChild(body);
    }
    if (metaHtml) {
        const meta = document.createElement('div');
        meta.className = 'order-list-item__meta';
        meta.dataset.expandSection = 'meta';
        meta.innerHTML = metaHtml;
        content.appendChild(meta);
    }
    const actions = document.createElement('div');
    actions.className = 'order-list-item__actions';
    actions.dataset.expandSection = 'actions';
    actions.innerHTML = actionsHtml;
    li.appendChild(content);
    li.appendChild(actions);
    return li;
}

function buildClientStatsRows() {
    const statsByClient = new Map();
    const machinesByClient = new Map();
    const normalizeClientNameKey = (value) => String(value || '').trim().toLowerCase();
    const getOrderNumberCandidates = (order = {}) => {
        const candidates = [
            order?.nrZlecenia,
            order?.orderNo,
            order?.numerZlecenia,
            order?.zlecenieNumer,
            order?.number
        ]
            .map((value) => String(value || '').trim())
            .filter(Boolean);
        return [...new Set(candidates)];
    };
    const buildClientDriveAggregation = (entries = []) => {
        const orderClientByOrderId = new Map();
        const orderIdByNumber = new Map();
        const uniqueClientIdByName = new Map();
        const ambiguousClientNames = new Set();
        const driveByClient = new Map();
        const driveByClientMonth = new Map();
        const driveByOrder = new Map();

        (_wszystkieZleceniaCache || []).forEach((order) => {
            if (!order?.id) return;
            const clientId = String(order?.klientId || '').trim();
            if (clientId) orderClientByOrderId.set(String(order.id), clientId);
            getOrderNumberCandidates(order).forEach((number) => {
                if (!orderIdByNumber.has(number)) orderIdByNumber.set(number, String(order.id));
            });
        });
        (_wszystkieKlienciCache || []).forEach((client) => {
            const clientId = String(client?.id || '').trim();
            if (!clientId) return;
            const nameKey = normalizeClientNameKey(client?.nazwa);
            if (!nameKey) return;
            if (uniqueClientIdByName.has(nameKey) && uniqueClientIdByName.get(nameKey) !== clientId) {
                ambiguousClientNames.add(nameKey);
                uniqueClientIdByName.delete(nameKey);
                return;
            }
            if (!ambiguousClientNames.has(nameKey)) uniqueClientIdByName.set(nameKey, clientId);
        });

        const resolveClientIdForDrive = ({ linked, dayEntry }) => {
            const directOrderIdRaw = linked?.zlecenieId ?? linked?.orderId ?? linked?.linkedOrderId ?? linked?.id ?? null;
            const directOrderId = directOrderIdRaw ? String(directOrderIdRaw).trim() : '';
            if (directOrderId && orderClientByOrderId.has(directOrderId)) {
                return { clientId: orderClientByOrderId.get(directOrderId), orderId: directOrderId };
            }

            const orderNumberRaw = linked?.nrZlecenia ?? linked?.orderNo ?? linked?.numerZlecenia ?? linked?.zlecenieNumer ?? dayEntry?.nrZlecenia ?? dayEntry?.orderNo ?? null;
            const orderNumber = orderNumberRaw ? String(orderNumberRaw).trim() : '';
            if (orderNumber && orderIdByNumber.has(orderNumber)) {
                const resolvedOrderId = orderIdByNumber.get(orderNumber);
                const resolvedClientId = orderClientByOrderId.get(resolvedOrderId);
                if (resolvedClientId) return { clientId: resolvedClientId, orderId: resolvedOrderId };
            }

            const directClientIdRaw = linked?.klientId ?? linked?.clientId ?? dayEntry?.klientId ?? dayEntry?.clientId ?? null;
            const directClientId = directClientIdRaw ? String(directClientIdRaw).trim() : '';
            if (directClientId && statsByClient.has(directClientId)) {
                return { clientId: directClientId, orderId: '' };
            }

            const clientNameRaw = linked?.klientNazwa ?? linked?.clientName ?? dayEntry?.klientNazwa ?? dayEntry?.clientName ?? null;
            const clientNameKey = normalizeClientNameKey(clientNameRaw);
            if (clientNameKey && uniqueClientIdByName.has(clientNameKey)) {
                return { clientId: uniqueClientIdByName.get(clientNameKey), orderId: '' };
            }
            return { clientId: '', orderId: '' };
        };
        const collectDriveLinks = (dayEntry = {}) => {
            const normalizedLinks = normalizujPowiazaneZlecenia(dayEntry).powiazane || [];
            const rawLinks = Array.isArray(dayEntry?.zleceniaPowiazane)
                ? dayEntry.zleceniaPowiazane
                : Array.isArray(dayEntry?.powiazane)
                    ? dayEntry.powiazane
                    : [];
            const fallbackSingle = (!normalizedLinks.length && !rawLinks.length && (dayEntry?.zlecenieId || dayEntry?.orderId))
                ? [{
                    zlecenieId: dayEntry?.zlecenieId ?? dayEntry?.orderId ?? null,
                    klientNazwa: dayEntry?.klientNazwa ?? dayEntry?.clientName ?? null,
                    klientId: dayEntry?.klientId ?? dayEntry?.clientId ?? null,
                    jazda: dayEntry?.driveForOrderHours ?? dayEntry?.czasJazdyDlaZlecenia ?? dayEntry?.jazda ?? dayEntry?.drive ?? 0
                }]
                : [];
            return [...normalizedLinks, ...rawLinks, ...fallbackSingle].map((linked, index) => ({
                linked,
                key: String(linked?.entryId || linked?.id || `${dayEntry?.id || dayEntry?.date || 'day'}:${linked?.zlecenieId || linked?.orderId || 'order'}:${index}`),
                drive: Number(linked?.driveForOrderHours ?? linked?.czasJazdyDlaZlecenia ?? linked?.drive ?? linked?.jazda ?? 0) || 0
            }));
        };

        (entries || []).forEach((entry) => {
            const dayKey = normalizeDayKey(entry?.date || entry?.id, 'client-stats.drive');
            const monthKey = dayKey ? dayKey.slice(0, 7) : '';
            const driveLinks = collectDriveLinks(entry);
            const seen = new Set();
            driveLinks.forEach(({ linked, key, drive }) => {
                if (!key || seen.has(key)) return;
                seen.add(key);
                if (!Number.isFinite(drive) || drive === 0) return;
                const { clientId, orderId } = resolveClientIdForDrive({ linked, dayEntry: entry });
                if (!clientId) return;
                driveByClient.set(clientId, (driveByClient.get(clientId) || 0) + drive);
                if (monthKey) {
                    if (!driveByClientMonth.has(clientId)) driveByClientMonth.set(clientId, new Map());
                    const monthMap = driveByClientMonth.get(clientId);
                    monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + drive);
                }
                if (orderId) {
                    driveByOrder.set(orderId, (driveByOrder.get(orderId) || 0) + drive);
                }
            });
        });
        return { driveByClient, driveByClientMonth, driveByOrder };
    };

    (_wszystkieMaszynyCache || []).forEach((maszyna) => {
        const clientId = maszyna?.klientId;
        if (!clientId) return;
        if (!machinesByClient.has(clientId)) machinesByClient.set(clientId, new Set());
        const label = `${maszyna?.typMaszyny || ''} ${maszyna?.model || ''}`.trim() || `Maszyna ${maszyna?.id || ''}`.trim();
        machinesByClient.get(clientId).add(label);
    });

    (_wszystkieKlienciCache || []).forEach((klient) => {
        if (!klient?.id) return;
        statsByClient.set(klient.id, {
            clientId: klient.id,
            name: klient.nazwa || '—',
            ordersCount: 0,
            billedHours: 0,
            driveHours: 0,
            gross: 0,
            net: 0,
            orders: [],
            machines: [...(machinesByClient.get(klient.id) || new Set())],
            monthly: new Map()
        });
    });
    const { driveByClient, driveByClientMonth, driveByOrder } = buildClientDriveAggregation(wszystkieWpisyKalendarza || []);

    (_wszystkieZleceniaCache || []).forEach((zlecenie) => {
        const clientId = zlecenie?.klientId;
        if (!clientId || !statsByClient.has(clientId)) return;
        const row = statsByClient.get(clientId);
        const amounts = computeOrderAmounts(zlecenie);
        const billedHours = Number(getOrderInvoicedHours(zlecenie)) || 0;
        const driveHours = Number(driveByOrder.get(zlecenie.id) || 0) || 0;
        const orderDate = normalizeDateOnly(
            zlecenie?.completionDate
            || zlecenie?.serviceDate
            || zlecenie?.dataUkonczenia
            || zlecenie?.completedOn
            || zlecenie?.createdDate
            || zlecenie?.createdOn
            || zlecenie?.createdAt
        );
        const monthKey = orderDate ? orderDate.slice(0, 7) : null;

        row.ordersCount += 1;
        row.billedHours += billedHours;
        row.gross += amounts.grossCents / 100;
        row.net += amounts.netCents / 100;
        row.orders.push({
            id: zlecenie.id,
            nr: zlecenie.nrZlecenia || '—',
            status: zlecenie.status || '—',
            date: orderDate,
            machine: `${zlecenie?.typMaszyny || ''} ${zlecenie?.model || ''}`.trim() || (zlecenie?.machineModelText || '—'),
            billedHours,
            driveHours,
            gross: amounts.grossCents / 100,
            net: amounts.netCents / 100
        });

        if (monthKey) {
            const monthRow = row.monthly.get(monthKey) || { month: monthKey, ordersCount: 0, billedHours: 0, driveHours: 0, gross: 0, net: 0 };
            monthRow.ordersCount += 1;
            monthRow.billedHours += billedHours;
            monthRow.gross += amounts.grossCents / 100;
            monthRow.net += amounts.netCents / 100;
            row.monthly.set(monthKey, monthRow);
        }
    });
    statsByClient.forEach((row, clientId) => {
        row.driveHours = Number(driveByClient.get(clientId) || 0) || 0;
        const driveMonths = driveByClientMonth.get(clientId);
        if (!driveMonths) return;
        driveMonths.forEach((driveValue, driveMonthKey) => {
            const monthRow = row.monthly.get(driveMonthKey) || { month: driveMonthKey, ordersCount: 0, billedHours: 0, driveHours: 0, gross: 0, net: 0 };
            monthRow.driveHours = Number(driveValue) || 0;
            row.monthly.set(driveMonthKey, monthRow);
        });
    });

    return [...statsByClient.values()].map((row) => ({
        ...row,
        orders: row.orders.sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
        monthly: [...row.monthly.values()].sort((a, b) => String(a.month).localeCompare(String(b.month)))
    }));
}

function renderClientStatsView() {
    if (!clientStatsRanking || !clientStatsDetails || !clientStatsSummary || !clientStatsTop) return;
    const queryText = (clientStatsSearchInput?.value || '').trim().toLowerCase();
    const sortMode = clientStatsSortSelect?.value || 'gross-desc';
    const rangeMode = clientStatsRangeSelect?.value || 'all';
    let rows = buildClientStatsRows();

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentYear = now.getFullYear();
    const rolling3m = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const isWithinRange = (dateText = '') => {
        if (rangeMode === 'all') return true;
        if (!dateText) return false;
        const monthKey = String(dateText).slice(0, 7);
        if (rangeMode === 'month') return monthKey === currentMonth;
        const year = Number(String(dateText).slice(0, 4));
        if (rangeMode === 'year') return year === currentYear;
        if (rangeMode === '3m') {
            const parsed = Date.parse(`${monthKey}-01T00:00:00Z`);
            return Number.isFinite(parsed) && parsed >= rolling3m.getTime();
        }
        return true;
    };

    rows = rows
        .map((row) => {
            const scopedOrders = row.orders.filter((order) => isWithinRange(order.date));
            const scoped = scopedOrders.reduce((acc, order) => {
                acc.ordersCount += 1;
                acc.billedHours += order.billedHours;
                acc.gross += order.gross;
                acc.net += order.net;
                return acc;
            }, { ordersCount: 0, billedHours: 0, driveHours: 0, gross: 0, net: 0 });
            const scopedMonthly = row.monthly.filter((month) => isWithinRange(`${month.month}-01`));
            scoped.driveHours = scopedMonthly.reduce((acc, month) => acc + (Number(month.driveHours) || 0), 0);
            return {
                ...row,
                ...scoped,
                orders: scopedOrders,
                monthly: scopedMonthly
            };
        })
        .filter((row) => row.ordersCount > 0 || rangeMode === 'all');

    if (queryText) {
        rows = rows.filter((row) => row.name.toLowerCase().includes(queryText));
    }

    const comparators = {
        'gross-desc': (a, b) => b.gross - a.gross,
        'net-desc': (a, b) => b.net - a.net,
        'orders-desc': (a, b) => b.ordersCount - a.ordersCount,
        'billed-desc': (a, b) => b.billedHours - a.billedHours,
        'drive-desc': (a, b) => b.driveHours - a.driveHours,
        'name-asc': (a, b) => a.name.localeCompare(b.name, 'pl')
    };
    rows.sort(comparators[sortMode] || comparators['gross-desc']);

    if (!rows.length) {
        clientStatsSummary.innerHTML = '<p class="loading-state">Brak danych w wybranym zakresie czasu.</p>';
        clientStatsTop.innerHTML = '';
        clientStatsRanking.innerHTML = '<p class="loading-state">Brak klientów do wyświetlenia w statystykach.</p>';
        clientStatsDetails.innerHTML = '<p class="loading-state">Wybierz klienta z rankingu, aby zobaczyć szczegóły.</p>';
        selectedClientStatsId = null;
        return;
    }

    if (!rows.some((row) => row.clientId === selectedClientStatsId)) {
        selectedClientStatsId = rows[0].clientId;
    }

    const summary = rows.reduce((acc, row) => {
        acc.clients += 1;
        acc.orders += row.ordersCount;
        acc.billed += row.billedHours;
        acc.drive += row.driveHours;
        acc.gross += row.gross;
        acc.net += row.net;
        return acc;
    }, { clients: 0, orders: 0, billed: 0, drive: 0, gross: 0, net: 0 });

    clientStatsSummary.innerHTML = `
        <div class="client-stats-summary-grid">
            <div class="metric"><div class="label">Liczba klientów</div><div class="value num">${summary.clients}</div></div>
            <div class="metric"><div class="label">Liczba zleceń</div><div class="value num">${summary.orders}</div></div>
            <div class="metric"><div class="label">Łączne wyfakturowane</div><div class="value num">${summary.billed.toFixed(1)} h</div></div>
            <div class="metric"><div class="label">Łączny czas jazdy</div><div class="value num">${summary.drive.toFixed(1)} h</div></div>
            <div class="metric"><div class="label">Łączne brutto</div><div class="value num">${summary.gross.toFixed(2)} zł</div></div>
            <div class="metric"><div class="label">Łączne netto</div><div class="value num">${summary.net.toFixed(2)} zł</div></div>
        </div>
    `;

    const topList = (label, sorter) => {
        const entries = [...rows].sort(sorter).slice(0, 5);
        return `
            <div class="client-top-card">
                <h4>${label}</h4>
                <ol>
                    ${entries.map((row) => `<li><button type="button" class="client-link-btn" data-client-stats-id="${row.clientId}">${row.name}</button></li>`).join('') || '<li>Brak danych</li>'}
                </ol>
            </div>
        `;
    };

    clientStatsTop.innerHTML = `
        <div class="client-top-grid">
            ${topList('Top 5 po brutto', (a, b) => b.gross - a.gross)}
            ${topList('Top 5 po wyfakturowanych', (a, b) => b.billedHours - a.billedHours)}
            ${topList('Top 5 po liczbie zleceń', (a, b) => b.ordersCount - a.ordersCount)}
            ${topList('Top 5 po czasie jazdy', (a, b) => b.driveHours - a.driveHours)}
        </div>
    `;

    clientStatsRanking.innerHTML = `
        <table class="table machine-history-table client-stats-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th>Klient</th>
                    <th>Liczba zleceń</th>
                    <th>Wyfakturowane godziny</th>
                    <th>Czas jazdy</th>
                    <th>Brutto</th>
                    <th>Netto</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map((row, index) => `
                    <tr class="client-stats-row ${row.clientId === selectedClientStatsId ? 'is-active' : ''}" data-client-stats-id="${row.clientId}">
                        <td>${index + 1}</td>
                        <td><button type="button" class="client-link-btn" data-client-stats-id="${row.clientId}"><strong>${row.name}</strong></button></td>
                        <td>${row.ordersCount}</td>
                        <td>${row.billedHours.toFixed(1)} h</td>
                        <td>${row.driveHours.toFixed(1)} h</td>
                        <td>${row.gross.toFixed(2)} zł</td>
                        <td>${row.net.toFixed(2)} zł</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    const selected = rows.find((row) => row.clientId === selectedClientStatsId) || rows[0];
    const avgOrderValue = selected.ordersCount ? (selected.gross / selected.ordersCount) : 0;
    const avgHoursPerOrder = selected.ordersCount ? (selected.billedHours / selected.ordersCount) : 0;
    const driveRatio = selected.billedHours > 0 ? (selected.driveHours / selected.billedHours) : null;

    clientStatsDetails.innerHTML = `
        <div class="summary-container-subtle client-stats-details-panel">
            <h3>${selected.name}</h3>
            <div class="order-card-row order-card-row--metrics">
                <p class="order-card-cell"><span class="key">Liczba zleceń</span><strong>${selected.ordersCount}</strong></p>
                <p class="order-card-cell"><span class="key">Wyfakturowane</span><strong>${selected.billedHours.toFixed(1)} h</strong></p>
                <p class="order-card-cell"><span class="key">Czas jazdy</span><strong>${selected.driveHours.toFixed(1)} h</strong></p>
                <p class="order-card-cell"><span class="key">Brutto</span><strong>${selected.gross.toFixed(2)} zł</strong></p>
                <p class="order-card-cell"><span class="key">Netto</span><strong>${selected.net.toFixed(2)} zł</strong></p>
                <p class="order-card-cell"><span class="key">Średnia wartość zlecenia</span><strong>${avgOrderValue.toFixed(2)} zł</strong></p>
                <p class="order-card-cell"><span class="key">Śr. godzin / zlecenie</span><strong>${avgHoursPerOrder.toFixed(2)} h</strong></p>
                <p class="order-card-cell"><span class="key">Stosunek jazdy / wyfakturowanych</span><strong>${driveRatio === null ? '—' : `${(driveRatio * 100).toFixed(1)}%`}</strong></p>
            </div>
            <h4>Maszyny klienta</h4>
            <div class="client-stats-machines">
                ${selected.machines.length ? selected.machines.map((machine) => `<span class="order-pill">${machine}</span>`).join('') : '<span class="client-meta">Brak maszyn</span>'}
            </div>
            <h4>Ostatnie zlecenia</h4>
            <table class="table machine-history-table client-stats-table client-stats-table--orders">
                <thead>
                    <tr><th>Numer</th><th>Data</th><th>Maszyna</th><th>Wyfakturowane</th><th>Brutto / Netto</th></tr>
                </thead>
                <tbody>
                    ${selected.orders.length
                        ? selected.orders.slice(0, 12).map((order) => `
                            <tr>
                                <td>#${order.nr}</td>
                                <td>${order.date || '—'}</td>
                                <td>${order.machine || '—'}</td>
                                <td>${order.billedHours.toFixed(1)} h</td>
                                <td>${order.gross.toFixed(2)} zł / ${order.net.toFixed(2)} zł</td>
                            </tr>
                        `).join('')
                        : '<tr><td colspan="5">Brak zleceń dla klienta.</td></tr>'
                    }
                </tbody>
            </table>
            <h4>Trend miesięczny</h4>
            <table class="table machine-history-table client-stats-table client-stats-table--trend">
                <thead>
                    <tr><th>Miesiąc</th><th>Liczba zleceń</th><th>Wyfakturowane</th><th>Jazda</th><th>Brutto</th><th>Netto</th></tr>
                </thead>
                <tbody>
                    ${selected.monthly.length
                        ? selected.monthly.map((month) => `
                            <tr>
                                <td>${month.month}</td>
                                <td>${month.ordersCount}</td>
                                <td>${month.billedHours.toFixed(1)} h</td>
                                <td>${month.driveHours.toFixed(1)} h</td>
                                <td>${month.gross.toFixed(2)} zł</td>
                                <td>${month.net.toFixed(2)} zł</td>
                            </tr>
                        `).join('')
                        : '<tr><td colspan="6">Brak danych miesięcznych dla tego klienta.</td></tr>'
                    }
                </tbody>
            </table>
        </div>
    `;
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
    const renderedOrderIds = new Set();

    const przefiltrowaneZlecenia = _wszystkieZleceniaCache.filter(zlecenie => {
        if (ordersFilterMode === 'unbilled') {
            const status = zlecenie?.status;
            if (!(status === 'zakończone' || status === 'zakonczone')) return false;
            const billed = Number(zlecenie?.wyfakturowaneGodziny ?? zlecenie?.wyfakturowane ?? 0) || 0;
            if (billed > 0) return false;
        }
        if (!frazaWyszukiwania) return true;
        const maszyna = _wszystkieMaszynyCache.find(m => m.id === zlecenie.maszynaId);
        const klient = _wszystkieKlienciCache.find(k => k.id === zlecenie.klientId);
        const quickMachineModel = (zlecenie.machineModelText || '').trim();
        const quickLabel = quickMachineModel ? `${zlecenie.nrZlecenia || 'Szybkie zlecenie'} - ${quickMachineModel}` : (zlecenie.nrZlecenia || 'Szybkie zlecenie');
        const nazwa = klient ? `${klient.nazwa} - ${maszyna ? maszyna.typMaszyny : ''} ${maszyna ? maszyna.model : ''}` : quickLabel;
        const tekst = `${nazwa} ${zlecenie.nrZlecenia} ${klient ? klient.nazwa : ''} ${maszyna ? maszyna.model : ''} ${maszyna ? maszyna.typMaszyny : ''} ${quickMachineModel}`.toLowerCase();
        return tekst.includes(frazaWyszukiwania);
    });
    const filteredOrderIds = new Set(przefiltrowaneZlecenia.map((zlecenie) => zlecenie?.id).filter(Boolean));
    expandedActiveOrderIds.forEach((orderId) => {
        if (!filteredOrderIds.has(orderId)) expandedActiveOrderIds.delete(orderId);
    });
    expandedClosedOrderIds.forEach((orderId) => {
        if (!filteredOrderIds.has(orderId)) expandedClosedOrderIds.delete(orderId);
    });

    przefiltrowaneZlecenia.forEach(zlecenie => {
        try {
            if (!zlecenie?.id || renderedOrderIds.has(zlecenie.id)) return;
            renderedOrderIds.add(zlecenie.id);
            wszystkieZlecenia.push(zlecenie);

            const maszyna = _wszystkieMaszynyCache.find(m => m.id === zlecenie.maszynaId);
            const klient = _wszystkieKlienciCache.find(k => k.id === zlecenie.klientId);
            const quickMachineModel = (zlecenie.machineModelText || '').trim();
            const quickLabel = quickMachineModel ? `${zlecenie.nrZlecenia || 'Szybkie zlecenie'} - ${quickMachineModel}` : (zlecenie.nrZlecenia || 'Szybkie zlecenie');
            const nazwa = klient ? `${klient.nazwa} - ${maszyna ? maszyna.typMaszyny : ''} ${maszyna ? maszyna.model : ''}` : quickLabel;
            const startLabel = normalizeDateOnly(zlecenie.startDate || zlecenie.startAt);
            const endLabel = normalizeDateOnly(zlecenie.completionDate || zlecenie.endAt || zlecenie.serviceDate);
            const timelineHtml = (startLabel || endLabel) ? `Start: ${startLabel || '—'}${endLabel ? ` • Koniec: ${endLabel}` : ''}` : 'Start: —';

            if (zlecenie.status === 'aktywne' || zlecenie.status === 'nieprzypisane') {
                const przycisk = zlecenie.status === 'nieprzypisane'
                    ? `<button type="button" class="assign-btn btn-edit" data-id="${zlecenie.id}">Przypisz</button>`
                    : `<button type="button" class="complete-btn" data-id="${zlecenie.id}">Zakończ</button>`;
                const statusLabel = zlecenie.status === 'nieprzypisane' ? 'Szybkie — nieprzypisane' : 'Aktywne';
                const machineLabel = klient
                    ? `${maszyna ? maszyna.typMaszyny : '—'} ${maszyna ? maszyna.model : ''}`.trim()
                    : (quickMachineModel || 'Brak przypisanej maszyny');
                const isExpanded = expandedActiveOrderIds.has(zlecenie.id);
                const activeListItem = createZlecenieListItem(
                    zlecenie,
                    {
                        status: 'active',
                        headerHtml: `
                            <div class="order-active-summary" role="group" aria-label="Skrót aktywnego zlecenia">
                                <p class="order-card-cell order-card-cell--identity"><span class="key">Zlecenie</span><strong>#${zlecenie.nrZlecenia || '—'}</strong></p>
                                <p class="order-card-cell order-card-cell--client"><span class="key">Klient</span><strong>${klient ? klient.nazwa : 'Brak (szybkie zlecenie)'}</strong></p>
                                <p class="order-card-cell order-card-cell--machine"><span class="key">Maszyna / model</span><strong>${machineLabel}</strong></p>
                                <p class="order-card-cell"><span class="key">Status</span><strong>${statusLabel}</strong></p>
                                <span class="order-expand-hint" aria-hidden="true">
                                    <span class="order-expand-hint__icon" data-expanded="${isExpanded ? 'true' : 'false'}">▾</span>
                                </span>
                            </div>
                        `,
                        bodyHtml: `
                            <div class="order-card-layout order-card-layout--active" role="group" aria-label="Dane aktywnego zlecenia">
                                <div class="order-card-row order-card-row--active-top">
                                    <p class="order-card-cell"><span class="key">Data startu</span><strong>${startLabel || '—'}</strong></p>
                                    <p class="order-card-cell"><span class="key">Status roboczy</span><strong>${statusLabel}</strong></p>
                                    <p class="order-card-cell"><span class="key">Najważniejsze dane</span><strong>${timelineHtml}</strong></p>
                                </div>
                                <div class="order-card-row order-card-row--active-middle">
                                    <p class="order-card-cell order-card-cell--machine"><span class="key">Maszyna / model</span><strong>${machineLabel}</strong></p>
                                    <p class="order-card-cell order-card-cell--client"><span class="key">Klient</span><strong>${klient ? klient.nazwa : 'Brak (szybkie zlecenie)'}</strong></p>
                                    <p class="order-card-cell order-card-cell--identity"><span class="key">Numer zlecenia</span><strong>#${zlecenie.nrZlecenia || '—'}</strong></p>
                                </div>
                                <p class="order-card-note"><span class="key">Opis usterki</span><span>${zlecenie.opis || 'Brak opisu'}</span></p>
                            </div>
                        `,
                        metaHtml: '',
                        actionsHtml: `
                    <button type="button" class="btn-szczegoly details-zlecenie-btn" data-id="${zlecenie.id}">Szczegóły</button>
                    <button type="button" class="btn-edit edit-zlecenie-btn" data-id="${zlecenie.id}">Edytuj</button>
                    ${przycisk}                    
                    <button type="button" class="delete-btn" data-id="${zlecenie.id}">Usuń</button>
                `
                    }
                );
                activeListItem.classList.toggle('is-expanded', isExpanded);
                activeListItem.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
                activeListItem.querySelectorAll('[data-expand-section]').forEach((section) => {
                    section.hidden = !isExpanded;
                });
                aktywneElements.push(activeListItem);
            } else if (zlecenie.status === 'zakończone') {
                const serviceDate = resolveServiceDate(zlecenie);
                if (resolveOrderBillingMonth(zlecenie) !== selectedMonth) {
                    return;
                }
                const amounts = computeOrderAmounts(zlecenie);
                const nazwaMaszyny = klient ? `${klient.nazwa} - ${maszyna ? maszyna.typMaszyny : ''} ${maszyna ? maszyna.model : ''}` : 'Zlecenie usuniętej maszyny';
                const uzyteCzesciList = zlecenie.uzyteCzesci?.length > 0 ? zlecenie.uzyteCzesci.map(c => `${c.nazwa} (x${c.ilosc})`).join(', ') : '';
                const wzLabel = zlecenie.zakonczenieNumerWZ || '';
                const notatkaLabel = zlecenie.zakonczenieNotatka || '';
                const motoHoursVal = Number.isFinite(Number(zlecenie.motoHours)) ? Number(zlecenie.motoHours) : 0;
                const machineLabel = maszyna ? `${maszyna.typMaszyny || ''} ${maszyna.model || ''}`.trim() : (quickMachineModel || 'Brak maszyny');
                const orderDescription = notatkaLabel || zlecenie.opis || 'Brak opisu wykonanej pracy';
                const isExpanded = expandedClosedOrderIds.has(zlecenie.id);
                const closedListItem = createZlecenieListItem(
                    zlecenie,
                    {
                        status: 'closed',
                        headerHtml: `
                            <div class="order-closed-compact-summary" role="group" aria-label="Skrót zakończonego zlecenia">
                                <p class="order-card-cell order-card-cell--identity"><span class="key">Zlecenie</span><strong>#${zlecenie.nrZlecenia || '—'}</strong></p>
                                <p class="order-card-cell order-card-cell--client"><span class="key">Klient</span><strong>${klient ? klient.nazwa : 'Brak klienta'}</strong></p>
                                <p class="order-card-cell order-card-cell--machine"><span class="key">Maszyna / model</span><strong>${machineLabel}</strong></p>
                                <p class="order-card-cell"><span class="key">Wykonano</span><strong>${serviceDate || 'b.d.'}</strong></p>
                                <p class="order-card-cell order-card-cell--highlight"><span class="key">Wyfakturowane</span><strong>${zlecenie.wyfakturowaneGodziny || 0} h</strong></p>
                                <span class="order-expand-hint" aria-hidden="true">
                                    <span class="order-expand-hint__icon" data-expanded="${isExpanded ? 'true' : 'false'}">▾</span>
                                </span>
                            </div>
                        `,
                        bodyHtml: `
                            <div class="order-card-layout order-card-layout--closed" role="group" aria-label="Dane zakończonego zlecenia">
                                <div class="order-card-row order-card-row--metrics">
                                    <p class="order-card-cell"><span class="key">Typ</span><strong>${zlecenie.typZlecenia || '?'}</strong></p>
                                    <p class="order-card-cell"><span class="key">Motogodziny</span><strong>${motoHoursVal.toFixed(1)} h</strong></p>
                                    <p class="order-card-cell order-card-cell--settlement"><span class="key">Rozliczenie (brutto / netto)</span><strong>${(amounts.grossCents / 100).toFixed(2)} zł / ${(amounts.netCents / 100).toFixed(2)} zł</strong></p>
                                </div>
                                <p class="order-card-note"><span class="key">Opis / notatka końcowa</span><span>${orderDescription}</span></p>
                            </div>
                        `,
                        metaHtml: `
                            ${uzyteCzesciList ? `<small><span class="key">Użyto części</span>${uzyteCzesciList}</small>` : ''}
                            ${wzLabel ? `<small><span class="key">WZ</span>${wzLabel}</small>` : ''}
                        `,
                        actionsHtml: `
                    <button type="button" class="btn-edit reopen-btn" data-id="${zlecenie.id}">Otwórz ponownie</button>
                    <button type="button" class="btn-secondary details-zlecenie-btn" data-id="${zlecenie.id}">Szczegóły</button>
                    <button type="button" class="btn-secondary edit-zlecenie-btn" data-id="${zlecenie.id}">Edytuj</button>
                    <div class="row-action">
                      <button type="button" class="row-action-btn" data-order-action="menu" aria-label="Więcej akcji">⋯</button>
                      <div class="row-action-menu" role="menu">
                        <button type="button" class="delete-btn" data-id="${zlecenie.id}" data-order-action="delete">Usuń</button>
                      </div>
                    </div>
                `
                    }
                );
                closedListItem.classList.toggle('is-expanded', isExpanded);
                closedListItem.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
                closedListItem.querySelectorAll('[data-expand-section]').forEach((section) => {
                    section.hidden = !isExpanded;
                });
                ukonczoneElements.push(closedListItem);
            }
        } catch (error) {
            console.error('[wyswietlZlecenia] Pomijam rekord po błędzie', { orderId: zlecenie?.id, error });
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
    const normalizedOrders = Array.isArray(orders)
        ? orders.map(order => normalizeOrderForBilling(order))
        : [];
    const { canonical: canonicalOrders, duplicates } = buildCanonicalOrders(normalizedOrders);
    _wszystkieZleceniaCache = canonicalOrders;
    wszystkieZlecenia = canonicalOrders;
    runSettlementMonthMigrationOnce(canonicalOrders).catch((err) => console.error('[Migracja settlementMonth] Błąd:', err));
    runOrderIdentityDedupMigrationOnce({ canonicalOrders, duplicates }).catch((err) => console.error('[Migracja deduplikacji zleceń] Błąd:', err));
    canonicalOrders.forEach((order) => {
        const needsMigration = !order?.createdOn || (order.status === 'zakończone' && !order?.completedOn);
        if (!needsMigration || !order?.id) return;
        const payload = {
            createdOn: order.createdOn || null,
            completedOn: order.completedOn || null
        };
        updateDoc(doc(db, 'zlecenia', order.id), payload)
            .catch((error) => console.warn('[Migracja dat zlecenia] Nie udało się zaktualizować', order.id, error));
    });
    if (render) {
        invalidateMonthStatsCache();
        wyswietlZlecenia();
        renderClientStatsView();
        odswiezPodsumowania();
        rebuildCalendarDecorations();
        updateUnfinishedSummary();
        przeprowadzMigracjeStartEnd().catch(err => console.error('[Migracja start/end] Błąd aktualizacji:', err));
    }
};

const runSettlementMonthMigrationOnce = async (orders = []) => {
    try {
        if (localStorage.getItem(BILLING_MONTH_MIGRATION_KEY) === 'done') return;
    } catch (_) { }

    const updates = [];
    (orders || []).forEach((order) => {
        if (!order?.id) return;
        const completionDate = normalizeDateOnly(order?.completionDate || order?.serviceDate || order?.dataUkonczenia || order?.completedAt || order?.completedOn);
        const explicitBillingMonth = normalizeMonthKey(order?.settlementMonth || order?.billingMonth);
        const isClosed = order?.status === 'zakończone' || Boolean(completionDate);
        if (!isClosed || explicitBillingMonth || !completionDate) return;
        updates.push(
            updateDoc(doc(db, 'zlecenia', order.id), { settlementMonth: completionDate.slice(0, 7), billingMonth: completionDate.slice(0, 7) })
                .catch((error) => console.warn('[Migracja settlementMonth] Nie udało się zaktualizować', order.id, error))
        );
    });

    if (updates.length) {
        await Promise.all(updates);
    }

    try {
        localStorage.setItem(BILLING_MONTH_MIGRATION_KEY, 'done');
    } catch (_) { }
};

const runOrderIdentityDedupMigrationOnce = async ({ canonicalOrders = [], duplicates = [] } = {}) => {
    try {
        if (localStorage.getItem(ORDER_DEDUP_MIGRATION_KEY) === 'done') return;
    } catch (_) { }

    const updates = [];
    (canonicalOrders || []).forEach((order) => {
        if (!order?.id) return;
        const expectedRoot = String(order.rootOrderId || order.id || '').trim();
        if (!expectedRoot) return;
        if (order.rootOrderId !== expectedRoot) {
            updates.push(
                updateDoc(doc(db, 'zlecenia', order.id), {
                    rootOrderId: expectedRoot,
                    duplicateOfOrderId: null,
                    isDuplicate: false
                }).catch((error) => console.warn('[Migracja rootOrderId] Nie udało się zaktualizować', order.id, error))
            );
        }
    });

    (duplicates || []).forEach((entry) => {
        const leaderId = entry?.leaderId;
        if (!leaderId) return;
        (entry?.duplicateIds || []).forEach((duplicateId) => {
            updates.push(
                updateDoc(doc(db, 'zlecenia', duplicateId), {
                    rootOrderId: leaderId,
                    duplicateOfOrderId: leaderId,
                    isDuplicate: true
                }).catch((error) => console.warn('[Migracja duplikatu zlecenia] Nie udało się oznaczyć', duplicateId, error))
            );
        });
    });

    if (updates.length) await Promise.all(updates);

    try {
        localStorage.setItem(ORDER_DEDUP_MIGRATION_KEY, 'done');
    } catch (_) { }
};

const applyActivityData = (entries = [], { render = true, status = 'ready' } = {}) => {
    recentActivity = Array.isArray(entries) ? entries : [];
    activityStatus = status;
    if (render) {
        renderPulpit();
    }
};


async function hydrateNotesOrderLabels(notes = []) {
    const uniqueOrderIds = [...new Set((notes || [])
        .map((note) => note?.orderId || note?.linkedOrderId || null)
        .filter(Boolean))];
    if (!uniqueOrderIds.length) {
        notesOrderLabelsById = new Map();
        return;
    }
    const [orders] = await Promise.all([
        notesData.listOrdersByIds(uniqueOrderIds)
    ]);
    const options = buildNoteOrderOptionsModel({
        orders,
        clients: _wszystkieKlienciCache || [],
        machines: _wszystkieMaszynyCache || []
    });
    notesOrderLabelsById = new Map(options.map((option) => [option.id, option.label]));
}

function nasluchujNaNotatki() {
    notesStatus = 'loading';
    renderNotesList();
    onSnapshot(
        query(collection(db, 'notes'), orderBy('updatedAt', 'desc')),
        async (snapshot) => {
            allNotes = snapshot.docs.map((docSnap) => mapNoteDoc(docSnap)).filter((note) => !note.archived);
            try {
                await hydrateNotesOrderLabels(allNotes);
                notesStatus = 'ready';
            } catch (error) {
                console.error('Błąd mapowania notatek do zleceń:', error);
                notesStatus = 'error';
            }
            renderNotesList();
            renderOrderNotes();
        },
        (error) => {
            console.error('Błąd ładowania notatek:', error);
            notesStatus = 'error';
            renderNotesList();
        }
    );
}

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
        fillNotesOrderFilter();
    });
}

let migracjaStartEndWykonana = false;

async function przeprowadzMigracjeStartEnd() {
    if (migracjaStartEndWykonana) return;
    migracjaStartEndWykonana = true;
    const aktualizacje = [];
    for (const zlecenie of _wszystkieZleceniaCache) {
        const payload = {};
        if (!zlecenie.createdDate) payload.createdDate = normalizeDateOnly(zlecenie.createdAt) || formatDateForStorage(new Date());
        if (!zlecenie.startDate) payload.startDate = normalizeDateOnly(zlecenie.startAt || zlecenie.createdAt) || null;
        if (!zlecenie.completionDate && zlecenie.status === 'zakończone') payload.completionDate = normalizeDateOnly(zlecenie.serviceDate || zlecenie.dataUkonczenia || zlecenie.completedAt) || null;
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
    const todayDate = formatDateForStorage(new Date());
    let dane;
    if (wybranyKlientId === "szybkie-zlecenie") {
        dane = {
            status: 'nieprzypisane',
            nrZlecenia: zlecenieForm['nr-zlecenia'].value,
            opis: zlecenieForm['opis-usterki'].value,
            motoHours: 0,
            createdDate: todayDate,
            createdOn: todayDate,
            startDate: todayDate,
            completionDate: null,
            completedOn: null,
            settlementMonth: null,
            billingMonth: null,
            invoicedHours: null,
            grossAmount: null,
            netAmount: null,
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
            motogodziny: Number(maszyna.motogodziny) || 0,
            motoHours: 0,
            createdDate: todayDate,
            createdOn: todayDate,
            startDate: todayDate,
            completionDate: null,
            completedOn: null,
            settlementMonth: null,
            billingMonth: null,
            invoicedHours: null,
            grossAmount: null,
            netAmount: null,
            historia,
            createdAt: new Date(),
            zakonczenieNotatka: null,
            zakonczenieNumerWZ: null
        };
    } else { alert("Wybierz klienta i maszynę LUB opcję 'Szybkie Zlecenie'."); return; }

    try {
        const docRef = await addDoc(collection(db, "zlecenia"), dane);
        await updateDoc(docRef, { rootOrderId: docRef.id, duplicateOfOrderId: null, isDuplicate: false });
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


function renderOrderNotes(orderId = null) {
    const host = document.getElementById('details-order-notes');
    if (!host) return;
    const currentOrderId = orderId || host.dataset.orderId || '';
    host.dataset.orderId = currentOrderId;
    const notes = buildNotesViewModel({ notes: allNotes, filters: { linkType: NOTE_LINK_TYPES.ORDER, linkedOrderId: currentOrderId } }).results;
    host.innerHTML = `
        <div class="order-notes-actions"><button type="button" class="btn-secondary" id="order-note-add">Dodaj notatkę</button><button type="button" class="btn-secondary" id="order-notes-export">Eksportuj .txt</button></div>
        ${notes.length ? notes.map((note) => `<div class="note-item"><strong>${note.title || '(bez tytułu)'}</strong><p>${note.contentText || ''}</p></div>`).join('') : '<p class="loading-state">Brak notatek do zlecenia.</p>'}
    `;
    host.querySelector('#order-note-add')?.addEventListener('click', async () => {
        const payload = promptNotePayload();
        if (!payload || !currentOrderId) return;
        await createNote({ ...payload, linkedType: NOTE_LINKED_TYPES.ORDER, linkedOrderId: currentOrderId });
    });
    host.querySelector('#order-notes-export')?.addEventListener('click', () => {
        exportManyNotes(notes, `notatki-zlecenie-${currentOrderId || 'brak'}.txt`);
    });
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
    const updateExpandUi = (orderLi, shouldExpand) => {
        if (!orderLi) return;
        orderLi.classList.toggle('is-expanded', shouldExpand);
        orderLi.setAttribute('aria-expanded', shouldExpand ? 'true' : 'false');
        const hintIcon = orderLi.querySelector('.order-expand-hint__icon');
        if (hintIcon) hintIcon.dataset.expanded = shouldExpand ? 'true' : 'false';
        orderLi.querySelectorAll('[data-expand-section]').forEach((section) => {
            section.hidden = !shouldExpand;
        });
    };
    const toggleOrderCard = () => {
        if (!li?.classList.contains('order-list-item')) return false;
        const isActive = li.classList.contains('is-active');
        const isClosed = li.classList.contains('is-closed');
        if (!isActive && !isClosed) return false;
        const expandedSet = isActive ? expandedActiveOrderIds : expandedClosedOrderIds;
        const shouldExpand = !expandedSet.has(docId);
        if (shouldExpand) expandedSet.add(docId);
        else expandedSet.delete(docId);
        updateExpandUi(li, shouldExpand);
        return true;
    };
    const clickedInteractiveControl = Boolean(target.closest('button, a, input, select, textarea, [contenteditable="true"]'));
    const clickedContent = target.closest('.order-list-item__content');
    if (clickedContent && !clickedInteractiveControl) {
        if (toggleOrderCard()) return;
    }
    const closeOrderActionMenus = (except = null) => {
        (ukonczoneZleceniaLista || document).querySelectorAll('.row-action').forEach(menu => {
            if (menu !== except) menu.classList.remove('is-open');
        });
    };

    const menuTrigger = target.closest('[data-order-action="menu"]');
    if (menuTrigger) {
        const menu = menuTrigger.closest('.row-action');
        const isOpen = menu?.classList.toggle('is-open');
        closeOrderActionMenus(isOpen ? menu : null);
        return;
    }

    const menuAction = target.closest('[data-order-action]');
    if (menuAction && menuAction.dataset.orderAction === 'delete') {
        closeOrderActionMenus();
    }

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
            if (assignIdInput) assignIdInput.value = docId;
            if (assignOpis) assignOpis.textContent = zlecenie.nrZlecenia;
            assignForm.reset();
            if (assignModeSelect) assignModeSelect.value = 'normal';
            if (assignMachineModelInput) assignMachineModelInput.value = zlecenie.machineModelText || '';
            if (assignFormError) {
                assignFormError.textContent = '';
                assignFormError.style.display = 'none';
            }
            updateAssignModeUI();
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
            const completeServiceDateInput = document.getElementById('complete-zlecenie-service-date');
            const billingMonthInput = document.getElementById('complete-zlecenie-billing-month');
            if (completeServiceDateInput) {
                const resolvedServiceDate = resolveServiceDate(zlecenie) || formatDateForStorage(new Date());
                completeServiceDateInput.value = resolvedServiceDate;
                if (billingMonthInput) {
                    const explicitBillingMonth = resolveOrderSettlementMonth(zlecenie) || '';
                    const defaultBillingMonth = deriveBillingMonthFromCompletionDate(resolvedServiceDate);
                    billingMonthInput.value = explicitBillingMonth || defaultBillingMonth || '';
                }
                completeServiceDateInput.onchange = () => {
                    if (!billingMonthInput) return;
                    const nextDefault = deriveBillingMonthFromCompletionDate(completeServiceDateInput.value);
                    billingMonthInput.value = nextDefault || '';
                };
            }
            const invInput = document.getElementById('wyfakturowane-godziny');
            if (invInput) invInput.value = String(getOrderInvoicedHours(zlecenie));
            const motoInput = document.getElementById('moto-hours');
            if (motoInput) motoInput.value = String(Number(zlecenie.motoHours ?? maszyna?.motogodziny ?? 0) || 0);
            czesciDoZlecenia = [];
            renderCzesciDoZlecenia();
            renderMagazynWModalu();
            ensureZakonczenieNotatkaField();
            openModal(completeModal);
        }
        return;
    }
    if (target.classList.contains('edit-zlecenie-btn')) {
        otworzModalEdycjiZlecenia(docId);
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
                completionDate: null,
                dataUkonczenia: deleteField(),
                serviceDate: deleteField(),
                performedAt: deleteField(),
                endAt: deleteField(),
                endDate: deleteField(),
                completedAt: deleteField(),
                completionTimestamp: deleteField(),
                closeDate: deleteField(),
                closedAt: deleteField(),
                completedOn: null,
                isClosed: deleteField(),
                closedMonth: deleteField(),
                settlementMonth: null,
                billingMonth: deleteField(),
                completed: deleteField(),
                invoicedHours: null,
                wyfakturowaneGodziny: deleteField(),
                grossAmount: null,
                netAmount: null,
                typZlecenia: null,
                zakonczenieNotatka: null,
                zakonczenieNumerWZ: null,
                historia: nowaHistoria
            });
            invalidateMonthStatsCache();
            await odswiezPodsumowania({ skipRender: false });
            wyswietlZlecenia();
            renderPulpit();
        } catch (e) {
            console.error("Błąd przy ponownym otwieraniu:", e);
            alert("Nie udało się ponownie otworzyć zlecenia.");
        }
        return;
    }
}

function buildOrderHumanLabel(order = {}) {
    const maszyna = _wszystkieMaszynyCache.find(m => m.id === order.maszynaId);
    const klient = _wszystkieKlienciCache.find(k => k.id === order.klientId);
    const klientLabel = klient?.nazwa || order.klientNazwa || 'Brak klienta';
    const maszynaLabel = [maszyna?.typMaszyny || order.typMaszyny, maszyna?.model || order.model].filter(Boolean).join(' ').trim() || 'Brak maszyny';
    return `${klientLabel} - ${maszynaLabel}`;
}

function fillEditOrderClients(selectedClientId = '') {
    if (!editZlecenieClientSelect) return;
    const options = ['<option value="">-- Wybierz klienta --</option>'].concat(
        (_wszystkieKlienciCache || []).map((klient) => `<option value="${klient.id}">${klient.nazwa || '(bez nazwy)'}</option>`)
    );
    editZlecenieClientSelect.innerHTML = options.join('');
    editZlecenieClientSelect.value = selectedClientId || '';
}

function fillEditOrderMachines(clientId = '', selectedMachineId = '') {
    if (!editZlecenieMachineSelect) return;
    if (!clientId) {
        editZlecenieMachineSelect.innerHTML = '<option value="">-- Najpierw wybierz klienta --</option>';
        editZlecenieMachineSelect.disabled = true;
        return;
    }
    const machines = (_wszystkieMaszynyCache || []).filter((machine) => machine.klientId === clientId);
    if (!machines.length) {
        editZlecenieMachineSelect.innerHTML = '<option value="">-- Brak maszyn dla klienta --</option>';
        editZlecenieMachineSelect.disabled = true;
        return;
    }
    editZlecenieMachineSelect.disabled = false;
    editZlecenieMachineSelect.innerHTML = ['<option value="">-- Wybierz maszynę --</option>'].concat(
        machines.map((machine) => `<option value="${machine.id}">${[machine.typMaszyny, machine.model].filter(Boolean).join(' ')}</option>`)
    ).join('');
    editZlecenieMachineSelect.value = selectedMachineId || '';
}

function otworzModalEdycjiZlecenia(zlecenieId) {
    if (!editZlecenieForm || !editZlecenieModal) return;
    const zlecenie = _wszystkieZleceniaCache.find(z => z.id === zlecenieId);
    if (!zlecenie) return;
    const nazwaMaszyny = buildOrderHumanLabel(zlecenie);

    editZlecenieForm['edit-zlecenie-id'].value = zlecenie.id;
    if (editZlecenieDocId) editZlecenieDocId.textContent = zlecenie.id;
    document.getElementById('edit-zlecenie-klient').textContent = nazwaMaszyny;
    fillEditOrderClients(zlecenie.klientId || '');
    fillEditOrderMachines(zlecenie.klientId || '', zlecenie.maszynaId || '');

    const nrInput = document.getElementById('edit-zlecenie-nr-input');
    if (nrInput) nrInput.value = zlecenie.nrZlecenia || '';
    const opisInput = document.getElementById('edit-zlecenie-opis');
    if (opisInput) opisInput.value = zlecenie.opis || '';

    editZlecenieForm['edit-wyfakturowane-godziny'].value = zlecenie.wyfakturowaneGodziny || 0;
    editZlecenieForm['edit-moto-hours'].value = String(Number(zlecenie.motoHours ?? zlecenie.motogodziny ?? 0) || 0);
    editZlecenieForm['edit-typ-zlecenia'].value = zlecenie.typZlecenia || 'S';
    editZlecenieForm['edit-zakonczenie-wz'].value = zlecenie.zakonczenieNumerWZ || '';
    const editEndInput = editZlecenieForm['edit-completion-date'];
    const resolvedCompletionDate = normalizeDateOnly(zlecenie.completionDate || zlecenie.serviceDate || zlecenie.completedAt);
    if (editEndInput) editEndInput.value = resolvedCompletionDate;
    const editBillingMonthInput = editZlecenieForm['edit-billing-month'];
    if (editBillingMonthInput) {
        const explicitBillingMonth = resolveOrderSettlementMonth(zlecenie) || '';
        editBillingMonthInput.value = explicitBillingMonth || deriveBillingMonthFromCompletionDate(resolvedCompletionDate) || '';
    }

    openModal(editZlecenieModal);
}

async function zapiszEdycjeZlecenia(event) {
    if (!editZlecenieForm) return;
    event.preventDefault();
    const zlecenieId = editZlecenieForm['edit-zlecenie-id'].value;
    const noweGodziny = Number(editZlecenieForm['edit-wyfakturowane-godziny'].value);
    const noweMotoHours = Number(editZlecenieForm['edit-moto-hours']?.value ?? 0);
    const nowyTyp = editZlecenieForm['edit-typ-zlecenia'].value;
    const nowyNumerWz = editZlecenieForm['edit-zakonczenie-wz'].value.trim();
    const nowyNumerZlecenia = (document.getElementById('edit-zlecenie-nr-input')?.value || '').trim();
    const nowyOpis = (document.getElementById('edit-zlecenie-opis')?.value || '').trim();
    const nowyKlientId = editZlecenieClientSelect?.value || '';
    const nowaMaszynaId = editZlecenieMachineSelect?.value || '';
    const noweCompletionDate = normalizeDateOnly(editZlecenieForm['edit-completion-date']?.value || '');
    const nowyBillingMonthRaw = (editZlecenieForm['edit-billing-month']?.value || '').trim();
    const nowyBillingMonth = nowyBillingMonthRaw || (noweCompletionDate ? deriveBillingMonthFromCompletionDate(noweCompletionDate) : null) || null;

    if (isNaN(noweGodziny) || noweGodziny < 0) {
        alert("Podaj poprawną liczbę godzin.");
        return;
    }
    if (!Number.isFinite(noweMotoHours) || noweMotoHours < 0) { alert('Motogodziny muszą być liczbą większą lub równą 0.'); return; }
    if (!nowyNumerZlecenia) { alert('Numer zlecenia jest wymagany.'); return; }
    if (!nowyKlientId) { alert('Wybierz klienta.'); return; }
    if (!nowaMaszynaId) { alert('Wybierz maszynę.'); return; }
    const duplicate = _wszystkieZleceniaCache.find((z) => z.id !== zlecenieId && (z.nrZlecenia || '').trim() === nowyNumerZlecenia);
    if (duplicate) { alert('Numer zlecenia musi być unikalny.'); return; }

    const zlecenieRef = doc(db, "zlecenia", zlecenieId);
    try {
        const zlecenieSnap = await getDoc(zlecenieRef);
        const zlecenieData = zlecenieSnap.data();
        const staraHistoria = zlecenieData.historia || [];
        const staryTyp = zlecenieData.typZlecenia;
        const stareGodziny = zlecenieData.wyfakturowaneGodziny;
        const staryNumerWz = zlecenieData.zakonczenieNumerWZ || '';
        const stareMotoHours = Number(zlecenieData.motoHours ?? zlecenieData.motogodziny ?? 0) || 0;
        const staryNumerZlecenia = zlecenieData.nrZlecenia || '';
        const staryOpis = zlecenieData.opis || '';
        const staryKlientId = zlecenieData.klientId || '';
        const staraMaszynaId = zlecenieData.maszynaId || '';
        const staraCompletionDate = normalizeDateOnly(zlecenieData.completionDate || zlecenieData.serviceDate || zlecenieData.completedAt);
        const previousBillingMonth = resolveOrderSettlementMonth(zlecenieData);

        let wpisHistorii = `Edytowano zlecenie: `;
        const zmiany = [];
        if (stareGodziny !== noweGodziny) zmiany.push(`Godziny zmieniono z ${stareGodziny}h na ${noweGodziny}h`);
        if (staryTyp !== nowyTyp) zmiany.push(`Typ zmieniono z ${staryTyp} na ${nowyTyp}`);
        if (staryNumerZlecenia !== nowyNumerZlecenia) zmiany.push(`Numer zlecenia zmieniono z ${staryNumerZlecenia || 'brak'} na ${nowyNumerZlecenia}`);
        if (staryOpis !== nowyOpis) zmiany.push('Zmieniono opis/notatkę.');
        if (staryKlientId !== nowyKlientId) zmiany.push('Zmieniono klienta.');
        if (staraMaszynaId !== nowaMaszynaId) zmiany.push('Zmieniono maszynę.');
        if (staryNumerWz !== nowyNumerWz) {
            const staryTekst = staryNumerWz ? staryNumerWz : 'brak';
            const nowyTekst = nowyNumerWz ? nowyNumerWz : 'brak';
            zmiany.push(`Numer WZ zmieniono z ${staryTekst} na ${nowyTekst}`);
        }
        if (stareMotoHours !== noweMotoHours) zmiany.push(`Motogodziny: ${stareMotoHours} → ${noweMotoHours}`);
        if (staraCompletionDate !== noweCompletionDate) zmiany.push(`Data wykonania: ${staraCompletionDate || 'brak'} → ${noweCompletionDate || 'brak'}`);
        const nextBillingMonth = nowyBillingMonth;
        if (previousBillingMonth !== nextBillingMonth) zmiany.push(`Miesiąc rozliczenia: ${previousBillingMonth || 'brak'} → ${nextBillingMonth || 'brak'}`);
        if (zmiany.length === 0) {
            hideModal(editZlecenieModal);
            return;
        }
        wpisHistorii += zmiany.join('; ');
        const nowaHistoria = [...staraHistoria, { timestamp: new Date().toISOString(), akcja: wpisHistorii }];

        const klient = _wszystkieKlienciCache.find((item) => item.id === nowyKlientId);
        const maszyna = _wszystkieMaszynyCache.find((item) => item.id === nowaMaszynaId);

        await updateDoc(zlecenieRef, {
            klientId: nowyKlientId,
            klientNazwa: klient?.nazwa || zlecenieData.klientNazwa || '',
            maszynaId: nowaMaszynaId,
            typMaszyny: maszyna?.typMaszyny || zlecenieData.typMaszyny || null,
            model: maszyna?.model || zlecenieData.model || null,
            opis: nowyOpis,
            wyfakturowaneGodziny: noweGodziny,
            invoicedHours: noweGodziny,
            motoHours: noweMotoHours,
            typZlecenia: nowyTyp,
            nrZlecenia: nowyNumerZlecenia,
            zakonczenieNumerWZ: nowyNumerWz || null,
            completionDate: noweCompletionDate || null,
            completedOn: noweCompletionDate || null,
            billingMonth: nextBillingMonth || null,
            settlementMonth: nextBillingMonth || null,
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
    const usterkaDiv = document.getElementById('details-zlecenie-usterka');
    const opisDiv = document.getElementById('details-zlecenie-opis');
    const historiaTitleEl = document.getElementById('details-zlecenie-historia-title');
    const historiaToggleBtn = document.getElementById('details-zlecenie-historia-toggle');
    if (!detailsZlecenieModal || !titleEl || !infoDiv || !historiaDiv || !kalendarzDiv || !usterkaDiv || !opisDiv || !historiaTitleEl || !historiaToggleBtn) return;
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
    const calendarEntries = (wszystkieWpisyKalendarza || []).slice().sort((a, b) => (b.id || '').localeCompare(a.id || ''));
    const powiazaneWpisy = [];
    let sumaFakturowanych = 0;
    for (const wpis of calendarEntries) {
        const { powiazane } = normalizujPowiazaneZlecenia(wpis);
        const powiazanie = powiazane.find(p => p.zlecenieId === zlecenieId);
        if (!powiazanie) continue;
        powiazaneWpisy.push({ wpis, powiazanie });
        sumaFakturowanych += Number(powiazanie.fakturowane) || 0;
    }

    titleEl.textContent = `Szczegóły zlecenia #${zlecenie.nrZlecenia}`;
    const machineDetails = maszyna ? `${maszyna.typMaszyny} ${maszyna.model}` : (zlecenie.machineModelText || '---');
    const clientDetails = klient ? klient.nazwa : (zlecenie.status === 'nieprzypisane' ? 'Szybkie zlecenie (bez klienta)' : '---');
    infoDiv.innerHTML = `
        <div class="details-grid">
            <div class="details-group"><strong>Numer</strong><p>#${zlecenie.nrZlecenia || '—'}</p></div>
            <div class="details-group"><strong>Status</strong><p>${zlecenie.status}</p></div>
            <div class="details-group"><strong>Klient</strong><p>${clientDetails}</p></div>
            <div class="details-group"><strong>Maszyna / model</strong><p>${machineDetails}</p></div>
            <div class="details-group"><strong>Data rozpoczęcia</strong><p>${normalizeDateOnly(zlecenie.startDate || zlecenie.startAt || zlecenie.createdDate) || '—'}</p></div>
            <div class="details-group"><strong>Wyfakturowane z ewidencji</strong><p>${formatujLiczbe(sumaFakturowanych)} h</p></div>
        </div>
    `;

    if (zlecenie.status === 'zakończone') {
         const wzHtml = zlecenie.zakonczenieNumerWZ ? `<div class="details-group"><strong>Numer WZ</strong><p>${zlecenie.zakonczenieNumerWZ}</p></div>` : '';       
        infoDiv.innerHTML += `
            <div class="details-grid details-grid--closed">
                <div class="details-group"><strong>Data wykonania</strong><p>${serviceDate || '—'}</p></div>
                <div class="details-group"><strong>Miesiąc rozliczenia</strong><p>${resolveOrderSettlementMonth(zlecenie) || deriveBillingMonthFromCompletionDate(serviceDate) || '—'}</p></div>
                <div class="details-group"><strong>Wyfakturowane</strong><p>${getOrderInvoicedHours(zlecenie)} h</p></div>
                <div class="details-group"><strong>Motogodziny</strong><p>${(zlecenie.motoHours ?? 0).toFixed(1)} h</p></div>
                <div class="details-group"><strong>Brutto</strong><p>${getOrderGrossAmount(zlecenie).toFixed(2)} zł</p></div>
                <div class="details-group"><strong>Netto</strong><p>${getOrderNetAmount(zlecenie).toFixed(2)} zł</p></div>
                <div class="details-group"><strong>Typ zlecenia</strong><p>${zlecenie.typZlecenia} (${typStawkiOpis})</p></div>
                <div class="details-group"><strong>Użyte części</strong><p>${uzyteCzesciOpis}</p></div>
                ${wzHtml}
            </div>
        `;
    }

    usterkaDiv.innerHTML = `<div class="details-text-block"><p>${zlecenie.opis || '—'}</p></div>`;

    const historiaEntries = Array.isArray(zlecenie.historia) ? zlecenie.historia.slice() : [];
    historiaTitleEl.textContent = `Historia zlecenia (${historiaEntries.length})`;
    historiaDiv.hidden = true;
    historiaDiv.classList.remove('is-open');
    historiaToggleBtn.textContent = 'Pokaż';
    historiaToggleBtn.setAttribute('aria-expanded', 'false');

    historiaToggleBtn.onclick = () => {
        const isExpanded = historiaToggleBtn.getAttribute('aria-expanded') === 'true';
        const nextExpanded = !isExpanded;
        historiaToggleBtn.setAttribute('aria-expanded', String(nextExpanded));
        historiaToggleBtn.textContent = nextExpanded ? 'Ukryj' : 'Pokaż';
        historiaDiv.hidden = !nextExpanded;
        historiaDiv.classList.toggle('is-open', nextExpanded);
    };

    if (historiaEntries.length > 0) {
        historiaDiv.innerHTML = historiaEntries
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

    if (kalendarzDiv) {
        kalendarzDiv.innerHTML = '<p>Ładowanie wpisów z kalendarza...</p>';
    }
    let kalendarzHtml = '';
    for (const { wpis, powiazanie } of powiazaneWpisy) {
        const dataWpisu = wpis.id || '—';
        kalendarzHtml += `
            <div class="calendar-entry-item">
                <span class="date">[${dataWpisu}]</span>
                Praca: ${formatujLiczbe(wpis.praca || 0)}h | Fakturowane dla zlecenia: ${formatujLiczbe(powiazanie.fakturowane)}h | Nadgodziny: ${formatujLiczbe(wpis.nadgodziny || 0)}h | Jazda: ${formatujLiczbe(wpis.jazda || 0)}h
                ${wpis.notatka ? `<br><small>Notatka: ${wpis.notatka}</small>` : ''}
            </div>`;
    }
    if (kalendarzDiv) {
        kalendarzDiv.innerHTML = `<div class="details-calendar-list">${kalendarzHtml || '<p>Brak powiązanych wpisów w kalendarzu.</p>'}</div>`;
    }
    opisDiv.innerHTML = `<div class="details-text-block">${zlecenie.zakonczenieNotatka ? `<p>${zlecenie.zakonczenieNotatka}</p>` : '<p>Brak opisu.</p>'}</div>`;
    renderOrderNotes(zlecenie.id);

    if (!skipOpen) {
        openModal(detailsZlecenieModal);
    }
}

function updateAssignModeUI() {
    const mode = assignModeSelect?.value === 'quick' ? 'quick' : 'normal';
    if (assignClientGroup) assignClientGroup.style.display = mode === 'quick' ? 'none' : '';
    if (assignTrybHint) {
        assignTrybHint.textContent = mode === 'quick'
            ? 'Tryb szybki: bez klienta. Uzupełnij model maszyny.'
            : 'Tryb pełny: przypisz klienta i maszynę dla istniejącego zlecenia.';
    }
    if (assignMachineModelInput) {
        assignMachineModelInput.required = mode === 'quick';
        assignMachineModelInput.placeholder = mode === 'quick' ? 'Wymagane (np. John Deere 6155M)' : 'Opcjonalnie (ułatwia identyfikację)';
    }
}

function setAssignFormError(message = '') {
    if (!assignFormError) return;
    assignFormError.textContent = message;
    assignFormError.style.display = message ? '' : 'none';
}

async function zapiszPrzypisanie(event) {
    if (!assignForm || !assignModal) return;
    event.preventDefault();
    const zlecenieId = assignForm['assign-zlecenie-id'].value;
    const mode = assignModeSelect?.value === 'quick' ? 'quick' : 'normal';
    const klientId = assignForm['assign-klient-select']?.value || '';
    const machineModelText = (assignMachineModelInput?.value || '').trim();
    setAssignFormError('');
    try {
        const zlecenieRef = doc(db, "zlecenia", zlecenieId);
        const zlecenieSnap = await getDoc(zlecenieRef);
        if (!zlecenieSnap.exists()) {
            setAssignFormError("Nie znaleziono zlecenia do przypisania.");
            return;
        }
        const zlecenieData = zlecenieSnap.data();
        const historia = Array.isArray(zlecenieData.historia) ? zlecenieData.historia : [];
        const payload = {
            status: 'aktywne'
        };

        if (mode === 'normal') {
            if (!klientId) {
                setAssignFormError("W trybie normalnym wybór klienta jest wymagany.");
                return;
            }
            const klient = _wszystkieKlienciCache.find((item) => item.id === klientId);
            payload.klientId = klientId;
            payload.klientNazwa = klient?.nazwa || zlecenieData.klientNazwa || '';
            payload.historia = [...historia, {
                timestamp: new Date().toISOString(),
                akcja: `Przypisano do klienta: ${payload.klientNazwa || klientId}`
            }];
            payload.machineModelText = machineModelText || null;
        } else {
            if (!machineModelText) {
                setAssignFormError("W trybie szybkim pole „Model traktora” jest wymagane.");
                return;
            }
            payload.klientId = null;
            payload.klientNazwa = null;
            payload.machineModelText = machineModelText;
            payload.historia = [...historia, {
                timestamp: new Date().toISOString(),
                akcja: `Przypisano w trybie szybkim (model: ${machineModelText})`
            }];
        }

        if (import.meta.env.DEV) console.debug('[assign-save] payload', payload);
        await updateDoc(zlecenieRef, payload);
        if (import.meta.env.DEV) console.debug('[assign-save] success', { zlecenieId, mode });
        invalidateMonthStatsCache();
        wyswietlZlecenia();
        hideModal(assignModal);
    } catch (error) {
        if (import.meta.env.DEV) console.debug('[assign-save] error', error);
        console.error("Błąd podczas przypisywania:", error);
        setAssignFormError(`Wystąpił błąd: ${error.message}`);
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
        try {
            const docId = document.getElementById('complete-zlecenie-id').value;
            const numerWzValue = (document.getElementById('zakonczenie-wz')?.value || '').trim();
            const zakonczenieWzInput = document.getElementById('zakonczenie-wz');
            const zakonczenieNotatkaInput = document.getElementById('zakonczenie-notatka');
            const notatka = zakonczenieNotatkaInput && 'value' in zakonczenieNotatkaInput ? zakonczenieNotatkaInput.value.trim() : '';
            const completionDateInput = completeModalForm.querySelector('[name="completionDate"]') || completeModalForm.querySelector('[name="serviceDate"]') || document.getElementById('complete-zlecenie-service-date');
            const completionDateRaw = completionDateInput?.value || '';
            const billingMonthInput = document.getElementById('complete-zlecenie-billing-month');
            if (!completionDateRaw) {
                alert('Wybierz datę wykonania przed zamknięciem zlecenia.');
                return;
            }
            const completionDate = normalizeDayKey(completionDateRaw, 'completionDate');
            if (!completionDate) {
                alert('Wybierz poprawną datę wykonania.');
                return;
            }
            const billingMonthRaw = (billingMonthInput?.value || '').trim();
            const settlementMonth = billingMonthRaw || deriveBillingMonthFromCompletionDate(completionDate) || null;
            const invoicedHoursInput = document.getElementById('wyfakturowane-godziny');
            const invoicedHoursRaw = (invoicedHoursInput?.value ?? '').toString().trim();
            const invoicedHours = Number(invoicedHoursRaw);
            if (!settlementMonth) { alert('Wybierz miesiąc rozliczenia.'); return; }
            if (!invoicedHoursRaw || !Number.isFinite(invoicedHours)) { alert('Wyfakturowane godziny są wymagane.'); return; }
            const todayKey = formatDateForStorage(new Date());
            if (completionDate > todayKey) { alert('Data wykonania nie może być z przyszłości.'); return; }
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
        } catch (error) {
            console.error("Błąd walidacji czasu zakończenia:", error);
            alert("Nie udało się zweryfikować czasu zakończenia. Spróbuj ponownie.");
            return;
        }

            const closeDateKey = completionDate;
            const dane = {
                status: 'zakończone',
                invoicedHours,
                wyfakturowaneGodziny: invoicedHours,
                motoHours: Number(motoHours),
                typZlecenia: document.getElementById('typ-zlecenia').value,
                dataUkonczenia: completionDate,
                serviceDate: completionDate,
                completionDate,
                completedOn: completionDate,
                settlementMonth,
                billingMonth: settlementMonth,
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
                let wpisHistorii = `Zakończono zlecenie. Godziny: ${dane.wyfakturowaneGodziny}h. Typ: ${dane.typZlecenia}. Motogodziny: ${motoHours.toFixed(1)}h. Wykonano: ${completionDate}. Miesiąc rozliczenia: ${settlementMonth || 'brak'}.`;
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
                        rootOrderId: zamykaneZlecenieData.rootOrderId || docId,
                        clientId: zamykaneZlecenieData.klientId || null,
                        machineId: zamykaneZlecenieData.maszynaId || null,
                        orderNo: zamykaneZlecenieData.nrZlecenia || '',
                        description: zamykaneZlecenieData.opis || '',
                        motoHours: Number(motoHours),
                        closedAt: completionDate
                    };
                    try {
                        const historyDocId = `${docId}_${completionDate}`;
                        await setDoc(doc(db, 'orders_history', historyDocId), historiaPayload, { merge: true });
                    } catch (historyErr) {
                        console.warn('Nie udało się zapisać historii zlecenia:', historyErr);
                    }
                    await logActivityEvent({
                        type: 'ORDER_CLOSED',
                        refId: docId,
                        label: `Zamknięto zlecenie ${zamykaneZlecenieData.nrZlecenia || ''} (wykonano ${completionDate})`
                    });
                    if (staraDataWykonania && staraDataWykonania !== completionDate) {
                        await logActivityEvent({
                            type: 'ORDER_CLOSED',
                            refId: docId,
                            label: `Zmieniono datę wykonania z ${staraDataWykonania} na ${completionDate}`
                        });
                    }
                    if (zamykaneZlecenieData.maszynaId) {
                        await updateDoc(doc(db, "maszyny", zamykaneZlecenieData.maszynaId), { motogodziny: Number(motoHours) });
                    }
                }
                alert("Zlecenie zakończone, stan magazynowy zaktualizowany!");
                hideModal(completeModal);
                completeModalForm.reset();
            } catch (error) {
                console.error("BŁĄD TRANSAKCJI: ", error);
                alert(`Wystąpił błąd: ${error.message || error}`);
            }
        } catch (error) {
            console.error('Błąd podczas zamykania zlecenia:', error);
            alert('Wystąpił nieoczekiwany błąd podczas zamykania zlecenia. Spróbuj ponownie.');
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
        if (produkt.jestOlejem) return 'OLEJ';
        const type = String(produkt.typProdukt || '').toUpperCase();
        if (['OLEJ', 'FILTR', 'CZESC', 'CHEMIA', 'INNE'].includes(type)) return type;
        const index = String(produkt.index || '').toUpperCase();
        const name = String(produkt.nazwa || '').toUpperCase();
        if (index.includes('FIL') || name.includes('FILTR')) return 'FILTR';
        if (index.includes('OLEJ') || name.includes('OLEJ')) return 'OLEJ';
        if (index.includes('CHEM') || name.includes('CHEM')) return 'CHEMIA';
        return 'INNE';
    };

    const formatWarehouseDate = (value) => {
        const date = toDateSafe(value);
        if (!date) return '—';
        return date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    const getWarehouseOilLiters = (produkt = {}) => {
        if (!produkt?.jestOlejem) return 0;
        const { pojemnosc } = parseOilMeta(produkt);
        if (!pojemnosc) return 0;
        return (Number(produkt.ilosc) || 0) * pojemnosc;
    };

    const getWarehouseOilLowStockThreshold = (produkt = {}) => {
        if (!produkt?.jestOlejem) return 0;
        const { pojemnosc } = parseOilMeta(produkt);
        if (!Number.isFinite(pojemnosc)) return LOW_STOCK_OIL_LITERS_DEFAULT_THRESHOLD;
        return LOW_STOCK_OIL_LITERS_BY_CONTAINER[pojemnosc] ?? LOW_STOCK_OIL_LITERS_DEFAULT_THRESHOLD;
    };

    const isWarehouseLowStock = (produkt = {}) => {
        if (!produkt) return false;
        if (produkt.jestOlejem) return getWarehouseOilLiters(produkt) <= getWarehouseOilLowStockThreshold(produkt);
        return (Number(produkt.ilosc) || 0) <= LOW_STOCK_UNITS_THRESHOLD;
    };

    const setOilFieldsVisibility = (visible) => {
        if (!itemOilFields) return;
        itemOilFields.classList.toggle('is-visible', visible);
        if (itemOilTypeSelect) itemOilTypeSelect.required = visible;
        if (itemOilContainerSelect) itemOilContainerSelect.required = visible;
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
            klient: '---',
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
        const validCount = parsed.filter(item => item.valid).length;
        if (bulkValidCount) bulkValidCount.textContent = `• do dodania: ${validCount}`;
        bulkErrors.textContent = errors.length ? `Błędne wiersze: ${errors.map(item => item.index).join(', ')}.` : '';
        if (bulkReport) bulkReport.textContent = '';
    };

    async function dodajMasowo(event) {
        event.preventDefault();
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
                    klient: '---',
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
    const OIL_CONTAINER_DEFAULTS = [20, 50, 55, 208];

    const buildOilProductData = ({ typ, pojemnosc, ilosc }) => ({
        index: `OLEJ-${typ}-${pojemnosc}L`,
        nazwa: `Olej ${typ} ${pojemnosc}L`,
        ilosc,
        klient: '---',
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

    const renderOilConverterPresets = () => {
        if (!oilConverterPresets) return;
        const presets = [20, 50, 55, 208];
        oilConverterPresets.innerHTML = presets
            .map((value) => `<button type="button" class="btn-secondary btn-small" data-oil-preset="${value}">${value} L</button>`)
            .join('');
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

    const findOilProduct = ({ typ, pojemnosc }) => {
        return wszystkieProdukty.find((produkt) => {
            const meta = parseOilMeta(produkt);
            return meta.typOleju === typ && Number(meta.pojemnosc) === Number(pojemnosc);
        });
    };

    const handleOilQuickAdd = async () => {
        if (!oilQuickTypeSelect || !oilQuickContainerSelect || !oilQuickQuantityInput || !oilQuickUnitSelect) return;
        const typ = oilQuickTypeSelect.value;
        const pojemnosc = Number(oilQuickContainerSelect.value);
        const unit = oilQuickUnitSelect.value;
        const rawQty = Number(oilQuickQuantityInput.value);
        if (!typ || !Number.isFinite(pojemnosc) || pojemnosc <= 0) { alert("Uzupełnij typ i pojemność."); return; }
        if (!Number.isFinite(rawQty) || rawQty <= 0) { alert("Podaj poprawną ilość."); return; }
        const qtyInUnits = unit === 'L' ? rawQty / pojemnosc : rawQty;
        const normalizedQty = Number(qtyInUnits.toFixed(2));
        if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) { alert("Ilość po przeliczeniu jest nieprawidłowa."); return; }

        const existing = findOilProduct({ typ, pojemnosc });
        try {
            if (existing) {
                await adjustWarehouseStock({ docId: existing.id, changeQty: normalizedQty, operation: 'add' });
            } else {
                const docRef = await addDoc(collection(db, "magazyn"), buildOilProductData({
                    typ,
                    pojemnosc,
                    ilosc: normalizedQty
                }));
                await logActivityEvent({
                    type: 'STOCK_CHANGE',
                    refId: docRef.id,
                    label: `Dodano olej ${typ} ${pojemnosc}L (${normalizedQty} szt.)`
                });
            }
            if (oilQuickQuantityInput) oilQuickQuantityInput.value = '';
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
        const productTypeFilter = magazynFilterOilType?.value || '';
        const containerFilter = magazynFilterContainer?.value || '';
        const lowStockOnly = Boolean(magazynLowStockOnly?.checked);
        return (items || []).filter(item => {
            const matchesSearch = !search || [item.index, item.nazwa].some(val => String(val || '').toLowerCase().includes(search));
            const { pojemnosc } = parseOilMeta(item);
            const productType = resolveWarehouseType(item);
            const matchesProductType = !productTypeFilter || productType === productTypeFilter;
            const matchesContainer = !containerFilter || (pojemnosc && String(pojemnosc) === containerFilter);
            const matchesLowStock = !lowStockOnly || isWarehouseLowStock(item);
            return matchesSearch && matchesProductType && matchesContainer && matchesLowStock;
        });
    };

    const syncLowStockToggleState = () => {
        if (!magazynLowStockToggle || !magazynLowStockOnly) return;
        const isActive = Boolean(magazynLowStockOnly.checked);
        magazynLowStockToggle.classList.toggle('is-active', isActive);
        magazynLowStockToggle.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    };

    const sortMagazynItems = (items) => {
        const dir = magazynSort.dir === 'desc' ? -1 : 1;
        return [...items].sort((a, b) => {
            switch (magazynSort.key) {
                case 'ilosc':
                    return ((Number(a.ilosc) || 0) - (Number(b.ilosc) || 0)) * dir;
                case 'litry':
                    return (getWarehouseOilLiters(a) - getWarehouseOilLiters(b)) * dir;
                case 'index':
                    return (a.index || '').localeCompare(b.index || '', 'pl') * dir;
                case 'typ':
                    return resolveWarehouseType(a).localeCompare(resolveWarehouseType(b), 'pl') * dir;
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
            const litersValue = jestOlejem && pojemnosc ? getWarehouseOilLiters(produkt) : null;
            const iloscWSztukach = `<span class="qty-cell">${iloscFormatowana} szt</span>`;
            const iloscWLitrach = litersValue === null
                ? '—'
                : `<span class="qty-cell">${formatujIloscMagazynu(litersValue)} L</span>`;
            const lastChange = formatWarehouseDate(produkt.updatedAt || produkt.createdAt);
            const isLowStock = isWarehouseLowStock(produkt);
            return `<tr class="${isLowStock ? 'is-low-stock' : ''}" data-id="${produkt.id}" data-name="${produkt.nazwa}" data-qty="${produkt.ilosc}" data-is-oil="${jestOlejem}" data-index="${produkt.index}" data-oil-type="${typOleju}" data-product-type="${productType}" data-container="${pojemnosc || ''}">
                    <td data-label="Indeks">${produkt.index}</td>
                    <td data-label="Nazwa">
                        <div class="warehouse-name-cell">
                            <span class="warehouse-product-name">${produkt.nazwa}</span>
                            ${isLowStock ? '<span class="low-stock-badge">Niski stan</span>' : ''}
                        </div>
                    </td>
                    <td data-label="Typ">${productType || 'INNE'}</td>
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
        if (!magazynFilterOilType || !magazynFilterContainer) return;
        const prevOilType = magazynFilterOilType.value;
        const prevContainer = magazynFilterContainer.value;
        const productTypes = new Set();
        const containers = new Set();
        wszystkieProdukty.forEach(item => {
            const { pojemnosc } = parseOilMeta(item);
            const productType = resolveWarehouseType(item);
            if (productType) productTypes.add(productType);
            if (pojemnosc) containers.add(String(pojemnosc));
        });
        const typeOptions = [''].concat([...productTypes].filter(Boolean).sort());
        magazynFilterOilType.innerHTML = typeOptions.map(val => `<option value="${val}">${val || 'Wszystkie'}</option>`).join('');
        const containerOptions = [''].concat([...containers].filter(Boolean).sort((a, b) => Number(a) - Number(b)));
        magazynFilterContainer.innerHTML = containerOptions.map(val => `<option value="${val}">${val ? `${val} L` : 'Wszystkie'}</option>`).join('');
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
        return [
            { action: 'edit', label: 'Edytuj' },
            { action: 'add', label: 'Dodaj stan' },
            { action: 'remove', label: 'Zdejmij stan' },
            { action: 'history', label: 'Historia', disabled: true },
            { action: 'delete', label: 'Usuń', variant: 'danger' }
        ];
    };

    const ensureMagazynMenuPortal = () => {
        if (magazynMenuPortal) return magazynMenuPortal;
        const menu = document.createElement('div');
        menu.className = 'row-action-menu row-action-menu--portal';
        menu.setAttribute('role', 'menu');
        menu.style.display = 'none';
        menu.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-action]');
            if (!btn || btn.disabled) return;
            const action = btn.dataset.action;
            const produkt = getProductById(magazynMenuState.productId);
            if (!produkt) return;
            closeMagazynRowMenu();
            if (action === 'edit') {
                openProductDetailsModal(produkt, 'add');
                return;
            }
            if (action === 'add') {
                openProductDetailsModal(produkt, 'add');
                return;
            }
            if (action === 'remove') {
                openProductDetailsModal(produkt, 'remove');
                return;
            }
            if (action === 'delete') {
                if (confirm(`Na pewno usunąć produkt „${produkt.nazwa || produkt.index || produkt.id}”?`)) {
                    void deleteDoc(doc(db, "magazyn", produkt.id));
                }
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
        menu.innerHTML = items.map(item => `<button type="button" data-action="${item.action}" class="${item.variant === 'danger' ? 'row-action-item--danger' : ''}" ${item.disabled ? 'disabled' : ''}>${item.label}</button>`).join('');
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
            if (action === 'edit') {
                openProductDetailsModal(produkt, 'add');
                return;
            }
            if (action === 'add') {
                openProductDetailsModal(produkt, 'add');
                return;
            }
            if (action === 'remove') {
                openProductDetailsModal(produkt, 'remove');
                return;
            }
            if (action === 'delete') {
                if (confirm(`Na pewno usunąć produkt „${produkt.nazwa || produkt.index || produkt.id}”?`)) {
                    void deleteDoc(doc(db, "magazyn", produkt.id));
                }
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
        if (!index || !nazwa) { alert('Index i nazwa są wymagane.'); return; }
        const duplicate = wszystkieProdukty.find(p => p.id !== docId && (p.index || '').toLowerCase() === index.toLowerCase());
        if (duplicate) { alert('Index musi być unikalny.'); return; }
        try {
            await updateDoc(doc(db, "magazyn", docId), {
                index,
                nazwa,
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

    initializeMachineTypeSelects();

   // --- PODPIĘCIE EVENTÓW ---
    if (pulpitQuickActionsContainer) pulpitQuickActionsContainer.addEventListener('click', handleQuickActionClick);
    if (pulpitWeeklyContainer) pulpitWeeklyContainer.addEventListener('click', handleWeeklyMissingClick);
    if (pulpitActivityList) pulpitActivityList.addEventListener('click', handleActivityClick);
    if (klientForm) klientForm.addEventListener('submit', dodajKlienta);
    if (clientAddMachineToggle) {
        clientAddMachineToggle.addEventListener('change', () => {
            const enabled = clientAddMachineToggle.checked;
            if (clientAddMachineFields) clientAddMachineFields.hidden = !enabled;
            if (clientMachineTypInput) clientMachineTypInput.required = enabled;
            if (clientMachineModelInput) clientMachineModelInput.required = enabled;
        });
    }
    if (klientAddBtn) {
        klientAddBtn.addEventListener('click', () => {
            openClientDrawer(null, 'add');
        });
    }
    if (listaKlientowDiv) listaKlientowDiv.addEventListener('click', obslugaListyKlientow);
    if (clientStatsSearchInput) clientStatsSearchInput.addEventListener('input', renderClientStatsView);
    if (clientStatsSortSelect) clientStatsSortSelect.addEventListener('change', renderClientStatsView);
    if (clientStatsRangeSelect) clientStatsRangeSelect.addEventListener('change', renderClientStatsView);
    if (clientStatsRanking) {
        clientStatsRanking.addEventListener('click', (event) => {
            const row = event.target.closest('[data-client-stats-id]');
            if (!row) return;
            selectedClientStatsId = row.dataset.clientStatsId || null;
            renderClientStatsView();
        });
    }

    const clientsStatsLinkButton = document.getElementById('clients-stats-link-btn');
    if (clientsStatsLinkButton) {
        clientsStatsLinkButton.addEventListener('click', () => {
            showTab('statystyki-klientow');
        });
    }

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
    if (assignForm) assignForm.addEventListener('submit', zapiszPrzypisanie);
    if (assignModeSelect) assignModeSelect.addEventListener('change', updateAssignModeUI);
    if (assignCloseButton && assignModal) {
        assignCloseButton.onclick = () => { hideModal(assignModal); };
    }
    if (assignCancelBtn && assignModal) {
        assignCancelBtn.addEventListener('click', () => hideModal(assignModal));
    }
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
                .filter(z => z.status === 'zakończone' && resolveServiceDate(z) && resolveServiceDate(z).startsWith(miesiac))
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
    if (bulkInsertExampleBtn && bulkItemsInput) {
        bulkInsertExampleBtn.addEventListener('click', () => {
            bulkItemsInput.value = 'OLEJ-HYGARD-20L;Olej HYGARD 20L;2\nFIL-123;Filtr powietrza;4';
            renderBulkPreview();
        });
    }
    if (magazynLista) magazynLista.addEventListener('click', handleMagazynRowClick);
    if (magazynSearchInput) magazynSearchInput.addEventListener('input', renderMagazynTable);
    if (magazynFilterOilType) magazynFilterOilType.addEventListener('change', renderMagazynTable);
    if (magazynFilterContainer) magazynFilterContainer.addEventListener('change', renderMagazynTable);
    if (magazynLowStockOnly) {
        magazynLowStockOnly.addEventListener('change', () => {
            syncLowStockToggleState();
            renderMagazynTable();
        });
    }
    if (magazynLowStockToggle && magazynLowStockOnly) {
        magazynLowStockToggle.addEventListener('click', () => {
            magazynLowStockOnly.checked = !magazynLowStockOnly.checked;
            magazynLowStockOnly.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }
    if (magazynClearFiltersBtn) {
        magazynClearFiltersBtn.addEventListener('click', () => {
            if (magazynSearchInput) magazynSearchInput.value = '';
            if (magazynFilterOilType) magazynFilterOilType.value = '';
            if (magazynFilterContainer) magazynFilterContainer.value = '';
            if (magazynLowStockOnly) magazynLowStockOnly.checked = false;
            syncLowStockToggleState();
            renderMagazynTable();
        });
    }
    syncLowStockToggleState();
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
            const isOilType = itemProductTypeSelect.value === 'OLEJ';
            if (itemIsOilCheckbox) itemIsOilCheckbox.checked = isOilType;
            setOilFieldsVisibility(isOilType);
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

    if (summaryBillingModeSelect) {
        summaryBillingMode = 'calendar';
        summaryBillingModeSelect.value = 'calendar';
        summaryBillingModeSelect.disabled = true;
        summaryBillingModeSelect.title = 'Tryb rozliczania został ujednolicony.';
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
            const days = normalizeHalfDayValue(vacationAdjustmentDaysInput?.value, { min: -9999, fallback: 0 });
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

    if (quarterlyBonusSummaryContainer) {
        quarterlyBonusSummaryContainer.addEventListener('click', (event) => {
            const toggle = event.target.closest('.quarterly-bonus__toggle');
            if (toggle) {
                quarterlyBonusExpanded = !quarterlyBonusExpanded;
                renderQuarterlyBonusSummary();
                return;
            }
            const historyToggle = event.target.closest('.quarterly-bonus__history-toggle');
            if (historyToggle) {
                quarterlyBonusHistoryExpanded = !quarterlyBonusHistoryExpanded;
                renderQuarterlyBonusSummary();
            }
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
        if (event.key !== 'Escape') return;
        closeMagazynRowMenu();
        const openModalItem = [...trackedModals].reverse().find((modal) => modal && modal.style.display === 'block');
        if (openModalItem) hideModal(openModalItem);
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
            const leaveDaysRaw = normalizeHalfDayValue(plannedLeaveDaysInput?.value, { min: 0, fallback: 0 });
            if (!startParsed || !endParsed) { alert('Wybierz poprawny zakres dat.'); return; }
            if (startParsed > endParsed) { alert('Data końcowa nie może być wcześniejsza niż początkowa.'); return; }
            if (plannedLeaveDaysInput?.value && (!Number.isFinite(leaveDaysRaw) || leaveDaysRaw <= 0)) { alert('Podaj poprawną liczbę dni urlopu (np. 0.5).'); return; }
            const payload = {
                year: Number(selectedYear),
                startDate,
                endDate,
                type: plannedLeaveTypeSelect?.value || 'Urlop planowany',
                note: plannedLeaveNoteInput?.value || '',
                leaveDays: plannedLeaveDaysInput?.value ? leaveDaysRaw : null
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

    if (financeView) {
        financeView.addEventListener('submit', async (event) => {
            const unlockForm = event.target.closest('#finance-unlock-form');
            if (unlockForm) {
                event.preventDefault();
                const passwordInput = unlockForm.querySelector('#finance-password');
                const password = passwordInput?.value || '';
                if (!verifyFinancePassword(password)) {
                    renderFinanceLockScreen('Nieprawidłowe hasło.');
                    return;
                }
                financeUnlocked = true;
                setFinanceUnlockedInSession(true);
                renderFinanceView();
                return;
            }

            const overtimeForm = event.target.closest('[data-overtime-form-month]');
            if (!overtimeForm) return;
            event.preventDefault();
            const monthKey = overtimeForm.dataset.overtimeFormMonth || '';
            const client = overtimeForm.querySelector('[data-overtime-field="client"]')?.value?.trim() || '';
            const netAmount = Number(overtimeForm.querySelector('[data-overtime-field="net"]')?.value) || 0;
            const note = overtimeForm.querySelector('[data-overtime-field="note"]')?.value?.trim() || '';
            const date = `${monthKey}-01`;
            if (!monthKey || !client || netAmount <= 0) {
                alert('Uzupełnij klienta i poprawną kwotę netto.');
                return;
            }
            const payload = { date, client, netAmount, note };
            if (financeOvertimeEditId) {
                await updateOvertimeEntry(db, financeOvertimeEditId, payload);
                financeOvertimeEditId = null;
            } else {
                await addOvertimeEntry(db, payload);
            }
            financeOvertimeFormMonth = null;
            financeOvertimeEntries = await listOvertimeEntriesForYear(db, financeOvertimeYear);
            renderFinanceView();
        });

        financeView.addEventListener('click', async (event) => {
            const tabBtn = event.target.closest('[data-finance-tab]');
            if (tabBtn) {
                financeInnerTab = tabBtn.dataset.financeTab === 'overtime' ? 'overtime' : 'agro';
                if (financeInnerTab === 'overtime') {
                    financeOvertimeEntries = await listOvertimeEntriesForYear(db, financeOvertimeYear);
                }
                financeAgroEditingMonth = null;
                financeAgroDraft = null;
                financeOvertimeFormMonth = null;
                financeOvertimeEditId = null;
                renderFinanceView();
                return;
            }

            if (event.target.closest('#finance-lock-btn')) {
                financeUnlocked = false;
                financeAgroEditingMonth = null;
                financeAgroDraft = null;
                financeOvertimeEditId = null;
                financeOvertimeFormMonth = null;
                setFinanceUnlockedInSession(false);
                renderFinanceView();
                return;
            }

            const cancelFormBtn = event.target.closest('[data-overtime-cancel-form]');
            if (cancelFormBtn) {
                financeOvertimeEditId = null;
                financeOvertimeFormMonth = null;
                renderFinanceView();
                return;
            }

            const agroEditBtn = event.target.closest('[data-agro-edit]');
            if (agroEditBtn) {
                const monthKey = agroEditBtn.dataset.agroEdit;
                const current = financeAgroRowsByMonth[monthKey] || { baseNet: 0, bonusNet: 0 };
                financeAgroEditingMonth = monthKey;
                financeAgroDraft = {
                    baseNet: current.baseNet ?? 0,
                    bonusNet: current.bonusNet ?? 0
                };
                renderFinanceView();
                return;
            }

            if (event.target.closest('[data-agro-cancel]')) {
                financeAgroEditingMonth = null;
                financeAgroDraft = null;
                renderFinanceView();
                return;
            }

            const agroSaveBtn = event.target.closest('[data-agro-save]');
            if (agroSaveBtn) {
                const monthKey = agroSaveBtn.dataset.agroSave;
                if (!monthKey || monthKey !== financeAgroEditingMonth) return;
                const rowEl = agroSaveBtn.closest('tr');
                const baseNetInput = rowEl?.querySelector('[data-agro-draft-input="baseNet"]');
                const bonusNetInput = rowEl?.querySelector('[data-agro-draft-input="bonusNet"]');
                const values = {
                    baseNet: baseNetInput?.value ?? financeAgroDraft?.baseNet,
                    bonusNet: bonusNetInput?.value ?? financeAgroDraft?.bonusNet
                };
                await saveAgroMonth(monthKey, values);
                financeAgroEditingMonth = null;
                financeAgroDraft = null;
                return;
            }

            const overtimeToggleBtn = event.target.closest('[data-overtime-toggle]');
            if (overtimeToggleBtn) {
                const monthKey = overtimeToggleBtn.dataset.overtimeToggle;
                if (financeOvertimeExpandedMonths.has(monthKey)) financeOvertimeExpandedMonths.delete(monthKey);
                else financeOvertimeExpandedMonths.add(monthKey);
                renderFinanceView();
                return;
            }

            const openOvertimeFormBtn = event.target.closest('[data-overtime-open-form]');
            if (openOvertimeFormBtn) {
                const monthKey = openOvertimeFormBtn.dataset.overtimeOpenForm;
                financeOvertimeFormMonth = monthKey || null;
                const editingEntry = financeOvertimeEntries.find((entry) => entry.id === financeOvertimeEditId);
                if (editingEntry && !String(editingEntry.date || '').startsWith(monthKey || '')) {
                    financeOvertimeEditId = null;
                }
                renderFinanceView();
                return;
            }

            const actionBtn = event.target.closest('[data-overtime-action]');
            if (!actionBtn) return;
            const entry = financeOvertimeEntries.find((item) => item.id === actionBtn.dataset.id);
            if (!entry) return;
            if (actionBtn.dataset.overtimeAction === 'delete') {
                if (!confirm('Usunąć wpis?')) return;
                await deleteOvertimeEntry(db, entry.id);
                financeOvertimeEntries = await listOvertimeEntriesForYear(db, financeOvertimeYear);
                if (financeOvertimeEditId === entry.id) financeOvertimeEditId = null;
                renderFinanceView();
                return;
            }
            financeOvertimeEditId = entry.id;
            financeOvertimeFormMonth = String(entry.date || '').slice(0, 7);
            if (financeOvertimeFormMonth) financeOvertimeExpandedMonths.add(financeOvertimeFormMonth);
            renderFinanceView();
        });

        financeView.addEventListener('change', async (event) => {
            const yearSelect = event.target.closest('#finance-year');
            if (yearSelect) {
                financeYear = Number(yearSelect.value) || 2026;
                financeAgroRowsByMonth = await loadAgroEffectYear(db, financeYear);
                financeAgroEditingMonth = null;
                financeAgroDraft = null;
                renderFinanceView();
                return;
            }
            const overtimeYearSelect = event.target.closest('#finance-overtime-year');
            if (overtimeYearSelect) {
                financeOvertimeYear = Number(overtimeYearSelect.value) || 2026;
                financeOvertimeEntries = await listOvertimeEntriesForYear(db, financeOvertimeYear);
                financeOvertimeFormMonth = null;
                financeOvertimeEditId = null;
                financeOvertimeExpandedMonths = new Set();
                renderFinanceView();
                return;
            }
            const agroDraftInput = event.target.closest('[data-agro-draft-input]');
            if (!agroDraftInput || !financeAgroEditingMonth) return;
            const field = agroDraftInput.dataset.agroDraftInput;
            if (field !== 'baseNet' && field !== 'bonusNet') return;
            financeAgroDraft = {
                ...(financeAgroDraft || {}),
                [field]: agroDraftInput.value
            };
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
    renderOilConverterPresets();
    if (oilConverterPresets && oilConverterContainer) {
        oilConverterPresets.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-oil-preset]');
            if (!btn) return;
            oilConverterContainer.value = String(btn.dataset.oilPreset || '');
            if (oilConverterLitersInput?.value) updateOilConverter(oilConverterLitersInput);
            if (oilConverterUnitsInput?.value) updateOilConverter(oilConverterUnitsInput);
        });
    }

    // KALENDARZ (modal + klik w kalendarzu)
    if (kalendarzForm) kalendarzForm.addEventListener('submit', obslugaZapisuGodzin);
    if (kalendarzForm) {
        kalendarzForm.querySelectorAll('input[name="dayLeave"]').forEach((radio) => {
            radio.addEventListener('change', syncDayLeaveAmountState);
        });
    }
    syncDayLeaveAmountState();
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
    if (editZlecenieClientSelect) {
        editZlecenieClientSelect.addEventListener('change', () => {
            fillEditOrderMachines(editZlecenieClientSelect.value || '', '');
        });
    }
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

    // Klik poza modalem wyłączony zgodnie z UX (zamykanie tylko X/ESC).


    if (notesAddBtn) notesAddBtn.addEventListener('click', () => openNoteEditor(null));
    if (notesQuickCreateInput) {
        notesQuickCreateInput.addEventListener('focus', () => openNoteEditor({ title: notesQuickCreateInput.value || '' }));
        notesQuickCreateInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            openNoteEditor({ title: notesQuickCreateInput.value || '' });
        });
    }
    if (notesSearchInput) notesSearchInput.addEventListener('input', renderNotesList);
    if (notesFilterType) notesFilterType.addEventListener('change', renderNotesList);
    if (notesFilterOrder) notesFilterOrder.addEventListener('change', renderNotesList);
    if (notesEditorOrderInput && notesEditorOrderDropdown) {
        notesEditorOrderInput.addEventListener('input', () => {
            notesEditorOrder.value = '';
            notesDirty = true;
            updateNotesEditorOrderClear();
            renderNotesOrderDropdown();
        });
        notesEditorOrderInput.addEventListener('focus', renderNotesOrderDropdown);
        notesEditorOrderInput.addEventListener('click', renderNotesOrderDropdown);
        notesEditorOrderDropdown.addEventListener('click', (event) => {
            const optionBtn = event.target.closest('[data-order-option-id]');
            if (!optionBtn) return;
            const selected = notesOrderOptions.find((option) => option.id === optionBtn.dataset.orderOptionId);
            if (!selected) return;
            notesEditorOrder.value = selected.id;
            notesEditorOrderInput.value = selected.label;
            notesEditorOrderDropdown.classList.remove('is-open');
            updateNotesEditorOrderClear();
            notesDirty = true;
        });
        document.addEventListener('click', (event) => {
            const root = notesEditorOrderInput.closest('.combobox');
            if (!root?.contains(event.target)) {
                notesEditorOrderDropdown.classList.remove('is-open');
            }
        });
    }
    if (notesEditorOrderClear) {
        notesEditorOrderClear.addEventListener('click', () => {
            notesEditorOrder.value = '';
            if (notesEditorOrderInput) notesEditorOrderInput.value = '';
            notesEditorOrderDropdown?.classList.remove('is-open');
            updateNotesEditorOrderClear();
            notesDirty = true;
        });
    }
    if (notesExportSelectedBtn) notesExportSelectedBtn.addEventListener('click', () => exportSingleNote(allNotes.find((note) => note.id === selectedNoteId)));
    if (notesExportFilteredBtn) notesExportFilteredBtn.addEventListener('click', () => exportManyNotes(getNotesViewModel().results, 'notatki_filtr.txt'));
    if (notesListContainer) {
        const openNoteFromCard = (noteCard) => {
            const noteId = noteCard?.dataset.noteId;
            if (!noteId) return;
            selectedNoteId = noteId;
            const note = allNotes.find((item) => item.id === noteId);
            if (!note) return;
            renderNotesList();
            openNoteEditor(note);
        };
        notesListContainer.addEventListener('click', (event) => {
            openNoteFromCard(event.target.closest('[data-note-id]'));
        });
        notesListContainer.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const noteCard = event.target.closest('[data-note-id]');
            if (!noteCard) return;
            event.preventDefault();
            openNoteFromCard(noteCard);
        });
    }
    if (notesEditorForm) {
        notesEditorForm.addEventListener('input', () => { notesDirty = true; });
        notesEditorForm.addEventListener('change', (event) => {
            if (event.target?.name === 'notes-link-type') {
                notesEditorOrderGroup.hidden = event.target.value !== NOTE_LINK_TYPES.ORDER;
            }
            notesDirty = true;
        });
        notesEditorForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const noteId = notesEditorId.value;
            const linkType = notesEditorForm.querySelector('input[name="notes-link-type"]:checked')?.value || NOTE_LINK_TYPES.NONE;
            const payload = {
                title: notesEditorTitle.value || '',
                contentHtml: notesEditorContent.innerHTML || '',
                contentText: (notesEditorContent.textContent || '').replace(/\s+/g, ' ').trim(),
                linkType,
                linkedOrderId: linkType === NOTE_LINK_TYPES.ORDER ? (notesEditorOrder.value || null) : null,
                orderLabel: linkType === NOTE_LINK_TYPES.ORDER ? (notesOrderOptions.find((o)=>o.id===notesEditorOrder.value)?.label || '') : '',
                pinned: Boolean(notesEditorPinned?.checked),
                color: notesEditorColor?.value || '#ffffff'
            };
            if (!(payload.contentText || '').trim()) return alert('Treść notatki jest wymagana.');
            if (linkType === NOTE_LINK_TYPES.ORDER && !payload.linkedOrderId) return alert('Wybierz zlecenie do powiązania.');
            if (noteId) await notesData.updateNote(noteId, payload); else await notesData.createNote(payload);
            notesDirty = false;
            hideModal(notesModal);
        });
    }
    if (notesToolbar && notesEditorContent) {
        notesToolbar.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-cmd]');
            if (!btn) return;
            const cmd = btn.dataset.cmd;
            notesEditorContent.focus();
            if (cmd === 'createLink') {
                const url = window.prompt('Podaj URL');
                if (url) document.execCommand('createLink', false, url);
            } else if (cmd === 'h1' || cmd === 'h2') {
                document.execCommand('formatBlock', false, cmd.toUpperCase());
            } else if (cmd === 'task') {
                document.execCommand('insertHTML', false, '<ul><li>☐ Zadanie</li></ul>');
            } else if (cmd === 'mono') {
                document.execCommand('insertHTML', false, '<code>kod</code>');
            } else {
                document.execCommand(cmd, false, null);
            }
            notesDirty = true;
        });
    }
    if (notesEditorCancel) notesEditorCancel.addEventListener('click', closeNoteEditor);
    if (notesModalClose) notesModalClose.addEventListener('click', closeNoteEditor);
    if (notesEditorDelete) notesEditorDelete.addEventListener('click', async () => {
        const noteId = notesEditorId.value;
        if (!noteId) return;
        await notesData.deleteNote(noteId);
        notesDirty = false;
        hideModal(notesModal);
    });
    if (notesEditorExport) notesEditorExport.addEventListener('click', () => {
        const noteId = notesEditorId.value;
        exportSingleNote(allNotes.find((n) => n.id === noteId));
    });
    if (pulpitActivityToggle) {
        pulpitActivityToggle.addEventListener('click', () => setActivityCollapsed(!notesActivityCollapsed));
    }

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
        safeInitModule('notes', notesListContainer, () => nasluchujNaNotatki(), 'Moduł notatnika niedostępny.');
        try {
            wyswietlWpisyKalendarza();
        } catch (error) {
            console.error('[calendar-data] init error', error);
        }
    };

    // --- INICJALIZACJA (MUSI BYĆ WEWNĄTRZ initializeApp) ---
    inicjujZwijanie();
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
