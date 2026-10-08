'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { adminError, parseBoard, parseBoards, parseSchools } from './api';
import { useAdminMutation, useAdminResource } from './hooks';
import styles from './Admin.module.css';

export function AdminBoards({ context, suspended }: { context: string; suspended: boolean }) {
  const boards = useAdminResource('boards', context, parseBoards, !suspended);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const schools = useAdminResource(
    `schools${search ? `?q=${encodeURIComponent(search)}` : ''}`,
    context,
    parseSchools,
    !suspended,
  );
  const eligible =
    schools.value?.filter(
      (school) =>
        school.tenantId && (school.lifecycle === 'open' || school.lifecycle === 'provisioned'),
    ) ?? [];
  const [tenantId, setTenantId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [notice, setNotice] = useState('');
  const [responseError, setResponseError] = useState('');
  const mutation = useAdminMutation(context, !suspended && !schools.loading && !schools.error);
  async function create() {
    if (!eligible.some((school) => school.tenantId === tenantId) || name.trim().length < 2) return;
    setNotice('');
    setResponseError('');
    const result = await mutation.run('boards', {
      tenantId,
      name: name.trim(),
      description: description.trim(),
    });
    if (result === undefined) return;
    try {
      const board = parseBoard(result);
      if (
        board.tenantId !== tenantId ||
        board.joinPolicy !== 'open' ||
        board.postingPolicy !== 'members'
      )
        throw new Error('Unexpected board response');
      setNotice(`已建立「${board.name}」，可供跨校公開交流。`);
      setName('');
      setDescription('');
      boards.reload();
    } catch (failure) {
      setResponseError(adminError(failure));
    }
  }
  return (
    <div className={styles.stack}>
      <section className={styles.panel}>
        <div className={styles.stack}>
          <div className={styles.toolbar}>
            <h2>公開看板</h2>
            <Button onClick={boards.reload} disabled={boards.loading}>
              重新讀取看板
            </Button>
          </div>
          <p className={styles.muted}>
            公開看板可供不同學校的使用者瀏覽與交流，不會開放校務資料或授予學校身分。
          </p>
          {boards.loading && <p role="status">正在讀取公開看板…</p>}
          {boards.error && (
            <p role="alert" className={styles.error}>
              {boards.error}
            </p>
          )}
          {boards.value?.length === 0 && (
            <p className={styles.muted}>目前沒有公開看板。建立後，使用者即可選擇看板發文。</p>
          )}
          {!!boards.value?.length && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">看板</th>
                    <th scope="col">所屬校園</th>
                    <th scope="col">發文方式</th>
                  </tr>
                </thead>
                <tbody>
                  {boards.value.map((board) => (
                    <tr key={`${board.tenantId}:${board.id}`}>
                      <td>
                        {board.name}
                        {board.description && <small>{board.description}</small>}
                      </td>
                      <td>{board.tenantName}</td>
                      <td>
                        {board.postingPolicy === 'moderators'
                          ? '限管理員發文'
                          : board.joinPolicy === 'open'
                            ? '加入後可發文'
                            : board.joinPolicy === 'request'
                              ? '申請加入後可發文'
                              : '受邀加入後可發文'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      <section className={styles.panel}>
        <div className={styles.stack}>
          <h2>建立公開看板</h2>
          <p className={styles.notice}>
            看板內容跨校公開可見，採自由加入、成員發文。請勿放入成績、請假或其他校務個資。
          </p>
          <form
            className={styles.search}
            onSubmit={(event) => {
              event.preventDefault();
              setTenantId('');
              setSearch(query.trim());
              schools.reload();
            }}
          >
            <Input
              label="尋找看板所屬學校"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={80}
              placeholder="學校名稱或代號"
              disabled={mutation.busy}
            />
            <Button type="submit" disabled={schools.loading || mutation.busy}>
              搜尋學校
            </Button>
          </form>
          {schools.loading && <p role="status">正在讀取可用學校…</p>}
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
              目前沒有可選擇的學校，請搜尋學校名稱。已關閉或尚未建檔的學校不能建立公開看板。
            </p>
          )}
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <fieldset
              disabled={
                suspended ||
                mutation.busy ||
                schools.loading ||
                !!schools.error ||
                eligible.length === 0
              }
            >
              <Select
                label="看板所屬學校"
                required
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                options={[
                  { value: '', label: '請選擇學校', disabled: true },
                  ...eligible.map((school) => ({
                    value: school.tenantId!,
                    label: school.displayName,
                  })),
                ]}
              />
              <Input
                label="看板名稱"
                required
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <Textarea
                label="看板說明"
                maxLength={400}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
              <Button
                type="submit"
                variant="primary"
                disabled={!tenantId || name.trim().length < 2}
              >
                建立公開看板
              </Button>
            </fieldset>
            {mutation.error || responseError ? (
              <p role="alert" className={styles.error}>
                {mutation.error || responseError}
              </p>
            ) : null}
            {notice && (
              <p role="status" className={styles.success}>
                {notice}
              </p>
            )}
          </form>
        </div>
      </section>
    </div>
  );
}
