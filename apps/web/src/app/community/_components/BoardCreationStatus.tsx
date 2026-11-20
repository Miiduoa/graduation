import type { useBoardCreationAccess } from './useBoardCreationAccess';

export function BoardCreationStatus({ access }: { access: ReturnType<typeof useBoardCreationAccess> }) {
  if (access.status === 'loading') return <p role="status">正在確認看板管理權限…</p>;
  if (access.status !== 'error') return null;
  return (
    <div role="alert">
      <p>目前無法確認看板管理權限，仍可查看已開放的看板。</p>
      <button type="button" className="btn" onClick={access.retry}>重新確認權限</button>
    </div>
  );
}
