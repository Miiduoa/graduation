import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { QuickCampusEntry } from '../components/QuickCampusEntry';
import { interpretMobileCampusRequest } from '../services/campusIntentClient';
import { applyTheme } from '../ui/theme';

jest.mock('../services/campusIntentClient', () => ({
  interpretMobileCampusRequest: jest.fn(),
}));
jest.mock('../state/theme', () => ({
  useTheme: () => require('../ui/theme').theme,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const interpret = interpretMobileCampusRequest as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  applyTheme('light');
});

test('asks the model to understand several goals only when the student submits', async () => {
  interpret.mockResolvedValue({
    status: 'understood', source: 'model',
    summary: '要先查空堂，再讀書和吃飯。',
    destinations: ['/timetable', '/library', '/cafeteria'],
    clarifyingQuestion: null,
  });
  const open = jest.fn();
  const view = render(<QuickCampusEntry uid="alice" schoolId="pu" onOpen={open} onAsk={jest.fn()} />);
  fireEvent.changeText(view.getByLabelText('說出或輸入想做的事'), '明天好像沒課想讀書再去吃飯');
  expect(interpret).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByLabelText('用 AI 理解這句話')));
  expect(interpret).toHaveBeenCalledWith(expect.objectContaining({
    uid: 'alice', schoolId: 'pu', utterance: '明天好像沒課想讀書再去吃飯',
  }));
  expect(view.getByText('AI 理解的需求')).toBeTruthy();
  expect(view.getByText('要先查空堂，再讀書和吃飯。')).toBeTruthy();
  fireEvent.press(view.getByLabelText('前往圖書館'));
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ route: 'Library' }));
});

test('falls back honestly when AI cannot connect', async () => {
  interpret.mockRejectedValue(new Error('offline'));
  const view = render(<QuickCampusEntry uid="alice" schoolId="pu" onOpen={jest.fn()} onAsk={jest.fn()} />);
  fireEvent.changeText(view.getByLabelText('說出或輸入想做的事'), '我要交作業');
  await act(async () => fireEvent.press(view.getByLabelText('用 AI 理解這句話')));
  expect(view.getByText(/AI 暫時無法使用/)).toBeTruthy();
  expect(view.queryByText('AI 建議下一步')).toBeNull();
  expect(view.getByLabelText('前往課程與作業')).toBeTruthy();
});

test('does not ask cloud AI for signed-out users', () => {
  const view = render(<QuickCampusEntry uid={null} onOpen={jest.fn()} onAsk={jest.fn()} />);
  fireEvent.changeText(view.getByLabelText('說出或輸入想做的事'), '找個地方吃飯');
  expect(view.queryByLabelText('用 AI 理解這句話')).toBeNull();
  expect(interpret).not.toHaveBeenCalled();
});

test('ignores a late result after the user edits the phrase', async () => {
  let finish!: (value: any) => void;
  interpret.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const view = render(<QuickCampusEntry uid="alice" schoolId="pu" onOpen={jest.fn()} onAsk={jest.fn()} />);
  fireEvent.changeText(view.getByLabelText('說出或輸入想做的事'), '讀書再吃飯');
  fireEvent.press(view.getByLabelText('用 AI 理解這句話'));
  fireEvent.changeText(view.getByLabelText('說出或輸入想做的事'), '公車');
  await act(async () => finish({
    status: 'understood', source: 'model', summary: '舊結果',
    destinations: ['/cafeteria'], clarifyingQuestion: null,
  }));
  expect(view.queryByText('舊結果')).toBeNull();
});
