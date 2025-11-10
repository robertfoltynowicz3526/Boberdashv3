import { db } from './firebase-config.js';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  where,
  runTransaction
} from 'firebase/firestore';

const KOLEKCJA_KLIENCI = 'klienci';
const KOLEKCJA_MASZYNY = 'maszyny';
const KOLEKCJA_ZLECENIA = 'zlecenia';
const KOLEKCJA_MAGAZYN = 'magazyn';
const KOLEKCJA_KALENDARZ = 'godziny_pracy';

const STAWKI_ZLECEN = {
  S: { nazwa: 'Serwis wyjazdowy', stawka: 45 },
  W: { nazwa: 'Serwis warsztatowy', stawka: 35 },
  G: { nazwa: 'Gwarancja', stawka: 35 },
  Z: { nazwa: 'Zbrojenie', stawka: 30 },
  P: { nazwa: 'Poprawka', stawka: 0 }
};

const ENABLE_SZYBKIE_ZLECENIE = false;

const _wszystkieKlienciCache = [];
const _wszystkieMaszynyCache = [];
const _wszystkieZleceniaCache = [];

const buforMaszynPoKliencie = new Map();
const buforZlecenPoMaszynie = new Map();
const buforMagazynu = new Map();
const buforKalendarza = new Map();

let calendarInstance = null;
let aktualnyMiesiacKalendarza = '';
let wybraneCzesci = [];
let elementyDOM = {};

window.openTab = openTab;

document.addEventListener('DOMContentLoaded', initApp);

function initApp() {
  pobierzSelektory();
  ustawDomyslneWartosci();
  podlaczZdarzenia();
  nasluchujNaKlientow();
  nasluchujNaMaszyny();
  nasluchujNaZlecenia();
  nasluchujNaMagazyn();
  nasluchujNaKalendarz();
  inicjalizujKalendarz();
  dodajObslugeAssign();
}

function pobierzSelektory() {
  elementyDOM = {
    tabButtons: Array.from(document.querySelectorAll('.tab-button')),
    sections: Array.from(document.querySelectorAll('.tab-content')),
    klientForm: document.getElementById('klient-form'),
    klientSearch: document.getElementById('klient-search-input'),
    listaKlientow: document.getElementById('lista-klientow'),
    klientEditModal: document.getElementById('klient-edit-modal'),
    klientEditForm: document.getElementById('klient-edit-form'),
    klientEditId: document.getElementById('klient-edit-id'),
    klientEditNazwa: document.getElementById('klient-edit-nazwa'),
    klientEditNip: document.getElementById('klient-edit-nip'),
    klientEditAdres: document.getElementById('klient-edit-adres'),
    klientEditTelefon: document.getElementById('klient-edit-telefon'),
    maszynaForm: document.getElementById('maszyna-form'),
    maszynaKlientSelect: document.getElementById('maszyna-klient-select'),
    maszynaLista: document.getElementById('lista-maszyn'),
    maszynaEditModal: document.getElementById('maszyna-edit-modal'),
    maszynaEditForm: document.getElementById('maszyna-edit-form'),
    maszynaEditId: document.getElementById('maszyna-edit-id'),
    maszynaEditModel: document.getElementById('maszyna-edit-model'),
    maszynaEditNumer: document.getElementById('maszyna-edit-numer'),
    maszynaEditRok: document.getElementById('maszyna-edit-rok'),
    maszynaHistoriaModal: document.getElementById('maszyna-historia-modal'),
    maszynaHistoriaLista: document.getElementById('maszyna-historia-lista'),
    zlecenieForm: document.getElementById('zlecenie-form'),
    zlecenieKlientSelect: document.getElementById('zlecenie-klient-select'),
    zlecenieMaszynaSelect: document.getElementById('zlecenie-maszyna-select'),
    zleceniaAktywne: document.getElementById('zlecenia-aktywne'),
    zleceniaZakonczone: document.getElementById('zlecenia-zakonczone'),
    zakonczoneMiesiac: document.getElementById('zakonczone-miesiac'),
    zakonczonePodsumowanieGodziny: document.getElementById('zakonczone-podsumowanie-godziny'),
    zakonczonePodsumowanieBrutto: document.getElementById('zakonczone-podsumowanie-brutto'),
    zakonczonePodsumowanieNetto: document.getElementById('zakonczone-podsumowanie-netto'),
    zakonczonePodsumowanieAbsorpcja: document.getElementById('zakonczone-podsumowanie-absorpcja'),
    zlecenieZakonczModal: document.getElementById('zlecenie-zakoncz-modal'),
    zlecenieZakonczForm: document.getElementById('zlecenie-zakoncz-form'),
    zlecenieZakonczId: document.getElementById('zlecenie-zakoncz-id'),
    zlecenieZakonczGodziny: document.getElementById('zlecenie-zakoncz-godziny'),
    zlecenieZakonczTyp: document.getElementById('zlecenie-zakoncz-typ'),
    zlecenieZakonczData: document.getElementById('zlecenie-zakoncz-data'),
    zlecenieZakonczNotatka: document.getElementById('zlecenie-zakoncz-notatka'),
    zlecenieMagazynLista: document.getElementById('zlecenie-magazyn-lista'),
    zlecenieMagazynWybrane: document.getElementById('zlecenie-magazyn-wybrane'),
    zlecenieSzczegolyModal: document.getElementById('zlecenie-szczegoly-modal'),
    zlecenieSzczegolyKontent: document.getElementById('zlecenie-szczegoly-kontent'),
    zleceniePonownieModal: document.getElementById('zlecenie-ponownie-modal'),
    zleceniePonownieForm: document.getElementById('zlecenie-ponownie-form'),
    zleceniePonownieId: document.getElementById('zlecenie-ponownie-id'),
    zleceniePonownieStatus: document.getElementById('zlecenie-ponownie-status'),
    zleceniePonownieNotatka: document.getElementById('zlecenie-ponownie-notatka'),
    zlecenieEdytujModal: document.getElementById('zlecenie-edytuj-modal'),
    zlecenieEdytujForm: document.getElementById('zlecenie-edytuj-form'),
    zlecenieEdytujId: document.getElementById('zlecenie-edytuj-id'),
    zlecenieEdytujGodziny: document.getElementById('zlecenie-edytuj-godziny'),
    zlecenieEdytujTyp: document.getElementById('zlecenie-edytuj-typ'),
    zlecenieEdytujNotatka: document.getElementById('zlecenie-edytuj-notatka'),
    magazynTabela: document.getElementById('magazyn-tabela'),
    magazynForm: document.getElementById('magazyn-form'),
    magazynMasoweForm: document.getElementById('magazyn-masowe-form'),
    magazynMasoweTextarea: document.getElementById('magazyn-masowe'),
    magazynZmianaModal: document.getElementById('magazyn-zmiana-modal'),
    magazynZmianaForm: document.getElementById('magazyn-zmiana-form'),
    magazynZmianaId: document.getElementById('magazyn-zmiana-id'),
    magazynZmianaIlosc: document.getElementById('magazyn-zmiana-ilosc'),
    olejTyp: document.getElementById('olej-typ'),
    olejPojemnosc: document.getElementById('olej-pojemnosc'),
    olejSztuki: document.getElementById('olej-sztuki'),
    olejLitry: document.getElementById('olej-litry'),
    olejPrzelicz: document.getElementById('olej-przelicz'),
    kalendarzModal: document.getElementById('kalendarz-modal'),
    kalendarzForm: document.getElementById('kalendarz-form'),
    kalendarzDocId: document.getElementById('kalendarz-doc-id'),
    kalendarzData: document.getElementById('kalendarz-data'),
    kalendarzPraca: document.getElementById('kalendarz-praca'),
    kalendarzFaktura: document.getElementById('kalendarz-faktura'),
    kalendarzNadgodziny: document.getElementById('kalendarz-nadgodziny'),
    kalendarzJazda: document.getElementById('kalendarz-jazda'),
    kalendarzNotatka: document.getElementById('kalendarz-notatka'),
    kalendarzZleceniaSelect: document.getElementById('kalendarz-zlecenia'),
    kalendarzZleceniaTagi: document.getElementById('kalendarz-zlecenia-tagi'),
    kalendarzDodajZlecenie: document.getElementById('kalendarz-dodaj-zlecenie'),
    kalendarzUsun: document.getElementById('kalendarz-usun'),
    kalendarzMiniP: document.getElementById('kalendarz-p'),
    kalendarzMiniF: document.getElementById('kalendarz-f'),
    kalendarzMiniN: document.getElementById('kalendarz-n'),
    kalendarzMiniJ: document.getElementById('kalendarz-j'),
    pulpitAktywne: document.getElementById('pulpit-aktywne-zlecenia'),
    pulpitGodziny: document.getElementById('pulpit-godziny-dzienne'),
    pulpitNiskieStany: document.getElementById('pulpit-niskie-stany'),
    pulpitZadania: document.getElementById('pulpit-dzisiejsze-zadania'),
    assignModal: document.getElementById('assign-zlecenie-modal'),
    assignForm: document.getElementById('assign-zlecenie-form'),
    assignDocId: document.getElementById('assign-doc-id'),
    assignData: document.getElementById('assign-data'),
    assignKlientSelect: document.getElementById('assign-klient-select'),
    assignZlecenieSelect: document.getElementById('assign-zlecenie-select'),
    summaryHoursMonth: document.getElementById('summary-hours-month'),
    summaryHoursTrend: document.getElementById('summary-hours-trend'),
    summaryAbsorption: document.getElementById('summary-absorption'),
    summaryStawka: document.getElementById('summary-stawka'),
    summaryNewOrders: document.getElementById('summary-new-orders'),
    summaryTrendChart: document.getElementById('summary-trend-chart'),
    summaryHistoryGrid: document.getElementById('summary-history-grid'),
    summaryMiesiacInput: document.getElementById('miesiac-summary'),
    calendarContainer: document.getElementById('calendar')
  };
}

