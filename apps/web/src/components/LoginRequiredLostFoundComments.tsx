'use client';

import Link from 'next/link';
import {
  LOGIN_REQUIRED_ACTION_TEXT,
  LOGIN_REQUIRED_LOST_FOUND_AND_COMMENTS_TEXT,
} from '@campus/shared/src/signedInSocialReads';
import social from '@/features/social/Social.module.css';

export function LoginRequiredLostFoundComments({ returnUrl }: { returnUrl: string }) {
  return (
    <p className={social.actions} role="status">
      <span>{LOGIN_REQUIRED_LOST_FOUND_AND_COMMENTS_TEXT}</span>
      <Link className="btn primary" href={`/login?returnUrl=${encodeURIComponent(returnUrl)}`}>
        {LOGIN_REQUIRED_ACTION_TEXT}
      </Link>
    </p>
  );
}
