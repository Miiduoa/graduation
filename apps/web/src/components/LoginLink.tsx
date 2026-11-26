'use client';

import type { MouseEvent, ReactNode } from 'react';
import { followLoginHref, loginHref } from '@/lib/navigation';

export function LoginLink({
  returnPath,
  liveReturnPath,
  className,
  children,
  onNavigateClick,
}: {
  returnPath: string;
  liveReturnPath?: () => string;
  className?: string;
  children: ReactNode;
  onNavigateClick?: (event: MouseEvent<HTMLAnchorElement>) => boolean;
}) {
  return (
    <a
      className={className}
      href={loginHref(returnPath)}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (onNavigateClick && !onNavigateClick(event)) return;
        followLoginHref(event, liveReturnPath ? liveReturnPath() : returnPath);
      }}
    >
      {children}
    </a>
  );
}
