type NavigationClick = Pick<
  MouseEvent,
  'defaultPrevented' | 'button' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'
>;

/** Call from the link's own onClick, before Next intercepts its normal navigation. */
export function isCurrentTabNavigationClick(
  event: NavigationClick,
  link: HTMLAnchorElement,
): boolean {
  const target = link.getAttribute('target')?.toLowerCase();
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    (!target || target === '_self') &&
    !link.hasAttribute('download')
  );
}
