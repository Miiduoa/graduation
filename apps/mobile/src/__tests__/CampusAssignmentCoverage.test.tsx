import React from 'react';
import { render } from '@testing-library/react-native';
import { CampusAssignmentCoverage } from '../screens/CampusAssignmentCoverage';
import type { CampusSenseSnapshot } from '../services/campusSenseSnapshot';

jest.mock('../ui/aiFirst', () => ({
  aiTokens: { text: '#111', muted: '#777', warning: '#a60', border: '#ddd', ai: '#369' },
}));
const items = (length: number) => Array.from({ length }, (_, i) => ({ title: '作業 ' + i, groupName: '課程', dueAt: null }));
const source = (loaded: number, total: number): CampusSenseSnapshot['assignments'] => ({
  status: 'available', count: total, items: items(loaded),
});

test('complete means all items from the connected source, not every school system', () => {
  const view = render(<CampusAssignmentCoverage assignments={source(137, 137)} />);
  expect(view.getByText('作業已取得 137 / 137 筆 · 來源內完整')).toBeTruthy();
  expect(view.getByText(/不代表所有校方系統皆已串接/)).toBeTruthy();
  expect(view.getByLabelText('已接通作業資料完整度').props.accessibilityValue).toEqual({
    min: 0, max: 137, now: 137, text: '137 / 137 筆',
  });
});

test('a partial legacy response never implies all of the total count was loaded', () => {
  const view = render(<CampusAssignmentCoverage assignments={source(8, 36)} />);
  expect(view.getByText('作業已取得 8 / 36 筆 · 部分資料')).toBeTruthy();
  expect(view.getByText(/其餘項目未納入規劃/)).toBeTruthy();
  expect(view.queryByText(/來源內完整/)).toBeNull();
});

test('an explicit read budget names the missing items rather than hiding the cap', () => {
  const view = render(<CampusAssignmentCoverage assignments={{
    ...source(400, 450), coverage: { complete: false, reason: 'read-budget', pages: 8 },
  }} />);
  expect(view.getByText(/其餘 50 筆尚未載入/)).toBeTruthy();
});

test('unknown is different from an authorized empty result', () => {
  const unavailable = render(<CampusAssignmentCoverage assignments={{ status: 'unavailable', count: null, items: [] }} />);
  expect(unavailable.getByText('作業來源未取得，不能當作待交作業為 0。')).toBeTruthy();
  expect(unavailable.queryByLabelText('已接通作業資料完整度')).toBeNull();
  unavailable.unmount();
  const empty = render(<CampusAssignmentCoverage assignments={source(0, 0)} />);
  expect(empty.getByText('作業已取得 0 / 0 筆 · 來源內完整')).toBeTruthy();
  expect(empty.getByText(/不代表其他學校系統也沒有作業/)).toBeTruthy();
});

test('does not trust a forged complete flag over actual loaded counts', () => {
  const view = render(<CampusAssignmentCoverage assignments={{
    ...source(3, 90), coverage: { complete: true, reason: 'complete', pages: 1 },
  }} />);
  expect(view.getByText('作業已取得 3 / 90 筆 · 部分資料')).toBeTruthy();
});
