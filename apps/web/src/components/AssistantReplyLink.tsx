'use client';

import Link from 'next/link';
import { createContext, useContext, type ComponentProps, type MouseEvent } from 'react';
import { isCurrentTabNavigationClick } from '@/lib/currentTabNavigation';

export const AssistantLinkNavigation = createContext<((href: string) => void) | undefined>(
  undefined,
);

export function useAssistantLinkNavigation(onNavigate?: (href: string) => void) {
  const context = useContext(AssistantLinkNavigation);
  const navigate = onNavigate ?? context;
  return (event: MouseEvent<HTMLAnchorElement>) => {
    const link = event.currentTarget;
    if (
      link.origin !== window.location.origin ||
      link.protocol !== window.location.protocol ||
      !isCurrentTabNavigationClick(event, link)
    ) return false;
    navigate?.(`${link.pathname}${link.search}${link.hash}`);
    return true;
  };
}

export function AssistantReplyLink({ onClick, ...props }: ComponentProps<typeof Link>) {
  const navigate = useAssistantLinkNavigation();
  return (
    <Link
      {...props}
      onClick={(event) => {
        onClick?.(event);
        navigate(event);
      }}
    />
  );
}

export function AssistantReplyAnchor({ onClick, ...props }: ComponentProps<'a'>) {
  const navigate = useAssistantLinkNavigation();
  return (
    <a
      {...props}
      onClick={(event) => {
        onClick?.(event);
        navigate(event);
      }}
    />
  );
}
