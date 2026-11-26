import { connectedServiceClauses, parseTeachingRead, parseMerchantRead } from './assistantRoleReadIntent';
import { parseCampusMapClause, parseCampusMapCommand } from './assistantCampusMapIntent';
import { parseAssistantCalendarIntent } from './assistantCalendarIntent';
import { parseAssistantWorkSessionIntent } from './assistantWorkSessionIntent';
import { parsePublicCampusRead, parsePublicSocialRead, parseSchoolInfoRead } from './assistantPublicReadIntent';
import { parseLibraryCatalogRead } from './assistantLibraryCatalog';
import { assistantRoleToolAllowed, getAssistantRoleProfile, type AssistantRoleProfileId } from './assistantRoleProfiles';
import { resolveAssistantServiceIntent, type AssistantServiceId } from './assistantServices';

export type AssistantRoleTaskGuide = {
  profileId: AssistantRoleProfileId;
  answer: string;
  serviceIds: readonly AssistantServiceId[];
};

const work: Record<Exclude<AssistantRoleProfileId, 'student'>, RegExp> = {
  teacher: /授課|備課|批改|評分|學生|班級|課程|課務|教材|作業|測驗|要交|待繳|成績|學分|點名|出席|請假|申訴/,
  merchant: /門市|店家|營運|訂單|接單|出餐|取餐|退款|退單|營收|銷售|庫存|菜單|商品|售完|營業/,
  club: /社團.*(?:管理|幹部|成員|名單|活動|發文|公告|審核)|(?:發布|發送|刪除|新增|審核|批准|報名|通知).*(?:活動|貼文|社團|成員)|幹部|活動名單/,
  school: /校務|課務|資格|審核|核准|核閱|學生|教師|課程|作業|成績|學分|公告|申訴|請假|學校|系辦/,
  platform: /平台|權限|帳號|資格|管理|停權|審核|核准|風險|維運|異常|紀錄|日誌|稽核|使用者|用戶|全站/,
};
const destinations: Record<Exclude<AssistantRoleProfileId, 'student'>, readonly AssistantServiceId[]> = {
  teacher: ['classroom', 'leave-review', 'teacher'],
  merchant: ['merchant'],
  club: ['clubs', 'events', 'community'],
  school: ['school-account', 'leave-review', 'teacher'],
  platform: ['admin'],
};
const explanation: Record<Exclude<AssistantRoleProfileId, 'student'>, string> = {
  teacher: '授課工作從你有權限的課程開始：在課程頁查看作業、教材與出席，請假與申訴由各自的核閱頁處理。這些教學操作目前在服務頁完成。',
  merchant: '門市工作從你負責的店家開始：在店家工作台查看訂單、出餐與商品，再核對要處理的那一筆。接單、退款與商品變更目前在店家頁完成。',
  club: '社團工作從你管理的社團開始：先選社團與活動，再核對成員、公告或貼文。發布內容與調整成員目前在社團服務頁完成。',
  school: '校務工作先選學校與待處理案件，再核對資格、課程與核閱內容。學校資格與課務管理目前在對應服務頁完成。',
  platform: '平台工作先確認處理範圍，再查看管理工作台的帳號、資格與待處理項目。權限與帳號異動目前在管理頁完成。',
};

/** Fixed work destinations for clients whose professional reader is not connected. */
export function assistantRoleWorkServices(profileId: AssistantRoleProfileId): readonly AssistantServiceId[] {
  return profileId === 'student' ? [] : [...destinations[profileId]];
}

/** Existing whole public reads/entries are equally usable on their own or as
 * an independent clause. Filters and extra operations remain unconsumed. */
function plainCampusRead(question: string): boolean {
  return /^(?:請|幫我|請幫我)?\s*(?:查|查詢|看看?|查看)\s*(?:近期|最近|今天)?\s*(?:校園公告|公開公告|近期活動|校園活動|活動|公車|地圖|圖書館)[？?。!！\s]*$/.test(question.normalize('NFKC'));
}

/** Match the full task graph's narrow sequence-prefix normalization. */
function taskClause(question: string): string {
  return question.trim().replace(/^先(?=查|看|幫我)/, '');
}

/** Fixed task guidance only. A selected context never verifies or grants a role.
 * Unconnected adapters pass false to retain service guidance without private reads. */
