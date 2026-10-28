import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AttendanceQrPresentation } from './AttendanceQrPresentation';

const props = {
  image: 'data:image/png;base64,QUJDRA==', courseName: '資料結構',
  expiresAt: '2026-10-28T01:10:00Z', remainingSeconds: 600,
  attendeeCount: 23, onHideCode: vi.fn(),
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-28T01:00:00Z'));
  props.onHideCode.mockReset();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true,
    value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true,
    value: function(this: HTMLDialogElement) {
      this.removeAttribute('open'); this.dispatchEvent(new Event('close'));
    } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const launch = () => fireEvent.click(screen.getByRole('button', { name: '放大投影 QR Code' }));

it('opens only on teacher action, shows the class and count without raw token text', () => {
  render(<AttendanceQrPresentation {...props} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  launch();
  expect(screen.getByRole('dialog', { name: '資料結構' })).toBeTruthy();
  expect(screen.getByAltText('本次課堂投影簽到 QR Code').getAttribute('src')).toBe(props.image);
  expect(screen.getByText('10:00')).toBeTruthy();
  expect(screen.getByText('23')).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '結束投影' }));
  expect(screen.queryByText('QUJDRA==')).toBeNull();
});
it('returns focus without ending attendance when the dialog is closed', () => {
  render(<AttendanceQrPresentation {...props} />);
  launch(); fireEvent.click(screen.getByRole('button', { name: '結束投影' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(props.onHideCode).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '放大投影 QR Code' }));
});
it('updates counts and remaining time in the existing dialog', () => {
  const view = render(<AttendanceQrPresentation {...props} />);
  launch();
  view.rerender(<AttendanceQrPresentation {...props} attendeeCount={24} remainingSeconds={595} />);
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByText('24')).toBeTruthy(); expect(screen.getByText('9:55')).toBeTruthy();
});
it.each(['offline', 'pagehide'])('hides the credential on %s without a write request', (event) => {
  render(<AttendanceQrPresentation {...props} />); launch();
  act(() => window.dispatchEvent(new Event(event)));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(props.onHideCode).toHaveBeenCalledOnce();
});
it('clears the QR when hidden and never reopens automatically after returning', () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  render(<AttendanceQrPresentation {...props} />); launch();
  visibility.mockReturnValue('hidden'); act(() => document.dispatchEvent(new Event('visibilitychange')));
  visibility.mockReturnValue('visible'); act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(props.onHideCode).toHaveBeenCalledOnce();
});
it('ends the projection exactly at expiry even when the displayed countdown is stale', () => {
  render(<AttendanceQrPresentation {...props} />); launch();
  act(() => vi.advanceTimersByTime(600_000));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(props.onHideCode).toHaveBeenCalledOnce();
});
it('does not show expired or unknown images', () => {
  render(<AttendanceQrPresentation {...props} expiresAt="2026-10-28T00:59:00Z" />); launch();
  expect(screen.queryByRole('dialog')).toBeNull(); expect(props.onHideCode).toHaveBeenCalledOnce();
});
it('keeps the inline alternative when native modality is unavailable', () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: undefined });
  render(<AttendanceQrPresentation {...props} />); launch();
  expect(screen.getByRole('alert').textContent).toContain('請使用頁面上的 QR Code');
  expect(props.onHideCode).not.toHaveBeenCalled();
});
it('releases the dialog and timers when course access unmounts the view', () => {
  const view = render(<AttendanceQrPresentation {...props} />); launch();
  const node = screen.getByRole('dialog'); view.unmount();
  expect(node.hasAttribute('open')).toBe(false);
  act(() => { window.dispatchEvent(new Event('offline')); vi.advanceTimersByTime(600_000); });
  expect(props.onHideCode).not.toHaveBeenCalled();
});
