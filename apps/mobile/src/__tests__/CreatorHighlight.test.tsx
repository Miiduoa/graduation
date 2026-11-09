import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { CreatorHighlight } from '../screens/social/CreatorHighlight';
import {
  featureCreatorPost, readCreatorHighlight, removeCreatorHighlight,
} from '../services/creatorHighlight';

jest.mock('../services/creatorHighlight', () => ({
  featureCreatorPost: jest.fn(),
  readCreatorHighlight: jest.fn(),
  removeCreatorHighlight: jest.fn(),
}));

const post = {
  id: 'work1', schoolId: 'pu', authorUid: 'alice', anonymous: false,
  boardId: 'general', title: '我的社團成果', content: '真正的校園活動',
};
const anonymous = { ...post, id: 'anon', anonymous: true, title: '匿名問題' };
const peer = { ...post, id: 'peer', authorUid: 'bob', title: '別人的貼文' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(readCreatorHighlight).mockResolvedValue(null);
  jest.mocked(featureCreatorPost).mockResolvedValue({ postId: 'work1', post });
  jest.mocked(removeCreatorHighlight).mockResolvedValue(undefined);
});

test('owner can select and pin a real signed campus post, then remove it', async () => {
  const view = render(<CreatorHighlight schoolId="pu" memberUid="alice" own
    candidates={[post, anonymous, peer]} openPost={jest.fn()} />);
  await waitFor(() => expect(view.getByText('精選作品')).toBeTruthy());
  expect(view.queryByLabelText('選擇精選作品：匿名問題')).toBeNull();
  expect(view.queryByLabelText('選擇精選作品：別人的貼文')).toBeNull();
  fireEvent.press(view.getByLabelText('選擇精選作品：我的社團成果'));
  fireEvent.press(view.getByText('設為精選'));
  await waitFor(() => expect(featureCreatorPost).toHaveBeenCalledWith('pu', 'alice', 'work1'));
  expect(view.getByText('我的社團成果')).toBeTruthy();
  fireEvent.press(view.getByText('取消精選'));
  await waitFor(() => expect(removeCreatorHighlight).toHaveBeenCalledWith('pu', 'alice'));
});

test('a school peer may read a featured work but never receives owner editing actions', async () => {
  jest.mocked(readCreatorHighlight).mockResolvedValueOnce({ postId: 'work1', post });
  const openPost = jest.fn();
  const view = render(<CreatorHighlight schoolId="pu" memberUid="alice" own={false}
    candidates={[post]} openPost={openPost} />);
  await waitFor(() => expect(view.getByText('我的社團成果')).toBeTruthy());
  expect(view.queryByText('設為精選')).toBeNull();
  fireEvent.press(view.getByLabelText('閱讀精選作品：我的社團成果'));
  expect(openPost).toHaveBeenCalledWith('work1');
});

test('removed or anonymous featured posts are not displayed to another member', async () => {
  jest.mocked(readCreatorHighlight).mockResolvedValueOnce({ postId: 'work1', post: null });
  const view = render(<CreatorHighlight schoolId="pu" memberUid="alice" own={false}
    candidates={[post]} openPost={jest.fn()} />);
  await waitFor(() => expect(readCreatorHighlight).toHaveBeenCalledTimes(1));
  expect(view.queryByLabelText('閱讀精選作品：我的社團成果')).toBeNull();
});
