import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SchoolBrowsingControl } from '../components/SchoolBrowsingControl';
import { fetchSchoolDirectory } from '../services/schoolDirectory';

const mockSetSelection = jest.fn();
let mockSchool = { id: 'puli', name: '埔里學院' };
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: mockSchool, setSelection: mockSetSelection }),
}));
jest.mock('../services/schoolDirectory', () => ({ fetchSchoolDirectory: jest.fn() }));

const directory = [
  { id: 'puli', name: '埔里學院', code: 'PULI' },
  { id: 'pu', name: '靜宜大學', shortName: '靜宜', integrationStatus: { enabled: false } },
  { id: 'other', name: '其他學院', code: 'PU' },
  { id: 'nccu', name: '國立政治大學', shortName: '政大' },
  { id: 'ntu', name: '國立臺灣大學', shortName: '臺大', code: 'NTU' },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockSchool = { id: 'puli', name: '埔里學院' };
  jest.mocked(fetchSchoolDirectory).mockResolvedValue(directory);
});

test('搜尋正規化代號、中文名與簡稱，完全相符優先且不自動選校', async () => {
  const view = render(<SchoolBrowsingControl />);
  fireEvent.press(view.getByLabelText('目前瀏覽埔里學院，選擇其他學校'));
  await waitFor(() => expect(view.getByText('5 所學校 · 點選後切換公開資訊')).toBeTruthy());
  const input = view.getByLabelText('搜尋學校');
  fireEvent.changeText(input, ' Ｐ Ｕ ');
  expect(view.getAllByLabelText(/^選擇.*學/).map(row => row.props.accessibilityLabel))
    .toEqual(['選擇靜宜大學', '選擇其他學院', '選擇埔里學院']);
  expect(mockSetSelection).not.toHaveBeenCalled();
  for (const query of ['Nc Cu', '政 大', '國立政治大學']) {
    fireEvent.changeText(input, query);
    expect(view.getByLabelText('選擇國立政治大學')).toBeTruthy();
    expect(view.getByText('1 所學校 · 點選後切換公開資訊')).toBeTruthy();
  }
  fireEvent.changeText(input, '台 大');
  expect(view.getByLabelText('選擇國立臺灣大學')).toBeTruthy();
  fireEvent.changeText(input, 'missing');
  expect(view.getByText('找不到符合的學校，請換個關鍵字。')).toBeTruthy();
  fireEvent.changeText(input, 'pu');
  fireEvent.press(view.getByLabelText('選擇靜宜大學'));
  expect(mockSetSelection).toHaveBeenCalledWith(expect.objectContaining({ schoolId: 'pu' }));
  expect(directory[1].integrationStatus?.enabled).toBe(false);
});

test('first-time picker does not preselect a campus; tapping a search match is an explicit choice', async () => {
  mockSchool = { id: '', name: '尚未選校' };
  const view = render(<SchoolBrowsingControl />);
  fireEvent.press(view.getByRole('button', { name: '選擇我的學校' }));
  await view.findByText('5 所學校 · 點選後切換公開資訊');
  expect(view.queryByText('目前選擇')).toBeNull();
  fireEvent.changeText(view.getByTestId('school-picker-search'), '台大');
  expect(mockSetSelection).not.toHaveBeenCalled();
  fireEvent.press(view.getByTestId('school-picker-option-ntu'));
  expect(mockSetSelection).toHaveBeenCalledWith(expect.objectContaining({ schoolId: 'ntu', code: 'NTU' }));
});
