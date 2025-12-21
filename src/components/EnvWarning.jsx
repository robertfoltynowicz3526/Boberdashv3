export default function EnvWarning({ list }) {
  if (!list?.length) return null;
  const container = document.createElement('div');
  container.style.background = '#8a2b2b';
  container.style.color = '#fff';
  container.style.padding = '8px 12px';
  container.style.fontSize = '14px';
  container.style.borderRadius = '8px';
  container.style.margin = '8px 0';
  container.textContent = `Brak konfiguracji Firebase: ${list.join(', ')} — dane nie zostaną pobrane.`;
  return container;
}
