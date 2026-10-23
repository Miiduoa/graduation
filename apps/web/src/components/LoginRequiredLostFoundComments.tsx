'use client';

import Link from 'next/link';
import {
  LOGIN_REQUIRED_ACTION_TEXT,
  LOGIN_REQUIRED_LOST_FOUND_AND_COMMENTS_TEXT,
} from '@campus/shared/src/signedInSocialReads';
import { loginHref } from '@/lib/navigation';
import social from '@/features/social/Social.module.css';

export function LoginRequiredLostFoundComments({
  returnUrl,
  text = LOGIN_REQUIRED_LOST_FOUND_AND_COMMENTS_TEXT,
}: {
  returnUrl: string;
  text?: string;
}) {
  return (
    <p className={social.actions} role="status">
      <span>{text}</span>
      <Link className="btn primary" href={loginHref(returnUrl)}>
        {LOGIN_REQUIRED_ACTION_TEXT}
      </Link>
    </p>
  );
}
