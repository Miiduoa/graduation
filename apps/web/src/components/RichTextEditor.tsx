/**
 * RichTextEditor (shim) — 給 LMS v2 admin notify 頁用
 * 簡化版:單純的 textarea。日後可換成 TipTap / Slate / Lexical。
 */
'use client';

import { type ChangeEvent } from 'react';

export interface RichTextEditorProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minHeight?: number;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = '輸入內容…',
  minHeight = 160,
}: RichTextEditorProps) {
  return (
    <textarea
      value={value}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%',
        minHeight,
        padding: 12,
        border: '1px solid #D1D5DB',
        borderRadius: 8,
        fontFamily: 'inherit',
        fontSize: 14,
        lineHeight: 1.5,
        resize: 'vertical',
      }}
    />
  );
}

export default RichTextEditor;
