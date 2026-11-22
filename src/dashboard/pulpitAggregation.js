import { computeDayTotals } from '../calendar/computeDayTotals.js';

export function aggregateTimeStats(dayKeys, readDay = computeDayTotals) {
  const sum = { work: 0, drive: 0, billed: 0, over: 0 };
  for (const day of dayKeys) {
    const { totals, isLeave } = readDay(day);
    if (isLeave) continue;
    sum.work += totals.work;
    sum.drive += totals.drive;
    sum.billed += totals.billed;
    sum.over += totals.over;
  }
  return { ...sum, absorption: sum.work > 0 ? (sum.billed / sum.work) * 100 : 0 };
}

function orderCreatedTime(order) {
  const createdAt = order.createdAt?.toDate?.() ?? order.createdAt;
  const parsed = createdAt == null ? NaN : new Date(createdAt).getTime();
  return Number.isFinite(parsed) ? parsed : Date.parse(order.createdOn || order.createdDate || '') || 0;
}

export function buildRecentActiveOrders(orders, clients, machines) {
  const clientById = new Map(clients.map(client => [client.id, client]));
  const machineById = new Map(machines.map(machine => [machine.id, machine]));
  return orders
    .filter(order => order.id && order.status === 'aktywne')
    .map(order => ({ order, createdTime: orderCreatedTime(order) }))
    .sort((a, b) => b.createdTime - a.createdTime)
    .slice(0, 5)
    .map(({ order }) => {
      const machine = machineById.get(order.maszynaId);
      return {
        id: order.id,
        number: order.nrZlecenia || order.id,
        client: clientById.get(order.klientId)?.nazwa || order.klientNazwa || 'Brak klienta',
        machine: [machine?.typMaszyny, machine?.model].filter(Boolean).join(' ') || order.machineModelText || 'Brak maszyny',
      };
    });
}
