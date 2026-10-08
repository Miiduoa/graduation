/** Fixed QR Model 2 version 3-M, byte mode, mask 0. Only 32-byte bearer tokens. */
export function attendanceQr(token: string): boolean[][] {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw new Error('Expected a 32-byte attendance token');
  const bits: number[] = [];
  const append = (n: number, width: number) => {
    for (let i = width - 1; i >= 0; i--) bits.push((n >>> i) & 1);
  };
  append(4, 4); append(32, 8);
  for (const char of token) append(char.charCodeAt(0), 8);
  append(0, 4);
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => a * 2 + b, 0));
  for (let i = 0; data.length < 44; i++) data.push(i % 2 ? 0x11 : 0xec);
  const multiply = (a: number, b: number) => {
    let out = 0;
    for (; b; b >>>= 1) {
      if (b & 1) out ^= a;
      a <<= 1;
      if (a & 0x100) a ^= 0x11d;
    }
    return out;
  };
  let polynomial = [1];
  let root = 1;
  for (let i = 0; i < 26; i++) {
    const next = Array(polynomial.length + 1).fill(0) as number[];
    polynomial.forEach((coefficient, j) => {
      next[j] ^= coefficient;
      next[j + 1] ^= multiply(coefficient, root);
    });
    polynomial = next; root = multiply(root, 2);
  }
  const remainder = [...data, ...Array(26).fill(0)] as number[];
  for (let i = 0; i < data.length; i++) {
    const coefficient = remainder[i];
    polynomial.forEach((p, j) => { remainder[i + j] ^= multiply(p, coefficient); });
  }
  const words = [...data, ...remainder.slice(44)];
  const size = 29;
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));
  const put = (r: number, c: number, dark: boolean) => { matrix[r][c] = dark; };
  for (const [top, left] of [[0, 0], [0, 22], [22, 0]]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      if (top + r < 0 || top + r >= size || left + c < 0 || left + c >= size) continue;
      const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      put(top + r, left + c, inside && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)));
    }
  }
  for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
    put(22 + r, 22 + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
  }
  for (let i = 8; i < 21; i++) { put(6, i, i % 2 === 0); put(i, 6, i % 2 === 0); }
  // Medium error correction, mask 0, including the format-information XOR mask.
  const format = 0x5412;
  for (let i = 0; i < 15; i++) {
    const dark = ((format >>> i) & 1) === 1;
    const vertical = i < 6 ? i : i < 8 ? i + 1 : size - 15 + i;
    const horizontal = i < 8 ? size - i - 1 : i === 8 ? 7 : 14 - i;
    put(vertical, 8, dark); put(8, horizontal, dark);
  }
  put(size - 8, 8, true);
  let cursor = 0;
  let up = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    for (let step = 0; step < size; step++) {
      const row = up ? size - 1 - step : step;
      for (const column of [right, right - 1]) {
        if (matrix[row][column] !== null) continue;
        const word = words[Math.floor(cursor / 8)] ?? 0;
        const bit = ((word >>> (7 - cursor % 8)) & 1) === 1;
        put(row, column, (row + column) % 2 === 0 ? !bit : bit);
        cursor++;
      }
    }
    up = !up;
  }
  return matrix as boolean[][];
}
