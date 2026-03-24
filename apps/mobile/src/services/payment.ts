/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
/**
 * Payment Service
 * 支付系統服務
 * 
 * 支援的支付方式：
 * - 校園卡（學生證）
 * - Apple Pay / Google Pay
 * - 信用卡/金融卡
 * - Line Pay
 * - 街口支付
 * 
 * 整合方式：
 * - Stripe (國際卡片支付)
 * - TapPay (台灣在地支付)
 * - 各校校園卡 API
 */

import { Platform } from "react-native";

// Payment types
export type PaymentMethod = 
  | "campus_card"
  | "apple_pay"
  | "google_pay"
  | "credit_card"
  | "debit_card"
  | "line_pay"
  | "jko_pay"
  | "taiwan_pay";

export type PaymentStatus = 
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "refunded";

export type TransactionType = 
  | "payment"
  | "topup"
  | "refund"
  | "transfer";

export interface PaymentMethodInfo {
  id: string;
  type: PaymentMethod;
  displayName: string;
  icon: string;
  last4?: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
  isAvailable: boolean;
}

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paymentMethodId?: string;
  paymentMethod?: PaymentMethod;
  merchantId?: string;
  merchantName?: string;
  description: string;
  reference?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  status: PaymentStatus;
  errorCode?: string;
  errorMessage?: string;
}

export interface WalletBalance {
  available: number;
  pending: number;
  currency: string;
  lastUpdated: string;
}

// Payment provider configs
interface StripeConfig {
  publishableKey: string;
  merchantId?: string;
}

interface TapPayConfig {
  appId: string;
  appKey: string;
  serverType: "sandbox" | "production";
}

// Payment Service Class
class PaymentService {
  private stripeConfig?: StripeConfig;
  private tapPayConfig?: TapPayConfig;
  private initialized: boolean = false;

  /**
   * Initialize payment service with provider configs
   */
  async initialize(options: {
    stripe?: StripeConfig;
    tapPay?: TapPayConfig;
  }): Promise<void> {
    this.stripeConfig = options.stripe;
    this.tapPayConfig = options.tapPay;
    
    // Initialize Stripe
    if (this.stripeConfig) {
      // Note: In real implementation, use @stripe/stripe-react-native
      console.log("[Payment] Stripe initialized");
    }
    
    // Initialize TapPay
    if (this.tapPayConfig) {
      // Note: In real implementation, use tappay-react-native
      console.log("[Payment] TapPay initialized");
    }
    
    this.initialized = true;
  }

  /**
   * Get available payment methods for user
   */
  async getPaymentMethods(_userId: string): Promise<PaymentMethodInfo[]> {
    const methods: PaymentMethodInfo[] = [];
    
    // Campus Card (always available)
    methods.push({
      id: "campus_card_default",
      type: "campus_card",
      displayName: "學生證",
      icon: "card",
      isDefault: true,
      isAvailable: true,
    });
    
    // Apple Pay (iOS only)
    if (Platform.OS === "ios") {
      methods.push({
        id: "apple_pay",
        type: "apple_pay",
        displayName: "Apple Pay",
        icon: "logo-apple",
        isDefault: false,
        isAvailable: await this.isApplePayAvailable(),
      });
    }
    
    // Google Pay (Android only)
    if (Platform.OS === "android") {
      methods.push({
        id: "google_pay",
        type: "google_pay",
        displayName: "Google Pay",
        icon: "logo-google",
        isDefault: false,
        isAvailable: await this.isGooglePayAvailable(),
      });
    }
    
    // Line Pay
    methods.push({
      id: "line_pay",
      type: "line_pay",
      displayName: "LINE Pay",
      icon: "chatbubble",
      isDefault: false,
      isAvailable: true,
    });
    
    // JKO Pay (街口支付)
    methods.push({
      id: "jko_pay",
      type: "jko_pay",
      displayName: "街口支付",
      icon: "wallet",
      isDefault: false,
      isAvailable: true,
    });
    
    return methods;
  }

  /**
   * Check if Apple Pay is available
   */
  async isApplePayAvailable(): Promise<boolean> {
    if (Platform.OS !== "ios") return false;
    // In real implementation, use Stripe.isApplePaySupported()
    return true;
  }

  /**
   * Check if Google Pay is available
   */
  async isGooglePayAvailable(): Promise<boolean> {
    if (Platform.OS !== "android") return false;
    // In real implementation, use Stripe.isGooglePaySupported()
    return true;
  }

