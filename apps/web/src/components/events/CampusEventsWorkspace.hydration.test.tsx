import { act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import {
  campusEventShortlistKey,
  createCampusEventShortlistStore,
} from '@campus/shared/src/campusEventShortlist';
import { CampusEventsWorkspace } from './CampusEventsWorkspace';

vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('@/lib/campusEvents', async () => ({
  ...(await vi.importActual<typeof import('@/lib/campusEvents')>('@/lib/campusEvents')),
  loadCampusEventPage: vi.fn(() => new Promise(() => undefined)),
}));

it('server-renders the saved view without device data and hydrates it without a mismatch', async () => {
  const schoolId = 'hydration-school';
  await createCampusEventShortlistStore({
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
  }).setSaved(campusEventShortlistKey(schoolId, null), {
    schoolId, id: 'talk', source: 'school-events', title: '裝置上的收藏',
  }, true);
  window.history.replaceState(null, '', `/events?schoolId=${schoolId}&saved=1`);
  const tree = (
    <CampusEventsWorkspace schoolId={schoolId} schoolSearch={`?schoolId=${schoolId}`}
      initialFilters={{ q: '', view: 'all', saved: true }} />
  );
  const html = renderToString(tree);
  expect(html).not.toContain('裝置上的收藏');
  expect(html).not.toContain('還沒有收藏的活動');

  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.append(container);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    await act(async () => { hydrateRoot(container, tree); });
    expect(errors).not.toHaveBeenCalled();
    expect(container.textContent).toContain('裝置上的收藏');
  } finally {
    errors.mockRestore();
    container.remove();
  }
});
