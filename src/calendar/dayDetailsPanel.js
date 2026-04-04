import { computeDayTotals } from './computeDayTotals.js';

const LEAVE_LABELS = {
  L4: 'L4',
  URL: 'Urlop',
  SWIETO: 'Święto',
  WOLNE: 'Wolne',
  SZKOLENIE: 'Szkolenie',
};

const formatNumber = (value) => {
  const num = Number(value || 0) || 0;
  return num.toFixed(1);
};

const formatHours = (value) => `${formatNumber(value)} h`;

const formatDateLabel = (dayKey) => {
  if (!dayKey) return 'Wybierz dzień';
  const date = new Date(dayKey);
  if (Number.isNaN(date.getTime())) return dayKey;
  return new Intl.DateTimeFormat('pl-PL', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
};

const buildSummaryLines = (totals, mode) => {
  if (mode === 'short') {
    return {
      primary: `P: ${formatNumber(totals.work)} • J: ${formatNumber(totals.drive)}`,
      secondary: `F: ${formatNumber(totals.billed)} • N: ${formatNumber(totals.over)}`,
    };
  }
  return {
    primary: `Praca: ${formatNumber(totals.work)} • Jazda: ${formatNumber(totals.drive)}`,
    secondary: `Fakturowane: ${formatNumber(totals.billed)} • Nadgodziny: ${formatNumber(totals.over)}`,
  };
};

const buildSummaryTiles = (totals) => ([
  { label: 'Praca', value: formatHours(totals.work) },
  { label: 'Jazda', value: formatHours(totals.drive) },
  { label: 'Fakturowane', value: formatHours(totals.billed) },
  { label: 'Nadgodziny', value: formatHours(totals.over) },
]);

const buildOrderMeta = (order) => {
  const parts = [];
  if (Number(order.work || 0) !== 0) parts.push(`P ${formatNumber(order.work)}h`);
  if (Number(order.drive || 0) !== 0) parts.push(`J ${formatNumber(order.drive)}h`);
  if (Number(order.billed || 0) !== 0) parts.push(`F ${formatNumber(order.billed)}h`);
  if (Number(order.over || 0) !== 0) parts.push(`N ${formatNumber(order.over)}h`);
  return parts.length ? parts.join(' • ') : 'Brak godzin';
};

export const buildDayDetailsModel = ({
  dayKey,
  dayDoc,
  orders = [],
  manual = {},
  summaryMode = 'full',
}) => {
  const totalsResult = computeDayTotals(dayKey);
  const totals = totalsResult?.totals || { work: 0, drive: 0, billed: 0, over: 0 };
  const leaveKind = totalsResult?.leaveKind || null;
  const leaveLabel = leaveKind ? (LEAVE_LABELS[leaveKind] || leaveKind) : null;
  const summaryLines = buildSummaryLines(totals, summaryMode);
  const summaryTiles = buildSummaryTiles(totals);

  const manualNote = (dayDoc?.notatka || dayDoc?.note || '').toString().trim();
  const manualWork = Number(manual.work || 0) || 0;
  const manualDrive = Number(manual.drive || 0) || 0;
  const manualBilled = Number(manual.billed || 0) || 0;
  const manualOver = Number(manual.over || 0) || 0;
  const manualRows = [
    { label: 'Praca', value: formatHours(manualWork) },
    { label: 'Jazda', value: formatHours(manualDrive) },
    { label: 'Fakturowane', value: formatHours(manualBilled) },
    { label: 'Nadgodziny', value: formatHours(manualOver) },
  ];
  const manualHasData = Boolean(manualNote) || [manualWork, manualDrive, manualBilled, manualOver].some((value) => value !== 0);

  const orderItems = (orders || []).map((order, index) => {
    const billed = Number(order?.billed || 0) || 0;
    return {
      id: order?.orderId || `${dayKey || 'day'}-${index}`,
      orderId: order?.orderId || null,
      clientName: order?.clientName || order?.orderId || 'Zlecenie',
      status: billed > 0 ? 'Fakturowane' : 'Robocze',
      statusTone: billed > 0 ? 'billed' : 'draft',
      meta: buildOrderMeta(order || {}),
    };
  });

  return {
    dayKey,
    title: formatDateLabel(dayKey),
    subtitle: leaveLabel ? `Status dnia: ${leaveLabel}` : 'Szczegóły dnia pracy',
    leaveLabel,
    summary: {
      mode: summaryMode,
      primary: summaryLines.primary,
      secondary: summaryLines.secondary,
      tiles: summaryTiles,
    },
    orders: orderItems,
    hasOrders: orderItems.length > 0,
    manual: {
      rows: manualRows,
      note: manualNote,
      hasData: manualHasData,
    },
  };
};

export const renderDayDetailsPanel = (container, model) => {
  if (!container) return;
  if (!model || !model.dayKey) {
    container.innerHTML = `
      <div class="calendar-day-panel__empty">
        <div class="calendar-day-panel__title">Wybierz dzień</div>
        <p>Kliknij dzień w widoku tygodnia, aby zobaczyć szczegóły.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="calendar-day-panel__header">
      <div>
        <div class="calendar-day-panel__title">${model.title}</div>
        <div class="calendar-day-panel__subtitle">${model.subtitle}</div>
      </div>
      <div class="calendar-day-panel__actions">
        <button type="button" class="btn-ghost btn-small" data-panel-action="pin" aria-pressed="false">Przypnij</button>
        <button type="button" class="btn-ghost btn-small" data-panel-action="close">Zamknij</button>
      </div>
    </div>
    <div class="calendar-day-panel__body">
      <div class="calendar-day-panel__form-host" data-panel-form-host></div>
    </div>
  `;

  const pinButton = container.querySelector('[data-panel-action="pin"]');
  if (pinButton && container.dataset.panelPinned === 'true') {
    pinButton.setAttribute('aria-pressed', 'true');
  }
};
