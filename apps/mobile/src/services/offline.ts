/* eslint-disable @typescript-eslint/no-explicit-any */
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";

const OFFLINE_QUEUE_KEY = "@offline_queue";
const OFFLINE_DATA_PREFIX = "@offline_data_";
const FAILED_ACTIONS_KEY = "@offline_failed_actions";

export type QueuedAction = {
  id: string;
  type: "create" | "update" | "delete";
  collection: string;
  documentId?: string;
  data: Record<string, any>;
  timestamp: number;
  retryCount: number;
  lastError?: string;
  clientVersion?: number;
  userId?: string;
  schoolId?: string;
};

export type ConflictResolutionStrategy = "server_wins" | "client_wins" | "manual_merge";

export type ConflictInfo = {
  action: QueuedAction;
  serverData: Record<string, any>;
  clientData: Record<string, any>;
  conflictFields: string[];
};

const conflictListeners = new Set<(info: ConflictInfo) => void>();
const pendingConflicts: ConflictInfo[] = [];

export function subscribeToConflicts(listener: (info: ConflictInfo) => void): () => void {
  conflictListeners.add(listener);
  return () => conflictListeners.delete(listener);
}

export function getPendingConflicts(): ConflictInfo[] {
  return [...pendingConflicts];
}

export function clearPendingConflict(actionId: string): void {
  const index = pendingConflicts.findIndex((c) => c.action.id === actionId);
  if (index >= 0) {
    pendingConflicts.splice(index, 1);
  }
}

export function clearAllPendingConflicts(): void {
  pendingConflicts.length = 0;
}

function emitConflict(info: ConflictInfo): void {
  pendingConflicts.push(info);
  conflictListeners.forEach((listener) => {
    try {
      listener(info);
    } catch (e) {
      console.warn("[offline] Conflict listener error:", e);
    }
  });
}

export async function resolveConflict(
  actionId: string,
  resolution: "keep_local" | "keep_server" | "merge"
): Promise<void> {
  const conflict = pendingConflicts.find((c) => c.action.id === actionId);
  if (!conflict) {
    console.warn("[offline] No conflict found for action:", actionId);
    return;
  }

  const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");
  const { getDb } = await import("../firebase");
  const db = getDb();

  try {
    if (resolution === "keep_local") {
      if (conflict.action.documentId) {
        const docRef = doc(db, conflict.action.collection, conflict.action.documentId);
        await setDoc(docRef, {
          ...conflict.clientData,
          updatedAt: serverTimestamp(),
          _resolvedConflict: true,
          _conflictResolvedAt: Date.now(),
        }, { merge: true });
      }
    } else if (resolution === "keep_server") {
      // 伺服器資料已經是最新的，不需要做任何事
      console.log("[offline] Keeping server version for:", actionId);
    } else if (resolution === "merge") {
      // 合併策略：將非衝突欄位從客戶端合併到伺服器資料
      if (conflict.action.documentId) {
        const nonConflictData: Record<string, any> = {};
        for (const [key, value] of Object.entries(conflict.clientData)) {
          if (!conflict.conflictFields.includes(key) && !key.startsWith("_")) {
            nonConflictData[key] = value;
          }
        }
        
        if (Object.keys(nonConflictData).length > 0) {
          const docRef = doc(db, conflict.action.collection, conflict.action.documentId);
          await setDoc(docRef, {
            ...nonConflictData,
            updatedAt: serverTimestamp(),
            _mergedAt: Date.now(),
          }, { merge: true });
        }
      }
    }

    clearPendingConflict(actionId);
    await removeFromOfflineQueue(actionId);
    
    console.log("[offline] Conflict resolved:", actionId, resolution);
  } catch (error) {
    console.error("[offline] Failed to resolve conflict:", error);
    throw error;
  }
}

export type FailedAction = QueuedAction & {
  failedAt: number;
  errorMessage: string;
};

type SyncEventListener = (event: {
  type: "sync_start" | "sync_progress" | "sync_complete" | "sync_error" | "conflict" | "queued";
  processed?: number;
  total?: number;
  action?: QueuedAction;
  error?: Error;
  queueLength?: number;
}) => void;

const syncEventListeners = new Set<SyncEventListener>();

export function subscribeToSyncEvents(listener: SyncEventListener): () => void {
  syncEventListeners.add(listener);
  return () => syncEventListeners.delete(listener);
}

