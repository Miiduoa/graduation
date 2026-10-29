// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { installCampusRelayFetch, readCampusHttpSetter } from './puCampusRelayInstall';

it('installs the shared fetch when the setter exists', () => {
  const fetchLike = vi.fn();
  const setter = vi.fn();
  installCampusRelayFetch(setter, fetchLike);
  expect(setter).toHaveBeenCalledWith(fetchLike);
});

it('ignores missing setters so mocked scrapers stay unchanged', () => {
  expect(() => installCampusRelayFetch(undefined, vi.fn())).not.toThrow();
});

it('reads a setter when present and swallows vitest missing-export access', () => {
  const setter = vi.fn();
  expect(readCampusHttpSetter({ setCampusHttpFetch: setter })).toBe(setter);
  expect(
    readCampusHttpSetter(
      new Proxy(
        {},
        {
          get() {
            throw new Error('No "setCampusHttpFetch" export is defined');
          },
        },
      ),
    ),
  ).toBeUndefined();
});
