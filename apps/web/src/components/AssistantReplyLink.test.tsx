import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { AssistantLinkNavigation, AssistantReplyAnchor, AssistantReplyLink } from './AssistantReplyLink';

beforeEach(() => {
  window.history.replaceState({}, '', '/library?campus=pu#intro');
});

function renderLink(props: ComponentProps<typeof AssistantReplyLink>) {
  const onNavigate = vi.fn();
  render(
    <AssistantLinkNavigation.Provider value={onNavigate}>
      {/* Suppress jsdom browser navigation after the link handles the click. */}
      <div onClick={(event) => event.preventDefault()}>
        <AssistantReplyLink {...props}>查看服務</AssistantReplyLink>
      </div>
    </AssistantLinkNavigation.Provider>,
  );
  return { link: screen.getByRole('link', { name: '查看服務' }), onNavigate };
}

it.each([
  ['fragment only', '#hours', '/library?campus=pu#hours'],
  ['same path and query', '/library?campus=pu', '/library?campus=pu'],
  ['different query', '/library?campus=nthu', '/library?campus=nthu'],
  ['different path', '/map', '/map'],
  ['identical URL', '/library?campus=pu#intro', '/library?campus=pu#intro'],
  ['different path with fragment', '/#courses', '/#courses'],
])('reports current-tab navigation for %s', (_case, href, path) => {
  const { link, onNavigate } = renderLink({ href });
  fireEvent.click(link);
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith(path);
});

it.each([
  ['Ctrl', { ctrlKey: true }],
  ['Cmd', { metaKey: true }],
  ['Shift', { shiftKey: true }],
  ['Alt', { altKey: true }],
  ['middle button', { button: 1 }],
] as const)('ignores a %s click', (_case, gesture) => {
  const { link, onNavigate } = renderLink({ href: '/library?campus=pu#intro' });
  fireEvent.click(link, gesture);
  expect(onNavigate).not.toHaveBeenCalled();
});

it.each([
  ['new tab', { target: '_blank' }],
  ['named window', { target: 'reference' }],
  ['download', { download: '' }],
  ['external link', { href: 'https://example.org/library?campus=pu#intro' }],
  ['cancelled click', { onClick: (event) => event.preventDefault() }],
] satisfies [string, Partial<ComponentProps<typeof AssistantReplyLink>>][])(
  'ignores a %s',
  (_case, props) => {
    const { link, onNavigate } = renderLink({ href: '/library?campus=pu#intro', ...props });
    fireEvent.click(link);
    expect(onNavigate).not.toHaveBeenCalled();
  },
);

it.each(['/library?campus=pu#intro', '/map'])(
  'applies the same navigation rules to native anchors targeting %s',
  (href) => {
    const onNavigate = vi.fn();
    render(
      <AssistantLinkNavigation.Provider value={onNavigate}>
        <div onClick={(event) => event.preventDefault()}>
          <AssistantReplyAnchor href={href}>查看來源</AssistantReplyAnchor>
        </div>
      </AssistantLinkNavigation.Provider>,
    );
    const link = screen.getByRole<HTMLAnchorElement>('link', { name: '查看來源' });
    fireEvent.click(link, { ctrlKey: true });
    link.target = '_blank';
    fireEvent.click(link);
    expect(onNavigate).not.toHaveBeenCalled();
    link.removeAttribute('target');
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(href);
  },
);
