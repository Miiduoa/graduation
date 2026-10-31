const { withXcodeProject, withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');
const plist = require('@expo/plist').default;
const NAME = 'CampusWidgetExtension';

function configureProject(project, iosRoot, bundleId, group) {
  const directory = path.join(iosRoot, NAME);
  fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '../../ios-widget/CampusWidget.swift'),
    path.join(directory, 'CampusWidget.swift'),
  );
  const main = project.getFirstTarget();
  const infoPath = path.join(iosRoot, 'mobile/Info.plist');
  const appInfo = fs.existsSync(infoPath) ? plist.parse(fs.readFileSync(infoPath, 'utf8')) : {};
  const objects = project.hash.project.objects;
  objects.PBXTargetDependency ||= {};
  objects.PBXContainerItemProxy ||= {};
  let targetId = Object.keys(objects.PBXNativeTarget).find(
    (key) => objects.PBXNativeTarget[key]?.name?.replaceAll('"', '') === NAME,
  );
  if (!targetId) {
    targetId = project.addTarget(NAME, 'app_extension', NAME, `${bundleId}.widget`).uuid;
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', targetId);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', targetId);
    const groupRef = project.addPbxGroup([], NAME, NAME);
    project.addToPbxGroup(groupRef.uuid, project.getFirstProject().firstProject.mainGroup);
    const source = project.addSourceFile(
      `${NAME}/CampusWidget.swift`,
      { target: targetId },
      groupRef.uuid,
    );
    objects.PBXFileReference[source.fileRef].path = '"CampusWidget.swift"';
    for (const reference of Object.values(objects.PBXFileReference)) {
      if (reference && typeof reference === 'object') {
        for (const key of Object.keys(reference))
          if (reference[key] === undefined) delete reference[key];
      }
    }
  }
  if (
    !main.firstTarget.dependencies.some(
      ({ value }) => objects.PBXTargetDependency[value]?.target === targetId,
    )
  ) {
    project.addTargetDependency(main.uuid, [targetId]);
  }
  const target = objects.PBXNativeTarget[targetId];
  if (!target.buildPhases.some(({ value }) => objects.PBXResourcesBuildPhase?.[value])) {
    const phase = project.addBuildPhase(
      [`${NAME}/PrivacyInfo.xcprivacy`],
      'PBXResourcesBuildPhase',
      'Resources',
      targetId,
    );
    const groupKey = Object.keys(objects.PBXGroup).find(
      (key) => objects.PBXGroup[key]?.name === NAME,
    );
    const buildFile = objects.PBXBuildFile[phase.buildPhase.files[0].value];
    const reference = objects.PBXFileReference[buildFile.fileRef];
    reference.path = '"PrivacyInfo.xcprivacy"';
    reference.lastKnownFileType = 'text.xml';
    delete reference.fileEncoding;
    delete reference.explicitFileType;
    project.addToPbxGroup(
      { fileRef: buildFile.fileRef, basename: 'PrivacyInfo.xcprivacy' },
      groupKey,
    );
  }
  fs.writeFileSync(
    path.join(directory, 'PrivacyInfo.xcprivacy'),
    plist.build({
      NSPrivacyTracking: false,
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['1C8F.1'],
        },
      ],
    }),
  );
  const mainList = objects.XCConfigurationList[main.firstTarget.buildConfigurationList];
  const extensionList = objects.XCConfigurationList[target.buildConfigurationList];
  for (const item of extensionList.buildConfigurations) {
    const configuration = objects.XCBuildConfiguration[item.value];
    const parentRef = mainList.buildConfigurations.find(
      (ref) => objects.XCBuildConfiguration[ref.value].name === configuration.name,
    );
    const parent = objects.XCBuildConfiguration[parentRef.value].buildSettings;
    Object.assign(configuration.buildSettings, {
      PRODUCT_BUNDLE_IDENTIFIER: `"${bundleId}.widget"`,
      INFOPLIST_FILE: `"${NAME}/Info.plist"`,
      CODE_SIGN_ENTITLEMENTS: `"${NAME}/${NAME}.entitlements"`,
      SWIFT_VERSION: '5.0',
      IPHONEOS_DEPLOYMENT_TARGET: '16.0',
      TARGETED_DEVICE_FAMILY: '"1,2"',
      APPLICATION_EXTENSION_API_ONLY: 'YES',
      SKIP_INSTALL: 'YES',
      GENERATE_INFOPLIST_FILE: 'NO',
      CURRENT_PROJECT_VERSION: parent.CURRENT_PROJECT_VERSION || '1',
      MARKETING_VERSION: parent.MARKETING_VERSION || '1.0.0',
      CODE_SIGN_STYLE: parent.CODE_SIGN_STYLE || 'Automatic',
    });
    if (parent.DEVELOPMENT_TEAM)
      configuration.buildSettings.DEVELOPMENT_TEAM = parent.DEVELOPMENT_TEAM;
  }
  fs.writeFileSync(
    path.join(directory, 'Info.plist'),
    plist.build({
      CFBundleDisplayName: '下一堂課',
      CFBundleExecutable: '$(EXECUTABLE_NAME)',
      CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
      CFBundleName: '$(PRODUCT_NAME)',
      CFBundlePackageType: 'XPC!',
      CFBundleShortVersionString: appInfo.CFBundleShortVersionString || '$(MARKETING_VERSION)',
      CFBundleVersion: appInfo.CFBundleVersion || '$(CURRENT_PROJECT_VERSION)',
      NextClassAppGroup: group,
      NSExtension: { NSExtensionPointIdentifier: 'com.apple.widgetkit-extension' },
    }),
  );
  fs.writeFileSync(
    path.join(directory, `${NAME}.entitlements`),
    plist.build({
      'com.apple.security.application-groups': [group],
    }),
  );
  return project;
}
function withWidgetExtension(config) {
  const group = `group.${config.ios.bundleIdentifier}`;
  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults['com.apple.security.application-groups'] = [
      ...new Set([...(mod.modResults['com.apple.security.application-groups'] || []), group]),
    ];
    return mod;
  });
  config = withInfoPlist(config, (mod) => {
    mod.modResults.NextClassAppGroup = group;
    return mod;
  });
  return withXcodeProject(config, (mod) => {
    configureProject(
      mod.modResults,
      mod.modRequest.platformProjectRoot,
      config.ios.bundleIdentifier,
      group,
    );
    return mod;
  });
}
module.exports = withWidgetExtension;
module.exports.configureProject = configureProject;