function ustawDomyslneWartosci() {
  if (elementyDOM.zakonczoneMiesiac) {
    elementyDOM.zakonczoneMiesiac.value = pobierzBiezacyMiesiac();
  }
  if (elementyDOM.summaryMiesiacInput) {
    elementyDOM.summaryMiesiacInput.value = pobierzBiezacyMiesiac();
  }
  if (elementyDOM.zlecenieZakonczTyp) {
    wypelnijSelectTypow(elementyDOM.zlecenieZakonczTyp);
  }
  if (elementyDOM.zlecenieEdytujTyp) {
    wypelnijSelectTypow(elementyDOM.zlecenieEdytujTyp);
  }
}
function podlaczZdarzenia() {
  elementyDOM.tabButtons.forEach((btn) => {
    btn.addEventListener('click', (evt) => {
      const target = evt.currentTarget;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      openTab(target, target.dataset.tab || '');
    });
  });

  if (elementyDOM.klientForm) {
    elementyDOM.klientForm.addEventListener('submit', dodajKlienta);
  }
  if (elementyDOM.klientSearch) {
    elementyDOM.klientSearch.addEventListener('input', renderujKlientow);
  }
  if (elementyDOM.listaKlientow) {
    elementyDOM.listaKlientow.addEventListener('click', obslugaKlikowKlientow);
  }
  if (elementyDOM.klientEditForm) {
    elementyDOM.klientEditForm.addEventListener('submit', zapiszEdycjeKlienta);
  }

  if (elementyDOM.maszynaForm) {
    elementyDOM.maszynaForm.addEventListener('submit', dodajMaszyne);
  }
  if (elementyDOM.maszynaLista) {
    elementyDOM.maszynaLista.addEventListener('click', obslugaKlikowMaszyn);
  }
  if (elementyDOM.maszynaEditForm) {
    elementyDOM.maszynaEditForm.addEventListener('submit', zapiszEdycjeMaszyny);
  }

  if (elementyDOM.zlecenieForm) {
    elementyDOM.zlecenieForm.addEventListener('submit', dodajZlecenie);
  }
  if (elementyDOM.zlecenieKlientSelect) {
    elementyDOM.zlecenieKlientSelect.addEventListener('change', filtrujMaszynyDoZlecenia);
  }
  if (elementyDOM.zleceniaAktywne) {
    elementyDOM.zleceniaAktywne.addEventListener('click', obslugaKlikowZlecen);
  }
  if (elementyDOM.zleceniaZakonczone) {
    elementyDOM.zleceniaZakonczone.addEventListener('click', obslugaKlikowZlecen);
  }
  if (elementyDOM.zlecenieZakonczForm) {
    elementyDOM.zlecenieZakonczForm.addEventListener('submit', zakonczZlecenie);
  }
  if (elementyDOM.zleceniePonownieForm) {
    elementyDOM.zleceniePonownieForm.addEventListener('submit', otworzPonownieZlecenie);
  }
  if (elementyDOM.zlecenieEdytujForm) {
    elementyDOM.zlecenieEdytujForm.addEventListener('submit', zapiszEdycjeZlecenia);
  }
  if (elementyDOM.zakonczoneMiesiac) {
    elementyDOM.zakonczoneMiesiac.addEventListener('change', renderujZlecenia);
  }

  if (elementyDOM.summaryMiesiacInput) {
    elementyDOM.summaryMiesiacInput.addEventListener('change', aktualizujPodsumowania);
  }
  if (elementyDOM.assignKlientSelect) {
    elementyDOM.assignKlientSelect.addEventListener('change', aktualizujWyborZlecenDlaAssign);
  }

  if (elementyDOM.magazynForm) {
    elementyDOM.magazynForm.addEventListener('submit', dodajProdukt);
  }
  if (elementyDOM.magazynMasoweForm) {
    elementyDOM.magazynMasoweForm.addEventListener('submit', dodajProduktyMasowo);
  }
  if (elementyDOM.magazynTabela) {
    elementyDOM.magazynTabela.addEventListener('click', obslugaKlikowMagazynu);
  }
  if (elementyDOM.magazynZmianaForm) {
    elementyDOM.magazynZmianaForm.addEventListener('submit', zapiszZmianeMagazynu);
  }

  if (elementyDOM.olejPrzelicz) {
    elementyDOM.olejPrzelicz.addEventListener('click', przeliczOleje);
  }

  if (elementyDOM.kalendarzForm) {
    elementyDOM.kalendarzForm.addEventListener('submit', zapiszWpisKalendarza);
  }
  if (elementyDOM.kalendarzDodajZlecenie) {
    elementyDOM.kalendarzDodajZlecenie.addEventListener('click', dodajZlecenieDoTagow);
  }
  if (elementyDOM.kalendarzUsun) {
    elementyDOM.kalendarzUsun.addEventListener('click', usunWpisKalendarza);
  }

  if (elementyDOM.assignForm) {
    elementyDOM.assignForm.addEventListener('submit', zapiszPrzypisanieZlecenia);
  }

  document.body.addEventListener('click', (evt) => {
    if (!(evt.target instanceof Element)) {
      return;
    }
    const closeBtn = evt.target.closest('.modal-close');
    if (closeBtn) {
      const id = closeBtn.getAttribute('data-close');
      if (id) {
        const modal = document.getElementById(id);
        zamknijModal(modal);
      }
      return;
    }
    const modal = evt.target.closest('.modal');
    if (modal && evt.target === modal) {
      zamknijModal(modal);
    }
  });

  if (elementyDOM.maszynaHistoriaModal) {
    elementyDOM.maszynaHistoriaModal.addEventListener('click', (evt) => {
      if (!(evt.target instanceof Element)) {
        return;
      }
      const szczegoly = evt.target.closest('[data-akcja="szczegoly-zlecenia"]');
      if (szczegoly) {
        const id = szczegoly.getAttribute('data-id');
        pokazSzczegolyZlecenia(id);
      }
    });
  }
}

function openTab(trigger, tabName) {
  if (!tabName) {
    return;
  }
  elementyDOM.sections.forEach((section) => section.classList.remove('active'));
  const docelowa = document.getElementById(tabName);
  if (docelowa) {
    docelowa.classList.add('active');
  }
  elementyDOM.tabButtons.forEach((btn) => btn.classList.remove('active'));
  if (trigger instanceof HTMLElement) {
    trigger.classList.add('active');
  }
}

function pobierzBiezacyMiesiac() {
  const teraz = new Date();
  const miesiac = String(teraz.getMonth() + 1).padStart(2, '0');
  return `${teraz.getFullYear()}-${miesiac}`;
}

function wypelnijSelectTypow(select) {
  select.innerHTML = '';
  Object.entries(STAWKI_ZLECEN).forEach(([kod, dane]) => {
    const option = document.createElement('option');
    option.value = kod;
    option.textContent = `${kod} – ${dane.nazwa}`;
    select.append(option);
  });
}
function nasluchujNaKlientow() {
  const q = query(collection(db, KOLEKCJA_KLIENCI), orderBy('nazwa'));
  onSnapshot(q, (snapshot) => {
    _wszystkieKlienciCache.length = 0;
    snapshot.forEach((docSnap) => {
      _wszystkieKlienciCache.push({ id: docSnap.id, ...docSnap.data() });
    });
    odswiezSelectyKlientow();
    renderujKlientow();
    renderujMaszyny();
    renderujZlecenia();
  });
}

function nasluchujNaMaszyny() {
  const q = query(collection(db, KOLEKCJA_MASZYNY), orderBy('model'));
  onSnapshot(q, (snapshot) => {
    _wszystkieMaszynyCache.length = 0;
    buforMaszynPoKliencie.clear();
    snapshot.forEach((docSnap) => {
      const dane = { id: docSnap.id, ...docSnap.data() };
      _wszystkieMaszynyCache.push(dane);
      if (!buforMaszynPoKliencie.has(dane.klientId)) {
        buforMaszynPoKliencie.set(dane.klientId, []);
      }
      buforMaszynPoKliencie.get(dane.klientId)?.push(dane);
    });
    odswiezSelectyMaszyn();
    renderujKlientow();
    renderujMaszyny();
    renderujZlecenia();
  });
}

