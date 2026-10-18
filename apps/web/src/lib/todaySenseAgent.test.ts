import { describe, expect, it } from 'vitest';
import {
  AGENT_DOWNLOAD_FACTS,
  AGENT_DOWNLOAD_NOTE,
  assembleAgentPlan,
  canOfferOnDeviceAgent,
  formatAgentDownloadProgress,
  listAcceptedAgentConsentKeys,
  orderedSenseCards,
  parseAgentConsent,
  serializeAgentConsent,
  validateExtract,
  validateJudgement,
} from '@campus/shared/src/todaySenseAgent';
import {
  emptySenseState,
  selectSenseCards,
  type SenseInputItem,
} from '@campus/shared/src/todaySense';

const now = new Date('2026-10-19T05:00:00.000Z');

const catalog = [
  { id: 'cs101', name: '資料結構' },
  { id: 'phys-lab', name: '普通物理實驗' },
  { id: 'calc-a', name: '微積分甲' },
  { id: 'zh-tw', name: '國文（臺灣文學）' },
];

function items(): SenseInputItem[] {
  return [
    {
      id: 'live-1',
      kind: 'live',
      courseId: 'calc-a',
      courseName: '微積分甲',
      title: '課堂點名',
      dueAt: null,
    },
    {
      id: 'poem',
      kind: 'assignment',
      courseId: 'zh-tw',
      courseName: '國文（臺灣文學）',
      title: '繳交「臺灣」現代詩習作',
      dueAt: '2026-10-18T16:00:00.000Z',
    },
    {
      id: 'quiz-1',
      kind: 'quiz',
      courseId: 'phys-lab',
      courseName: '普通物理實驗',
      title: '第一次小考',
      dueAt: '2026-10-19T07:00:00.000Z',
    },
    {
      id: 'hw-3',
      kind: 'assignment',
      courseId: 'cs101',
      courseName: '資料結構',
      title: '習題三',
      dueAt: '2026-10-20T01:00:00.000Z',
    },
  ];
}

function cards() {
  return selectSenseCards({ now, items: items(), state: emptySenseState() }).cards;
}

describe('裝置端輸出驗證', () => {
  it('攔截不是原文連續字的標題與課程表外的課', () => {
    const source = '國文（臺灣文學）公告：繳交「臺灣」現代詩習作已過截止時間（10/19 00:00）。';
    const badSpan = validateExtract(
      JSON.stringify({
        hasActionableTask: true,
        courseId: 'zh-tw',
        titleSpan: '臺灣「現代詩習作」',
        dueSpan: '10/19 00:00',
        kind: 'assignment',
        quote: '繳交「臺灣」現代詩習作已過截止時間（10/19 00:00）。',
      }),
      { sourceText: source, catalog },
    );
    expect(badSpan.ok).toBe(false);
    if (badSpan.ok) return;
    expect(badSpan.reason).toContain('titleSpan');

    const badCourse = validateExtract(
      JSON.stringify({
        hasActionableTask: true,
        courseId: 'history',
        titleSpan: '期末考',
        dueSpan: '10/22 10:00',
        kind: 'quiz',
        quote: '期末考訂於 10/22 10:00',
      }),
      { sourceText: '歷史系「中國近代史」期末考訂於 10/22 10:00 在人社院舉行。', catalog },
    );
    expect(badCourse.ok).toBe(false);
  });

  it('圖書館公告沒有待辦才算過', () => {
    const source =
      '自 10 月 20 日起至 10 月 31 日止，總圖書館一樓閱覽室平日開放至 22:00。週日維持 17:00 閉館。';
    const ok = validateExtract(
      JSON.stringify({
        hasActionableTask: false,
        courseId: null,
        titleSpan: '',
        dueSpan: '',
        kind: 'info',
        quote: '週日維持 17:00 閉館',
      }),
      { sourceText: source, catalog },
    );
    expect(ok).toEqual({
      ok: true,
      value: {
        hasActionableTask: false,
        courseId: null,
        titleSpan: '',
        dueSpan: '',
        kind: 'info',
        quote: '週日維持 17:00 閉館',
      },
    });
    const invented = validateExtract(
      JSON.stringify({
        hasActionableTask: true,
        courseId: 'cs101',
        titleSpan: '期末報告',
        dueSpan: '22:00',
        kind: 'assignment',
        quote: '平日開放至 22:00',
      }),
      { sourceText: source, catalog },
    );
    expect(invented.ok).toBe(false);
  });

  it('發明卡片或漏掉點名時退回規則版', () => {
    const set = cards();
    const invented = validateJudgement(
      JSON.stringify({
        order: [...set.map((card) => card.id), 'overdue:ghost:1'],
      }),
      set,
      now,
    );
    expect(invented.ok).toBe(false);

    const noLiveFirst = validateJudgement(
      JSON.stringify({
        order: set.filter((card) => card.kind !== 'live_now').map((card) => card.id).concat(
          set.filter((card) => card.kind === 'live_now').map((card) => card.id),
        ),
      }),
      set,
      now,
    );
    expect(noLiveFirst.ok).toBe(false);
  });

  it('合法排序只動先後，課名與截止仍從原卡帶入', () => {
    const set = cards();
    const live = set.find((card) => card.kind === 'live_now');
    const quiz = set.find((card) => card.title === '第一次小考');
    const overdue = set.find((card) => card.kind === 'overdue');
    const later = set.find((card) => card.title === '習題三');
    expect(live && quiz && overdue && later).toBeTruthy();
    if (!live || !quiz || !overdue || !later) return;
    const judged = validateJudgement(
      JSON.stringify({ order: [live.id, quiz.id, later.id, overdue.id] }),
      set,
      now,
    );
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    const plan = assembleAgentPlan(set, judged.value, now);
    expect(plan?.map((row) => row.card.courseName)).toEqual([
      '微積分甲',
      '普通物理實驗',
      '資料結構',
      '國文（臺灣文學）',
    ]);
    expect(plan?.[1].reasonText).toContain('10/19');
    expect(plan?.[1].reasonText).toContain('15:00');
    expect(orderedSenseCards(set, judged.value)[0].title).toBe('課堂點名');
    expect(orderedSenseCards(set, judged.value)[0].why).toContain('進行中的點名時段');
  });
});

