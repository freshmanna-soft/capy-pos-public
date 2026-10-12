import { TestBed } from '@angular/core/testing';
import { vi, describe, it, expect, beforeEach, Mock } from 'vitest';
import {
  PersistTransactionUseCase,
  PersistTransactionRequest,
} from '@core/application/use-cases/persist-transaction.use-case';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '@core/domain/entities/transaction.entity';
import { CartService } from '@core/application/services/cart.service';
import { CalculateCartTotalsUseCase } from '@core/application/use-cases/calculate-cart-totals.use-case';
import { ProductBuilder } from '@core/domain/entities/product.builder';
import { SALE_OUTBOX } from '@core/application/ports/sale-outbox.port';

/**
 * PersistTransactionUseCase Unit Tests
 *
 * Tests the application layer use case responsible for
 * persisting completed transactions to IndexedDB via the repository.
 *
 * TDD: RED → GREEN → REFACTOR
 */
describe('PersistTransactionUseCase', () => {
  let useCase: PersistTransactionUseCase;
  let mockRepository: Record<string, Mock>;
  let cartService: CartService;
  let cartTotals: CalculateCartTotalsUseCase;

  const mockProduct = new ProductBuilder()
    .withId('prod-1')
    .withName('Test Product')
    .withPrice(9.99)
    .withSku('SKU-001')
    .withCategory('Test Category')
    .withStock(100)
    .build();

  const mockProduct2 = new ProductBuilder()
    .withId('prod-2')
    .withName('Another Product')
    .withPrice(14.99)
    .withSku('SKU-002')
    .withCategory('Test Category')
    .withStock(50)
    .build();

  beforeEach(() => {
    mockRepository = {
      create: vi.fn(),
      findById: vi.fn(),
      findAll: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn(),
      count: vi.fn(),
      bulkCreate: vi.fn(),
      bulkUpdate: vi.fn(),
      findByCustomerId: vi.fn(),
      findByStatus: vi.fn(),
      findByType: vi.fn(),
      findByDateRange: vi.fn(),
      findByReceiptNumber: vi.fn(),
      getTotalSales: vi.fn(),
      getTransactionCount: vi.fn(),
      getAverageTransactionValue: vi.fn(),
      getTopProducts: vi.fn(),
      getSalesByHour: vi.fn(),
      getRefundStats: vi.fn(),
      findCompleted: vi.fn(),
      findPending: vi.fn(),
      updateStatus: vi.fn(),
      addPayment: vi.fn(),
      findByProduct: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        PersistTransactionUseCase,
        CartService,
        CalculateCartTotalsUseCase,
        { provide: 'ITransactionRepository', useValue: mockRepository },
      ],
    });

    useCase = TestBed.inject(PersistTransactionUseCase);
    cartService = TestBed.inject(CartService);
    cartTotals = TestBed.inject(CalculateCartTotalsUseCase);
    cartService.clearCart();
  });

  describe('execute', () => {
    it('should persist a transaction with correct data from cart', async () => {
      // Arrange
      cartService.addProduct(mockProduct);
      cartService.addProduct(mockProduct2);

      const request: PersistTransactionRequest = {
        paymentMethod: 'cash',
        transactionId: 'TXN-TEST-001',
        amountTendered: 30.0,
        changeGiven: 2.82,
      };

      mockRepository['create'].mockResolvedValue(undefined);

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('TXN-TEST-001');
      expect(mockRepository['create']).toHaveBeenCalledTimes(1);

      const createdTxn = mockRepository['create'].mock.calls[0][0] as Transaction;
      expect(createdTxn.id).toBe('TXN-TEST-001');
      expect(createdTxn.status).toBe(TransactionStatus.COMPLETED);
      expect(createdTxn.type).toBe(TransactionType.SALE);
      expect(createdTxn.items).toHaveLength(2);
    });

    it('should map cart items to transaction items correctly', async () => {
      // Arrange
      cartService.addProduct(mockProduct);
      cartService.addProduct(mockProduct); // quantity = 2

      const request: PersistTransactionRequest = {
        paymentMethod: 'cash',
        transactionId: 'TXN-TEST-002',
        amountTendered: 25.0,
        changeGiven: 3.33,
      };

      mockRepository['create'].mockResolvedValue(undefined);

      // Act
      await useCase.execute(request);

      // Assert
      const createdTxn = mockRepository['create'].mock.calls[0][0] as Transaction;
      const item = createdTxn.items[0];
      expect(item.productId).toBe('prod-1');
      expect(item.productName).toBe('Test Product');
      expect(item.quantity).toBe(2);
      expect(item.unitPrice).toBe(9.99);
      expect(item.subtotal).toBe(19.98);
    });

    it('should calculate totals correctly using cart service values', async () => {
      // Arrange
      cartService.addProduct(mockProduct); // 9.99

      const request: PersistTransactionRequest = {
        paymentMethod: 'card',
        transactionId: 'TXN-TEST-003',
      };

      mockRepository['create'].mockResolvedValue(undefined);

      // Act
      await useCase.execute(request);

      // Assert
      const createdTxn = mockRepository['create'].mock.calls[0][0] as Transaction;
      expect(createdTxn.subtotal).toBe(cartService.subtotal());
      expect(createdTxn.taxRate).toBe(cartService.taxRate());
      expect(createdTxn.taxAmount).toBeCloseTo(cartService.tax(), 2);
      expect(createdTxn.total).toBeCloseTo(cartService.total(), 2);
    });

    it('should set transaction status to COMPLETED', async () => {
      // Arrange
      cartService.addProduct(mockProduct);

      const request: PersistTransactionRequest = {
        paymentMethod: 'cash',
        transactionId: 'TXN-TEST-004',
        amountTendered: 20.0,
        changeGiven: 9.16,
      };

      mockRepository['create'].mockResolvedValue(undefined);

      // Act
      await useCase.execute(request);

      // Assert
      const createdTxn = mockRepository['create'].mock.calls[0][0] as Transaction;
      expect(createdTxn.status).toBe(TransactionStatus.COMPLETED);
      expect(createdTxn.completedAt).toBeDefined();
    });

    it('should set transaction type to SALE', async () => {
      // Arrange
      cartService.addProduct(mockProduct);

      const request: PersistTransactionRequest = {
        paymentMethod: 'mobile',
        transactionId: 'TXN-TEST-005',
      };

      mockRepository['create'].mockResolvedValue(undefined);

      // Act
      await useCase.execute(request);

      // Assert
      const createdTxn = mockRepository['create'].mock.calls[0][0] as Transaction;
      expect(createdTxn.type).toBe(TransactionType.SALE);
    });

    it('should return error result when cart is empty', async () => {
      // Arrange - cart is empty
      const request: PersistTransactionRequest = {
        paymentMethod: 'cash',
        transactionId: 'TXN-TEST-006',
        amountTendered: 10.0,
      };

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot process transaction: cart is empty');
      expect(mockRepository['create']).not.toHaveBeenCalled();
    });

    it('should return error result when repository throws', async () => {
      // Arrange
      cartService.addProduct(mockProduct);

      const request: PersistTransactionRequest = {
        paymentMethod: 'cash',
        transactionId: 'TXN-TEST-007',
        amountTendered: 20.0,
      };

      mockRepository['create'].mockRejectedValue(new Error('Database connection failed'));

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe("Failed to persist transaction 'TXN-TEST-007'");
      expect(result.transactionId).toBe('TXN-TEST-007');
    });

    it('should include payment method in result', async () => {
      // Arrange
      cartService.addProduct(mockProduct);

      const request: PersistTransactionRequest = {
        paymentMethod: 'card',
        transactionId: 'TXN-TEST-008',
      };

      mockRepository['create'].mockResolvedValue(undefined);

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(true);
      expect(result.paymentMethod).toBe('card');
    });

    it('should include timestamp in result', async () => {
      // Arrange
      cartService.addProduct(mockProduct);

      const request: PersistTransactionRequest = {
        paymentMethod: 'cash',
        transactionId: 'TXN-TEST-009',
        amountTendered: 20.0,
      };

      mockRepository['create'].mockResolvedValue(undefined);

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(true);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should handle discount amount from cart totals', async () => {
      // Arrange
      cartService.addProduct(mockProduct); // 9.99
      cartTotals.applyDiscount({ type: 'percentage', value: 10, label: '10% off' });

      const request: PersistTransactionRequest = {
        paymentMethod: 'cash',
        transactionId: 'TXN-TEST-010',
        amountTendered: 20.0,
      };

      mockRepository['create'].mockResolvedValue(undefined);

      // Act
      await useCase.execute(request);

      // Assert
      const createdTxn = mockRepository['create'].mock.calls[0][0] as Transaction;
      expect(createdTxn.discountAmount).toBeGreaterThan(0);
    });

    it('should set customerId when provided in request', async () => {
      // Arrange
      cartService.addProduct(mockProduct);

      const request: PersistTransactionRequest = {
        paymentMethod: 'cash',
        transactionId: 'TXN-TEST-011',
        amountTendered: 20.0,
        customerId: 'customer-123',
      };

      mockRepository['create'].mockResolvedValue(undefined);

      // Act
      await useCase.execute(request);

      // Assert
      const createdTxn = mockRepository['create'].mock.calls[0][0] as Transaction;
      expect(createdTxn.customerId).toBe('customer-123');
    });

    it('should leave customerId undefined when not provided', async () => {
      // Arrange
      cartService.addProduct(mockProduct);

      const request: PersistTransactionRequest = {
        paymentMethod: 'card',
        transactionId: 'TXN-TEST-012',
      };

      mockRepository['create'].mockResolvedValue(undefined);

      // Act
      await useCase.execute(request);

      // Assert
      const createdTxn = mockRepository['create'].mock.calls[0][0] as Transaction;
      expect(createdTxn.customerId).toBeUndefined();
    });
  });
});

