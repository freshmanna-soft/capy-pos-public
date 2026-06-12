import { Injectable, inject } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { BaseAgent } from '@app/agents/base/base-agent';
import { IAgentMessage, IAgentResponse } from '@app/agents/base/base-agent.interface';
import { IPaymentRepository } from '@core/domain/interfaces/payment.repository.interface';
import { PAYMENT_REPOSITORY } from '@core/infrastructure/factories/repository.factory';
import { AuditLogService, AuditAction, AuditStatus } from '@core/infrastructure/audit';
import {
  IPaymentAgent,
  ProcessPaymentRequest,
  ProcessPaymentResponse,
  ValidatePaymentRequest,
  ValidatePaymentResponse,
  ProcessRefundRequest,
  ProcessRefundResponse,
  VoidPaymentRequest,
  VoidPaymentResponse,
  GetPaymentStatusRequest,
  GetPaymentStatusResponse,
  GetPaymentHistoryRequest,
  GetPaymentHistoryResponse,
  ReconcilePaymentsRequest,
  ReconcilePaymentsResponse,
  GeneratePaymentReportRequest,
  GeneratePaymentReportResponse,
  PaymentEvent,
  PaymentDiscrepancy,
  PaymentReport,
} from '@app/agents/payment/domain/payment-agent.interface';
import { Payment, PaymentMethod, PaymentStatus } from '@core/domain/entities/payment.entity';
import { PaymentBuilder } from '@core/domain/entities/payment.builder';

/**
 * Payment Agent
 * Handles payment processing, validation, and reconciliation
 *
 * Features:
 * - Multiple payment method support
 * - Payment validation
 * - Refund processing
 * - Payment voiding
 * - Payment history tracking
 * - Reconciliation
 * - Reporting and analytics
 * - Real-time payment events
 */
@Injectable({
  providedIn: 'root',
})
export class PaymentAgent extends BaseAgent implements IPaymentAgent {
  private readonly paymentRepository = inject<IPaymentRepository>(PAYMENT_REPOSITORY);
  private readonly auditLog = inject(AuditLogService);

  private readonly paymentEventsSubject = new Subject<PaymentEvent>();
  public readonly paymentEvents$: Observable<PaymentEvent> =
    this.paymentEventsSubject.asObservable();

  constructor() {
    super(
      'payment-agent',
      'PaymentAgent',
      'Handles payment processing, validation, and reconciliation'
    );
  }

  /**
   * Initialize agent
   */
  protected async onInitialize(): Promise<void> {
    console.log('Initializing PaymentAgent');
    // Load payment configuration
    // Initialize payment gateways
    // Set up payment processors
  }

  /**
   * Start agent
   */
  protected async onStart(): Promise<void> {
    console.log('Starting PaymentAgent');
    // Start payment monitoring
    // Connect to payment gateways
  }

  /**
   * Stop agent
   */
  protected async onStop(): Promise<void> {
    console.log('Stopping PaymentAgent');
    // Disconnect from payment gateways
    // Complete pending payments
    this.paymentEventsSubject.complete();
  }

