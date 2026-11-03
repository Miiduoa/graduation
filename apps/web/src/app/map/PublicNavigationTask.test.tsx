import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PublicNavigationTask, type PublicTaskPort } from './PublicNavigationTask';
const receipt = {
  from: { id: 'a', name: '甲樓', sourceUrl: 'https://www.openstreetmap.org/way/1' },
  to: { id: 'b', name: '乙館', sourceUrl: 'https://www.openstreetmap.org/way/2' },
  url: 'https://www.google.com/maps/dir/?api=1',
  sourceDate: '2026-10-19',
  sourceLabel: '合成來源',
  mode: 'deterministic',
};
const preview = { request: { synthetic: 'bound request' }, receipt, checkedAt: 123 };
function port(
  call: PublicTaskPort['call'] = vi.fn(async (action: string) =>
    action === 'preview'
      ? preview
      : action === 'confirm'
        ? { confirmationId: 'confirmed' }
        : { status: 'completed', operationId: 'operation-id', result: { receipt } },
  ),
) {
  return { scope: 'account-a', schoolId: 'pu', schoolName: '靜宜', call } as PublicTaskPort;
}
async function input() {
  fireEvent.change(screen.getByLabelText('起點與終點'), { target: { value: '從甲樓到乙館' } });
  fireEvent.click(screen.getByRole('button', { name: '檢視路線' }));
  await screen.findByRole('button', { name: '確認並建立路線' });
}
describe('public navigation task', () => {
  it('previews before explicit confirmation and exposes a real receipt then returns to input', async () => {
    const p = port();
    render(<PublicNavigationTask port={p} />);
    await input();
    expect(p.call).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '幫我找一條路線' }));
    fireEvent.click(screen.getByRole('button', { name: '確認並建立路線' }));
    await screen.findByText('路線已建立');
    expect(vi.mocked(p.call).mock.calls.map((c) => c[0])).toEqual([
      'preview',
      'confirm',
      'execute',
    ]);
    expect(screen.getByRole('link', { name: '在 Google 地圖開啟' }).getAttribute('rel')).toBe(
      'noopener noreferrer',
    );
    fireEvent.click(screen.getByRole('button', { name: '返回輸入' }));
    expect((screen.getByLabelText('起點與終點') as HTMLInputElement).value).toBe('從甲樓到乙館');
  });
  it('cancels the preview without confirming or executing', async () => {
    const p = port();
    render(<PublicNavigationTask port={p} />);
    await input();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(p.call).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByLabelText('起點與終點'));
  });
  it('drops late preview after account/school change and does not reuse draft', async () => {
    let resolve!: (v: unknown) => void;
    const call = vi.fn(
      (_action: string, _body: unknown, _signal: AbortSignal) =>
        new Promise<unknown>((r) => {
          void _action;
          void _body;
          void _signal;
          resolve = r;
        }),
    );
    const p = port(call);
    const view = render(<PublicNavigationTask port={p} />);
    fireEvent.change(screen.getByLabelText('起點與終點'), { target: { value: '從甲樓到乙館' } });
    fireEvent.click(screen.getByRole('button', { name: '檢視路線' }));
    view.rerender(<PublicNavigationTask port={{ ...p, scope: 'account-b' }} />);
    await act(async () => resolve(preview));
    expect(screen.queryByRole('button', { name: '確認並建立路線' })).toBeNull();
    expect((screen.getByLabelText('起點與終點') as HTMLInputElement).value).toBe('');
    expect(call.mock.calls[0]?.[2]?.aborted).toBe(true);
  });
  it('guards duplicate click synchronously while confirmation is pending', async () => {
    let resolve!: (v: unknown) => void;
    const call = vi.fn(async (action: string) =>
      action === 'preview'
        ? preview
        : action === 'confirm'
          ? new Promise((r) => {
              resolve = r;
            })
          : { status: 'completed', operationId: 'done', result: { receipt } },
    );
    render(<PublicNavigationTask port={port(call)} />);
    await input();
    const button = screen.getByRole('button', { name: '確認並建立路線' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(call.mock.calls.map((c) => c[0])).toEqual(['preview', 'confirm']);
    await act(async () => resolve({ confirmationId: 'id' }));
    await screen.findByText('路線已建立');
    expect(call).toHaveBeenCalledTimes(3);
  });
  it('unknown execution offers only lookup of the original request, never resends', async () => {
    const call = vi.fn(async (action: string) => {
      if (action === 'preview') return preview;
      if (action === 'confirm') return { confirmationId: 'id' };
      if (action === 'execute') throw new Error('PUBLIC_AGENT_OUTCOME_UNKNOWN');
      return { status: 'unknown', operationId: 'id' };
    });
    render(<PublicNavigationTask port={port(call)} />);
    await input();
    fireEvent.click(screen.getByRole('button', { name: '確認並建立路線' }));
    await screen.findByRole('button', { name: '查詢原任務' });
    expect(screen.queryByRole('button', { name: '確認並建立路線' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查詢原任務' }));
    await waitFor(() => expect(call).toHaveBeenCalledTimes(4));
    expect(call.mock.calls.map((c) => c[0])).toEqual(['preview', 'confirm', 'execute', 'read']);
  });
  it('source failure retains input and exposes retry', async () => {
    const call = vi.fn(async () => {
      throw new Error('PUBLIC_AGENT_SOURCE_UNAVAILABLE');
    });
    render(<PublicNavigationTask port={port(call)} />);
    fireEvent.change(screen.getByLabelText('起點與終點'), { target: { value: '從甲樓到乙館' } });
    fireEvent.click(screen.getByRole('button', { name: '檢視路線' }));
    await screen.findByRole('alert');
    expect((screen.getByLabelText('起點與終點') as HTMLInputElement).value).toBe('從甲樓到乙館');
    expect((screen.getByRole('button', { name: '檢視路線' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
  it('keeps an unconfirmed result locked when lookup finds no operation yet', async () => {
    const call = vi.fn(async (action: string) => {
      if (action === 'preview') return preview;
      if (action === 'confirm') return { confirmationId: 'id' };
      if (action === 'execute') throw new Error('PUBLIC_AGENT_OUTCOME_UNKNOWN');
      return null;
    });
    render(<PublicNavigationTask port={port(call)} />);
    await input();
    fireEvent.click(screen.getByRole('button', { name: '確認並建立路線' }));
    fireEvent.click(await screen.findByRole('button', { name: '查詢原任務' }));
    await waitFor(() => expect(call).toHaveBeenCalledTimes(4));
    expect(screen.queryByRole('button', { name: '確認並建立路線' })).toBeNull();
    expect(screen.getByRole('button', { name: '查詢原任務' })).toBeTruthy();
  });
  it('reports a definitive quota refusal and allows retry of the same preview', async () => {
    const call = vi.fn(async (action: string) => {
      if (action === 'preview') return preview;
      if (action === 'confirm') return { confirmationId: 'id' };
      throw new Error('PUBLIC_AGENT_FREE_QUOTA_UNAVAILABLE');
    });
    render(<PublicNavigationTask port={port(call)} />);
    await input();
    fireEvent.click(screen.getByRole('button', { name: '確認並建立路線' }));
    expect((await screen.findByRole('alert')).textContent).toContain('次數已用完');
    expect(screen.getByRole('button', { name: '確認並建立路線' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '查詢原任務' })).toBeNull();
  });
});
