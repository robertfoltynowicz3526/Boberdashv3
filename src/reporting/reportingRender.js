import Papa from 'papaparse';

const formatNumber = (value) => (Number(value) || 0).toFixed(2);

const formatMonthLabel = (monthKey) => {
  if (!monthKey) return '';
  try {
    const date = new Date(`${monthKey}-01T00:00:00`);
    return new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' })
      .format(date)
      .toLowerCase();
  } catch (_) {
    return monthKey;
  }
};

const buildCsv = (columns, rows) =>
  Papa.unparse({
    fields: columns,
    data: rows.map((row) => columns.map((col) => row[col] ?? ''))
  });

const downloadBlob = (blob, filename) => {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
};

const buildSummaryRows = ({ months = [], yearlyTotals, unassignedBilled = 0, billingMode = "settlement" }) => {
  const summaryRows = months.map((month) => ({
    'Miesiąc': month.monthKey,
    'Praca(h)': formatNumber(month.totals.work),
    'Jazda(h)': formatNumber(month.totals.drive),
    'Wyfakturowane(h)': formatNumber(month.totals.billed),
    'Nadgodziny(h)': formatNumber(month.totals.over),
    'Absorpcja(%)': formatNumber(month.absorpcja),
    'L4(dni)': month.totals.l4Days,
    'Urlop(dni)': month.totals.urlopDays
  }));

  if (months.length) {
    if (billingMode === 'settlement' && (Number(unassignedBilled) || 0) > 0) {
      summaryRows.push({
        'Miesiąc': 'Nieprzypisane do rozliczenia',
        'Praca(h)': '',
        'Jazda(h)': '',
        'Wyfakturowane(h)': formatNumber(unassignedBilled),
        'Nadgodziny(h)': '',
        'Absorpcja(%)': '',
        'L4(dni)': '',
        'Urlop(dni)': ''
      });
    }

    summaryRows.push({
      'Miesiąc': 'Razem',
      'Praca(h)': formatNumber(yearlyTotals.work),
      'Jazda(h)': formatNumber(yearlyTotals.drive),
      'Wyfakturowane(h)': formatNumber(yearlyTotals.billed),
      'Nadgodziny(h)': formatNumber(yearlyTotals.over),
      'Absorpcja(%)': formatNumber(yearlyTotals.absorpcja),
      'L4(dni)': yearlyTotals.l4Days,
      'Urlop(dni)': yearlyTotals.urlopDays
    });
  }

  return summaryRows;
};

const buildOrdersRows = ({ orders = [] }) =>
  orders.map((order) => ({
    'Data': order.date,
    'Klient': order.clientName,
    'Praca(h)': formatNumber(order.workHours),
    'Jazda(h)': formatNumber(order.driveHours),
    'Wyfakturowane(h)': formatNumber(order.billedHours),
    'Nadgodziny(h)': formatNumber(order.overHours),
    'Notatka': order.note || ''
  }));

