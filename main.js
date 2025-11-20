//// PANIC OVERLAY (żeby błąd był widoczny zamiast czarnego ekranu) ////
(function panic(){
  function show(err){
    if(document.getElementById('__panic')) return;
    const pre=document.createElement('pre');
    pre.id='__panic';
    pre.style.cssText='position:fixed;inset:8px;z-index:99999;background:#0b1020;color:#ffd100;padding:12px;overflow:auto;border:1px solid #333;border-radius:8px;font:12px/1.4 ui-monospace,monospace';
    pre.textContent='Runtime error:\n'+(err?.stack||err?.message||String(err));
    document.body.appendChild(pre);
  }
  window.addEventListener('error', e=>show(e.error||e.message));
  window.addEventListener('unhandledrejection', e=>show(e.reason||e));
})();

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

//// ROUTER ZAKŁADEK – jeden delegat ////
function initRouter(){
  const sections=[...document.querySelectorAll('[data-section]')];
  const tabs=[...document.querySelectorAll('[data-tab]')];
  if(!sections.length || !tabs.length) return;

  function show(id){
    sections.forEach(s=>{ s.style.display = (s.getAttribute('data-section')===id)?'block':'none'; });
    tabs.forEach(t=>t.classList.toggle('active', t.getAttribute('data-tab')===id));
  }
  document.addEventListener('click',(e)=>{
    const btn=e.target.closest?.('[data-tab]');
    if(!btn) return;
    e.preventDefault();
    show(btn.getAttribute('data-tab'));
  });
  // pokaż pierwszą sekcję na starcie
  show(tabs[0].getAttribute('data-tab'));
}

//// KALENDARZ – renderuj od razu; dane dociągaj bez blokowania UI ////
async function safeFetchEvents(){
  try{
    // TODO: podmień na realny fetch z Firestore; zwróć [] w razie błędu
    // przykład: const docs = await getDocs(query(...)); mapuj -> events
    return []; // tymczasowo pusto; UI ma działać
  }catch(err){
    console.error('fetchEvents error', err);
    return [];
  }
}

function mapToFcEvent(doc){
  // zamień swoje rekordy na eventy FullCalendara
  return {
    id: doc.id || crypto.randomUUID(),
    title: doc.title || doc.nazwa || 'Zlecenie',
    start: doc.start || doc.dataStart,
    end: doc.end || doc.dataEnd || undefined,
    allDay: !!doc.allDay,
    extendedProps:{
      typ: doc.typ || undefined,
      praca: Number(doc.praca||0),
      jazda: Number(doc.jazda||0),
      fh: Number(doc.fh||doc.fakturowane||0)
    }
  };
}

async function initCalendar(){
  const el=document.getElementById('kalendarz');
  if(!el) return;
  try{
    await ensureFullCalendar();
  }catch(err){
    console.error('FullCalendar load failed', err);
    return;
  }

  if(calendar?.destroy) calendar.destroy();
  calendar = new FullCalendar.Calendar(el,{
    initialView:'dayGridMonth',
    height:'auto',
    headerToolbar:{ left:'prev,next today', center:'title', right:'dayGridMonth,timeGridWeek' },
    selectable:true,
    eventOrder:'extendedProps.order,start,-duration',
    dateClick(info){
      // Twoje okno ewidencji dnia – jeśli nie ma, niech nie blokuje UI
      try{ window.openEwidencjaDnia?.(info.date); }catch(e){ console.warn(e); }
    },
    eventDidMount(info){
      // LEAVE ikonka na środku (opcjonalnie; nie psuje klików)
      const p=info.event.extendedProps||{};
      if(p.typ==='LEAVE'){
        const frame=info.el.closest('.fc-daygrid-day')?.querySelector('.fc-daygrid-day-frame');
        if(frame){
          frame.style.position='relative';
          frame.querySelectorAll('.leave-badge').forEach(n=>n.remove());
          const b=document.createElement('span');
          b.className='leave-badge';
          b.textContent=({URL:'🌿',L4:'🩺',SWIETO:'🏳️'})[p.leaveKind]||'•';
          b.style.cssText='position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:24px;padding:6px 10px;border-radius:12px;background:rgba(0,0,0,.18);color:#fff;pointer-events:none;z-index:6;';
          frame.appendChild(b);
        }
      }
    }
  });
  calendar.render();

  // dociągnij dane „po cichu”; jeśli przyjdą – dołóż eventy
  safeFetchEvents().then(list=>{
    if(!Array.isArray(list)) return;
    const evs = list.map(mapToFcEvent);
    evs.forEach(e=>calendar.addEvent(e));
  });
}

//// START ////
function boot(){
  // zabij niewidzialne parawany, jeśli zostały
  ['#leave-bar','#leave-toolbar','.leave-pop','.leave-legend','.daily-fh-badge','.fh-badge','.hours-badge']
    .forEach(s=>document.querySelectorAll(s).forEach(n=>n.remove()));

  initRouter();
  initCalendar();
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', boot, {once:true});
}else{
  boot();
}
