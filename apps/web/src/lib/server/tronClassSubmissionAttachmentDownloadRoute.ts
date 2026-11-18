import type { NextRequest } from 'next/server';
import {
  handleTronClassFileDownload, type TronClassFileDownloadRouteDependencies,
} from './tronClassMaterialDownloadRoute';
import {
  createTronClassSubmissionAttachmentDownloader, parseTronClassSubmissionAttachmentDownloadInput,
  type TronClassSubmissionAttachmentDownloadInput,
} from './tronClassSubmissionAttachmentDownload';

export type TronClassSubmissionAttachmentDownloadRouteDependencies =
  TronClassFileDownloadRouteDependencies<TronClassSubmissionAttachmentDownloadInput>;

export async function handleTronClassSubmissionAttachmentDownload(
  request: NextRequest,
  dependencies: TronClassSubmissionAttachmentDownloadRouteDependencies = {},
): Promise<Response> {
  return handleTronClassFileDownload(request, parseTronClassSubmissionAttachmentDownloadInput,
    (bindings) => createTronClassSubmissionAttachmentDownloader({ bindings }), dependencies, {
      TRONCLASS_SUBMISSION_ATTACHMENT_DENIED: '目前無法下載這個繳交版本的附件，請重新讀取繳交紀錄。',
      TRONCLASS_SUBMISSION_ATTACHMENT_CHANGED: '這份作業附件已變更，請重新讀取繳交紀錄。',
      TRONCLASS_HISTORY_UNAVAILABLE: '暫時無法確認這筆繳交紀錄，請稍後重新下載。',
      TRONCLASS_HOMEWORK_NOT_FOUND: '目前找不到這份作業，請重新整理課程。',
      TRONCLASS_COURSE_ACCESS_DENIED: '這個帳號目前無法讀取這門課程。',
      TRONCLASS_DOWNLOAD_TOO_LARGE: '附件超過 25 MB，請開啟 TronClass 原作業下載。',
      TRONCLASS_DOWNLOAD_REDIRECT_UNSUPPORTED: '這份附件使用其他下載位置，請開啟 TronClass 原作業下載。',
      TRONCLASS_DOWNLOAD_TYPE_UNSUPPORTED: '這份附件目前需開啟 TronClass 原作業下載。',
      TRONCLASS_DOWNLOAD_BUSY: '目前有其他附件正在下載，請稍後再試。',
      TRONCLASS_DOWNLOAD_UNAVAILABLE: '目前無法下載這份附件，請稍後再試或開啟 TronClass 原作業。',
      TRONCLASS_READ_TIMEOUT: '讀取繳交紀錄逾時，請稍後重新下載。',
      SIGN_IN_REQUIRED: '請先登入 nuni，再下載作業附件。',
    });
}
