import { DocumentCoordinator } from '../services/imports/documentCoordinator';
const doc = (name = 'grades.xlsx') => ({
  format: 'xlsx',
  name,
  warnings: [],
  sections: [
    {
      id: 'sheet-1',
      label: '本學期',
      needsOcr: false,
      warnings: [],
      rows: [
        { line: 1, cells: ['title', 'credits'] },
        { line: 2, cells: ['English', '3'] },
      ],
    },
  ],
});
const ready = JSON.stringify({ channel: 'campus-document', ready: true });
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
test('cancelling a read destroys its host; stale completion cannot replace the next document', async () => {
  const inject = jest.fn(),
    restart = jest.fn(),
    coordinator = new DocumentCoordinator(inject, restart);
  coordinator.message(ready);
  const first = coordinator.read('old.pdf', 'YQ==').catch((error) => error.code);
  const second = coordinator.read('grades.xlsx', 'Yg==');
  expect(await first).toBe('cancelled');
  expect(restart).toHaveBeenCalledTimes(1);
  coordinator.message(
    JSON.stringify({ channel: 'campus-document', id: 1, ok: true, document: doc('old.pdf') }),
  );
  coordinator.message(ready);
  coordinator.message(
    JSON.stringify({ channel: 'campus-document', id: 2, ok: true, document: doc() }),
  );
  expect(await second).toEqual(doc());
  expect(restart).toHaveBeenCalledTimes(2);
});
test('aborted and timed-out requests reject and reset the reader', async () => {
  const restart = jest.fn(),
    coordinator = new DocumentCoordinator(jest.fn(), restart),
    abort = new AbortController();
  const first = coordinator.read('grades.xlsx', 'YQ==', abort.signal).catch((error) => error.code);
  abort.abort();
  expect(await first).toBe('cancelled');
  const second = coordinator.read('grades.xlsx', 'YQ==').catch((error) => error.code);
  jest.advanceTimersByTime(60_000);
  expect(await second).toBe('timeout');
  expect(restart).toHaveBeenCalledTimes(2);
});
test('malformed result or wrong source filename cannot enter the editable draft', async () => {
  const coordinator = new DocumentCoordinator(jest.fn(), jest.fn());
  const pending = coordinator.read('grades.xlsx', 'YQ==').catch((error) => error.message);
  coordinator.message(
    JSON.stringify({
      channel: 'campus-document',
      id: 1,
      ok: true,
      document: doc('someone-else.xlsx'),
    }),
  );
  expect(await pending).toContain('結果不符');
  const next = coordinator.read('grades.xlsx', 'YQ==').catch((error) => error.code);
  coordinator.message(
    JSON.stringify({
      channel: 'campus-document',
      id: 2,
      ok: true,
      document: { name: 'grades.xlsx' },
    }),
  );
  expect(await next).toBe('invalid-result');
});
test('explicit pdfMode ocr is wired into the bridge call; auto omits the fourth argument', async () => {
  const inject = jest.fn();
  const coordinator = new DocumentCoordinator(inject, jest.fn());
  coordinator.message(ready);
  const auto = coordinator.read('grades.pdf', 'YQ==');
  expect(inject).toHaveBeenLastCalledWith(
    expect.stringMatching(/^window\.readCampusDocument\(1,"grades\.pdf","YQ=="\); true;$/),
  );
  coordinator.message(
    JSON.stringify({ channel: 'campus-document', id: 1, ok: true, document: doc('grades.pdf') }),
  );
  await auto;
  const ocr = coordinator.read('grades.pdf', 'YQ==', undefined, { pdfMode: 'ocr' });
  coordinator.message(ready);
  expect(inject).toHaveBeenLastCalledWith(
    expect.stringMatching(/^window\.readCampusDocument\(2,"grades\.pdf","YQ==","ocr"\); true;$/),
  );
  coordinator.message(
    JSON.stringify({ channel: 'campus-document', id: 2, ok: true, document: doc('grades.pdf') }),
  );
  await ocr;
});
