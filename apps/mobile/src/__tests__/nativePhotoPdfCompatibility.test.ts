jest.mock('expo-image-manipulator', () => {
  throw new Error('Missing native module');
});
import { buildNativePhotoPdf, photoPdfAvailable } from '../screens/nuni/nativePhotoPdf';

test('a runtime without the native module can load the converter and safely rejects conversion', async () => {
  expect(photoPdfAvailable()).toBe(false);
  await expect(buildNativePhotoPdf([])).rejects.toThrow('更新應用程式');
});
