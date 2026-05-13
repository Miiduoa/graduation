import {
  companionThrottleMinInterval,
  companionThrottleOncePerCalendarDay,
} from '../../utils/companionSignalThrottle';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('companionSignalThrottle', () => {
  beforeEach(() => AsyncStorage.clear());

  it('companionThrottleOncePerCalendarDay allows first then blocks same day', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-13T12:00:00Z'));
    const a = await companionThrottleOncePerCalendarDay('map_open');
    const b = await companionThrottleOncePerCalendarDay('map_open');
    expect(a).toBe(true);
    expect(b).toBe(false);
    jest.useRealTimers();
  });

  it('companionThrottleMinInterval respects interval', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-13T12:00:00Z'));
    const first = await companionThrottleMinInterval('chat_sent', 60_000);
    jest.advanceTimersByTime(59_000);
    const second = await companionThrottleMinInterval('chat_sent', 60_000);
    jest.advanceTimersByTime(2_000);
    const third = await companionThrottleMinInterval('chat_sent', 60_000);
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(third).toBe(true);
    jest.useRealTimers();
  });
});
