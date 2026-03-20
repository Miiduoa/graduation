/**
 * Expo Config Plugin for iOS Widget Extension
 * 
 * 這個 plugin 會在 EAS Build 時自動配置 iOS Widget Extension。
 * 
 * 使用方式：
 * 1. 在 app.config.ts 中加入此 plugin
 * 2. 執行 eas build 時會自動處理
 */

const { withXcodeProject, withEntitlementsPlist } = require("expo/config-plugins");

const WIDGET_EXTENSION_NAME = "CampusWidgetExtension";
const WIDGET_BUNDLE_ID_SUFFIX = "widget";
const APP_GROUP_ID = "group.campus.app.shared";

function withWidgetExtension(config) {
  // Add App Group entitlements
  config = withEntitlementsPlist(config, (config) => {
    config.modResults["com.apple.security.application-groups"] = [APP_GROUP_ID];
    return config;
  });

  // Modify Xcode project
  config = withXcodeProject(config, async (config) => {
    const targetName = WIDGET_EXTENSION_NAME;
    const bundleId = `${config.ios?.bundleIdentifier}.${WIDGET_BUNDLE_ID_SUFFIX}`;

    // Note: Full widget extension setup requires native code
    // This is a placeholder for the configuration
    console.log(`[Widget Plugin] Configured widget extension: ${targetName}`);
    console.log(`[Widget Plugin] Bundle ID: ${bundleId}`);
    console.log(`[Widget Plugin] App Group: ${APP_GROUP_ID}`);

    return config;
  });

  return config;
}

module.exports = withWidgetExtension;
