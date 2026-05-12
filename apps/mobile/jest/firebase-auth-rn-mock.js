/** Jest shim: production code requires @firebase/auth RN persistence entry. */
module.exports = {
  getReactNativePersistence: () => ({}),
};
