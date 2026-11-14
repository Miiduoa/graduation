import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createTronClassAgentClient } from '@/lib/tronClassAgentClient';
import { TronClassAgentAccess } from './TronClassAgentAccess';

const revision = 'a'.repeat(32);
const version = 'b'.repeat(32);
const permissions = { readCourseData: true, downloadMaterials: true, prepareHomework: true };
const client = createTronClassAgentClient({ kind: 'platform', context: 'current-platform-session' });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); });

it('starts with the server grant and revokes all dependent permissions in one explicit CAS save', async () => {
  const calls: Record<string, unknown>[] = [];
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); calls.push(body);
    return json(body.action === 'status' ? { revision, version, permissions, updatedAt: '2026-11-13T10:00:00Z' }
      : { revision, version: 'c'.repeat(32), permissions: body.permissions, updatedAt: '2026-11-13T10:05:00Z' });
  });
  vi.stubGlobal('fetch', fetch);
  render(<TronClassAgentAccess client={client} revision={revision} />);
  const read = await screen.findByRole('checkbox', { name: /讀取課程、作業/ });
  expect((read as HTMLInputElement).checked).toBe(true);
  fireEvent.click(read);
  const download = screen.getByRole('checkbox', { name: /代為下載教材/ }) as HTMLInputElement;
  const prepare = screen.getByRole('checkbox', { name: /代為整理作業/ }) as HTMLInputElement;
  expect(download.checked || prepare.checked).toBe(false);
  expect(download.disabled && prepare.disabled).toBe(true);
  expect(calls).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '儲存助理權限' }));
  await screen.findByText('已關閉助理的 TronClass 存取權限。');
  expect(calls[1]).toEqual({ action: 'set', revision, expectedVersion: version,
    permissions: { readCourseData: false, downloadMaterials: false, prepareHomework: false } });
  expect(fetch.mock.calls[1][1]?.headers).toMatchObject({ 'X-Campus-Session': 'current-platform-session' });
});

it('requires explicit opt-in and reloads a changed grant without retrying a stale update', async () => {
  let statusCalls = 0;
  const updates: object[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.action === 'set') {
      updates.push(body);
      return json({ error: 'TRONCLASS_AGENT_PERMISSION_CHANGED', message: '其他裝置已更新權限。' }, 409);
    }
    statusCalls++;
    return json({ revision, version: statusCalls === 1 ? null : version, updatedAt: null,
      permissions: { readCourseData: false, downloadMaterials: false, prepareHomework: false } });
  }));
  render(<TronClassAgentAccess client={client} revision={revision} />);
  const read = await screen.findByRole('checkbox', { name: /讀取課程、作業/ });
  expect((read as HTMLInputElement).checked).toBe(false);
  expect(updates).toEqual([]);
  fireEvent.click(read);
  fireEvent.click(screen.getByRole('button', { name: '儲存助理權限' }));
  await screen.findByRole('alert');
  await waitFor(() => expect(statusCalls).toBe(2));
  expect((screen.getByRole('checkbox', { name: /讀取課程、作業/ }) as HTMLInputElement).checked).toBe(false);
  expect(updates).toHaveLength(1);
  expect((screen.getByRole('button', { name: '儲存助理權限' }) as HTMLButtonElement).disabled).toBe(true);
});

it('does not apply a previous binding or a late unmounted response', async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const saved = vi.fn();
  const changed = vi.fn();
  const view = render(<TronClassAgentAccess client={client} revision={revision} onSaved={saved} onConnectionChanged={changed} />);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  view.unmount();
  await act(async () => finish(json({ revision: 'd'.repeat(32), version, permissions, updatedAt: null })));
  expect(saved).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  expect(screen.queryByRole('checkbox')).toBeNull();
});
