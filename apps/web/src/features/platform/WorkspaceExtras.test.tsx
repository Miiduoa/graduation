import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceAffiliation } from './WorkspaceExtras';

const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
const context = 'a'.repeat(43);
const fetcher = vi.fn();
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
beforeEach(() => vi.stubGlobal('fetch', fetcher.mockReset()));
afterEach(() => vi.unstubAllGlobals());

it.each(['success', 'expired'] as const)(
  'ignores an affiliation %s after a context change',
  async (outcome) => {
    const replace = vi.fn();
    vi.stubGlobal('location', { ...window.location, replace });
    const changed = vi.fn();
    const previous = deferred<Response>();
    fetcher.mockReturnValue(previous.promise);
    const props = {
      workspaceId,
      context,
      canApply: true,
      affiliation: null,
      applications: [],
      onChanged: changed,
    };
    const view = render(<WorkspaceAffiliation {...props} />);
    fireEvent.change(screen.getByLabelText('學校代號'), { target: { value: 'school-a' } });
    fireEvent.change(screen.getByLabelText('說明'), {
      target: { value: '這是原帳號的課班掛靠申請' },
    });
    fireEvent.submit(screen.getByLabelText('說明').closest('form')!);
    view.rerender(<WorkspaceAffiliation {...props} context={'b'.repeat(43)} />);
    await act(async () => previous.resolve(outcome === 'success' ? ok({}) : ok({}, 401)));
    expect(changed).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect((screen.getByLabelText('說明') as HTMLTextAreaElement).value).toBe('');
  },
);
