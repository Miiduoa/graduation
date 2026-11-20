import { describe, expect, it } from 'vitest';
import {
  CREATOR_CARD_LIMITS, EMPTY_CREATOR_CARD,
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
