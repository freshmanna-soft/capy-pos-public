import { TestBed } from '@angular/core/testing';
import { vi, describe, it, expect, beforeEach, Mock } from 'vitest';
import { PersistTransactionUseCase, PersistTransactionRequest, PersistTransactionResult } from './persist-transaction.use-case';
import { ITransactionRepository } from '../../domain/interfaces/transaction.repository.interface';
import { Transaction, TransactionStatus, TransactionType } from '../../domain/entities/transaction.entity';
import { CartService } from '../services/cart.service';
import { CalculateCartTotalsUseCase } from './calculate-cart-totals.use-case';
import { Product } from '../../domain/entities/product.entity';

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

  const mockProduct = new Product(
    'prod-1',
    'Test Product',
    9.99,
    'SKU-001',
    'Test Category',
    100
  );

  const mockProduct2 = new Product(
    'prod-2',
    'Another Product',
    14.99,
    'SKU-002',
    'Test Category',
    50
  );

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
      findByProduct: vi.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        PersistTransactionUseCase,
        CartService,
        CalculateCartTotalsUseCase,
        { provide: 'ITransactionRepository', useValue: mockRepository }
      ]
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
        amountTendered: 30.00,
        changeGiven: 2.82
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
      expect(createdTxn.items.length).toBe(2);
    });

    it('should map cart items to transaction items correctly', async () => {
      // Arrange
      cartService.addProduct(mockProduct);
      cartService.addProduct(mockProduct); // quantity = 2

      const request: PersistTransactionRequest = {
        paymentMethod: 'cash',
        transactionId: 'TXN-TEST-002',
        amountTendered: 25.00,
        changeGiven: 3.33
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
        transactionId: 'TXN-TEST-003'
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
        amountTendered: 20.00,
        changeGiven: 9.16
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
        transactionId: 'TXN-TEST-005'
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
        amountTendered: 10.00
      };

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot persist transaction: cart is empty');
      expect(mockRepository['create']).not.toHaveBeenCalled();
    });

    it('should return error result when repository throws', async () => {
      // Arrange
      cartService.addProduct(mockProduct);

      const request: PersistTransactionRequest = {
        paymentMethod: 'cash',
        transactionId: 'TXN-TEST-007',
        amountTendered: 20.00
      };

      mockRepository['create'].mockRejectedValue(new Error('Database connection failed'));

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection failed');
      expect(result.transactionId).toBe('TXN-TEST-007');
    });

    it('should include payment method in result', async () => {
      // Arrange
      cartService.addProduct(mockProduct);

      const request: PersistTransactionRequest = {
        paymentMethod: 'card',
        transactionId: 'TXN-TEST-008'
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
        amountTendered: 20.00
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
        amountTendered: 20.00
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
        amountTendered: 20.00,
        customerId: 'customer-123'
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
        transactionId: 'TXN-TEST-012'
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
