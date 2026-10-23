import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SchoolSelector } from './SchoolSelector';

const { selection } = vi.hoisted(() => {
  const schools = [
    { id: 'pu', name: '靜宜大學', shortName: '靜宜', code: 'PU', status: 'open' },
    { id: 'ntu', name: '國立臺灣大學', shortName: '臺大', code: 'NTU', status: 'not-open' },
  ];
  return {
    selection: {
      schools,
      selectedSchool: schools[0],
      selectedSchoolId: 'pu',
      selectSchool: vi.fn(),
      loading: false,
      catalogStatus: 'ready',
      selectionError: null,
    },
  };
});
vi.mock('./SelectedSchoolProvider', () => ({ useSelectedSchool: () => selection }));
beforeEach(() => {
  selection.selectSchool.mockClear();
});

describe('school selector usability', () => {
  it('supports full-width input and reports the number of actual matches', () => {
    render(<SchoolSelector />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ＰＵ' } });
    expect(screen.getByRole('status').textContent).toBe('找到 1 所校園');
    expect(selection.selectSchool).not.toHaveBeenCalled();
  });
  it('keeps the current school clearly separate from unmatched results', () => {
    render(<SchoolSelector />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '不存在的學校' } });
    expect(screen.getByRole('status').textContent).toContain('找不到符合的校園');
    expect(screen.getByRole('option', { name: '靜宜大學（目前選擇）' })).toBeTruthy();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('pu');
    expect(selection.selectSchool).not.toHaveBeenCalled();
  });
  it('clears only the search and returns focus to its field', () => {
    render(<SchoolSelector />);
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '臺灣' } });
    fireEvent.click(screen.getByRole('button', { name: '清除搜尋' }));
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(selection.selectSchool).not.toHaveBeenCalled();
  });
  it('closes after an explicit choice and returns focus to the school summary', () => {
    const { container } = render(<SchoolSelector compact />);
    const details = container.querySelector('details')!;
    details.open = true;
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ntu' } });
    expect(selection.selectSchool).toHaveBeenCalledWith('ntu');
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(details.querySelector('summary'));
  });
  it('closes when keyboard focus leaves without stealing that focus', () => {
    const { container } = render(
      <>
        <SchoolSelector compact />
        <button>下一個操作</button>
      </>,
    );
    const details = container.querySelector('details')!;
    details.open = true;
    const next = screen.getByRole('button', { name: '下一個操作' });
    fireEvent.blur(screen.getByRole('searchbox'), { relatedTarget: next });
    expect(details.open).toBe(false);
    expect(selection.selectSchool).not.toHaveBeenCalled();
  });
  it('ignores Escape during IME composition, otherwise closes and restores focus', () => {
    const { container } = render(<SchoolSelector compact />);
    const details = container.querySelector('details')!;
    details.open = true;
    const input = screen.getByRole('searchbox');
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(details.open).toBe(true);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(details.querySelector('summary'));
  });
});

it('closes the school picker without changing the selected school', () => {
  const { container } = render(<SchoolSelector compact />);
  const details = container.querySelector('details')!;
  details.open = true;
  fireEvent.click(screen.getByRole('button', { name: '關閉校園選擇' }));
  expect(details.open).toBe(false);
  expect(selection.selectSchool).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(details.querySelector('summary'));
});