function emitSyncEvent(event: Parameters<SyncEventListener>[0]): void {
  syncEventListeners.forEach((listener) => {
    try {
      listener(event);
    } catch (e) {
      console.warn("[offline] Sync event listener error:", e);
    }
  });
}

export type NetworkStatus = {
  isConnected: boolean;
  isInternetReachable: boolean | null;
  type: string;
};

const networkListeners = new Set<(status: NetworkStatus) => void>();
let currentStatus: NetworkStatus = {
  isConnected: false,
  isInternetReachable: null,
  type: "unknown",
};
let networkMonitoringInitialized = false;
let networkUnsubscribe: (() => void) | null = null;
let isProcessingQueue = false;
let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
let pendingRetryDelay = 0;
let syncAbortController: AbortController | null = null;
let lastNetworkChangeTime = 0;
const NETWORK_DEBOUNCE_MS = 1000;

const RETRY_CONFIG = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

function getRetryDelay(retryCount: number): number {
  const delay = Math.min(
    RETRY_CONFIG.baseDelayMs * Math.pow(2, retryCount),
    RETRY_CONFIG.maxDelayMs
  );
  const jitter = delay * 0.2 * Math.random();
  return delay + jitter;
}

export function initNetworkMonitoring(): () => void {
  if (networkMonitoringInitialized && networkUnsubscribe) {
    return networkUnsubscribe;
  }
  
  networkMonitoringInitialized = true;
  
  NetInfo.fetch().then((state) => {
    currentStatus = {
      isConnected: state.isConnected ?? false,
      isInternetReachable: state.isInternetReachable,
      type: state.type,
    };
    networkListeners.forEach((listener) => {
      try {
        listener(currentStatus);
      } catch (e) {
        console.warn("[offline] Initial status listener error:", e);
      }
    });
  });
  
  const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    const newStatus: NetworkStatus = {
      isConnected: state.isConnected ?? false,
      isInternetReachable: state.isInternetReachable,
      type: state.type,
    };

    const wasOffline = !currentStatus.isConnected || currentStatus.isInternetReachable === false;
    const isNowOnline = newStatus.isConnected && newStatus.isInternetReachable !== false;
    const wasOnline = currentStatus.isConnected && currentStatus.isInternetReachable !== false;
    const isNowOffline = !newStatus.isConnected || newStatus.isInternetReachable === false;

    currentStatus = newStatus;

    networkListeners.forEach((listener) => {
      try {
        listener(newStatus);
      } catch (e) {
        console.warn("[offline] Network listener error:", e);
      }
    });

    const now = Date.now();
    
    // 防止網路狀態快速切換導致的問題
    if (now - lastNetworkChangeTime < NETWORK_DEBOUNCE_MS) {
      console.log("[offline] Network change debounced");
      return;
    }
    lastNetworkChangeTime = now;

    // 網路從在線變為離線時，中止正在進行的同步
    if (wasOnline && isNowOffline && isProcessingQueue) {
      console.log("[offline] Network went offline, aborting sync");
      if (syncAbortController) {
        syncAbortController.abort();
        syncAbortController = null;
      }
    }

    // 網路從離線變為在線時，開始同步
    if (wasOffline && isNowOnline && !isProcessingQueue) {
      // 使用延遲來確保網路穩定後再開始同步
      setTimeout(() => {
        if (currentStatus.isConnected && currentStatus.isInternetReachable !== false && !isProcessingQueue) {
          processOfflineQueue().catch(console.error);
        }
      }, 500);
    }
  });
  
  networkUnsubscribe = () => {
    unsubscribe();
    networkMonitoringInitialized = false;
    networkUnsubscribe = null;
  };
  
  return networkUnsubscribe;
}

export function subscribeToNetworkStatus(listener: (status: NetworkStatus) => void): () => void {
  networkListeners.add(listener);
  listener(currentStatus);

  return () => {
    networkListeners.delete(listener);
  };
}

export function getNetworkStatus(): NetworkStatus {
  return currentStatus;
}

export async function checkConnectivity(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected ?? false;
}

