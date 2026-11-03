export type PaymentMethod = 'cash' | 'card' | 'mobile' | 'mercadopago' | 'paypal';

/** Payment methods offered by the staff checkout overlay. */
export type StaffPaymentMethod = Exclude<PaymentMethod, 'paypal' | 'mercadopago'>;

/** Result of a confirmed payment, independent of the component that collected it. */
export interface PaymentResult {
  readonly method: PaymentMethod;
  readonly amount: number;
  readonly change?: number;
  readonly transactionId: string;
  readonly timestamp: Date;
  /**
   * The gateway's own id for the charge (Mercado Pago payment or order id), when
   * the method has one. Lets support match a sale to the gateway record.
   */
  readonly gatewayRef?: string;
}
