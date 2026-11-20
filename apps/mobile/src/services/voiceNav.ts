/* eslint-disable */
/**
 * 語音導航服務 — Turn-by-turn 中文播報
 *
 * 特色：
 *  - 軟相依 expo-speech：模組不存在自動降級為 console.log
 *  - 依「離轉彎點還有多遠」自動選擇提詞密度
 *      - 200m 以上：只提一次
 *      - 100m 以內：再提一次「100 公尺後」
 *      - 30m 以內：「即將」
 *      - 0m：「現在」
 *  - 全域 mute toggle（AsyncStorage 持久化）
 *  - 防重播：同一句相同距離區間 8 秒內不會重複講
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const MUTE_KEY = '@voiceNav:mute';
const REPLAY_GUARD_MS = 8000;

type SpeechModule = {
  speak?: (text: string, options?: any) => void;
  stop?: () => void;
};

let _muted = false;
let _muteLoaded = false;
let _lastSpoken: { text: string; at: number } | null = null;

async function ensureMuteLoaded() {
  if (_muteLoaded) return;
  try {
    const v = await AsyncStorage.getItem(MUTE_KEY);
    _muted = v === '1';
  } catch {
    _muted = false;
  }
  _muteLoaded = true;
}

function loadSpeech(): SpeechModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-speech');
  } catch {
    return null;
  }
}

export async function isMuted(): Promise<boolean> {
  await ensureMuteLoaded();
  return _muted;
}

export async function setMuted(value: boolean): Promise<void> {
  _muted = value;
  _muteLoaded = true;
  try {
    await AsyncStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {}
  if (value) {
    loadSpeech()?.stop?.();
  }
}

export async function toggleMute(): Promise<boolean> {
  await ensureMuteLoaded();
  await setMuted(!_muted);
  return _muted;
}

/**
 * 播報語句。重複內容會被 8 秒內節流。
 */
export async function speak(text: string, opts?: { force?: boolean }): Promise<void> {
  await ensureMuteLoaded();
  if (_muted) return;

  const now = Date.now();
  if (!opts?.force && _lastSpoken && _lastSpoken.text === text && now - _lastSpoken.at < REPLAY_GUARD_MS) {
    return;
  }
  _lastSpoken = { text, at: now };

  const Speech = loadSpeech();
  if (!Speech?.speak) {
    if (__DEV__) console.log('[voiceNav]', text);
    return;
  }
  try {
    Speech.stop?.();
    Speech.speak(text, { language: 'zh-TW', pitch: 1.0, rate: 1.0 });
  } catch (err) {
    if (__DEV__) console.warn('[voiceNav] speak failed', err);
  }
}

export function stop(): void {
  loadSpeech()?.stop?.();
}

// ═════════════════════════════════════════════════════
// Turn-by-turn 中文模板
// ═════════════════════════════════════════════════════

export type Direction = 'forward' | 'left' | 'right' | 'sharp_left' | 'sharp_right' | 'u_turn' | 'destination';

function directionText(d: Direction): string {
  switch (d) {
    case 'left':
      return '左轉';
    case 'right':
      return '右轉';
    case 'sharp_left':
      return '左後方迴轉';
    case 'sharp_right':
      return '右後方迴轉';
    case 'u_turn':
      return '迴轉';
    case 'destination':
      return '抵達目的地';
    case 'forward':
    default:
      return '直行';
  }
}

/**
 * 依「剩餘距離」自動選擇提詞密度與用語
 */
export async function speakTurn(opts: {
  direction: Direction;
  remainingMeters: number;
  landmark?: string;
}): Promise<void> {
  const { direction, remainingMeters, landmark } = opts;
  const dirText = directionText(direction);

  if (direction === 'destination') {
    if (remainingMeters > 100) {
      await speak(`即將在 ${Math.round(remainingMeters)} 公尺後抵達${landmark ? landmark : '目的地'}`);
    } else {
      await speak(`已抵達${landmark ? landmark : '目的地'}`);
    }
    return;
  }

  const where = landmark ? `${landmark}口` : '前方路口';

  if (remainingMeters >= 300) {
    await speak(`${Math.round(remainingMeters)} 公尺後 ${where} ${dirText}`);
  } else if (remainingMeters >= 100) {
    await speak(`${Math.round(remainingMeters / 10) * 10} 公尺後 ${dirText}`);
  } else if (remainingMeters >= 30) {
    await speak(`即將 ${dirText}`);
  } else {
    await speak(`現在 ${dirText}`);
  }
}

// ═════════════════════════════════════════════════════
// 公車到站播報
// ═════════════════════════════════════════════════════

export async function speakBusArriving(routeName: string, stopName: string): Promise<void> {
  await speak(`${routeName} 即將抵達 ${stopName}，請準備上車`);
}

export async function speakNextStop(stopName: string): Promise<void> {
  await speak(`下一站 ${stopName}`);
}

export async function speakAlightWarning(stopName: string): Promise<void> {
  await speak(`下一站 ${stopName}，您將下車，請準備按鈴`);
}

export async function speakArrived(stopName: string): Promise<void> {
  await speak(`已抵達 ${stopName}，謝謝搭乘`);
}
