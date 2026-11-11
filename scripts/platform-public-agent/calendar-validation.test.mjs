import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const { publicSnapshot } = await import(
  pathToFileURL(join(process.env.PLATFORM_AGENT_COMPILED, 'navigation.js')).href
);

const catalog = (updatedAt) => ({
  schoolId: 'pu',
  updatedAt,
  label: '合成測試來源',
  places: [],
});

test('public catalog accepts real Gregorian dates including leap days', () => {
  for (const date of ['2024-02-29', '2000-02-29', '2026-02-28', '2026-12-31']) {
    assert.equal(publicSnapshot(catalog(date), 'pu').updatedAt, date);
  }
});

test('public catalog rejects normalized or otherwise invalid calendar dates', () => {
  for (const date of [
    '2026-02-29',
    '2026-02-30',
    '1900-02-29',
    '2026-04-31',
    '2026-00-10',
    '2026-13-01',
    '2026-01-00',
    '2026-2-01',
  ]) {
    assert.throws(
      () => publicSnapshot(catalog(date), 'pu'),
      (error) => error.code === 'PUBLIC_AGENT_SOURCE_UNAVAILABLE',
      date,
    );
  }
});
