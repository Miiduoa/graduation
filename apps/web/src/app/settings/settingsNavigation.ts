export type SettingsSection = 'general' | 'notifications' | 'appearance' | 'privacy' | 'account';

const sections = new Set<SettingsSection>([
  'general',
  'notifications',
  'appearance',
  'privacy',
  'account',
]);
const sectionChangeEvent = 'campus-settings-section-change';

export function validSettingsSection(value: string | null | undefined): SettingsSection {
  return sections.has(value as SettingsSection) ? (value as SettingsSection) : 'general';
}

export function currentSettingsSection(): SettingsSection {
  return validSettingsSection(new URLSearchParams(window.location.search).get('section'));
}

export function subscribeSettingsSection(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  window.addEventListener(sectionChangeEvent, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(sectionChangeEvent, onChange);
  };
}

export function navigateSettingsSection(section: SettingsSection) {
  const url = new URL(window.location.href);
  if (section === 'general') url.searchParams.delete('section');
  else url.searchParams.set('section', section);
  const destination = `${url.pathname}${url.search}${url.hash}`;
  if (destination === `${window.location.pathname}${window.location.search}${window.location.hash}`)
    return;
  window.history.pushState(null, '', destination);
  window.dispatchEvent(new Event(sectionChangeEvent));
}
