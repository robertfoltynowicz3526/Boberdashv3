// --- USTAWIENIA I ZMIENNE GLOBALNE ---
const db = firebase.firestore();
const currentMonth = new Date();
let clientsData = {}; // Globalna mapa klientów do szybkiego wyszukiwania
let machinesData = {}; // Globalna mapa maszyn
let ordersData = {}; // Globalna mapa wszystkich zleceń
let calendarAssignments = {}; // Przypisania do kalendarza

// --- FUNKCJE POMOCNICZE ---

/** Funkcja do przełączania widoczności sekcji. */
function showSection(sectionId) {
    document.querySelectorAll('section').forEach(section => {
        section.classList.add('hidden');
    });
    document.getElementById(sectionId).classList.remove('hidden');
    // Ustawia tytuł sekcji
    const sectionTitleElement = document.getElementById(sectionId).querySelector('h2');
    if (sectionTitleElement) {
        document.getElementById('current-section-title').textContent = sectionTitleElement.textContent;
    } else {
         document.getElementById('current-section-title').textContent = sectionId.charAt(0).toUpperCase() + sectionId.slice(1);
    }
    
    // Specyficzne ładowanie dla kalendarza
    if (sectionId === 'kalendarz') {
        renderCalendar(currentMonth);
    }
}

/** Funkcja formatująca datę YYYY-MM-DD */
function formatDate(date) {
    const d = new Date(date);
    let month = '' + (d.getMonth() + 1);
    let day = '' + d.getDate();
    const year = d.getFullYear();

    if (month.length < 2) month = '0' + month;
    if (day.length < 2) day = '0' + day;

    return [year, month, day].join('-');
}

/** Wypełnianie listy select elementami z bazy (Klient/Maszyna) */
function populateSelect(selectElementId, collectionName, displayKey) {
    const select = document.getElementById(selectElementId);
    if (!select) return;

    db.collection(collectionName).onSnapshot(snapshot => {
        let dataMap = {}; // Lokalna mapa dla aktualnego snapshotu
        select.innerHTML = '<option value="">-- Wybierz --</option>';
        
        snapshot.forEach(doc => {
            const data = doc.data();
            dataMap[doc.id] = data; // Zapisujemy do mapy
            const option = document.createElement('option');
            option.value = doc.id;
            option.textContent = data[displayKey];
            select.appendChild(option);
        });

        // Aktualizacja globalnych map
        if (collectionName === 'klienci') clientsData = dataMap;
        if (collectionName === 'maszyny') machinesData = dataMap;

        // Liczniki na Dashboard
        if (collectionName === 'klienci') document.getElementById('clients-count').textContent = snapshot.size;
        if (collectionName === 'maszyny') document.getElementById('machines-count').textContent = snapshot.size;

        // Przeładowanie list po aktualizacji danych Klientów/Maszyn
        renderClients();
        renderMachines();
    });
}

/** Renderowanie Listy Zleceń */
function renderOrders(listId, orders) {
    const list = document.getElementById(listId);
    if (!list) return;
    list.innerHTML = '';

    orders.forEach(doc => {
        const order = doc.data();
        const client = clientsData[order.klientId] ? clientsData[order.klientId].nazwa : 'Brak Klienta';
        const machine = machinesData[order.maszynaId] ? machinesData[order.maszynaId].nazwa : 'Brak Maszyny';

        const listItem = document.createElement('li');
        listItem.className = 'list-item';
        listItem.innerHTML = `
            <div>
                <strong>${client}</strong> - ${machine}
                <br>
                <small>${order.opis.substring(0, 50)}...</small>
            </div>
            <div class="action-buttons">
                <span class="${order.status === 'Aktywne' ? 'status-active' : 'status-finished'}">${order.status}</span>
                <button class="details-btn" data-id="${doc.id}"><i class="fas fa-info-circle"></i> Szczegóły</button>
            </div>
        `;
        list.appendChild(listItem);
    });
}

// --- LOGIKA FIREBASE I LISTENERY ---

