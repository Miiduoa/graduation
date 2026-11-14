import { createUidRateLimiter } from './uidRateLimit';
/** Separate budget: 30 check-ins plus confirmed roster refreshes must fit in one minute. */
export const clubPortalRateLimit = createUidRateLimiter({ requestsPerMinute: 240 });
