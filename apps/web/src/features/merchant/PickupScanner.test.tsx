import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PickupScanner } from './PickupScanner';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('requests camera permission only on demand and keeps manual entry available after denial', async () => {
  const getUserMedia = vi.fn().mockRejectedValue(new Error('denied'));
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  const onToken = vi.fn();
  render(<PickupScanner disabled={false} onToken={onToken} />);
  expect(getUserMedia).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('掃描取餐 QR Code'));
  await screen.findByText(/無法開啟相機/);
  expect(getUserMedia).toHaveBeenCalledWith({
    video: { facingMode: { ideal: 'environment' } },
    audio: false,
  });
  expect(onToken).not.toHaveBeenCalled();
  expect(screen.getByLabelText('選擇取餐碼圖片')).toBeTruthy();
});

it.each(['close', 'disabled', 'unmount'])(
  'stops a late camera acquisition after %s and never returns a credential',
  async (action) => {
    let finish!: (value: MediaStream) => void;
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          finish = resolve;
        }),
    );
    const stop = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const onToken = vi.fn();
    const mounted = render(<PickupScanner disabled={false} onToken={onToken} />);
    fireEvent.click(screen.getByText('掃描取餐 QR Code'));
    if (action === 'close') fireEvent.click(screen.getByText('關閉相機'));
    if (action === 'disabled') mounted.rerender(<PickupScanner disabled onToken={onToken} />);
    if (action === 'unmount') mounted.unmount();
    await act(async () => {
      finish({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    });
    await waitFor(() => expect(stop).toHaveBeenCalledOnce());
    expect(onToken).not.toHaveBeenCalled();
  },
);

it('refuses oversized and unsupported pictures before decoding', async () => {
  const bitmap = vi.fn();
  vi.stubGlobal('createImageBitmap', bitmap);
  render(<PickupScanner disabled={false} onToken={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('選擇取餐碼圖片'), {
    target: { files: [new File(['x'], 'code.svg', { type: 'image/svg+xml' })] },
  });
  await screen.findByText('請選擇 8 MB 以內的 PNG、JPEG 或 WebP 圖片。');
  expect(bitmap).not.toHaveBeenCalled();
});
