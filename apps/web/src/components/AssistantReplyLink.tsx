'use client';

import Link from 'next/link';
import { createContext, useContext, type ComponentProps } from 'react';
import { isCurrentTabNavigationClick } from '@/lib/currentTabNavigation';

export const AssistantLinkNavigation = createContext<((href: string) => void) | undefined>(
  undefined,
);

export function AssistantReplyLink({ onClick, ...props }: ComponentProps<typeof Link>) {
  const onNavigate = useContext(AssistantLinkNavigation);
  return (
    <Link
      {...props}
      onClick={(event) => {
        onClick?.(event);
        const link = event.currentTarget;
        if (
          onNavigate &&
          link.href === window.location.href &&
          isCurrentTabNavigationClick(event, link)
        ) {
          onNavigate(`${link.pathname}${link.search}${link.hash}`);
        }
      }}
    />
  );
}
