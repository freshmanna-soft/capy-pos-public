import type { Meta, StoryObj } from '@storybook/angular';
import { ProductGridComponent } from '@shared/ui/organisms/product-grid/product-grid.component';
import { Product } from '@core/domain/entities/product.entity';

/**
 * ProductGrid Component Stories
 * Demonstrates the populated grid plus the loading and empty states the POS
 * screen relies on
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

const catalogue: Product[] = [
  makeProduct(),
  makeProduct({ id: 'p-2', name: 'Capy Croissant', sku: 'BAK-002', price: 3.5, emoji: '🥐' }),
  makeProduct({
    id: 'p-3',
    name: 'Green Tea',
    sku: 'TEA-003',
    price: 4.25,
    emoji: '🍵',
    stock: 3,
  }),
  makeProduct({
    id: 'p-4',
    name: 'Blueberry Muffin',
    sku: 'BAK-004',
    price: 2.75,
    emoji: '🧁',
    stock: 0,
  }),
];

const meta: Meta<ProductGridComponent> = {
  title: 'Organisms/ProductGrid',
  component: ProductGridComponent,
  tags: ['autodocs'],
  argTypes: {
    products: { description: 'Products to render' },
    isLoading: { control: 'boolean', description: 'Shows the skeleton/loading state' },
    productSelected: { action: 'productSelected', description: 'Emits the chosen product' },
  },
};

export default meta;
type Story = StoryObj<ProductGridComponent>;

/**
 * Populated grid - mixed in-stock, low-stock and out-of-stock products
 */
export const Default: Story = {
  args: { products: catalogue, isLoading: false },
  render: (args) => ({
    props: args,
    template: '<app-product-grid [products]="products" [isLoading]="isLoading" />',
  }),
};

/**
 * Loading - before the first catalogue read resolves
 */
export const Loading: Story = {
  args: { products: [], isLoading: true },
  render: (args) => ({
    props: args,
    template: '<app-product-grid [products]="products" [isLoading]="isLoading" />',
  }),
};

/**
 * Empty - a search or category filter matched nothing
 */
export const Empty: Story = {
  args: { products: [], isLoading: false },
  render: (args) => ({
    props: args,
    template: '<app-product-grid [products]="products" [isLoading]="isLoading" />',
  }),
};

/**
 * Single product - the grid does not stretch its one tile
 */
export const SingleProduct: Story = {
  args: { products: [makeProduct()], isLoading: false },
  render: (args) => ({
    props: args,
    template: '<app-product-grid [products]="products" [isLoading]="isLoading" />',
  }),
};