export async function addToOfflineQueue(
  action: Omit<QueuedAction, "id" | "timestamp" | "retryCount">,
  options?: { userId?: string; schoolId?: string; silent?: boolean }
): Promise<string> {
  const queue = await getOfflineQueue();
  
  const newAction: QueuedAction = {
    ...action,
    id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now(),
    retryCount: 0,
    userId: options?.userId ?? action.userId,
    schoolId: options?.schoolId ?? action.schoolId,
  };

  queue.push(newAction);
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  
  // 通知 UI 有新的離線操作被加入佇列（除非靜默模式）
  if (!options?.silent) {
    emitSyncEvent({
      type: "queued",
      action: newAction,
      queueLength: queue.length,
    });
  }
  
  return newAction.id;
}

export async function addToOfflineQueueWithLocalUpdate<T>(
  action: Omit<QueuedAction, "id" | "timestamp" | "retryCount">,
  cacheKey: string,
  updateFn: (currentData: T | null) => T,
  options?: { userId?: string; schoolId?: string }
): Promise<string> {
  const actionId = await addToOfflineQueue(action, options);
  
  try {
    const cached = await getCachedData<T>(cacheKey, Infinity);
    const updated = updateFn(cached);
    await cacheDataForOffline(cacheKey, updated);
    console.log("[offline] Local cache updated for:", cacheKey);
  } catch (e) {
    console.warn("[offline] Failed to update local cache:", e);
  }
  
  return actionId;
}

export async function getOfflineQueue(): Promise<QueuedAction[]> {
  try {
    const stored = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    console.error("Failed to get offline queue:", e);
    return [];
  }
}

/**
 * 獲取離線佇列中的項目數量
 */
export async function getOfflineQueueLength(): Promise<number> {
  try {
    const queue = await getOfflineQueue();
    return queue.length;
  } catch {
    return 0;
  }
}

export async function removeFromOfflineQueue(actionId: string): Promise<void> {
  const queue = await getOfflineQueue();
  const filtered = queue.filter((a) => a.id !== actionId);
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(filtered));
}

export async function clearOfflineQueue(): Promise<void> {
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify([]));
}

function sortQueueWithDependencies(queue: QueuedAction[]): QueuedAction[] {
  const typeOrder: Record<QueuedAction["type"], number> = {
    create: 0,
    update: 1,
    delete: 2,
  };
  
  const byCollection = new Map<string, QueuedAction[]>();
  for (const action of queue) {
    const existing = byCollection.get(action.collection) ?? [];
    existing.push(action);
    byCollection.set(action.collection, existing);
  }
  
  const result: QueuedAction[] = [];
  
  for (const [, actions] of byCollection) {
    const sorted = actions.sort((a, b) => {
      if (typeOrder[a.type] !== typeOrder[b.type]) {
        return typeOrder[a.type] - typeOrder[b.type];
      }
      return a.timestamp - b.timestamp;
    });
    result.push(...sorted);
  }
  
  return result;
}

