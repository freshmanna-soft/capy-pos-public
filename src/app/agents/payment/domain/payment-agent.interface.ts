import { Observable } from 'rxjs';
import { IBaseAgent } from '../../base/base-agent.interface';
import { Payment, PaymentStatus, PaymentMethod } from '../../../core/domain/entities/payment.entity';

/**
 * Payment Agent Interface
 * Handles payment processing, validation, and reconciliation
 * 
 * Responsibilities:
 * - Process payments through various methods
 * - Validate payment information
 * - Handle refunds and voids
 * - Track payment status
 * - Generate payment reports
 * - Reconcile payments
 */
export interface IPaymentAgent extends IBaseAgent {
  /**
   * Process a payment
   */
  processPayment(request: ProcessPaymentRequest): Promise<ProcessPaymentResponse>;

  /**
   * Validate payment information
   */
  validatePayment(request: ValidatePaymentRequest): Promise<ValidatePaymentResponse>;

  /**
   * Process a refund
   */
  processRefund(request: ProcessRefundRequest): Promise<ProcessRefundResponse>;

  /**
   * Void a payment
   */
  voidPayment(request: VoidPaymentRequest): Promise<VoidPaymentResponse>;

  /**
   * Get payment status
   */
  getPaymentStatus(request: GetPaymentStatusRequest): Promise<GetPaymentStatusResponse>;

  /**
   * Get payment history
   */
  getPaymentHistory(request: GetPaymentHistoryRequest): Promise<GetPaymentHistoryResponse>;

  /**
   * Reconcile payments
   */
  reconcilePayments(request: ReconcilePaymentsRequest): Promise<ReconcilePaymentsResponse>;

  /**
   * Generate payment report
   */
  generatePaymentReport(request: GeneratePaymentReportRequest): Promise<GeneratePaymentReportResponse>;

  /**
   * Observable stream of payment events
   */
  paymentEvents$: Observable<PaymentEvent>;
}

/**
 * Process Payment Request
 */
export interface ProcessPaymentRequest {
  transactionId: string;
  amount: number;
  method: PaymentMethod;
  customerId?: string;
  metadata?: Record<string, any>;
  // Card payment fields
  cardNumber?: string;
  cardholderName?: string;
  expiryMonth?: number;
  expiryYear?: number;
  cvv?: string;
  // Digital wallet fields
  walletToken?: string;
  walletProvider?: string;
  // Bank transfer fields
  accountNumber?: string;
  routingNumber?: string;
  // Check fields
  checkNumber?: string;
}

/**
 * Process Payment Response
 */
export interface ProcessPaymentResponse {
  success: boolean;
  payment?: Payment;
  error?: string;
  authorizationCode?: string;
  transactionReference?: string;
}

/**
 * Validate Payment Request
 */
export interface ValidatePaymentRequest {
  method: PaymentMethod;
  amount: number;
  // Card validation
  cardNumber?: string;
  expiryMonth?: number;
  expiryYear?: number;
  cvv?: string;
  // Wallet validation
  walletToken?: string;
  // Bank validation
  accountNumber?: string;
  routingNumber?: string;
}

/**
 * Validate Payment Response
 */
export interface ValidatePaymentResponse {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

/**
 * Process Refund Request
 */
export interface ProcessRefundRequest {
  paymentId: string;
  amount: number;
  reason: string;
  metadata?: Record<string, any>;
}

/**
 * Process Refund Response
 */
export interface ProcessRefundResponse {
  success: boolean;
  refundPayment?: Payment;
  error?: string;
  refundReference?: string;
}

/**
 * Void Payment Request
 */
export interface VoidPaymentRequest {
  paymentId: string;
  reason: string;
}

/**
 * Void Payment Response
 */
export interface VoidPaymentResponse {
  success: boolean;
  error?: string;
}

/**
 * Get Payment Status Request
 */
export interface GetPaymentStatusRequest {
  paymentId: string;
}

/**
 * Get Payment Status Response
 */
export interface GetPaymentStatusResponse {
  payment: Payment;
  status: PaymentStatus;
  lastUpdated: Date;
}

/**
 * Get Payment History Request
 */
export interface GetPaymentHistoryRequest {
  transactionId?: string;
  customerId?: string;
  startDate?: Date;
  endDate?: Date;
  status?: PaymentStatus;
  method?: PaymentMethod;
  limit?: number;
  offset?: number;
}

/**
 * Get Payment History Response
 */
export interface GetPaymentHistoryResponse {
  payments: Payment[];
  total: number;
  hasMore: boolean;
}

/**
 * Reconcile Payments Request
 */
export interface ReconcilePaymentsRequest {
  date: Date;
  method?: PaymentMethod;
}

/**
 * Reconcile Payments Response
 */
export interface ReconcilePaymentsResponse {
  totalPayments: number;
  totalAmount: number;
  successfulPayments: number;
  failedPayments: number;
  refundedPayments: number;
  voidedPayments: number;
  discrepancies: PaymentDiscrepancy[];
}

/**
 * Payment Discrepancy
 */
export interface PaymentDiscrepancy {
  paymentId: string;
  type: 'missing' | 'duplicate' | 'amount_mismatch' | 'status_mismatch';
  description: string;
  expectedAmount?: number;
  actualAmount?: number;
}

/**
 * Generate Payment Report Request
 */
export interface GeneratePaymentReportRequest {
  startDate: Date;
  endDate: Date;
  groupBy?: 'day' | 'week' | 'month' | 'method' | 'status';
  includeRefunds?: boolean;
  includeVoids?: boolean;
}

/**
 * Generate Payment Report Response
 */
export interface GeneratePaymentReportResponse {
  report: PaymentReport;
}

/**
 * Payment Report
 */
export interface PaymentReport {
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    totalPayments: number;
    totalAmount: number;
    averageAmount: number;
    successRate: number;
  };
  byMethod: Record<PaymentMethod, {
    count: number;
    amount: number;
    percentage: number;
  }>;
  byStatus: Record<PaymentStatus, {
    count: number;
    amount: number;
  }>;
  refunds: {
    count: number;
    amount: number;
  };
  voids: {
    count: number;
  };
  trends?: Array<{
    date: Date;
    count: number;
    amount: number;
  }>;
}

/**
 * Payment Event Types
 */
export type PaymentEventType =
  | 'payment_processed'
  | 'payment_failed'
  | 'payment_refunded'
  | 'payment_voided'
  | 'payment_authorized'
  | 'payment_captured'
  | 'payment_declined';

/**
 * Payment Event
 */
export interface PaymentEvent {
  type: PaymentEventType;
  timestamp: Date;
  paymentId: string;
  transactionId?: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  metadata?: Record<string, any>;
}

// Made with Bob