import { db } from '../lib/firebase.js';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';

export async function loadCalendarEvents(start, end) {
  const events = [];

  // JOB (zlecenia)
  const qJobs = query(
    collection(db, 'jobs'),
    where('start', '>=', start),
    where('start', '<=', end),
    orderBy('start', 'asc')
  );
  const jobs = await getDocs(qJobs);
  jobs.forEach(d => {
    const e = d.data();
    events.push({
      id: d.id,
      title: e.title ?? e.client ?? 'Zlecenie',
      start: e.start?.toDate?.() ?? e.start,
      end: e.end?.toDate?.() ?? e.end,
      allDay: !!e.allDay,
      classNames: ['job-event'],
    });
  });

  // OFF-DAYS (L4/URLOP/SWIETO) – tylko tło
  const offCols = ['offdays']; // kolekcja z dokumentami: {type:'L4'|'URLOP'|'SWIETO', start, end}
  for (const col of offCols) {
    const qOff = query(
      collection(db, col),
      where('start', '<=', end),
      where('end', '>=', start),
      orderBy('start', 'asc')
    );
    const offs = await getDocs(qOff);
    offs.forEach(d => {
      const e = d.data();
      const cls = e.type === 'L4' ? 'is-l4' : (e.type === 'URLOP' ? 'is-urlop' : 'is-swieto');
      events.push({
        start: e.start?.toDate?.() ?? e.start,
        end: e.end?.toDate?.() ?? e.end,
        display: 'background',
        allDay: true,
        classNames: ['fc-offday', cls],
      });
    });
  }

  return events;
}

export async function getDailyTotals(date) {
  // Zsumuj tylko JOB dla danego dnia (work/drive/billed). Zaznacz off-day.
  const midnight = new Date(date); midnight.setHours(0,0,0,0);
  const end = new Date(midnight); end.setDate(end.getDate()+1);

  let work = 0, drive = 0, billed = 0, l4=false, urlop=false, swieto=false;

  // offday check
  const offQ = query(
    collection(db, 'offdays'),
    where('start', '<', end),
    where('end', '>', midnight)
  );
  (await getDocs(offQ)).forEach(d=>{
    const t = d.data()?.type;
    if (t==='L4') l4=true; else if (t==='URLOP') urlop=true; else if (t==='SWIETO') swieto=true;
  });
  if (l4||urlop||swieto) return { work, drive, billed, l4, urlop, swieto };

  // jobs for day
  const jobsQ = query(
    collection(db, 'jobs'),
    where('start', '>=', midnight),
    where('start', '<', end)
  );
  (await getDocs(jobsQ)).forEach(d=>{
    const j = d.data();
    work   += Number(j.workHours ?? 0);
    drive  += Number(j.driveHours ?? 0);
    billed += Number(j.billedHours ?? 0);
  });

  return { work, drive, billed, l4, urlop, swieto };
}
