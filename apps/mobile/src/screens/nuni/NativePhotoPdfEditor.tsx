import React, { useEffect, useRef, useState } from 'react';
import { Button, Image, Modal, ScrollView, Text, View } from 'react-native';
import { useTheme } from '../../state/theme';
import { formatAssignmentFileSize, moveAssignmentFile } from '@campus/shared/src/assignmentFiles';
import { pickAssignmentAlbum, type LocalNativeFile } from './assignmentFileSubmit';
import {
  buildNativePhotoPdf,
  validateNativePhotoPages,
  type NativePhotoPage,
} from './nativePhotoPdf';

type Proof = Awaited<ReturnType<typeof buildNativePhotoPdf>>;

export function NativePhotoPdfEditor({
  onConfirm,
  onCancel,
}: {
  onConfirm: (file: LocalNativeFile) => void;
  onCancel: () => void;
}) {
  const [zoomPage, setZoomPage] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const theme = useTheme();
  const textStyle = { color: theme.colors.text, lineHeight: 23 };
  const conversion = useRef<AbortController | null>(null);
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
      conversion.current?.abort();
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
      <Text style={textStyle}>將照片合併成 PDF</Text>
      <Text style={textStyle}>
        選 1–8 張 JPEG 或 PNG 照片，每張最多 1200 萬像素、合計 3200
        萬像素。由上往下就是頁序。先轉正、排好，再看一次。
      </Text>
      <Button
        title="取消製作"
        onPress={() => {
          conversion.current?.abort();
          live.current = false;
          onCancel();
        }}
      />
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
            const next = [...pages, ...files.map((file) => ({ file, rotation: 0 }))];
            await validateNativePhotoPages(next);
            if (!live.current) return;
            edit(next);
          } catch {
            if (live.current)
              setError(
                '無法讀取照片，請確認為 JPEG／PNG，且每張不超過 1200 萬像素、合計不超過 3200 萬像素及每張 20 MiB。',
              );
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
        title={busy ? '正在製作 PDF…' : '預覽 PDF 頁面'}
        disabled={busy || !pages.length}
        onPress={async () => {
          setBusy(true);
          setError('');
          const controller = new AbortController();
          conversion.current = controller;
          try {
            const next = await buildNativePhotoPdf(pages, controller.signal);
            if (!live.current) {
              next.dispose();
              return;
            }
            current.current?.dispose();
            current.current = next;
            setProof(next);
          } catch (cause) {
            if (live.current)
              setError(
                cause instanceof Error
                  ? `${cause.message}（成品上限 20 MiB）`
                  : '無法製作 PDF，可能照片無法讀取或成品超過 20 MiB。請刪減照片再試，不會自動降低畫質。',
              );
          } finally {
            if (live.current) setBusy(false);
          }
        }}
      />
      <Modal visible={zoomPage !== null} onRequestClose={() => setZoomPage(null)}>
        <Button title="關閉放大預覽" onPress={() => setZoomPage(null)} />
        <Button title="放大" onPress={() => setZoom((value) => Math.min(4, value + 1))} />
        <Button title="縮小" onPress={() => setZoom((value) => Math.max(1, value - 1))} />
        <ScrollView horizontal>
          <ScrollView maximumZoomScale={4} minimumZoomScale={1}>
            {zoomPage ? (
              <Image
                accessibilityLabel="放大頁面"
                source={{ uri: zoomPage }}
                resizeMode="contain"
                style={{ width: 360 * zoom, height: 600 * zoom }}
              />
            ) : null}
          </ScrollView>
        </ScrollView>
      </Modal>
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
                <Button
                  title={`放大第 ${index + 1} 頁`}
                  onPress={() => {
                    setZoom(1);
                    setZoomPage(uri);
                  }}
                />
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
