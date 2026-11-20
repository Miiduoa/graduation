/* eslint-disable */
/**
 * PureQRCode — 純 JavaScript QR 碼生成器
 *
 * 不需要任何原生套件，使用 React Native View 渲染真實可掃描的 QR 碼。
 * 實作 QR Code Model 2, Version 1-6 (支援最多 134 bytes 的資料)
 *
 * 參考：ISO/IEC 18004:2015
 */
import React, { useMemo } from 'react';
import { View } from 'react-native';

// ─── QR Code Core Algorithm ─────────────────────────────

// Error correction levels
const EC_LOW = 0;
const EC_MEDIUM = 1;
const EC_QUARTILE = 2;
const EC_HIGH = 3;

// Encoding mode
const MODE_BYTE = 4;

// Version info: [version, dataCodewords, ecCodewordsPerBlock, numBlocks]
const VERSION_INFO: [number, number, number, number][] = [
  [1, 19, 7, 1], // V1 M
  [2, 34, 10, 1], // V2 M
  [3, 55, 15, 1], // V3 M
  [4, 80, 20, 1], // V4 M
  [5, 108, 26, 1], // V5 M
  [6, 136, 18, 2], // V6 M
];

// Alignment pattern positions per version
const ALIGNMENT_POSITIONS: number[][] = [
  [], // V1
  [6, 18], // V2
  [6, 22], // V3
  [6, 26], // V4
  [6, 30], // V5
  [6, 34], // V6
];

// Format info for EC level Medium + mask patterns 0-7
const FORMAT_INFO = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];

// GF(256) log/exp tables for Reed-Solomon
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsEncode(data: number[], ecLen: number): number[] {
  // Generate RS generator polynomial
  const gen = new Uint8Array(ecLen + 1);
  gen[0] = 1;
  for (let i = 0; i < ecLen; i++) {
    for (let j = ecLen; j >= 1; j--) {
      gen[j] = gen[j] ^ gfMul(gen[j - 1], GF_EXP[i]);
    }
  }

  const msg = new Uint8Array(data.length + ecLen);
  for (let i = 0; i < data.length; i++) msg[i] = data[i];

  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j <= ecLen; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }

  const result: number[] = [];
  for (let i = data.length; i < msg.length; i++) {
    result.push(msg[i]);
  }
  return result;
}

// Encode text to byte mode QR data
function encodeData(
  text: string,
  version: number,
  ecPerBlock: number,
  numBlocks: number,
): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6));
      bytes.push(0x80 | (code & 0x3f));
    } else {
      bytes.push(0xe0 | (code >> 12));
      bytes.push(0x80 | ((code >> 6) & 0x3f));
      bytes.push(0x80 | (code & 0x3f));
    }
  }

  const totalDataCw = VERSION_INFO[version - 1][1];
  const dataBits: number[] = [];

  // Mode indicator (4 bits) = 0100 (byte mode)
  dataBits.push(0, 1, 0, 0);

  // Character count (8 bits for V1-9)
  const charCount = bytes.length;
  for (let i = 7; i >= 0; i--) {
    dataBits.push((charCount >> i) & 1);
  }

  // Data
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) {
      dataBits.push((byte >> i) & 1);
    }
  }

  // Terminator
  const maxBits = totalDataCw * 8;
  const terminatorLen = Math.min(4, maxBits - dataBits.length);
  for (let i = 0; i < terminatorLen; i++) dataBits.push(0);

  // Pad to byte boundary
  while (dataBits.length % 8 !== 0) dataBits.push(0);

  // Pad codewords
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (dataBits.length < maxBits) {
    const pb = padBytes[padIdx % 2];
    for (let i = 7; i >= 0; i--) dataBits.push((pb >> i) & 1);
    padIdx++;
  }

  // Convert bits to bytes
  const dataCodewords: number[] = [];
  for (let i = 0; i < dataBits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (dataBits[i + j] || 0);
    dataCodewords.push(byte);
  }

  // Split into blocks and generate EC
  const blockSize = Math.floor(dataCodewords.length / numBlocks);
  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];

  for (let b = 0; b < numBlocks; b++) {
    const start = b * blockSize;
    const block = dataCodewords.slice(start, start + blockSize);
    blocks.push(block);
    ecBlocks.push(rsEncode(block, ecPerBlock));
  }

  // Interleave data
  const result: number[] = [];
  for (let i = 0; i < blockSize; i++) {
    for (let b = 0; b < numBlocks; b++) {
      result.push(blocks[b][i]);
    }
  }
  // Interleave EC
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < numBlocks; b++) {
      result.push(ecBlocks[b][i]);
    }
  }

  return result;
}

// Create QR matrix
function createMatrix(version: number): boolean[][] {
  const size = version * 4 + 17;
  return Array.from({ length: size }, () => Array(size).fill(false));
}

function createReserved(version: number): boolean[][] {
  const size = version * 4 + 17;
  return Array.from({ length: size }, () => Array(size).fill(false));
}

