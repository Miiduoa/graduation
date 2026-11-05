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
  type NuniReceiptDeadlineScope, type NuniReceiptSource,
} from '../../services/nuniReceiptQuery';
import {
  ASSIGNMENT_PAGE_SIZE,
  assignmentOrdinal,
  assignmentPageTarget,
  pageChoice,
} from '../../services/assignmentResultPage';

type Props = { data: NuniStudyAgenda; open(courseId: string, activityId: string): void };

export function StudyAssignmentAssistant({ data, open }: Props) {
  const theme = useTheme();
  const [openedFor, setOpenedFor] = useState<NuniStudyAgenda | null>(null);
  const expanded = openedFor === data;
  return (
    <View style={{ gap: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="問作業助理"
        accessibilityState={{ expanded }}
        onPress={() => setOpenedFor(expanded ? null : data)}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={{ color: theme.colors.accent, fontWeight: '600', fontSize: 16 }}>
          {expanded ? '收起作業助理' : '問作業助理'}
        </Text>
      </Pressable>
      {expanded && <AssignmentQuestions data={data} open={open} />}
    </View>
  );
}

function AssignmentQuestions({ data, open }: Props) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState<{ question: string; filter: string; at: number } | null>(
    null,
  );
  const [receiptQuestion, setReceiptQuestion] = useState<{
    question: string; scope: string; deadlineScope?: NuniReceiptDeadlineScope;
    source?: NuniReceiptSource;
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
          rows.length ? '請選本頁第 1 至 ' + rows.length + ' 筆。' : '請先查詢有結果的作業清單。',
        );
      } else {
        setNotice('');
        setSelected(ordinal - 1);
      }
      return;
    }
    if (isNuniReceiptQuestion(question)) {
      // Only an explicit ordinal selection resolves "這份作業". A single
      // displayed result is not permission to guess the user's referent.
      const chosen = isNuniReceiptReferenceQuestion(question) && selected !== null
        ? rows[selected]?.item : undefined;
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

  const text = { color: theme.colors.text, fontSize: 15, lineHeight: 22 };
  const button = (label: string, action: () => void, disabled = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
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
      <Text style={text}>可查已載入的待交作業、參考期限及繳交紀錄，並指定課名或作業名稱。</Text>
      {data.failedCourseIds.length || data.limitedCourseIds.length ? (
        <Text style={{ ...text, color: theme.colors.warning }}>
          部分課程未完整載入，結果只包含這次取得的作業。
        </Text>
      ) : null}
      <TextInput
        accessibilityLabel="輸入作業問題"
        placeholder="例如：資料庫的作業什麼時候交？"
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
        {button('查詢作業', () => ask(draft), !draft.trim())}
        {!search && !receiptQuestion && ['有哪些待交作業？', '明天有哪些作業？', '我已繳交的作業有哪些？'].map((q) => button(q, () => ask(q)))}
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
      {receipts?.kind === 'clarify' && (
        <Text accessibilityLiveRegion="polite" style={text}>{receipts.message}</Text>
      )}
      {(answer?.kind === 'results' || receipts?.kind === 'results') && (
        <>
          <Text accessibilityLiveRegion="polite" style={{ ...text, fontWeight: '600' }}>
            {selected !== null
              ? '已選本頁第 ' + (selected + 1) + ' 筆'
              : fullRows.length
                ? `符合 ${fullRows.length} 筆 · 顯示第 ${offset + 1}–${offset + rows.length} 筆`
                : receipts ? '已載入的課程紀錄中沒有符合的作業，請到原課程核對。'
                  : '已載入的待交作業中沒有符合條件的項目。'}
          </Text>
          {answer?.kind === 'results' && answer.window && answer.undated > 0 && (
            <Text style={text}>另有 {answer.undated} 筆未設定參考期限，無法依日期判斷。</Text>
          )}
          {receipts?.kind === 'results' && (
            <Text style={text}>來源：本次載入的 nuni 課程繳交紀錄。未見紀錄不代表校方 LMS 已確認未交；請到原作業頁核對。</Text>
          )}
          {receipts?.kind === 'results' && receiptQuestion?.deadlineScope && (
            <Text style={text}>
              延續上一個查詢的「{receiptQuestion.deadlineScope.window.label}」截止範圍（台灣時間）。
            </Text>
          )}
          {shown.map((row, index) => (
            <Pressable
              key={JSON.stringify([row.item.courseId, row.item.id])}
              accessibilityRole="button"
              accessibilityLabel={'查看作業：' + row.item.groupName + ' · ' + row.item.title}
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
              {'receiptStatus' in row && 'submittedAt' in row ? (
                <Text style={text}>
                  {row.receiptStatus === 'feedback'
                    ? '已載入繳交紀錄 · 有老師回饋'
                    : row.receiptStatus === 'submitted'
                      ? '已載入繳交紀錄'
                      : row.receiptStatus === 'closed'
                        ? '已停止收件 · 本次未見繳交紀錄'
                        : '本次未見繳交紀錄 · 請到原頁核對'}
                  {typeof row.submittedAt === 'string' && row.submittedAt ? ' · 繳交時間 ' + formatTaipeiDateTime(row.submittedAt, { seconds: false }) : ''}
                </Text>
              ) : (
                <Text style={text}>
                  {Number.isFinite(row.due)
                    ? '參考期限 ' + formatTaipeiDateTime(row.due, { seconds: false })
                    : '未設定參考期限'}
                </Text>
              )}
            </Pressable>
          ))}
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
