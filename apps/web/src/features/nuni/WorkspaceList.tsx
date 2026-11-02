'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NuniError, nuniErrorMessage, type NuniWorkspace } from '@campus/shared/src/nuni';
import { CampusIcon } from '@/components/CampusIcon';
import { MutationForm, useClasses } from './CourseUI';
import { useNuniSession } from './Session';
import { courseRoleLabels } from './courseTasks';
import { CourseMaterialSearch } from './CourseMaterialSearch';
import { StudyAgenda } from './StudyAgenda';
import {
  classroomCourseHref,
  classroomDirectoryHref,
  courseDirectoryFilter,
  courseSearchKey,
  replaceStudyQuery,
  studyAgendaFilter,
  type CourseDirectoryFilter,
  type StudyAgendaFilter,
} from './studyNavigation';
import shared from './NuniApp.module.css';
import styles from './StudyWorkspace.module.css';

const directoryFilters: [CourseDirectoryFilter, string][] = [
  ['all', '進行中'],
  ['studying', '我修的課'],
  ['teaching', '我教的課'],
  ['archived', '已封存'],
];

function inDirectory(course: NuniWorkspace, filter: CourseDirectoryFilter) {
  if (filter === 'archived') return course.state === 'archived';
  if (course.state !== 'active') return false;
  return (
    filter === 'all' ||
    (filter === 'studying' ? course.memberRole === 'student' : course.memberRole !== 'student')
  );
}

