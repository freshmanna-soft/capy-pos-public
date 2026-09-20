import { PaymentResult } from './payment.dto';

/** Immutable sale line captured for a receipt. */
export interface ReceiptLine {
  readonly productId: string;
  readonly productName: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly subtotal: number;
}

/** Receipt data owned by the application layer rather than a presentation component. */
export interface ReceiptData {
  readonly payment: PaymentResult;
  readonly items: readonly ReceiptLine[];
  readonly currency: 'USD';
  readonly subtotal: number;
  readonly tax: number;
  readonly taxRate: number;
  readonly total: number;
}
