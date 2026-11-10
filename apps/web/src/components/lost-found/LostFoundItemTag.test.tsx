import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { LostFoundItem } from '@/lib/lostFound';
import { LostFoundItemTag } from './LostFoundItemTag';

const item: LostFoundItem = {
  id: 'item-1',
  type: 'found',
  title: '黑色折疊傘',
  description: '傘柄有一條藍色繩子。',
  category: 'other',
  location: '蓋夏圖書館入口',
  date: '2026-10-20',
  status: 'open',
  reporterId: 'alice',
  userId: 'alice',
  createdAt: '2026-10-20T01:00:00.000Z',
  schoolId: 'pu',
  canonical: true,
  contactInfo: 'contact@school.test',
};

afterEach(() => cleanup());

it('shows the registered facts and keeps the complete item link with its list filters', () => {
  const href = '/lost-found/item-1?schoolId=pu&type=found&status=open&mine=1&page=2&q=%E9%9B%A8%E5%82%98';
  render(<LostFoundItemTag item={item} href={href}><p>{item.description}</p></LostFoundItemTag>);

  expect(screen.getByRole('link', { name: item.title }).getAttribute('href')).toBe(href);
  expect(screen.getByText('拾獲')).toBeTruthy();
  expect(screen.getByText('地點').nextElementSibling?.textContent).toBe(item.location);
  expect(screen.getByText('日期').nextElementSibling?.textContent).toBe('2026/10/20');
  expect(screen.getByText(item.description)).toBeTruthy();
  expect(screen.queryByText(item.contactInfo!)).toBeNull();
});

it.each([
  ['open', '尋找中'],
  ['active', '尋找中'],
  ['claimed', '待交接'],
  ['resolved', '已結案'],
  ['returned', '已結案'],
  ['expired', '已過期'],
] as const)('renders the actual %s status as %s', (status, label) => {
  render(<LostFoundItemTag item={{ ...item, status }}><p>{item.description}</p></LostFoundItemTag>);

  expect(screen.getByTestId('lost-found-tag').getAttribute('data-status')).toBe(status);
  expect(screen.getByText(label)).toBeTruthy();
  expect(screen.queryByText('已領回')).toBeNull();
});

it('shows a missing date explicitly without adding a calendar time', () => {
  render(<LostFoundItemTag item={{ ...item, date: '' }}><p>{item.description}</p></LostFoundItemTag>);

  expect(screen.getByText('日期').nextElementSibling?.textContent).toBe('未提供日期');
  expect(document.querySelector('time')).toBeNull();
});

it('formats a stored timestamp as its Taipei calendar day', () => {
  const date = '2026-10-20T16:30:00.000Z';
  render(<LostFoundItemTag item={{ ...item, date }}><p>{item.description}</p></LostFoundItemTag>);

  const time = screen.getByText('2026/10/21');
  expect(time.getAttribute('datetime')).toBe(date);
});

it('keeps the existing campus thumbnail inside the titled link', () => {
  const photos = [{
    src: 'https://firebasestorage.googleapis.com/v0/b/campus.test/o/umbrella.jpg',
    host: 'firebasestorage.googleapis.com',
    campusHosted: true,
  }];
  render(<LostFoundItemTag item={{ ...item, photos }} href="/lost-found/item-1?schoolId=pu"><p>{item.description}</p></LostFoundItemTag>);

  const link = screen.getByRole('link', { name: item.title });
  const image = link.querySelector('img');
  expect(image?.getAttribute('src')).toBe(photos[0].src);
  expect(image?.getAttribute('alt')).toBe('');
  expect(image?.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(image?.getAttribute('loading')).toBe('lazy');
  expect(screen.getByText('照片 1 張')).toBeTruthy();
});

it('shows external-photo counts while leaving external loading to the detail gallery', () => {
  const photos = [{ src: 'https://photos.example/umbrella.jpg', host: 'photos.example', campusHosted: false }];
  render(<LostFoundItemTag item={{ ...item, photos }} href="/lost-found/item-1?schoolId=pu"><p>{item.description}</p></LostFoundItemTag>);

  expect(screen.getByText('照片 1 張')).toBeTruthy();
  expect(document.querySelector('img')).toBeNull();
});

it('preserves the tag node and children when its server status changes', () => {
  const { rerender } = render(
    <LostFoundItemTag item={item}><p>{item.description}</p><p>{item.contactInfo}</p></LostFoundItemTag>,
  );
  const tag = screen.getByTestId('lost-found-tag');
  rerender(
    <LostFoundItemTag item={{ ...item, status: 'resolved' }}><p>{item.description}</p><p>{item.contactInfo}</p></LostFoundItemTag>,
  );

  expect(screen.getByTestId('lost-found-tag')).toBe(tag);
  expect(screen.getByText('已結案')).toBeTruthy();
  expect(screen.getByText(item.contactInfo!)).toBeTruthy();
  expect(screen.queryByRole('link')).toBeNull();
});

it('retains the legacy-record label', () => {
  const legacyItem: LostFoundItem = { ...item, canonical: false, userId: undefined };
  render(<LostFoundItemTag item={legacyItem}><p>{item.description}</p></LostFoundItemTag>);

  expect(screen.getByText('舊版紀錄')).toBeTruthy();
});
