import React, { useEffect, useRef, useState } from 'react';
import { Button, Image, ScrollView, Text, View } from 'react-native';
import { useTheme } from '../../state/theme';
import { formatAssignmentFileSize, moveAssignmentFile } from '@campus/shared/src/assignmentFiles';
import { pickAssignmentAlbum, type LocalNativeFile } from './assignmentFileSubmit';
import { buildNativePhotoPdf, type NativePhotoPage } from './nativePhotoPdf';

type Proof = Awaited<ReturnType<typeof buildNativePhotoPdf>>;

export function NativePhotoPdfEditor({
  onConfirm,
  onCancel,
}: {
  onConfirm: (file: LocalNativeFile) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const textStyle = { color: theme.colors.text, lineHeight: 23 };
  const [pages, setPages] = useState<NativePhotoPage[]>([]);
  const [proof, setProof] = useState<Proof | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(true);
  const current = useRef<Proof | null>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      current.current?.dispose();
    };
  }, []);
  function edit(next: NativePhotoPage[]) {
    current.current?.dispose();
    current.current = null;
    setProof(null);
    setPages(next);
    setError('');
  }
  return (
    <View
      accessibilityLabel="照片轉 PDF"
      style={{
        gap: 12,
        padding: 16,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        borderRadius: 12,
      }}
    >
      <Text style={textStyle}>把這次作業裝成一本</Text>
      <Text style={textStyle}>選 1–8 張照片，由上往下就是頁序。先轉正、排好，再看一次。</Text>
      <Button title="取消製作" onPress={onCancel} />
      <Button
        title="選照片"
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            const files = await pickAssignmentAlbum([]);
            if (!live.current) return;
            if (files.length + pages.length > 8) {
              setError('一本最多 8 頁，請減少照片後再選。');
              return;
            }
            edit([...pages, ...files.map((file) => ({ file, rotation: 0 }))]);
          } catch {
            if (live.current) setError('無法開啟相簿，請檢查照片權限後再試。');
          } finally {
            if (live.current) setBusy(false);
          }
        }}
      />
      <ScrollView style={{ maxHeight: 420 }} nestedScrollEnabled>
        {pages.map((page, index) => (
          <View key={`${page.file.key}:${index}`} style={{ gap: 8, marginBottom: 20 }}>
            <Text style={textStyle}>第 {index + 1} 頁</Text>
            <Image
              source={{ uri: page.file.uri }}
              accessibilityLabel={`第 ${index + 1} 頁`}
              resizeMode="contain"
              style={{ width: '100%', height: 220, transform: [{ rotate: `${page.rotation}deg` }] }}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <Button
                title="上移"
                disabled={busy || index === 0}
                onPress={() => edit(moveAssignmentFile(pages, index, -1))}
              />
              <Button
                title="下移"
                disabled={busy || index === pages.length - 1}
                onPress={() => edit(moveAssignmentFile(pages, index, 1))}
              />
              <Button
                title="向右轉 90°"
                disabled={busy}
                onPress={() =>
                  edit(
                    pages.map((p, i) =>
                      i === index ? { ...p, rotation: (p.rotation + 90) % 360 } : p,
                    ),
                  )
                }
              />
              <Button
                title="刪頁"
                disabled={busy}
                onPress={() => edit(pages.filter((_, i) => i !== index))}
              />
            </View>
          </View>
        ))}
      </ScrollView>
      {error ? (
        <Text style={textStyle} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button
        title={busy ? '正在裝訂…' : '預覽 PDF 頁面'}
        disabled={busy || !pages.length}
        onPress={async () => {
          setBusy(true);
          setError('');
          try {
            const next = await buildNativePhotoPdf(pages);
            if (!live.current) {
              next.dispose();
              return;
            }
            current.current?.dispose();
            current.current = next;
            setProof(next);
          } catch {
            if (live.current)
              setError(
                '無法製作 PDF，可能照片無法讀取或成品超過 20 MiB。請刪減照片再試，不會自動降低畫質。',
              );
          } finally {
            if (live.current) setBusy(false);
          }
        }}
      />
      {proof ? (
        <View style={{ gap: 12 }}>
          <Text style={textStyle}>
            {pages.length} 頁 · {formatAssignmentFileSize(proof.file.byteSize)}。以下是 PDF
            內的完整頁面，請確認文字與方向。
          </Text>
          <ScrollView style={{ maxHeight: 520 }} nestedScrollEnabled>
            {proof.previews.map((uri, index) => (
              <View key={uri}>
                <Text style={textStyle}>第 {index + 1} 頁</Text>
                <Image
                  source={{ uri }}
                  accessibilityLabel={`PDF 第 ${index + 1} 頁`}
                  resizeMode="contain"
                  style={{ width: '100%', height: 440 }}
                />
              </View>
            ))}
          </ScrollView>
          <Button
            title="確認，加入待繳附件"
            onPress={() => {
              proof.dispose(true);
              current.current = null;
              onConfirm(proof.file);
            }}
          />
          <Text style={textStyle}>加入後，還要按作業的送出按鈕才會繳交。</Text>
        </View>
      ) : null}
    </View>
  );
}
