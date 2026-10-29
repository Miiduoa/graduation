// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { installCampusRelayFetch, readCampusHttpSetter } from './puCampusRelayInstall';

const RELAY_ENV = {
  PU_EDGE_RELAY_URL: 'https://pu-edge-relay.example.workers.dev',
  PU_EDGE_RELAY_SECRET: 'unit-test-secret',
};

it('installs the shared fetch only when both relay env vars are set', () => {
  const fetchLike = vi.fn();
  const setter = vi.fn();
  installCampusRelayFetch(setter, fetchLike, RELAY_ENV);
  expect(setter).toHaveBeenCalledWith(fetchLike);
});

it('does not inject fetch when relay is off so scrapers keep https.request', () => {
  const setter = vi.fn();
  installCampusRelayFetch(setter, vi.fn(), {});
  expect(setter).not.toHaveBeenCalled();
  installCampusRelayFetch(setter, vi.fn(), { PU_EDGE_RELAY_URL: RELAY_ENV.PU_EDGE_RELAY_URL });
  expect(setter).not.toHaveBeenCalled();
});

it('ignores missing setters so mocked scrapers stay unchanged', () => {
  expect(() => installCampusRelayFetch(undefined, vi.fn(), RELAY_ENV)).not.toThrow();
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
