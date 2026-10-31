// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createNuniClassroom } from '@campus/shared/src/nuniClassroom';
import { NuniError } from '@campus/shared/src/nuni';

const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
const classroomId = 'cws_22222222-2222-4222-8222-222222222222';
const otherClassroomId = 'cws_33333333-3333-4333-8333-333333333333';
const accountId = 'pa_44444444-4444-4444-8444-444444444444';
const base = `class-workspaces/${workspaceId}`;
const session = { id: classroomId, title: '第一堂課', state: 'open', checkedInByMe: false };
const person = { platformAccountId: accountId, displayName: '王同學' };

describe('classroom resource contracts', () => {
  it('reads the existing session, attendance roster and membership endpoints', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce({ sessions: [session] })
      .mockResolvedValueOnce({ sessionId: classroomId, present: [person], absent: [], late: [] })
      .mockResolvedValueOnce({ members: [{ ...person, role: 'student' }] });
    const classroom = createNuniClassroom(transport);
    expect(await classroom.sessions(workspaceId)).toEqual([expect.objectContaining(session)]);
    expect(await classroom.roster(workspaceId, classroomId)).toEqual({
      present: [expect.objectContaining(person)],
      absent: [],
      late: [],
    });
    expect(await classroom.members(workspaceId)).toEqual([{ ...person, memberRole: 'student' }]);
    expect(transport.mock.calls).toEqual([
      [`${base}/classroom-sessions`],
      [`${base}/classroom-sessions/${classroomId}/roster`],
      [`${base}/members`],
    ]);
  });

  it.each(['owner-teacher', 'co-teacher', 'student'])(
    'retains existing %s membership roles',
    async (memberRole) => {
      const classroom = createNuniClassroom(async () => ({ members: [{ ...person, memberRole }] }));
      expect(await classroom.members(workspaceId)).toEqual([{ ...person, memberRole }]);
    },
  );

  it.each(['王'.repeat(300), '', '   ', null, undefined])(
    'keeps existing display name values readable (%j)',
    async (name) => {
      const transport = vi
        .fn()
        .mockResolvedValueOnce({ members: [{ ...person, displayName: name, role: 'student' }] })
        .mockResolvedValueOnce({
          present: [{ ...person, displayName: name }],
          absent: [],
          late: [],
        });
      const classroom = createNuniClassroom(transport);
      expect((await classroom.members(workspaceId))[0].displayName).toBe(
        name?.trim() ? name : '成員',
      );
      expect((await classroom.roster(workspaceId, classroomId)).present[0].displayName).toBe(
        name?.trim() ? name : '同學',
      );
    },
  );

  it('posts empty JSON or the supplied short code without inventing a receipt', async () => {
    const transport = vi.fn().mockResolvedValue({});
    const classroom = createNuniClassroom(transport);
    expect(await classroom.checkIn(workspaceId, classroomId)).toBeUndefined();
    await classroom.checkIn(workspaceId, classroomId, ' ABCD12 ');
    expect(transport.mock.calls).toEqual([
      [`${base}/classroom-sessions/${classroomId}/check-in`, {}],
      [`${base}/classroom-sessions/${classroomId}/check-in`, { code: 'ABCD12' }],
    ]);
  });

  it('preserves a failed check-in for the caller to display and retry', async () => {
    const failure = new NuniError(422, 'CLASSROOM_SESSION_CODE_INVALID');
    const classroom = createNuniClassroom(async () => {
      throw failure;
    });
    await expect(classroom.checkIn(workspaceId, classroomId, 'WRONG1')).rejects.toBe(failure);
  });

  it.each([
    {},
    { sessions: null },
    { sessions: [session, session] },
    { sessions: [{ ...session, id: '../other' }] },
    { sessions: [{ ...session, state: 'unknown' }] },
    { sessions: [{ ...session, checkedInByMe: 'true' }] },
    { sessions: [{ ...session, checkInCount: -1 }] },
    { sessions: [{ ...session, workspaceId: 'another-course' }] },
  ])(
    'rejects malformed sessions instead of displaying an empty or successful state (%j)',
    async (value) => {
      await expect(
        createNuniClassroom(async () => value).sessions(workspaceId),
      ).rejects.toMatchObject({ status: 502, code: 'INVALID_RESPONSE' });
    },
  );

  it.each([
    {},
    { present: [], absent: [] },
    { sessionId: otherClassroomId, present: [], absent: [], late: [] },
    { present: [{ ...person, platformAccountId: 'other' }], absent: [], late: [] },
  ])('rejects malformed or mismatched attendance rosters (%j)', async (value) => {
    await expect(
      createNuniClassroom(async () => value).roster(workspaceId, classroomId),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects invalid identifiers and overlong codes before sending requests', async () => {
    const transport = vi.fn();
    const classroom = createNuniClassroom(transport);
    await expect(classroom.sessions('../other')).rejects.toBeInstanceOf(NuniError);
    await expect(classroom.checkIn(workspaceId, '../other')).rejects.toBeInstanceOf(NuniError);
    await expect(classroom.checkIn(workspaceId, classroomId, 'x'.repeat(41))).rejects.toMatchObject(
      { code: 'INVALID_INPUT' },
    );
    expect(transport).not.toHaveBeenCalled();
  });
});
