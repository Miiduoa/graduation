import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { studyTaskStatus, type NuniStudyAgenda } from '@campus/shared/src/nuniStudyAgenda';
import { formatTaipeiDateTime, parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { useTheme } from '../../state/theme';
import { parseAssignmentDeadlineWindow } from '../../services/assignmentDeadlineWindow';
import {
  isAssignmentDeadlineQuestion,
  queryAssignmentDeadlines,
} from '../../services/queryAssignmentDeadlines';
import {
  isNuniReceiptQuestion, isNuniReceiptReferenceQuestion, isNuniReceiptStatusFollowUp, queryNuniReceipts,
  type NuniReceiptDeadlineScope, type NuniReceiptRow, type NuniReceiptSource,
} from '../../services/nuniReceiptQuery';
import {
  ASSIGNMENT_PAGE_SIZE,
  assignmentOrdinal,
  assignmentPageTarget,
  pageChoice,
} from '../../services/assignmentResultPage';

type Props = { data: NuniStudyAgenda; open(courseId: string, activityId: string): void };
type DeadlineSearch = { question: string; filter: string; at: number };

type ResultRow = Pick<NuniReceiptRow, 'item' | 'due'> | NuniReceiptRow;

function rowDetail(row: ResultRow): string {
  if (!('receiptStatus' in row)) {
    return Number.isFinite(row.due)
      ? '參考期限 ' + formatTaipeiDateTime(row.due, { seconds: false })
      : '未設定參考期限';
  }
  const status = {
    feedback: '已載入繳交紀錄 · 有老師回饋',
    submitted: '已載入繳交紀錄',
    closed: '已停止收件 · 本次未見繳交紀錄',
    pending: '本次未見繳交紀錄 · 請到原頁核對',
  }[row.receiptStatus];
  return row.submittedAt
    ? status + ' · 繳交時間 ' + formatTaipeiDateTime(row.submittedAt, { seconds: false })
    : status;
}

export function StudyAssignmentAssistant({ data, open }: Props) {
  const theme = useTheme();
  const [openedFor, setOpenedFor] = useState<NuniStudyAgenda | null>(null);
  const expanded = openedFor === data;
  return (
    <View style={{ gap: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? '收起作業助理' : '問作業助理'}
        accessibilityState={{ expanded }}
        onPress={() => setOpenedFor(expanded ? null : data)}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Text style={{ color: expanded ? theme.colors.text : theme.colors.accent, fontWeight: '600', fontSize: expanded ? 20 : 16 }}>
          {expanded ? '作業助理' : '問作業助理'}
        </Text>
        {expanded && <Text style={{ color: theme.colors.accent, fontSize: 14 }}>收起</Text>}
      </Pressable>
      {expanded && <AssignmentQuestions data={data} open={open} />}
    </View>
  );
}

function AssignmentQuestions({ data, open }: Props) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState<DeadlineSearch | null>(null);
  const [receiptQuestion, setReceiptQuestion] = useState<{
    question: string; scope: string; deadlineScope?: NuniReceiptDeadlineScope;
    source?: NuniReceiptSource;
    returnTo?: { search: DeadlineSearch; offset: number; selected: number | null };
  } | null>(null);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const items = useMemo(() => {
    const courses = new Map(
      data.workspaces
        .filter((course) => course.state === 'active' && course.memberRole === 'student')
        .map((course) => [course.id, course.title]),
    );
    return data.tasks
      .filter(
        (task) =>
          courses.has(task.courseId) &&
          task.kind === 'assignment' &&
          studyTaskStatus(task) === 'pending',
      )
      .map((task) => {
        // Nuni also accepts school-local clock times without an explicit offset.
        const due = task.dueAt ? parseTaipeiInstant(task.dueAt) : null;
        return {
          courseId: task.courseId,
          id: task.id,
          title: task.title,
          groupName: courses.get(task.courseId)!,
          dueAt: due === null ? null : new Date(due).toISOString(),
        };
      });
  }, [data]);
  const answer = useMemo(
    () =>
      search ? queryAssignmentDeadlines(items, search.question, search.at, search.filter) : null,
    [items, search],
  );
  const receipts = useMemo(
    () => receiptQuestion ? queryNuniReceipts(data, receiptQuestion.question, receiptQuestion.scope,
      receiptQuestion.deadlineScope, receiptQuestion.source) : null,
    [data, receiptQuestion],
  );
  const fullRows = useMemo(
    () => receipts?.kind === 'results' ? receipts.rows : answer?.kind === 'results' ? answer.rows : [],
    [receipts, answer],
  );
  const rows = useMemo(
    () => fullRows.slice(offset, offset + ASSIGNMENT_PAGE_SIZE),
    [fullRows, offset],
  );
  const shown = useMemo(
    () => (selected === null ? rows : rows.slice(selected, selected + 1)),
    [rows, selected],
  );
  const activeRows = useRef<typeof shown | null>(null);
  useLayoutEffect(() => {
    activeRows.current = shown;
    return () => {
      activeRows.current = null;
    };
  }, [shown]);

  function page(move: NonNullable<ReturnType<typeof pageChoice>>) {
    if (!fullRows.length) {
      setNotice('請先查詢有結果的作業清單。');
      return;
    }
    const target = assignmentPageTarget(move, offset, fullRows.length);
    if ('message' in target) {
      setNotice(target.message);
      return;
    }
    setNotice('');
    setSelected(null);
    setOffset(target.offset);
  }

  function ask(value: string, tappedSource?: NuniReceiptSource) {
    const question = value.trim();
    if (!question) return;
    const move = pageChoice(question);
    if (move !== null) {
      page(move);
      return;
    }
    const ordinal = assignmentOrdinal(question);
    if (ordinal !== null) {
      if (ordinal < 1 || ordinal > rows.length) {
        setNotice(
          rows.length ? '請選本頁第 1 至 ' + rows.length + ' 筆。' : '請先查詢有結果的作業清單。',
        );
      } else {
        setNotice('');
        setSelected(ordinal - 1);
      }
      return;
    }
    if (isNuniReceiptQuestion(question)) {
      // Only a deliberate tap or ordinal can establish a source for “這份作業”.
      const reference = isNuniReceiptReferenceQuestion(question);
      const chosen = reference
        ? tappedSource ?? (selected === null ? receiptQuestion?.source : rows[selected]?.item)
        : undefined;
      const statusOnly = isNuniReceiptStatusFollowUp(question);
      const fromDeadline = Boolean(statusOnly && !receiptQuestion && search);
      if (fromDeadline && (answer?.kind !== 'results' || answer.status)) {
        setNotice('上個作業查詢尚未確定日期或只查特定期限狀態；請指定課程和作業名稱後再查繳交紀錄。');
        return;
      }
      const previousReceipt = statusOnly ? receiptQuestion : null;
      const inheritedDeadline = fromDeadline && search && answer?.kind === 'results' && answer.window
        ? { window: answer.window, checkedAt: search.at } : undefined;
      setReceiptQuestion({
        question,
        scope: previousReceipt?.scope ??
          (fromDeadline && search && answer?.kind === 'results' ? search.filter : question),
        deadlineScope: previousReceipt?.deadlineScope ?? inheritedDeadline,
        source: previousReceipt?.source ?? (chosen ? { courseId: chosen.courseId, id: chosen.id } : undefined),
        returnTo: (chosen || fromDeadline) && search ? { search, offset, selected }
          : previousReceipt?.returnTo ?? (chosen ? receiptQuestion?.returnTo : undefined),
      });
      setSearch(null);
      setNotice('');
      setSelected(null);
      setOffset(0);
      return;
    }
    setReceiptQuestion(null);
    const at = Date.now();
    const period = question
      .normalize('NFKC')
      .replace(/\s+/g, '')
      .replace(/[?!。！？，,、]+$/u, '')
      .replace(/^(?:那麼?|改看|改查)/u, '')
      .replace(/(?:的呢|呢|的)$/u, '');
    const window = search ? parseAssignmentDeadlineWindow(period, at) : null;
    const dateOnly = window && window !== 'clarify' && window.label === period;
    if (!dateOnly && !isAssignmentDeadlineQuestion(question)) {
      setSearch(null);
      setNotice('這裡可以查待交作業與參考期限。要繳交作業，請先查到該份作業，再點進作業頁。');
      return;
    }
    const filter =
      dateOnly && search
        ? answer?.kind === 'clarify'
          ? answer.filterQuestion
          : search.filter
        : question;
    setNotice('');
    setSelected(null);
    setOffset(0);
    setSearch({ question: dateOnly ? period + '有哪些作業？' : question, filter, at });
  }

  function submitDraft() {
    ask(draft);
    setDraft('');
  }

  let summary = `符合 ${fullRows.length} 筆 · 顯示第 ${offset + 1}–${offset + rows.length} 筆`;
  if (!fullRows.length) {
    summary = receipts ? '已載入的課程紀錄中沒有符合的作業，請到原課程核對。'
      : '已載入的待交作業中沒有符合條件的項目。';
  } else if (selected !== null) {
    summary = '已選本頁第 ' + (selected + 1) + ' 筆';
  } else if (receiptQuestion?.source && fullRows.length === 1) {
    summary = '這份作業的繳交紀錄';
  }

  const text = { color: theme.colors.text, fontSize: 15, lineHeight: 22 };
  const button = (label: string, action: () => void, disabled = false, accessibilityLabel = label) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={action}
      style={({ pressed }) => ({
        minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center',
        alignSelf: 'flex-start', borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.accentSoft : theme.colors.surface,
      })}
    >
      <Text style={{ ...text, color: disabled ? theme.colors.muted : theme.colors.accent }}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ ...text, color: theme.colors.muted }}>查詢已載入的作業期限與繳交紀錄</Text>
      {data.failedCourseIds.length || data.limitedCourseIds.length ? (
        <Text style={{ ...text, color: theme.colors.warning }}>
          部分課程未完整載入，結果只包含這次取得的作業。
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput
          accessibilityLabel="輸入作業問題"
          placeholder="例如：資料庫有哪些作業？"
          value={draft}
          onChangeText={setDraft}
          maxLength={240}
          returnKeyType="search"
          onSubmitEditing={submitDraft}
          placeholderTextColor={theme.colors.muted}
          style={{
            ...text, flex: 1, minWidth: 0, minHeight: 46, padding: 10,
            borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10,
          }}
        />
        {button('查詢', submitDraft, !draft.trim(), '查詢作業')}
      </View>
      {!search && !receiptQuestion && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {['有哪些待交作業？', '明天有哪些作業？', '我已繳交的作業有哪些？'].map((q) => button(q, () => ask(q)))}
        </View>
      )}
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={text}>
          {notice}
        </Text>
      ) : null}
      {answer?.kind === 'clarify' && (
        <Text accessibilityLiveRegion="polite" style={text}>
          想查哪一天或哪一週？可以回覆「明天」或「下週五」。
        </Text>
      )}
      {receipts?.kind === 'clarify' && (
        <Text accessibilityLiveRegion="polite" style={text}>{receipts.message}</Text>
      )}
      {receiptQuestion?.returnTo && button('返回作業結果', () => {
        const previous = receiptQuestion.returnTo;
        if (!previous || activeRows.current !== shown) return;
        setReceiptQuestion(null);
        setSearch(previous.search);
        setOffset(previous.offset);
        setSelected(previous.selected);
        setNotice('');
      })}
      {(answer?.kind === 'results' || receipts?.kind === 'results') && (
        <>
          <Text accessibilityLiveRegion="polite" style={{ ...text, fontWeight: '600' }}>
            {summary}
          </Text>
          {answer?.kind === 'results' && answer.window && answer.undated > 0 && (
            <Text style={text}>另有 {answer.undated} 筆未設定參考期限，無法依日期判斷。</Text>
          )}
          {answer?.kind === 'results' && !answer.status && selected === null && (
            <View style={{ gap: 2 }}>
              <Text style={{ ...text, fontSize: 13, color: theme.colors.muted }}>
                {['同範圍的繳交紀錄', answer.scope, answer.window?.label].filter(Boolean).join(' · ')}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {button('已繳交', () => {
                  if (activeRows.current === shown) ask('那已交的呢？');
                }, false, '查同範圍已繳交作業')}
                {button('未見紀錄', () => {
                  if (activeRows.current === shown) ask('那還沒交的呢？');
                }, false, '查同範圍未見紀錄作業')}
              </View>
            </View>
          )}
          {receipts?.kind === 'results' && receiptQuestion?.deadlineScope && (
            <Text style={text}>
              延續上一個查詢的「{receiptQuestion.deadlineScope.window.label}」截止範圍（台灣時間）。
            </Text>
          )}
          {shown.map((row, index) => {
            const { courseId, id, groupName, title } = row.item;
            const name = groupName + ' · ' + title;
            const detail = rowDetail(row);
            return (
              <View key={JSON.stringify([courseId, id])} style={{
                borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface, overflow: 'hidden',
              }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={'查看作業：' + name}
                  accessibilityValue={{ text: detail }}
                  onPress={() => {
                    if (activeRows.current === shown) open(courseId, id);
                  }}
                  style={({ pressed }) => ({
                    padding: 12, gap: 3,
                    backgroundColor: pressed ? theme.colors.accentSoft : theme.colors.surface,
                  })}
                >
                  <Text style={{ ...text, fontSize: 13, color: theme.colors.muted }}>
                    本頁第 {(selected ?? index) + 1} 筆 · {groupName}
                  </Text>
                  <Text style={{ ...text, fontSize: 17, fontWeight: '600' }}>{title}</Text>
                  <Text style={text}>{detail}</Text>
                  <Text style={{ ...text, color: theme.colors.accent }}>開啟作業頁 ›</Text>
                </Pressable>
                {search && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={'查繳交紀錄：' + name}
                    onPress={() => {
                      if (activeRows.current === shown) ask('這份作業交了嗎？', { courseId, id });
                    }}
                    style={({ pressed }) => ({
                      minHeight: 44, justifyContent: 'center', paddingHorizontal: 12,
                      borderTopWidth: 1, borderColor: theme.colors.border,
                      backgroundColor: pressed ? theme.colors.accentSoft : theme.colors.bg,
                    })}
                  >
                    <Text style={{ ...text, color: theme.colors.accent, fontWeight: '600' }}>
                      查繳交紀錄
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })}
          {receipts?.kind === 'results' && (
            <Text style={{ ...text, color: theme.colors.muted, fontSize: 13 }}>
              來源：本次載入的 nuni 課程繳交紀錄。未見紀錄不代表校方 LMS 已確認未交。
            </Text>
          )}
          {selected !== null &&
            button('返回清單', () => {
              setSelected(null);
              setNotice('');
            })}
          {selected === null && fullRows.length > ASSIGNMENT_PAGE_SIZE && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {button('上一頁作業', () => page('previous'), offset === 0)}
              {button('下一頁作業', () => page('next'), offset + rows.length >= fullRows.length)}
            </View>
          )}
        </>
      )}
    </View>
  );
}
