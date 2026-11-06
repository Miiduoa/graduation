import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { studyTaskStatus, type NuniStudyAgenda } from '@campus/shared/src/nuniStudyAgenda';
import { formatTaipeiDateTime, parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { useTheme } from '../../state/theme';
import {
  isNuniQuizQuestion, isNuniQuizStatusFollowUp, isNuniQuizReferenceQuestion, isNuniQuizDateFollowUp, queryNuniQuizzes,
  type NuniQuizContext, type NuniQuizRow,
} from '../../services/nuniQuizAssistant';
import { parseAssignmentDeadlineWindow } from '../../services/assignmentDeadlineWindow';
import {
  isAssignmentDeadlineQuestion,
  queryAssignmentDeadlines,
} from '../../services/queryAssignmentDeadlines';
import {
  isNuniReceiptQuestion, isNuniReceiptStatusFollowUp, queryNuniReceipts,
  type NuniReceiptDeadlineScope, type NuniReceiptRow,
} from '../../services/nuniReceiptQuery';
import {
  ASSIGNMENT_PAGE_SIZE,
  assignmentOrdinal,
  assignmentPageTarget,
  pageChoice,
} from '../../services/assignmentResultPage';

type Props = { data: NuniStudyAgenda; open(courseId: string, activityId: string): void };

type DeadlineSearch = { question: string; filter: string; at: number };
type Lookup =
  | { kind: 'assignment'; search: DeadlineSearch }
  | { kind: 'receipt'; search: { question: string; scope: string; deadlineScope?: NuniReceiptDeadlineScope } }
  | { kind: 'quiz'; question: string; at: number; context?: NuniQuizContext; source?: { courseId: string; id: string } };

type ResultRow = Pick<NuniReceiptRow, 'item' | 'due'> | NuniReceiptRow | NuniQuizRow;

function rowDetails(row: ResultRow): string[] {
  if ('state' in row) {
    const receipt = row.submittedAt
      ? '已作答 · ' + formatTaipeiDateTime(row.submittedAt, { seconds: false })
      : (row.state === 'closed' ? '已結束' : '開放作答') + ' · 未見作答紀錄';
    const due = Number.isFinite(row.due)
      ? '參考期限 ' + formatTaipeiDateTime(row.due, { seconds: false }) : '未設定參考期限';
    return [receipt, due];
  }
  if (!('receiptStatus' in row)) {
    return [Number.isFinite(row.due)
      ? '參考期限 ' + formatTaipeiDateTime(row.due, { seconds: false })
      : '未設定參考期限'];
  }
  const status = {
    feedback: '已載入繳交紀錄 · 有老師回饋',
    submitted: '已載入繳交紀錄',
    closed: '已停止收件 · 本次未見繳交紀錄',
    pending: '本次未見繳交紀錄 · 請到原頁核對',
  }[row.receiptStatus];
  return [row.submittedAt
    ? status + ' · 繳交時間 ' + formatTaipeiDateTime(row.submittedAt, { seconds: false })
    : status];
}

export function StudyAssignmentAssistant({ data, open }: Props) {
  const theme = useTheme();
  const [openedFor, setOpenedFor] = useState<NuniStudyAgenda | null>(null);
  const expanded = openedFor === data;
  return (
    <View style={{ gap: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? '收起課業助理' : '問課業助理'}
        accessibilityState={{ expanded }}
        onPress={() => setOpenedFor(expanded ? null : data)}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={{ color: theme.colors.accent, fontWeight: '600', fontSize: 16 }}>
          {expanded ? '收起課業助理' : '問課業助理'}
        </Text>
      </Pressable>
      {expanded && <AssignmentQuestions data={data} open={open} />}
    </View>
  );
}

function AssignmentQuestions({ data, open }: Props) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const search = lookup?.kind === 'assignment' ? lookup.search : null;
  const receiptQuestion = lookup?.kind === 'receipt' ? lookup.search : null;
  const quiz = lookup?.kind === 'quiz' ? lookup : null;
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
      receiptQuestion.deadlineScope) : null,
    [data, receiptQuestion],
  );
  const quizzes = useMemo(() => quiz
    ? queryNuniQuizzes(data, quiz.question, quiz.at, quiz.source, quiz.context) : null, [data, quiz]);
  const result = quizzes ?? receipts ?? answer;
  const fullRows = useMemo<ResultRow[]>(() => result?.kind === 'results' ? result.rows : [], [result]);

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
      setNotice('請先查詢有結果的清單。');
      return;
    }
    const target = assignmentPageTarget(move, offset, fullRows.length, quiz ? '測驗' : '作業');
    if ('message' in target) {
      setNotice(target.message);
      return;
    }
    setNotice('');
    setSelected(null);
    setOffset(target.offset);
  }

  function ask(value: string) {
    const question = value.trim();
    if (!question) return;
    const move = pageChoice(question);
    setDraft('');
    if (move !== null) {
      page(move);
      return;
    }
    const ordinal = assignmentOrdinal(question);
    if (ordinal !== null) {
      if (ordinal < 1 || ordinal > rows.length) {
        setNotice(
          rows.length ? '請選本頁第 1 至 ' + rows.length + ' 筆。' : '請先查詢有結果的清單。',
        );
      } else {
        setNotice('');
        setSelected(ordinal - 1);
      }
      return;
    }
    const at = Date.now();
    const referenceQuiz = isNuniQuizReferenceQuestion(question);
    const quizFollowUp = quiz && (isNuniQuizStatusFollowUp(question) || referenceQuiz || isNuniQuizDateFollowUp(question, at));
    if (isNuniQuizQuestion(question) || quizFollowUp) {
      const previous = quizFollowUp ? quizzes?.context : undefined;
      const source = referenceQuiz && quiz ? (selected === null ? quiz.source : rows[selected]?.item) : undefined;
      setLookup({ kind: 'quiz', question, at, context: previous,
        source: source ? { courseId: source.courseId, id: source.id } : undefined });
      setSelected(null);
      setOffset(0);
      setNotice('');
      return;
    }
    if (isNuniReceiptQuestion(question)) {
      const statusOnly = isNuniReceiptStatusFollowUp(question);
      const fromDeadline = Boolean(statusOnly && !receiptQuestion && search);
      if (fromDeadline && (answer?.kind !== 'results' || answer.status)) {
        setNotice('上個作業查詢尚未確定日期或只查特定期限狀態；請指定課程和作業名稱後再查繳交紀錄。');
        return;
      }
      const previousReceipt = statusOnly ? receiptQuestion : null;
      const inheritedDeadline = fromDeadline && search && answer?.kind === 'results' && answer.window
        ? { window: answer.window, checkedAt: search.at } : undefined;
      setLookup({ kind: 'receipt', search: {
        question,
        scope: previousReceipt?.scope ??
          (fromDeadline && search && answer?.kind === 'results' ? search.filter : question),
        deadlineScope: previousReceipt?.deadlineScope ?? inheritedDeadline,
      } });
      setNotice('');
      setSelected(null);
      setOffset(0);
      return;
    }
    const period = question
      .normalize('NFKC')
      .replace(/\s+/g, '')
      .replace(/[?!。！？，,、]+$/u, '')
      .replace(/^(?:那麼?|改看|改查)/u, '')
      .replace(/(?:的呢|呢|的)$/u, '');
    const window = search ? parseAssignmentDeadlineWindow(period, at) : null;
    const dateOnly = window && window !== 'clarify' && window.label === period;
    if (!dateOnly && !isAssignmentDeadlineQuestion(question)) {
      setLookup(null);
      setNotice('可查作業、測驗與個人紀錄。要繳交或作答，請從結果開啟原課程頁。');
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
    setLookup({ kind: 'assignment', search: { question: dateOnly ? period + '有哪些作業？' : question, filter, at } });
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
      style={{ minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' }}
    >
      <Text style={{ ...text, color: disabled ? theme.colors.muted : theme.colors.accent }}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 8 }}>
      <Text style={text}>可查已載入的作業與測驗、參考期限和個人紀錄。</Text>
      {data.failedCourseIds.length || data.limitedCourseIds.length ? (
        <Text style={{ ...text, color: theme.colors.warning }}>
          部分課程未完整載入，結果只包含這次取得的項目。
        </Text>
      ) : null}
      <TextInput
        accessibilityLabel="輸入課業問題"
        placeholder="例如：資料庫明天有哪些測驗？"
        value={draft}
        onChangeText={setDraft}
        maxLength={240}
        returnKeyType="search"
        onSubmitEditing={() => ask(draft)}
        placeholderTextColor={theme.colors.muted}
        style={{
          ...text,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 8,
          minHeight: 46,
          padding: 10,
        }}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {button('查詢課業', () => ask(draft), !draft.trim())}
        {!lookup && ['有哪些待交作業？', '明天有哪些作業？', '明天有哪些測驗？', '我已繳交的作業有哪些？'].map((q) => button(q, () => ask(q)))}
      </View>
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
      {result?.kind === 'clarify' && 'message' in result && (
        <Text accessibilityLiveRegion="polite" style={text}>{result.message}</Text>
      )}
      {result?.kind === 'results' && (
        <>
          <Text accessibilityLiveRegion="polite" style={{ ...text, fontWeight: '600' }}>
            {selected !== null
              ? '已選本頁第 ' + (selected + 1) + ' 筆'
              : fullRows.length
                ? `符合 ${fullRows.length} 筆 · 顯示第 ${offset + 1}–${offset + rows.length} 筆`
                : quiz ? '已載入的課程中沒有符合條件的測驗。'
                : receipts ? '已載入的課程紀錄中沒有符合的作業，請到原課程核對。'
                  : '已載入的待交作業中沒有符合條件的項目。'}
          </Text>
          {answer?.kind === 'results' && answer.window && answer.undated > 0 && (
            <Text style={text}>另有 {answer.undated} 筆未設定參考期限，無法依日期判斷。</Text>
          )}
          {quizzes?.kind === 'results' && (
            <Text style={{ ...text, color: theme.colors.muted, fontSize: 13 }}>
              日期依線上測驗的參考期限篩選，開考時間請到課程公告核對。
            </Text>
          )}
          {quizzes?.kind === 'results' && quizzes.undatedOutsideWindow > 0 && (
            <Text style={text}>另有 {quizzes.undatedOutsideWindow} 筆無可核對的參考期限，無法依日期判斷。</Text>
          )}
          {quizzes?.kind === 'results' && !quiz?.source && selected === null && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {button('已作答', () => ask('那已作答的呢？'), false, '查同範圍已作答測驗')}
              {button('未見作答紀錄', () => ask('那未作答的呢？'), false, '查同範圍未見作答紀錄的測驗')}
            </View>
          )}
          {receipts?.kind === 'results' && (
            <Text style={text}>來源：本次載入的 nuni 課程繳交紀錄。未見紀錄不代表校方 LMS 已確認未交；請到原作業頁核對。</Text>
          )}
          {receipts?.kind === 'results' && receiptQuestion?.deadlineScope && (
            <Text style={text}>
              延續上一個查詢的「{receiptQuestion.deadlineScope.window.label}」截止範圍（台灣時間）。
            </Text>
          )}
          {shown.map((row, index) => {
            const details = rowDetails(row);
            return (
              <Pressable
                key={JSON.stringify([row.item.courseId, row.item.id])}
                accessibilityRole="button"
                accessibilityLabel={(quiz ? '查看測驗：' : '查看作業：') + row.item.groupName + ' · ' + row.item.title}
                accessibilityValue={{ text: details.join('，') }}
                onPress={() => {
                  if (activeRows.current === shown) open(row.item.courseId, row.item.id);
                }}
                style={{
                  borderTopWidth: 1,
                  borderColor: theme.colors.border,
                  paddingVertical: 10,
                  gap: 2,
                }}
              >
                <Text style={{ ...text, color: theme.colors.muted }}>
                  本頁第 {(selected ?? index) + 1} 筆 · {row.item.groupName}
                </Text>
                <Text style={{ ...text, color: theme.colors.accent, fontWeight: '600' }}>
                  {row.item.title}
                </Text>
                {details.map((line) => <Text key={line} style={text}>{line}</Text>)}
              </Pressable>
            );
          })}
          {selected !== null &&
            button('返回清單', () => {
              setSelected(null);
              setNotice('');
            })}
          {selected === null && fullRows.length > ASSIGNMENT_PAGE_SIZE && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {button(quiz ? '上一頁測驗' : '上一頁作業', () => page('previous'), offset === 0)}
              {button(quiz ? '下一頁測驗' : '下一頁作業', () => page('next'), offset + rows.length >= fullRows.length)}
            </View>
          )}
        </>
      )}
    </View>
  );
}
