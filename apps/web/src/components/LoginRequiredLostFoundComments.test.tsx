import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { LOGIN_REQUIRED_COMMENTS_TEXT } from '@campus/shared/src/signedInSocialReads';
import { LoginRequiredLostFoundComments } from './LoginRequiredLostFoundComments';

it('opens the school account channel and keeps custom prompt text', () => {
  render(
    <LoginRequiredLostFoundComments
      returnUrl="/cafeteria/stall?schoolId=pu"
      text={LOGIN_REQUIRED_COMMENTS_TEXT}
    />,
  );
  expect(screen.getByText(LOGIN_REQUIRED_COMMENTS_TEXT)).toBeTruthy();
  const link = screen.getByRole('link', { name: '連線學校帳號' });
  expect(link.getAttribute('href')).toBe(
    '/login?reconnect=school&returnUrl=%2Fcafeteria%2Fstall%3FschoolId%3Dpu',
  );
});

it('preserves lost-found returnUrl with schoolId and uses school reconnect', () => {
  render(
    <LoginRequiredLostFoundComments returnUrl="/lost-found?schoolId=pu" />,
  );
  expect(screen.getByText('查看失物招領需要學校帳號。')).toBeTruthy();
  expect(screen.getByRole('link', { name: '連線學校帳號' }).getAttribute('href')).toBe(
    '/login?reconnect=school&returnUrl=%2Flost-found%3FschoolId%3Dpu',
  );
  expect(screen.queryByRole('link', { name: '登入' })).toBeNull();
});

it('collapses stacked fragments before the terminal hash on school login', () => {
  render(
    <LoginRequiredLostFoundComments returnUrl="/lost-found/item-1?schoolId=pu#note#note" />,
  );
  expect(screen.getByRole('link', { name: '連線學校帳號' }).getAttribute('href')).toBe(
    '/login?reconnect=school&returnUrl=%2Flost-found%2Fitem-1%3FschoolId%3Dpu%23note#',
  );
});
