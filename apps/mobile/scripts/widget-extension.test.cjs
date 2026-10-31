const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const xcode = require('xcode');
const plist = require('@expo/plist').default;
const { configureProject } = require('../src/widgets/expo-widget-plugin');
const root = resolve(__dirname, '..');
test('extension is embedded once, has an independent source phase, and regenerates matching identities', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'next-class-project-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const project = xcode.project(join(root, 'ios/mobile.xcodeproj/project.pbxproj'));
  project.parseSync();
  configureProject(project, directory, 'com.example.sample', 'group.com.example.sample');
  const first = project.writeSync();
  configureProject(project, directory, 'com.example.sample', 'group.com.example.sample');
  assert.equal(project.writeSync(), first);
  const objects = project.hash.project.objects;
  const targets = Object.entries(objects.PBXNativeTarget).filter(
    ([, value]) => typeof value === 'object',
  );
  assert.equal(targets.length, 2);
  const [id, target] = targets.find(([, value]) => value.name === '"CampusWidgetExtension"');
  const configs = objects.XCConfigurationList[target.buildConfigurationList].buildConfigurations;
  for (const { value } of configs) {
    const settings = objects.XCBuildConfiguration[value].buildSettings;
    assert.equal(settings.PRODUCT_BUNDLE_IDENTIFIER, '"com.example.sample.widget"');
    assert.equal(settings.APPLICATION_EXTENSION_API_ONLY, 'YES');
    assert.equal(settings.IPHONEOS_DEPLOYMENT_TARGET, '16.0');
  }
  const app = project.getFirstTarget().firstTarget;
  assert.ok(app.dependencies.some(({ value }) => objects.PBXTargetDependency[value].target === id));
  const copy = Object.values(objects.PBXCopyFilesBuildPhase).find(
    (value) => value?.dstSubfolderSpec === 13,
  );
  assert.equal(copy.files.length, 1);
  assert.ok(app.buildPhases.some(({ value }) => objects.PBXCopyFilesBuildPhase[value] === copy));
  const source = Object.values(objects.PBXFileReference).find(
    (value) => value?.name === '"CampusWidget.swift"',
  );
  assert.equal(source.path, '"CampusWidget.swift"');
  const extension = join(directory, 'CampusWidgetExtension');
  assert.ok(existsSync(join(extension, 'CampusWidget.swift')));
  assert.equal(
    readFileSync(join(extension, 'CampusWidget.swift'), 'utf8'),
    readFileSync(join(root, 'ios-widget/CampusWidget.swift'), 'utf8'),
  );
  assert.equal(
    plist.parse(readFileSync(join(extension, 'Info.plist'), 'utf8')).NextClassAppGroup,
    'group.com.example.sample',
  );
  assert.deepEqual(
    plist.parse(readFileSync(join(extension, 'CampusWidgetExtension.entitlements'), 'utf8'))[
      'com.apple.security.application-groups'
    ],
    ['group.com.example.sample'],
  );
});
test('a project without an extension gets a source phase, dependency and embedded product', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'next-class-new-project-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const project = xcode.project(join(root, 'ios/mobile.xcodeproj/project.pbxproj'));
  project.parseSync();
  const objects = project.hash.project.objects;
  for (const [id, target] of Object.entries(objects.PBXNativeTarget)) {
    if (target?.name === '"CampusWidgetExtension"') {
      delete objects.PBXNativeTarget[id];
      delete objects.PBXNativeTarget[`${id}_comment`];
      project.getFirstProject().firstProject.targets = project
        .getFirstProject()
        .firstProject.targets.filter((ref) => ref.value !== id);
    }
  }
  project.getFirstTarget().firstTarget.dependencies = [];
  delete objects.PBXTargetDependency;
  delete objects.PBXContainerItemProxy;
  configureProject(project, directory, 'com.example.fresh', 'group.com.example.fresh');
  const target = Object.values(objects.PBXNativeTarget).find(
    (value) => value?.name === '"CampusWidgetExtension"',
  );
  assert.ok(
    target.buildPhases.some(({ value }) => objects.PBXSourcesBuildPhase[value]?.files.length === 1),
  );
  assert.equal(project.getFirstTarget().firstTarget.dependencies.length, 1);
});

test('extension follows the app plist version rather than stale build settings', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'next-class-version-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'mobile'));
  const versions = { CFBundleShortVersionString: '2.3.4', CFBundleVersion: '56' };
  writeFileSync(join(directory, 'mobile/Info.plist'), plist.build(versions));
  const project = xcode.project(join(root, 'ios/mobile.xcodeproj/project.pbxproj'));
  project.parseSync();
  configureProject(project, directory, 'com.example.sample', 'group.com.example.sample');
  const info = plist.parse(readFileSync(join(directory, 'CampusWidgetExtension/Info.plist'), 'utf8'));
  for (const key of Object.keys(versions)) assert.equal(info[key], versions[key]);
});
test('checked-in app and extension versions match', () => {
  const app = plist.parse(readFileSync(join(root, 'ios/mobile/Info.plist'), 'utf8'));
  const extension = plist.parse(readFileSync(join(root, 'ios/CampusWidgetExtension/Info.plist'), 'utf8'));
  for (const key of ['CFBundleShortVersionString', 'CFBundleVersion']) assert.equal(extension[key], app[key]);
});