function nasluchujNaZlecenia() {
  const q = query(collection(db, KOLEKCJA_ZLECENIA), orderBy('dataPrzyjecia', 'desc'));
  onSnapshot(q, (snapshot) => {
    _wszystkieZleceniaCache.length = 0;
    buforZlecenPoMaszynie.clear();
    snapshot.forEach((docSnap) => {
      const dane = { id: docSnap.id, ...docSnap.data() };
      _wszystkieZleceniaCache.push(dane);
      const klucz = dane.maszynaId || 'brak';
      if (!buforZlecenPoMaszynie.has(klucz)) {
        buforZlecenPoMaszynie.set(klucz, []);
      }
      buforZlecenPoMaszynie.get(klucz)?.push(dane);
    });
    renderujZlecenia();
    aktualizujPulpit();
    aktualizujPodsumowania();
    odswiezSelectyMaszyn();
    wypelnijSelectZlecenDoKalendarza();
  });
}

function nasluchujNaMagazyn() {
  const q = query(collection(db, KOLEKCJA_MAGAZYN), orderBy('nazwa'));
  onSnapshot(q, (snapshot) => {
    buforMagazynu.clear();
    snapshot.forEach((docSnap) => {
      const dane = { id: docSnap.id, ...docSnap.data() };
      buforMagazynu.set(dane.id, dane);
    });
    renderujMagazyn();
    aktualizujPulpit();
    wypelnijListeMagazynowa();
  });
}

function nasluchujNaKalendarz() {
  const q = query(collection(db, KOLEKCJA_KALENDARZ), orderBy('data'));
  onSnapshot(q, (snapshot) => {
    buforKalendarza.clear();
    snapshot.forEach((docSnap) => {
      const dane = { id: docSnap.id, ...docSnap.data() };
      buforKalendarza.set(dane.id, dane);
    });
    odswiezKalendarz();
    aktualizujPulpit();
  });
}

function inicjalizujKalendarz() {
  if (!elementyDOM.calendarContainer) {
    return;
  }
  calendarInstance = new FullCalendar.Calendar(elementyDOM.calendarContainer, {
    initialView: 'dayGridMonth',
    height: 'auto',
    events: pobierzZdarzeniaKalendarza,
    eventContent: zbudujEventContent,
    dateClick(info) {
      otworzModalKalendarza({ data: info.dateStr });
    },
    eventClick(info) {
      const wpis = info.event.extendedProps.wpis;
      if (wpis) {
        otworzModalKalendarza(wpis);
      }
    },
    datesSet(info) {
      const rok = info.start.getFullYear();
      const miesiac = String(info.start.getMonth() + 1).padStart(2, '0');
      aktualnyMiesiacKalendarza = `${rok}-${miesiac}`;
      przeliczPodsumowanieKalendarza();
    }
  });
  calendarInstance.render();
}

function pobierzZdarzeniaKalendarza(fetchInfo, successCallback) {
  const zdarzenia = [];
  buforKalendarza.forEach((wpis) => {
    zdarzenia.push(przeksztalcWpisNaEvent(wpis));
  });
  successCallback(zdarzenia);
}

function pobierzIdZlecenZWpisu(wpis) {
  if (!wpis) {
    return [];
  }
  const ids = Array.isArray(wpis.zleceniaIds) ? [...wpis.zleceniaIds] : [];
  if (wpis.zlecenieId && !ids.includes(wpis.zlecenieId)) {
    ids.push(wpis.zlecenieId);
  }
  return ids.filter(Boolean);
}

function przeksztalcWpisNaEvent(wpis) {
  const godziny = {
    p: Number(wpis.praca || 0),
    f: Number(wpis.fakturowane || 0),
    n: Number(wpis.nadgodziny || 0),
    j: Number(wpis.jazda || 0)
  };
  const etykieta = [`P:${godziny.p}`, `F:${godziny.f}`, `N:${godziny.n}`, `J:${godziny.j}`]
    .filter((tekst) => !tekst.endsWith(':0'))
    .join(' ');
  const notatka = wpis.notatka ? ' 📝' : '';
  const ids = pobierzIdZlecenZWpisu(wpis);
  const powiazane = ids.map((id) => {
    const zlecenie = _wszystkieZleceniaCache.find((z) => z.id === id);
    const klient = zlecenie ? _wszystkieKlienciCache.find((k) => k.id === zlecenie.klientId) : null;
    return {
      id,
      numer: zlecenie?.numer || id,
      klient: klient?.nazwa || 'brak'
    };
  });
  const tytul = `${etykieta}${notatka}`.trim() || 'Wpis';
  return {
    id: wpis.id,
    title: tytul,
    start: wpis.data,
    allDay: true,
    extendedProps: {
      wpis,
      etykieta,
      notatka: wpis.notatka || '',
      powiazaneZlecenia: powiazane
    }
  };
}

function zbudujEventContent(info) {
  const kontener = document.createElement('div');
  kontener.className = 'fc-event-custom';
  const godziny = document.createElement('div');
  godziny.className = 'fc-event-custom-hours';
  const etykieta = info.event.extendedProps.etykieta || '';
  const maNotatke = Boolean(info.event.extendedProps.notatka);
  const tekstGodzin = etykieta || 'Brak godzin';
  godziny.textContent = `${tekstGodzin}${maNotatke ? ' 📝' : ''}`;
  kontener.append(godziny);

  const powiazane = info.event.extendedProps.powiazaneZlecenia || [];
  if (powiazane.length > 0) {
    const lista = document.createElement('ul');
    lista.className = 'fc-event-custom-orders';
    powiazane.forEach((rekord) => {
      const li = document.createElement('li');
      li.textContent = `${rekord.numer} – ${rekord.klient}`;
      lista.append(li);
    });
    kontener.append(lista);
  }

  if (info.event.id) {
    const akcje = document.createElement('div');
    akcje.className = 'fc-event-actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fc-event-assign-btn';
    btn.textContent = 'Przypisz';
    btn.setAttribute('data-akcja', 'assign-zlecenie');
    btn.setAttribute('data-id', info.event.id);
    akcje.append(btn);
    kontener.append(akcje);
  }

  return { domNodes: [kontener] };
}

function odswiezKalendarz() {
  if (!calendarInstance) {
    return;
  }
  calendarInstance.refetchEvents();
  przeliczPodsumowanieKalendarza();
}

function przeliczPodsumowanieKalendarza() {
  const miesiac = aktualnyMiesiacKalendarza || pobierzBiezacyMiesiac();
  let sumaP = 0;
  let sumaF = 0;
  let sumaN = 0;
  let sumaJ = 0;
  buforKalendarza.forEach((wpis) => {
    if (wpis.data?.startsWith(miesiac)) {
      sumaP += Number(wpis.praca || 0);
      sumaF += Number(wpis.fakturowane || 0);
      sumaN += Number(wpis.nadgodziny || 0);
      sumaJ += Number(wpis.jazda || 0);
    }
  });
  elementyDOM.kalendarzMiniP.textContent = `${sumaP.toFixed(2)} h`;
  elementyDOM.kalendarzMiniF.textContent = `${sumaF.toFixed(2)} h`;
  elementyDOM.kalendarzMiniN.textContent = `${sumaN.toFixed(2)} h`;
  elementyDOM.kalendarzMiniJ.textContent = `${sumaJ.toFixed(2)} h`;
}
function odswiezSelectyKlientow() {
  const selects = [elementyDOM.maszynaKlientSelect, elementyDOM.zlecenieKlientSelect, elementyDOM.assignKlientSelect];
  selects.forEach((select) => {
    if (!select) {
      return;
    }
    const poprzednia = select.value;
    select.innerHTML = '';
    select.append(new Option('-- wybierz --', ''));
    _wszystkieKlienciCache.forEach((klient) => {
      const option = new Option(klient.nazwa || 'Bez nazwy', klient.id);
      select.append(option);
    });
    select.value = poprzednia;
  });
}

function odswiezSelectyMaszyn() {
  filtrujMaszynyDoZlecenia();
  if (elementyDOM.assignZlecenieSelect) {
    const klientId = elementyDOM.assignKlientSelect ? elementyDOM.assignKlientSelect.value : null;
    wypelnijSelectZlecen(elementyDOM.assignZlecenieSelect, klientId);
  }
}

function wypelnijSelectMaszyn(select, klientId) {
  if (!select) {
    return;
  }
  const poprzednia = select.value;
  select.innerHTML = '';
  select.append(new Option('-- wybierz --', ''));
  if (ENABLE_SZYBKIE_ZLECENIE) {
    const quickOption = new Option('Szybkie zlecenie', '__quick__');
    quickOption.id = 'szybkie-zlecenie-option';
    select.append(quickOption);
  }
  const lista = klientId ? buforMaszynPoKliencie.get(klientId) || [] : _wszystkieMaszynyCache;
  lista.forEach((maszyna) => {
    const opis = `${maszyna.model || 'Maszyna'} (${maszyna.numerFabryczny || 'brak numeru'})`;
    select.append(new Option(opis, maszyna.id));
  });
  select.value = poprzednia;
}