export function WorkspaceList() {
  const classes = useClasses();
  const { refresh: refreshSession } = useNuniSession();
  const router = useRouter();
  const params = useSearchParams();
  const api = useRef(classes);
  const sessionRefresh = useRef(refreshSession);
  const active = useRef(false);
  const [items, setItems] = useState<NuniWorkspace[] | null>(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const [action, setAction] = useState<'join' | 'create' | null>(null);
  const [query, setQuery] = useState(() => (params.get('q') ?? '').slice(0, 120));
  const [filter, setFilter] = useState(() => courseDirectoryFilter(params.get('courses')));
  const [taskFilter, setTaskFilter] = useState(() => studyAgendaFilter(params.get('task')));
  const queryFromUrl = params.get('q') ?? '';
  const filterFromUrl = params.get('courses');
  const taskFromUrl = params.get('task');

  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    api.current = classes;
    sessionRefresh.current = refreshSession;
  });
  useEffect(() => {
    setQuery(queryFromUrl.slice(0, 120));
    setFilter(courseDirectoryFilter(filterFromUrl));
    setTaskFilter(studyAgendaFilter(taskFromUrl));
  }, [queryFromUrl, filterFromUrl, taskFromUrl]);
  useEffect(() => {
    let active = true;
    setError('');
    setReading(true);
    void api.current
      .list()
      .then((result) => {
        if (active) setItems(result);
      })
      .catch((failure: unknown) => {
        if (!active) return;
        setError(nuniErrorMessage(failure));
        if (
          failure instanceof NuniError &&
          ([401, 403, 404].includes(failure.status) || failure.code === 'SESSION_CHANGED')
        )
          setItems(null);
        if (
          failure instanceof NuniError &&
          (failure.status === 401 || failure.code === 'SESSION_CHANGED')
        )
          void sessionRefresh.current();
      })
      .finally(() => {
        if (active) setReading(false);
      });
    return () => {
      active = false;
    };
  }, [epoch]);

  const contextParams = new URLSearchParams(params.toString());
  if (query) contextParams.set('q', query);
  else contextParams.delete('q');
  if (filter !== 'all') contextParams.set('courses', filter);
  else contextParams.delete('courses');
  if (taskFilter !== 'pending') contextParams.set('task', taskFilter);
  else contextParams.delete('task');
  const context = contextParams.toString();
  const open = (workspace: NuniWorkspace) => {
    if (active.current) router.push(classroomCourseHref(workspace.id, context));
  };
  const membershipKey = (items ?? [])
    .map((item) => `${item.id}:${item.memberRole}:${item.state}:${item.title}`)
    .sort()
    .join('|');
  const normalizedQuery = courseSearchKey(query);
  const shown = (items ?? []).filter(
    (item) =>
      inDirectory(item, filter) &&
      (!normalizedQuery || courseSearchKey(item.title).includes(normalizedQuery)),
  );
  const changeFilter = (value: CourseDirectoryFilter) => {
    setFilter(value);
    replaceStudyQuery('courses', value, 'all');
  };
  const changeQuery = (value: string) => {
    setQuery(value);
    replaceStudyQuery('q', value);
  };
  const changeTaskFilter = (value: StudyAgendaFilter) => {
    setTaskFilter(value);
    replaceStudyQuery('task', value, 'pending');
  };
  const resetDirectory = () => {
    changeQuery('');
    changeFilter('all');
  };

  return (
    <div className={styles.workspace}>
      <header className={styles.pageHeading}>
        <div>
          <p className={styles.kicker}>Campus One · 課程空間</p>
          <h1>我的課程</h1>
          <p>先處理待辦，再回到每門課的教材與學習紀錄。</p>
        </div>
        <div className={shared.actions}>
          <Link href="/grades?tab=feedback" className={styles.quietLink}>
            <CampusIcon name="calendar" size={18} />
            課業成績與回饋
          </Link>
          <button
            type="button"
            className={`${shared.button} ${shared.secondary}`}
            disabled={reading}
            onClick={() => setEpoch((value) => value + 1)}
          >
            {reading ? '更新中…' : '更新課程'}
          </button>
        </div>
      </header>
      {error && (
        <div className={shared.notice} role="alert">
          {error}
          {items ? ' 已保留目前的課程清單，請稍後重試。' : ''}
          <button
            type="button"
            className={styles.textButton}
            disabled={reading}
            onClick={() => setEpoch((value) => value + 1)}
          >
            重試課程
          </button>
        </div>
      )}
      {!items && reading && (
        <div className={styles.loading} role="status">
          正在讀取課程…
        </div>
      )}
      <div className={styles.homeGrid}>
        <div className={styles.mainColumn}>
          {items && (
            <StudyAgenda
              workspaces={items}
              filter={taskFilter}
              onFilter={changeTaskFilter}
              context={context}
            />
          )}
          <section className={styles.directory} aria-labelledby="course-directory-title">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.kicker}>課程列表</p>
                <h2 id="course-directory-title">繼續學習</h2>
              </div>
              {items && (
                <span className={styles.resultCount}>
                  {items.filter((item) => item.state === 'active').length} 門進行中
                </span>
              )}
            </div>
            {items && items.length > 0 && (
              <>
                <div className={styles.directoryToolbar}>
                  <label className={styles.searchBox}>
                    <CampusIcon name="search" size={18} />
                    <span className={styles.srOnly}>搜尋課程名稱</span>
                    <input
                      type="search"
                      value={query}
                      maxLength={120}
                      placeholder="搜尋課程名稱"
                      autoComplete="off"
                      onChange={(event) => changeQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          changeQuery('');
                        }
                      }}
                    />
                  </label>
                  {query && (
                    <button
                      type="button"
                      className={styles.textButton}
                      onClick={() => changeQuery('')}
                    >
                      清除搜尋
                    </button>
                  )}
                </div>
                <div className={styles.segmented} role="group" aria-label="篩選課程">
                  {directoryFilters.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={filter === value}
                      onClick={() => changeFilter(value)}
                    >
                      {label}
                      <span>{items.filter((item) => inDirectory(item, value)).length}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {items && items.length === 0 ? (
              <div className={styles.empty}>
                <CampusIcon name="course" size={30} />
                <h3>先加入你的第一門課</h3>
                <p>向老師取得邀請碼，加入後就能在這裡查看教材、處理作業與確認回饋。</p>
                <button
                  type="button"
                  className={shared.button}
                  onClick={() => {
                    setAction('join');
                    document.getElementById('course-entry')?.scrollIntoView({ block: 'nearest' });
                  }}
                >
                  輸入邀請碼
                </button>
              </div>
            ) : items && !shown.length ? (
              <div className={styles.empty} role="status">
                <CampusIcon name="search" size={26} />
                <h3>{query ? `找不到「${query}」` : '這個分類目前沒有課程'}</h3>
                <p>
                  {query
                    ? '換個課程關鍵字，或清除篩選再找一次。'
                    : filter === 'archived'
                      ? '課程封存後，原有教材和繳交紀錄會整理在這裡。'
                      : '可以切換其他分類，或使用老師提供的邀請碼加入課程。'}
                </p>
                {(query || filter !== 'all') && (
                  <button type="button" className={styles.textButton} onClick={resetDirectory}>
                    查看所有進行中課程
                  </button>
                )}
              </div>
            ) : items ? (
              <>
                <p className={styles.directoryStatus} role="status">
                  {query
                    ? `「${query}」找到 ${shown.length} 門課程`
                    : `${directoryFilters.find(([value]) => value === filter)?.[1]} · ${shown.length} 門`}
                </p>
                <ul className={styles.courseGrid}>
                  {shown.map((item) => (
                    <li key={item.id}>
                      <Link
                        className={styles.courseCard}
                        href={classroomCourseHref(item.id, context)}
                      >
                        <span className={styles.courseIdentity}>
                          <CampusIcon
                            name={item.memberRole === 'student' ? 'library' : 'people'}
                            size={21}
                          />
                          <span>
                            {item.state === 'archived'
                              ? '已封存'
                              : courseRoleLabels[item.memberRole]}
                          </span>
                        </span>
                        <h3>{item.title}</h3>
                        <span className={styles.courseFooter}>
                          {item.state === 'archived'
                            ? '查看教材與紀錄'
                            : item.memberRole === 'student'
                              ? '教材、作業與簽到'
                              : '教材、作業與點名'}
                          <CampusIcon name="arrow" size={18} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        </div>
        <aside className={styles.sidebar} aria-label="教材搜尋與課程操作">
          <section className={styles.sidePanel}>
            <div className={styles.sideTitle}>
              <CampusIcon name="library" size={20} />
              <h2>此裝置收藏</h2>
            </div>
            <p>收藏過的教材放在這裡，方便下次接著看。只保留在此瀏覽器的目前帳號。</p>
            <Link className={`${shared.button} ${shared.secondary}`} href={classroomDirectoryHref(context, 'bookmarks')}>
              查看收藏的教材
            </Link>
          </section>
          {items && items.length > 0 && (
            <section className={styles.sidePanel}>
              <div className={styles.sideTitle}>
                <CampusIcon name="search" size={20} />
                <h2>找教材</h2>
              </div>
              <p>從已加入的課程搜尋教材名稱、內容與章節。</p>
              <CourseMaterialSearch key={membershipKey} compact context={context} />
            </section>
          )}
          <section className={styles.sidePanel} id="course-entry">
            <div className={styles.sideTitle}>
              <CampusIcon name="course" size={21} />
              <h2>加入新的課程</h2>
            </div>
            <p>有老師的邀請碼嗎？加入後，作業和教材會出現在你的課程列表。</p>
            <div className={styles.entryActions} role="group" aria-label="選擇課程操作">
              <button
                className={`${shared.button} ${action === 'create' ? shared.secondary : ''}`}
                type="button"
                aria-expanded={action === 'join'}
                aria-controls="join-course-form"
                onClick={() => setAction(action === 'join' ? null : 'join')}
              >
                加入課程
              </button>
              <button
                className={`${shared.button} ${shared.secondary}`}
                type="button"
                aria-expanded={action === 'create'}
                aria-controls="create-course-form"
                onClick={() => setAction(action === 'create' ? null : 'create')}
              >
                我要開課
              </button>
            </div>
            <div id="join-course-form" hidden={action !== 'join'} className={shared.nextForm}>
              <MutationForm
                label="確認加入"
                submit={async (data, key) =>
                  open(
                    await classes.join(
                      String(data.get('code'))
                        .trim()
                        .toUpperCase()
                        .replace(/[\s-]+/g, ''),
                      key,
                    ),
                  )
                }
              >
                <label>
                  邀請碼
                  <input
                    name="code"
                    required
                    minLength={6}
                    maxLength={24}
                    autoCapitalize="characters"
                    autoComplete="off"
                    placeholder="輸入老師提供的代碼"
                  />
                </label>
              </MutationForm>
            </div>
            <div id="create-course-form" hidden={action !== 'create'} className={shared.nextForm}>
              <p className={styles.scopeNote}>你將成為這門課的負責老師，可以發布教材並邀請學生。</p>
              <MutationForm
                label="確認建立課程"
                submit={async (data, key) =>
                  open(await classes.create(String(data.get('title')), key))
                }
              >
                <label>
                  課程名稱
                  <input
                    name="title"
                    required
                    minLength={2}
                    maxLength={120}
                    placeholder="例如：設計專題"
                  />
                </label>
              </MutationForm>
            </div>
          </section>
          <p className={styles.scopeNote}>
            這裡是你在 Campus One
            加入的課程，與瀏覽中的學校分開管理；校方正式課程與成績仍以學校系統為準。
          </p>
        </aside>
      </div>
    </div>
  );
}
