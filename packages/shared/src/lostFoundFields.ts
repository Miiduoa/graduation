export type LostFoundWriteFields = {
  type: 'lost' | 'found';
  title: string;
  description: string;
  category: string;
  location: string;
  date: string;
  /** On edit, omit to keep the saved contact or send '' to clear it. */
  contactInfo?: string;
};

const textFields = ['title', 'description', 'category', 'location', 'date'] as const;

// A saved draft can be incomplete. Required values are checked on submission.
export function isLostFoundWriteFields(value: unknown): value is LostFoundWriteFields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    (row.type === 'lost' || row.type === 'found') &&
    textFields.every((key) => typeof row[key] === 'string') &&
    (row.contactInfo === undefined || typeof row.contactInfo === 'string')
  );
}

// Drafts and server records also carry metadata. Persist only the editable fields.
export function pickLostFoundFields(source: LostFoundWriteFields): LostFoundWriteFields {
  const { type, title, description, category, location, date, contactInfo } = source;
  return { type, title, description, category, location, date,
    ...(contactInfo === undefined ? {} : { contactInfo }) };
}

export function newLostFoundFields(
  date: string,
  type: LostFoundWriteFields['type'] = 'lost',
): LostFoundWriteFields {
  return {
    type,
    title: '',
    description: '',
    category: 'other',
    location: '',
    date,
    contactInfo: '',
  };
}

export function lostFoundFormFields(source: LostFoundWriteFields) {
  return { ...pickLostFoundFields(source), contactInfo: source.contactInfo ?? '' };
}

export function sameLostFoundFormFields(a: LostFoundWriteFields, b: LostFoundWriteFields): boolean {
  return (
    a.type === b.type &&
    textFields.every((key) => a[key] === b[key]) &&
    (a.contactInfo ?? '') === (b.contactInfo ?? '')
  );
}
