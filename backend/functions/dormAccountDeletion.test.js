const { clearDormAccountData } = require('./dormAccountDeletion');
function fixture() {
  const privatePath = 'dorm-private/11111111-1111-4111-8111-111111111111';
  const legacyPath = 'temp/alice/dorm_photo.jpg';
  const url = 'https://firebasestorage.googleapis.com/v0/b/test/o/';
  const docs = new Map([
    ['schools/pu/dormRepairs/t', { userId: 'alice', images: [privatePath, url + encodeURIComponent(legacyPath), 'https://example.com/photo', url + 'temp%2Fbob%2Fdorm_photo.jpg'] }],
    ['schools/pu/dormPhotoUploads/u', { userId: 'alice', path: privatePath }],
    ['schools/pu/dormRepairs/other', { userId: 'bob', images: [privatePath] }],
    ['groups/g/dormRepairs/t', { userId: 'alice', images: [privatePath] }],
  ]);
  const remove = jest.fn().mockResolvedValue(undefined);
  const bucket = { name: 'test', file: (path) => ({ delete: (options) => remove(path, options) }) };
  const db = { collectionGroup: (name) => name, recursiveDelete: async (ref) => docs.delete(ref.path) };
  const scanPages = async (name, visit) => {
    for (const [path, row] of [...docs]) {
      if (path.split('/').at(-2) === name)
        await visit({ id: path.split('/').at(-1), ref: { path }, data: () => row });
    }
  };
  return { docs, remove, privatePath, legacyPath, run: () => clearDormAccountData({ db, uid: 'alice', scanPages, getBucket: () => bucket }) };
}
test('deletes owned photos before ownership records and leaves other users and paths intact', async () => {
  const { docs, remove, run, privatePath, legacyPath } = fixture();
  remove.mockImplementation(async () => {
    expect(docs.has('schools/pu/dormRepairs/t') || docs.has('schools/pu/dormPhotoUploads/u')).toBe(true);
  });
  await run();
  expect(remove.mock.calls).toEqual([
    [privatePath, { ignoreNotFound: true }], [legacyPath, { ignoreNotFound: true }], [privatePath, { ignoreNotFound: true }],
  ]);
  expect([...docs.keys()]).toEqual(['schools/pu/dormRepairs/other', 'groups/g/dormRepairs/t']);
  await run();
  expect(remove).toHaveBeenCalledTimes(3);
});
test.each([1, 2, 3])('Storage failure at delete %s preserves ownership for retry', async (failAt) => {
  const { docs, remove, run } = fixture();
  for (let n = 1; n < failAt; n++) remove.mockResolvedValueOnce(undefined);
  remove.mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(run()).rejects.toThrow('Storage unavailable');
  expect(docs.has(failAt === 3 ? 'schools/pu/dormPhotoUploads/u' : 'schools/pu/dormRepairs/t')).toBe(true);
  await run();
  expect(docs.has('schools/pu/dormRepairs/t')).toBe(false);
  expect(docs.has('schools/pu/dormPhotoUploads/u')).toBe(false);
});
