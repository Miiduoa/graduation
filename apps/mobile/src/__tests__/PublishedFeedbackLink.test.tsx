import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PublishedFeedbackLink } from '../components/PublishedFeedbackLink';

test('opening feedback marks only this account and version read', async () => {
  await AsyncStorage.clear();
  const open = jest.fn();
  const view = render(<PublishedFeedbackLink owner="student-a" record="course:assignment:1" version="2026-10-30" label="查看作業回饋" onOpen={open} />);
  await view.findByText('未讀 · 查看作業回饋');
  fireEvent.press(view.getByRole('button', { name: '查看作業回饋' }));
  expect(open).toHaveBeenCalledTimes(1);
  expect(AsyncStorage.setItem).toHaveBeenCalled();
  await waitFor(() => expect(view.queryByText('未讀 · 查看作業回饋')).toBeNull(), { timeout: 5000 });
  expect(open).toHaveBeenCalledTimes(1);
  view.rerender(<PublishedFeedbackLink owner="student-b" record="course:assignment:1" version="2026-10-30" label="查看作業回饋" onOpen={open} />);
  await view.findByText('未讀 · 查看作業回饋');
  view.rerender(<PublishedFeedbackLink owner="student-a" record="course:assignment:1" version="2026-10-31" label="查看作業回饋" onOpen={open} />);
  await view.findByText('未讀 · 查看作業回饋');
});
