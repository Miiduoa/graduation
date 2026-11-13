/** Public connection metadata. School cookies and passwords never belong in this contract. */
export type TronClassBindingStatus = {
  schoolId: 'pu';
  connected: boolean;
  revision: string | null;
  account: string | null;
  userName: string | null;
  expiresAt: string | null;
};

export type TronClassConnectInput = {
  schoolId: 'pu';
  account: string;
  password: string;
  expectedRevision: string | null;
};