function wypelnijSelectZlecen(select, klientId) {
  if (!select) {
    return;
  }
  const poprzednia = select.value;
  select.innerHTML = '';
  select.append(new Option('-- wybierz --', ''));
  const lista = klientId
    ? _wszystkieZleceniaCache.filter((z) => z.klientId === klientId)
    : _wszystkieZleceniaCache;
  lista.forEach((zlecenie) => {
    const klient = _wszystkieKlienciCache.find((k) => k.id === zlecenie.klientId);
    const statusOpis = zlecenie.status === 'ukonczone' ? 'zakończone' : 'aktywne';
    const opis = `${zlecenie.numer || zlecenie.id} – ${klient?.nazwa || 'brak'} (${statusOpis})`;
    select.append(new Option(opis, zlecenie.id));
  });
  select.value = poprzednia;
}

function filtrujMaszynyDoZlecenia() {
  if (!elementyDOM.zlecenieMaszynaSelect) {
    return;
  }
  const klientId = elementyDOM.zlecenieKlientSelect?.value || null;
  wypelnijSelectMaszyn(elementyDOM.zlecenieMaszynaSelect, klientId);
}

function dodajKlienta(evt) {
  evt.preventDefault();
  const form = evt.currentTarget;
  const dane = {
    nazwa: form.querySelector('#klient-nazwa').value.trim(),
    nip: form.querySelector('#klient-nip').value.trim(),
    adres: form.querySelector('#klient-adres').value.trim(),
    telefon: form.querySelector('#klient-telefon').value.trim()
  };
  addDoc(collection(db, KOLEKCJA_KLIENCI), dane).then(() => {
    form.reset();
  });
}

function obslugaKlikowKlientow(evt) {
  if (!(evt.target instanceof Element)) {
    return;
  }
  const arrow = evt.target.closest('.toggle-machines-arrow');
  if (arrow) {
    const targetId = arrow.getAttribute('data-target');
    const cel = targetId ? document.querySelector(targetId) : null;
    const expanded = arrow.getAttribute('aria-expanded') === 'true';
    arrow.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    if (cel) {
      cel.classList.toggle('active', !expanded);
    }
    return;
  }
  const edytuj = evt.target.closest('[data-akcja="edytuj-klienta"]');
  if (edytuj) {
    const id = edytuj.getAttribute('data-id');
    const klient = _wszystkieKlienciCache.find((k) => k.id === id);
    if (klient) {
      elementyDOM.klientEditId.value = klient.id;
      elementyDOM.klientEditNazwa.value = klient.nazwa || '';
      elementyDOM.klientEditNip.value = klient.nip || '';
      elementyDOM.klientEditAdres.value = klient.adres || '';
      elementyDOM.klientEditTelefon.value = klient.telefon || '';
      otworzModal(elementyDOM.klientEditModal);
    }
    return;
  }
  const usun = evt.target.closest('[data-akcja="usun-klienta"]');
  if (usun) {
    const id = usun.getAttribute('data-id');
    if (id && confirm('Usunąć klienta?')) {
      deleteDoc(doc(db, KOLEKCJA_KLIENCI, id));
    }
  }
}

function zapiszEdycjeKlienta(evt) {
  evt.preventDefault();
  const id = elementyDOM.klientEditId.value;
  if (!id) {
    return;
  }
  const dane = {
    nazwa: elementyDOM.klientEditNazwa.value.trim(),
    nip: elementyDOM.klientEditNip.value.trim(),
    adres: elementyDOM.klientEditAdres.value.trim(),
    telefon: elementyDOM.klientEditTelefon.value.trim()
  };
  updateDoc(doc(db, KOLEKCJA_KLIENCI, id), dane).then(() => zamknijModal(elementyDOM.klientEditModal));
}

function renderujKlientow() {
  if (!elementyDOM.listaKlientow) {
    return;
  }
  const filtr = (elementyDOM.klientSearch?.value || '').toLowerCase();
  elementyDOM.listaKlientow.innerHTML = '';
  const klienci = _wszystkieKlienciCache.filter((klient) => {
    if (!filtr) {
      return true;
    }
    const tekst = [klient.nazwa, klient.nip, klient.adres, klient.telefon]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return tekst.includes(filtr);
  });
  klienci.forEach((klient) => {
    const maszyny = buforMaszynPoKliencie.get(klient.id) || [];
    const item = document.createElement('div');
    item.className = 'accordion-item';
    item.innerHTML = `
      <div class="accordion-header">
        <div>
          <h4>${klient.nazwa || 'Bez nazwy'}</h4>
          <p class="section-sub">${klient.nip || 'brak NIP'} · ${klient.telefon || 'brak telefonu'}</p>
        </div>
        <div class="card-actions">
          <button type="button" data-akcja="edytuj-klienta" data-id="${klient.id}">Edytuj</button>
          <button type="button" class="danger" data-akcja="usun-klienta" data-id="${klient.id}">Usuń</button>
          <button type="button" class="toggle-machines-arrow" aria-expanded="false" data-target="#client-${klient.id}-machines">▶</button>
        </div>
      </div>
      <div id="client-${klient.id}-machines" class="accordion-content">
        <ul class="client-machines">${maszyny
          .map(
            (m) => `
              <li class="machine-card">
                <div class="machine-info">
                  <strong>${m.model || 'Brak modelu'}</strong>
                  <span class="section-sub">${m.numerFabryczny || 'brak numeru'} · Rok: ${m.rokProdukcji || '-'}</span>
                </div>
                <div class="card-actions">
                  <button type="button" data-akcja="historia-maszyny" data-id="${m.id}">Historia</button>
                  <button type="button" data-akcja="edytuj-maszyne" data-id="${m.id}">Edytuj</button>
                  <button type="button" class="danger" data-akcja="usun-maszyne" data-id="${m.id}">Usuń</button>
                </div>
              </li>
            `
          )
          .join('')}</ul>
      </div>
    `;
    elementyDOM.listaKlientow.append(item);
  });
}
function dodajMaszyne(evt) {
  evt.preventDefault();
  const form = evt.currentTarget;
  const dane = {
    klientId: form.querySelector('#maszyna-klient-select').value,
    model: form.querySelector('#maszyna-model').value.trim(),
    numerFabryczny: form.querySelector('#maszyna-numer').value.trim(),
    rokProdukcji: Number(form.querySelector('#maszyna-rok').value) || null
  };
  addDoc(collection(db, KOLEKCJA_MASZYNY), dane).then(() => form.reset());
}

function obslugaKlikowMaszyn(evt) {
  if (!(evt.target instanceof Element)) {
    return;
  }
  const historia = evt.target.closest('[data-akcja="historia-maszyny"]');
  if (historia) {
    const id = historia.getAttribute('data-id');
    pokazHistorieMaszyny(id);
    return;
  }
  const edytuj = evt.target.closest('[data-akcja="edytuj-maszyne"]');
  if (edytuj) {
    const id = edytuj.getAttribute('data-id');
    const maszyna = _wszystkieMaszynyCache.find((m) => m.id === id);
    if (maszyna) {
      elementyDOM.maszynaEditId.value = maszyna.id;
      elementyDOM.maszynaEditModel.value = maszyna.model || '';
      elementyDOM.maszynaEditNumer.value = maszyna.numerFabryczny || '';
      elementyDOM.maszynaEditRok.value = maszyna.rokProdukcji || '';
      otworzModal(elementyDOM.maszynaEditModal);
    }
    return;
  }
  const usun = evt.target.closest('[data-akcja="usun-maszyne"]');
  if (usun) {
    const id = usun.getAttribute('data-id');
    if (id && confirm('Usunąć maszynę?')) {
      deleteDoc(doc(db, KOLEKCJA_MASZYNY, id));
    }
  }
}

function zapiszEdycjeMaszyny(evt) {
  evt.preventDefault();
  const id = elementyDOM.maszynaEditId.value;
  if (!id) {
    return;
  }
  const dane = {
    model: elementyDOM.maszynaEditModel.value.trim(),
    numerFabryczny: elementyDOM.maszynaEditNumer.value.trim(),
    rokProdukcji: Number(elementyDOM.maszynaEditRok.value) || null
  };
  updateDoc(doc(db, KOLEKCJA_MASZYNY, id), dane).then(() => zamknijModal(elementyDOM.maszynaEditModal));
}

