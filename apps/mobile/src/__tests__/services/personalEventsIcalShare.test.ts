import { ownedICalCacheFilename, shareICalContent } from '../../services/ical';

function dependencies() {
  const remove = jest.fn();
  return {
    remove,
    isAvailable: jest.fn().mockResolvedValue(true),
    write: jest.fn().mockResolvedValue({ uri: 'file:///owned-events.ics', remove }),
    share: jest.fn().mockResolvedValue(undefined),
  };
}

/** Mirrors native write ownership: unique path per invocation, cleanup only that path. */
function overlappingNativeWrite() {
  const files = new Map<string, { removed: boolean }>();
  const write = jest.fn(async (_content: string, filename: string) => {
    const owned = ownedICalCacheFilename(filename);
    files.set(owned, { removed: false });
    return {
      uri: `file:///${owned}`,
      remove: () => {
        const entry = files.get(owned);
        if (entry) entry.removed = true;
      },
    };
  });
  return { files, write };
}

const sample = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n`;

test('ownedICalCacheFilename keeps a readable .ics stem and never reuses the same path', () => {
  const first = ownedICalCacheFilename('campus-one-personal-events.ics', 1_700_000_000_000);
  const second = ownedICalCacheFilename('campus-one-personal-events.ics', 1_700_000_000_000);
  expect(first).toMatch(/^campus-one-personal-events-\d+-\d+\.ics$/);
  expect(second).toMatch(/^campus-one-personal-events-\d+-\d+\.ics$/);
  expect(first).not.toBe(second);
});

test('writes an ICS file and shares with the native calendar MIME path', async () => {
  const deps = dependencies();
  await shareICalContent(sample, 'campus-one-personal-events.ics', () => true, deps);
  expect(deps.write).toHaveBeenCalledWith(sample, 'campus-one-personal-events.ics');
  expect(deps.share).toHaveBeenCalledWith('file:///owned-events.ics');
  expect(deps.remove).not.toHaveBeenCalled();
});

test('unavailable sharing does not create a file', async () => {
  const deps = dependencies();
  deps.isAvailable.mockResolvedValue(false);
  await expect(shareICalContent(sample, 'x.ics', () => true, deps)).rejects.toThrow('分享選單');
  expect(deps.write).not.toHaveBeenCalled();
});

test('share failure cleans only the owned output file', async () => {
  const deps = dependencies();
  deps.share.mockRejectedValue(new Error('分享選單失敗'));
  await expect(shareICalContent(sample, 'x.ics', () => true, deps)).rejects.toThrow();
  expect(deps.remove).toHaveBeenCalledTimes(1);
});

test('account switch after write prevents opening the share sheet and cleans up', async () => {
  const deps = dependencies();
  let active = true;
  deps.write.mockImplementation(async () => {
    active = false;
    return { uri: 'file:///owned-events.ics', remove: deps.remove };
  });
  await expect(shareICalContent(sample, 'x.ics', () => active, deps)).rejects.toThrow('切換');
  expect(deps.share).not.toHaveBeenCalled();
  expect(deps.remove).toHaveBeenCalledTimes(1);
});

test('account switch before availability check suppresses write and share', async () => {
  const deps = dependencies();
  await expect(shareICalContent(sample, 'x.ics', () => false, deps)).rejects.toThrow('切換');
  expect(deps.isAvailable).not.toHaveBeenCalled();
  expect(deps.write).not.toHaveBeenCalled();
  expect(deps.share).not.toHaveBeenCalled();
});

test('scope becoming inactive during share removes exactly the owned ICS file', async () => {
  const deps = dependencies();
  let active = true;
  deps.share.mockImplementation(async () => {
    active = false;
  });
  await expect(shareICalContent(sample, 'x.ics', () => active, deps)).rejects.toThrow('切換');
  expect(deps.share).toHaveBeenCalledWith('file:///owned-events.ics');
  expect(deps.remove).toHaveBeenCalledTimes(1);
});

test('overlapping exports use distinct owned paths so one cleanup cannot delete the other', async () => {
  const { files, write } = overlappingNativeWrite();
  const shared: string[] = [];
  let firstActive = true;
  let finishFirstShare!: () => void;
  let firstShareStarted!: () => void;
  const started = new Promise<void>((resolve) => { firstShareStarted = resolve; });
  const firstShare = new Promise<void>((resolve) => { finishFirstShare = resolve; });
  const first = shareICalContent(
    sample + 'FIRST',
    'campus-one-personal-events.ics',
    () => firstActive,
    {
      isAvailable: async () => true,
      write,
      share: async (uri) => {
        shared.push(uri);
        firstShareStarted();
        await firstShare;
      },
    },
  );
  await started;

  await shareICalContent(sample + 'SECOND', 'campus-one-personal-events.ics', () => true, {
    isAvailable: async () => true,
    write,
    share: async (uri) => {
      shared.push(uri);
    },
  });

  // The old account completes after the newer export has already created its file.
  firstActive = false;
  finishFirstShare();
  await expect(first).rejects.toThrow('切換');

  expect(write).toHaveBeenCalledTimes(2);
  expect(shared).toHaveLength(2);
  expect(shared[0]).not.toBe(shared[1]);
  const ownedNames = [...files.keys()];
  expect(ownedNames).toHaveLength(2);
  expect(ownedNames[0]).not.toBe(ownedNames[1]);
  expect(files.get(ownedNames[0])?.removed).toBe(true);
  expect(files.get(ownedNames[1])?.removed).toBe(false);
});
