import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Text, View } from 'react-native';
import { AIScreen, AIHero, AISection, AICard, AIRow, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import {
  pickPrintDocument,
  previewAndPrintDocument,
  sharePrintDocument,
  savePrintDocument,
  documentSizeLabel,
  isDocumentActionCancelled,
  DocumentOperationError,
  type PrintDocument,
} from '../features/printing/documents';

type Selection = { scope: string; document: PrintDocument };
type Action = 'pick' | 'print' | 'share';

export function PrintServiceScreen() {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const { user } = useAuth();
  const { school } = useSchool();
  const scope = JSON.stringify([user?.uid, school.id]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const generation = useRef(0);
  const mounted = useRef(true);
  const actionLock = useRef<symbol | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [operation, setOperation] = useState<{ scope: string; action: Action } | null>(null);
  const document = selection?.scope === scope ? selection.document : null;
  const busy = operation?.scope === scope ? operation.action : null;
  const isWeb = Platform.OS === 'web';

  useEffect(() => {
    mounted.current = true;
    actionLock.current = null;
    setSelection(null);
    setOperation(null);
    generation.current += 1;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [scope]);

  const run = useCallback(
    async (action: Action) => {
      if (actionLock.current || !mounted.current || currentScope.current !== scope) return;
      const token = Symbol(action);
      const request = generation.current;
      actionLock.current = token;
      setOperation({ scope, action });
      const isCurrent = () =>
        mounted.current && currentScope.current === scope && generation.current === request;
      try {
        if (action === 'pick') {
          const next = await pickPrintDocument();
          if (next && isCurrent()) setSelection({ scope, document: next });
        } else if (document) {
          if (action === 'print') await previewAndPrintDocument(document, isCurrent);
          else await sharePrintDocument(document, isCurrent);
        }
      } catch (error) {
        if (isCurrent() && !isDocumentActionCancelled(error)) {
          Alert.alert(
            action === 'pick'
              ? '無法選取文件'
              : action === 'print'
                ? '無法開啟列印'
                : '無法分享文件',
            error instanceof DocumentOperationError
              ? error.message
              : '請確認檔案仍可讀取，稍後再試。',
          );
        }
      } finally {
        if (actionLock.current === token) actionLock.current = null;
        if (isCurrent()) setOperation(null);
      }
    },
    [document, scope],
  );

  const remove = () => {
    if (busy) return;
    generation.current += 1;
    setSelection(null);
  };

  return (
    <AIScreen>
      <AIHero
        eyebrow="CAMPUS ONE"
        title="文件與列印"
        subtitle="選好文件，預覽後交給系統列印或分享。"
      />
      <AICard title={document ? '目前文件' : '選擇要處理的文件'}>
        <View style={{ gap: 14 }}>
          {document ? (
            <>
              <Text style={{ color: aiTokens.text, fontWeight: '600', fontSize: 18 }}>
                {document.name}
              </Text>
              <Text style={{ color: aiTokens.muted }}>
                {document.kind === 'pdf'
                  ? 'PDF 文件'
                  : document.kind === 'image'
                    ? '圖片'
                    : 'Word 文件'}{' '}
                · {documentSizeLabel(document.size)}
              </Text>
              {document.kind === 'image' ? (
                <Image
                  source={{ uri: document.uri }}
                  accessibilityLabel={`文件預覽：${document.name}`}
                  resizeMode="contain"
                  style={{
                    width: '100%',
                    height: 240,
                    backgroundColor: aiTokens.panel,
                    borderRadius: 12,
                  }}
                />
              ) : null}
            </>
          ) : (
            <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
              支援 PDF、PNG、JPEG 與 Word 文件，每個檔案上限 25 MB。
            </Text>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <AIButton
              label={busy === 'pick' ? '開啟檔案選擇器中' : document ? '更換文件' : '選擇文件'}
              disabled={Boolean(busy)}
              onPress={() => void run('pick')}
            />
            {document ? (
              <AIButton
                label="移除文件"
                variant="ghost"
                disabled={Boolean(busy)}
                onPress={remove}
              />
            ) : null}
          </View>
          {busy ? <ActivityIndicator accessibilityLabel="處理文件" color={aiTokens.ai} /> : null}
        </View>
      </AICard>
      {document ? (
        <AISection title="處理文件">
          <View style={{ padding: 16, gap: 12 }}>
            {document.kind === 'office' ? (
              <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
                Word 文件請用其他 App 開啟；若要在這裡列印，請先轉成 PDF。
              </Text>
            ) : (
              <>
                <AIButton
                  label={isWeb ? '開啟文件預覽' : '預覽並列印'}
                  disabled={Boolean(busy)}
                  onPress={() => void run('print')}
                />
                <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
                  {isWeb
                    ? '文件會在新分頁開啟，可使用瀏覽器的列印選單。'
                    : '在系統列印視窗確認頁面，並選擇印表機、份數與支援的列印選項。'}
                </Text>
              </>
            )}
            <AIButton
              label="用其他 App 開啟或分享"
              variant="ghost"
              disabled={Boolean(busy)}
              onPress={() => void run('share')}
            />
            {isWeb ? (
              <AIButton
                label="儲存檔案"
                variant="ghost"
                disabled={Boolean(busy)}
                onPress={() => savePrintDocument(document)}
              />
            ) : null}
          </View>
        </AISection>
      ) : null}
      <AISection title="列印前確認">
        <AIRow
          title="確認紙張與內容"
          subtitle="以系統預覽顯示的頁面為準，份數、彩色與雙面選項依印表機支援情況提供。"
          static
        />
        <AIRow
          title="列印狀態"
          subtitle="開啟列印視窗不代表文件已印出，請在系統或印表機確認進度。"
          static
        />
        <AIRow
          title="校內印表機"
          subtitle="目前尚未連接校內遠端列印服務。校內機器位置、使用方式與費用，請向學校查詢。"
          static
        />
      </AISection>
    </AIScreen>
  );
}
