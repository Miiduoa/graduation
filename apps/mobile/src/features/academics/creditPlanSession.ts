/** A confirmation belongs to one mounted session and one saved revision. */
export type CreditPlanTicket = Readonly<{
  owner: symbol;
  generation: number;
  revision: number;
}>;

export function createCreditPlanSession() {
  const owner = Symbol('credit-plan-session');
  let generation = 0;
  let revision = 0;
  let active = false;
  let writer: CreditPlanTicket | null = null;

  const snapshot = (): CreditPlanTicket => Object.freeze({ owner, generation, revision });
  const isLive = (ticket: CreditPlanTicket): boolean =>
    active && ticket.owner === owner && ticket.generation === generation;
  const isCurrent = (ticket: CreditPlanTicket): boolean =>
    isLive(ticket) && ticket.revision === revision;

  return {
    /** Also invalidates old work when retrying a read or remounting in Strict Mode. */
    restart(): CreditPlanTicket {
      generation += 1;
      revision = 0;
      active = true;
      writer = null;
      return snapshot();
    },
    dispose(): void {
      active = false;
      generation += 1;
      writer = null;
    },
    snapshot,
    isLive,
    isCurrent,
    acquire(ticket: CreditPlanTicket): boolean {
      if (!isCurrent(ticket) || writer !== null) return false;
      writer = ticket;
      return true;
    },
    /** Late completions cannot release a newer session's lock. */
    finish(ticket: CreditPlanTicket, saved: boolean): CreditPlanTicket | null {
      if (writer !== ticket) return null;
      writer = null;
      if (!isCurrent(ticket)) return null;
      if (saved) revision += 1;
      return snapshot();
    },
  };
}