function setupFirebaseListeners() {
    // Klienci
    populateSelect('client-select', 'klienci', 'nazwa');
    
    // Maszyny
    populateSelect('machine-select', 'maszyny', 'nazwa');
    
    // Zlecenia
    db.collection('zlecenia').onSnapshot(snapshot => {
        const activeOrders = [];
        const finishedOrders = [];
        ordersData = {}; // Czyścimy globalną mapę zleceń

        snapshot.forEach(doc => {
            const order = doc.data();
            ordersData[doc.id] = {...order, id: doc.id}; // Zapisujemy
            if (order.status === 'Aktywne') {
                activeOrders.push(doc);
            } else {
                finishedOrders.push(doc);
            }
        });

        document.getElementById('active-orders-count').textContent = activeOrders.length;
        document.getElementById('finished-orders-count').textContent = finishedOrders.length;

        // RENDEROWANIE ZLECEŃ
        renderOrders('active-orders-list', activeOrders);
        renderOrders('finished-orders-list', finishedOrders);

        // Ostatnie aktywne zlecenia na Dashboard (wersja bez filtrowania)
        renderOrders('last-active-orders-list', activeOrders.slice(0, 5));
        
        // Renderowanie kalendarza, jeśli jest aktywny
        if (!document.getElementById('kalendarz').classList.contains('hidden')) {
             renderCalendar(currentMonth);
        }
    });

    // Przypisania Kalendarza
    db.collection('calendarAssignments').onSnapshot(snapshot => {
        calendarAssignments = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            calendarAssignments[data.date] = data;
        });
        // Przeładuj kalendarz po wczytaniu danych
        if (!document.getElementById('kalendarz').classList.contains('hidden')) {
             renderCalendar(currentMonth);
        }
    });
}

// --- LOGIKA ZLECENIA (Krok 2) ---

/** Wyszukiwanie zleceń */
function filterOrders(searchTerm) {
    const term = searchTerm.toLowerCase();
    
    // Pobierz wszystkie elementy list
    const activeList = document.getElementById('active-orders-list');
    const finishedList = document.getElementById('finished-orders-list');

    // Funkcja do filtrowania listy
    const filterList = (list) => {
        Array.from(list.children).forEach(listItem => {
            const textContent = listItem.textContent.toLowerCase();
            if (textContent.includes(term)) {
                listItem.style.display = 'flex'; // Pokaż element
            } else {
                listItem.style.display = 'none'; // Ukryj element
            }
        });
    };

    filterList(activeList);
    filterList(finishedList);
}

/** Renderowanie szczegółów (Modal) */
function openOrderDetailsModal(orderId) {
    const order = ordersData[orderId];
    if (!order) return;

    const client = clientsData[order.klientId] ? clientsData[order.klientId].nazwa : 'Nieznany';
    const machine = machinesData[order.maszynaId] ? machinesData[order.maszynaId].nazwa : 'Nieznana';

    const detailsContent = document.getElementById('modal-order-details-content');
    detailsContent.innerHTML = `
        <p><strong>Klient:</strong> ${client}</p>
        <p><strong>Maszyna:</strong> ${machine}</p>
        <p><strong>Status:</strong> <span class="${order.status === 'Aktywne' ? 'status-active' : 'status-finished'}">${order.status}</span></p>
        <p><strong>Data Rozpoczęcia:</strong> ${order.data}</p>
        <p><strong>Opis:</strong> ${order.opis}</p>
        
        <h4>Historia (Symulowana)</h4>
        <p><small>Brak faktycznej historii zmian w bazie, ale tu mogłaby się pojawić:</small></p>
        <ul>
            <li><small>Dodano: ${order.data}</small></li>
            <li><small>Status zmieniony na ${order.status} (Symulacja)</small></li>
        </ul>
    `;
    document.getElementById('order-details-modal').style.display = 'block';
}

/** Zwijanie listy zakończonych zleceń */
function setupCollapsible() {
    const toggle = document.getElementById('finished-orders-toggle');
    const content = document.getElementById('finished-orders-list');
    
    toggle.addEventListener('click', () => {
        const isHidden = content.style.display === 'none';
        content.style.display = isHidden ? 'block' : 'none';
        toggle.classList.toggle('active', !isHidden);
    });
}


// --- LOGIKA KLIENTÓW I MASZYN (Krok 3) ---

