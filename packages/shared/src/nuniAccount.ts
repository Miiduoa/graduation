import { NuniError, nuniRecord } from './nuni';

export type NuniMembership = {
  membershipId: string;
  tenantId: string;
  campusName: string;
  state: 'pending' | 'verified' | 'rejected' | 'revoked';
  assurance: string;
};
export function parseNuniMemberships(value: unknown): NuniMembership[] {
  const list = nuniRecord(value).memberships;
  if (!Array.isArray(list) || list.length > 10000) throw new NuniError(502, 'INVALID_RESPONSE');
  return list.map((value) => {
    const row = nuniRecord(value);
    for (const key of ['membershipId', 'tenantId', 'campusName', 'assurance']) {
      if (typeof row[key] !== 'string' || !row[key].trim() || row[key].length > 300)
        throw new NuniError(502, 'INVALID_RESPONSE');
    }
    if (!['pending', 'verified', 'rejected', 'revoked'].includes(String(row.state)))
      throw new NuniError(502, 'INVALID_RESPONSE');
    return {
      membershipId: row.membershipId as string,
      tenantId: row.tenantId as string,
      campusName: row.campusName as string,
      assurance: row.assurance as string,
      state: row.state as NuniMembership['state'],
    };
  });
}
export function membershipStateLabel(state: NuniMembership['state']): string {
  return { pending: '待驗證', verified: '已驗證', rejected: '未通過', revoked: '已撤銷' }[state];
}

export type NuniMembershipRequest = { claimedEmail: string };
export type NuniMembershipReceipt = {
  membershipId: string;
  tenantId: string;
  state: NuniMembership['state'];
  created: boolean;
};
export function validateMembershipRequestInput(value: unknown): NuniMembershipRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new NuniError(422, 'INVALID_INPUT');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => key !== 'claimedEmail') ||
    typeof input.claimedEmail !== 'string'
  )
    throw new NuniError(422, 'INVALID_INPUT');
  const claimedEmail = input.claimedEmail.trim().toLowerCase();
  if (claimedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claimedEmail))
    throw new NuniError(422, 'INVALID_INPUT');
  return { claimedEmail };
}
export function parseMembershipRequestReceipt(value: unknown): NuniMembershipReceipt {
  const row = nuniRecord(value);
  if (
    typeof row.membershipId !== 'string' ||
    !/^pm_[0-9a-f-]{36}$/.test(row.membershipId) ||
    typeof row.tenantId !== 'string' ||
    !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(row.tenantId) ||
    row.tenantId.length > 200 ||
    !['pending', 'verified', 'rejected', 'revoked'].includes(String(row.state)) ||
    typeof row.created !== 'boolean' ||
    (row.created && row.state !== 'pending')
  )
    throw new NuniError(502, 'INVALID_RESPONSE');
  return {
    membershipId: row.membershipId,
    tenantId: row.tenantId,
    state: row.state as NuniMembership['state'],
    created: row.created,
  };
}
export function membershipReceiptMessage(receipt: NuniMembershipReceipt): string {
  if (receipt.created) return '申請已收件，等待學校驗證。送出申請不會授予學生、教師或管理權限。';
  return `這所學校已有資格紀錄：${membershipStateLabel(receipt.state)}。未建立重複申請；如需更正，請聯絡該校管理者。`;
}