export async function processOfflineQueue(): Promise<{ success: number; failed: number; conflicts: number }> {
  if (isProcessingQueue) {
    console.log("[offline] Queue processing already in progress, skipping");
    return { success: 0, failed: 0, conflicts: 0 };
  }

  // 確認網路在線
  const isOnline = currentStatus.isConnected && currentStatus.isInternetReachable !== false;
  if (!isOnline) {
    console.log("[offline] Cannot process queue - offline");
    return { success: 0, failed: 0, conflicts: 0 };
  }
  
  const queue = await getOfflineQueue();
  
  if (queue.length === 0) {
    return { success: 0, failed: 0, conflicts: 0 };
  }

  isProcessingQueue = true;
  syncAbortController = new AbortController();
  emitSyncEvent({ type: "sync_start", total: queue.length });

  let success = 0;
  let failed = 0;
  let conflicts = 0;
  let processed = 0;

  const sortedQueue = sortQueueWithDependencies(queue);

  for (const action of sortedQueue) {
    // 檢查是否被中止（例如網路斷線）
    if (syncAbortController?.signal.aborted) {
      console.log("[offline] Sync aborted");
      break;
    }

    // 再次確認網路狀態
    if (!currentStatus.isConnected || currentStatus.isInternetReachable === false) {
      console.log("[offline] Network went offline during sync, stopping");
      break;
    }

    try {
      const result = await processQueuedAction(action);
      
      if (result.conflict) {
        conflicts++;
        emitSyncEvent({ type: "conflict", action });
        // 不移動到失敗列表，讓使用者處理衝突
        // await moveToFailedActions(action, "版本衝突：伺服器資料較新");
      } else {
        success++;
        await removeFromOfflineQueue(action.id);
      }
      
      processed++;
      emitSyncEvent({ type: "sync_progress", processed, total: queue.length });
      
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.error("Failed to process queued action:", e);
      
      action.lastError = errorMessage;
      
      if (action.retryCount < RETRY_CONFIG.maxRetries) {
        action.retryCount++;
        const delay = getRetryDelay(action.retryCount);
        
        const updatedQueue = await getOfflineQueue();
        const index = updatedQueue.findIndex((a) => a.id === action.id);
        if (index >= 0) {
          updatedQueue[index] = action;
          await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(updatedQueue));
        }
        
        console.log(`[offline] Will retry action ${action.id} in ${delay}ms (attempt ${action.retryCount})`);
        
        // 使用單一的重試定時器，避免累積多個 setTimeout
        // 如果已有待處理的重試，只有當新的延遲更短時才更新
        if (!retryTimeoutId || delay < pendingRetryDelay) {
          if (retryTimeoutId) {
            clearTimeout(retryTimeoutId);
          }
          pendingRetryDelay = delay;
          retryTimeoutId = setTimeout(() => {
            retryTimeoutId = null;
            pendingRetryDelay = 0;
            if (currentStatus.isConnected && !isProcessingQueue) {
              processOfflineQueue().catch(console.error);
            }
          }, delay);
        }
        
      } else {
        await moveToFailedActions(action, errorMessage);
        await removeFromOfflineQueue(action.id);
        failed++;
        emitSyncEvent({ type: "sync_error", action, error: e instanceof Error ? e : new Error(errorMessage) });
      }
      
      processed++;
      emitSyncEvent({ type: "sync_progress", processed, total: queue.length });
    }
  }

  isProcessingQueue = false;
  syncAbortController = null;
  emitSyncEvent({ type: "sync_complete", processed, total: queue.length });

  return { success, failed, conflicts };
}

export function abortSync(): void {
  if (syncAbortController) {
    syncAbortController.abort();
    syncAbortController = null;
  }
}

export function isSyncing(): boolean {
  return isProcessingQueue;
}

async function moveToFailedActions(action: QueuedAction, errorMessage: string): Promise<void> {
  try {
    const failedActions = await getFailedActions();
    const failedAction: FailedAction = {
      ...action,
      failedAt: Date.now(),
      errorMessage,
    };
    failedActions.push(failedAction);
    
    if (failedActions.length > 100) {
      failedActions.splice(0, failedActions.length - 100);
    }
    
    await AsyncStorage.setItem(FAILED_ACTIONS_KEY, JSON.stringify(failedActions));
  } catch (e) {
    console.error("[offline] Failed to save failed action:", e);
  }
}