/** Renderowanie Listy Klientów z przyciskiem edycji */
function renderClients() {
    const list = document.getElementById('clients-list');
    if (!list) return;
    list.innerHTML = '';

    Object.keys(clientsData).forEach(id => {
        const client = clientsData[id];
        const listItem = document.createElement('li');
        listItem.className = 'list-item';
        listItem.innerHTML = `
            <div>
                <strong>${client.nazwa}</strong><br>
                <small>${client.email || 'Brak emaila'} | ${client.telefon || 'Brak telefonu'}</small>
            </div>
            <div class="action-buttons">
                <button class="edit-client-btn" data-id="${id}"><i class="fas fa-edit"></i> Edytuj</button>
            </div>
        `;
        list.appendChild(listItem);
    });
}

/** Renderowanie Listy Maszyn z przyciskiem edycji */
function renderMachines() {
    const list = document.getElementById('machines-list');
    if (!list) return;
    list.innerHTML = '';

    Object.keys(machinesData).forEach(id => {
        const machine = machinesData[id];
        const listItem = document.createElement('li');
        listItem.className = 'list-item';
        listItem.innerHTML = `
            <div>
                <strong>${machine.nazwa}</strong><br>
                <small>VIN: ${machine.vin || 'Brak VIN'} | Uwagi: ${machine.notes.substring(0, 30) || 'Brak'}</small>
            </div>
            <div class="action-buttons">
                <button class="edit-machine-btn" data-id="${id}"><i class="fas fa-edit"></i> Edytuj</button>
            </div>
        `;
        list.appendChild(listItem);
    });
}

/** Otwieranie modala edycji Klienta */
function openClientEditModal(id) {
    const client = clientsData[id];
    if (!client) return;

    document.getElementById('edit-client-id').value = id;
    document.getElementById('edit-client-name').value = client.nazwa || '';
    document.getElementById('edit-client-phone').value = client.telefon || '';
    document.getElementById('edit-client-email').value = client.email || '';

    document.getElementById('client-edit-modal').style.display = 'block';
}

/** Otwieranie modala edycji Maszyny */
function openMachineEditModal(id) {
    const machine = machinesData[id];
    if (!machine) return;

    document.getElementById('edit-machine-id').value = id;
    document.getElementById('edit-machine-name').value = machine.nazwa || '';
    document.getElementById('edit-machine-vin').value = machine.vin || '';
    document.getElementById('edit-machine-notes').value = machine.notes || '';

    document.getElementById('machine-edit-modal').style.display = 'block';
}

/** Zapis edycji Klienta */
function saveClientEdit(e) {
    e.preventDefault();
    const id = document.getElementById('edit-client-id').value;
    
    db.collection('klienci').doc(id).update({
        nazwa: document.getElementById('edit-client-name').value,
        telefon: document.getElementById('edit-client-phone').value,
        email: document.getElementById('edit-client-email').value,
    })
    .then(() => {
        alert('Klient zaktualizowany pomyślnie!');
        document.getElementById('client-edit-modal').style.display = 'none';
    })
    .catch(error => {
        console.error('Błąd aktualizacji klienta:', error);
        alert('Błąd podczas aktualizacji klienta.');
    });
}

/** Zapis edycji Maszyny */
function saveMachineEdit(e) {
    e.preventDefault();
    const id = document.getElementById('edit-machine-id').value;
    
    db.collection('maszyny').doc(id).update({
        nazwa: document.getElementById('edit-machine-name').value,
        vin: document.getElementById('edit-machine-vin').value,
        notes: document.getElementById('edit-machine-notes').value,
    })
    .then(() => {
        alert('Maszyna zaktualizowana pomyślnie!');
        document.getElementById('machine-edit-modal').style.display = 'none';
    })
    .catch(error => {
        console.error('Błąd aktualizacji maszyny:', error);
        alert('Błąd podczas aktualizacji maszyny.');
    });
}

// --- LOGIKA KALENDARZA (Krok 4) ---

