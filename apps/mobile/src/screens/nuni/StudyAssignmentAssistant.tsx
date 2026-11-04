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
  const rows = useMemo(
    () =>
      answer?.kind === 'results' ? answer.rows.slice(offset, offset + ASSIGNMENT_PAGE_SIZE) : [],
    [answer, offset],
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
    if (answer?.kind !== 'results' || !answer.rows.length) {
      setNotice('請先查詢有結果的作業清單。');
      return;
    }
    const target = assignmentPageTarget(move, offset, answer.rows.length);
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
      <Text style={text}>查詢所有修習課程已載入的待交作業，可指定課名、作業名稱或台灣日期。</Text>
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
        {!search && ['有哪些待交作業？', '明天有哪些作業？'].map((q) => button(q, () => ask(q)))}
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
      {answer?.kind === 'results' && (
        <>
          <Text accessibilityLiveRegion="polite" style={{ ...text, fontWeight: '600' }}>
            {selected !== null
              ? '已選本頁第 ' + (selected + 1) + ' 筆'
              : answer.rows.length
                ? `符合 ${answer.rows.length} 筆 · 顯示第 ${offset + 1}–${offset + rows.length} 筆`
                : '已載入的待交作業中沒有符合條件的項目。'}
          </Text>
          {answer.window && answer.undated > 0 && (
            <Text style={text}>另有 {answer.undated} 筆未設定參考期限，無法依日期判斷。</Text>
          )}
          {shown.map(({ item, due }, index) => (
            <Pressable
              key={JSON.stringify([item.courseId, item.id])}
              accessibilityRole="button"
              accessibilityLabel={'查看作業：' + item.groupName + ' · ' + item.title}
              onPress={() => {
                if (activeRows.current === shown) open(item.courseId, item.id);
              }}
              style={{
                borderTopWidth: 1,
                borderColor: theme.colors.border,
                paddingVertical: 10,
                gap: 2,
              }}
            >
              <Text style={{ ...text, color: theme.colors.muted }}>
                本頁第 {(selected ?? index) + 1} 筆 · {item.groupName}
              </Text>
              <Text style={{ ...text, color: theme.colors.accent, fontWeight: '600' }}>
                {item.title}
              </Text>
              <Text style={text}>
                {Number.isFinite(due)
                  ? '參考期限 ' + formatTaipeiDateTime(due, { seconds: false })
                  : '未設定參考期限'}
              </Text>
            </Pressable>
          ))}
          {selected !== null &&
            button('返回清單', () => {
              setSelected(null);
              setNotice('');
            })}
          {selected === null && answer.rows.length > ASSIGNMENT_PAGE_SIZE && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {button('上一頁作業', () => page('previous'), offset === 0)}
              {button('下一頁作業', () => page('next'), offset + rows.length >= answer.rows.length)}
            </View>
          )}
        </>
      )}
    </View>
  );
}
