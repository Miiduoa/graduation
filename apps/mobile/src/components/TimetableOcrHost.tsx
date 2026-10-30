import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { TIMETABLE_OCR_HTML, TimetableOcrError } from '../services/timetableOcr';
import { prepareOcrBaseUrl } from '../services/ocrLocalBase';
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
  const [baseUrl, setBaseUrl] = useState('');
  const [hostGeneration, setHostGeneration] = useState(0);
  const needsRestart = useRef(false);
  const hostEpoch = useRef(0);
  const restart = () => {
    if (hostEpoch.current !== hostGeneration) return;
    instance.fail(
      new TimetableOcrError(
        '圖片辨識程式已停止，可能是裝置記憶體不足。請裁切圖片後重試，或改貼文字。',
        'unavailable',
      ),
    );
    instance.reset();
    needsRestart.current = true;
  };
  useEffect(() => {
    let open = true;
    void prepareOcrBaseUrl()
      .then((url) => {
        if (open) setBaseUrl(url);
      })
      .catch(() => {
        if (open)
          instance.fail(new TimetableOcrError('辨識程式未能載入，請改貼文字。', 'unavailable'));
      });
    return () => {
      open = false;
    };
  }, [instance]);
  useImperativeHandle(
    ref,
    () => ({
      recognize: async (base64, mime, signal) => {
        if (!baseUrl) await prepareOcrBaseUrl();
        if (needsRestart.current) {
          needsRestart.current = false;
          hostEpoch.current += 1;
          setHostGeneration(hostEpoch.current);
        }
        return instance.recognize(base64, mime, signal);
      },
      cancel: () => instance.cancel(),
    }),
    [instance, baseUrl],
  );
  useEffect(() => () => instance.reset(), [instance]);
  return (
    <View
      style={{ height: 0, overflow: 'hidden' }}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {baseUrl ? (
        <WebView
          key={hostGeneration}
          ref={web}
          originWhitelist={['file://*', 'about:*']}
          source={{ html: TIMETABLE_OCR_HTML, baseUrl }}
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          javaScriptEnabled
          onMessage={(event) => {
            if (!needsRestart.current && hostEpoch.current === hostGeneration)
              instance.message(event.nativeEvent.data);
          }}
          onError={restart}
          onContentProcessDidTerminate={restart}
          onRenderProcessGone={restart}
        />
      ) : null}
    </View>
  );
});
