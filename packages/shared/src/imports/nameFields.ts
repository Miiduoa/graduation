/** 解析與送出前遮罩共用的姓名欄名。 */
export const PERSONAL_IMPORT_TEACHER_FIELDS = [
  '授課教師', '授課老師', '教師', '老師', '教授', '教師姓名',
  'teacher', 'teachername', 'instructor',
];
export const PERSONAL_IMPORT_NAME_FIELDS = [
  '學生姓名', '姓名', '學生', 'studentname', 'name',
  ...PERSONAL_IMPORT_TEACHER_FIELDS,
];
/** 與表頭正規化一致，允許空白、底線、括號及冒號。 */
export const PERSONAL_IMPORT_NAME_FIELD_PATTERN = PERSONAL_IMPORT_NAME_FIELDS
  .map((name) => [...name].join('[ \\t_()（）:：]*'))
  .join('|');