  /**
   * Get wallet balance
   */
  async getWalletBalance(userId: string): Promise<WalletBalance> {
    try {
      const { getFirestore, doc, getDoc } = await import("firebase/firestore");
      const { getApp } = await import("firebase/app");
      
      const db = getFirestore(getApp());
      const walletDoc = await getDoc(doc(db, "users", userId, "wallet", "balance"));
      
      if (walletDoc.exists()) {
        const data = walletDoc.data();
        return {
          available: data.available ?? 0,
          pending: data.pending ?? 0,
          currency: data.currency ?? "TWD",
          lastUpdated: data.lastUpdated?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
        };
      }
    } catch (error) {
      console.warn("[Payment] Failed to fetch wallet balance:", error);
    }
    
    return {
      available: 0,
      pending: 0,
      currency: "TWD",
      lastUpdated: new Date().toISOString(),
    };
  }
  
  /**
   * Update wallet balance
   */
  private async updateWalletBalance(userId: string, delta: number): Promise<void> {
    try {
      const { getFirestore, doc, runTransaction, serverTimestamp } = await import("firebase/firestore");
      const { getApp } = await import("firebase/app");
      
      const db = getFirestore(getApp());
      const walletRef = doc(db, "users", userId, "wallet", "balance");
      
      await runTransaction(db, async (transaction) => {
        const walletDoc = await transaction.get(walletRef);
        const currentBalance = walletDoc.exists() ? (walletDoc.data().available ?? 0) : 0;
        const newBalance = currentBalance + delta;
        
        if (newBalance < 0) {
          throw new Error("INSUFFICIENT_BALANCE");
        }
        
        transaction.set(walletRef, {
          available: newBalance,
          pending: 0,
          currency: "TWD",
          lastUpdated: serverTimestamp(),
        }, { merge: true });
      });
    } catch (error) {
      console.error("[Payment] Failed to update wallet balance:", error);
      throw error;
    }
  }

  /**
   * Process a payment
   */
  async processPayment(options: {
    userId: string;
    amount: number;
    currency?: string;
    paymentMethodId: string;
    merchantId: string;
    merchantName: string;
    description: string;
    metadata?: Record<string, unknown>;
  }): Promise<PaymentResult> {
    const { 
      userId, 
      amount, 
      currency = "TWD", 
      paymentMethodId, 
      merchantId, 
      merchantName, 
      description,
      metadata 
    } = options;

    try {
      // Validate amount
      if (amount <= 0) {
        return {
          success: false,
          status: "failed",
          errorCode: "INVALID_AMOUNT",
          errorMessage: "金額必須大於 0",
        };
      }

      // Get payment method
      const methods = await this.getPaymentMethods(userId);
      const method = methods.find(m => m.id === paymentMethodId);
      
      if (!method) {
        return {
          success: false,
          status: "failed",
          errorCode: "INVALID_PAYMENT_METHOD",
          errorMessage: "無效的支付方式",
        };
      }

      if (!method.isAvailable) {
        return {
          success: false,
          status: "failed",
          errorCode: "PAYMENT_METHOD_UNAVAILABLE",
          errorMessage: "此支付方式目前無法使用",
        };
      }

      // Process based on payment method
      let result: PaymentResult;
      
      switch (method.type) {
        case "campus_card":
          result = await this.processCampusCardPayment(userId, amount);
          break;
        case "apple_pay":
          result = await this.processApplePayPayment(amount, merchantName);
          break;
        case "google_pay":
          result = await this.processGooglePayPayment(amount, merchantName);
          break;
        case "line_pay":
          result = await this.processLinePayPayment(userId, amount, description);
          break;
        case "jko_pay":
          result = await this.processJKOPayPayment(userId, amount, description);
          break;
        default:
          result = await this.processCardPayment(userId, amount, paymentMethodId);
      }

      // Create transaction record on success
      if (result.success) {
        await this.createTransaction({
          userId,
          type: "payment",
          amount,
          currency,
          status: result.status,
          paymentMethodId,
          paymentMethod: method.type,
          merchantId,
          merchantName,
          description,
          metadata,
        });
      }

      return result;
    } catch (error) {
      console.error("[Payment] Error processing payment:", error);
      return {
        success: false,
        status: "failed",
        errorCode: "UNKNOWN_ERROR",
        errorMessage: String(error),
      };
    }
  }

  /**
   * Process campus card payment
   */
  private async processCampusCardPayment(
    userId: string,
    amount: number
  ): Promise<PaymentResult> {
    // In real implementation, connect to campus card API
    const balance = await this.getWalletBalance(userId);
    
    if (balance.available < amount) {
      return {
        success: false,
        status: "failed",
        errorCode: "INSUFFICIENT_BALANCE",
        errorMessage: "餘額不足",
      };
    }

    // Simulate processing
    await this.delay(1000);
    
    return {
      success: true,
      transactionId: this.generateTransactionId(),
      status: "completed",
    };
  }

