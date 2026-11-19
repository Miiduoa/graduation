import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  buildCampusRecommendations,
  createDefaultCampusPreferences,
  type CampusPersonalizationPreferences,
  type CampusRecommendationResult,
} from '@campus/shared/src/campusPersonalization';
import { CampusPersonalization } from './CampusPersonalization';

const now = new Date('2026-11-13T17:00:00+08:00');
type Preferences = CampusPersonalizationPreferences;

function Harness({
  initial = createDefaultCampusPreferences(),
  persist = () => true,
}: {
  initial?: Preferences;
  persist?: (value: Preferences) => boolean;
}) {
  const [preferences, setPreferences] = useState(initial);
  return (
    <CampusPersonalization
      preferences={preferences}
      recommendations={buildCampusRecommendations({ preferences, now, events: [], schoolId: 'pu' })}
      onSave={(value) => {
        if (!persist(value)) return false;
        setPreferences(value);
        return true;
      }}
      now={now}
      schoolName="靜宜大學"
    />
  );
}

function expandMore() {
  fireEvent.click(screen.getByText('更多安排（選填）'));
}

function setPhaseDates(start: string, end: string) {
  fireEvent.change(screen.getByLabelText('這段時間的重點'), { target: { value: 'midterms' } });
  fireEvent.change(screen.getByLabelText('開始日期'), { target: { value: start } });
  fireEvent.change(screen.getByLabelText('結束日期（包含當天）'), { target: { value: end } });
}

