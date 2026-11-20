import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import CourseScoresScreen from '../screens/CourseScoresScreen';
import { tcFetchSelfScore, tcFetchScoreItems, tcFetchCourseExams, tcFetchExamSubmissions, tcFetchHomeworkActivities } from '../services/tronClassClient';
import { webBrowserOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';
jest.mock('../services/tronClassClient', () => ({
  tcFetchSelfScore: jest.fn(), tcFetchScoreItems: jest.fn(), tcFetchCourseExams: jest.fn(), tcFetchExamSubmissions: jest.fn(), tcFetchHomeworkActivities: jest.fn(),
  tcBuildScoreUrl: () => 'https://school.example/score/42',
  tcBuildFileViewUrl: (_course: number, id: number) => `https://school.example/work/${id}`,
  tcBuildExamViewUrl: (_course: number, id: number) => `https://school.example/exam/${id}`,
}));
jest.mock('../services/tronClassWebUiGate', () => ({ webBrowserOpenWithPuTronClassGate: jest.fn() }));
jest.mock('../data/demoCoursesAdapter', () => ({ isDemoCourseId: () => false }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

test('partial school reads keep progress unknown and link loaded work to its original record', async () => {
  jest.mocked(tcFetchSelfScore).mockResolvedValue(null as never);
  jest.mocked(tcFetchScoreItems).mockRejectedValue(new Error('offline'));
  jest.mocked(tcFetchHomeworkActivities).mockResolvedValue([{ id: 7, title: '已評作業', total_score: 100, student_score: 100, submitted: true }] as never);
  jest.mocked(tcFetchCourseExams).mockResolvedValue([{ id: 8, title: '未取得測驗', total_score: 100, submitted_times: 0, type: 'exam' }] as never);
  jest.mocked(tcFetchExamSubmissions).mockRejectedValue(new Error('offline'));
  const view = render(<CourseScoresScreen route={{ params: { groupId: 'tc:42', groupName: '微積分' } }} />);
  await view.findByText(/評分項目、未取得測驗尚未取得；完整進度未知/);
  expect(view.getByText('未知（尚未取得）')).toBeTruthy();
  expect(view.getByText(/來源：校方正式（TronClass）/)).toBeTruthy();
  expect(view.queryByText('加權成績預估（試算）')).toBeNull();
  fireEvent.press(view.getAllByRole('link')[0]);
  expect(webBrowserOpenWithPuTronClassGate).toHaveBeenCalledWith('https://school.example/work/7');
});
