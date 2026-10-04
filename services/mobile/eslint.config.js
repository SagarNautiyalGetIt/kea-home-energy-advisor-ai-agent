// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  { ignores: ["src/vendor/bloub/**"] },
  expoConfig,
  {
    ignores: ["dist/*", "src/vendor/bloub/**"],
    rules: {
      // React Compiler rules are not compatible with React Native Animated and
      // Reanimated's mutable refs/shared values used throughout this app.
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  }
]);