function pokazHistorieMaszyny(id) {
  const maszyna = _wszystkieMaszynyCache.find((m) => m.id === id);
  if (!maszyna) {
    return;
  }
  const zlecenia = _wszystkieZleceniaCache.filter((z) => z.maszynaId === id && z.status === 'ukonczone');
  elementyDOM.maszynaHistoriaLista.innerHTML = '';
  if (!zlecenia.length) {
    elementyDOM.maszynaHistoriaLista.textContent = 'Brak zakończonych zleceń.';
  } else {
    zlecenia.forEach((zlecenie) => {
      const entry = document.createElement('div');
      entry.className = 'history-entry';
      entry.innerHTML = `
        <strong>${zlecenie.numer || zlecenie.id}</strong>
        <p>${zlecenie.opis || ''}</p>
        <p>Data zakończenia: ${zlecenie.dataUkonczenia || '-'}</p>
        <button type="button" data-akcja="szczegoly-zlecenia" data-id="${zlecenie.id}">Szczegóły</button>
      `;
      elementyDOM.maszynaHistoriaLista.append(entry);
    });
  }
  otworzModal(elementyDOM.maszynaHistoriaModal);
}
function dodajZlecenie(evt) {
  evt.preventDefault();
  const form = evt.currentTarget;
  const dane = {
    klientId: elementyDOM.zlecenieKlientSelect.value,
    maszynaId: elementyDOM.zlecenieMaszynaSelect.value,
    opis: form.querySelector('#zlecenie-opis').value.trim(),
    dataPrzyjecia: form.querySelector('#zlecenie-data').value,
    termin: form.querySelector('#zlecenie-termin').value || null,
    status: 'aktywne',
    historia: [],
    numer: generujNumerZlecenia()
  };
  addDoc(collection(db, KOLEKCJA_ZLECENIA), dane).then(() => form.reset());
}

function generujNumerZlecenia() {
  const teraz = new Date();
  return `ZL/${teraz.getFullYear()}/${String(teraz.getMonth() + 1).padStart(2, '0')}/${Math.floor(Math.random() * 900 + 100)}`;
}

function renderujMaszyny() {
  if (!elementyDOM.maszynaLista) {
    return;
  }
  elementyDOM.maszynaLista.innerHTML = '';
  _wszystkieKlienciCache.forEach((klient) => {
    const maszyny = buforMaszynPoKliencie.get(klient.id) || [];
    const item = document.createElement('div');
    item.className = 'accordion-item';
    item.innerHTML = `
      <div class="accordion-header">
        <div>
          <h4>${klient.nazwa || 'Bez nazwy'}</h4>
          <p class="section-sub">${maszyny.length} maszyn</p>
        </div>
        <button type="button" class="toggle-machines-arrow" aria-expanded="false" data-target="#maszyny-${klient.id}">▶</button>
      </div>
      <div id="maszyny-${klient.id}" class="accordion-content">
        <ul class="machine-orders">${maszyny
          .map(
            (m) => `
              <li class="machine-card">
                <div class="machine-info">
                  <strong>${m.model || 'Brak modelu'}</strong>
                  <span class="section-sub">${m.numerFabryczny || 'brak numeru'} · Rok: ${m.rokProdukcji || '-'}</span>
                </div>
                <div class="card-actions">
                  <button type="button" data-akcja="historia-maszyny" data-id="${m.id}">Historia</button>
                  <button type="button" data-akcja="edytuj-maszyne" data-id="${m.id}">Edytuj</button>
                  <button type="button" class="danger" data-akcja="usun-maszyne" data-id="${m.id}">Usuń</button>
                </div>
              </li>
            `
          )
          .join('')}</ul>
      </div>
    `;
    elementyDOM.maszynaLista.append(item);
  });
}

function renderujZlecenia() {
  if (!elementyDOM.zleceniaAktywne) {
    return;
  }
  elementyDOM.zleceniaAktywne.innerHTML = '';
  elementyDOM.zleceniaZakonczone.innerHTML = '';
  const miesiac = elementyDOM.zakonczoneMiesiac?.value || pobierzBiezacyMiesiac();
  let sumaGodzin = 0;
  let sumaBrutto = 0;
  const aktywne = _wszystkieZleceniaCache.filter((z) => z.status !== 'ukonczone');
  const zakonczone = _wszystkieZleceniaCache.filter((z) => z.status === 'ukonczone' && z.dataUkonczenia?.startsWith(miesiac));
  aktywne.forEach((zlecenie) => {
    const element = stworzKarteZlecenia(zlecenie, false);
    elementyDOM.zleceniaAktywne.append(element);
  });
  zakonczone.forEach((zlecenie) => {
    const element = stworzKarteZlecenia(zlecenie, true);
    elementyDOM.zleceniaZakonczone.append(element);
    const godziny = Number(zlecenie.wyfakturowaneGodziny || 0);
    const typ = STAWKI_ZLECEN[zlecenie.typZlecenia] || { stawka: 0 };
    sumaGodzin += godziny;
    sumaBrutto += godziny * typ.stawka;
  });
  const sumaNetto = sumaBrutto * 0.7;
  const absorpcja = sumaGodzin ? ((sumaGodzin / 168) * 100).toFixed(1) : '0';
  elementyDOM.zakonczonePodsumowanieGodziny.textContent = `${sumaGodzin.toFixed(2)} h`;
  elementyDOM.zakonczonePodsumowanieBrutto.textContent = `${sumaBrutto.toFixed(2)} zł`;
  elementyDOM.zakonczonePodsumowanieNetto.textContent = `${sumaNetto.toFixed(2)} zł`;
  elementyDOM.zakonczonePodsumowanieAbsorpcja.textContent = `${absorpcja}%`;
}

function stworzKarteZlecenia(zlecenie, zakonczone) {
  const karta = document.createElement('div');
  karta.className = 'order-card';
  const klient = _wszystkieKlienciCache.find((k) => k.id === zlecenie.klientId);
  const maszyna = _wszystkieMaszynyCache.find((m) => m.id === zlecenie.maszynaId);
  const statusLabel = zakonczone ? 'Zakończone' : (zlecenie.status || 'Aktywne');
  karta.innerHTML = `
    <div class="order-info">
      <strong>${zlecenie.numer || zlecenie.id}</strong>
      <span>${klient?.nazwa || 'Brak klienta'} · ${maszyna?.model || 'Brak maszyny'}</span>
      <span class="section-sub">${zlecenie.opis || ''}</span>
      <span class="badge">${statusLabel}</span>
    </div>
    <div class="card-actions">
      <button type="button" data-akcja="szczegoly-zlecenia" data-id="${zlecenie.id}">Szczegóły</button>
      ${zakonczone ? `<button type="button" data-akcja="edytuj-zakonczone" data-id="${zlecenie.id}">Edytuj</button>` : `<button type="button" data-akcja="zakoncz-zlecenie" data-id="${zlecenie.id}">Zakończ</button>`}
      ${zakonczone ? `<button type="button" data-akcja="otworz-ponownie" data-id="${zlecenie.id}">Otwórz ponownie</button>` : `<button type="button" class="danger" data-akcja="usun-zlecenie" data-id="${zlecenie.id}">Usuń</button>`}
    </div>
  `;
  return karta;
}

function obslugaKlikowZlecen(evt) {
  if (!(evt.target instanceof Element)) {
    return;
  }
  const szczegoly = evt.target.closest('[data-akcja="szczegoly-zlecenia"]');
  if (szczegoly) {
    pokazSzczegolyZlecenia(szczegoly.getAttribute('data-id'));
    return;
  }
  const zakoncz = evt.target.closest('[data-akcja="zakoncz-zlecenie"]');
  if (zakoncz) {
    otworzModalZakoncz(zakoncz.getAttribute('data-id'));
    return;
  }
  const usun = evt.target.closest('[data-akcja="usun-zlecenie"]');
  if (usun) {
    const id = usun.getAttribute('data-id');
    if (id && confirm('Usunąć zlecenie?')) {
      deleteDoc(doc(db, KOLEKCJA_ZLECENIA, id));
    }
    return;
  }
  const ponownie = evt.target.closest('[data-akcja="otworz-ponownie"]');
  if (ponownie) {
    elementyDOM.zleceniePonownieId.value = ponownie.getAttribute('data-id') || '';
    elementyDOM.zleceniePonownieNotatka.value = '';
    otworzModal(elementyDOM.zleceniePonownieModal);
    return;
  }
  const edytuj = evt.target.closest('[data-akcja="edytuj-zakonczone"]');
  if (edytuj) {
    otworzModalEdycjiZlecenia(edytuj.getAttribute('data-id'));
  }
}
function otworzModalZakoncz(id) {
  const zlecenie = _wszystkieZleceniaCache.find((z) => z.id === id);
  if (!zlecenie) {
    return;
  }
  elementyDOM.zlecenieZakonczId.value = zlecenie.id;
  elementyDOM.zlecenieZakonczGodziny.value = Number(zlecenie.wyfakturowaneGodziny || 0);
  elementyDOM.zlecenieZakonczTyp.value = zlecenie.typZlecenia || 'S';
  elementyDOM.zlecenieZakonczData.value = new Date().toISOString().slice(0, 10);
  elementyDOM.zlecenieZakonczNotatka.value = '';
  wybraneCzesci = [];
  wypelnijListeMagazynowa();
  aktualizujWybraneCzesci();
  otworzModal(document.getElementById('zlecenie-zakoncz-modal'));
}