export async function getFailedActions(): Promise<FailedAction[]> {
  try {
    const stored = await AsyncStorage.getItem(FAILED_ACTIONS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export async function clearFailedActions(): Promise<void> {
  await AsyncStorage.removeItem(FAILED_ACTIONS_KEY);
}

export async function retryFailedAction(actionId: string): Promise<boolean> {
  const failedActions = await getFailedActions();
  const action = failedActions.find((a) => a.id === actionId);
  
  if (!action) return false;
  
  const retryAction: QueuedAction = {
    id: action.id,
    type: action.type,
    collection: action.collection,
    documentId: action.documentId,
    data: action.data,
    timestamp: action.timestamp,
    retryCount: 0,
    clientVersion: action.clientVersion,
  };
  
  const queue = await getOfflineQueue();
  queue.push(retryAction);
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  
  const updatedFailed = failedActions.filter((a) => a.id !== actionId);
  await AsyncStorage.setItem(FAILED_ACTIONS_KEY, JSON.stringify(updatedFailed));
  
  if (currentStatus.isConnected) {
    processOfflineQueue().catch(console.error);
  }
  
  return true;
}

/**
 * 驗證操作的使用者身份
 * @returns 包含驗證結果和可能更新的 userId 的物件
 */
async function verifyActionUser(action: QueuedAction): Promise<{ valid: boolean; userId?: string }> {
  try {
    const { getAuthInstance } = await import("../firebase");
    const auth = getAuthInstance();
    const currentUser = auth.currentUser;
    
    // 如果沒有登入的使用者，且 action 也沒有指定 userId，則拒絕
    // 這是安全性考量，避免匿名操作敏感資料
    if (!currentUser) {
      console.warn("[offline] No authenticated user, cannot process action");
      return { valid: false };
    }
    
    // 如果 action 沒有指定 userId，返回當前使用者的 ID 供呼叫者使用
    // 這處理了舊版 action 可能沒有 userId 的情況
    // 注意：我們不直接修改 action 物件，而是返回新的 userId
    if (!action.userId) {
      console.log("[offline] Action missing userId, will use current user:", currentUser.uid);
      return { valid: true, userId: currentUser.uid };
    }
    
    // 驗證 action 的擁有者是否為當前使用者
    if (currentUser.uid !== action.userId) {
      console.warn("[offline] Action belongs to different user:", action.userId, "current:", currentUser.uid);
      return { valid: false };
    }
    
    return { valid: true };
  } catch (e) {
    console.error("[offline] Failed to verify user:", e);
    return { valid: false };
  }
}

function findConflictingFields(
  clientData: Record<string, any>,
  serverData: Record<string, any>,
  baseTimestamp: number
): string[] {
  const conflicts: string[] = [];
  const serverUpdatedAt = serverData.updatedAt?.toMillis?.() ?? serverData._offlineUpdatedAt ?? 0;
  
  if (serverUpdatedAt <= baseTimestamp) {
    return [];
  }
  
  for (const key of Object.keys(clientData)) {
    if (key.startsWith("_") || key === "updatedAt" || key === "createdAt") {
      continue;
    }
    
    const clientValue = JSON.stringify(clientData[key]);
    const serverValue = JSON.stringify(serverData[key]);
    
    if (clientValue !== serverValue) {
      conflicts.push(key);
    }
  }
  
  return conflicts;
}

async function processQueuedAction(action: QueuedAction): Promise<{ success: boolean; conflict: boolean; conflictInfo?: ConflictInfo }> {
  const { doc, setDoc, updateDoc, deleteDoc, getDoc, serverTimestamp } = await import("firebase/firestore");
  const { getDb } = await import("../firebase");
  
  const verification = await verifyActionUser(action);
  if (!verification.valid) {
    throw new Error("USER_MISMATCH: Action belongs to different user or no authenticated user");
  }
  
  // 如果 verifyActionUser 提供了 userId（表示原始 action 缺少 userId），
  // 創建一個帶有正確 userId 的副本，而不是修改原始 action
  const effectiveAction: QueuedAction = verification.userId 
    ? { ...action, userId: verification.userId }
    : action;
  
  const db = getDb();
  const docRef = effectiveAction.documentId 
    ? doc(db, effectiveAction.collection, effectiveAction.documentId)
    : doc(db, effectiveAction.collection);
  
  switch (effectiveAction.type) {
    case "create":
      if (effectiveAction.documentId) {
        const existingDoc = await getDoc(docRef);
        if (existingDoc.exists()) {
          console.warn("[offline] Document already exists for create operation");
          const serverData = existingDoc.data();
          const conflictFields = findConflictingFields(effectiveAction.data, serverData, effectiveAction.timestamp);
          
          if (conflictFields.length > 0) {
            const conflictInfo: ConflictInfo = {
              action: effectiveAction,
              serverData,
              clientData: effectiveAction.data,
              conflictFields,
            };
            emitConflict(conflictInfo);
            return { success: false, conflict: true, conflictInfo };
          }
          return { success: true, conflict: false };
        }
      }
      
      await setDoc(docRef, {
        ...effectiveAction.data,
        createdAt: serverTimestamp(),
        _offlineCreatedAt: effectiveAction.timestamp,
        _clientVersion: 1,
        _createdByUserId: effectiveAction.userId,
      });
      break;
      
    case "update":
      if (!effectiveAction.documentId) {
        throw new Error("documentId is required for update operations");
      }
      
      const existingUpdateDoc = await getDoc(docRef);
      if (existingUpdateDoc.exists()) {
        const serverData = existingUpdateDoc.data();
        const serverUpdatedAt = serverData.updatedAt?.toMillis?.() ?? serverData._offlineUpdatedAt ?? 0;
        
        if (serverUpdatedAt > effectiveAction.timestamp) {
          const conflictFields = findConflictingFields(effectiveAction.data, serverData, effectiveAction.timestamp);
          
          if (conflictFields.length > 0) {
            console.warn("[offline] Server version is newer with conflicting fields:", conflictFields);
            const conflictInfo: ConflictInfo = {
              action: effectiveAction,
              serverData,
              clientData: effectiveAction.data,
              conflictFields,
            };
            emitConflict(conflictInfo);
            return { success: false, conflict: true, conflictInfo };
          }
          console.log("[offline] Server version is newer but no conflicting fields, merging");
        }
        
        const currentVersion = serverData._clientVersion ?? 0;
        const expectedVersion = effectiveAction.clientVersion ?? 0;
        
        if (expectedVersion > 0 && currentVersion !== expectedVersion) {
          console.warn("[offline] Version mismatch, conflict detected");
          const conflictInfo: ConflictInfo = {
            action: effectiveAction,
            serverData,
            clientData: effectiveAction.data,
            conflictFields: Object.keys(effectiveAction.data).filter((k) => !k.startsWith("_")),
          };
          emitConflict(conflictInfo);
          return { success: false, conflict: true, conflictInfo };
        }
      }
      
      await updateDoc(docRef, {
        ...effectiveAction.data,
        updatedAt: serverTimestamp(),
        _offlineUpdatedAt: effectiveAction.timestamp,
        _clientVersion: (effectiveAction.clientVersion ?? 0) + 1,
        _lastUpdatedByUserId: effectiveAction.userId,
      });
      break;
      
    case "delete":
      if (!effectiveAction.documentId) {
        throw new Error("documentId is required for delete operations");
      }
      
      const existingDeleteDoc = await getDoc(docRef);
      if (existingDeleteDoc.exists()) {
        const serverData = existingDeleteDoc.data();
        const serverUpdatedAt = serverData.updatedAt?.toMillis?.() ?? serverData._offlineUpdatedAt ?? 0;
        
        if (serverUpdatedAt > effectiveAction.timestamp) {
          console.warn("[offline] Document was modified after delete was queued");
          const conflictInfo: ConflictInfo = {
            action: effectiveAction,
            serverData,
            clientData: {},
            conflictFields: ["_documentDeleted"],
          };
          emitConflict(conflictInfo);
          return { success: false, conflict: true, conflictInfo };
        }
      }
      
      await deleteDoc(docRef);
      break;
      
    default:
      throw new Error(`Unknown action type: ${(effectiveAction as QueuedAction).type}`);
  }
  
  console.log("[offline] Successfully processed:", effectiveAction.type, effectiveAction.collection, effectiveAction.documentId);
  return { success: true, conflict: false };
}

export async function cacheDataForOffline(key: string, data: any): Promise<void> {
  try {
    const cacheEntry = {
      data,
      cachedAt: Date.now(),
    };
    await AsyncStorage.setItem(`${OFFLINE_DATA_PREFIX}${key}`, JSON.stringify(cacheEntry));
  } catch (e) {
    console.error("Failed to cache data for offline:", e);
  }
}

export async function getCachedData<T>(key: string, maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<T | null> {
  try {
    const stored = await AsyncStorage.getItem(`${OFFLINE_DATA_PREFIX}${key}`);
    if (!stored) return null;

    const { data, cachedAt } = JSON.parse(stored);
    
    if (Date.now() - cachedAt > maxAgeMs) {
      await AsyncStorage.removeItem(`${OFFLINE_DATA_PREFIX}${key}`);
      return null;
    }

    return data as T;
  } catch (e) {
    console.error("Failed to get cached data:", e);
    return null;
  }
}

export async function clearCachedData(key: string): Promise<void> {
  await AsyncStorage.removeItem(`${OFFLINE_DATA_PREFIX}${key}`);
}

export async function clearAllOfflineData(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const offlineKeys = keys.filter((k) => k.startsWith(OFFLINE_DATA_PREFIX));
  await AsyncStorage.multiRemove(offlineKeys);
  await clearOfflineQueue();
}

export async function getOfflineDataSize(): Promise<{ count: number; approximateBytes: number }> {
  const keys = await AsyncStorage.getAllKeys();
  const offlineKeys = keys.filter((k) => k.startsWith(OFFLINE_DATA_PREFIX) || k === OFFLINE_QUEUE_KEY);
  
  let totalBytes = 0;
  for (const key of offlineKeys) {
    const value = await AsyncStorage.getItem(key);
    if (value) {
      totalBytes += value.length * 2;
    }
  }

  return {
    count: offlineKeys.length,
    approximateBytes: totalBytes,
  };
}

export function createOfflineAwareDataSource<T>(
  fetchOnline: () => Promise<T>,
  cacheKey: string,
  maxAgeMs: number = 60 * 60 * 1000
) {
  return async (): Promise<{ data: T; isOffline: boolean; cachedAt?: number }> => {
    const isOnline = await checkConnectivity();

    if (isOnline) {
      try {
        const data = await fetchOnline();
        await cacheDataForOffline(cacheKey, data);
        return { data, isOffline: false };
      } catch (e) {
        const cached = await getCachedData<T>(cacheKey, maxAgeMs);
        if (cached) {
          return { data: cached, isOffline: true };
        }
        throw e;
      }
    } else {
      const cached = await getCachedData<T>(cacheKey, maxAgeMs);
      if (cached) {
        return { data: cached, isOffline: true };
      }
      throw new Error("No internet connection and no cached data available");
    }
  };
}

export type OfflinePriority = "essential" | "important" | "optional";

export const OFFLINE_SYNC_CONFIG: Record<string, { priority: OfflinePriority; maxAgeHours: number }> = {
  announcements: { priority: "essential", maxAgeHours: 24 },
  events: { priority: "essential", maxAgeHours: 24 },
  schedule: { priority: "essential", maxAgeHours: 168 },
  cafeteriaMenu: { priority: "important", maxAgeHours: 12 },
  mapPOIs: { priority: "important", maxAgeHours: 168 },
  busSchedule: { priority: "important", maxAgeHours: 24 },
  libraryInfo: { priority: "optional", maxAgeHours: 48 },
  groupPosts: { priority: "optional", maxAgeHours: 12 },
  lostFound: { priority: "optional", maxAgeHours: 6 },
};

export async function syncEssentialData(schoolId: string): Promise<{ synced: string[]; failed: string[] }> {
  const isOnline = await checkConnectivity();
  if (!isOnline) {
    console.log("[offline] Cannot sync essential data - offline");
    return { synced: [], failed: [] };
  }
  
  const essentialKeys = Object.entries(OFFLINE_SYNC_CONFIG)
    .filter(([_, config]) => config.priority === "essential")
    .map(([key]) => key);

  console.log("[offline] Syncing essential data:", essentialKeys);
  
  const synced: string[] = [];
  const failed: string[] = [];
  
  const { getDataSource } = await import("../data/source");
  const dataSource = getDataSource();
  
  for (const key of essentialKeys) {
    try {
      let data: unknown;
      const maxAge = OFFLINE_SYNC_CONFIG[key].maxAgeHours * 60 * 60 * 1000;
      
      switch (key) {
        case "announcements":
          data = await dataSource.listAnnouncements(schoolId);
          break;
        case "events":
          data = await dataSource.listEvents(schoolId);
          break;
        case "schedule":
          break;
        default:
          continue;
      }
      
      if (data) {
        await cacheDataForOffline(`${key}_${schoolId}`, data);
        synced.push(key);
      }
    } catch (e) {
      console.error(`[offline] Failed to sync ${key}:`, e);
      failed.push(key);
    }
  }
  
  console.log("[offline] Essential data sync complete:", { synced, failed });
  return { synced, failed };
}

export async function syncImportantData(schoolId: string): Promise<{ synced: string[]; failed: string[] }> {
  const isOnline = await checkConnectivity();
  if (!isOnline) {
    return { synced: [], failed: [] };
  }
  
  const importantKeys = Object.entries(OFFLINE_SYNC_CONFIG)
    .filter(([_, config]) => config.priority === "important")
    .map(([key]) => key);

  const synced: string[] = [];
  const failed: string[] = [];
  
  const { getDataSource } = await import("../data/source");
  const dataSource = getDataSource();
  
  for (const key of importantKeys) {
    try {
      let data: unknown;
      
      switch (key) {
        case "cafeteriaMenu":
          data = await dataSource.listMenus(schoolId);
          break;
        case "mapPOIs":
          data = await dataSource.listPois(schoolId);
          break;
        case "busSchedule":
          data = await dataSource.listBusRoutes(schoolId);
          break;
        default:
          continue;
      }
      
      if (data) {
        await cacheDataForOffline(`${key}_${schoolId}`, data);
        synced.push(key);
      }
    } catch (e) {
      console.error(`[offline] Failed to sync ${key}:`, e);
      failed.push(key);
    }
  }
  
  return { synced, failed };
}

export function isEffectivelyOnline(): boolean {
  return currentStatus.isConnected && currentStatus.isInternetReachable !== false;
}
