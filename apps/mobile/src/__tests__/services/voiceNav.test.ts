/* eslint-disable @typescript-eslint/no-var-requires */
import AsyncStorage from '@react-native-async-storage/async-storage';

type VoiceNav = typeof import('../../services/voiceNav');

const mockStopSpeech = jest.fn();
const mockSpeak = jest.fn();

jest.mock('expo-speech', () => ({ stop: mockStopSpeech, speak: mockSpeak }), { virtual: true });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('voice navigation mute lifecycle', () => {
  let voiceNav: VoiceNav;
  const getItem = jest.mocked(AsyncStorage.getItem);
  const setItem = jest.mocked(AsyncStorage.setItem);
  const stopSpeech = mockStopSpeech;
  const speak = mockSpeak;

  beforeEach(() => {
    getItem.mockReset().mockResolvedValue(null);
    setItem.mockReset().mockResolvedValue(undefined);
    stopSpeech.mockReset().mockResolvedValue(undefined);
    speak.mockReset();
    // Isolate only the service singleton. Resetting the entire Jest registry
    // or unmocking AsyncStorage breaks the shared aiLocalAgent setup hook.
    jest.isolateModules(() => {
      voiceNav = require('../../services/voiceNav');
    });
  });

  it('shares one initial preference read across simultaneous callers', async () => {
    const read = deferred<string | null>();
    getItem.mockReturnValueOnce(read.promise);
    const first = voiceNav.isMuted();
    const second = voiceNav.isMuted();
    expect(getItem).toHaveBeenCalledTimes(1);
    read.resolve('1');
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  it('preserves a newer mute choice when a stale initial read finishes', async () => {
    const read = deferred<string | null>();
    getItem.mockReturnValueOnce(read.promise);
    const pendingSpeech = voiceNav.speak('下一站');
    await voiceNav.setMuted(true);
    read.resolve('0');
    await pendingSpeech;
    await expect(voiceNav.isMuted()).resolves.toBe(true);
    expect(speak).not.toHaveBeenCalled();
  });

  it('stops speech without waiting for storage and serializes subsequent writes', async () => {
    const firstWrite = deferred<void>();
    setItem.mockReturnValueOnce(firstWrite.promise);
    const mute = voiceNav.setMuted(true);
    expect(stopSpeech).toHaveBeenCalledTimes(1);
    const unmute = voiceNav.setMuted(false);
    await Promise.resolve();
    expect(setItem.mock.calls).toEqual([['@voiceNav:mute', '1']]);
    await expect(voiceNav.isMuted()).resolves.toBe(false);
    firstWrite.resolve(undefined);
    await Promise.all([mute, unmute]);
    expect(setItem.mock.calls).toEqual([
      ['@voiceNav:mute', '1'],
      ['@voiceNav:mute', '0'],
    ]);
    expect(stopSpeech).toHaveBeenCalledTimes(1);
  });

  it('keeps the write queue usable after storage failure', async () => {
    setItem.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(voiceNav.setMuted(true)).resolves.toBeUndefined();
    await expect(voiceNav.isMuted()).resolves.toBe(true);
    await voiceNav.setMuted(false);
    expect(setItem).toHaveBeenLastCalledWith('@voiceNav:mute', '0');
  });

  it('returns the individual choice from simultaneous toggle requests', async () => {
    const read = deferred<string | null>();
    getItem.mockReturnValueOnce(read.promise);
    const first = voiceNav.toggleMute();
    const second = voiceNav.toggleMute();
    read.resolve('0');
    await expect(Promise.all([first, second])).resolves.toEqual([true, false]);
    expect(setItem.mock.calls).toEqual([
      ['@voiceNav:mute', '1'],
      ['@voiceNav:mute', '0'],
    ]);
  });

  it('keeps mute persistence independent of native speech stop rejection', async () => {
    stopSpeech.mockRejectedValueOnce(new Error('native speech unavailable'));
    await expect(voiceNav.setMuted(true)).resolves.toBeUndefined();
    expect(setItem).toHaveBeenCalledWith('@voiceNav:mute', '1');
    await expect(voiceNav.isMuted()).resolves.toBe(true);
  });

  it('contains native stop rejection when replacing an announcement', async () => {
    stopSpeech.mockRejectedValueOnce(new Error('native stop failed'));
    await expect(voiceNav.speak('下一站')).resolves.toBeUndefined();
    expect(speak).toHaveBeenCalledWith('下一站', {
      language: 'zh-TW',
      pitch: 1.0,
      rate: 1.0,
    });
  });
});