function wypelnijListeMagazynowa() {
  if (!elementyDOM.zlecenieMagazynLista) {
    return;
  }
  elementyDOM.zlecenieMagazynLista.innerHTML = '';
  buforMagazynu.forEach((produkt) => {
    const li = document.createElement('li');
    li.className = 'stock-item';
    li.innerHTML = `
      <span>${produkt.index || ''} – ${produkt.nazwa || ''} (${Number(produkt.ilosc || 0).toFixed(2)})</span>
      <button type="button" data-akcja="dodaj-czesc" data-id="${produkt.id}">Dodaj</button>
    `;
    elementyDOM.zlecenieMagazynLista.append(li);
  });
  elementyDOM.zlecenieMagazynLista.removeEventListener('click', dodajCzescDoListy);
  elementyDOM.zlecenieMagazynLista.addEventListener('click', dodajCzescDoListy);
}

function dodajCzescDoListy(evt) {
  if (!(evt.target instanceof Element)) {
    return;
  }
  const btn = evt.target.closest('[data-akcja="dodaj-czesc"]');
  if (!btn) {
    return;
  }
  const id = btn.getAttribute('data-id');
  const produkt = id ? buforMagazynu.get(id) : null;
  if (!produkt) {
    return;
  }
  const istnieje = wybraneCzesci.find((poz) => poz.id === produkt.id);
  if (istnieje) {
    istnieje.ilosc += 1;
  } else {
    wybraneCzesci.push({ id: produkt.id, index: produkt.index, nazwa: produkt.nazwa, ilosc: 1 });
  }
  aktualizujWybraneCzesci();
}

function aktualizujWybraneCzesci() {
  if (!elementyDOM.zlecenieMagazynWybrane) {
    return;
  }
  elementyDOM.zlecenieMagazynWybrane.innerHTML = '';
  wybraneCzesci.forEach((poz, idx) => {
    const li = document.createElement('li');
    li.className = 'stock-item';
    li.innerHTML = `
      <span>${poz.index} – ${poz.nazwa} (${poz.ilosc})</span>
      <div class="card-actions">
        <button type="button" data-akcja="zwieksz-pozycje" data-index="${idx}">+</button>
        <button type="button" data-akcja="zmniejsz-pozycje" data-index="${idx}">-</button>
        <button type="button" class="danger" data-akcja="usun-pozycje" data-index="${idx}">Usuń</button>
      </div>
    `;
    elementyDOM.zlecenieMagazynWybrane.append(li);
  });
  elementyDOM.zlecenieMagazynWybrane.removeEventListener('click', modyfikujPozycje);
  elementyDOM.zlecenieMagazynWybrane.addEventListener('click', modyfikujPozycje);
}

function modyfikujPozycje(evt) {
  if (!(evt.target instanceof Element)) {
    return;
  }
  const idx = Number(evt.target.getAttribute('data-index'));
  if (Number.isNaN(idx)) {
    return;
  }
  const akcja = evt.target.getAttribute('data-akcja');
  const pozycja = wybraneCzesci[idx];
  if (!pozycja) {
    return;
  }
  if (akcja === 'zwieksz-pozycje') {
    pozycja.ilosc += 1;
  } else if (akcja === 'zmniejsz-pozycje') {
    pozycja.ilosc = Math.max(1, pozycja.ilosc - 1);
  } else if (akcja === 'usun-pozycje') {
    wybraneCzesci.splice(idx, 1);
  }
  aktualizujWybraneCzesci();
}

function zakonczZlecenie(evt) {
  evt.preventDefault();
  const id = elementyDOM.zlecenieZakonczId.value;
  const godziny = Number(elementyDOM.zlecenieZakonczGodziny.value || 0);
  const typ = elementyDOM.zlecenieZakonczTyp.value;
  const data = elementyDOM.zlecenieZakonczData.value;
  const notatka = elementyDOM.zlecenieZakonczNotatka.value.trim();
  runTransaction(db, async (transaction) => {
    const ref = doc(db, KOLEKCJA_ZLECENIA, id);
    const snap = await transaction.get(ref);
    if (!snap.exists()) {
      throw new Error('Brak zlecenia');
    }
    const dane = snap.data();
    const historia = Array.isArray(dane.historia) ? [...dane.historia] : [];
    historia.push({
      typ: 'zakonczenie',
      data: new Date().toISOString(),
      opis: `Zakończono: ${godziny} h (${typ}). ${notatka}`
    });
    transaction.update(ref, {
      status: 'ukonczone',
      dataUkonczenia: data,
      wyfakturowaneGodziny: godziny,
      typZlecenia: typ,
      zakonczenieNotatka: notatka,
      historia
    });
    for (const pozycja of wybraneCzesci) {
      const produktRef = doc(db, KOLEKCJA_MAGAZYN, pozycja.id);
      const produktSnap = await transaction.get(produktRef);
      if (!produktSnap.exists()) {
        continue;
      }
      const stan = Number(produktSnap.data().ilosc || 0);
      if (stan < pozycja.ilosc) {
        throw new Error(`Za mało produktu ${pozycja.nazwa}`);
      }
      transaction.update(produktRef, { ilosc: stan - pozycja.ilosc });
    }
  })
    .then(() => {
      zamknijModal(document.getElementById('zlecenie-zakoncz-modal'));
    })
    .catch((err) => {
      console.error(err);
      alert(err.message);
    });
}

function otworzPonownieZlecenie(evt) {
  evt.preventDefault();
  const id = elementyDOM.zleceniePonownieId.value;
  const status = elementyDOM.zleceniePonownieStatus.value;
  const notatka = elementyDOM.zleceniePonownieNotatka.value.trim();
  const ref = doc(db, KOLEKCJA_ZLECENIA, id);
  runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) {
      throw new Error('Brak zlecenia');
    }
    const dane = snap.data();
    const historia = Array.isArray(dane.historia) ? [...dane.historia] : [];
    historia.push({
      typ: 'ponowne-otwarcie',
      data: new Date().toISOString(),
      opis: `Ponownie otwarte (${status}): ${notatka}`
    });
    transaction.update(ref, {
      status,
      historia
    });
  })
    .then(() => zamknijModal(elementyDOM.zleceniePonownieModal))
    .catch((err) => alert(err.message));
}

function otworzModalEdycjiZlecenia(id) {
  const zlecenie = _wszystkieZleceniaCache.find((z) => z.id === id);
  if (!zlecenie) {
    return;
  }
  elementyDOM.zlecenieEdytujId.value = zlecenie.id;
  elementyDOM.zlecenieEdytujGodziny.value = Number(zlecenie.wyfakturowaneGodziny || 0);
  elementyDOM.zlecenieEdytujTyp.value = zlecenie.typZlecenia || 'S';
  elementyDOM.zlecenieEdytujNotatka.value = '';
  otworzModal(elementyDOM.zlecenieEdytujModal);
}

function zapiszEdycjeZlecenia(evt) {
  evt.preventDefault();
  const id = elementyDOM.zlecenieEdytujId.value;
  const godziny = Number(elementyDOM.zlecenieEdytujGodziny.value || 0);
  const typ = elementyDOM.zlecenieEdytujTyp.value;
  const notatka = elementyDOM.zlecenieEdytujNotatka.value.trim();
  const ref = doc(db, KOLEKCJA_ZLECENIA, id);
  runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) {
      throw new Error('Brak zlecenia');
    }
    const dane = snap.data();
    const historia = Array.isArray(dane.historia) ? [...dane.historia] : [];
    historia.push({
      typ: 'edycja-zakonczonego',
      data: new Date().toISOString(),
      opis: `Aktualizacja: ${godziny} h (${typ}). ${notatka}`
    });
    transaction.update(ref, {
      wyfakturowaneGodziny: godziny,
      typZlecenia: typ,
      historia
    });
  })
    .then(() => zamknijModal(elementyDOM.zlecenieEdytujModal))
    .catch((err) => alert(err.message));
}
function pokazSzczegolyZlecenia(id) {
  const zlecenie = _wszystkieZleceniaCache.find((z) => z.id === id);
  if (!zlecenie) {
    return;
  }
  const klient = _wszystkieKlienciCache.find((k) => k.id === zlecenie.klientId);
  const maszyna = _wszystkieMaszynyCache.find((m) => m.id === zlecenie.maszynaId);
  const historia = Array.isArray(zlecenie.historia) ? zlecenie.historia : [];
  const wpisyKalendarza = [];
  buforKalendarza.forEach((wpis) => {
    const ids = Array.isArray(wpis.zleceniaIds) ? wpis.zleceniaIds : wpis.zlecenieId ? [wpis.zlecenieId] : [];
    if (ids.includes(zlecenie.id)) {
      wpisyKalendarza.push(wpis);
    }
  });
  elementyDOM.zlecenieSzczegolyKontent.innerHTML = `
    <p><strong>Klient:</strong> ${klient?.nazwa || '-'}</p>
    <p><strong>Maszyna:</strong> ${maszyna?.model || '-'}</p>
    <p><strong>Opis:</strong> ${zlecenie.opis || '-'}</p>
    <p><strong>Status:</strong> ${zlecenie.status || '-'}</p>
    <p><strong>Wyfakturowane godziny:</strong> ${Number(zlecenie.wyfakturowaneGodziny || 0).toFixed(2)}</p>
    <p><strong>Typ zlecenia:</strong> ${zlecenie.typZlecenia || '-'}</p>
    <h3>Historia</h3>
    <ul class="history-list">${historia.map((h) => `<li>${new Date(h.data).toLocaleString()} – ${h.opis}</li>`).join('')}</ul>
    <h3>Wpisy kalendarza</h3>
    <ul class="history-list">${wpisyKalendarza.map((w) => `<li>${w.data}: P${w.praca || 0} F${w.fakturowane || 0}</li>`).join('')}</ul>
  `;
  otworzModal(elementyDOM.zlecenieSzczegolyModal);
}