// Place finder patterns
function placeFinderPattern(matrix: boolean[][], reserved: boolean[][], row: number, col: number) {
  const pattern = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ];
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const mr = row + r;
      const mc = col + c;
      if (mr >= 0 && mr < matrix.length && mc >= 0 && mc < matrix.length) {
        matrix[mr][mc] = pattern[r][c] === 1;
        reserved[mr][mc] = true;
      }
    }
  }
}

// Place separators
function placeSeparators(matrix: boolean[][], reserved: boolean[][], size: number) {
  for (let i = 0; i < 8; i++) {
    // Top-left
    if (i < size) {
      matrix[7][i] = false;
      reserved[7][i] = true;
      matrix[i][7] = false;
      reserved[i][7] = true;
    }
    // Top-right
    if (size - 8 + i < size) {
      matrix[7][size - 8 + i] = false;
      reserved[7][size - 8 + i] = true;
    }
    if (i < 8) {
      matrix[i][size - 8] = false;
      reserved[i][size - 8] = true;
    }
    // Bottom-left
    if (size - 8 + i < size) {
      matrix[size - 8 + i][7] = false;
      reserved[size - 8 + i][7] = true;
    }
    if (i < 8) {
      matrix[size - 8][i] = false;
      reserved[size - 8][i] = true;
    }
  }
}

// Place alignment patterns
function placeAlignmentPatterns(matrix: boolean[][], reserved: boolean[][], version: number) {
  if (version < 2) return;
  const positions = ALIGNMENT_POSITIONS[version - 1];
  for (const row of positions) {
    for (const col of positions) {
      // Skip if overlapping with finder patterns
      if (row < 9 && col < 9) continue;
      if (row < 9 && col > matrix.length - 9) continue;
      if (row > matrix.length - 9 && col < 9) continue;

      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const isOuter = Math.abs(r) === 2 || Math.abs(c) === 2;
          const isCenter = r === 0 && c === 0;
          matrix[row + r][col + c] = isOuter || isCenter;
          reserved[row + r][col + c] = true;
        }
      }
    }
  }
}

// Place timing patterns
function placeTimingPatterns(matrix: boolean[][], reserved: boolean[][], size: number) {
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    reserved[6][i] = true;
    matrix[i][6] = i % 2 === 0;
    reserved[i][6] = true;
  }
}

// Reserve format info areas
function reserveFormatInfo(reserved: boolean[][], size: number) {
  for (let i = 0; i < 9; i++) {
    if (i < size) reserved[8][i] = true;
    if (i < size) reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }
  // Dark module
  reserved[size - 8][8] = true;
}

// Place data bits
function placeData(matrix: boolean[][], reserved: boolean[][], codewords: number[]) {
  const size = matrix.length;
  const bits: number[] = [];
  for (const cw of codewords) {
    for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
  }

  let bitIdx = 0;
  let upward = true;

  for (let col = size - 1; col >= 0; col -= 2) {
    if (col === 6) col = 5; // Skip timing column

    const rows = upward
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);

    for (const row of rows) {
      for (const c of [col, col - 1]) {
        if (c < 0 || c >= size) continue;
        if (reserved[row][c]) continue;
        if (bitIdx < bits.length) {
          matrix[row][c] = bits[bitIdx] === 1;
          bitIdx++;
        }
      }
    }
    upward = !upward;
  }
}

// Mask patterns
const MASK_FUNCTIONS = [
  (r: number, c: number) => (r + c) % 2 === 0,
  (r: number, c: number) => r % 2 === 0,
  (r: number, c: number) => c % 3 === 0,
  (r: number, c: number) => (r + c) % 3 === 0,
  (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r: number, c: number) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r: number, c: number) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r: number, c: number) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(matrix: boolean[][], reserved: boolean[][], maskIdx: number): boolean[][] {
  const size = matrix.length;
  const result = matrix.map((row) => [...row]);
  const maskFn = MASK_FUNCTIONS[maskIdx];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved[r][c] && maskFn(r, c)) {
        result[r][c] = !result[r][c];
      }
    }
  }
  return result;
}

// Calculate penalty score for mask selection
function calculatePenalty(matrix: boolean[][]): number {
  const size = matrix.length;
  let penalty = 0;

  // Rule 1: consecutive same-color in row/col
  for (let r = 0; r < size; r++) {
    let count = 1;
    for (let c = 1; c < size; c++) {
      if (matrix[r][c] === matrix[r][c - 1]) {
        count++;
      } else {
        if (count >= 5) penalty += count - 2;
        count = 1;
      }
    }
    if (count >= 5) penalty += count - 2;
  }
  for (let c = 0; c < size; c++) {
    let count = 1;
    for (let r = 1; r < size; r++) {
      if (matrix[r][c] === matrix[r - 1][c]) {
        count++;
      } else {
        if (count >= 5) penalty += count - 2;
        count = 1;
      }
    }
    if (count >= 5) penalty += count - 2;
  }

  // Rule 2: 2x2 blocks
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = matrix[r][c];
      if (v === matrix[r][c + 1] && v === matrix[r + 1][c] && v === matrix[r + 1][c + 1]) {
        penalty += 3;
      }
    }
  }

  return penalty;
}

