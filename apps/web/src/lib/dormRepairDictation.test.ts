import { expect, it } from 'vitest';
import { parseDormRepairDictation } from './dormRepairDictation';

it('fills a reversible, editable draft without pretending to file a report', () => {
  const draft = parseDormRepairDictation('幫我記錄一下：三樓浴室的水龍頭一直漏水');
  expect(draft).toMatchObject({
    category: 'water',
    title: '三樓浴室的水龍頭一直漏水',
    description: '幫我記錄一下：三樓浴室的水龍頭一直漏水',
    location: '',
  });
});

it('only extracts locations explicitly stated by the speaker', () => {
  expect(parseDormRepairDictation('冷氣壞了，位置在四樓 405 寢室')).toMatchObject({
    category: 'air', location: '四樓 405 寢室',
  });
});

it('does not invent a location or category when speech is ambiguous', () => {
  expect(parseDormRepairDictation('東西怪怪的')).toMatchObject({
    category: 'other', location: '', title: '東西怪怪的',
  });
  expect(parseDormRepairDictation(' ')).toBeNull();
});