  /**
   * Process Apple Pay payment
   */
  private async processApplePayPayment(
    amount: number,
    merchantName: string
  ): Promise<PaymentResult> {
    // In real implementation, use Stripe Apple Pay or TapPay
    // This would show the Apple Pay sheet
    
    // Simulate processing
    await this.delay(1500);
    
    return {
      success: true,
      transactionId: this.generateTransactionId(),
      status: "completed",
    };
  }

  /**
   * Process Google Pay payment
   */
  private async processGooglePayPayment(
    amount: number,
    merchantName: string
  ): Promise<PaymentResult> {
    // In real implementation, use Stripe Google Pay or TapPay
    
    // Simulate processing
    await this.delay(1500);
    
    return {
      success: true,
      transactionId: this.generateTransactionId(),
      status: "completed",
    };
  }

  /**
   * Process LINE Pay payment
   */
  private async processLinePayPayment(
    userId: string,
    amount: number,
    description: string
  ): Promise<PaymentResult> {
    // In real implementation:
    // 1. Call LINE Pay Reserve API
    // 2. Open LINE Pay app via deep link
    // 3. Handle callback
    
    // Simulate processing
    await this.delay(2000);
    
    return {
      success: true,
      transactionId: this.generateTransactionId(),
      status: "completed",
    };
  }

  /**
   * Process JKO Pay (街口支付) payment
   */
  private async processJKOPayPayment(
    userId: string,
    amount: number,
    description: string
  ): Promise<PaymentResult> {
    // In real implementation:
    // 1. Call JKO Pay API
    // 2. Show JKO QR code or deep link
    // 3. Handle callback
    
    // Simulate processing
    await this.delay(2000);
    
    return {
      success: true,
      transactionId: this.generateTransactionId(),
      status: "completed",
    };
  }

  /**
   * Process card payment via Stripe/TapPay
   */
  private async processCardPayment(
    userId: string,
    amount: number,
    paymentMethodId: string
  ): Promise<PaymentResult> {
    // In real implementation, use Stripe PaymentIntent
    
    // Simulate processing
    await this.delay(2000);
    
    return {
      success: true,
      transactionId: this.generateTransactionId(),
      status: "completed",
    };
  }

  /**
   * Top up wallet balance
   */
  async topUp(options: {
    userId: string;
    amount: number;
    paymentMethodId: string;
  }): Promise<PaymentResult> {
    const { userId, amount, paymentMethodId } = options;

    if (amount < 100) {
      return {
        success: false,
        status: "failed",
        errorCode: "MIN_TOPUP_AMOUNT",
        errorMessage: "最低儲值金額為 NT$100",
      };
    }

    if (amount > 10000) {
      return {
        success: false,
        status: "failed",
        errorCode: "MAX_TOPUP_AMOUNT",
        errorMessage: "單次儲值上限為 NT$10,000",
      };
    }

    // Process top-up payment
    const result = await this.processCardPayment(userId, amount, paymentMethodId);
    
    if (result.success) {
      await this.createTransaction({
        userId,
        type: "topup",
        amount,
        currency: "TWD",
        status: "completed",
        paymentMethodId,
        description: "餘額儲值",
      });
    }

    return result;
  }

  /**
   * Request refund
   */
  async requestRefund(options: {
    userId: string;
    transactionId: string;
    reason: string;
  }): Promise<PaymentResult> {
    const { userId, transactionId, reason } = options;

    // In real implementation:
    // 1. Validate original transaction
    // 2. Check refund eligibility
    // 3. Process refund via payment provider
    // 4. Update transaction status

    // Simulate processing
    await this.delay(1500);

    return {
      success: true,
      transactionId: this.generateTransactionId(),
      status: "refunded",
    };
  }

