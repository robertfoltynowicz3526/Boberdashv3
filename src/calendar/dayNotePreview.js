let activePreview;

export function dismissDayNotePreview(anchor) {
  if (!activePreview || (anchor !== undefined && activePreview.anchor !== anchor)) return;
  activePreview.anchor.removeAttribute('aria-describedby');
  activePreview.tooltip.remove();
  activePreview.listeners.abort();
  activePreview = undefined;
}

function positionDayNotePreview(anchor, tooltip) {
  const margin = 8;
  const target = anchor.getBoundingClientRect();
  const { width, height } = tooltip.getBoundingClientRect();
  const { clientWidth, clientHeight } = document.documentElement;
  if (!anchor.isConnected || target.bottom <= 0 || target.top >= clientHeight
      || target.right <= 0 || target.left >= clientWidth) {
    dismissDayNotePreview(anchor);
    return;
  }
  const below = target.bottom + margin;
  const top = below + height <= clientHeight - margin ? below : target.top - margin - height;
  tooltip.style.left = `${Math.max(margin, Math.min(target.left, clientWidth - width - margin))}px`;
  tooltip.style.top = `${Math.max(margin, Math.min(top, clientHeight - height - margin))}px`;
}

function showDayNotePreview(anchor, note) {
  if (activePreview?.anchor === anchor) return;
  dismissDayNotePreview();

  const tooltip = document.createElement('div');
  tooltip.id = 'calendar-day-note-preview';
  tooltip.className = 'calendar-day-note-preview';
  tooltip.setAttribute('role', 'tooltip');
  const text = document.createElement('div');
  text.textContent = note;
  tooltip.append(text);
  document.body.append(tooltip);

  anchor.setAttribute('aria-describedby', tooltip.id);
  const listeners = new AbortController();
  activePreview = { anchor, tooltip, listeners };
  const { signal } = listeners;
  const updatePosition = () => positionDayNotePreview(anchor, tooltip);
  updatePosition();
  window.addEventListener('scroll', updatePosition, { capture: true, signal });
  window.addEventListener('resize', updatePosition, { signal });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') dismissDayNotePreview(anchor);
  }, { signal });
}

export function createDayNoteButton(day, note) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cell-note-badge';
  button.setAttribute('aria-label', 'Notatka dnia');

  const icon = document.createElement('span');
  icon.className = 'cell-note-badge__icon';
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon);

  button.addEventListener('pointerenter', () => showDayNotePreview(button, note));
  button.addEventListener('focus', () => showDayNotePreview(button, note));
  button.addEventListener('pointerleave', () => {
    if (!button.matches(':focus')) dismissDayNotePreview(button);
  });
  button.addEventListener('blur', () => {
    if (!button.matches(':hover')) dismissDayNotePreview(button);
  });
  // FullCalendar starts tracking day clicks and selections on mousedown/touchstart.
  for (const type of ['pointerdown', 'mousedown', 'touchstart']) {
    button.addEventListener(type, event => event.stopPropagation());
  }
  button.addEventListener('click', event => {
    event.stopPropagation();
    dismissDayNotePreview(button);
    button.dispatchEvent(new CustomEvent('calendar:open-note', { bubbles: true, detail: day }));
  });
  return button;
}