// Place format info
function placeFormatInfo(matrix: boolean[][], size: number, maskIdx: number) {
  const info = FORMAT_INFO[maskIdx];

  // Around top-left finder
  const positions1 = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ];
  // Around top-right and bottom-left
  const positions2 = [
    [8, size - 1],
    [8, size - 2],
    [8, size - 3],
    [8, size - 4],
    [8, size - 5],
    [8, size - 6],
    [8, size - 7],
    [8, size - 8],
    [size - 7, 8],
    [size - 6, 8],
    [size - 5, 8],
    [size - 4, 8],
    [size - 3, 8],
    [size - 2, 8],
    [size - 1, 8],
  ];

  for (let i = 0; i < 15; i++) {
    const bit = ((info >> (14 - i)) & 1) === 1;
    const [r1, c1] = positions1[i];
    matrix[r1][c1] = bit;
    const [r2, c2] = positions2[i];
    matrix[r2][c2] = bit;
  }

  // Dark module
  matrix[size - 8][8] = true;
}

// Main QR generation function
function generateQRMatrix(text: string): boolean[][] {
  // Find appropriate version
  let version = 1;
  const textBytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) textBytes.push(code);
    else if (code < 0x800) {
      textBytes.push(0, 0);
    } else {
      textBytes.push(0, 0, 0);
    }
  }
  const dataLen = textBytes.length;

  for (let v = 0; v < VERSION_INFO.length; v++) {
    const capacity = VERSION_INFO[v][1] - 2; // subtract mode + length overhead
    if (dataLen <= capacity) {
      version = v + 1;
      break;
    }
    if (v === VERSION_INFO.length - 1) version = v + 1;
  }

  const [, , ecPerBlock, numBlocks] = VERSION_INFO[version - 1];
  const size = version * 4 + 17;

  // Create matrix and reserved mask
  const matrix = createMatrix(version);
  const reserved = createReserved(version);

  // Place patterns
  placeFinderPattern(matrix, reserved, 0, 0);
  placeFinderPattern(matrix, reserved, 0, size - 7);
  placeFinderPattern(matrix, reserved, size - 7, 0);
  placeSeparators(matrix, reserved, size);
  placeAlignmentPatterns(matrix, reserved, version);
  placeTimingPatterns(matrix, reserved, size);
  reserveFormatInfo(reserved, size);

  // Encode and place data
  const codewords = encodeData(text, version, ecPerBlock, numBlocks);
  placeData(matrix, reserved, codewords);

  // Try all masks and pick best
  let bestMask = 0;
  let bestPenalty = Infinity;

  for (let m = 0; m < 8; m++) {
    const masked = applyMask(matrix, reserved, m);
    placeFormatInfo(masked, size, m);
    const penalty = calculatePenalty(masked);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = m;
    }
  }

  // Apply best mask
  const finalMatrix = applyMask(matrix, reserved, bestMask);
  placeFormatInfo(finalMatrix, size, bestMask);

  return finalMatrix;
}

// ─── React Component ────────────────────────────────────

interface PureQRCodeProps {
  value: string;
  size?: number;
  color?: string;
  backgroundColor?: string;
  logo?: React.ReactNode;
  logoSize?: number;
}

export function PureQRCode({
  value,
  size = 200,
  color = '#000000',
  backgroundColor = '#FFFFFF',
  logo,
  logoSize = 40,
}: PureQRCodeProps) {
  const matrix = useMemo(() => {
    try {
      return generateQRMatrix(value);
    } catch {
      // Fallback: return empty matrix
      return Array.from({ length: 21 }, () => Array(21).fill(false));
    }
  }, [value]);

  const moduleCount = matrix.length;
  const moduleSize = size / (moduleCount + 2); // +2 for quiet zone
  const quietZone = moduleSize;

  return (
    <View
      style={{
        width: size,
        height: size,
        backgroundColor,
        borderRadius: 8,
        overflow: 'hidden',
        padding: quietZone,
      }}
    >
      <View style={{ flex: 1 }}>
        {matrix.map((row, r) => (
          <View key={r} style={{ flexDirection: 'row', height: moduleSize }}>
            {row.map((cell, c) => (
              <View
                key={c}
                style={{
                  width: moduleSize,
                  height: moduleSize,
                  backgroundColor: cell ? color : backgroundColor,
                }}
              />
            ))}
          </View>
        ))}
      </View>
      {logo && (
        <View
          style={{
            position: 'absolute',
            top: (size - logoSize) / 2,
            left: (size - logoSize) / 2,
            width: logoSize,
            height: logoSize,
            backgroundColor: '#FFFFFF',
            borderRadius: 6,
            justifyContent: 'center',
            alignItems: 'center',
            padding: 2,
          }}
        >
          {logo}
        </View>
      )}
    </View>
  );
}

export default PureQRCode;
