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

  it('keeps working with corrupt browser storage without trusting it as a transcript', async () => {
    window.localStorage.setItem(creditPlanStorageKey('u1', 'pu'), '{bad');
    renderWorkspace();
    expect((await screen.findByLabelText('已確認可採計學分（自行填寫）') as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/先前的本機草稿格式有誤/)).toBeTruthy();
    expect(screen.getByText(/這份規劃不等於畢業資格審查/)).toBeTruthy();
    expect(emptyCreditPlan().recognized).toBe('');
  });
});
