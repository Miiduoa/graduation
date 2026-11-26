import { createRef, useEffect } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('shared action feedback', () => {
  it('keeps the action name and content mounted while a request is pending', () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function Label() {
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return <span>儲存提醒</span>;
    }
    const view = render(
      <Button>
        <Label />
      </Button>,
    );
    const button = screen.getByRole('button', { name: '儲存提醒' }) as HTMLButtonElement;
    const label = screen.getByText('儲存提醒');

    view.rerender(
      <Button loading>
        <Label />
      </Button>,
    );
    expect(screen.getByRole('button', { name: '儲存提醒' })).toBe(button);
    expect(screen.getByText('儲存提醒')).toBe(label);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(mounted).toHaveBeenCalledOnce();
    expect(unmounted).not.toHaveBeenCalled();

    view.rerender(
      <Button>
        <Label />
      </Button>,
    );
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(screen.getByText('儲存提醒')).toBe(label);
    expect(mounted).toHaveBeenCalledOnce();
  });

  it.each(['left', 'right'] as const)(
    'preserves the %s icon and its action label during loading',
    (iconPosition) => {
      const icon = <svg data-testid="action-icon" aria-hidden="true" />;
      const view = render(
        <Button icon={icon} iconPosition={iconPosition}>
          送出
        </Button>,
      );
      const mountedIcon = screen.getByTestId('action-icon');
      const button = screen.getByRole('button', { name: '送出' });
      const initialNodes = [...button.childNodes];

      view.rerender(
        <Button loading icon={icon} iconPosition={iconPosition}>
          送出
        </Button>,
      );
      expect(screen.getByTestId('action-icon')).toBe(mountedIcon);
      expect(screen.getByRole('button', { name: '送出' })).toBe(button);
      expect([...button.childNodes].slice(0, initialNodes.length)).toEqual(initialNodes);
    },
  );

  it('prevents another submit while loading, then allows retry when loading ends', () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const click = vi.fn();
    const form = (loading: boolean, disabled = false) => (
      <form onSubmit={submit}>
        <Button
          type="submit"
          name="action"
          value="save"
          loading={loading}
          disabled={disabled}
          onClick={click}
        >
          儲存
        </Button>
      </form>
    );
    const view = render(form(false));
    const button = screen.getByRole('button', { name: '儲存' });
    fireEvent.click(button);
    expect(submit).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();

    view.rerender(form(true));
    fireEvent.click(button);
    expect(submit).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    view.rerender(form(false));
    fireEvent.click(button);
    expect(submit).toHaveBeenCalledTimes(2);

    view.rerender(form(false, true));
    fireEvent.click(button);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(button.hasAttribute('aria-busy')).toBe(false);
  });

  it('forwards refs, descriptions, classes and custom sizing for icon-only actions', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <>
        <p id="refresh-description">重新讀取本次查詢</p>
        <Button
          ref={ref}
          type="button"
          aria-label="更新結果"
          aria-describedby="refresh-description"
          className="custom-action"
          style={{ width: 52 }}
          icon={<svg aria-hidden="true" />}
          loading
        />
      </>,
    );
    const button = screen.getByRole('button', { name: '更新結果' });
    expect(ref.current).toBe(button);
    expect(button.getAttribute('aria-describedby')).toBe('refresh-description');
    expect(button.classList.contains('custom-action')).toBe(true);
    expect(button.style.width).toBe('52px');
    expect(button.querySelector('svg')).not.toBeNull();
  });

  it('keeps loading authoritative while preserving a caller busy state when idle', () => {
    const view = render(
      <Button loading aria-busy={false}>
        更新
      </Button>,
    );
    const button = screen.getByRole('button', { name: '更新' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    view.rerender(<Button aria-busy="true">更新</Button>);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('retains a numeric zero label while loading', () => {
    render(<Button loading>{0}</Button>);
    expect(screen.getByRole('button', { name: '0' })).toBeTruthy();
  });
});
