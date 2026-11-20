export function chineseOrDecimal(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = '零一二三四五六七八九';
  if (value.length === 1 && digits.includes(value)) return digits.indexOf(value);
  const tens = value.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/u);
  return tens ? (tens[1] ? digits.indexOf(tens[1]) : 1) * 10 + (tens[2] ? digits.indexOf(tens[2]) : 0) : NaN;
}
