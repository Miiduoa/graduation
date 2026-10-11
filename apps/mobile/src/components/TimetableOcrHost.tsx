import React, { useRef } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { TIMETABLE_OCR_HTML, TimetableOcrError } from '../services/timetableOcr';

const OCR_TIMEOUT_MS = 20_000;

type Job = {
  base64: string;
  resolve: (text: string) => void;
  reject: (error: TimetableOcrError) => void;
  timer: ReturnType<typeof setTimeout>;
};

let pending: Job | null = null;
let ready = false;
let webRef: WebView | null = null;

function failPending(error: TimetableOcrError) {
  const job = pending;
  pending = null;
  if (!job) return;
  clearTimeout(job.timer);
  job.reject(error);
}

function ocrErrorFromMessage(message: string) {
  const lower = message.toLowerCase();
  const network =
    lower.includes('network') ||
    lower.includes('fetch') ||
    lower.includes('failed to load') ||
    lower.includes('timeout');
  return new TimetableOcrError(
    network
      ? '截圖辨識需要連上網路下載字庫，這次沒連上'
      : message || '這台裝置還沒開通截圖辨識',
    network ? 'network' : 'unavailable',
  );
}

export function recognizeWithOnDeviceOcr(base64: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (pending) failPending(new TimetableOcrError('上一次辨識還沒結束', 'unavailable'));
    const timer = setTimeout(() => {
      failPending(new TimetableOcrError('這台裝置還沒開通截圖辨識', 'unavailable'));
    }, OCR_TIMEOUT_MS);
    pending = {
      base64,
      resolve: (text) => {
        clearTimeout(timer);
        resolve(text);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
      timer,
    };
    if (ready && webRef) {
      webRef.injectJavaScript(`window.recognizeTimetable(${JSON.stringify(base64)}); true;`);
    }
  });
}

export function TimetableOcrHost() {
  const ref = useRef<WebView>(null);
  return (
    <View style={{ height: 0, overflow: 'hidden' }} pointerEvents="none">
      <WebView
        ref={(node) => {
          webRef = node;
          ref.current = node;
        }}
        originWhitelist={['*']}
        source={{ html: TIMETABLE_OCR_HTML, baseUrl: 'https://cdn.jsdelivr.net' }}
        javaScriptEnabled
        onMessage={(event) => {
          try {
            const payload = JSON.parse(event.nativeEvent.data) as {
              ready?: boolean;
              ok?: boolean;
              text?: string;
              error?: string;
            };
            if (payload.ready) {
              ready = true;
              if (pending && webRef) {
                webRef.injectJavaScript(`window.recognizeTimetable(${JSON.stringify(pending.base64)}); true;`);
              }
              return;
            }
            const job = pending;
            pending = null;
            if (!job) return;
            if (payload.ok) {
              clearTimeout(job.timer);
              job.resolve(String(payload.text || ''));
            } else {
              clearTimeout(job.timer);
              job.reject(ocrErrorFromMessage(payload.error || '辨識失敗'));
            }
          } catch {
            failPending(new TimetableOcrError('辨識結果讀不到', 'unavailable'));
          }
        }}
        onError={() => {
          ready = false;
          failPending(new TimetableOcrError('這台裝置還沒開通截圖辨識', 'unavailable'));
        }}
      />
    </View>
  );
}
