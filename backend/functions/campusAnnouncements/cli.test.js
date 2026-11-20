'use strict';

const { parseCli, runCli } = require('./cli');
const { resetPoliteFetch } = require('./politeFetch');

function htmlResponse(html, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => html,
  };
}

beforeEach(() => resetPoliteFetch());

test('defaults to dry-run and requires a school or --all', () => {
  expect(parseCli(['--school', 'pu'])).toEqual({
    schoolId: 'pu',
    all: false,
    write: false,
    dryRun: true,
  });
  expect(parseCli(['--all'])).toEqual({ schoolId: '', all: true, write: false, dryRun: true });
  expect(parseCli(['--school', 'pu', '--write', '--dry-run'])).toMatchObject({
    write: false,
    dryRun: true,
  });
  expect(() => parseCli([])).toThrow('--school');
});

test('write stays off unless the enable flag is set', async () => {
  await expect(
    runCli(['--school', 'pu', '--write'], { env: {}, db: { docs: new Map() } }),
  ).rejects.toThrow('寫入已關閉');
});

test('dry-run of a school does not open Firestore', async () => {
  const getDb = jest.fn();
  const result = await runCli(['--school', 'pu'], {
    getDb,
    fetchImpl: async (url) =>
      String(url).endsWith('robots.txt')
        ? htmlResponse('User-agent: *\nAllow: /\n')
        : htmlResponse('<table><tr><td><a href="/p/412-1042-1.php">選課</a></td><td>2026-10-01</td></tr></table>'),
    now: () => 1,
    wait: async () => {},
  });
  expect(getDb).not.toHaveBeenCalled();
  expect(result.schoolId).toBe('pu');
  expect(result.dryRun).toBe(true);
  expect(result.sources).toHaveLength(7);
});
