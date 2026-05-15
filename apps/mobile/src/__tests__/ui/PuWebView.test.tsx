import React from 'react';
import { render } from '@testing-library/react-native';

const mockWebViewShouldAllowRequestUrl = jest.fn();

jest.mock('../../services/tronClassWebUiGate', () => ({
  webViewShouldAllowRequestUrl: (...args: unknown[]) =>
    mockWebViewShouldAllowRequestUrl(...args),
}));

import { PuWebView } from '../../ui/PuWebView';

describe('PuWebView', () => {
  beforeEach(() => {
    mockWebViewShouldAllowRequestUrl.mockImplementation(() => true);
  });

  it('renders WebView with forwarded props', () => {
    const { getByTestId } = render(
      <PuWebView testID="pv" source={{ uri: 'https://example.com/file.pdf' }} />,
    );
    expect(getByTestId('pv')).toBeTruthy();
    expect(getByTestId('pv').props.source).toEqual({ uri: 'https://example.com/file.pdf' });
  });

  it('calls onTronClassNavigationBlocked when gate rejects URL', () => {
    mockWebViewShouldAllowRequestUrl.mockImplementation(() => false);
    const onBlocked = jest.fn();
    const { getByTestId } = render(
      <PuWebView testID="pv" source={{ uri: 'https://example.com/' }} onTronClassNavigationBlocked={onBlocked} />,
    );
    const handler = getByTestId('pv').props.onShouldStartLoadWithRequest;
    expect(typeof handler).toBe('function');
    expect(handler({ url: 'https://tronclass.pu.edu.tw/course/1' })).toBe(false);
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  it('delegates to user onShouldStartLoadWithRequest after gate allows', () => {
    mockWebViewShouldAllowRequestUrl.mockImplementation(() => true);
    const userGate = jest.fn(() => false);
    const { getByTestId } = render(
      <PuWebView testID="pv" source={{ html: '<p/>' }} onShouldStartLoadWithRequest={userGate} />,
    );
    const handler = getByTestId('pv').props.onShouldStartLoadWithRequest;
    expect(handler({ url: 'https://allowed.example/' })).toBe(false);
    expect(userGate).toHaveBeenCalled();
  });

  it('defaults setSupportMultipleWindows to false', () => {
    const { getByTestId } = render(<PuWebView testID="pv" source={{ html: '' }} />);
    expect(getByTestId('pv').props.setSupportMultipleWindows).toBe(false);
  });
});
