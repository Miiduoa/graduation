const { setTimeout: delay } = require('node:timers/promises');

async function runInspectionTransaction(db, operation) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.runTransaction(operation);
    } catch (error) {
      const closed =
        error?.code === 3 &&
        /^(?:3 INVALID_ARGUMENT: )?Transaction is invalid or closed\.$/.test(error.message || '');
      if (!closed || attempt >= 2) throw error;
      // A new SDK transaction discards the closed transaction's retry token.
      // The inspection version and receipt make these database-only writes replayable.
      await delay(50 * (attempt + 1));
    }
  }
}

module.exports = { runInspectionTransaction };
