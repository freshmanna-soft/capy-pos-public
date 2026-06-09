import { TestBed } from '@angular/core/testing';
import { PaymentAgent } from '@app/agents/payment/infrastructure/payment.agent';
import { PaymentMethod, PaymentStatus, Payment } from '@core/domain/entities/payment.entity';
import { AgentStatus } from '@app/agents/base/base-agent.interface';
import { PAYMENT_REPOSITORY } from '@core/infrastructure/factories/repository.factory';
import { AuditLogService } from '@core/infrastructure/audit/audit-log.service';
import type { IPaymentRepository } from '@core/domain/interfaces/payment.repository.interface';

// In-memory store for mock repository
let paymentStore: Payment[] = [];

// Mock payment repository with in-memory tracking
const mockPaymentRepository: Partial<IPaymentRepository> = {
  findAll: vi.fn().mockImplementation(() => Promise.resolve([...paymentStore])),
  findById: vi.fn().mockImplementation((id: string) => {
    const found = paymentStore.find((p) => p.id === id);
    return Promise.resolve(found || null);
  }),
  findByTransactionId: vi.fn().mockImplementation((txnId: string) => {
    return Promise.resolve(paymentStore.filter((p) => p.orderId === txnId));
  }),
  findByStatus: vi.fn().mockImplementation((status: PaymentStatus) => {
    return Promise.resolve(paymentStore.filter((p) => p.status === status));
  }),
  findByMethod: vi.fn().mockImplementation((method: PaymentMethod) => {
    return Promise.resolve(paymentStore.filter((p) => p.method === method));
  }),
  findByDateRange: vi.fn().mockResolvedValue([]),
  findByCustomerId: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockImplementation((payment: Payment) => {
    paymentStore.push(payment);
    return Promise.resolve(payment);
  }),
  update: vi.fn().mockImplementation((id: string, payment: Payment) => {
    const index = paymentStore.findIndex((p) => p.id === id);
    if (index >= 0) paymentStore[index] = payment;
    return Promise.resolve(payment);
  }),
  delete: vi.fn().mockResolvedValue(undefined),
};