/** Renderowanie Kalendarza */
function renderCalendar(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const today = new Date();

    const monthNames = ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"];
    document.getElementById('current-month-year').textContent = `${monthNames[month]} ${year}`;

    const calendarGrid = document.getElementById('calendar-grid');
    calendarGrid.innerHTML = '';

    // Ustawienie na pierwszy dzień miesiąca
    const firstDayOfMonth = new Date(year, month, 1);
    // 0 = Niedziela, 1 = Poniedziałek. Przekształcamy 0 (Niedz) na 7
    let startingDay = firstDayOfMonth.getDay();
    if (startingDay === 0) startingDay = 7;
    // Indeks: 1 (Pon) -> 0. 7 (Niedz) -> 6.
    startingDay = startingDay - 1; 

    // Ostatni dzień poprzedniego miesiąca
    const lastDayOfPrevMonth = new Date(year, month, 0).getDate();

    // Ostatni dzień aktualnego miesiąca
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let dayCounter = 1;
    let nextMonthDayCounter = 1;

    // Rysowanie dni
    for (let i = 0; i < 42; i++) { // 6 tygodni
        const dayElement = document.createElement('div');
        dayElement.className = 'calendar-day';

        let dateString, displayDay;
        let isCurrentMonth = true;

        if (i < startingDay) {
            // Dni poprzedniego miesiąca
            displayDay = lastDayOfPrevMonth - startingDay + i + 1;
            dayElement.classList.add('inactive');
            isCurrentMonth = false;
        } else if (dayCounter <= daysInMonth) {
            // Dni aktualnego miesiąca
            displayDay = dayCounter;
            dateString = formatDate(new Date(year, month, dayCounter));
            dayElement.dataset.date = dateString;

            // Zaznaczanie dzisiejszej daty
            if (year === today.getFullYear() && month === today.getMonth() && dayCounter === today.getDate()) {
                dayElement.classList.add('today');
            }

            dayCounter++;
        } else {
            // Dni następnego miesiąca
            displayDay = nextMonthDayCounter;
            dayElement.classList.add('inactive');
            isCurrentMonth = false;
            nextMonthDayCounter++;
        }

        dayElement.innerHTML = `<span class="day-number">${displayDay}</span>`;

        // Dodawanie przypisanych zleceń
        if (isCurrentMonth && calendarAssignments[dateString]) {
            const assignment = calendarAssignments[dateString];
            const order = ordersData[assignment.orderId];
            
            if (order) {
                const clientName = clientsData[order.klientId] ? clientsData[order.klientId].nazwa : 'Brak Klienta';
                
                dayElement.innerHTML += `
                    <div class="assignment-item" data-date="${dateString}" data-order-id="${assignment.orderId}">
                        ${clientName}
                        ${assignment.drivingTime ? `<span class="driving-time">(${assignment.drivingTime})</span>` : ''}
                    </div>
                `;
            }
        }
        
        // Ustawienie listenera tylko dla dni aktualnego miesiąca
        if (isCurrentMonth) {
            dayElement.addEventListener('click', (e) => {
                const clickedDate = dayElement.dataset.date;
                // Jeśli kliknięto na element przypisania, otwórz modal w trybie edycji/usuwania
                if (e.target.classList.contains('assignment-item')) {
                    openCalendarAssignModal(clickedDate, e.target.dataset.orderId);
                } else {
                    // Jeśli kliknięto na pole dnia, otwórz modal dla tego dnia
                    openCalendarAssignModal(clickedDate);
                }
            });
        }
        
        calendarGrid.appendChild(dayElement);

        if (dayCounter > daysInMonth && nextMonthDayCounter > 7) break; // Zoptymalizowane wyjście
    }
}

/** Otwieranie modala przypisywania zlecenia do kalendarza */
function openCalendarAssignModal(dateString, orderIdToEdit = null) {
    const modal = document.getElementById('calendar-assign-modal');
    const select = document.getElementById('assign-order-select');
    const removeBtn = document.getElementById('remove-assignment-btn');

    document.getElementById('assign-date-display').textContent = dateString;
    document.getElementById('assign-date-input').value = dateString;
    
    // Wypełnianie listy zleceń (zarówno aktywnych, jak i zakończonych)
    select.innerHTML = '<option value="">-- Wybierz zlecenie --</option>';
    Object.values(ordersData).forEach(order => {
        const option = document.createElement('option');
        option.value = order.id;
        const clientName = clientsData[order.klientId] ? clientsData[order.klientId].nazwa : 'Brak Klienta';
        option.textContent = `[${order.status.substring(0, 1)}] ${clientName} - ${order.data}`;
        select.appendChild(option);
    });
    
    // Edycja istniejącego przypisania
    if (orderIdToEdit) {
        const assignment = calendarAssignments[dateString];
        select.value = orderIdToEdit;
        document.getElementById('driving-time').value = assignment.drivingTime || '';
        removeBtn.style.display = 'block';
        removeBtn.onclick = () => removeCalendarAssignment(dateString);
    } else if (calendarAssignments[dateString]) {
        // Jeśli dzień jest już przypisany (przez kliknięcie na pole)
        const assignment = calendarAssignments[dateString];
        select.value = assignment.orderId;
        document.getElementById('driving-time').value = assignment.drivingTime || '';
        removeBtn.style.display = 'block';
        removeBtn.onclick = () => removeCalendarAssignment(dateString);
    } else {
        // Nowe przypisanie
        select.value = '';
        document.getElementById('driving-time').value = '';
        removeBtn.style.display = 'none';
        removeBtn.onclick = null;
    }

    modal.style.display = 'block';
}

