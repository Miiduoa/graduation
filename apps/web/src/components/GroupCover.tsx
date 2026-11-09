'use client';
import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { getDb } from '@/lib/firebase';
import { privateFilesEnabled, privateGroupCoverPath, uploadPrivateFile } from '@/lib/privateFiles';
import { PrivateImage } from './PrivateImage';

export function GroupCover({
  groupId,
  coverUrl,
  role,
}: {
  groupId: string;
  coverUrl?: string;
  role: string;
}) {
  const [saved, setSaved] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const path = saved || coverUrl;
  return (
    <div>
      {path && (
        <PrivateImage
          key={revision}
          src={path}
          width={640}
          height={240}
          alt="群組封面"
          style={{ objectFit: 'cover', maxWidth: '100%' }}
        />
      )}
      {privateFilesEnabled() && ['owner', 'admin', 'instructor', 'moderator'].includes(role) && (
        <label>
          更換群組封面
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file || busy) return;
              setBusy(true);
              setNotice('');
              try {
                const extension = file.type.split('/')[1]?.replace(/[^a-zA-Z0-9]/g, '') || 'jpg';
                const nextPath = privateGroupCoverPath(groupId, extension);
                if (!nextPath) throw new Error('封面路徑無效');
                const uploaded = await uploadPrivateFile({ path: nextPath, body: file, contentType: file.type });
                await updateDoc(doc(getDb(), 'groups', groupId), { coverUrl: uploaded.path });
                setSaved(uploaded.path);
                setRevision((value) => value + 1);
                setNotice('已更新群組封面');
              } catch {
                setNotice('封面更新失敗，請稍後再試。');
              } finally {
                setBusy(false);
                event.target.value = '';
              }
            }}
          />
        </label>
      )}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
