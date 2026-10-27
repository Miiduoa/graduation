import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreditPlannerWorkspace } from './CreditPlannerWorkspace';
import { creditPlanStorageKey, emptyCreditPlan } from '@/lib/creditPlanner';

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function renderWorkspace(userId: string | null = 'u1', schoolId: string | null = 'pu') {
  return render(
    <CreditPlannerWorkspace
      key={JSON.stringify([userId, schoolId])}
      userId={userId}
      schoolId={schoolId}
      schoolName={schoolId === 'pu' ? '靜宜大學' : '其他學校'}
    />,
  );
}

describe('personal credit workspace', () => {
  it('calculates a manual scenario without claiming unfinished courses as earned credits', async () => {
    renderWorkspace();
    const recognized = await screen.findByLabelText('已確認可採計學分（自行填寫）');
    fireEvent.change(recognized, { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText('希望累計的學分'), { target: { value: '128' } });
    fireEvent.change(screen.getByLabelText('預計再修學分'), { target: { value: '20' } });
    expect(screen.getByRole('status').textContent).toContain('48 學分');
    expect(screen.getByRole('status').textContent).toContain('68 學分');
    fireEvent.change(screen.getByLabelText('課程名稱'), { target: { value: '資料庫系統' } });
    fireEvent.click(screen.getByRole('button', { name: '加入規劃' }));
    expect(screen.getByText('資料庫系統')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('45 學分');
    expect((recognized as HTMLInputElement).value).toBe('60');
    await waitFor(() => {
      const raw = window.localStorage.getItem(creditPlanStorageKey('u1', 'pu'));
      expect(raw).toContain('資料庫系統');
    });
  });

  it('shows honest workload projections, not official graduation approval', async () => {
    renderWorkspace();
    const recognized = await screen.findByLabelText('已確認可採計學分（自行填寫）');
    fireEvent.change(recognized, { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText('希望累計的學分'), { target: { value: '128' } });
    fireEvent.change(screen.getByLabelText('預計再修學分'), { target: { value: '20' } });
    const panel = screen.getByRole('region', { name: '距離你的修課目標，還需要什麼？' });
    expect(panel.textContent).toContain('每學期平均還需17');
    expect(panel.textContent).toContain('尚未分配學期68');
    expect(panel.textContent).toContain('全部規劃通過仍缺48');
    expect(panel.textContent).toContain('不會私自把其他預計學分塞進某個學期');
    expect(panel.textContent).toContain('累積 60');

    fireEvent.change(screen.getByLabelText('課程名稱'), { target: { value: '程式設計' } });
    fireEvent.click(screen.getByRole('button', { name: '加入規劃' }));
    expect(panel.textContent).toContain('尚未分配學期65');
    expect(panel.textContent).toContain('累積 63');
    expect(panel.textContent).toContain('個人總學分目標');
  });

  it('supports edit, remove and undo in a single page', async () => {
    renderWorkspace();
    await screen.findByLabelText('課程名稱');
    fireEvent.change(screen.getByLabelText('課程名稱'), { target: { value: '經濟學' } });
    fireEvent.click(screen.getByRole('button', { name: '加入規劃' }));
    fireEvent.click(screen.getByRole('button', { name: '編輯經濟學' }));
    fireEvent.change(screen.getByLabelText('課程名稱'), { target: { value: '管理學' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存修改' }));
    expect(screen.queryByText('經濟學')).toBeNull();
    expect(screen.getByText('管理學')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '移除管理學' }));
    expect(screen.queryByText('管理學')).toBeNull();
    expect(screen.getByText('尚未安排任何課程')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '復原' }));
    expect(screen.getByText('管理學')).toBeTruthy();
  });

  it('reloads the correct browser plan and never shows another account or campus', async () => {
    const first = renderWorkspace();
    const approved = await screen.findByLabelText('已確認可採計學分（自行填寫）');
    fireEvent.change(approved, { target: { value: '56' } });
    await waitFor(() => {
      expect(window.localStorage.getItem(creditPlanStorageKey('u1', 'pu'))).toContain('"56"');
    });
    first.unmount();
    const another = renderWorkspace('u2');
    expect((await screen.findByLabelText('已確認可採計學分（自行填寫）') as HTMLInputElement).value).toBe('');
    another.unmount();
    const otherCampus = renderWorkspace('u1', 'nthu');
    expect((await screen.findByLabelText('已確認可採計學分（自行填寫）') as HTMLInputElement).value).toBe('');
    otherCampus.unmount();
    renderWorkspace('u1', 'pu');
    await waitFor(() => {
      expect((screen.getByLabelText('已確認可採計學分（自行填寫）') as HTMLInputElement).value).toBe('56');
    });
  });

  it('tracks manual category gaps and separate non-credit conditions', async () => {
    renderWorkspace();
    await screen.findByLabelText('課程名稱');
    fireEvent.change(screen.getByLabelText('已確認可採計學分（自行填寫）'), {
      target: { value: '60' },
    });
    fireEvent.change(screen.getByLabelText('課程名稱'), { target: { value: '資料庫系統' } });
    fireEvent.change(screen.getByLabelText('類別（自行分類）'), { target: { value: 'required' } });
    fireEvent.click(screen.getByRole('button', { name: '加入規劃' }));
    fireEvent.click(screen.getByText('進階檢查：分類門檻與非學分條件'));
    fireEvent.change(screen.getByLabelText('必修已確認採計學分'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('必修目標門檻'), { target: { value: '30' } });
    expect(screen.getByText(/此類還差 7 學分/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('新增條件'), {
      target: { value: '英文能力門檻' },
    });
    fireEvent.click(screen.getByRole('button', { name: '加入條件' }));
    expect(screen.getByText('自行勾選 0 / 1 項')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: '英文能力門檻' }));
    expect(screen.getByText('自行勾選 1 / 1 項')).toBeTruthy();
    const raw = window.localStorage.getItem(creditPlanStorageKey('u1', 'pu'));
    expect(raw).toContain('英文能力門檻');
    expect(raw).toContain('"done":true');
  });

  it('keeps working with corrupt browser storage without trusting it as a transcript', async () => {
    window.localStorage.setItem(creditPlanStorageKey('u1', 'pu'), '{bad');
    renderWorkspace();
    expect((await screen.findByLabelText('已確認可採計學分（自行填寫）') as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/先前的本機草稿格式有誤/)).toBeTruthy();
    expect(screen.getByText(/這份規劃不等於畢業資格審查/)).toBeTruthy();
    expect(emptyCreditPlan().recognized).toBe('');
  });
  it('restores valid backup only with confirmation and keeps the active campus scope', async () => {
    const workspace = renderWorkspace();
    await screen.findByLabelText('課程名稱');
    fireEvent.change(screen.getByLabelText('已確認可採計學分（自行填寫）'), { target: { value: '20' } });
    const restored = {
      ...emptyCreditPlan(), recognized: '64', target: '128',
      courses: [{ id: 'c1', name: '資訊倫理', credits: 2, category: 'general', term: 2, status: 'registered' }],
    };
    const file = new File([JSON.stringify(restored)], 'credits.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(JSON.stringify(restored)) });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);

    fireEvent.change(screen.getByLabelText('匯入 JSON 備份'), { target: { files: [file] } });
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect((screen.getByLabelText('已確認可採計學分（自行填寫）') as HTMLInputElement).value).toBe('20');
    fireEvent.change(screen.getByLabelText('匯入 JSON 備份'), { target: { files: [file] } });
    await waitFor(() => expect((screen.getByLabelText('已確認可採計學分（自行填寫）') as HTMLInputElement).value).toBe('64'));
    expect(screen.getByText('資訊倫理')).toBeTruthy();
    // 備份解析先更新畫面，持久化由後續 effect 完成，必須等到真正寫入才驗證。
    await waitFor(() => {
      const raw = window.localStorage.getItem(creditPlanStorageKey('u1', 'pu'));
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toEqual(restored);
    });
    expect(window.localStorage.getItem(creditPlanStorageKey('u2', 'pu'))).toBeNull();
    workspace.unmount();
    renderWorkspace();
    expect((await screen.findByLabelText('已確認可採計學分（自行填寫）') as HTMLInputElement).value).toBe('64');
    expect(screen.getByText('資訊倫理')).toBeTruthy();
  });

  it('rejects malformed JSON without changing the working plan', async () => {
    renderWorkspace();
    await screen.findByLabelText('課程名稱');
    fireEvent.change(screen.getByLabelText('已確認可採計學分（自行填寫）'), { target: { value: '33' } });
    const file = new File(['{bad'], 'broken.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue('{bad') });
    const confirm = vi.spyOn(window, 'confirm');
    fireEvent.change(screen.getByLabelText('匯入 JSON 備份'), { target: { files: [file] } });
    await screen.findByText(/備份格式不符或資料無效/);
    expect(confirm).not.toHaveBeenCalled();
    expect((screen.getByLabelText('已確認可採計學分（自行填寫）') as HTMLInputElement).value).toBe('33');
  });

  it('does not overwrite damaged browser draft until the student changes the plan', async () => {
    const key = creditPlanStorageKey('u1', 'pu');
    window.localStorage.setItem(key, '{original-broken');
    renderWorkspace();
    await screen.findByLabelText('已確認可採計學分（自行填寫）');
    expect(window.localStorage.getItem(key)).toBe('{original-broken');
    fireEvent.change(screen.getByLabelText('已確認可採計學分（自行填寫）'), { target: { value: '12' } });
    await waitFor(() => expect(window.localStorage.getItem(key)).toContain('"12"'));
  });

});
