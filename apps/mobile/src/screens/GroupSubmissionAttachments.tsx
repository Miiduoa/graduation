import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { listGroupSubmissionFiles } from '../services/groupSubmissionFiles';
import { PrivateAttachment } from '../ui/PrivateAttachment';

export function GroupSubmissionAttachments({
  groupId,
  assignmentId,
}: {
  groupId: string;
  assignmentId: string;
}) {
  const [rows, setRows] = useState<{ uid: string; paths: string[] }[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function load() {
    setBusy(true);
    setNotice('');
    try {
      const next = await listGroupSubmissionFiles(groupId, assignmentId);
      if (!active.current) return;
      setRows(next);
      if (!next.some((row) => row.paths.length)) setNotice('尚無繳交附件');
    } catch {
      if (active.current) setNotice('暫時無法讀取附件，請確認授課權限後重試。');
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <View>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void load()}>
        <Text>{busy ? '讀取中…' : '查看學生繳交附件'}</Text>
      </Pressable>
      {notice ? <Text>{notice}</Text> : null}
      {rows
        .filter((row) => row.paths.length)
        .map((row) => (
          <View key={row.uid}>
            <Text>{row.uid}</Text>
            {row.paths.map((path) => (
              <PrivateAttachment key={path} path={path} />
            ))}
          </View>
        ))}
    </View>
  );
}
