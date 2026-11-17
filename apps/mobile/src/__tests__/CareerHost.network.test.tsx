import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CareerHost } from '../components/career/CareerHost';
import { internshipRecord } from '../../../../packages/shared/testFixtures/careerInternship';
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: 'student' } }) }));
jest.mock('../firebase', () => ({
  getAuthInstance: () => ({ currentUser: { uid: 'student', getIdToken: async () => 'fixture' } }),
}));
jest.mock('../services/personalTimetable', () => ({
  loadPersonalTimetable: async () => ({ courses: [] }),
}));
jest.mock('../components/career/CareerWorkstudy', () => ({ CareerWorkstudy: () => null }));
const originalFetch = global.fetch;
afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
});

it.each(['student', 'staff'])(
  'preserves %s drafts through a host network failure and successful poll',
  async (audience) => {
    jest.useFakeTimers();
    try {
      const record = internshipRecord();
      const snapshot = {
        rules: [record.rule],
        records: [record],
        audit: [],
        advisors: [{ uid: 'teacher', name: '測試指導老師', email: 'teacher@school.edu.tw' }],
        canManage: audience === 'staff',
      };
      let offline = false;
      const fetcher = jest.fn(async () => {
        if (offline) throw new TypeError('Failed to fetch');
        return { ok: true, json: async () => ({ result: { snapshot } }) };
      });
      global.fetch = fetcher as unknown as typeof fetch;
      const view = render(<CareerHost schoolId="pu" />);
      await act(async () => {});
      if (audience === 'staff') {
        fireEvent.press(view.getByText('新增系所規則'));
        fireEvent.changeText(view.getByLabelText('系所'), '未送出的系所');
      } else {
        fireEvent.changeText(view.getByLabelText('實習機構'), '未送出的機構');
        fireEvent.changeText(view.getByLabelText('申請文件連結'), 'https://example.test/draft');
        fireEvent.press(view.getByText('選擇測試系規則'));
        fireEvent.press(view.getByText(/測試指導老師｜teacher@school.edu.tw/));
      }
      offline = true;
      await act(async () => {
        jest.advanceTimersByTime(10000);
      });
      expect(view.getAllByText('職涯服務暫時無法使用，請重新整理。').length).toBeGreaterThan(0);
      expect(view.getByLabelText(audience === 'staff' ? '系所' : '實習機構').props.value).toBe(
        audience === 'staff' ? '未送出的系所' : '未送出的機構',
      );
      offline = false;
      await act(async () => {
        jest.advanceTimersByTime(10000);
      });
      expect(view.queryByText('職涯服務暫時無法使用，請重新整理。')).toBeNull();
      expect(view.getByLabelText(audience === 'staff' ? '系所' : '實習機構').props.value).toBe(
        audience === 'staff' ? '未送出的系所' : '未送出的機構',
      );
      if (audience === 'student') {
        expect(view.getByLabelText('申請文件連結').props.value).toBe('https://example.test/draft');
        expect(view.queryByText('請先在上方選擇系所規則，再填寫以下資料。')).toBeNull();
        expect(view.getByText(/已選擇指導老師：.*測試指導老師/)).toBeTruthy();
      }
      view.unmount();
    } finally {
      jest.useRealTimers();
    }
  },
);
