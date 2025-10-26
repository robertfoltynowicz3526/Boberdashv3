document.addEventListener('DOMContentLoaded', () => {

    // --- BAZA DANYCH (Twoje dane) ---
    // Zachowałem Twoje oryginalne dane i dodałem nowe pola:
    // czasJazdy, opis i historia[] do zleceń

    let clients = [
        { id: 1, name: "Klient A", address: "Adres A" },
        { id: 2, name: "Klient B", address: "Adres B" }
    ];

    let machines = [
        { id: 1, name: "Maszyna 1", location: "Lokalizacja 1" },
        { id: 2, name: "Maszyna 2", location: "Lokalizacja 2" }
    ];

    let zlecenia = [
        { id: 101, client: "Klient A", machine: "Maszyna 1", data: "2025-10-27", status: "nowe", czasJazdy: "30 min", opis: "Pilna naprawa", historia: [
            { data: "2025-10-25 10:00", user: "Admin", action: "Utworzono zlecenie." }
        ]},
        { id: 102, client: "Klient B", machine: "Maszyna 2", data: "2025-10-29", status: "nowe", czasJazdy: "1 godz 15 min", opis: "Przegląd okresowy", historia: [
            { data: "2025-10-26 14:30", user: "Admin", action: "Utworzono zlecenie." }
        ]},
        { id: 103, client: "Klient A", machine: "Maszyna 1", data: "2025-10-20", status: "zakonczone", czasJazdy: "30 min", opis: "Wymiana filtra", historia: [
             { data: "2025-10-19 09:00", user: "Admin", action: "Utworzono zlecenie." },
             { data: "2025-10-20 16:00", user: "Serwisant", action: "Oznaczono jako zakończone." }
        ]}
    ];

    // --- STAN APLIKACJI (dla kalendarza) ---
    const appState = {
        currentDate: new Date(),
    };

    // --- SELEKTORY DOM ---
    const zleceniaNoweLista = document.getElementById('nowe-zlecenia-lista');
    const zleceniaZakonczoneLista = document.getElementById('zakonczone-zlecenia-lista');
    const klienciLista = document.getElementById('klienci-lista');
    const maszynyLista = document.getElementById('maszyny-lista');
    
    const searchInput = document.getElementById('search-input');
    
    const zakonczoneHeader = document.getElementById('zakonczone-header');
    const zakonczoneContent = document.getElementById('zakonczone-content');

    const modal = document.getElementById('app-modal');
    const modalBackdrop = document.getElementById('modal-backdrop');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const modalTitle = document.getElementById('modal-title');
    const modalContent = document.getElementById('modal-content');

    const themeToggle = document.getElementById('theme-toggle');

    const monthYearDisplay = document.getElementById('month-year');
    const calendarGrid = document.getElementById('calendar-grid');
    const prevMonthBtn = document.getElementById('prev-month');
    const nextMonthBtn = document.getElementById('next-month');

    // --- FUNKCJE RENDERUJĄCE (nowe wersje Twoich 'display' funkcji) ---

    /**
     * Renderuje listy zleceń na podstawie filtra
     * @param {string} searchTerm - Fraza wyszukiwania
     */
    function renderOrders(searchTerm = '') {
        zleceniaNoweLista.innerHTML = '';
        zleceniaZakonczoneLista.innerHTML = '';

        const lowerCaseSearchTerm = searchTerm.toLowerCase();

        const filteredZlecenia = zlecenia.filter(z => 
            z.id.toString().includes(lowerCaseSearchTerm) ||
            z.client.toLowerCase().includes(lowerCaseSearchTerm) ||
            z.machine.toLowerCase().includes(lowerCaseSearchTerm)
        );

        let renderedNowe = 0;
        let renderedZakonczone = 0;

        filteredZlecenia.forEach(z => {
            const li = document.createElement('li');
            li.innerHTML = `
                <div class="zlecenie-info">
                    <strong>Zlecenie #${z.id}</strong>
                    <p>${z.client} - ${z.machine}</p>
                    <p>Data: ${z.data}</p>
                </div>
                <div class="zlecenie-actions">
                    <button class="btn btn-details" data-id="${z.id}">Szczegóły</button>
                </div>
            `;
            
            if (z.status === 'nowe') {
                zleceniaNoweLista.appendChild(li);
                renderedNowe++;
            } else {
                zleceniaZakonczoneLista.appendChild(li);
                renderedZakonczone++;
            }
        });

        // Obsługa pustych list
        if (renderedNowe === 0) {
            zleceniaNoweLista.innerHTML = `<li>Brak ${searchTerm ? 'wyników wyszukiwania' : 'nowych zleceń'}.</li>`;
        }
        if (renderedZakonczone === 0) {
            zleceniaZakonczoneLista.innerHTML = `<li>Brak ${searchTerm ? 'wyników wyszukiwania' : 'zakończonych zleceń'}.</li>`;
        }


        // Dodanie listenerów do przycisków "Szczegóły"
        document.querySelectorAll('.btn-details').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const orderId = parseInt(e.target.dataset.id);
                showOrderDetailsModal(orderId);
            });
        });
    }

    /**
     * Renderuje listę klientów
     */
    function renderClients() {
        klienciLista.innerHTML = '';
        clients.forEach(k => {
            const li = document.createElement('li');
            li.innerHTML = `
                <div class="item-info">
                    <strong>${k.name}</strong>
                    <p>${k.address}</p>
                </div>
                <button class="btn btn-edit" data-type="client" data-id="${k.id}">Edytuj</button>
            `;
            klienciLista.appendChild(li);
        });
    }

    /**
     * Renderuje listę maszyn
     */
    function renderMachines() {
        maszynyLista.innerHTML = '';
        machines.forEach(m => {
            const li = document.createElement('li');
            li.innerHTML = `
                <div class="item-info">
                    <strong>${m.name}</strong>
                    <p>${m.location}</p>
                </div>
                <button class="btn btn-edit" data-type="machine" data-id="${m.id}">Edytuj</button>
            `;
            maszynyLista.appendChild(li);
        });
    }

    // --- LOGIKA OKNA MODALNEGO ---

    function openModal() {
        modal.classList.remove('hidden');
        modalBackdrop.classList.remove('hidden');
    }

    function closeModal() {
        modal.classList.add('hidden');
        modalBackdrop.classList.add('hidden');
        modalTitle.innerHTML = '';
        modalContent.innerHTML = '';
    }

    /**
     * Wyświetla modal edycji klienta
     * @param {number} clientId - ID klienta
     */
    function showEditClientModal(clientId) {
        const client = clients.find(c => c.id === clientId);
        if (!client) return;

        modalTitle.innerText = 'Edytuj Klienta';
        modalContent.innerHTML = `
            <div class="modal-form-group">
                <label for="client-name">Nazwa</label>
                <input type="text" id="client-name" value="${client.name}">
            </div>
            <div class="modal-form-group">
                <label for="client-address">Adres</label>
                <input type="text" id="client-address" value="${client.address}">
            </div>
            <button class="btn btn-save" id="save-client-btn" data-id="${client.id}">Zapisz</button>
            <button class="btn btn-cancel" id="cancel-btn">Anuluj</button>
        `;
        openModal();

        document.getElementById('save-client-btn').addEventListener('click', saveClientData);
        document.getElementById('cancel-btn').addEventListener('click', closeModal);
    }

    /**
     * Wyświetla modal edycji maszyny
     * @param {number} machineId - ID maszyny
     */
    function showEditMachineModal(machineId) {
        const machine = machines.find(m => m.id === machineId);
        if (!machine) return;

        modalTitle.innerText = 'Edytuj Maszynę';
        modalContent.innerHTML = `
            <div class="modal-form-group">
                <label for="machine-name">Nazwa</label>
                <input type="text" id="machine-name" value="${machine.name}">
            </div>
            <div class="modal-form-group">
                <label for="machine-location">Lokalizacja</label>
                <input type="text" id="machine-location" value="${machine.location}">
            </div>
            <button class="btn btn-save" id="save-machine-btn" data-id="${machine.id}">Zapisz</button>
            <button class="btn btn-cancel" id="cancel-btn">Anuluj</button>
        `;
        openModal();

        document.getElementById('save-machine-btn').addEventListener('click', saveMachineData);
        document.getElementById('cancel-btn').addEventListener('click', closeModal);
    }

    /**
     * Wyświetla modal szczegółów zlecenia
     * @param {number} orderId - ID zlecenia
     */
    function showOrderDetailsModal(orderId) {
        const order = zlecenia.find(z => z.id === orderId);
        if (!order) return;

        modalTitle.innerText = `Szczegóły Zlecenia #${order.id}`;
        
        // Generowanie historii
        let historyHtml = order.historia.map(h => `
            <div class="order-history-item">
                <span class="date">[${h.data}]</span> ${h.user}: ${h.action}
            </div>
        `).join('');

        modalContent.innerHTML = `
            <div class="order-details-group">
                <strong>Klient:</strong>
                <p>${order.client}</p>
            </div>
            <div class="order-details-group">
                <strong>Maszyna:</strong>
                <p>${order.machine}</p>
            </div>
            <div class="order-details-group">
                <strong>Data zlecenia:</strong>
                <p>${order.data}</p>
            </div>
             <div class="order-details-group">
                <strong>Szacowany czas jazdy:</strong>
                <p>${order.czasJazdy}</p>
            </div>
            <div class="order-details-group">
                <strong>Opis:</strong>
                <p>${order.opis}</p>
            </div>
            <div class="order-details-group">
                <strong>Status:</strong>
                <p class="zlecenie-status ${order.status}">${order.status}</p>
            </div>
            <div class="order-history">
                <h4>Historia zlecenia</h4>
                ${historyHtml}
            </div>
        `;
        openModal();
    }

    // --- LOGIKA ZAPISU DANYCH ---

    function saveClientData(e) {
        const clientId = parseInt(e.target.dataset.id);
        const newName = document.getElementById('client-name').value;
        const newAddress = document.getElementById('client-address').value;

        // Znajdź starą nazwę *przed* aktualizacją
        const oldName = clients.find(c => c.id === clientId)?.name;

        // Aktualizacja w "bazie danych" klientów
        clients = clients.map(c => 
            c.id === clientId ? { ...c, name: newName, address: newAddress } : c
        );

        // Aktualizacja zleceń, jeśli nazwa klienta się zmieniła (dla spójności)
        if (oldName && oldName !== newName) {
            zlecenia = zlecenia.map(z => 
                z.client === oldName ? { ...z, client: newName } : z
            );
        }

        renderClients();
        renderOrders(searchInput.value); // Odśwież zlecenia na wypadek zmiany nazwy
        renderCalendar(); // Odśwież kalendarz
        closeModal();
    }

    function saveMachineData(e) {
        const machineId = parseInt(e.target.dataset.id);
        const newName = document.getElementById('machine-name').value;
        const newLocation = document.getElementById('machine-location').value;

        // Znajdź starą nazwę *przed* aktualizacją
        const oldName = machines.find(m => m.id === machineId)?.name;

        // Aktualizacja w "bazie danych" maszyn
        machines = machines.map(m => 
            m.id === machineId ? { ...m, name: newName, location: newLocation } : m
        );
        
        // Aktualizacja zleceń, jeśli nazwa maszyny się zmieniła
         if (oldName && oldName !== newName) {
            zlecenia = zlecenia.map(z => 
                z.machine === oldName ? { ...z, machine: newName } : z
            );
        }

        renderMachines();
        renderOrders(searchInput.value);
        renderCalendar();
        closeModal();
    }

    // --- LOGIKA KALENDARZA ---

    function renderCalendar() {
        const year = appState.currentDate.getFullYear();
        const month = appState.currentDate.getMonth();
        
        const monthNames = ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"];
        monthYearDisplay.innerText = `${monthNames[month]} ${year}`;

        calendarGrid.innerHTML = '';
        
        // Dni tygodnia
        const daysOfWeek = ['Nie', 'Pon', 'Wto', 'Śro', 'Czw', 'Pia', 'Sob'];
        daysOfWeek.forEach(day => {
            calendarGrid.innerHTML += `<div class="calendar-day-header">${day}</div>`;
        });

        // Obliczenie pierwszego dnia miesiąca (0 = Niedziela, 1 = Poniedziałek, itd.)
        // Dostosowanie do polskiego standardu (Poniedziałek jako pierwszy)
        let firstDayOfMonth = new Date(year, month, 1).getDay();
        if (firstDayOfMonth === 0) firstDayOfMonth = 6; // Niedziela staje się '6'
        else firstDayOfMonth = firstDayOfMonth - 1; // Reszta przesuwa się o -1

        const daysInMonth = new Date(year, month + 1, 0).getDate();

        // Puste komórki przed 1. dniem miesiąca
        for (let i = 0; i < firstDayOfMonth; i++) {
            calendarGrid.innerHTML += `<div class="calendar-day other-month"></div>`;
        }

        // Komórki dni miesiąca
        for (let day = 1; day <= daysInMonth; day++) {
            const dayDate = new Date(year, month, day);
            const isoDate = dayDate.toISOString().split('T')[0]; // Format YYYY-MM-DD
            
            let todayClass = '';
            const today = new Date();
            if (day === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
                todayClass = 'today';
            }

            calendarGrid.innerHTML += `
                <div class="calendar-day ${todayClass}" data-date="${isoDate}">
                    <div class="calendar-day-number">${day}</div>
                    <div class="calendar-events"></div>
                </div>
            `;
        }
        
        populateCalendarWithEvents();
    }

    function populateCalendarWithEvents() {
        zlecenia.forEach(zlecenie => {
            const cell = calendarGrid.querySelector(`.calendar-day[data-date="${zlecenie.data}"]`);
            if (cell) {
                const eventContainer = cell.querySelector('.calendar-events');
                const eventDiv = document.createElement('div');
                eventDiv.classList.add('calendar-event', zlecenie.status);
                eventDiv.title = `Zlecenie #${zlecenie.id}: ${zlecenie.opis}`;
                eventDiv.innerHTML = `
                    #${zlecenie.id}
                    <span class="travel-time">(${zlecenie.czasJazdy})</span>
                `;
                eventContainer.appendChild(eventDiv);
            }
        });
    }

    function changeMonth(offset) {
        appState.currentDate.setMonth(appState.currentDate.getMonth() + offset);
        renderCalendar();
    }

    // --- LOGIKA CIEMNEGO MOTYWU ---

    function applyTheme(theme) {
        if (theme === 'dark') {
            document.body.dataset.theme = 'dark';
            themeToggle.checked = true;
        } else {
            delete document.body.dataset.theme;
            themeToggle.checked = false;
        }
    }

    function toggleTheme() {
        const newTheme = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('dashboardTheme', newTheme);
        applyTheme(newTheme);
    }

    // --- EVENT LISTENERS (NASŁUCHIWANIE) ---

    // Wyszukiwarka
    searchInput.addEventListener('input', (e) => {
        renderOrders(e.target.value);
    });

    // Zwijanie sekcji
    zakonczoneHeader.addEventListener('click', () => {
        zakonczoneContent.classList.toggle('collapsed');
        zakonczoneHeader.classList.toggle('collapsed');
    });

    // Zamykanie Modala
    modalCloseBtn.addEventListener('click', closeModal);
    modalBackdrop.addEventListener('click', closeModal);

    // Przyciski Edycji (delegacja zdarzeń)
    document.body.addEventListener('click', (e) => {
        // Wyszukiwanie przycisku, nawet jeśli kliknięto ikonę wewnątrz
        const editButton = e.target.closest('.btn-edit'); 
        if (editButton) {
            const type = editButton.dataset.type;
            const id = parseInt(editButton.dataset.id);
            if (type === 'client') {
                showEditClientModal(id);
            } else if (type === 'machine') {
                showEditMachineModal(id);
            }
        }
    });

    // Przełącznik motywu
    themeToggle.addEventListener('change', toggleTheme);

    // Nawigacja kalendarza
    prevMonthBtn.addEventListener('click', () => changeMonth(-1));
    nextMonthBtn.addEventListener('click', () => changeMonth(1));

    // --- INICJALIZACJA APLIKACJI ---

    function init() {
        // Ustaw domyślny stan zwinięcia
        zakonczoneContent.classList.add('collapsed');
        zakonczoneHeader.classList.add('collapsed');

        // Załaduj motyw
        const savedTheme = localStorage.getItem('dashboardTheme') || 'light';
        applyTheme(savedTheme);

        // Pierwsze renderowanie
        renderOrders();
        renderClients();
        renderMachines();
        renderCalendar();
    }

    init(); // Uruchomienie aplikacji
});

    init(); // Uruchomienie aplikacji
});