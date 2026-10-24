'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import {
  confirmActorNoLongerOwner,
  createGroupOwnershipOrigin,
  isGroupOwnershipOriginCurrent,
  loadEligibleOwnershipMembers,
  transferGroupOwnership,
  transferGroupOwnershipErrorMessage,
  type GroupOwnershipOrigin,
  type OwnershipTransferMember,
} from './groupOwnershipService';
import styles from './groups.module.css';

type Props = {
  uid: string;
  schoolId: string;
  groupId: string;
  groupName: string;
  disabled?: boolean;
  onTransferred?: (actorNewRole: string) => void;
};

type Phase =
  | { kind: 'closed' }
  | { kind: 'pick' }
  | { kind: 'confirm'; member: OwnershipTransferMember; origin: GroupOwnershipOrigin }
  | { kind: 'busy'; member: OwnershipTransferMember; origin: GroupOwnershipOrigin }
  | {
      kind: 'error';
      member: OwnershipTransferMember;
      origin: GroupOwnershipOrigin;
      message: string;
    }
  | { kind: 'done'; member: OwnershipTransferMember; actorNewRole: string };

export function GroupOwnershipTransfer({
  uid,
  schoolId,
  groupId,
  groupName,
  disabled = false,
  onTransferred,
}: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'closed' });
  const [members, setMembers] = useState<OwnershipTransferMember[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const identityRef = useRef({ uid, schoolId, groupId });

  useEffect(() => {
    identityRef.current = { uid, schoolId, groupId };
    generation.current += 1;
    // Robust to prop changes even without a parent key remount.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional scope fence reset
    setPhase({ kind: 'closed' });
    setMembers([]);
    setCursor(null);
    setHasMore(false);
    setListError(null);
    setLoadingMembers(false);
  }, [uid, schoolId, groupId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  const live = useCallback(
    () => ({
      generation: generation.current,
      uid: identityRef.current.uid,
      schoolId: identityRef.current.schoolId,
      groupId: identityRef.current.groupId,
    }),
    [],
  );

  const current = useCallback(
    (originGeneration?: number) =>
      mounted.current &&
      (originGeneration == null || originGeneration === generation.current),
    [],
  );

  const loadPage = useCallback(
    async (reset: boolean) => {
      const requestGeneration = generation.current;
      setLoadingMembers(true);
      setListError(null);
      try {
        const page = await loadEligibleOwnershipMembers(uid, schoolId, groupId, {
          current: () => current(requestGeneration),
          cursor: reset ? null : cursor,
          excludeUid: uid,
        });
        if (!current(requestGeneration)) return;
        setMembers((previous) => (reset ? page.members : [...previous, ...page.members]));
        setCursor(page.cursor);
        setHasMore(page.hasMore);
      } catch (error) {
        if (current(requestGeneration)) {
          setListError(transferGroupOwnershipErrorMessage(error));
        }
      } finally {
        if (current(requestGeneration)) setLoadingMembers(false);
      }
    },
    [uid, schoolId, groupId, cursor, current],
  );

  function openPicker() {
    if (disabled) return;
    setPhase({ kind: 'pick' });
    setMembers([]);
    setCursor(null);
    setHasMore(false);
    void loadPage(true);
  }

  function chooseMember(member: OwnershipTransferMember) {
    if (disabled || phase.kind === 'busy') return;
    const origin = createGroupOwnershipOrigin({
      generation: generation.current,
      uid,
      schoolId,
      groupId,
      targetUid: member.uid,
    });
    setPhase({ kind: 'confirm', member, origin });
  }

  async function runTransfer(origin: GroupOwnershipOrigin, member: OwnershipTransferMember) {
    if (!isGroupOwnershipOriginCurrent(origin, live()) || !mounted.current) return;
    setPhase({ kind: 'busy', member, origin });
    try {
      const result = await transferGroupOwnership(
        uid,
        {
          groupId: origin.groupId,
          targetUid: origin.targetUid,
          operationId: origin.operationId,
          expectedCurrentOwnerUid: origin.uid,
        },
        () => isGroupOwnershipOriginCurrent(origin, live()) && mounted.current,
      );
      if (!isGroupOwnershipOriginCurrent(origin, live()) || !mounted.current) return;
      const actorNewRole = await confirmActorNoLongerOwner(
        uid,
        schoolId,
        groupId,
        () => isGroupOwnershipOriginCurrent(origin, live()) && mounted.current,
      );
      if (!isGroupOwnershipOriginCurrent(origin, live()) || !mounted.current) return;
      setPhase({
        kind: 'done',
        member,
        actorNewRole: result.actorNewRole || actorNewRole,
      });
      onTransferred?.(result.actorNewRole || actorNewRole);
    } catch (error) {
      if (!isGroupOwnershipOriginCurrent(origin, live()) || !mounted.current) return;
      setPhase({
        kind: 'error',
        member,
        origin,
        message: transferGroupOwnershipErrorMessage(error),
      });
    }
  }

  if (phase.kind === 'closed') {
    return (
      <button className="btn" type="button" disabled={disabled} onClick={openPicker}>
        轉讓擁有權
      </button>
    );
  }

  if (phase.kind === 'done') {
    return (
      <div className={styles.confirm} role="status">
        <p>
          已將「{groupName}」的擁有權轉給「{phase.member.displayName}」。你的角色現在是「
          {phase.actorNewRole === 'member' ? '一般成員' : phase.actorNewRole}」，之後可以退出此群組。
        </p>
        <button className="btn" type="button" onClick={() => setPhase({ kind: 'closed' })}>
          關閉
        </button>
      </div>
    );
  }

  return (
    <div className={styles.ownershipPanel}>
      <h3>轉讓擁有權</h3>
      <p>
        選擇一位仍有效的成員接收「{groupName}」的擁有權。轉讓後對方會成為唯一擁有者；你會改為一般成員。
      </p>
      {phase.kind === 'confirm' || phase.kind === 'busy' || phase.kind === 'error' ? (
        <div className={styles.confirm}>
          <p>
            確定將擁有權轉給「{phase.member.displayName}」？成功後你會改為一般成員，才能退出此群組。
          </p>
          {phase.kind === 'error' && (
            <p role="alert" className={styles.notice}>
              {phase.message}
            </p>
          )}
          <button
            className="btn primary"
            type="button"
            disabled={phase.kind === 'busy' || disabled}
            onClick={() => void runTransfer(phase.origin, phase.member)}
          >
            {phase.kind === 'busy'
              ? '正在轉讓…'
              : phase.kind === 'error'
                ? '用同一操作重試'
                : '確認轉讓'}
          </button>
          <button
            className="btn"
            type="button"
            disabled={phase.kind === 'busy'}
            onClick={() => setPhase({ kind: 'pick' })}
          >
            返回名單
          </button>
        </div>
      ) : (
        <>
          {listError && (
            <p role="alert" className={styles.notice}>
              {listError}
            </p>
          )}
          {loadingMembers && members.length === 0 ? (
            <p className={styles.status} role="status">
              正在載入可接收的成員…
            </p>
          ) : members.length === 0 ? (
            <p className={styles.status}>目前沒有其他符合資格的成員可接收擁有權。</p>
          ) : (
            <ul className={styles.ownershipList}>
              {members.map((member) => (
                <li key={member.uid}>
                  <button
                    className="btn"
                    type="button"
                    disabled={disabled}
                    onClick={() => chooseMember(member)}
                  >
                    {member.displayName}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hasMore && (
            <button
              className="btn"
              type="button"
              disabled={loadingMembers || disabled}
              onClick={() => void loadPage(false)}
            >
              {loadingMembers ? '載入中…' : '載入更多成員'}
            </button>
          )}
          <button className="btn" type="button" onClick={() => setPhase({ kind: 'closed' })}>
            取消
          </button>
        </>
      )}
    </div>
  );
}
