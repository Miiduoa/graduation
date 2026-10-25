'use client';

import { useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { parseSchools } from './api';
import { useAdminResource } from './hooks';
import {
  createPeopleParser,
  parseOversightPeople,
  tenantStateLabel,
  type OversightPeople,
} from './oversightApi';
import styles from './Admin.module.css';

const eligibleLifecycles = new Set(['provisioned', 'open', 'suspended']);

export function AdminPeople({
  context,
  suspended,
  selectedSchool,
  onSchool,
}: {
  context: string;
  suspended: boolean;
  selectedSchool: string | null;
  onSchool: (id: string | null) => void;
}) {
  const schools = useAdminResource('schools', context, parseSchools, !suspended);
  const eligible = useMemo(
    () =>
      (schools.value ?? []).filter(
        (school) => school.tenantId && eligibleLifecycles.has(school.lifecycle),
      ),
    [schools.value],
  );
  const selectedEligible = eligible.some((school) => school.tenantId === selectedSchool);
  const tenantId = selectedEligible ? selectedSchool : null;
  const parsePeople = useMemo(
    () => (tenantId ? createPeopleParser(tenantId) : parseOversightPeople),
    [tenantId],
  );
  const peoplePath = tenantId ? `people?tenantId=${encodeURIComponent(tenantId)}` : null;
  const people = useAdminResource(peoplePath, context, parsePeople, !suspended && !!tenantId);

  return (
    <div className={styles.stack}>
      <section className={styles.panel} aria-labelledby="people-oversight-heading">
        <div className={styles.stack}>
          <div className={styles.toolbar}>
            <div>
              <h2 id="people-oversight-heading">學校管理授權總覽</h2>
              <p className={styles.muted}>
                查看各校管理員、職員與已核發授權。日常校務由校方與承辦人處理，平台可跨校查核並介入處理權限問題。
              </p>
            </div>
            <Button
              disabled={schools.loading || (!!tenantId && people.loading)}
              onClick={() => {
                schools.reload();
                if (tenantId) people.reload();
              }}
            >
              重新讀取
            </Button>
          </div>

          <p className={styles.notice}>
            選擇學校後，查看該校負責人與授權名單；業務承辦與授課資格依校方另外指派。
          </p>

          {schools.loading && <p role="status">正在讀取學校列表…</p>}
          {schools.error && (
            <div className={styles.stack}>
              <p role="alert" className={styles.error}>
                {schools.error}
              </p>
              <Button onClick={schools.reload}>重新讀取學校</Button>
            </div>
          )}
          {!schools.loading && !schools.error && eligible.length === 0 && (
            <p className={styles.muted}>
              本次載入沒有可監督的已建檔學校。申請中或已拒絕的學校不會出現在此清單。
            </p>
          )}

          {!!eligible.length && (
            <div className={styles.filterRow}>
              <Select
                label="選擇學校"
                value={tenantId ?? ''}
                onChange={(event) => onSchool(event.target.value || null)}
                options={[
                  { value: '', label: '請選擇學校' },
                  ...eligible.map((school) => ({
                    value: school.tenantId!,
                    label: school.displayName,
                  })),
                ]}
              />
            </div>
          )}

          {!tenantId && !schools.loading && !schools.error && !!eligible.length && (
            <p className={styles.muted}>選定學校後，才會顯示該校的管理授權與缺管理員提醒。</p>
          )}

          {tenantId && people.loading && <p role="status">正在讀取學校管理授權…</p>}
          {tenantId && people.error && (
            <div className={styles.stack}>
              <p role="alert" className={styles.error}>
                {people.error}
              </p>
              <Button onClick={people.reload}>重新讀取授權名單</Button>
            </div>
          )}

          {tenantId && people.value && !people.error && <PeopleDetail data={people.value} />}
        </div>
      </section>
    </div>
  );
}

function PeopleDetail({ data }: { data: OversightPeople }) {
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <div>
          <h3>{data.displayName}</h3>
          <p className={styles.muted}>
            <span className={styles.badge}>{tenantStateLabel(data.tenantState)}</span>
            {' · '}
            已核發 {data.people.length} 位校方管理／職員授權。
          </p>
        </div>
        <a className={styles.link} href="/admin/ops">
          調整校方授權
        </a>
      </div>

      {data.hasRoleAdmin ? (
        <div className={styles.notice}>
          <p>
            負責管理員：
            {data.roleAdmins.map((admin) => admin.displayName).join('、')}
          </p>
        </div>
      ) : (
        <p role="status" className={styles.error}>
          這所學校目前沒有作用中的學校管理員。請到完整管理台指派後再開放日常校務操作。
        </p>
      )}

      <p className={styles.muted}>{data.honesty}</p>

      {data.people.length === 0 ? (
        <p className={styles.muted}>這所學校尚未登錄任何管理員或職員授權。</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">姓名</th>
                <th scope="col">角色</th>
                <th scope="col">狀態</th>
                <th scope="col">聯絡</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((person) => (
                <tr key={person.personId}>
                  <td>{person.displayName}</td>
                  <td>{person.roleLabel}</td>
                  <td>
                    <span className={styles.badge}>{person.stateLabel}</span>
                  </td>
                  <td>{person.email || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
