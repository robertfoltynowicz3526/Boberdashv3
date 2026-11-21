import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderTimeIndex, getOrderTime } from './orderTimeEntries.js';

test('sums only invoiced hours linked to the exact order ID and sorts dates descending', () => {
  const index = buildOrderTimeIndex([
    { id: '2026-10-27', work: 8, fakturowane: 100, zleceniaPowiazane: [
      { zlecenieId: '131733', entryId: 'a', fakturowane: 4 },
      { zlecenieId: 'other', entryId: 'b', fakturowane: 3 },
    ] },
    { id: '2026-10-28', work: 8, zleceniaPowiazane: [
      { zlecenieId: '131733', entryId: 'c', fakturowane: 5.5 },
      { zlecenieId: '131733', entryId: 'd', fakturowane: '0,5' },
      { zlecenieId: '131733', entryId: 'd', fakturowane: '0,5' },
      { fakturowane: 40 },
    ] },
    { id: '2026-10-29', work: 7, fakturowane: 7 },
  ]);
  assert.deepEqual(getOrderTime(index, '131733'), {
    rows: [{ date: '2026-10-28', hours: 6 }, { date: '2026-10-27', hours: 4 }],
    total: 10,
  });
  assert.equal(getOrderTime(index, 'other').total, 3);
  assert.deepEqual(getOrderTime(index, 'missing'), { rows: [], total: 0 });
});