export const exportYearlySummaryCsv = ({ year, months = [], yearlyTotals, unassignedBilled = 0, billingMode = "settlement" }) => {
  const summaryColumns = [
    'Miesiąc',
    'Praca(h)',
    'Jazda(h)',
    'Wyfakturowane(h)',
    'Nadgodziny(h)',
    'Absorpcja(%)',
    'L4(dni)',
    'Urlop(dni)'
  ];
  const summaryRows = buildSummaryRows({ months, yearlyTotals, unassignedBilled, billingMode });
  const summaryCsv = buildCsv(summaryColumns, summaryRows);
  const summaryBlob = new Blob([`\uFEFF${summaryCsv}`], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(summaryBlob, `yearly_summary_${year}_${billingMode}.csv`);
};

export const exportYearlyOrdersCsv = ({ year, orders = [], billingMode = "settlement" }) => {
  const ordersColumns = [
    'Data',
    'Klient',
    'Praca(h)',
    'Jazda(h)',
    'Wyfakturowane(h)',
    'Nadgodziny(h)',
    'Notatka'
  ];
  const ordersRows = buildOrdersRows({ orders });
  const ordersCsv = buildCsv(ordersColumns, ordersRows);
  const ordersBlob = new Blob([`\uFEFF${ordersCsv}`], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(ordersBlob, `orders_${year}_${billingMode}.csv`);
};

export const exportYearlyCsv = ({ year, months = [], yearlyTotals, orders = [], unassignedBilled = 0, billingMode = "settlement" }) => {
  exportYearlySummaryCsv({ year, months, yearlyTotals, unassignedBilled, billingMode });
  exportYearlyOrdersCsv({ year, orders, billingMode });
};

const drawTable = (doc, { startY, columns, rows }) => {
  const margin = 40;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const tableWidth = pageWidth - margin * 2;
  const colWidths = columns.map((col) => col.width || tableWidth / columns.length);
  const rowHeight = 18;
  let y = startY;

  const drawHeader = () => {
    doc.setFillColor(230, 230, 230);
    doc.rect(margin, y, tableWidth, rowHeight, 'F');
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(9);
    let x = margin;
    columns.forEach((col, idx) => {
      doc.text(String(col.label), x + 4, y + 12);
      x += colWidths[idx];
    });
    y += rowHeight;
  };

  drawHeader();

  rows.forEach((row) => {
    if (y + rowHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
      drawHeader();
    }
    let x = margin;
    doc.setTextColor(40, 40, 40);
    doc.setFontSize(9);
    columns.forEach((col, idx) => {
      const value = row[col.key] ?? '';
      doc.text(String(value), x + 4, y + 12);
      x += colWidths[idx];
    });
    y += rowHeight;
  });

  return y;
};

const buildClientSummaryRows = (clientTotals = []) => {
  if (clientTotals.length <= 10) return clientTotals;
  const top = clientTotals.slice(0, 10);
  const rest = clientTotals.slice(10).reduce(
    (acc, item) => {
      acc.work += item.totals.work;
      acc.drive += item.totals.drive;
      acc.billed += item.totals.billed;
      acc.over += item.totals.over;
      return acc;
    },
    { work: 0, drive: 0, billed: 0, over: 0 }
  );
  return [...top, { clientName: 'Pozostali', totals: rest }];
};

export const exportYearlyPdf = ({ year, months = [], yearlyTotals, clientTotals = [], unassignedBilled = 0, billingMode = "settlement" }) => {
  const jsPDF = window?.jspdf?.jsPDF;
  if (!jsPDF) {
    alert('Eksport PDF jest niedostępny (brak biblioteki).');
    return;
  }
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const margin = 40;
  let y = margin;

  doc.setFontSize(18);
  doc.setTextColor(10, 10, 10);
  doc.text(`Raport roczny ${year} (${billingMode === 'calendar' ? 'kalendarz' : 'rozliczenie'})`, margin, y);
  y += 24;

  doc.setFontSize(12);
  doc.text('Podsumowanie miesięczne', margin, y);
  y += 10;

  if (months.length) {
    const monthRows = months.map((month) => ({
      month: formatMonthLabel(month.monthKey),
      work: formatNumber(month.totals.work),
      drive: formatNumber(month.totals.drive),
      billed: formatNumber(month.totals.billed),
      over: formatNumber(month.totals.over),
      absorpcja: `${formatNumber(month.absorpcja)}%`,
      l4: String(month.totals.l4Days),
      urlop: String(month.totals.urlopDays)
    }));
    if (billingMode === 'settlement' && (Number(unassignedBilled) || 0) > 0) {
      monthRows.push({
        month: 'Nieprzypisane do rozliczenia',
        work: '',
        drive: '',
        billed: formatNumber(unassignedBilled),
        over: '',
        absorpcja: '',
        l4: '',
        urlop: ''
      });
    }
    monthRows.push({
      month: 'Razem',
      work: formatNumber(yearlyTotals.work),
      drive: formatNumber(yearlyTotals.drive),
      billed: formatNumber(yearlyTotals.billed),
      over: formatNumber(yearlyTotals.over),
      absorpcja: `${formatNumber(yearlyTotals.absorpcja)}%`,
      l4: String(yearlyTotals.l4Days),
      urlop: String(yearlyTotals.urlopDays)
    });

    y = drawTable(doc, {
      startY: y + 8,
      columns: [
        { key: 'month', label: 'Miesiąc', width: 160 },
        { key: 'work', label: 'Praca (h)' },
        { key: 'drive', label: 'Jazda (h)' },
        { key: 'billed', label: 'Wyfakturowane (h)' },
        { key: 'over', label: 'Nadgodziny (h)' },
        { key: 'absorpcja', label: 'Absorpcja' },
        { key: 'l4', label: 'L4 (dni)' },
        { key: 'urlop', label: 'Urlop (dni)' }
      ],
      rows: monthRows
    });
  } else {
    doc.setFontSize(10);
    doc.text('Brak danych do wyświetlenia dla wskazanego roku.', margin, y + 16);
    y += 24;
  }

  y += 24;
  doc.setFontSize(12);
  doc.text('Podsumowanie klientów', margin, y);
  y += 10;

  const clientRows = buildClientSummaryRows(clientTotals).map((item) => ({
    client: item.clientName,
    work: formatNumber(item.totals.work),
    drive: formatNumber(item.totals.drive),
    billed: formatNumber(item.totals.billed),
    over: formatNumber(item.totals.over)
  }));

  if (clientRows.length) {
    drawTable(doc, {
      startY: y + 8,
      columns: [
        { key: 'client', label: 'Klient', width: 240 },
        { key: 'work', label: 'Praca (h)' },
        { key: 'drive', label: 'Jazda (h)' },
        { key: 'billed', label: 'Wyfakturowane (h)' },
        { key: 'over', label: 'Nadgodziny (h)' }
      ],
      rows: clientRows
    });
  } else {
    doc.setFontSize(10);
    doc.text('Brak danych klientów dla wskazanego roku.', margin, y + 20);
  }

  doc.save(`raport_${year}_${billingMode}.pdf`);
};
