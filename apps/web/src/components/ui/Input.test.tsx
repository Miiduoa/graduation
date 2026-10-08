import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Input, Select, Textarea } from './Input';

describe('shared form fields', () => {
  it('gives repeated fields distinct accessible labels and help text', () => {
    render(
      <>
        <Input label="學號" hint="請輸入學校核發的學號" />
        <Input label="課程代碼" />
      </>,
    );
    const student = screen.getByRole('textbox', { name: '學號' });
    const course = screen.getByRole('textbox', { name: '課程代碼' });
    expect(student.id).toBeTruthy();
    expect(student.id).not.toBe(course.id);
    expect(document.getElementById(student.getAttribute('aria-describedby')!)?.textContent).toBe(
      '請輸入學校核發的學號',
    );
  });

  it('preserves caller descriptions and connects validation errors', () => {
    const { rerender } = render(
      <>
        <p id="policy">只用於登入</p>
        <Input id="student" label="學號" aria-describedby="policy" error="請確認學號" />
      </>,
    );
    const input = screen.getByRole('textbox', { name: '學號' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('policy student-description');
    expect(screen.getByRole('alert').textContent).toBe('請確認學號');
    rerender(<Input id="student" label="學號" hint="共 9 位數" />);
    expect(screen.getByRole('textbox', { name: '學號' }).hasAttribute('aria-invalid')).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('allows keyboard access to password visibility without submitting the form', () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <Input label="密碼" type="password" defaultValue="test-password" />
      </form>,
    );
    const input = screen.getByLabelText('密碼') as HTMLInputElement;
    const toggle = screen.getByRole('button', { name: '顯示密碼' });
    expect(toggle.tabIndex).toBe(0);
    expect(toggle.getAttribute('aria-controls')).toBe(input.id);
    fireEvent.click(toggle);
    expect(input.type).toBe('text');
    expect(input.value).toBe('test-password');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '隱藏密碼' }));
    expect(input.type).toBe('password');
    expect(submit).not.toHaveBeenCalled();
  });

  it('forwards input refs and focus handlers without hiding the label', () => {
    const ref = createRef<HTMLInputElement>();
    const focus = vi.fn();
    const blur = vi.fn();
    render(<Input ref={ref} label="課程" onFocus={focus} onBlur={blur} />);
    fireEvent.focus(ref.current!);
    fireEvent.blur(ref.current!);
    expect(focus).toHaveBeenCalledOnce();
    expect(blur).toHaveBeenCalledOnce();
    expect(ref.current).toBe(screen.getByRole('textbox', { name: '課程' }));
  });

  it('connects textarea and select labels and forwards native change events', () => {
    const change = vi.fn();
    render(
      <>
        <Textarea label="作業內容" rows={6} onChange={change} />
        <Select
          label="學期"
          defaultValue="fall"
          options={[
            { value: 'fall', label: '上學期' },
            { value: 'spring', label: '下學期' },
          ]}
        />
      </>,
    );
    const answer = screen.getByRole('textbox', { name: '作業內容' }) as HTMLTextAreaElement;
    expect(answer.rows).toBe(6);
    fireEvent.change(answer, { target: { value: '作業文字' } });
    expect(change).toHaveBeenCalledOnce();
    const term = screen.getByRole('combobox', { name: '學期' }) as HTMLSelectElement;
    fireEvent.change(term, { target: { value: 'spring' } });
    expect(term.value).toBe('spring');
  });

  it('keeps disabled password fields and their visibility controls disabled', () => {
    render(<Input label="密碼" type="password" disabled />);
    expect((screen.getByLabelText('密碼') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '顯示密碼' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
