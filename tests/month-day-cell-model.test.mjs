import assert from 'node:assert/strict';
import { buildDayCellViewModel, readDayData } from '../src/calendar/monthDayCellModel.js';

const januaryDecorations = {
  clientsByDay: {
    '2026-01-08': ['Kruszyk'],
    '2026-01-09': ['Kruszyk', 'Acme', 'Beta'],
  },
  leaveByDay: {
    '2026-01-12': 'URL',
    '2026-01-13': 'L4',
    '2026-01-06': 'SWIETO',
  },
  summaryByDay: {
    '2026-01-08': { praca: 8, jazda: 1, fakturowane: 7, nadgodziny: 0 },
    '2026-01-09': { praca: 0, jazda: 0, fakturowane: 0, nadgodziny: 0 },
  },
};

const withKruszyk = buildDayCellViewModel({
  dayKey: '2026-01-08',
  data: readDayData('2026-01-08', januaryDecorations),
});
assert.equal(withKruszyk.visibleClients[0], 'Kruszyk');
assert.equal(withKruszyk.hasChips, true);
assert.equal(withKruszyk.hasSummary, true);

const withOverflow = buildDayCellViewModel({
  dayKey: '2026-01-09',
  data: readDayData('2026-01-09', januaryDecorations),
});
assert.equal(withOverflow.visibleClients.length, 2);
assert.equal(withOverflow.overflowCount, 1);
assert.equal(withOverflow.hasSummary, true, 'summary should render when there are linked orders/entries even with zero totals');

const urlopDay = buildDayCellViewModel({
  dayKey: '2026-01-12',
  data: readDayData('2026-01-12', januaryDecorations),
});
assert.equal(urlopDay.status?.label, 'Urlop');
assert.equal(urlopDay.hasChips, true);

const l4Day = buildDayCellViewModel({
  dayKey: '2026-01-13',
  data: readDayData('2026-01-13', januaryDecorations),
});
assert.equal(l4Day.status?.label, 'L4');

const swietoDay = buildDayCellViewModel({
  dayKey: '2026-01-06',
  data: readDayData('2026-01-06', januaryDecorations),
});
assert.equal(swietoDay.status?.label, 'Święto');

const emptyDay = buildDayCellViewModel({
  dayKey: '2026-01-21',
  data: readDayData('2026-01-21', januaryDecorations),
});
assert.equal(emptyDay.hasChips, false);
assert.equal(emptyDay.hasSummary, false);

console.log('month-day-cell-model: ok');
