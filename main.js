import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from './firebase-config.js';

//// PANIC overlay (zamiast „białej strony”) ////
(function(){
  function show(err){
    if(document.getElementById('__panic')) return;
    const p=document.createElement('pre');
    p.id='__panic';
    p.style.cssText='position:fixed;inset:8px;z-index:99999;background:#0b1020;color:#ffd100;padding:12px;overflow:auto;border:1px solid #333;border-radius:8px;font:12px/1.4 ui-monospace,monospace';
    p.textContent='Runtime error:\n'+(err?.stack||err?.message||String(err));
    document.body.appendChild(p);
  }
  window.addEventListener('error', e=>show(e.error||e.message));
  window.addEventListener('unhandledrejection', e=>show(e.reason||e));
})();

//// SAFE no-op dla brakujących hooków ////
const noop=()=>{};
window.openEwidencjaDnia      = window.openEwidencjaDnia      || noop;
window.openEwidencjaDniaRange = window.openEwidencjaDniaRange || noop;

const FULLCALENDAR_SRC = 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.js';
let calendar;
let fullCalendarPromise;

function ensureFullCalendar(){
  if(window.FullCalendar?.Calendar) return Promise.resolve(window.FullCalendar);
  if(!fullCalendarPromise){
    fullCalendarPromise = new Promise((resolve, reject)=>{
      const script=document.createElement('script');
      script.src=FULLCALENDAR_SRC;
      script.async=true;
      script.onload=()=>resolve(window.FullCalendar);
      script.onerror=reject;
      document.head.appendChild(script);
    });
  }
  return fullCalendarPromise;
}

//// Router zakładek ////
function initRouter(){
  const secs=[...document.querySelectorAll('[data-section]')];
  const tabs=[...document.querySelectorAll('[data-tab]')];
  if(!secs.length||!tabs.length) return;
  function show(id){
    secs.forEach(s=>s.style.display=(s.getAttribute('data-section')===id)?'block':'none');
    tabs.forEach(t=>t.classList.toggle('active',t.getAttribute('data-tab')===id));
  }
  document.addEventListener('click',(e)=>{
    const btn=e.target.closest?.('[data-tab]'); if(!btn) return;
    e.preventDefault(); show(btn.getAttribute('data-tab'));
  });
  show(tabs[0].getAttribute('data-tab'));
}

//// Firestore – bezpieczny fetch (PODŁĄCZ do Twoich kolekcji) ////
function normalizeDate(value,{allDay=false}={}){
  if(!value) return undefined;
  const date=value?.toDate ? value.toDate() : new Date(value);
  if(Number.isNaN(date?.getTime?.())) return undefined;
  if(allDay){
    date.setHours(0,0,0,0);
    return date.toISOString().slice(0,10);
  }
  return date.toISOString();
}

function mapToFc(e){
  const start=normalizeDate(e.start || e.dataStart, {allDay:e.allDay});
  if(!start) return null;
  const end=normalizeDate(e.end || e.dataEnd, {allDay:e.allDay});
  return {
    id: e.id || crypto.randomUUID(),
    title: e.title || e.nazwa || 'Zlecenie',
    start,
    end,
    allDay: !!e.allDay,
    classNames: e.classNames || [],
    extendedProps:{
      typ: e.typ,
      praca: Number(e.praca ?? e.workHours ?? 0),
      jazda: Number(e.jazda ?? e.driveHours ?? 0),
      fh: Number(e.fh ?? e.fakturowane ?? e.invoicedHours ?? 0),
      leaveKind: e.leaveKind
    }
  };
}

async function safeGetDocs(q){
  try{ return q ? await getDocs(q) : null; }
  catch(e){ console.error('fetchCalendarEvents',e); return null; }
}

function mapOrders(snap){
  if(!snap) return [];
  return snap.docs.map(doc=>{
    const data=doc.data()||{};
    return {
      id: doc.id,
      title: data.title || data.nazwa || data.nr || data.nrZlecenia || 'Zlecenie',
      start: data.start || data.startAt || data.dataStart,
      end: data.end || data.endAt || data.dataEnd,
      allDay: !!data.allDay,
      praca: data.praca ?? data.workHours ?? data.pracaGodziny ?? data.hours ?? 0,
      jazda: data.jazda ?? data.driveHours ?? data.jazdaGodziny ?? 0,
      fh: data.fh ?? data.fakturowane ?? data.invoicedHours ?? data.hoursInvoiced ?? 0,
      typ: data.typ || 'TASK',
      classNames: data.classNames || []
    };
  });
}

function mapLeaves(snap){
  if(!snap) return [];
  return snap.docs.map(doc=>{
    const data=doc.data()||{};
    return {
      id: doc.id,
      title: data.title || data.nazwa || 'Niedostępność',
      start: data.start || data.data || data.from,
      end: data.end || data.to,
      allDay: true,
      typ:'LEAVE',
      leaveKind: data.leaveKind || data.typ,
      classNames: data.classNames || []
    };
  });
}