/** Nawigacja Miesiącami */
function setupCalendarNavigation() {
    document.getElementById('prev-month').addEventListener('click', () => {
        currentMonth.setMonth(currentMonth.getMonth() - 1);
        renderCalendar(currentMonth);
    });

    document.getElementById('next-month').addEventListener('click', () => {
        currentMonth.setMonth(currentMonth.getMonth() + 1);
        renderCalendar(currentMonth);
    });
}

/** Zapisywanie Przypisania do Kalendarza */
function saveCalendarAssignment(e) {
    e.preventDefault();
    const date = document.getElementById('assign-date-input').value;
    const orderId = document.getElementById('assign-order-select').value;
    const drivingTime = document.getElementById('driving-time').value;

    if (!orderId) {
        alert("Proszę wybrać zlecenie.");
        return;
    }

    // Używamy daty jako ID dokumentu, co zapewnia unikalność przypisania w danym dniu
    db.collection('calendarAssignments').doc(date).set({
        date: date,
        orderId: orderId,
        drivingTime: drivingTime,
    })
    .then(() => {
        document.getElementById('calendar-assign-modal').style.display = 'none';
        alert('Zlecenie przypisane do kalendarza.');
        // Renderowanie Kalendarza jest automatycznie odświeżane przez listener (onSnapshot)
    })
    .catch(error => {
        console.error('Błąd zapisu przypisania:', error);
        alert('Błąd podczas zapisywania przypisania.');
    });
}

/** Usuwanie Przypisania z Kalendarza */
function removeCalendarAssignment(date) {
     if (!confirm(`Czy na pewno chcesz usunąć przypisanie dla dnia ${date}?`)) {
        return;
    }
    
    db.collection('calendarAssignments').doc(date).delete()
    .then(() => {
        document.getElementById('calendar-assign-modal').style.display = 'none';
        alert('Przypisanie usunięte.');
    })
    .catch(error => {
        console.error('Błąd usuwania przypisania:', error);
        alert('Błąd podczas usuwania przypisania.');
    });
}

// --- LOGIKA PRZEŁĄCZNIKA MOTYWU ---

function setupThemeToggle() {
    const themeToggle = document.getElementById('theme-toggle');
    
    function setTheme(theme) {
        if (theme === 'dark') {
            document.body.setAttribute('data-theme', 'dark');
            if (themeToggle) themeToggle.checked = true;
        } else {
            document.body.removeAttribute('data-theme');
            if (themeToggle) themeToggle.checked = false;
        }
        localStorage.setItem('theme', theme);
    }

    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);

    if (themeToggle) {
        themeToggle.addEventListener('change', () => {
            if (themeToggle.checked) {
                setTheme('dark');
            } else {
                setTheme('light');
            }
        });
    }
}

