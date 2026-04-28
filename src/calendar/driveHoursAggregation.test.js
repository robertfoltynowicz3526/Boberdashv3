import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateMonthlyDriveHours, getMonthlyDriveHoursFromCalendar, readEntryDriveHours } from './driveHoursAggregation.js';

test('reads drive hours from manual and linked legacy fields', () => {
  const entry = {
    date: '2026-03-12',
    czasJazdy: '1,5',
    zleceniaPowiazane: [
      { czasJazdyDlaZlecenia: 2 },
      { driveForOrderHours: '0.5' },
    ],
  };
  assert.equal(readEntryDriveHours(entry), 4);
});

test('monthly drive hours are consistent for summary/premium paths', () => {
  const entries = [
    { id: '2026-02-01', jazda: 2 },
    {
      date: '2026-02-02',
      driveHours: 1,
      powiazane: [{ jazda: 0.5 }, { driveHours: 1.5 }],
    },
    { date: '2026-03-03', drive: 10 },
  ];

  const monthly = aggregateMonthlyDriveHours(entries);
  const februaryFromMap = monthly.get('2026-02');
  const februaryFromSelector = getMonthlyDriveHoursFromCalendar(entries, '2026-02');

  assert.equal(februaryFromMap, 5);
  assert.equal(februaryFromSelector, 5);
});

