const assert = require('node:assert/strict');
const { runInspectionTransaction } = require('./ordering/inspectionTransaction');

const closedError = () =>
  Object.assign(new Error('3 INVALID_ARGUMENT: Transaction is invalid or closed.'), { code: 3 });

test('inspection starts a fresh SDK transaction after its previous transaction token was closed', async () => {
  let calls = 0;
  const operation = async () => ({ receipt: 'inspection-version-1' });
  const db = {
    async runTransaction(callback) {
      assert.equal(callback, operation);
      if (++calls === 1) throw closedError();
      return callback();
    },
  };
  assert.deepEqual(await runInspectionTransaction(db, operation), {
    receipt: 'inspection-version-1',
  });
  assert.equal(calls, 2);
});

test('inspection stops after three closed transactions and preserves the last failure', async () => {
  let calls = 0;
  const failure = closedError();
  await assert.rejects(
    runInspectionTransaction(
      {
        async runTransaction() {
          calls += 1;
          throw failure;
        },
      },
      () => {},
    ),
    (error) => error === failure,
  );
  assert.equal(calls, 3);
});

for (const [code, message] of [
  [3, 'Invalid document path'],
  [3, 'Transaction has an invalid argument'],
  [10, 'ABORTED: Too much contention on these documents.'],
  [7, 'Permission denied'],
  ['failed-precondition', 'Refund request identity requires review'],
]) {
  test(`inspection leaves other errors to their original policy: ${message}`, async () => {
    let calls = 0;
    const failure = Object.assign(new Error(message), { code });
    await assert.rejects(
      runInspectionTransaction(
        {
          async runTransaction() {
            calls += 1;
            throw failure;
          },
        },
        () => {},
      ),
      (error) => error === failure,
    );
    assert.equal(calls, 1);
  });
}
