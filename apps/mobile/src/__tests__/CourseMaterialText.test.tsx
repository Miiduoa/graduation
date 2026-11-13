import React from 'react';
import { Alert, Linking } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { CourseMaterialText } from '../components/CourseMaterialText';

jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));

const text = '課前閱讀：https://example.test/reading。\n補充 HTTP://example.test/notes，請讀完。';
afterEach(() => jest.restoreAllMocks());

it('opens teacher reading URLs from the material body without surrounding punctuation', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const view = render(<CourseMaterialText text={text} />);
  expect(view.getAllByRole('link')).toHaveLength(2);
  fireEvent.press(view.getByRole('link', { name: 'https://example.test/reading' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith('https://example.test/reading'));
  fireEvent.press(view.getByRole('link', { name: 'HTTP://example.test/notes' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith('http://example.test/notes'));
});

it('keeps unsupported, malformed and credential-bearing URLs as plain text', () => {
  const view = render(<CourseMaterialText text={'javascript:alert(1) file:///private campus://secret https:// https://user:pass@example.test/private'} />);
  expect(view.queryAllByRole('link')).toHaveLength(0);
  expect(view.getByText(/https:\/\/user:pass@example.test\/private/)).toBeTruthy();
});

it('shows a retry message when the browser cannot open the reading link', async () => {
  jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('unavailable'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = render(<CourseMaterialText text={text} />);
  fireEvent.press(view.getByRole('link', { name: 'https://example.test/reading' }));
  await waitFor(() => expect(alert).toHaveBeenCalledWith('無法開啟教材連結', '請稍後再試一次。'));
});
