/**
 * 語音錄製（LINE 級）：輸出本機錄製 URI，再上傳交給 {@link ../mediaUpload}。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

let Audio: typeof import('expo-av').Audio | null = null;

export async function initVoiceRecording() {
  if (!Audio) {
    Audio = await import('expo-av').then((m) => m.Audio);
  }
  const perm = await Audio!.requestPermissionsAsync();
  if (!perm.granted) throw new Error('需要麥克風權限');
  await Audio!.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
  });
}

export async function createVoiceRecording(): Promise<import('expo-av').Audio.Recording> {
  await initVoiceRecording();
  const { Audio } = await import('expo-av');
  const rec = new Audio.Recording();
  await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
  return rec;
}
