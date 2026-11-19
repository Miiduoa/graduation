import type {
  MerchantApplicationState,
  NuniMerchantApplication,
  NuniMerchantWorkspace,
} from './nuniMerchant';

/** Navigation guidance only; authorization remains with the workspace APIs. */
export function isMerchantWorkspaceOperational(workspace: NuniMerchantWorkspace): boolean {
  return (
    workspace.activated &&
    workspace.merchantStatus === 'active' &&
    ((workspace.locationStatus === 'open' && workspace.publicAccess) ||
      (workspace.locationStatus === 'closed' && !workspace.publicAccess))
  );
}

export function merchantApplicationNextStep(state: MerchantApplicationState): string {
  return {
    submitted: '已收到申請，請在這裡查看後續審核進度，不必再次送件。',
    'under-review': '受理單位正在審核；有補件或審核結果時會顯示在這筆申請。',
    'needs-information': '請依審核說明向受理單位提供資料，不必重複建立申請。',
    approved: '核准後，請從已授權門市繼續完成營運設定與菜單。',
    rejected: '請先閱讀審核說明；如需確認原因，請聯絡受理單位。',
    withdrawn: '這筆申請已結束；需要進駐時，可重新提出申請。',
  }[state];
}

/** Call only after both lists have loaded successfully; an error is not an empty list. */
export function merchantOverviewNextStep({
  applications,
  workspaces,
}: {
  applications: NuniMerchantApplication[];
  workspaces: NuniMerchantWorkspace[];
}): { title: string; description: string; section: 'applications' | 'locations' | 'apply' } {
  const needsInformation = applications.filter((item) => item.state === 'needs-information');
  if (needsInformation.length) {
    return {
      title: `${needsInformation.length} 筆申請需要補件`,
      description: '先查看審核說明，依受理單位要求補齊資料；既有門市仍可從下方進入。',
      section: 'applications',
    };
  }
  const preparing = workspaces.filter(
    (item) =>
      !item.activated &&
      item.merchantStatus === 'suspended' &&
      item.locationStatus === 'suspended' &&
      !item.publicAccess,
  );
  if (preparing.length) {
    return {
      title: `${preparing.length} 間門市待完成開店準備`,
      description: '選擇門市，依序確認營運方式、建立菜單，再確認啟用。',
      section: 'locations',
    };
  }
  if (workspaces.some(isMerchantWorkspaceOperational)) {
    return {
      title: '開始今天的門市工作',
      description: '選擇要值班的門市，處理訂單、收款與取餐；新門市申請放在下方。',
      section: 'locations',
    };
  }
  if (workspaces.length) {
    return {
      title: '先確認門市營運狀態',
      description: '查看門市目前狀態與待處理項目；需要恢復權限時，請聯絡場域管理者。',
      section: 'locations',
    };
  }
  if (applications.some((item) => item.state === 'approved')) {
    return {
      title: '申請已核准，等待門市權限',
      description: '目前還沒有可管理的門市。請重新載入；仍未出現時，向受理單位確認帳號指派。',
      section: 'applications',
    };
  }
  if (applications.some((item) => ['submitted', 'under-review'].includes(item.state))) {
    return {
      title: '查看這次進駐申請',
      description: '申請已送出，下一步是等候審核或補件通知，無須重新填寫進駐表單。',
      section: 'applications',
    };
  }
  if (applications.length) {
    return {
      title: '查看申請結果',
      description: '先閱讀各筆申請的審核說明，再決定是否提出新申請。',
      section: 'applications',
    };
  }
  return {
    title: '開始申請第一間門市',
    description: '由負責人填寫進駐資料；如果你是店員，請先向負責人確認工作帳號與門市指派。',
    section: 'apply',
  };
}
