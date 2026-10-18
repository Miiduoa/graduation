import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { File } from 'expo-file-system';
import {
  PersonalImportDocumentError,
  validatePersonalImportDocumentFile,
  type PersonalImportDocument,
} from '@campus/shared';
import { DocumentCoordinator } from '../services/imports/documentCoordinator';
import { DOCUMENT_IMPORT_HTML, prepareDocumentBaseUrl } from '../services/imports/documentAssets';
export type DocumentImportHandle = {
  read: (
    file: { uri: string; name: string; size?: number },
    signal?: AbortSignal,
  ) => Promise<PersonalImportDocument>;
  cancel: () => void;
};
export const DocumentImportHost = forwardRef<DocumentImportHandle>(
  function DocumentImportHost(_, ref) {
    const web = useRef<WebView>(null);
    const request = useRef<AbortController | null>(null);
    const [generation, setGeneration] = useState(0);
    const generationRef = useRef(0);
    const [baseUrl, setBaseUrl] = useState('');
    const alive = useRef(true);
    const coordinator = useRef<DocumentCoordinator | null>(null);
    if (!coordinator.current)
      coordinator.current = new DocumentCoordinator(
        (script) => web.current?.injectJavaScript(script),
        () => {
          generationRef.current += 1;
          if (alive.current) setGeneration(generationRef.current);
        },
      );
    const instance = coordinator.current;
    useEffect(() => {
      alive.current = true;
      void prepareDocumentBaseUrl()
        .then((url) => {
          if (alive.current) setBaseUrl(url);
        })
        .catch(() =>
          instance.fail(
            new PersonalImportDocumentError(
              '文件讀取程式未能載入，請重新開啟 App。',
              'unavailable',
            ),
          ),
        );
      return () => {
        alive.current = false;
        request.current?.abort();
        instance.reset();
      };
    }, [instance]);
    useImperativeHandle(
      ref,
      () => ({
        read: async (input, signal) => {
          request.current?.abort();
          instance.cancel();
          const controller = new AbortController();
          request.current = controller;
          const abort = () => controller.abort();
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) controller.abort();
          try {
            const check = () => {
              if (controller.signal.aborted)
                throw new PersonalImportDocumentError('已取消讀取。', 'cancelled');
            };
            check();
            if (input.size !== undefined)
              validatePersonalImportDocumentFile(input.name, input.size);
            const file = new File(input.uri);
            validatePersonalImportDocumentFile(input.name, file.size);
            const url = await prepareDocumentBaseUrl();
            check();
            if (alive.current) setBaseUrl(url);
            const base64 = await file.base64();
            check();
            return await instance.read(input.name, base64, controller.signal);
          } finally {
            signal?.removeEventListener('abort', abort);
            if (request.current === controller) request.current = null;
          }
        },
        cancel: () => {
          request.current?.abort();
          instance.cancel();
        },
      }),
      [instance],
    );
    return (
      <View
        style={{ height: 0, overflow: 'hidden' }}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {baseUrl ? (
          <WebView
            key={generation}
            ref={web}
            originWhitelist={['file://*', 'about:*']}
            source={{ html: DOCUMENT_IMPORT_HTML, baseUrl }}
            allowFileAccess
            allowFileAccessFromFileURLs
            javaScriptEnabled
            onShouldStartLoadWithRequest={(navigation) =>
              navigation.url === 'about:blank' || navigation.url.startsWith(baseUrl)
            }
            onMessage={(event) => {
              if (generation === generationRef.current) instance.message(event.nativeEvent.data);
            }}
            onError={() =>
              instance.fail(
                new PersonalImportDocumentError(
                  '文件讀取程式未能載入，請重新開啟 App。',
                  'unavailable',
                ),
              )
            }
          />
        ) : null}
      </View>
    );
  },
);