  /**
   * Handle incoming messages
   */
  protected async handleMessage(message: IAgentMessage): Promise<IAgentResponse> {
    console.log('PaymentAgent received message', { type: message.type });

    switch (message.type) {
      case 'PROCESS_PAYMENT':
        return {
          success: true,
          data: await this.processPayment(message.payload as ProcessPaymentRequest),
        };
      case 'VALIDATE_PAYMENT':
        return {
          success: true,
          data: await this.validatePayment(message.payload as ValidatePaymentRequest),
        };
      case 'PROCESS_REFUND':
        return {
          success: true,
          data: await this.processRefund(message.payload as ProcessRefundRequest),
        };
      case 'VOID_PAYMENT':
        return {
          success: true,
          data: await this.voidPayment(message.payload as VoidPaymentRequest),
        };
      case 'GET_PAYMENT_STATUS':
        return {
          success: true,
          data: await this.getPaymentStatus(message.payload as GetPaymentStatusRequest),
        };
      case 'GET_PAYMENT_HISTORY':
        return {
          success: true,
          data: await this.getPaymentHistory(message.payload as GetPaymentHistoryRequest),
        };
      case 'RECONCILE_PAYMENTS':
        return {
          success: true,
          data: await this.reconcilePayments(message.payload as ReconcilePaymentsRequest),
        };
      case 'GENERATE_PAYMENT_REPORT':
        return {
          success: true,
          data: await this.generatePaymentReport(message.payload as GeneratePaymentReportRequest),
        };
      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }

  /**
   * Process a payment
   */
  async processPayment(request: ProcessPaymentRequest): Promise<ProcessPaymentResponse> {
    const startTime = Date.now();
    try {
      console.log('Processing payment', {
        transactionId: request.transactionId,
        amount: request.amount,
        method: request.method,
      });

      // Validate payment request
      const validation = await this.validatePayment({
        method: request.method,
        amount: request.amount,
        cardNumber: request.cardNumber,
        expiryMonth: request.expiryMonth,
        expiryYear: request.expiryYear,
        cvv: request.cvv,
        walletToken: request.walletToken,
        accountNumber: request.accountNumber,
        routingNumber: request.routingNumber,
      });

      if (!validation.valid) {
        return {
          success: false,
          error: `Payment validation failed: ${validation.errors.join(', ')}`,
        };
      }

      // Create payment entity
      const paymentId = this.generatePaymentId();
      const payment = new PaymentBuilder()
        .withId(paymentId)
        .withOrderId(request.transactionId)
        .withAmount(request.amount)
        .withMethod(request.method)
        .withStatus(PaymentStatus.PENDING)
        .build();

      // Process based on payment method
      let authorizationCode: string | undefined;
      let transactionReference: string | undefined;

      try {
        payment.markAsProcessing();

        switch (request.method) {
          case PaymentMethod.CASH:
            authorizationCode = await this.processCashPayment(payment, request);
            break;
          case PaymentMethod.CREDIT_CARD:
          case PaymentMethod.DEBIT_CARD:
            authorizationCode = await this.processCardPayment(payment, request);
            break;
          case PaymentMethod.DIGITAL_WALLET:
            authorizationCode = await this.processWalletPayment(payment, request);
            break;
          case PaymentMethod.GIFT_CARD:
            authorizationCode = await this.processGiftCardPayment(payment, request);
            break;
          default:
            throw new Error(`Unsupported payment method: ${request.method}`);
        }

        payment.markAsCompleted();
        transactionReference = this.generateTransactionReference();

        // Store payment in repository
        await this.paymentRepository.create(payment);

        // Emit payment event
        this.emitPaymentEvent({
          type: 'payment_processed',
          timestamp: new Date(),
          paymentId,
          transactionId: request.transactionId,
          amount: request.amount,
          method: request.method,
          status: PaymentStatus.COMPLETED,
        });

        console.log('Payment processed successfully', { paymentId });

        // Audit log successful payment
        await this.auditLog.log({
          agentName: this.name,
          operation: 'processPayment',
          entityType: 'Payment',
          entityId: paymentId,
          action: AuditAction.CREATE,
          status: AuditStatus.SUCCESS,
          duration: Date.now() - startTime,
          metadata: {
            transactionId: request.transactionId,
            amount: request.amount,
            method: request.method,
            authorizationCode,
            transactionReference,
          },
        });

        return {
          success: true,
          payment,
          authorizationCode,
          transactionReference,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        payment.markAsFailed(errorMessage);
        await this.paymentRepository.create(payment);

        this.emitPaymentEvent({
          type: 'payment_failed',
          timestamp: new Date(),
          paymentId,
          transactionId: request.transactionId,
          amount: request.amount,
          method: request.method,
          status: PaymentStatus.FAILED,
          metadata: { error: errorMessage },
        });

        throw error;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Payment processing failed', error);

      // Audit log failed payment
      await this.auditLog.log({
        agentName: this.name,
        operation: 'processPayment',
        entityType: 'Payment',
        entityId: request.transactionId,
        action: AuditAction.CREATE,
        status: AuditStatus.FAILURE,
        duration: Date.now() - startTime,
        errorMessage,
        metadata: {
          transactionId: request.transactionId,
          amount: request.amount,
          method: request.method,
        },
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Validate payment information
   */
  async validatePayment(request: ValidatePaymentRequest): Promise<ValidatePaymentResponse> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate amount
    if (request.amount <= 0) {
      errors.push('Payment amount must be greater than 0');
    }

    // Validate based on payment method
    switch (request.method) {
      case PaymentMethod.CREDIT_CARD:
      case PaymentMethod.DEBIT_CARD:
        this.validateCardPayment(request, errors, warnings);
        break;
      case PaymentMethod.DIGITAL_WALLET:
        this.validateWalletPayment(request, errors);
        break;
      case PaymentMethod.CASH:
        // Cash payments don't need additional validation
        break;
      case PaymentMethod.GIFT_CARD:
        // Gift card validation would go here
        break;
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Process a refund
   */
  async processRefund(request: ProcessRefundRequest): Promise<ProcessRefundResponse> {
    const startTime = Date.now();
    try {
      console.log('Processing refund', {
        paymentId: request.paymentId,
        amount: request.amount,
      });

      const payment = await this.paymentRepository.findById(request.paymentId);
      if (!payment) {
        return {
          success: false,
          error: 'Payment not found',
        };
      }

      if (!payment.isRefundable()) {
        return {
          success: false,
          error: 'Payment is not refundable',
        };
      }

      if (request.amount > payment.getRefundableAmount()) {
        return {
          success: false,
          error: `Refund amount exceeds refundable amount (${payment.getRefundableAmount()})`,
        };
      }

      // Process refund through payment gateway
      const refundReference = await this.processRefundWithGateway(payment, request.amount);

      // Update payment
      payment.refund(request.amount);
      await this.paymentRepository.update(payment.id, payment);

      // Create refund payment record
      const refundPaymentId = this.generatePaymentId();
      const refundPayment = new PaymentBuilder()
        .withId(refundPaymentId)
        .withOrderId(payment.orderId)
        .withAmount(request.amount)
        .withMethod(payment.method)
        .withStatus(PaymentStatus.COMPLETED)
        .build();
      await this.paymentRepository.create(refundPayment);

      // Emit refund event
      this.emitPaymentEvent({
        type: 'payment_refunded',
        timestamp: new Date(),
        paymentId: request.paymentId,
        transactionId: payment.orderId,
        amount: request.amount,
        method: payment.method,
        status: payment.status,
        metadata: { reason: request.reason },
      });

      console.log('Refund processed successfully', {
        paymentId: request.paymentId,
        refundPaymentId,
      });

      // Audit log successful refund
      await this.auditLog.log({
        agentName: this.name,
        operation: 'processRefund',
        entityType: 'Payment',
        entityId: request.paymentId,
        action: AuditAction.REFUND,
        status: AuditStatus.SUCCESS,
        duration: Date.now() - startTime,
        metadata: {
          refundPaymentId,
          refundAmount: request.amount,
          reason: request.reason,
          refundReference,
        },
      });

      return {
        success: true,
        refundPayment,
        refundReference,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Refund processing failed', error);

      // Audit log failed refund
      await this.auditLog.log({
        agentName: this.name,
        operation: 'processRefund',
        entityType: 'Payment',
        entityId: request.paymentId,
        action: AuditAction.REFUND,
        status: AuditStatus.FAILURE,
        duration: Date.now() - startTime,
        errorMessage,
        metadata: {
          refundAmount: request.amount,
          reason: request.reason,
        },
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Void a payment
   */
  async voidPayment(request: VoidPaymentRequest): Promise<VoidPaymentResponse> {
    const startTime = Date.now();
    try {
      console.log('Voiding payment', { paymentId: request.paymentId });

      const payment = await this.paymentRepository.findById(request.paymentId);
      if (!payment) {
        return {
          success: false,
          error: 'Payment not found',
        };
      }

      if (payment.status !== PaymentStatus.PENDING && payment.status !== PaymentStatus.PROCESSING) {
        return {
          success: false,
          error: 'Can only void pending or processing payments',
        };
      }

      // Void payment through gateway
      await this.voidPaymentWithGateway(payment);

      // Update payment status
      payment.markAsFailed(`Voided: ${request.reason}`);
      await this.paymentRepository.update(payment.id, payment);

      // Emit void event
      this.emitPaymentEvent({
        type: 'payment_voided',
        timestamp: new Date(),
        paymentId: request.paymentId,
        transactionId: payment.orderId,
        amount: payment.amount,
        method: payment.method,
        status: payment.status,
        metadata: { reason: request.reason },
      });

      console.log('Payment voided successfully', { paymentId: request.paymentId });

      // Audit log successful void
      await this.auditLog.log({
        agentName: this.name,
        operation: 'voidPayment',
        entityType: 'Payment',
        entityId: request.paymentId,
        action: AuditAction.VOID,
        status: AuditStatus.SUCCESS,
        duration: Date.now() - startTime,
        metadata: {
          reason: request.reason,
        },
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Payment void failed', error);

      // Audit log failed void
      await this.auditLog.log({
        agentName: this.name,
        operation: 'voidPayment',
        entityType: 'Payment',
        entityId: request.paymentId,
        action: AuditAction.VOID,
        status: AuditStatus.FAILURE,
        duration: Date.now() - startTime,
        errorMessage,
        metadata: {
          reason: request.reason,
        },
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(request: GetPaymentStatusRequest): Promise<GetPaymentStatusResponse> {
    const payment = await this.paymentRepository.findById(request.paymentId);
    if (!payment) {
      throw new Error('Payment not found');
    }

    return {
      payment,
      status: payment.status,
      lastUpdated: payment.updatedAt,
    };
  }

  /**
   * Get payment history
   */
  async getPaymentHistory(request: GetPaymentHistoryRequest): Promise<GetPaymentHistoryResponse> {
    let payments: Payment[];

    // Use repository methods for efficient querying
    if (request.transactionId) {
      payments = await this.paymentRepository.findByTransactionId(request.transactionId);
    } else if (request.status) {
      payments = await this.paymentRepository.findByStatus(request.status);
    } else if (request.method) {
      payments = await this.paymentRepository.findByMethod(request.method);
    } else if (request.startDate && request.endDate) {
      payments = await this.paymentRepository.findByDateRange(request.startDate, request.endDate);
    } else {
      payments = await this.paymentRepository.findAll();
    }

    // Apply additional filters
    if (request.customerId) {
      const customerPayments = await this.paymentRepository.findByCustomerId(request.customerId);
      const customerPaymentIds = new Set(customerPayments.map((p) => p.id));
      payments = payments.filter((p) => customerPaymentIds.has(p.id));
    }

    // Sort by date (newest first)
    payments.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = payments.length;
    const offset = request.offset || 0;
    const limit = request.limit || 50;
    const paginatedPayments = payments.slice(offset, offset + limit);

    return {
      payments: paginatedPayments,
      total,
      hasMore: offset + limit < total,
    };
  }

  /**
   * Reconcile payments
   */
  async reconcilePayments(request: ReconcilePaymentsRequest): Promise<ReconcilePaymentsResponse> {
    const startOfDay = new Date(request.date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(request.date);
    endOfDay.setHours(23, 59, 59, 999);

    let payments = await this.paymentRepository.findByDateRange(startOfDay, endOfDay);

    // Filter by method if specified
    if (request.method) {
      payments = payments.filter((p) => p.method === request.method);
    }

    const totalPayments = payments.length;
    const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);
    const successfulPayments = payments.filter((p) => p.status === PaymentStatus.COMPLETED).length;
    const failedPayments = payments.filter((p) => p.status === PaymentStatus.FAILED).length;
    const refundedPayments = payments.filter(
      (p) => p.status === PaymentStatus.REFUNDED || p.status === PaymentStatus.PARTIALLY_REFUNDED
    ).length;
    const voidedPayments = payments.filter(
      (p) => p.status === PaymentStatus.FAILED && p.failureReason?.includes('Voided')
    ).length;

    // Check for discrepancies
    const discrepancies: PaymentDiscrepancy[] = [];
    // Add discrepancy detection logic here

    return {
      totalPayments,
      totalAmount,
      successfulPayments,
      failedPayments,
      refundedPayments,
      voidedPayments,
      discrepancies,
    };
  }

  /**
   * Generate payment report
   */
  async generatePaymentReport(
    request: GeneratePaymentReportRequest
  ): Promise<GeneratePaymentReportResponse> {
    const payments = await this.paymentRepository.findByDateRange(
      request.startDate,
      request.endDate
    );

    // Calculate summary
    const totalPayments = payments.length;
    const totalAmount = payments.reduce((sum, p) => (p.amount > 0 ? sum + p.amount : sum), 0);
    const averageAmount = totalPayments > 0 ? totalAmount / totalPayments : 0;
    const successfulPayments = payments.filter((p) => p.status === PaymentStatus.COMPLETED).length;
    const successRate = totalPayments > 0 ? (successfulPayments / totalPayments) * 100 : 0;

    // Group by method
    const byMethod: Record<PaymentMethod, { count: number; amount: number; percentage: number }> = {
      [PaymentMethod.CASH]: { count: 0, amount: 0, percentage: 0 },
      [PaymentMethod.CREDIT_CARD]: { count: 0, amount: 0, percentage: 0 },
      [PaymentMethod.DEBIT_CARD]: { count: 0, amount: 0, percentage: 0 },
      [PaymentMethod.DIGITAL_WALLET]: { count: 0, amount: 0, percentage: 0 },
      [PaymentMethod.GIFT_CARD]: { count: 0, amount: 0, percentage: 0 },
    };

    payments.forEach((p) => {
      if (p.amount > 0) {
        byMethod[p.method].count++;
        byMethod[p.method].amount += p.amount;
      }
    });

    Object.values(byMethod).forEach((method) => {
      method.percentage = totalAmount > 0 ? (method.amount / totalAmount) * 100 : 0;
    });

    // Group by status
    const byStatus: Record<PaymentStatus, { count: number; amount: number }> = {
      [PaymentStatus.PENDING]: { count: 0, amount: 0 },
      [PaymentStatus.PROCESSING]: { count: 0, amount: 0 },
      [PaymentStatus.COMPLETED]: { count: 0, amount: 0 },
      [PaymentStatus.FAILED]: { count: 0, amount: 0 },
      [PaymentStatus.REFUNDED]: { count: 0, amount: 0 },
      [PaymentStatus.PARTIALLY_REFUNDED]: { count: 0, amount: 0 },
    };

    payments.forEach((p) => {
      byStatus[p.status].count++;
      byStatus[p.status].amount += Math.abs(p.amount);
    });

    // Calculate refunds
    const refundPayments = payments.filter((p) => p.amount < 0);
    const refunds = {
      count: refundPayments.length,
      amount: Math.abs(refundPayments.reduce((sum, p) => sum + p.amount, 0)),
    };

    // Calculate voids
    const voidPayments = payments.filter(
      (p) => p.status === PaymentStatus.FAILED && p.failureReason?.includes('Voided')
    );
    const voids = {
      count: voidPayments.length,
    };

    const report: PaymentReport = {
      period: {
        start: request.startDate,
        end: request.endDate,
      },
      summary: {
        totalPayments,
        totalAmount,
        averageAmount,
        successRate,
      },
      byMethod,
      byStatus,
      refunds,
      voids,
    };

    return { report };
  }

  /**
   * Private helper methods
   */

  private async processCashPayment(
    _payment: Payment,
    _request: ProcessPaymentRequest
  ): Promise<string> {
    // Cash payments are immediately successful
    return 'CASH-' + Date.now();
  }

  private async processCardPayment(
    payment: Payment,
    request: ProcessPaymentRequest
  ): Promise<string> {
    // Simulate card processing
    // In production, integrate with payment gateway (Stripe, Square, etc.)
    await this.delay(1000);

    if (request.cardNumber) {
      payment.cardLast4 = request.cardNumber.slice(-4);
      payment.cardBrand = this.detectCardBrand(request.cardNumber);
    }

    return 'AUTH-' + Date.now();
  }

  private async processWalletPayment(
    _payment: Payment,
    _request: ProcessPaymentRequest
  ): Promise<string> {
    // Simulate wallet processing
    await this.delay(800);
    return 'WALLET-' + Date.now();
  }

  private async processGiftCardPayment(
    _payment: Payment,
    _request: ProcessPaymentRequest
  ): Promise<string> {
    // Simulate gift card processing
    await this.delay(500);
    return 'GIFT-' + Date.now();
  }

  private async processRefundWithGateway(_payment: Payment, _amount: number): Promise<string> {
    // Simulate refund processing with gateway
    await this.delay(1000);
    return 'REFUND-' + Date.now();
  }

  private async voidPaymentWithGateway(_payment: Payment): Promise<void> {
    // Simulate void processing with gateway
    await this.delay(500);
  }

  private validateCardPayment(
    request: ValidatePaymentRequest,
    errors: string[],
    warnings: string[]
  ): void {
    if (!request.cardNumber) {
      errors.push('Card number is required');
    } else {
      if (!this.isValidCardNumber(request.cardNumber)) {
        errors.push('Invalid card number');
      }
    }

    if (!request.expiryMonth || !request.expiryYear) {
      errors.push('Card expiry date is required');
    } else {
      const now = new Date();
      const expiryDate = new Date(request.expiryYear, request.expiryMonth - 1);
      if (expiryDate < now) {
        errors.push('Card has expired');
      } else if (expiryDate.getTime() - now.getTime() < 30 * 24 * 60 * 60 * 1000) {
        warnings.push('Card expires soon');
      }
    }

    if (!request.cvv) {
      errors.push('CVV is required');
    } else if (!/^\d{3,4}$/.test(request.cvv)) {
      errors.push('Invalid CVV format');
    }
  }

  private validateWalletPayment(request: ValidatePaymentRequest, errors: string[]): void {
    if (!request.walletToken) {
      errors.push('Wallet token is required');
    }
  }

  private isValidCardNumber(cardNumber: string): boolean {
    // Luhn algorithm for card validation
    const digits = cardNumber.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) return false;

    let sum = 0;
    let isEven = false;

    for (let i = digits.length - 1; i >= 0; i--) {
      let digit = parseInt(digits[i]);

      if (isEven) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }

      sum += digit;
      isEven = !isEven;
    }

    return sum % 10 === 0;
  }

  private detectCardBrand(cardNumber: string): string {
    const digits = cardNumber.replace(/\D/g, '');

    if (/^4/.test(digits)) return 'Visa';
    if (/^5[1-5]/.test(digits)) return 'Mastercard';
    if (/^3[47]/.test(digits)) return 'American Express';
    if (/^6(?:011|5)/.test(digits)) return 'Discover';

    return 'Unknown';
  }

  private generatePaymentId(): string {
    return `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateTransactionReference(): string {
    return `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private emitPaymentEvent(event: PaymentEvent): void {
    this.paymentEventsSubject.next(event);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Made with Bob
