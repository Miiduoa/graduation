// Same small error contract as the pinned API's src/domain-error.ts; no app/auth handlers are substituted.
export class DomainError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: number) {
    super(message);
    this.name = 'DomainError';
  }
}