describe('同意與是否出現下載', () => {
  it('沒有 WebGPU 或不到兩張卡就不出現下載', () => {
    expect(canOfferOnDeviceAgent(undefined, 4)).toBe(false);
    expect(canOfferOnDeviceAgent({}, 1)).toBe(false);
    expect(canOfferOnDeviceAgent({}, 2)).toBe(true);
  });

  it('同意狀態只接受 accepted／refused', () => {
    expect(parseAgentConsent(null)).toBe('unset');
    expect(parseAgentConsent('{')).toBe('unset');
    expect(parseAgentConsent(serializeAgentConsent('refused'))).toBe('refused');
    expect(parseAgentConsent(serializeAgentConsent('accepted'))).toBe('accepted');
  });

  it('同意畫面一次講完下載事實', () => {
    expect(AGENT_DOWNLOAD_FACTS).toBe(
      '約 2.8 GB、會占這台裝置空間、建議用 Wi-Fi、只排先後不改課名與時間',
    );
    expect(AGENT_DOWNLOAD_NOTE).toContain(AGENT_DOWNLOAD_FACTS);
    expect(AGENT_DOWNLOAD_NOTE).toContain('下載中可取消');
    expect(AGENT_DOWNLOAD_NOTE).toContain('下載後可刪除');
    expect(AGENT_DOWNLOAD_NOTE).toContain('沒同意就用規則版');
    expect(formatAgentDownloadProgress(10.4)).toBe('下載中 10%');
  });

  it('找出本機已同意下載的模型鍵', () => {
    const memory: Record<string, string> = {
      'campus.scope.todaySenseAgent.u:alice.s:default': serializeAgentConsent('accepted'),
      'campus.scope.todaySenseAgent.u:bob.s:default': serializeAgentConsent('refused'),
      unrelated: '1',
    };
    const storage = {
      get length() {
        return Object.keys(memory).length;
      },
      key(index: number) {
        return Object.keys(memory)[index] ?? null;
      },
      getItem(name: string) {
        return Object.prototype.hasOwnProperty.call(memory, name) ? memory[name] : null;
      },
    };
    expect(listAcceptedAgentConsentKeys(storage)).toEqual([
      'campus.scope.todaySenseAgent.u:alice.s:default',
    ]);
  });
});
