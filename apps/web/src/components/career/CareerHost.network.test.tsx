import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CareerHost } from './CareerHost';
import { internshipRecord } from '@campus/shared/testFixtures/careerInternship';
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: { uid: 'student' } }) }));
vi.mock('@/lib/firebase', () => ({
  getAuth: () => ({ currentUser: { uid: 'student', getIdToken: async () => 'fixture' } }),
  getCloudFunctionUrl: (name: string) => `/api/fn/${name}`,
}));
vi.mock('@/lib/timetable/store', () => ({ loadPersonalTimetable: async () => ({ courses: [] }) }));
vi.mock('./CareerWorkstudy', () => ({ CareerWorkstudy: () => null }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(['student', 'staff'])(
  'preserves %s drafts through a host network failure and successful poll',
  async (audience) => {
    vi.useFakeTimers();
    const record = internshipRecord();
    const snapshot = {
      rules: [record.rule],
      records: [record],
      audit: [],
      advisors: [{ uid: 'teacher', name: '測試指導老師', email: 'teacher@school.edu.tw' }],
      canManage: audience === 'staff',
    };
    let offline = false;
    const fetcher = vi.fn(async () => {
      if (offline) throw new TypeError('Failed to fetch');
      return { ok: true, json: async () => ({ result: { snapshot } }) };
    });
    vi.stubGlobal('fetch', fetcher);
    const view = render(<CareerHost schoolId="pu" />);
    await act(async () => {});
    if (audience === 'staff') {
      fireEvent.click(view.getByText('新增系所規則'));
      fireEvent.change(view.getByLabelText('系所'), { target: { value: '未送出的系所' } });
    } else {
      fireEvent.change(view.getByLabelText('實習機構'), { target: { value: '未送出的機構' } });
      fireEvent.change(view.getByLabelText('申請文件連結'), {
        target: { value: 'https://example.test/draft' },
      });
      fireEvent.click(view.getByText('選擇測試系規則'));
      fireEvent.click(view.getByText(/測試指導老師｜teacher@school.edu.tw/));
    }
    offline = true;
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(view.getAllByText('職涯服務暫時無法使用，請重新整理。').length).toBeGreaterThan(0);
    expect(
      (view.getByLabelText(audience === 'staff' ? '系所' : '實習機構') as HTMLInputElement).value,
    ).toBe(audience === 'staff' ? '未送出的系所' : '未送出的機構');
    offline = false;
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(view.queryByText('職涯服務暫時無法使用，請重新整理。')).toBeNull();
    expect(
      (view.getByLabelText(audience === 'staff' ? '系所' : '實習機構') as HTMLInputElement).value,
    ).toBe(audience === 'staff' ? '未送出的系所' : '未送出的機構');
    if (audience === 'student') {
      expect((view.getByLabelText('申請文件連結') as HTMLInputElement).value).toBe(
        'https://example.test/draft',
      );
      expect(view.queryByText('請先在上方選擇系所規則，再填寫以下資料。')).toBeNull();
      expect(view.getByText(/已選擇指導老師：.*測試指導老師/)).toBeTruthy();
    }
    view.unmount();
  },
);
