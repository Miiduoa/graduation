import React, { forwardRef, useCallback } from 'react';
import { WebView } from 'react-native-webview';
import type { WebViewProps } from 'react-native-webview';

import { webViewShouldAllowRequestUrl } from '../services/tronClassWebUiGate';

export type PuWebViewProps = WebViewProps & {
  /**
   * LMS 關閉時擋下玩課雲請求後觸發（子框架／重新導向可能多次呼叫，請自行節流，例如配合 ref 只 Alert 一次）。
   */
  onTronClassNavigationBlocked?: () => void;
};

/** 預設掛 LMS（TronClass）請求過濾；新畫面的 WebView 請優先使用本元件而非裸用 `react-native-webview`。 */
export const PuWebView = forwardRef<WebView, PuWebViewProps>(function PuWebView(
  {
    onShouldStartLoadWithRequest: userOnShouldStartLoadWithRequest,
    onTronClassNavigationBlocked,
    setSupportMultipleWindows,
    ...rest
  },
  ref,
) {
  const onShouldStartLoadWithRequest = useCallback(
    (req: Parameters<NonNullable<WebViewProps['onShouldStartLoadWithRequest']>>[0]): boolean => {
      const raw = typeof req.url === 'string' ? req.url : undefined;
      if (!webViewShouldAllowRequestUrl(raw)) {
        onTronClassNavigationBlocked?.();
        return false;
      }
      return userOnShouldStartLoadWithRequest?.(req) ?? true;
    },
    [userOnShouldStartLoadWithRequest, onTronClassNavigationBlocked],
  );

  return (
    <WebView
      ref={ref}
      {...rest}
      setSupportMultipleWindows={setSupportMultipleWindows ?? false}
      onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
    />
  );
});

PuWebView.displayName = 'PuWebView';
