/**
 * LMS v2 Firebase Functions — 集中匯出
 *
 * 在 backend/functions/index.js 文末加上:
 *   const lmsV2 = require('./lmsV2');
 *   exports.issueSupabaseJwt = lmsV2.issueSupabaseJwt;
 *
 * 即可啟用。預設「不在 index.js 匯出」= 完全 dormant。
 */

const { issueSupabaseJwt } = require('./issueSupabaseJwt');

module.exports = {
  issueSupabaseJwt,
};
