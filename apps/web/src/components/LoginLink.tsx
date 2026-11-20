'use client';

import type { MouseEvent, ReactNode } from 'react';
import { followLoginHref, loginHref } from '@/lib/navigation';

export function LoginLink({
  returnPath,
  liveReturnPath,
  className,
  children,
}: {
  returnPath: string;
  liveReturnPath?: () => string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      className={className}
      href={loginHref(returnPath)}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        followLoginHref(event, liveReturnPath ? liveReturnPath() : returnPath);
      }}
    >
      {children}
    </a>
  );
}
