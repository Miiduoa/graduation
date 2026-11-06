import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { QuickCampusEntry } from '../components/QuickCampusEntry';
import { askCampusAssistant, OnDeviceAssistantError } from '../features/campusAssistant';
import { interpretMobileCampusRequest } from '../services/campusIntentClient';
import { applyTheme } from '../ui/theme';

jest.mock('../features/campusAssistant', () => ({
  askCampusAssistant: jest.fn(),
  OnDeviceAssistantError: jest.requireActual('../features/campusAssistant').OnDeviceAssistantError,
}));
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
  const view = render(<QuickCampusEntry uid="alice" schoolId="pu" onOpen={open} />);
  fireEvent.changeText(view.getByLabelText('說出或輸入想做的事'), '明天好像沒課想讀書再去吃飯');
  expect(interpret).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByLabelText('用雲端 AI 找相關服務')));
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
  const view = render(<QuickCampusEntry uid="alice" schoolId="pu" onOpen={jest.fn()} />);
  fireEvent.changeText(view.getByLabelText('說出或輸入想做的事'), '我要交作業');
  await act(async () => fireEvent.press(view.getByLabelText('用雲端 AI 找相關服務')));
  expect(view.getByText(/AI 暫時無法使用/)).toBeTruthy();
  expect(view.queryByText('AI 建議下一步')).toBeNull();
  expect(view.getByLabelText('前往課程與作業')).toBeTruthy();
});

test('does not ask cloud AI for signed-out users', () => {
  const view = render(<QuickCampusEntry uid={null} onOpen={jest.fn()} />);
  fireEvent.changeText(view.getByLabelText('說出或輸入想做的事'), '找個地方吃飯');
  expect(view.queryByLabelText('用雲端 AI 找相關服務')).toBeNull();
  expect(interpret).not.toHaveBeenCalled();
});

test('ignores a late result after the user edits the phrase', async () => {
  let finish!: (value: Awaited<ReturnType<typeof interpretMobileCampusRequest>>) => void;
  interpret.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const view = render(<QuickCampusEntry uid="alice" schoolId="pu" onOpen={jest.fn()} />);
  fireEvent.changeText(view.getByLabelText('說出或輸入想做的事'), '讀書再吃飯');
  fireEvent.press(view.getByLabelText('用雲端 AI 找相關服務'));
  fireEvent.changeText(view.getByLabelText('說出或輸入想做的事'), '公車');
  await act(async () => finish({
    status: 'understood', source: 'model', summary: '舊結果',
    destinations: ['/cafeteria'], clarifyingQuestion: null,
  }));
  expect(view.queryByText('舊結果')).toBeNull();
});

test('answers dictated text in Today and keeps the last class available for a follow-up', async () => {
  const ask = jest.mocked(askCampusAssistant);
  const course = { uid: 'alice', schoolId: 'pu', updatedAt: null, classes: [
    { courseId: 'stats', name: '統計學', room: '主顧樓 301', term: '115|1', date: '2026-11-06', startTime: '13:00', endTime: '14:00' },
  ] };
  ask.mockResolvedValueOnce({ source: 'device', content: '下一堂是統計學。', hasActions: false,
    savedClassRead: course });
  ask.mockResolvedValueOnce({ source: 'device', content: '在主顧樓 301。', hasActions: false });
  const open = jest.fn();
  const view = render(<QuickCampusEntry uid="alice" schoolId="pu" onOpen={open} />);
  const input = view.getByLabelText('說出或輸入想做的事');
  fireEvent.changeText(input, '下一堂是什麼？');
  await act(async () => fireEvent(input, 'submitEditing'));
  expect(view.getByText('下一堂是統計學。')).toBeTruthy();
  expect(input.props.value).toBe('');
  fireEvent.changeText(input, '在哪裡？');
  await act(async () => fireEvent.press(view.getByLabelText('詢問手機助理')));
  expect(ask).toHaveBeenLastCalledWith(expect.objectContaining({
    scope: { uid: 'alice', schoolId: 'pu' }, mode: 'device',
    messages: [{ role: 'user', content: '下一堂是什麼？' },
      expect.objectContaining({ role: 'assistant', savedClassRead: course }),
      { role: 'user', content: '在哪裡？' }],
  }));
  expect(view.getByText('在主顧樓 301。')).toBeTruthy();
  expect(open).not.toHaveBeenCalled();
  expect(interpret).not.toHaveBeenCalled();
});

test('stops a pending device answer and preserves the question for retry', async () => {
  const ask = jest.mocked(askCampusAssistant);
  let finish!: (value: Awaited<ReturnType<typeof askCampusAssistant>>) => void;
  ask.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = render(<QuickCampusEntry uid="alice" schoolId="pu" onOpen={jest.fn()} />);
  const input = view.getByLabelText('說出或輸入想做的事');
  fireEvent.changeText(input, '我的課表');
  fireEvent.press(view.getByLabelText('詢問手機助理'));
  fireEvent.press(view.getByLabelText('停止回答'));
  expect(ask.mock.calls[0][0].signal?.aborted).toBe(true);
  await act(async () => finish({ source: 'device', content: '過期回覆', hasActions: false }));
  expect(view.queryByText('過期回覆')).toBeNull();
  expect(input.props.value).toBe('我的課表');
});

test('retains the question if the model is missing and opens model settings only on request', async () => {
  jest.mocked(askCampusAssistant).mockRejectedValueOnce(new OnDeviceAssistantError('model-required'));
  const manage = jest.fn();
  const view = render(<QuickCampusEntry uid="alice" schoolId="pu" onOpen={jest.fn()} onOpenAssistantRoute={manage} />);
  const input = view.getByLabelText('說出或輸入想做的事');
  fireEvent.changeText(input, '幫我準備面試');
  await act(async () => fireEvent(input, 'submitEditing'));
  expect(input.props.value).toBe('幫我準備面試');
  expect(manage).not.toHaveBeenCalled();
  expect(interpret).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('管理手機 AI 模型'));
  expect(manage).toHaveBeenCalledWith('AIModelManager');
});

test.each([
  ['/classroom', '開啟課程與作業'],
  ['/admin', null],
  ['https://example.org', null],
  [undefined, null],
] as const)('only offers a confirmed local service route after an explicit tap (%s)', async (route, label) => {
  jest.mocked(askCampusAssistant).mockResolvedValueOnce({ content: '請核對來源。', source: 'device', hasActions: false, route });
  const open = jest.fn();
  const view = render(<QuickCampusEntry uid="alice" schoolId="pu" onOpen={jest.fn()} onOpenAssistantRoute={open} />);
  const input = view.getByLabelText('說出或輸入想做的事');
  fireEvent.changeText(input, '我交作業了嗎？');
  await act(async () => fireEvent(input, 'submitEditing'));
  expect(view.getByText('請核對來源。')).toBeTruthy();
  expect(open).not.toHaveBeenCalled();
  if (label) {
    fireEvent.press(view.getByText(label));
    expect(open).toHaveBeenCalledWith('CoursesHome');
  } else {
    expect(view.queryByRole('button', { name: /^開啟/ })).toBeNull();
  }
});
