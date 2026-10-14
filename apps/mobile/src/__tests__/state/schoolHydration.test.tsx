import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SchoolProvider, useSchool } from '../../state/school';

jest.mock('../../data/cachedSource', () => ({ clearCacheExceptSchool: jest.fn(async () => {}) }));
jest.mock('../../data/hybridSource', () => ({ setHybridSourceSchoolContext: jest.fn() }));
jest.mock('../../ui/theme', () => ({
  registerSchoolTheme: jest.fn(),
  applySchoolTheme: jest.fn(),
}));

const key = 'campus.schoolSelection.v1';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function CampusPicker() {
  const { school, setSelection } = useSchool();
  return (
    <View>
      <Text testID="selected-campus">{school.id}</Text>
      <Pressable onPress={() => setSelection({ code: 'NTHU', schoolId: 'nthu' })}>
        <Text>選擇清華大學</Text>
      </Pressable>
      <Pressable onPress={() => setSelection({ code: 'NCKU', schoolId: 'ncku' })}>
        <Text>選擇成功大學</Text>
      </Pressable>
    </View>
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});
afterEach(() => { jest.restoreAllMocks(); });

test('a pending saved PU preference cannot overwrite a newly selected campus', async () => {
  const pending = deferred<string | null>();
  jest.spyOn(AsyncStorage, 'getItem').mockReturnValueOnce(pending.promise);
  const view = render(<SchoolProvider><CampusPicker /></SchoolProvider>);

  fireEvent.press(view.getByText('選擇清華大學'));
  expect(view.getByTestId('selected-campus').props.children).toBe('nthu');

  await act(async () => pending.resolve(JSON.stringify({ code: 'PU', schoolId: 'pu' })));
  expect(view.getByTestId('selected-campus').props.children).toBe('nthu');
  await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    key, expect.stringContaining('"schoolId":"nthu"'),
  ));
});

test('the last explicit campus wins even when storage returns during switching', async () => {
  const pending = deferred<string | null>();
  jest.spyOn(AsyncStorage, 'getItem').mockReturnValueOnce(pending.promise);
  const view = render(<SchoolProvider><CampusPicker /></SchoolProvider>);

  await act(async () => {
    pending.resolve(JSON.stringify({ code: 'PU', schoolId: 'pu' }));
    fireEvent.press(view.getByText('選擇清華大學'));
    fireEvent.press(view.getByText('選擇成功大學'));
  });
  expect(view.getByTestId('selected-campus').props.children).toBe('ncku');
  await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    key, expect.stringContaining('"schoolId":"ncku"'),
  ));
});

test('saved campus still restores normally when the user has not switched', async () => {
  await AsyncStorage.setItem(key, JSON.stringify({ code: 'NTHU', schoolId: 'nthu' }));
  const view = render(<SchoolProvider><CampusPicker /></SchoolProvider>);
  await waitFor(() => expect(view.getByTestId('selected-campus').props.children).toBe('nthu'));
});
