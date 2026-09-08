import type { Meta, StoryObj } from '@storybook/angular';
import { ProductCardComponent } from '@shared/ui/molecules/product-card/product-card.component';
import { Product } from '@core/domain/entities/product.entity';

/**
 * ProductCard Component Stories
 * Demonstrates the grid/list layouts and the in-stock, low-stock and
 * out-of-stock visual states
 * Used for component documentation and visual testing
 */
const makeProduct = (overrides: Record<string, unknown> = {}): Product =>
  Product.fromJSON({
    id: 'p-1',
    name: 'Organic Coffee',
    price: 12.99,
    sku: 'COF-001',
    category: 'Beverages',
    stock: 25,
    emoji: '☕',
    lowStockThreshold: 10,
    ...overrides,
  });

const meta: Meta<ProductCardComponent> = {
  title: 'Molecules/ProductCard',
  component: ProductCardComponent,
  tags: ['autodocs'],
  argTypes: {
    view: {
      control: 'radio',
      options: ['grid', 'list'],
      description: 'Layout forwarded by the parent product grid',
    },
    selected: {
      action: 'selected',
      description: 'Emits the product — suppressed when out of stock',
    },
  },
};

export default meta;
type Story = StoryObj<ProductCardComponent>;

/**
 * In stock, grid layout - the default POS tile
 */
export const Grid: Story = {
  args: { product: makeProduct(), view: 'grid' },
  render: (args) => ({
    props: args,
    template:
      '<div class="grid grid-cols-2 gap-3 max-w-md"><app-product-card [product]="product" [view]="view" /></div>',
  }),
};

/**
 * In stock, list layout - compact row
 */
export const List: Story = {
  args: { product: makeProduct(), view: 'list' },
  render: (args) => ({
    props: args,
    template:
      '<div class="flex flex-col gap-2 max-w-md"><app-product-card [product]="product" [view]="view" /></div>',
  }),
};

/**
 * Low stock - orange border plus a Low Stock badge
 */
export const LowStock: Story = {
  args: { product: makeProduct({ stock: 4 }), view: 'grid' },
  render: (args) => ({
    props: args,
    template:
      '<div class="grid grid-cols-2 gap-3 max-w-md"><app-product-card [product]="product" [view]="view" /></div>',
  }),
};

/**
 * Out of stock - dimmed, not selectable
 */
export const OutOfStock: Story = {
  args: { product: makeProduct({ stock: 0 }), view: 'grid' },
  render: (args) => ({
    props: args,
    template:
      '<div class="grid grid-cols-2 gap-3 max-w-md"><app-product-card [product]="product" [view]="view" /></div>',
  }),
};

/**
 * No emoji - the image slot collapses cleanly
 */
export const WithoutEmoji: Story = {
  args: { product: makeProduct({ emoji: '' }), view: 'grid' },
  render: (args) => ({
    props: args,
    template:
      '<div class="grid grid-cols-2 gap-3 max-w-md"><app-product-card [product]="product" [view]="view" /></div>',
  }),
};
