import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { assertMaestroEmulatorConfig } from '../../apps/mobile/e2e/emulatorConfig.ts';

const valid = {
  appEnv: 'development', maestro: '1', useEmulator: '1', projectId: 'demo-campus-one',
  host: '127.0.0.1', authPort: '19291', firestorePort: '18291',
  allowMockAuth: false, universalDevAccounts: false,
};

test('permits only the dedicated development emulator build', () => {
  assert.doesNotThrow(() => assertMaestroEmulatorConfig(valid));
});
for (const [key, values] of Object.entries({
  appEnv: [undefined, 'preview', 'production'], maestro: [undefined, '0'],
  useEmulator: [undefined, 'false'], projectId: ['campus-one-tw', 'demo-other'],
  host: ['example.com', '0.0.0.0', '127.0.0.1.example.com'],
  authPort: [undefined, '9099'], firestorePort: [undefined, '8080'],
  allowMockAuth: [undefined, true], universalDevAccounts: [undefined, true],
})) {
  for (const value of values) test(`rejects unsafe ${key}: ${String(value)}`, () => {
    assert.throws(() => assertMaestroEmulatorConfig({ ...valid, [key]: value }));
  });
}
test('normal entrypoint does not import the Maestro authentication harness', () => {
  const app = JSON.parse(readFileSync('apps/mobile/package.json', 'utf8'));
  assert.equal(app.main, 'index.ts');
  assert.doesNotMatch(readFileSync('apps/mobile/index.ts', 'utf8'), /index\.maestro|e2e\/|MaestroApp/);
  assert.doesNotMatch(readFileSync('apps/mobile/App.tsx', 'utf8'), /index\.maestro|MaestroApp|maestro-emulator-login|maestro-open-emulator-login/);
});

test('Maestro entrypoint registers the overlay harness instead of a native modal', () => {
  const entry = readFileSync('apps/mobile/index.maestro.ts', 'utf8');
  const harness = readFileSync('apps/mobile/e2e/MaestroApp.tsx', 'utf8');
  const loginFlow = readFileSync('apps/mobile/.maestro/helpers/open-emulator-login.yaml', 'utf8');
  const linking = readFileSync('apps/mobile/src/app/maestroHarnessLink.ts', 'utf8');
  assert.match(entry, /registerRootComponent\(MaestroApp\)/);
  assert.match(harness, /testID="maestro-emulator-login"/);
  assert.match(harness, /testID="maestro-open-emulator-login"/);
  assert.doesNotMatch(harness, /\bModal\b/);
  assert.doesNotMatch(harness, /expo-linking|addEventListener|getInitialURL/);
  assert.match(loginFlow, /maestro-open-emulator-login/);
  assert.doesNotMatch(loginFlow, /openLink/);
  assert.match(linking, /campus:\/\/maestro\/sign-in/);
});

test('campus link helper confirms iOS custom-scheme sheets and re-opens after the sheet', () => {
  const helper = readFileSync('apps/mobile/.maestro/helpers/open-campus-link.yaml', 'utf8');
  const exact = /^(Open|打開|開啟)$/;
  const title = /^Open in nuni/;
  assert.match(helper, /openLink:/);
  assert.match(helper, /text: '\^\(Open\|打開\|開啟\)\$'/);
  assert.match(helper, /text: '\^Open in nuni'/);
  assert.equal((helper.match(/openLink:/g) || []).length, 2);
  assert.match(helper, /waitForAnimationToEnd/);
  for (const label of ['Open', '打開', '開啟']) assert.match(label, exact);
  assert.doesNotMatch('Open in nuni?', exact);
  assert.match('Open in nuni?', title);
  assert.doesNotMatch('Cancel', exact);
  assert.doesNotMatch('取消', exact);
});

test('authentication retry asserts the replacement fixture before the second submit', () => {
  const flow = readFileSync('apps/mobile/.maestro/flows/02_authentication.yaml', 'utf8');
  assert.match(flow, /clearText/);
  assert.match(flow, /id: maestro-password[\s\S]*text: '\^campus-test-1234\$'/);
  assert.match(flow, /id: tab-Today/);
});

test('announcements flow still requires the public bulletin copy after the campus link', () => {
  const flow = readFileSync('apps/mobile/.maestro/flows/03_announcements.yaml', 'utf8');
  assert.match(flow, /CAMPUS_LINK: campus:\/\/announcements/);
  assert.match(flow, /公開處室公告的摘要與原文連結。一般帳號即可查看。/);
  assert.match(flow, /waitForAnimationToEnd/);
});
