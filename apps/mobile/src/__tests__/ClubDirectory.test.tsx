import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ClubDirectory } from '../screens/ClubDirectory';
import { callClubPortal } from '../services/clubPortal';
jest.mock('../services/clubPortal', () => ({ callClubPortal: jest.fn() }));
jest.mock('../services/clubSummary', () => ({ clubSummaryEnabled: () => false }));
jest.mock('../services/clubExport', () => ({ shareClubCsv: jest.fn() }));
jest.mock('../screens/ClubCheckIn', () => ({ ClubCheckIn: () => null }));
jest.mock('../ui/components', () => {
  const { View, Text, Pressable } = require('react-native');
  return {
    Card: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    Button: ({
      text,
      onPress,
      disabled,
    }: {
      text: string;
      onPress: () => void;
      disabled?: boolean;
    }) => (
      <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}>
        <Text>{text}</Text>
      </Pressable>
    ),
  };
});
test('discover uses the callable portal despite the old flag and hides office actions on load failure', async () => {
  (callClubPortal as jest.Mock)
    .mockRejectedValueOnce(new Error('尚未啟用'))
    .mockResolvedValueOnce({ success: true, office: true, clubs: [] });
  const view = render(<ClubDirectory uid="student" schoolId="pu" clubs={[]} onOpen={jest.fn()} />);
  fireEvent.press(view.getByText('找社團'));
  expect(view.queryByText('課外組／平台維運（依本校授權）')).toBeNull();
  expect(await view.findByText('社團服務暫時無法使用，請稍後重試。')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('重新讀取社團資料')));
  expect(await view.findByText('課外組／平台維運（依本校授權）')).toBeTruthy();
  expect(callClubPortal).toHaveBeenCalledWith('student', 'pu', { action: 'directory' });
});
