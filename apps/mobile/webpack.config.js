// Custom Expo Webpack config to transpile workspace packages (monorepo)
// Fixes: "Module parse failed: Unexpected token" when importing TS from @campus/shared

const createExpoWebpackConfigAsync = require("@expo/webpack-config");
const path = require("path");

module.exports = async function (env, argv) {
  const config = await createExpoWebpackConfigAsync(env, argv);

  const sharedPkgRoot = path.resolve(__dirname, "../../packages/shared");
  const sharedNodeModules = path.resolve(__dirname, "node_modules/@campus/shared");

  // Ensure TS/TSX from shared package is transpiled for web.
  config.module.rules.push({
    test: /\.[jt]sx?$/,
    include: [sharedPkgRoot, sharedNodeModules],
    use: {
      loader: "babel-loader",
      options: {
        presets: ["babel-preset-expo"],
      },
    },
  });

  return config;
};