describe('PaymentAgent', () => {
  let agent: PaymentAgent;
  let auditLogService: AuditLogService;

  beforeEach(() => {
    // Reset mocks and payment store
    vi.clearAllMocks();
    paymentStore = [];

    // Reset TestBed to ensure clean state
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      providers: [
        PaymentAgent,
        AuditLogService,
        {
          provide: PAYMENT_REPOSITORY,
          useValue: mockPaymentRepository,
        },
      ],
    });

    // Get instances via DI
    auditLogService = TestBed.inject(AuditLogService);
    agent = TestBed.inject(PaymentAgent);
  });

  afterEach(async () => {
    if (agent.status !== AgentStatus.IDLE) {
      await agent.stop();
    }
    // Clean up audit log database
    if (auditLogService) {
      await auditLogService.clearAll();
    }
  });

  describe('Initialization', () => {
    it('should create payment agent', () => {
      expect(agent).toBeDefined();
      expect(agent.id).toBe('payment-agent');
      expect(agent.name).toBe('PaymentAgent');
    });

    it('should initialize successfully', async () => {
      await agent.initialize();
      const health = await agent.getHealth();
      expect(health.healthy).toBe(true);
    });
  });

  describe('Payment Processing', () => {
    beforeEach(async () => {
      await agent.initialize();
      await agent.start();
    });

    it('should process cash payment', async () => {
      const request = {
        transactionId: 'txn-1',
        amount: 100,
        method: PaymentMethod.CASH,
      };

      const response = await agent.processPayment(request);
      expect(response.success).toBe(true);
      expect(response.payment).toBeDefined();
      expect(response.payment?.status).toBe(PaymentStatus.COMPLETED);
    });

    it('should process card payment', async () => {
      const request = {
        transactionId: 'txn-2',
        amount: 150,
        method: PaymentMethod.CREDIT_CARD,
        cardNumber: '4532015112830366',
        cardholderName: 'John Doe',
        expiryMonth: 12,
        expiryYear: new Date().getFullYear() + 1,
        cvv: '123',
      };

      const response = await agent.processPayment(request);
      expect(response.success).toBe(true);
      expect(response.payment?.cardLast4).toBe('0366');
      expect(response.authorizationCode).toBeDefined();
    });

    it('should reject invalid payment amount', async () => {
      const request = {
        transactionId: 'txn-3',
        amount: -50,
        method: PaymentMethod.CASH,
      };

      const response = await agent.processPayment(request);
      expect(response.success).toBe(false);
      expect(response.error).toContain('amount');
    });
  });

  describe('Payment Validation', () => {
    beforeEach(async () => {
      await agent.initialize();
      await agent.start();
    });

    it('should validate valid card payment', async () => {
      const request = {
        method: PaymentMethod.CREDIT_CARD,
        amount: 100,
        cardNumber: '4532015112830366',
        expiryMonth: 12,
        expiryYear: new Date().getFullYear() + 1,
        cvv: '123',
      };

      const response = await agent.validatePayment(request);
      expect(response.valid).toBe(true);
      expect(response.errors.length).toBe(0);
    });

    it('should reject invalid card number', async () => {
      const request = {
        method: PaymentMethod.CREDIT_CARD,
        amount: 100,
        cardNumber: '1234567890123456',
        expiryMonth: 12,
        expiryYear: new Date().getFullYear() + 1,
        cvv: '123',
      };

      const response = await agent.validatePayment(request);
      expect(response.valid).toBe(false);
      expect(response.errors).toContain('Invalid card number');
    });

    it('should reject expired card', async () => {
      const request = {
        method: PaymentMethod.CREDIT_CARD,
        amount: 100,
        cardNumber: '4532015112830366',
        expiryMonth: 1,
        expiryYear: 2020,
        cvv: '123',
      };

      const response = await agent.validatePayment(request);
      expect(response.valid).toBe(false);
      expect(response.errors).toContain('Card has expired');
    });

    it('should validate cash payment without additional fields', async () => {
      const request = {
        method: PaymentMethod.CASH,
        amount: 50,
      };

      const response = await agent.validatePayment(request);
      expect(response.valid).toBe(true);
    });
  });

  describe('Refund Processing', () => {
    beforeEach(async () => {
      await agent.initialize();
      await agent.start();
    });

    it('should process refund for completed payment', async () => {
      // First create a payment
      const paymentRequest = {
        transactionId: 'txn-4',
        amount: 200,
        method: PaymentMethod.CASH,
      };
      const paymentResponse = await agent.processPayment(paymentRequest);
      const paymentId = paymentResponse.payment!.id;

      // Then refund it
      const refundRequest = {
        paymentId,
        amount: 100,
        reason: 'Customer request',
      };

      const refundResponse = await agent.processRefund(refundRequest);
      expect(refundResponse.success).toBe(true);
      expect(refundResponse.refundPayment).toBeDefined();
    });

    it('should reject refund for non-existent payment', async () => {
      const refundRequest = {
        paymentId: 'non-existent',
        amount: 50,
        reason: 'Test',
      };

      const response = await agent.processRefund(refundRequest);
      expect(response.success).toBe(false);
      expect(response.error).toContain('not found');
    });
  });

  describe('Payment Events', () => {
    beforeEach(async () => {
      await agent.initialize();
      await agent.start();
    });

    it('should emit payment processed event', async () => {
      const eventPromise = new Promise<void>((resolve) => {
        agent.paymentEvents$.subscribe((event) => {
          expect(event.type).toBe('payment_processed');
          expect(event.paymentId).toBeDefined();
          resolve();
        });
      });

      await agent.processPayment({
        transactionId: 'txn-5',
        amount: 75,
        method: PaymentMethod.CASH,
      });

      await eventPromise;
    });
  });

  describe('Payment History', () => {
    beforeEach(async () => {
      await agent.initialize();
      await agent.start();
    });

    it('should retrieve payment history', async () => {
      // Create some payments
      await agent.processPayment({
        transactionId: 'txn-6',
        amount: 100,
        method: PaymentMethod.CASH,
      });

      await agent.processPayment({
        transactionId: 'txn-7',
        amount: 150,
        method: PaymentMethod.CREDIT_CARD,
        cardNumber: '4532015112830366',
        expiryMonth: 12,
        expiryYear: new Date().getFullYear() + 1,
        cvv: '123',
      });

      const history = await agent.getPaymentHistory({});
      expect(history.payments.length).toBeGreaterThanOrEqual(2);
      expect(history.total).toBeGreaterThanOrEqual(2);
    });

    it('should filter payment history by method', async () => {
      await agent.processPayment({
        transactionId: 'txn-8',
        amount: 100,
        method: PaymentMethod.CASH,
      });

      const history = await agent.getPaymentHistory({
        method: PaymentMethod.CASH,
      });

      expect(history.payments.every((p) => p.method === PaymentMethod.CASH)).toBe(true);
    });
  });

  describe('Payment Reconciliation', () => {
    beforeEach(async () => {
      await agent.initialize();
      await agent.start();
    });

    it('should reconcile payments for a date', async () => {
      const today = new Date();
      const result = await agent.reconcilePayments({ date: today });

      expect(result.totalPayments).toBeGreaterThanOrEqual(0);
      expect(result.totalAmount).toBeGreaterThanOrEqual(0);
      expect(result.discrepancies).toBeDefined();
    });
  });
});

// Made with Bob
