'use strict';

const fs = require('fs');
const path = require('path');

test('repair status push copy is a personal memo, not school acceptance', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  expect(source).not.toMatch(/報修已受理|您的報修已派員處理|報修已完成，請確認/);
  expect(source).not.toContain('報修備忘已存好');
  expect(source).toContain("title: status === 'assigned' ? '報修備忘狀態已更新' : '報修備忘已更新'");
  expect(source).toContain('此應用沒有送到學校。這只是備忘狀態變更，不是校方回覆。');
  expect(source).toContain('此應用沒有送到學校。實際是否修好請向校方確認。');
});
