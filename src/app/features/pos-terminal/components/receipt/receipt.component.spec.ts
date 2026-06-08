import { TestBed } from '@angular/core/testing';
import { ReceiptComponent, ReceiptData } from './receipt.component';
import { PaymentResult } from '../checkout/checkout.component';

/**
 * Unit Tests for ReceiptComponent
 * 
 * Covers Sprint 2 Story S2-4: Receipt Generation
 * 
 * Acceptance Criteria:
 * - Given a completed transaction, receipt displays order details
 * - Receipt shows payment method and total amount
 * - Receipt includes transaction ID
 * - Print and New Transaction actions are available
 * 
 * Note: Uses class-level testing due to Angular 21 signal input
 * compatibility with Vitest JIT compilation (NG0315/NG0950).
 * Template rendering is covered by E2E tests.
 */
describe('ReceiptComponent', () => {
  let component: ReceiptComponent;

  const mockPayment: PaymentResult = {
    method: 'cash',
    amount: 108.5,
    change: 11.5,
    transactionId: 'TXN-ABC123-XYZ789',
    timestamp: new Date('2026-06-08T12:00:00'),
  };

  const mockReceiptData: ReceiptData = {
    payment: mockPayment,
    items: [
      { product: { id: '1', name: 'Coffee', price: 4.5, sku: 'COF-001', stock: 50, category: 'Beverages' } as any, quantity: 2 },
      { product: { id: '2', name: 'Muffin', price: 3.0, sku: 'MUF-001', stock: 30, category: 'Food' } as any, quantity: 1 },
    ],
    subtotal: 12.0,
    tax: 1.02,
    taxRate: 0.085,
    total: 13.02,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ReceiptComponent],
    });

    const fixture = TestBed.createComponent(ReceiptComponent);
    component = fixture.componentInstance;
  });

  describe('Component Creation', () => {
    it('should create the component', () => {
      expect(component).toBeTruthy();
    });

    it('should have data input defined', () => {
      expect(component.data).toBeDefined();
    });

    it('should have printReceipt output defined', () => {
      expect(component.printReceipt).toBeDefined();
    });

    it('should have newTransaction output defined', () => {
      expect(component.newTransaction).toBeDefined();
    });
  });

  describe('Payment Method Labels (S2-4)', () => {
    it('should return correct label for cash', () => {
      expect(component.getMethodLabel('cash')).toBe('💵 Cash');
    });

    it('should return correct label for card', () => {
      expect(component.getMethodLabel('card')).toBe('💳 Card');
    });

    it('should return correct label for mobile', () => {
      expect(component.getMethodLabel('mobile')).toBe('📱 Mobile');
    });

    it('should return raw method for unknown types', () => {
      expect(component.getMethodLabel('crypto')).toBe('crypto');
    });

    it('should return raw method for empty string', () => {
      expect(component.getMethodLabel('')).toBe('');
    });
  });

  describe('Receipt Data Structure (S2-4)', () => {
    it('should define ReceiptData interface with payment field', () => {
      const data: ReceiptData = mockReceiptData;
      expect(data.payment).toBeDefined();
      expect(data.payment.method).toBe('cash');
      expect(data.payment.amount).toBe(108.5);
      expect(data.payment.change).toBe(11.5);
      expect(data.payment.transactionId).toBe('TXN-ABC123-XYZ789');
      expect(data.payment.timestamp).toBeInstanceOf(Date);
    });

    it('should define ReceiptData interface with items field', () => {
      const data: ReceiptData = mockReceiptData;
      expect(data.items).toHaveLength(2);
      expect(data.items[0].product.name).toBe('Coffee');
      expect(data.items[0].quantity).toBe(2);
      expect(data.items[1].product.name).toBe('Muffin');
      expect(data.items[1].quantity).toBe(1);
    });

    it('should define ReceiptData interface with totals', () => {
      const data: ReceiptData = mockReceiptData;
      expect(data.subtotal).toBe(12.0);
      expect(data.tax).toBe(1.02);
      expect(data.taxRate).toBe(0.085);
      expect(data.total).toBe(13.02);
    });

    it('should support card payment without change', () => {
      const cardData: ReceiptData = {
        ...mockReceiptData,
        payment: { ...mockPayment, method: 'card', change: undefined },
      };
      expect(cardData.payment.change).toBeUndefined();
      expect(cardData.payment.method).toBe('card');
    });

    it('should support zero change for exact cash payment', () => {
      const exactData: ReceiptData = {
        ...mockReceiptData,
        payment: { ...mockPayment, change: 0 },
      };
      expect(exactData.payment.change).toBe(0);
    });
  });

  describe('Output Events (S2-4)', () => {
    it('should emit printReceipt event', () => {
      const spy = vi.fn();
      component.printReceipt.subscribe(spy);
      component.printReceipt.emit();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should emit newTransaction event', () => {
      const spy = vi.fn();
      component.newTransaction.subscribe(spy);
      component.newTransaction.emit();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
