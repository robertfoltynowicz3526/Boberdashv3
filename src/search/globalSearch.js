const normalize = (value) => String(value ?? '').trim().toLocaleLowerCase('pl')
  .normalize('NFD').replace(/\p{Diacritic}/gu, '').replaceAll('ł', 'l');

export function findGlobalResults(query, { clients, machines, orders }, limit = 5) {
  const term = normalize(query);
  if (!term) return [];
  const groups = [
    ['client', clients, (client) => [client.nazwa]],
    ['machine', machines, (machine) => [machine.model, machine.nrSeryjny === '---' ? '' : machine.nrSeryjny]],
    ['order', orders, (order) => [order.nrZlecenia, order.orderNo, order.numerZlecenia]],
  ];
  return groups.flatMap(([type, records, fields]) => records
    .filter((record) => record.id && fields(record).some((field) => normalize(field).includes(term)))
    .slice(0, limit).map((record) => ({
      type, id: record.id,
      label: type === 'machine' ? fields(record).filter(Boolean).join(' · ') : fields(record).find(Boolean),
      record,
    })));
}
