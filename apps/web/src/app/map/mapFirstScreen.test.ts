import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  MAP_FIRST_SCREEN_CHROME_PX,
  MAP_FIRST_SCREEN_MIN_MAP_PX,
  MAP_FIRST_SCREEN_VIEWPORTS,
  mapFitsFirstScreen,
  mapFirstScreenMetrics,
} from './mapFirstScreen';

const css = readFileSync(path.join(__dirname, 'map.module.css'), 'utf8');
const shellCss = readFileSync(path.join(__dirname, '../../app/home.module.css'), 'utf8');

it('keeps the CSS first-screen budget aligned with the layout contract', () => {
  expect(css).toContain(`--map-first-screen-chrome: ${MAP_FIRST_SCREEN_CHROME_PX}px`);
  expect(css).toContain(
    `height: max(${MAP_FIRST_SCREEN_MIN_MAP_PX}px, calc(100dvh - var(--map-first-screen-chrome)))`,
  );
  expect(css).not.toMatch(/\.map \{\s*height: 300px;/);
  expect(shellCss).toContain('.headingMap');
  expect(shellCss).toContain('.mainMap');
});

it('leaves at least 240px of map on 390×844 and 350px-wide 844px phones', () => {
  for (const viewport of MAP_FIRST_SCREEN_VIEWPORTS) {
    expect(mapFitsFirstScreen(viewport.height), viewport.name).toBe(true);
    const metrics = mapFirstScreenMetrics(viewport.height);
    expect(metrics.mapTop).toBeLessThan(viewport.height);
    expect(metrics.visibleMapPx).toBeGreaterThanOrEqual(MAP_FIRST_SCREEN_MIN_MAP_PX);
  }
});
