import { Injectable, inject } from '@angular/core';
import { CartService } from '../services/cart.service';
import { CalculateCartTotalsUseCase } from './calculate-cart-totals.use-case';
import { ITransactionRepository } from '../../domain/interfaces/transaction.repository.interface';
import { Transaction, TransactionStatus, TransactionType, ITransactionItem } from '../../domain/entities/transaction.entity';

/**
 * Request DTO for persisting a transaction
 */
export interface PersistTransactionRequest {
  /** Payment method used (cash, card, mobile) */
  paymentMethod: 'cash' | 'card' | 'mobile';
  /** Unique transaction identifier */
  transactionId: string;
  /** Amount tendered by customer (cash payments) */
  amountTendered?: number;
  /** Change given to customer (cash payments) */
  changeGiven?: number;
  /** Optional customer ID */
  customerId?: string;
}

/**
 * Result DTO returned after persisting a transaction
 */
export interface PersistTransactionResult {
  /** Whether the persistence was successful */
  success: boolean;
  /** Transaction ID */
  transactionId: string;
  /** Payment method used */
  paymentMethod: 'cash' | 'card' | 'mobile';
  /** Timestamp of persistence */
  timestamp: Date;
  /** Error message if persistence failed */
  error?: string;
}

/**
 * Persist Transaction Use Case
 *
 * Application layer use case responsible for building a Transaction entity
 * from the current cart state and persisting it to IndexedDB via the
 * transaction repository.
 *
 * Called after payment is confirmed in the checkout flow.
 * Follows Clean Architecture: Application layer orchestrates domain logic.
 *
 * @example
 * ```typescript
 * const useCase = inject(PersistTransactionUseCase);
 * const result = await useCase.execute({
 *   paymentMethod: 'cash',
 *   transactionId: 'TXN-CASH-abc123',
 *   amountTendered: 20.00,
 *   changeGiven: 2.15
 * });
 * ```
 */
@Injectable({
  providedIn: 'root'
})
export class PersistTransactionUseCase {
  private readonly cartService = inject(CartService);
  private readonly cartTotals = inject(CalculateCartTotalsUseCase);
  private readonly transactionRepository: ITransactionRepository = inject<ITransactionRepository>('ITransactionRepository' as never);

  /**
   * Executes the persist transaction use case.
   * Builds a Transaction entity from cart state and saves it to the repository.
   *
   * @param request - The persist transaction request DTO
   * @returns Promise resolving to the persistence result
   */
  async execute(request: PersistTransactionRequest): Promise<PersistTransactionResult> {
    const { paymentMethod, transactionId, customerId } = request;

    // Validate cart is not empty
    if (this.cartService.isEmpty()) {
      return {
        success: false,
        transactionId,
        paymentMethod,
        timestamp: new Date(),
        error: 'Cannot persist transaction: cart is empty'
      };
    }

    try {
      // Build transaction items from cart
      const items = this.buildTransactionItems();

      // Get totals from cart totals use case (includes discounts)
      const totals = this.cartTotals.totals();

      // Create the Transaction entity with COMPLETED status
      const now = new Date();
      const transaction = new Transaction(
        transactionId,
        customerId,
        items,
        totals.subtotal,
        totals.taxRate,
        totals.taxAmount,
        totals.discountAmount,
        totals.total,
        TransactionStatus.COMPLETED,
        TransactionType.SALE,
        0, // refundedAmount
        now, // createdAt
        now, // updatedAt
        undefined, // createdBy
        undefined, // updatedBy
        now // completedAt
      );

      // Persist to repository
      await this.transactionRepository.create(transaction);

      return {
        success: true,
        transactionId,
        paymentMethod,
        timestamp: now
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error persisting transaction';
      return {
        success: false,
        transactionId,
        paymentMethod,
        timestamp: new Date(),
        error: errorMessage
      };
    }
  }

  /**
   * Builds ITransactionItem[] from the current cart items
   */
  private buildTransactionItems(): ITransactionItem[] {
    const cartItems = this.cartService.items();
    return cartItems.map(cartItem => ({
      productId: cartItem.product.id,
      productName: cartItem.product.name,
      quantity: cartItem.quantity,
      unitPrice: cartItem.product.price,
      subtotal: cartItem.product.price * cartItem.quantity
    }));
  }
}
