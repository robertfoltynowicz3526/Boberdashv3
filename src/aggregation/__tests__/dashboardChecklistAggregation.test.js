import { describe, expect, test } from 'vitest';
import {
  getMissingSummaryDays,
  getUnbilledOrders,
  getPlannedLeaveMissingCalendar
} from '../dashboardChecklistAggregation.js';

describe('dashboard checklist aggregation', () => {
  test('getMissingSummaryDays counts only empty working days', () => {
    const manualByDay = new Map([
      ['2024-07-02', { work: 2, drive: 0, billed: 0, over: 0 }]
    ]);
    const ordersByDay = new Map([
      ['2024-07-03', [{ orderId: 'A1' }]]
    ]);
    const leaveByDay = new Map([
      ['2024-07-04', 'URL']
    ]);
    const result = getMissingSummaryDays({
      monthStart: '2024-07-01',
      monthEnd: '2024-07-05',
      manualByDay,
      ordersByDay,
      leaveByDay
    });

    expect(result.count).toBe(2);
    expect(result.days).toEqual(['2024-07-01', '2024-07-05']);
  });

  test('getMissingSummaryDays skips weekends when enabled', () => {
    const result = getMissingSummaryDays({
      monthStart: '2024-07-06',
      monthEnd: '2024-07-07',
      manualByDay: new Map(),
      ordersByDay: new Map(),
      leaveByDay: new Map()
    });

    expect(result.count).toBe(0);
    expect(result.days).toEqual([]);
  });

  test('getUnbilledOrders respects status and billed values', () => {
    const result = getUnbilledOrders({
      orders: [
        { id: '1', status: 'ukończone', billedValue: 0 },
        { id: '2', status: 'aktywne', billedValue: 0 },
        { id: '3', status: '', billedValue: 0, workValue: 3 },
        { id: '4', status: '', billedValue: 1, workValue: 4 }
      ]
    });

    expect(result.ids).toEqual(['1', '3']);
    expect(result.count).toBe(2);
  });

  test('getPlannedLeaveMissingCalendar finds gaps in calendar', () => {
    const leaveByDay = new Map([
      ['2024-08-12', 'URL']
    ]);
    const result = getPlannedLeaveMissingCalendar({
      plannedLeaveEntries: [
        { id: 'plan-1', startDate: '2024-08-12', endDate: '2024-08-13', countWorkingDays: false }
      ],
      leaveByDay
    });

    expect(result.count).toBe(1);
    expect(result.dates).toEqual(['2024-08-13']);
    expect(result.byEntry['plan-1']).toEqual(['2024-08-13']);
  });
});
