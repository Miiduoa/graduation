'use client';

import Link from 'next/link';
import { schoolLoginHref } from '@/lib/navigation';
import social from '@/features/social/Social.module.css';

const DEFAULT_LOST_FOUND_SCHOOL_PROMPT = '查看失物招領需要學校帳號。';
const SCHOOL_ACCOUNT_ACTION_TEXT = '連線學校帳號';

export function LoginRequiredLostFoundComments({
  returnUrl,
  text = DEFAULT_LOST_FOUND_SCHOOL_PROMPT,
}: {
  returnUrl: string;
  text?: string;
}) {
  return (
    <p className={social.actions} role="status">
      <span>{text}</span>
      <Link className="btn primary" href={schoolLoginHref(returnUrl)}>
        {SCHOOL_ACCOUNT_ACTION_TEXT}
      </Link>
    </p>
  );
}
