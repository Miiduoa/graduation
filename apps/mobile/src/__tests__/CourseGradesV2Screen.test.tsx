import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import CourseGradesV2Screen from '../screens/lmsV2/CourseGradesV2Screen';
jest.mock('../services/supabaseClient', () => ({ getSupabaseClient: () => null }));
jest.mock('../screens/lmsV2/_courseV2Shell', () => {
  const { Text, View } = require('react-native');
  return {
    CourseV2Header: ({ title }: { title: string }) => <Text>{title}</Text>,
    useCourseV2Params: () => ({ courseId: 'course-1', courseName: '資料庫' }),
    useLoadable: () => ({ data: { rollup: { weighted_percent: null }, items: [{ id: 'grade-item-1', title: '期末報告', max_points: null, grade_scores: [] }] } }),
    CourseV2List: ({ loadable, renderItem }: { loadable: { data: { id: string }[] }; renderItem(item: unknown): React.ReactNode }) => <View>{loadable.data.map((item) => <View key={item.id}>{renderItem(item)}</View>)}</View>,
  };
});
test('unavailable scores stay unknown and expose their original grade record', () => {
  const view = render(<CourseGradesV2Screen />);
  expect(view.queryByText('0')).toBeNull();
  fireEvent.press(view.getByText('查看原始評分紀錄'));
  expect(view.getByText(/原始評分項目：grade-item-1/)).toBeTruthy();
  expect(view.getByText('分數：未知（待評或尚未取得）')).toBeTruthy();
  fireEvent.press(view.getByText('返回成績'));
  expect(view.queryByText(/原始評分項目：grade-item-1/)).toBeNull();
});