describe('CampusPersonalization', () => {
  it('lets a new visitor apply stage and focus without completing optional fields', () => {
    const persist = vi.fn(() => true);
    render(<Harness persist={persist} />);
    expect(screen.getByRole('form', { name: '首頁安排偏好' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.change(screen.getByLabelText('你目前的階段'), { target: { value: 'year-4' } });
    fireEvent.click(screen.getByRole('radio', { name: '生活優先' }));
    fireEvent.click(screen.getByRole('button', { name: '套用首頁安排' }));
    expect(persist).toHaveBeenCalledWith({
      ...createDefaultCampusPreferences(), stage: 'year-4', focus: 'life', configured: true,
    });
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByRole('heading', { name: '接下來可以做' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('首頁安排已更新。');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '調整安排' }));
  });

  it('can skip setup without adopting unfinished choices and edit it later', () => {
    const persist = vi.fn(() => true);
    render(<Harness persist={persist} />);
    fireEvent.change(screen.getByLabelText('你目前的階段'), { target: { value: 'year-1' } });
    fireEvent.click(screen.getByRole('button', { name: '先略過' }));
    expect(persist).toHaveBeenCalledWith({ ...createDefaultCampusPreferences(), configured: true });
    expect(screen.queryByRole('form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '調整安排' }));
    expect((screen.getByLabelText('你目前的階段') as HTMLSelectElement).value).toBe('unspecified');
    fireEvent.change(screen.getByLabelText('你目前的階段'), { target: { value: 'year-2' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(persist).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '調整安排' }));
    expect((screen.getByLabelText('你目前的階段') as HTMLSelectElement).value).toBe('unspecified');
  });

  it('keeps unsaved selections and stays in the form when saving fails', () => {
    const persist = vi.fn(() => false);
    render(<Harness persist={persist} />);
    fireEvent.change(screen.getByLabelText('你目前的階段'), { target: { value: 'graduate' } });
    fireEvent.click(screen.getByRole('button', { name: '套用首頁安排' }));
    expect(screen.getByRole('form')).toBeTruthy();
    expect((screen.getByLabelText('你目前的階段') as HTMLSelectElement).value).toBe('graduate');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('未能儲存');
    expect(document.activeElement).toBe(screen.getByRole('alert'));
  });

  it('limits goals to three while allowing selected goals to be removed', () => {
    const persist = vi.fn(() => true);
    render(<Harness persist={persist} />);
    expandMore();
    for (const name of ['熟悉校園', '跟上課業', '專題與合作'])
      fireEvent.click(screen.getByRole('checkbox', { name }));
    expect((screen.getByRole('checkbox', { name: '準備實習' }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: '熟悉校園' }));
    expect((screen.getByRole('checkbox', { name: '準備實習' }) as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: '準備實習' }));
    fireEvent.click(screen.getByRole('button', { name: '套用首頁安排' }));
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ goals: ['coursework', 'project', 'internship'] }));
  });

  it.each([
    ['2026-11-20', '2026-11-19', '結束日期要'],
    ['2026-11-13', '2027-02-11', '一次最多安排 90 天'],
    ['', '2026-11-19', '有效的開始與結束日期'],
    ['1800-11-13', '1800-11-19', '有效的開始與結束日期'],
  ])('rejects an invalid preparation interval %s to %s without saving', (start, end, error) => {
    const persist = vi.fn(() => true);
    render(<Harness persist={persist} />);
    expandMore();
    setPhaseDates(start, end);
    fireEvent.click(screen.getByRole('button', { name: '套用首頁安排' }));
    expect(persist).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain(error);
    expect(document.activeElement).toBe(screen.getByRole('alert'));
    expect(screen.getByLabelText('開始日期').getAttribute('aria-invalid')).toBe('true');
  });

  it('accepts an inclusive 90-day interval and can switch back to automatic scheduling', () => {
    const persist = vi.fn(() => true);
    render(<Harness persist={persist} />);
    expandMore();
    setPhaseDates('2026-11-13', '2027-02-10');
    fireEvent.click(screen.getByRole('button', { name: '套用首頁安排' }));
    expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({
      phaseOverride: { kind: 'midterms', startDate: '2026-11-13', endDate: '2027-02-10' },
    }));
    expect(screen.getByText('依你設定的日期')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '調整安排' }));
    expandMore();
    fireEvent.change(screen.getByLabelText('這段時間的重點'), { target: { value: '' } });
    expect(screen.queryByLabelText('開始日期')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '套用首頁安排' }));
    expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ phaseOverride: null }));
  });

  it('shows expired preparation as ended instead of keeping exam mode active', () => {
    render(<Harness initial={{
      ...createDefaultCampusPreferences(), configured: true,
      phaseOverride: { kind: 'midterms', startDate: '2026-11-01', endDate: '2026-11-12' },
    }} />);
    expect(screen.getByText('先前設定的期中準備已在 2026-11-12 結束。')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '日常安排' })).toBeTruthy();
  });

  it('shows at most three real destinations with reasons and personal-calendar provenance', () => {
    const recommendations: CampusRecommendationResult = {
      phase: {
        kind: 'midterms', label: '期中準備', source: 'event',
        reason: '你的行程「資料庫期中考」即將開始。',
      },
      recommendations: ['/calendar?campus=pu', '/classroom', '/library?campus=pu', '/map?campus=pu'].map((href, index) => ({
        id: `choice-${index}`, title: `可執行的項目 ${index + 1}`,
        description: '打開現有功能繼續處理。', reason: '你安排了近期考試。',
        href, category: 'study',
      })),
    };
    render(<CampusPersonalization
      preferences={{ ...createDefaultCampusPreferences(), configured: true }}
      recommendations={recommendations}
      onSave={() => true}
      now={now}
    />);
    expect(screen.getByText('依你的個人行程')).toBeTruthy();
    expect(screen.getByText('你的行程「資料庫期中考」即將開始。')).toBeTruthy();
    const links = within(screen.getByRole('list', { name: '為你推薦的下一步' })).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/calendar?campus=pu', '/classroom', '/library?campus=pu']);
    expect(screen.getAllByText('因為你安排了近期考試。')).toHaveLength(3);
    expect(screen.getByText('此裝置記住你的選擇，隨時可以調整。')).toBeTruthy();
  });
});