async function fetchCalendarEvents(){
  if(!db){
    console.warn('[calendar] Brak konfiguracji Firestore – UI działa offline.');
    return [];
  }
  try{
    const ordersQuery=query(collection(db,'zlecenia'), orderBy('start','asc'));
    const leavesQuery=query(collection(db,'leave'), orderBy('start','asc'));
    const [ordersSnap, leavesSnap]=await Promise.all([
      safeGetDocs(ordersQuery),
      safeGetDocs(leavesQuery)
    ]);
    return [...mapOrders(ordersSnap), ...mapLeaves(leavesSnap)]
      .map(mapToFc)
      .filter(Boolean);
  }catch(e){ console.error('fetchCalendarEvents',e); return []; }
}

//// Kalendarz – stabilna inicjalizacja ////
function ymd(d){ const x=new Date(d); x.setHours(0,0,0,0); return x.toISOString().slice(0,10); }
function touches(ev, day){
  const s=ymd(ev.start), e=ev.end? ymd(new Date(ev.end.getTime()-1)) : s;
  return day>=s && day<=e;
}
function sumsFor(day){
  let work=0,drive=0,inv=0;
  (calendar?.getEvents?.()||[]).forEach(ev=>{
    const p=ev.extendedProps||{};
    if(p.typ==='LEAVE') return;
    if(!touches(ev,day)) return;
    work+=Number(p.praca||0); drive+=Number(p.jazda||0); inv+=Number(p.fh||0);
  });
  return {work,drive,inv};
}
function fmtH(n){ return (Math.round(Number(n||0)*100)/100).toFixed(2)+'h'; }
function rmHeader(day){
  (calendar?.getEvents?.()||[]).forEach(e=>{
    if(e.extendedProps?.typ==='HEADER' && e.startStr===day) e.remove();
  });
}
function upsertHeader(day){
  const {work,drive,inv}=sumsFor(day);
  if(work===0 && drive===0 && inv===0){ rmHeader(day); return; }
  rmHeader(day);
  const end=new Date(day); end.setDate(end.getDate()+1);
  calendar.addEvent({
    id:`HDR-${day}`, start:day, end:end.toISOString().slice(0,10), allDay:true,
    title:`• Praca: ${fmtH(work)} •\nJazda: ${fmtH(drive)} •\nFakturowane: ${fmtH(inv)}`,
    classNames:['hdr-event'],
    extendedProps:{ typ:'HEADER', order:-1000 }
  });
}
function refreshHeaders(){
  document.querySelectorAll('.fc-daygrid-day[data-date]')
    .forEach(c=>upsertHeader(c.getAttribute('data-date')));
}

function initCalendar(){
  const el=document.getElementById('kalendarz'); if(!el) return;
  ensureFullCalendar().then(()=>{
    if(calendar?.destroy) calendar.destroy();
    calendar=new FullCalendar.Calendar(el,{
      initialView:'dayGridMonth',
      height:'auto',
      headerToolbar:{ left:'prev,next today', center:'title', right:'dayGridMonth,timeGridWeek' },
      selectable:true,
      eventOrder:'extendedProps.order,start,-duration',
      dateClick(info){ try{ window.openEwidencjaDnia(info.date); }catch(e){} },
      eventDataTransform(e){ if(e?.title) e.title=e.title.replace(/^Ewidencja dnia\s*[:•-]?\s*/i,''); return e; },
      eventDidMount(info){
        const p=info.event.extendedProps||{};
        if(p.typ==='LEAVE'){
          const frame=info.el.closest('.fc-daygrid-day')?.querySelector('.fc-daygrid-day-frame');
          if(frame){
            frame.style.position='relative';
            frame.querySelectorAll('.leave-badge').forEach(n=>n.remove());
            const icon=({URL:'🌿',L4:'🩺',SWIETO:'🏳️'})[p.leaveKind]||'•';
            const b=document.createElement('span');
            b.className='leave-badge';
            b.textContent=icon;
            b.style.cssText='position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:24px;padding:6px 10px;border-radius:12px;background:rgba(0,0,0,.18);color:#fff;pointer-events:none;z-index:6;';
            frame.appendChild(b);
          }
        }
      }
    });
    calendar.render();
    fetchCalendarEvents().then(rows=>{
      (rows||[]).forEach(e=>calendar.addEvent(e));
      refreshHeaders();
    });
    calendar.on('datesSet',   refreshHeaders);
    calendar.on('eventsSet',  refreshHeaders);
    calendar.on('eventAdd',   ({event})=>upsertHeader( ymd(event.start) ));
    calendar.on('eventChange',({event})=>upsertHeader( ymd(event.start) ));
    calendar.on('eventRemove',({event})=>upsertHeader( ymd(event.start||new Date()) ));
  }).catch(err=>console.error('FullCalendar load failed', err));
}

//// START ////
function boot(){
  ['#leave-bar','#leave-toolbar','.leave-pop','.leave-legend','.daily-fh-badge','.fh-badge','.hours-badge']
    .forEach(s=>document.querySelectorAll(s).forEach(n=>n.remove()));
  initRouter();
  initCalendar();
}
if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', boot, {once:true}); } else { boot(); }
