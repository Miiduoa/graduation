// Native hosts are supplied by Expo; query services and server responses are real.
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.setTimeout(30000);

// Keep the original SDK functions, but expose configurable export properties.
// Firebase's read-only re-exports otherwise prevent call-through observation of
// a real deletion between getDocFromServer and getDocsFromServer in the race test.
jest.mock('firebase/firestore', () => ({
  __esModule: true,
  ...jest.requireActual('firebase/firestore'),
}));