  /**
   * Get transaction history
   */
  async getTransactionHistory(
    userId: string,
    options?: {
      limit?: number;
      offset?: number;
      type?: TransactionType;
      startDate?: string;
      endDate?: string;
    }
  ): Promise<Transaction[]> {
    const { limit = 20, offset = 0, type, startDate, endDate } = options ?? {};
    
    try {
      const { getFirestore, collection, query, where, orderBy, limit: firestoreLimit, startAfter, getDocs } = await import("firebase/firestore");
      const { getApp } = await import("firebase/app");
      
      const db = getFirestore(getApp());
      const constraints: any[] = [
        where("userId", "==", userId),
        orderBy("createdAt", "desc"),
      ];
      
      if (type) {
        constraints.push(where("type", "==", type));
      }
      
      if (startDate) {
        constraints.push(where("createdAt", ">=", startDate));
      }
      
      if (endDate) {
        constraints.push(where("createdAt", "<=", endDate));
      }
      
      constraints.push(firestoreLimit(limit + offset));
      
      const q = query(collection(db, "transactions"), ...constraints);
      const snapshot = await getDocs(q);
      
      const transactions: Transaction[] = [];
      let idx = 0;
      
      snapshot.forEach((doc) => {
        if (idx >= offset && transactions.length < limit) {
          const data = doc.data();
          transactions.push({
            id: doc.id,
            userId: data.userId,
            type: data.type,
            amount: data.amount,
            currency: data.currency ?? "TWD",
            status: data.status,
            paymentMethodId: data.paymentMethodId,
            paymentMethod: data.paymentMethod,
            merchantId: data.merchantId,
            merchantName: data.merchantName,
            description: data.description,
            reference: data.reference,
            metadata: data.metadata,
            createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? data.createdAt,
            updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? data.updatedAt,
            completedAt: data.completedAt?.toDate?.()?.toISOString?.() ?? data.completedAt,
            errorMessage: data.errorMessage,
          });
        }
        idx++;
      });
      
      return transactions;
    } catch (error) {
      console.warn("[Payment] Failed to fetch from Firebase, using mock data:", error);
      
      const mockTransactions: Transaction[] = [
        {
          id: "txn_1",
          userId,
          type: "payment",
          amount: 85,
          currency: "TWD",
          status: "completed",
          paymentMethod: "campus_card",
          merchantName: "第一學生餐廳",
          description: "雞腿便當",
          createdAt: new Date(Date.now() - 3600000).toISOString(),
          completedAt: new Date(Date.now() - 3600000).toISOString(),
        },
        {
          id: "txn_2",
          userId,
          type: "payment",
          amount: 45,
          currency: "TWD",
          status: "completed",
          paymentMethod: "campus_card",
          merchantName: "7-11 校園店",
          description: "飲料",
          createdAt: new Date(Date.now() - 86400000).toISOString(),
          completedAt: new Date(Date.now() - 86400000).toISOString(),
        },
        {
          id: "txn_3",
          userId,
          type: "topup",
          amount: 500,
          currency: "TWD",
          status: "completed",
          paymentMethod: "credit_card",
          description: "餘額儲值",
          createdAt: new Date(Date.now() - 172800000).toISOString(),
          completedAt: new Date(Date.now() - 172800000).toISOString(),
        },
      ];

      let filtered = mockTransactions;
      if (type) {
        filtered = filtered.filter(t => t.type === type);
      }
      
      return filtered.slice(offset, offset + limit);
    }
  }

  /**
   * Create transaction record
   */
  private async createTransaction(data: Omit<Transaction, "id" | "createdAt">): Promise<string> {
    try {
      const { getFirestore, collection, addDoc, serverTimestamp } = await import("firebase/firestore");
      const { getApp } = await import("firebase/app");
      
      const db = getFirestore(getApp());
      const docRef = await addDoc(collection(db, "transactions"), {
        ...data,
        createdAt: serverTimestamp(),
      });
      
      console.log("[Payment] Transaction created:", docRef.id);
      return docRef.id;
    } catch (error) {
      console.warn("[Payment] Failed to save transaction to Firebase:", error);
      return this.generateTransactionId();
    }
  }

  /**
   * Generate unique transaction ID
   */
  private generateTransactionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `txn_${timestamp}_${random}`;
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const paymentService = new PaymentService();

// Payment utilities
export function formatCurrency(amount: number, currency: string = "TWD"): string {
  const formatter = new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return formatter.format(amount);
}

export function getPaymentMethodIcon(type: PaymentMethod): string {
  const icons: Record<PaymentMethod, string> = {
    campus_card: "card",
    apple_pay: "logo-apple",
    google_pay: "logo-google",
    credit_card: "card-outline",
    debit_card: "card-outline",
    line_pay: "chatbubble",
    jko_pay: "wallet",
    taiwan_pay: "scan",
  };
  return icons[type] ?? "card";
}

export function getPaymentMethodDisplayName(type: PaymentMethod): string {
  const names: Record<PaymentMethod, string> = {
    campus_card: "學生證",
    apple_pay: "Apple Pay",
    google_pay: "Google Pay",
    credit_card: "信用卡",
    debit_card: "金融卡",
    line_pay: "LINE Pay",
    jko_pay: "街口支付",
    taiwan_pay: "台灣 Pay",
  };
  return names[type] ?? "其他";
}

export function getTransactionStatusText(status: PaymentStatus): string {
  const texts: Record<PaymentStatus, string> = {
    pending: "處理中",
    processing: "付款中",
    completed: "已完成",
    failed: "失敗",
    cancelled: "已取消",
    refunded: "已退款",
  };
  return texts[status] ?? "未知";
}

export function getTransactionStatusColor(status: PaymentStatus): string {
  const colors: Record<PaymentStatus, string> = {
    pending: "#F59E0B",
    processing: "#3B82F6",
    completed: "#22C55E",
    failed: "#EF4444",
    cancelled: "#6B7280",
    refunded: "#8B5CF6",
  };
  return colors[status] ?? "#6B7280";
}
