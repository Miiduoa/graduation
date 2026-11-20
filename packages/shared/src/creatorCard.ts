/** Content a member elects to share with other members of the same campus. */
export type CreatorCard = {
  headline: string;
  bio: string;
  linkUrl: string;
};

export const EMPTY_CREATOR_CARD: CreatorCard = { headline: '', bio: '', linkUrl: '' };

export const CREATOR_CARD_LIMITS = {
  headline: 64,
  bio: 220,
  linkUrl: 512,
} as const;

/** Validation is shared by Web and native App; Firestore rules enforce the same limits. */
export function validateCreatorCard(input: CreatorCard): CreatorCard {
  const headline = input.headline.trim();
  const bio = input.bio.trim();
  const inputUrl = input.linkUrl.trim();
  if (headline.length > CREATOR_CARD_LIMITS.headline) {
    throw new Error('一句話介紹最多 64 字。');
  }
  if (bio.length > CREATOR_CARD_LIMITS.bio) {
    throw new Error('個人簡介最多 220 字。');
  }
  let linkUrl = '';
  if (inputUrl) {
    let parsed: URL;
    try {
      parsed = new URL(inputUrl);
    } catch {
      throw new Error('請輸入有效的 HTTPS 網址。');
    }
    if (
      parsed.protocol !== 'https:' ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.hostname === 'localhost' ||
      parsed.hostname.endsWith('.localhost')
    ) {
      throw new Error('個人連結必須是有效的 HTTPS 網址，不能包含帳密。');
    }
    linkUrl = parsed.href;
    if (linkUrl.length > CREATOR_CARD_LIMITS.linkUrl) {
      throw new Error('個人連結最多 512 字。');
    }
  }
  return { headline, bio, linkUrl };
}

/** Do not trust Firestore's runtime shape when rendering a public card. */
export function readCreatorCardFields(data: Record<string, unknown>): CreatorCard {
  const headline = typeof data.headline === 'string'
    ? data.headline.slice(0, CREATOR_CARD_LIMITS.headline) : '';
  const bio = typeof data.bio === 'string'
    ? data.bio.slice(0, CREATOR_CARD_LIMITS.bio) : '';
  const linkUrl = typeof data.linkUrl === 'string' ? data.linkUrl : '';
  try {
    return validateCreatorCard({ headline, bio, linkUrl });
  } catch {
    return { headline, bio, linkUrl: '' };
  }
}
