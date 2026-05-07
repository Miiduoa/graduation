import { executeAgentToolAction } from '../../services/aiActionExecutor';
import { getToolById } from '../../data/puAIAgentData';
import type { DataSource } from '../../data/source';

function tool(id: string) {
  const found = getToolById(id);
  if (!found) throw new Error(`Missing test tool: ${id}`);
  return found;
}

function buildDataSource(overrides: Partial<DataSource> = {}): DataSource {
  const base = {
    createRepairRequest: jest.fn(async (data: any) => ({
      id: 'repair-1',
      status: 'pending',
      createdAt: new Date().toISOString(),
      ...data,
    })),
    createLostFoundItem: jest.fn(async (data: any) => ({
      id: 'lost-1',
      status: 'open',
      createdAt: new Date().toISOString(),
      ...data,
    })),
    createCalendarEvent: jest.fn(async (data: any) => ({
      id: 'calendar-1',
      ...data,
    })),
    createHealthAppointment: jest.fn(async (data: any) => ({
      id: 'health-1',
      status: 'scheduled',
      createdAt: new Date().toISOString(),
      ...data,
    })),
    listSeats: jest.fn(async () => [
      {
        id: 'seat-1',
        zone: 'quiet',
        seatNumber: 'A-1',
        floor: '3F',
        hasOutlet: true,
        isQuietZone: true,
        status: 'available',
      },
    ]),
    reserveSeat: jest.fn(
      async (seatId: string, userId: string, date: string, startTime: string, endTime: string) => ({
        id: 'seat-res-1',
        seatId,
        userId,
        date,
        startTime,
        endTime,
        status: 'active',
        createdAt: new Date().toISOString(),
      }),
    ),
    createActionQueueItem: jest.fn(async (input: any) => ({
      ...input,
      id: 'draft-1',
      status: 'pending_confirmation',
      createdAt: new Date(),
      updatedAt: new Date(),
      confirmedAt: null,
    })),
  };
  return { ...base, ...overrides } as unknown as DataSource;
}

const baseContext = {
  userId: 'user-1',
  schoolId: 'tw-pu',
  role: 'student' as const,
  isOnline: true,
};

describe('aiActionExecutor', () => {
  it('executes repair, lost-found, reminder, health booking, and seat reservation through DataSource', async () => {
    const ds = buildDataSource();

    await expect(
      executeAgentToolAction({
        ...baseContext,
        dataSource: ds,
        tool: tool('report_repair'),
        params: { category: 'ac', room: 'A101', description: '冷氣壞了', urgency: 'high' },
      }),
    ).resolves.toMatchObject({ kind: 'executed', recordId: 'repair-1' });

    await expect(
      executeAgentToolAction({
        ...baseContext,
        dataSource: ds,
        tool: tool('post_lost'),
        params: {
          item: '學生證',
          category: 'student_card',
          location: '圖書館',
          features: '藍色吊牌',
        },
      }),
    ).resolves.toMatchObject({ kind: 'executed', recordId: 'lost-1' });

    await expect(
      executeAgentToolAction({
        ...baseContext,
        dataSource: ds,
        tool: tool('set_reminder'),
        params: { title: '交作業', datetime: '明天 10:00' },
      }),
    ).resolves.toMatchObject({ kind: 'executed', recordId: 'calendar-1' });

    await expect(
      executeAgentToolAction({
        ...baseContext,
        dataSource: ds,
        tool: tool('book_health'),
        params: { department: 'mental', date: '明天', symptom: '壓力大' },
      }),
    ).resolves.toMatchObject({ kind: 'executed', recordId: 'health-1' });

    await expect(
      executeAgentToolAction({
        ...baseContext,
        dataSource: ds,
        tool: tool('reserve_seat'),
        params: { type: 'quiet_zone', date: '明天', time_slot: 'morning', floor: '3F' },
      }),
    ).resolves.toMatchObject({ kind: 'executed', recordId: 'seat-res-1' });

    expect(ds.createRepairRequest).toHaveBeenCalled();
    expect(ds.createLostFoundItem).toHaveBeenCalled();
    expect(ds.createCalendarEvent).toHaveBeenCalled();
    expect(ds.createHealthAppointment).toHaveBeenCalled();
    expect(ds.reserveSeat).toHaveBeenCalled();
  });

  it('blocks missing auth, missing school, and unavailable seats without fake success', async () => {
    const ds = buildDataSource({
      listSeats: jest.fn(async () => []),
    });

    await expect(
      executeAgentToolAction({
        ...baseContext,
        userId: null,
        dataSource: ds,
        tool: tool('report_repair'),
        params: { category: 'ac', room: 'A101', description: '冷氣壞了' },
      }),
    ).resolves.toMatchObject({ kind: 'blocked' });

    await expect(
      executeAgentToolAction({
        ...baseContext,
        schoolId: null,
        dataSource: ds,
        tool: tool('post_lost'),
        params: { item: '學生證', location: '圖書館', features: '藍色吊牌' },
      }),
    ).resolves.toMatchObject({ kind: 'blocked' });

    await expect(
      executeAgentToolAction({
        ...baseContext,
        dataSource: ds,
        tool: tool('reserve_seat'),
        params: { type: 'quiet_zone', date: '明天', time_slot: 'morning' },
      }),
    ).resolves.toMatchObject({ kind: 'blocked' });

    expect(ds.createRepairRequest).not.toHaveBeenCalled();
    expect(ds.createLostFoundItem).not.toHaveBeenCalled();
    expect(ds.reserveSeat).not.toHaveBeenCalled();
  });

  it('denies role-mismatched tools and drafts unresolved social actions', async () => {
    const ds = buildDataSource();

    await expect(
      executeAgentToolAction({
        ...baseContext,
        dataSource: ds,
        tool: tool('assignment_publish'),
        params: { course: '資料結構', title: 'HW1', deadline: '明天' },
      }),
    ).resolves.toMatchObject({ kind: 'blocked' });

    await expect(
      executeAgentToolAction({
        ...baseContext,
        dataSource: ds,
        tool: tool('send_message'),
        params: { recipient: '小明', content: '明天一起讀書嗎？' },
      }),
    ).resolves.toMatchObject({ kind: 'drafted', recordId: 'draft-1' });

    expect(ds.createActionQueueItem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'send_message',
        status: 'pending_confirmation',
      }),
    );
  });
});
