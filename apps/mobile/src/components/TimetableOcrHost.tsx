import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { TIMETABLE_OCR_HTML, TimetableOcrError } from '../services/timetableOcr';
import { OcrCoordinator } from '../services/imports/ocrCoordinator';

export type TimetableOcrHandle = {
  recognize: (
    base64: string,
    mime: 'image/png' | 'image/jpeg',
    signal?: AbortSignal,
  ) => Promise<string>;
  cancel: () => void;
};
export const TimetableOcrHost = forwardRef<TimetableOcrHandle>(function TimetableOcrHost(_, ref) {
  const web = useRef<WebView>(null);
  const coordinator = useRef<OcrCoordinator | null>(null);
  if (!coordinator.current)
    coordinator.current = new OcrCoordinator((script) => web.current?.injectJavaScript(script));
  const instance = coordinator.current;
  useImperativeHandle(
    ref,
    () => ({
      recognize: (base64, mime, signal) => instance.recognize(base64, mime, signal),
      cancel: () => instance.cancel(),
    }),
    [instance],
  );
  useEffect(() => () => instance.reset(), [instance]);
  return (
    <View
      style={{ height: 0, overflow: 'hidden' }}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <WebView
        ref={web}
        originWhitelist={['https://*', 'about:*']}
        source={{ html: TIMETABLE_OCR_HTML, baseUrl: 'https://cdn.jsdelivr.net' }}
        javaScriptEnabled
        onMessage={(event) => instance.message(event.nativeEvent.data)}
        onError={() => {
          instance.fail(
            new TimetableOcrError('辨識程式未能載入，請確認網路或改貼文字。', 'network'),
          );
          instance.reset();
        }}
      />
    </View>
  );
});