function renderujMagazyn() {
  if (!elementyDOM.magazynTabela) {
    return;
  }
  elementyDOM.magazynTabela.innerHTML = '';
  buforMagazynu.forEach((produkt) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${produkt.index || '-'}</td>
      <td>${produkt.nazwa || '-'}</td>
      <td>${Number(produkt.ilosc || 0).toFixed(2)}</td>
      <td>
        <button type="button" data-akcja="dodaj-stan" data-id="${produkt.id}">Dodaj</button>
        <button type="button" data-akcja="zdejmij-stan" data-id="${produkt.id}">Zdejmij</button>
        <button type="button" class="danger" data-akcja="usun-produkt" data-id="${produkt.id}">Usuń</button>
      </td>
    `;
    elementyDOM.magazynTabela.append(tr);
  });
}

function dodajProdukt(evt) {
  evt.preventDefault();
  const form = evt.currentTarget;
  const produkt = {
    index: form.querySelector('#magazyn-index').value.trim(),
    nazwa: form.querySelector('#magazyn-nazwa').value.trim(),
    ilosc: Number(form.querySelector('#magazyn-ilosc').value || 0)
  };
  addDoc(collection(db, KOLEKCJA_MAGAZYN), produkt).then(() => form.reset());
}

function dodajProduktyMasowo(evt) {
  evt.preventDefault();
  const tekst = elementyDOM.magazynMasoweTextarea.value.trim();
  if (!tekst) {
    return;
  }
  const linie = tekst.split('\n');
  Promise.all(
    linie.map((linia) => {
      const [index, nazwa, iloscStr] = linia.split(';');
      return addDoc(collection(db, KOLEKCJA_MAGAZYN), {
        index: index?.trim() || '',
        nazwa: nazwa?.trim() || '',
        ilosc: Number(iloscStr || 0)
      });
    })
  ).then(() => {
    elementyDOM.magazynMasoweTextarea.value = '';
  });
}

function obslugaKlikowMagazynu(evt) {
  if (!(evt.target instanceof Element)) {
    return;
  }
  const dodaj = evt.target.closest('[data-akcja="dodaj-stan"]');
  const zdejmij = evt.target.closest('[data-akcja="zdejmij-stan"]');
  const usun = evt.target.closest('[data-akcja="usun-produkt"]');
  if (dodaj || zdejmij) {
    const id = (dodaj || zdejmij).getAttribute('data-id');
    const produkt = id ? buforMagazynu.get(id) : null;
    if (!produkt) {
      return;
    }
    const krok = czyProduktOlej(produkt.index) ? 0.01 : 1;
    elementyDOM.magazynZmianaId.value = produkt.id;
    elementyDOM.magazynZmianaIlosc.value = '0';
    elementyDOM.magazynZmianaIlosc.step = krok.toString();
    elementyDOM.magazynZmianaForm.setAttribute('data-tryb', dodaj ? 'dodaj' : 'zdejmij');
    otworzModal(elementyDOM.magazynZmianaModal);
    return;
  }
  if (usun) {
    const id = usun.getAttribute('data-id');
    if (id && confirm('Usunąć produkt z magazynu?')) {
      deleteDoc(doc(db, KOLEKCJA_MAGAZYN, id));
    }
  }
}

function zapiszZmianeMagazynu(evt) {
  evt.preventDefault();
  const id = elementyDOM.magazynZmianaId.value;
  const tryb = elementyDOM.magazynZmianaForm.getAttribute('data-tryb');
  const ilosc = Number(elementyDOM.magazynZmianaIlosc.value || 0);
  if (!id || ilosc <= 0) {
    return;
  }
  const ref = doc(db, KOLEKCJA_MAGAZYN, id);
  runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) {
      throw new Error('Produkt nie istnieje');
    }
    const stan = Number(snap.data().ilosc || 0);
    const nowy = tryb === 'dodaj' ? stan + ilosc : stan - ilosc;
    if (nowy < 0) {
      throw new Error('Za mało w magazynie');
    }
    transaction.update(ref, { ilosc: nowy });
  })
    .then(() => zamknijModal(elementyDOM.magazynZmianaModal))
    .catch((err) => alert(err.message));
}

function czyProduktOlej(index) {
  const oleje = ['HYGARD', 'PLUS50', 'COOLGARD', 'EXTGARD'];
  const wartosc = (index || '').toUpperCase();
  return oleje.some((olej) => wartosc.includes(olej));
}

function przeliczOleje() {
  const pojemnosc = Number(elementyDOM.olejPojemnosc.value || 0);
  const sztuki = Number(elementyDOM.olejSztuki.value || 0);
  const litry = Number(elementyDOM.olejLitry.value || 0);
  if (sztuki > 0 && litry === 0) {
    elementyDOM.olejLitry.value = (sztuki * pojemnosc).toFixed(2);
  } else if (litry > 0 && sztuki === 0) {
    elementyDOM.olejSztuki.value = (litry / pojemnosc).toFixed(2);
  }
}
function otworzModal(modal) {
  if (!(modal instanceof HTMLElement)) {
    return;
  }
  modal.setAttribute('aria-hidden', 'false');
}

function zamknijModal(modal) {
  if (!(modal instanceof HTMLElement)) {
    return;
  }
  modal.setAttribute('aria-hidden', 'true');
}

function aktualizujPulpit() {
  const aktywne = _wszystkieZleceniaCache.filter((z) => z.status !== 'ukonczone').length;
  elementyDOM.pulpitAktywne.textContent = aktywne.toString();
  const dzis = new Date().toISOString().slice(0, 10);
  let godziny = 0;
  buforKalendarza.forEach((wpis) => {
    if (wpis.data === dzis) {
      godziny += Number(wpis.praca || 0);
    }
  });
  elementyDOM.pulpitGodziny.textContent = `${godziny.toFixed(2)} h`;
  elementyDOM.pulpitNiskieStany.innerHTML = '';
  const niskie = [];
  buforMagazynu.forEach((produkt) => {
    if (Number(produkt.ilosc || 0) < 5) {
      niskie.push(`${produkt.index} – ${produkt.nazwa} (${produkt.ilosc})`);
    }
  });
  if (!niskie.length) {
    elementyDOM.pulpitNiskieStany.innerHTML = '<li>Brak niskich stanów</li>';
  } else {
    niskie.slice(0, 5).forEach((tekst) => {
      const li = document.createElement('li');
      li.textContent = tekst;
      elementyDOM.pulpitNiskieStany.append(li);
    });
  }
  elementyDOM.pulpitZadania.innerHTML = '';
  _wszystkieZleceniaCache
    .filter((z) => z.status !== 'ukonczone' && z.termin)
    .sort((a, b) => (a.termin || '').localeCompare(b.termin || ''))
    .slice(0, 5)
    .forEach((z) => {
      const li = document.createElement('li');
      li.textContent = `${z.numer || z.id} – termin ${z.termin}`;
      elementyDOM.pulpitZadania.append(li);
    });
}

function aktualizujPodsumowania() {
  const miesiac = elementyDOM.summaryMiesiacInput?.value || pobierzBiezacyMiesiac();
  let sumaGodzin = 0;
  let sumaBrutto = 0;
  let noweZlecenia = 0;
  const poprzedniMiesiac = obliczPoprzedniMiesiac(miesiac);
  let sumaPoprzedni = 0;
  _wszystkieZleceniaCache.forEach((z) => {
    if (z.dataPrzyjecia?.startsWith(miesiac)) {
      noweZlecenia += 1;
    }
    if (z.status === 'ukonczone' && z.dataUkonczenia?.startsWith(miesiac)) {
      const godziny = Number(z.wyfakturowaneGodziny || 0);
      const typ = STAWKI_ZLECEN[z.typZlecenia] || { stawka: 0 };
      sumaGodzin += godziny;
      sumaBrutto += godziny * typ.stawka;
    }
    if (z.status === 'ukonczone' && z.dataUkonczenia?.startsWith(poprzedniMiesiac)) {
      const godziny = Number(z.wyfakturowaneGodziny || 0);
      const typ = STAWKI_ZLECEN[z.typZlecenia] || { stawka: 0 };
      sumaPoprzedni += godziny * typ.stawka;
    }
  });
  const trend = sumaPoprzedni ? (((sumaBrutto - sumaPoprzedni) / sumaPoprzedni) * 100).toFixed(1) : '0';
  const absorpcja = sumaGodzin ? ((sumaGodzin / 168) * 100).toFixed(1) : '0';
  const netto = sumaBrutto * 0.7;
  elementyDOM.summaryHoursMonth.textContent = `${sumaGodzin.toFixed(2)} h`;
  elementyDOM.summaryHoursTrend.textContent = `${trend}% vs poprzedni`;
  elementyDOM.summaryAbsorption.textContent = `${absorpcja}%`;
  elementyDOM.summaryStawka.textContent = `${netto.toFixed(2)} zł netto`;
  elementyDOM.summaryNewOrders.textContent = `${noweZlecenia}`;
  elementyDOM.summaryHistoryGrid.innerHTML = '';
  const miesiace = pobierzOstatnieMiesiace(6);
  miesiace.forEach((msc) => {
    const pole = document.createElement('div');
    const dane = policzMiesiac(msc);
    pole.className = 'tile';
    pole.innerHTML = `
      <h4>${msc}</h4>
      <p class="tile-value">${dane.godziny.toFixed(1)} h</p>
      <p class="section-sub">Brutto: ${dane.brutto.toFixed(2)} zł</p>
    `;
    elementyDOM.summaryHistoryGrid.append(pole);
  });
}

function obliczPoprzedniMiesiac(miesiac) {
  const [rok, m] = miesiac.split('-').map(Number);
  const data = new Date(rok, m - 1, 1);
  data.setMonth(data.getMonth() - 1);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
}

function pobierzOstatnieMiesiace(liczba) {
  const wynik = [];
  const teraz = new Date();
  for (let i = 0; i < liczba; i += 1) {
    const data = new Date(teraz.getFullYear(), teraz.getMonth() - i, 1);
    wynik.push(`${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`);
  }
  return wynik;
}

function policzMiesiac(miesiac) {
  let godziny = 0;
  let brutto = 0;
  _wszystkieZleceniaCache.forEach((z) => {
    if (z.status === 'ukonczone' && z.dataUkonczenia?.startsWith(miesiac)) {
      const h = Number(z.wyfakturowaneGodziny || 0);
      const typ = STAWKI_ZLECEN[z.typZlecenia] || { stawka: 0 };
      godziny += h;
      brutto += h * typ.stawka;
    }
  });
  return { godziny, brutto };
}

function otworzModalKalendarza(wpis) {
  elementyDOM.kalendarzDocId.value = wpis.id || '';
  elementyDOM.kalendarzData.value = wpis.data || new Date().toISOString().slice(0, 10);
  elementyDOM.kalendarzPraca.value = wpis.praca || 0;
  elementyDOM.kalendarzFaktura.value = wpis.fakturowane || 0;
  elementyDOM.kalendarzNadgodziny.value = wpis.nadgodziny || 0;
  elementyDOM.kalendarzJazda.value = wpis.jazda || 0;
  elementyDOM.kalendarzNotatka.value = wpis.notatka || '';
  elementyDOM.kalendarzZleceniaTagi.innerHTML = '';
  const ids = pobierzIdZlecenZWpisu(wpis);
  ids.forEach((id) => dodajTagZlecenia(id));
  otworzModal(elementyDOM.kalendarzModal);
}

function wypelnijSelectZlecenDoKalendarza() {
  if (!elementyDOM.kalendarzZleceniaSelect) {
    return;
  }
  elementyDOM.kalendarzZleceniaSelect.innerHTML = '';
  _wszystkieZleceniaCache.forEach((z) => {
    const klient = _wszystkieKlienciCache.find((k) => k.id === z.klientId);
    const option = document.createElement('option');
    option.value = z.id;
    option.textContent = `${z.numer || z.id} – ${klient?.nazwa || 'brak'}`;
    elementyDOM.kalendarzZleceniaSelect.append(option);
  });
}

function dodajZlecenieDoTagow() {
  const id = elementyDOM.kalendarzZleceniaSelect.value;
  if (!id) {
    return;
  }
  dodajTagZlecenia(id);
}

function dodajTagZlecenia(id) {
  const istnieje = Array.from(elementyDOM.kalendarzZleceniaTagi.querySelectorAll('[data-id]')).some((tag) => tag.getAttribute('data-id') === id);
  if (istnieje) {
    return;
  }
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.setAttribute('data-id', id);
  const zlecenie = _wszystkieZleceniaCache.find((z) => z.id === id);
  const klient = _wszystkieKlienciCache.find((k) => k.id === zlecenie?.klientId);
  tag.innerHTML = `${zlecenie?.numer || id} (${klient?.nazwa || 'brak'}) <button type="button" aria-label="Usuń">×</button>`;
  tag.querySelector('button')?.addEventListener('click', () => {
    tag.remove();
  });
  elementyDOM.kalendarzZleceniaTagi.append(tag);
}
function zapiszWpisKalendarza(evt) {
  evt.preventDefault();
  const id = elementyDOM.kalendarzDocId.value;
  const dane = {
    data: elementyDOM.kalendarzData.value,
    praca: Number(elementyDOM.kalendarzPraca.value || 0),
    fakturowane: Number(elementyDOM.kalendarzFaktura.value || 0),
    nadgodziny: Number(elementyDOM.kalendarzNadgodziny.value || 0),
    jazda: Number(elementyDOM.kalendarzJazda.value || 0),
    notatka: elementyDOM.kalendarzNotatka.value.trim(),
    zleceniaIds: Array.from(elementyDOM.kalendarzZleceniaTagi.querySelectorAll('[data-id]')).map((tag) => tag.getAttribute('data-id'))
  };
  const kolekcja = collection(db, KOLEKCJA_KALENDARZ);
  const obietnica = id ? updateDoc(doc(db, KOLEKCJA_KALENDARZ, id), dane) : addDoc(kolekcja, dane);
  obietnica.then(() => {
    zamknijModal(elementyDOM.kalendarzModal);
  });
}

function usunWpisKalendarza() {
  const id = elementyDOM.kalendarzDocId.value;
  if (!id) {
    return;
  }
  if (confirm('Usunąć wpis kalendarza?')) {
    deleteDoc(doc(db, KOLEKCJA_KALENDARZ, id)).then(() => zamknijModal(elementyDOM.kalendarzModal));
  }
}

function zapiszPrzypisanieZlecenia(evt) {
  evt.preventDefault();
  const id = elementyDOM.assignDocId.value;
  const data = elementyDOM.assignData.value;
  const zlecenieId = elementyDOM.assignZlecenieSelect.value;
  if (!id) {
    return;
  }
  if (!zlecenieId) {
    alert('Wybierz zlecenie do przypisania.');
    return;
  }
  const ref = doc(db, KOLEKCJA_KALENDARZ, id);
  runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) {
      throw new Error('Brak wpisu');
    }
    const dane = snap.data();
    const ids = pobierzIdZlecenZWpisu(dane);
    if (!ids.includes(zlecenieId)) {
      ids.push(zlecenieId);
    }
    const aktualizacja = { data, zleceniaIds: ids, zlecenieId: ids.length === 1 ? ids[0] : null };
    transaction.update(ref, aktualizacja);
  })
    .then(() => zamknijModal(elementyDOM.assignModal))
    .catch((err) => alert(err.message));
}

function aktualizujWyborZlecenDlaAssign() {
  if (!elementyDOM.assignKlientSelect || !elementyDOM.assignZlecenieSelect) {
    return;
  }
  wypelnijSelectZlecen(elementyDOM.assignZlecenieSelect, elementyDOM.assignKlientSelect.value);
}

function otworzAssignModal(wpis) {
  elementyDOM.assignDocId.value = wpis.id;
  elementyDOM.assignData.value = wpis.data;
  const powiazane = pobierzIdZlecenZWpisu(wpis);
  const pierwsze = powiazane.length
    ? _wszystkieZleceniaCache.find((z) => z.id === powiazane[0])
    : null;
  elementyDOM.assignKlientSelect.value = pierwsze?.klientId || '';
  aktualizujWyborZlecenDlaAssign();
  if (elementyDOM.assignZlecenieSelect) {
    elementyDOM.assignZlecenieSelect.value = '';
  }
  otworzModal(elementyDOM.assignModal);
}

function dodajObslugeAssign() {
  if (!elementyDOM.calendarContainer) {
    return;
  }
  elementyDOM.calendarContainer.addEventListener('click', (evt) => {
    if (!(evt.target instanceof Element)) {
      return;
    }
    const btn = evt.target.closest('[data-akcja="assign-zlecenie"]');
    if (btn) {
      evt.preventDefault();
      evt.stopPropagation();
      const id = btn.getAttribute('data-id');
      const wpis = id ? buforKalendarza.get(id) : null;
      if (wpis) {
        otworzAssignModal(wpis);
      }
    }
  });
}

function zapiszZmienioneSekcje() {
  renderujKlientow();
  renderujMaszyny();
  renderujZlecenia();
  renderujMagazyn();
  aktualizujPulpit();
  aktualizujPodsumowania();
}