describe('PersistTransactionUseCase with a sale event (#352)', () => {
  let useCase: PersistTransactionUseCase;
  let cartService: CartService;
  let create: Mock;
  let record: Mock;

  const oats = new ProductBuilder()
    .withId('oats')
    .withName('Oats')
    .withPrice(2.5)
    .withSku('SKU-OATS')
    .withCategory('Feed')
    .withStock(10)
    .build();

  beforeEach(() => {
    create = vi.fn().mockResolvedValue(undefined);
    record = vi.fn(async (_event: unknown, write: () => Promise<unknown>) => {
      await write();
      return 'recorded';
    });
    TestBed.configureTestingModule({
      providers: [
        PersistTransactionUseCase,
        CartService,
        CalculateCartTotalsUseCase,
        { provide: 'ITransactionRepository', useValue: { create } },
        { provide: SALE_OUTBOX, useValue: { record } },
      ],
    });
    useCase = TestBed.inject(PersistTransactionUseCase);
    cartService = TestBed.inject(CartService);
    cartService.clearCart();
    cartService.addProduct(oats);
    cartService.addProduct(oats);
  });

  it('writes the transaction through the sale outbox with a SaleCompleted payload', async () => {
    const result = await useCase.execute({
      paymentMethod: 'card',
      transactionId: 'TXN-9',
      customerId: 'cust-1',
      sale: { correlationId: 'corr-9', amount: 5.43 },
    });

    expect(result).toMatchObject({ success: true, outcome: 'recorded' });
    expect(record).toHaveBeenCalledTimes(1);
    const [event] = record.mock.calls[0];
    expect(event).toEqual({
      transactionId: 'TXN-9',
      correlationId: 'corr-9',
      payload: {
        transactionId: 'TXN-9',
        items: [{ productId: 'oats', quantity: 2, unitPrice: 2.5 }],
        amount: 5.43,
        method: 'card',
        customerId: 'cust-1',
        occurredAt: expect.any(String),
      },
      appliedInline: [],
    });
    // The repository write happens inside the outbox's transaction, not beside it.
    expect(create).toHaveBeenCalledTimes(1);
    expect((create.mock.calls[0][0] as Transaction).id).toBe('TXN-9');
  });

  it('reports a deferred record as unsuccessful without throwing', async () => {
    record.mockResolvedValueOnce('deferred');

    const result = await useCase.execute({
      paymentMethod: 'cash',
      transactionId: 'TXN-10',
      sale: { correlationId: 'corr-10', amount: 5.43 },
    });

    expect(result).toMatchObject({ success: false, outcome: 'deferred' });
    expect(create).not.toHaveBeenCalled();
  });

  it('passes through an already-recorded retry as a success', async () => {
    record.mockResolvedValueOnce('already-recorded');

    const result = await useCase.execute({
      paymentMethod: 'cash',
      transactionId: 'TXN-11',
      sale: { correlationId: 'corr-11', amount: 5.43 },
    });

    expect(result).toMatchObject({ success: true, outcome: 'already-recorded' });
  });
});
