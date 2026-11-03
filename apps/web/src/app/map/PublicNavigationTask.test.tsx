import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PublicNavigationTask, type PublicTaskPort } from './PublicNavigationTask';
const id = 'pago_00000000-0000-4000-8000-000000000001';
const receipt = {
  from: { id: 'a', name: '甲樓', sourceUrl: 'https://www.openstreetmap.org/way/1' },
  to: { id: 'b', name: '乙館', sourceUrl: 'https://www.openstreetmap.org/way/2' },
  url: 'https://www.google.com/maps/dir/?api=1',
  sourceDate: '2026-10-19',
  sourceLabel: '合成來源',
  mode: 'deterministic',
};
const preview = { request: { synthetic: 'bound request' }, receipt, checkedAt: 123 };
const complete = { status: 'completed', operationId: id, result: { receipt } };
function make(call: PublicTaskPort['call']) {
  return { scope: 'account-a', schoolId: 'pu', schoolName: '靜宜', call } satisfies PublicTaskPort;
}
function normal() {
  return vi.fn<PublicTaskPort['call']>(async (action: string) =>
    action === 'status'
      ? null
      : action === 'preview'
        ? preview
        : action === 'confirm'
          ? { confirmationId: 'id' }
          : action === 'ack'
            ? { status: 'acknowledged', operationId: id }
            : complete,
  );
}
async function prepare() {
  const field = await screen.findByLabelText('起點與終點');
  fireEvent.change(field, { target: { value: '從甲樓到乙館' } });
  fireEvent.click(screen.getByRole('button', { name: '檢視路線' }));
  await screen.findByRole('button', { name: '確認並建立路線' });
}
describe('durable public navigation gate', () => {
  it('checks status before input, executes only after confirmation, and explicitly closes the receipt', async () => {
    const call = normal();
    render(<PublicNavigationTask port={make(call)} />);
    await prepare();
    expect(call.mock.calls.map((c) => c[0])).toEqual(['status', 'preview']);
    fireEvent.click(screen.getByRole('button', { name: '確認並建立路線' }));
    await screen.findByText('路線已建立');
    expect(screen.queryByLabelText('起點與終點')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '結案並開始新任務' }));
    fireEvent.click(screen.getByRole('button', { name: '取消結案' }));
    expect(call.mock.calls.some((c) => c[0] === 'ack')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '結案並開始新任務' }));
    fireEvent.click(screen.getByRole('button', { name: '確認結案' }));
    await screen.findByLabelText('起點與終點');
    expect(call.mock.calls.map((c) => c[0])).toEqual([
      'status',
      'preview',
      'confirm',
      'execute',
      'ack',
      'status',
    ]);
    expect(call.mock.calls.find((c) => c[0] === 'ack')?.[1]).toEqual({
      task: 'public-campus-navigation',
      schoolId: 'pu',
      operationId: id,
      approved: true,
    });
  });
  it('fails closed on initial status error or invalid response, and retries', async () => {
    let n = 0;
    const call = vi.fn<PublicTaskPort['call']>(async (action: string) => {
      if (action === 'status' && ++n === 1) throw new Error('offline');
      return action === 'status' ? null : preview;
    });
    render(<PublicNavigationTask port={make(call)} />);
    await screen.findByRole('alert');
    expect(screen.queryByLabelText('起點與終點')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新查詢狀態' }));
    await screen.findByLabelText('起點與終點');
    const invalid = vi.fn<PublicTaskPort['call']>(async () => ({
      status: 'completed',
      operationId: 'wrong',
    }));
    const view = render(<PublicNavigationTask port={{ ...make(invalid), scope: 'b' }} />);
    await waitFor(() => expect(invalid).toHaveBeenCalled());
    expect(view.container.querySelector('input')).toBeNull();
  });
  it.each(['pending', 'unknown'])(
    'reload exposes opaque %s status and never shows old query or resend',
    async (status) => {
      const call = vi.fn<PublicTaskPort['call']>(async () => ({
        status,
        operationId: id,
        query: '私人舊內容',
        result: { receipt },
      }));
      render(<PublicNavigationTask port={make(call)} />);
      await screen.findByText(/任務結果尚未確認/);
      expect(screen.queryByText('私人舊內容')).toBeNull();
      expect(screen.queryByText('路線已建立')).toBeNull();
      expect(screen.queryByLabelText('起點與終點')).toBeNull();
      expect(screen.queryByRole('button', { name: '確認並建立路線' })).toBeNull();
    },
  );
  it.each(['completed', 'failed'])(
    'reload requires explicit acknowledgement for opaque %s',
    async (status) => {
      let acknowledged = false;
      const call = vi.fn<PublicTaskPort['call']>(async (action: string) => {
        if (action === 'status')
          return acknowledged ? null : { status, operationId: id, result: { receipt } };
        acknowledged = true;
        return { status: 'acknowledged', operationId: id };
      });
      render(<PublicNavigationTask port={make(call)} />);
      await screen.findByRole('button', { name: '結案並開始新任務' });
      expect(screen.queryByText('路線已建立')).toBeNull();
      expect(call.mock.calls.some((c) => c[0] === 'ack')).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: '結案並開始新任務' }));
      fireEvent.click(screen.getByRole('button', { name: '確認結案' }));
      const field = await screen.findByLabelText('起點與終點');
      expect(document.activeElement).toBe(field);
    },
  );
  it('keeps failed or uncertain acknowledgement locked and retries the original id even when lookup returns null', async () => {
    let checks = 0,
      acks = 0;
    const call = vi.fn<PublicTaskPort['call']>(async (action: string) => {
      if (action === 'status')
        return ++checks === 1 ? { status: 'completed', operationId: id } : null;
      if (action === 'ack' && ++acks === 1) throw new Error('lost');
      return { status: 'acknowledged', operationId: id };
    });
    render(<PublicNavigationTask port={make(call)} />);
    fireEvent.click(await screen.findByRole('button', { name: '結案並開始新任務' }));
    fireEvent.click(screen.getByRole('button', { name: '確認結案' }));
    await screen.findByRole('alert');
    expect(screen.queryByLabelText('起點與終點')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查詢原任務' }));
    await waitFor(() => expect(checks).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: '確認結案' }));
    await screen.findByLabelText('起點與終點');
    expect(acks).toBe(2);
    expect(
      call.mock.calls
        .filter((c) => c[0] === 'ack')
        .every((c) => (c[1] as { operationId: string }).operationId === id),
    ).toBe(true);
  });
  it('retains unknown lock if status returns null after execute response is lost', async () => {
    const call = vi.fn<PublicTaskPort['call']>(async (action: string) =>
      action === 'status'
        ? null
        : action === 'preview'
          ? preview
          : action === 'confirm'
            ? { confirmationId: 'id' }
            : Promise.reject(new Error('lost')),
    );
    render(<PublicNavigationTask port={make(call)} />);
    await prepare();
    fireEvent.click(screen.getByRole('button', { name: '確認並建立路線' }));
    fireEvent.click(await screen.findByRole('button', { name: '查詢原任務' }));
    await waitFor(() => expect(call.mock.calls.filter((c) => c[0] === 'status')).toHaveLength(2));
    expect(screen.queryByLabelText('起點與終點')).toBeNull();
    expect(screen.queryByRole('button', { name: '確認並建立路線' })).toBeNull();
  });
  it('on open-operation conflict refreshes status rather than claiming execution', async () => {
    let count = 0;
    const call = vi.fn<PublicTaskPort['call']>(async (action: string) =>
      action === 'status'
        ? ++count === 1
          ? null
          : { status: 'pending', operationId: id }
        : action === 'preview'
          ? preview
          : Promise.reject(new Error('PUBLIC_AGENT_OPEN_OPERATION')),
    );
    render(<PublicNavigationTask port={make(call)} />);
    await prepare();
    fireEvent.click(screen.getByRole('button', { name: '確認並建立路線' }));
    await screen.findByText(/任務結果尚未確認/);
    expect(call.mock.calls.filter((c) => c[0] === 'execute')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: '確認並建立路線' })).toBeNull();
  });
  it('discards late status and confirmation after account/school changes', async () => {
    let finish!: (v: unknown) => void;
    const old = vi.fn(
      async () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const fresh = normal();
    const view = render(<PublicNavigationTask port={make(old)} />);
    await waitFor(() => expect(old).toHaveBeenCalled());
    view.rerender(
      <PublicNavigationTask port={{ ...make(fresh), scope: 'account-b', schoolId: 'other' }} />,
    );
    await screen.findByLabelText('起點與終點');
    await act(async () => finish({ status: 'completed', operationId: id }));
    expect(screen.queryByRole('button', { name: '結案並開始新任務' })).toBeNull();
    let confirm!: (v: unknown) => void;
    const delayed = vi.fn<PublicTaskPort['call']>(async (action: string) =>
      action === 'status'
        ? null
        : action === 'preview'
          ? preview
          : new Promise((resolve) => {
              confirm = resolve;
            }),
    );
    view.rerender(<PublicNavigationTask port={{ ...make(delayed), scope: 'account-c' }} />);
    await prepare();
    fireEvent.click(screen.getByRole('button', { name: '確認並建立路線' }));
    await waitFor(() => expect(delayed.mock.calls.some((c) => c[0] === 'confirm')).toBe(true));
    view.rerender(<PublicNavigationTask port={{ ...make(fresh), scope: 'account-d' }} />);
    await act(async () => confirm({ confirmationId: 'late' }));
    expect(delayed.mock.calls.some((c) => c[0] === 'execute')).toBe(false);
  });
  it('StrictMode remount starts a fresh status check after cleanup', async () => {
    const call = normal();
    render(
      <StrictMode>
        <PublicNavigationTask port={make(call)} />
      </StrictMode>,
    );
    await screen.findByLabelText('起點與終點');
    expect(call.mock.calls.filter((c) => c[0] === 'status').length).toBeGreaterThanOrEqual(1);
  });
  it('retrieves the source-revalidated receipt only through original request after pending becomes complete', async () => {
    let checks = 0;
    const call = vi.fn<PublicTaskPort['call']>(async (action: string) => {
      if (action === 'status')
        return ++checks === 1 ? null : { status: 'completed', operationId: id };
      if (action === 'preview') return preview;
      if (action === 'confirm') return { confirmationId: 'id' };
      if (action === 'execute') return { status: 'pending', operationId: id };
      if (action === 'read') return complete;
      return { status: 'acknowledged', operationId: id };
    });
    render(<PublicNavigationTask port={make(call)} />);
    await prepare();
    fireEvent.click(screen.getByRole('button', { name: '確認並建立路線' }));
    fireEvent.click(await screen.findByRole('button', { name: '查詢原任務' }));
    await screen.findByText('路線已建立');
    expect(call.mock.calls.filter((c) => c[0] === 'read')[0]?.[1]).toEqual(preview.request);
    expect(call.mock.calls.some((c) => c[0] === 'ack')).toBe(false);
  });
  it('keeps terminal lock when source-revalidated receipt retrieval fails and can retry', async () => {
    let checks = 0,
      reads = 0;
    const call = vi.fn<PublicTaskPort['call']>(async (action: string) => {
      if (action === 'status')
        return ++checks === 1 ? null : { status: 'completed', operationId: id };
      if (action === 'preview') return preview;
      if (action === 'confirm') return { confirmationId: 'id' };
      if (action === 'execute') return { status: 'pending', operationId: id };
      if (action === 'read') {
        if (++reads === 1) throw new Error('PUBLIC_AGENT_SOURCE_CHANGED');
        return complete;
      }
    });
    render(<PublicNavigationTask port={make(call)} />);
    await prepare();
    fireEvent.click(screen.getByRole('button', { name: '確認並建立路線' }));
    fireEvent.click(await screen.findByRole('button', { name: '查詢原任務' }));
    await screen.findByText(/無法取得經來源確認的回執/);
    expect(screen.queryByText('路線已建立')).toBeNull();
    expect(screen.queryByLabelText('起點與終點')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查詢原任務' }));
    await screen.findByText('路線已建立');
    expect(reads).toBe(2);
  });
  it('rejects an invalid acknowledgement and never sends duplicate acknowledgements on double click', async () => {
    let finish!: (value: unknown) => void;
    const call = vi.fn<PublicTaskPort['call']>(async (action: string) =>
      action === 'status'
        ? { status: 'completed', operationId: id }
        : new Promise((resolve) => {
            finish = resolve;
          }),
    );
    render(<PublicNavigationTask port={make(call)} />);
    fireEvent.click(await screen.findByRole('button', { name: '結案並開始新任務' }));
    const button = screen.getByRole('button', { name: '確認結案' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(call.mock.calls.filter((c) => c[0] === 'ack')).toHaveLength(1);
    await act(async () => finish({ status: 'acknowledged', operationId: 'another' }));
    await screen.findByRole('alert');
    expect(screen.queryByLabelText('起點與終點')).toBeNull();
  });
  it('ignores a late acknowledgement after cancellation and remains locked', async () => {
    let finish!: (value: unknown) => void;
    const call = vi.fn<PublicTaskPort['call']>(async (action: string) =>
      action === 'status'
        ? { status: 'completed', operationId: id }
        : new Promise((resolve) => {
            finish = resolve;
          }),
    );
    render(<PublicNavigationTask port={make(call)} />);
    fireEvent.click(await screen.findByRole('button', { name: '結案並開始新任務' }));
    fireEvent.click(screen.getByRole('button', { name: '確認結案' }));
    fireEvent.click(screen.getByRole('button', { name: '停止等待' }));
    await act(async () => finish({ status: 'acknowledged', operationId: id }));
    expect(screen.queryByLabelText('起點與終點')).toBeNull();
    expect(screen.getByRole('button', { name: '查詢原任務' })).toBeTruthy();
  });
  it('removes a previously visible receipt if a later source revalidation fails', async () => {
    let checks = 0;
    const call = vi.fn<PublicTaskPort['call']>(async (action) => {
      if (action === 'status')
        return ++checks === 1 ? null : { status: 'completed', operationId: id };
      if (action === 'preview') return preview;
      if (action === 'confirm') return { confirmationId: 'id' };
      if (action === 'execute') return complete;
      if (action === 'read') throw new Error('PUBLIC_AGENT_SOURCE_CHANGED');
    });
    render(<PublicNavigationTask port={make(call)} />);
    await prepare();
    fireEvent.click(screen.getByRole('button', { name: '確認並建立路線' }));
    await screen.findByText('路線已建立');
    fireEvent.click(screen.getByRole('button', { name: '查詢原任務' }));
    await screen.findByText(/無法取得經來源確認的回執/);
    expect(screen.queryByText('路線已建立')).toBeNull();
    expect(screen.queryByRole('link', { name: '在 Google 地圖開啟' })).toBeNull();
    expect(screen.queryByLabelText('起點與終點')).toBeNull();
  });
  it('removes a prior receipt when the status recheck itself fails', async () => {
    let checks = 0;
    const call = vi.fn<PublicTaskPort['call']>(async (action) => {
      if (action === 'status') {
        if (++checks === 1) return null;
        throw new Error('offline');
      }
      if (action === 'preview') return preview;
      if (action === 'confirm') return { confirmationId: 'id' };
      return complete;
    });
    render(<PublicNavigationTask port={make(call)} />);
    await prepare();
    fireEvent.click(screen.getByRole('button', { name: '確認並建立路線' }));
    await screen.findByText('路線已建立');
    fireEvent.click(screen.getByRole('button', { name: '查詢原任務' }));
    await screen.findByText(/無法確認先前任務狀態/);
    expect(screen.queryByText('路線已建立')).toBeNull();
    expect(screen.queryByRole('link', { name: '在 Google 地圖開啟' })).toBeNull();
    expect(screen.queryByLabelText('起點與終點')).toBeNull();
  });
  it('rechecks status after ack and blocks a new task created in another tab', async () => {
    let checks = 0;
    const otherId = 'pago_00000000-0000-4000-8000-000000000002';
    const call = vi.fn<PublicTaskPort['call']>(async (action) => {
      if (action === 'status')
        return ++checks === 1
          ? { status: 'completed', operationId: id }
          : { status: 'pending', operationId: otherId };
      if (action === 'ack') return { status: 'acknowledged', operationId: id };
      throw new Error('unexpected action');
    });
    render(<PublicNavigationTask port={make(call)} />);
    fireEvent.click(await screen.findByRole('button', { name: '結案並開始新任務' }));
    fireEvent.click(screen.getByRole('button', { name: '確認結案' }));
    await screen.findByText(/任務結果尚未確認/);
    expect(screen.queryByLabelText('起點與終點')).toBeNull();
    expect(screen.queryByRole('button', { name: '確認並建立路線' })).toBeNull();
    expect(call.mock.calls.map((c) => c[0])).toEqual(['status', 'ack', 'status']);
  });
  it('stays locked when the status recheck after a successful ack fails', async () => {
    let checks = 0;
    const call = vi.fn<PublicTaskPort['call']>(async (action) => {
      if (action === 'status') {
        if (++checks === 1) return { status: 'completed', operationId: id };
        throw new Error('offline');
      }
      return { status: 'acknowledged', operationId: id };
    });
    render(<PublicNavigationTask port={make(call)} />);
    fireEvent.click(await screen.findByRole('button', { name: '結案並開始新任務' }));
    fireEvent.click(screen.getByRole('button', { name: '確認結案' }));
    await screen.findByRole('alert');
    expect(screen.queryByLabelText('起點與終點')).toBeNull();
    expect(screen.getByRole('button', { name: '確認結案' })).toBeTruthy();
  });
  it('hides a prior receipt immediately while status revalidation is pending', async () => {
    let checks = 0,
      finish!: (value: unknown) => void;
    const call = vi.fn<PublicTaskPort['call']>(async (action) => {
      if (action === 'status')
        return ++checks === 1
          ? null
          : new Promise((resolve) => {
              finish = resolve;
            });
      if (action === 'preview') return preview;
      if (action === 'confirm') return { confirmationId: 'id' };
      return complete;
    });
    render(<PublicNavigationTask port={make(call)} />);
    await prepare();
    fireEvent.click(screen.getByRole('button', { name: '確認並建立路線' }));
    await screen.findByText('路線已建立');
    fireEvent.click(screen.getByRole('button', { name: '查詢原任務' }));
    expect(screen.queryByRole('link', { name: '在 Google 地圖開啟' })).toBeNull();
    await act(async () => finish({ status: 'completed', operationId: id }));
    await screen.findByText('路線已建立');
  });
});