// --- GŁÓWNA FUNKCJA INICJALIZUJĄCA ---
document.addEventListener('DOMContentLoaded', () => {
    // Uruchomienie Firebase (z firebase-config.js)
    try {
        // Konfiguracja jest wczytywana z zewnętrznego pliku firebase-config.js
        firebase.initializeApp(firebaseConfig); 
    } catch (e) {
        console.error("Błąd inicjalizacji Firebase (sprawdź firebase-config.js):", e);
    }
    
    // Inicjalizacja baz danych i elementów
    setupFirebaseListeners();
    setupThemeToggle();
    setupCollapsible();
    setupCalendarNavigation();

    // Domyślne wyświetlanie sekcji
    showSection('dashboard');

    // --- Listenery Formularzy ---
    
    // Listener wyszukiwania zleceń (Krok 2)
    const orderSearchInput = document.getElementById('order-search');
    if (orderSearchInput) {
        orderSearchInput.addEventListener('input', (e) => {
            filterOrders(e.target.value);
        });
    }

    // Delegowanie kliknięć dla przycisków akcji (Szczegóły, Edycja)
    document.addEventListener('click', (e) => {
        // Przycisk Szczegóły Zlecenia (Krok 2)
        if (e.target.classList.contains('details-btn')) {
            openOrderDetailsModal(e.target.dataset.id);
        }
        // Przycisk Edycja Klienta (Krok 3)
        if (e.target.classList.contains('edit-client-btn')) {
            openClientEditModal(e.target.dataset.id);
        }
        // Przycisk Edycja Maszyny (Krok 3)
        if (e.target.classList.contains('edit-machine-btn')) {
            openMachineEditModal(e.target.dataset.id);
        }
    });

    // Zapis Edycji Klienta (Krok 3)
    const clientEditForm = document.getElementById('client-edit-form');
    if (clientEditForm) {
        clientEditForm.addEventListener('submit', saveClientEdit);
    }
    
    // Zapis Edycji Maszyny (Krok 3)
    const machineEditForm = document.getElementById('machine-edit-form');
    if (machineEditForm) {
        machineEditForm.addEventListener('submit', saveMachineEdit);
    }

    // Zapis Przypisania Kalendarza (Krok 4)
    const calendarAssignForm = document.getElementById('calendar-assign-form');
    if (calendarAssignForm) {
        calendarAssignForm.addEventListener('submit', saveCalendarAssignment);
    }

    // Przełączanie widoczności formularzy
    document.querySelectorAll('.toggle-form-btn').forEach(button => {
        button.addEventListener('click', () => {
            const form = button.closest('.widget').querySelector('form');
            if (form) {
                form.classList.toggle('hidden-form');
                button.querySelector('i').classList.toggle('fa-plus');
                button.querySelector('i').classList.toggle('fa-minus');
            }
        });
    });

    // Zamknięcie modali
    document.querySelectorAll('.modal .close-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal').style.display = 'none';
        });
    });
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.style.display = 'none';
        }
    });

    // --- OBSŁUGA POZOSTAŁYCH FORMULARZY (Zgodnie z Twoim oryginalnym kodem) ---

    // Formularz dodawania Zlecenia
    const orderForm = document.getElementById('order-form');
    if (orderForm) {
        orderForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const data = {
                klientId: document.getElementById('client-select').value,
                maszynaId: document.getElementById('machine-select').value,
                data: document.getElementById('order-date').value,
                opis: document.getElementById('order-description').value,
                status: document.getElementById('order-status').value
            };
            db.collection('zlecenia').add(data)
                .then(() => {
                    alert('Zlecenie dodane pomyślnie!');
                    document.getElementById('order-form').reset();
                })
                .catch(error => console.error("Błąd dodawania zlecenia: ", error));
        });
    }


    // Formularz dodawania Klienta
    const clientForm = document.getElementById('client-form');
    if (clientForm) {
        clientForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const data = {
                nazwa: document.getElementById('client-name').value,
                telefon: document.getElementById('client-phone').value,
                email: document.getElementById('client-email').value,
            };
            db.collection('klienci').add(data)
                .then(() => {
                    alert('Klient dodany pomyślnie!');
                    document.getElementById('client-form').reset();
                })
                .catch(error => console.error("Błąd dodawania klienta: ", error));
        });
    }

    // Formularz dodawania Maszyny
    const machineForm = document.getElementById('machine-form');
    if (machineForm) {
        machineForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const data = {
                nazwa: document.getElementById('machine-name').value,
                vin: document.getElementById('machine-vin').value,
                notes: document.getElementById('machine-notes').value,
            };
            db.collection('maszyny').add(data)
                .then(() => {
                    alert('Maszyna dodana pomyślnie!');
                    document.getElementById('machine-form').reset();
                })
                .catch(error => console.error("Błąd dodawania maszyny: ", error));
        });
    }
    
});