export function assistantRoleTaskGuide(
  profileValue: unknown,
  question: string,
  now = Date.now(),
  workspaceReaderConnected = true,
): AssistantRoleTaskGuide | null {
  const profile = getAssistantRoleProfile(profileValue);
  if (!profile || profile.id === 'student' || typeof question !== 'string' ||
      !question.trim() || question.length > 1000 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(question)) return null;
  // Complete personal appointments and explicitly specified work sessions keep
  // the existing source checks and signed confirmation flow.
  const wholeWorkSession = parseAssistantWorkSessionIntent(taskClause(question), now);
  if (wholeWorkSession?.profileId === profile.id) return null;
  if (!wholeWorkSession && parseAssistantCalendarIntent(question, now)?.kind === 'draft') return null;
  if (resolveAssistantServiceIntent(question)?.kind === 'open') return null;
  // A complete next-class location request reads the user's own timetable,
  // never a student's coursework or a teacher's class roster.
  if (assistantRoleToolAllowed(profile.id, 'get_campus_map') &&
    (parseCampusMapCommand(question) || parseCampusMapClause(question)?.kind === 'next-class')) return null;
  const workPattern = work[profile.id];
  const normalized = question.normalize('NFKC');
  // Callers give complete personal timetable reads priority using their existing
  // read-intent classifier; do not maintain a second query grammar here.
  if (plainCampusRead(normalized)) return null;
  const orientation = /(?:可以|能|會)幫我|能做什麼|可以做什麼|工作重點|我的工作|今天.*待辦|工作流程/.test(normalized);
  const incompatibleStudentRead = /作業|要交|待繳|測驗|教材|成績|學分|下一堂課/.test(normalized);
  const incompatibleBuyerRead = /訂單|取餐|再點|跟上次一樣/.test(normalized);
  const professionalWrite = /批改|評分|發布|發佈|發文|發送|傳送|上架|下架|取消|刪除|刪掉|移除|封鎖|停權|授權|退款|退單|接單|出餐|核准|批准|審核|核閱|修改|變更|群發|通知(?:學生|社員|成員|員工)/;
  // A supported overview cannot hide an unsupported professional/buyer request
  // in another clause (e.g. 門市訂單與營收). Complete personal plans may continue.
  const clauses = connectedServiceClauses(question).map(taskClause);
  const mapChainClauses = new Set<number>();
  let hasEventSource = false;
  for (let index = 0; index < clauses.length; index++) {
    // The real graph binds an ordinal to its latest preceding events read;
    // a role context cannot supply an event source or a guessed location.
    if (parsePublicCampusRead(clauses[index])?.kind === 'events') hasEventSource = true;
    if (index > 0 && parseLibraryCatalogRead(clauses[index - 1]) &&
        parseCampusMapClause(clauses[index])?.kind === 'previous-library') mapChainClauses.add(index);
    if (hasEventSource && parseCampusMapClause(clauses[index])?.kind === 'previous-event')
      mapChainClauses.add(index);
    if (index + 1 >= clauses.length ||
      parseCampusMapCommand(clauses[index] + '，' + clauses[index + 1])?.kind !== 'next-class') continue;
    mapChainClauses.add(index);
    mapChainClauses.add(index + 1);
  }
  const mismatchedWorkSession = clauses.some(clause => {
    const intent = parseAssistantWorkSessionIntent(clause, now);
    return intent !== null && intent.profileId !== profile.id;
  });
  const workspaceRead = (clause: string) => {
    const value = taskClause(clause);
    return profile.id === 'teacher' ? parseTeachingRead(value) !== null
      : profile.id === 'merchant' ? parseMerchantRead(value) !== null : false;
  };
  const supportedRead = (clause: string) => {
    const value = taskClause(clause);
    const read = parsePublicCampusRead(value) ?? parsePublicSocialRead(value) ?? parseSchoolInfoRead(value) ?? parseLibraryCatalogRead(value);
    const map = parseCampusMapClause(value);
    return read ? assistantRoleToolAllowed(profile.id, read.tool)
      : ((map?.kind === 'place' || map?.kind === 'next-class') && assistantRoleToolAllowed(profile.id, 'get_campus_map')) ||
        plainCampusRead(value) || workspaceReaderConnected && workspaceRead(clause);
  };
  // Every clause must keep its full meaning. A supported public read cannot
  // consume a later approval, refund, publication or other professional write.
  if (!mismatchedWorkSession && clauses.length && clauses.every((clause, index) =>
    (mapChainClauses.has(index) && assistantRoleToolAllowed(profile.id, 'get_campus_map')) || supportedRead(clause) ||
    parseAssistantCalendarIntent(clause, now)?.kind === 'draft' ||
    parseAssistantWorkSessionIntent(clause, now)?.profileId === profile.id ||
    resolveAssistantServiceIntent(clause)?.kind === 'open')) return null;
  if (!mismatchedWorkSession && workspaceReaderConnected && clauses.some(workspaceRead) && clauses.every(clause =>
    workspaceRead(clause) || parseAssistantCalendarIntent(clause, now)?.kind === 'draft' ||
    parseAssistantWorkSessionIntent(clause, now)?.profileId === profile.id ||
    !professionalWrite.test(clause) &&
    !/作業|要交|待繳|測驗|教材|成績|學分|下一堂課|訂單|取餐|再點|跟上次一樣/.test(clause) && !workPattern.test(clause))) return null;
  if (!mismatchedWorkSession && !orientation && !workPattern.test(normalized) && !professionalWrite.test(normalized) &&
      !incompatibleStudentRead && !incompatibleBuyerRead) return null;
  return {
    profileId: profile.id,
    answer: explanation[profile.id] + '\n也可以給我明確日期、起訖時間與名稱，先預覽你的個人行程，再由你確認儲存。若要找空檔，也可以提供日期、時段與所需時間，我會先核對本人課表與個人行程。',
    serviceIds: assistantRoleWorkServices(profile.id),
  };
}
