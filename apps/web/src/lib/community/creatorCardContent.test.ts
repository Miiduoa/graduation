import { describe, expect, it } from 'vitest';
import {
  creatorCardDocumentPassesRules, CREATOR_CARD_LIMITS, EMPTY_CREATOR_CARD,
  readCreatorCardFields, validateCreatorCard,
} from '@campus/shared/src/creatorCard';

describe('creator card content', () => {
  it('normalizes fields and only accepts plain HTTPS links without credentials', () => {
    expect(validateCreatorCard({
      headline: '  讀書與攝影  ',
      bio: '  喜歡用照片記錄校園  ',
      linkUrl: '  https://example.org/me  ',
    })).toEqual({
      headline: '讀書與攝影',
      bio: '喜歡用照片記錄校園',
      linkUrl: 'https://example.org/me',
    });
    expect(() => validateCreatorCard({ ...EMPTY_CREATOR_CARD, linkUrl: 'javascript:alert(1)' })).toThrow();
    expect(() => validateCreatorCard({ ...EMPTY_CREATOR_CARD, linkUrl: 'http://example.org' })).toThrow();
    expect(() => validateCreatorCard({ ...EMPTY_CREATOR_CARD, linkUrl: 'https://user:pass@example.org' })).toThrow();
    expect(() => validateCreatorCard({ ...EMPTY_CREATOR_CARD, linkUrl: 'https://localhost/private' })).toThrow();
  });
  it('rejects oversized headlines, bios and links', () => {
    expect(() => validateCreatorCard({
      ...EMPTY_CREATOR_CARD, headline: 'A'.repeat(CREATOR_CARD_LIMITS.headline + 1),
    })).toThrow();
    expect(() => validateCreatorCard({
      ...EMPTY_CREATOR_CARD, bio: 'A'.repeat(CREATOR_CARD_LIMITS.bio + 1),
    })).toThrow();
    expect(() => validateCreatorCard({
      ...EMPTY_CREATOR_CARD, linkUrl: 'https://example.org/' + 'x'.repeat(540),
    })).toThrow();
  });
  it('reads only the allowlisted public fields, stripping unsafe legacy URLs', () => {
    expect(readCreatorCardFields({
      headline: '校園攝影', bio: '分享日常', linkUrl: 'data:text/html,<script/>',
      schoolId: 'pu', ownerUid: 'alice', phone: 'secret',
    })).toEqual({ headline: '校園攝影', bio: '分享日常', linkUrl: '' });
    expect(readCreatorCardFields({})).toEqual(EMPTY_CREATOR_CARD);
  });
});

describe('merged creator card document rules', () => {
  const document = {
    ...EMPTY_CREATOR_CARD, schoolId: 'pu', ownerUid: 'alice', updatedAt: 'request-time',
  };
  const passes = (data: Record<string, unknown>) =>
    creatorCardDocumentPassesRules(data, 'pu', 'alice', 'request-time');

  it('requires every mandatory key and allows an optional pin', () => {
    expect(passes(document)).toBe(true);
    expect(passes({ ...document, pinnedPostId: '' })).toBe(true);
    expect(passes({ ...document, pinnedPostId: 'post-1_2' })).toBe(true);
    for (const key of Object.keys(document)) {
      const missing: Record<string, unknown> = { ...document };
      delete missing[key];
      expect(passes(missing)).toBe(false);
    }
    expect(passes({ ...document, extra: true })).toBe(false);
  });

  it.each([
    { schoolId: 'other' }, { ownerUid: 'other' }, { updatedAt: 'old-time' },
    { pinnedPostId: null }, { pinnedPostId: 'post/id' }, { pinnedPostId: 'a'.repeat(129) },
    { linkUrl: 'http://example.org/' }, { linkUrl: 'https://user@example.org/' },
    { linkUrl: ' https://example.org/' }, { linkUrl: 'https://example.org/a b' },
    { linkUrl: 'https://example.org/\u0085' },
  ])('rejects a merged document containing %j', (patch) => {
    expect(passes({ ...document, ...patch })).toBe(false);
  });

  it('allows values at their rule limits and an HTTPS path containing @', () => {
    const prefix = 'HTTPS://example.org/@';
    expect(passes({
      ...document,
      headline: '字'.repeat(CREATOR_CARD_LIMITS.headline),
      bio: '字'.repeat(CREATOR_CARD_LIMITS.bio),
      linkUrl: prefix + 'x'.repeat(CREATOR_CARD_LIMITS.linkUrl - prefix.length),
      pinnedPostId: 'x'.repeat(128),
    })).toBe(true);
  });
});
