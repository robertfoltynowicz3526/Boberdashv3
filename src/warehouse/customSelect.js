const instances = new Set();

export const createWarehouseCustomSelect = (select) => {
    if (!select || select.dataset.customSelectReady === 'true') return null;

    const wrapper = document.createElement('div');
    wrapper.className = 'warehouse-custom-select';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'warehouse-custom-select__trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const list = document.createElement('div');
    list.className = 'warehouse-custom-select__options';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    select.insertAdjacentElement('afterend', wrapper);
    wrapper.append(trigger, list);
    select.classList.add('warehouse-custom-select__native');
    select.tabIndex = -1;
    select.dataset.customSelectReady = 'true';

    const instance = {
        close() {
            list.hidden = true;
            wrapper.classList.remove('is-open');
            trigger.setAttribute('aria-expanded', 'false');
        },
        refresh() {
            const options = [...select.options];
            const selected = options.find((option) => option.value === select.value) || options[0];
            trigger.textContent = selected?.textContent || '';
            trigger.disabled = select.disabled;
            list.replaceChildren(...options.map((option) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'warehouse-custom-select__option';
                button.setAttribute('role', 'option');
                button.textContent = option.textContent;
                button.disabled = option.disabled;
                button.tabIndex = -1;
                const isSelected = option.value === select.value;
                button.classList.toggle('is-selected', isSelected);
                button.setAttribute('aria-selected', String(isSelected));
                button.addEventListener('click', () => {
                    select.value = option.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    instance.refresh();
                    instance.close();
                    trigger.focus();
                });
                return button;
            }));
        }
    };

    const enabledOptions = () => [...list.querySelectorAll('.warehouse-custom-select__option:not(:disabled)')];
    const open = () => {
        if (select.disabled) return;
        instances.forEach((other) => { if (other !== instance) other.close(); });
        instance.refresh();
        list.hidden = false;
        wrapper.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
    };
    const focusRelativeOption = (offset) => {
        const options = enabledOptions();
        const current = options.indexOf(document.activeElement);
        options[Math.max(0, Math.min(current + offset, options.length - 1))]?.focus();
    };

    trigger.addEventListener('click', () => list.hidden ? open() : instance.close());
    trigger.addEventListener('keydown', (event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        open();
        const options = enabledOptions();
        const selectedIndex = options.findIndex((option) => option.getAttribute('aria-selected') === 'true');
        options[event.key === 'End' ? options.length - 1 : Math.max(0, selectedIndex)]?.focus();
    });
    list.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            focusRelativeOption(event.key === 'ArrowDown' ? 1 : -1);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            instance.close();
            trigger.focus();
        }
    });
    select.addEventListener('change', instance.refresh);
    select.addEventListener('invalid', (event) => {
        event.preventDefault();
        trigger.focus();
        open();
    });
    select.closest('.form-group')?.querySelector(`label[for="${select.id}"]`)?.addEventListener('click', (event) => {
        event.preventDefault();
        trigger.focus();
        open();
    });
    document.addEventListener('pointerdown', (event) => {
        if (!wrapper.contains(event.target)) instance.close();
    });
    new MutationObserver(instance.refresh).observe(select, { childList: true, subtree: true });
    instances.add(instance);
    instance.refresh();
    return instance;
};

export const initWarehouseCustomSelects = (root = document) => {
    root.querySelectorAll('[data-warehouse-custom-select]').forEach(createWarehouseCustomSelect);
};
