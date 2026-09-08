import type { Meta, StoryObj } from '@storybook/angular';
import { BadgeComponent } from '@shared/ui/atoms/badge/badge.component';

/**
 * Badge Component Stories
 * Demonstrates every status variant, size and the dot form
 * Used for component documentation and visual testing
 */
const meta: Meta<BadgeComponent> = {
  title: 'Atoms/Badge',
  component: BadgeComponent,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'success', 'warning', 'danger', 'info'],
      description: 'Badge colour variant',
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
      description: 'Badge size',
    },
    dot: {
      control: 'boolean',
      description: 'Render as a bare status dot with no label',
    },
  },
};

export default meta;
type Story = StoryObj<BadgeComponent>;

/**
 * Primary badge - default label
 */
export const Primary: Story = {
  args: { variant: 'primary', size: 'md', dot: false },
  render: (args) => ({
    props: args,
    template: '<app-badge [variant]="variant" [size]="size">New</app-badge>',
  }),
};

/**
 * Success badge - e.g. a completed transaction
 */
export const Success: Story = {
  args: { variant: 'success', size: 'md', dot: false },
  render: (args) => ({
    props: args,
    template: '<app-badge [variant]="variant" [size]="size">Paid</app-badge>',
  }),
};

/**
 * Warning badge - e.g. low stock
 */
export const Warning: Story = {
  args: { variant: 'warning', size: 'md', dot: false },
  render: (args) => ({
    props: args,
    template: '<app-badge [variant]="variant" [size]="size">Low Stock</app-badge>',
  }),
};

/**
 * Danger badge - e.g. out of stock or a failed sync
 */
export const Danger: Story = {
  args: { variant: 'danger', size: 'md', dot: false },
  render: (args) => ({
    props: args,
    template: '<app-badge [variant]="variant" [size]="size">Out of Stock</app-badge>',
  }),
};

/**
 * Small badge - inline with dense text
 */
export const Small: Story = {
  args: { variant: 'primary', size: 'sm', dot: false },
  render: (args) => ({
    props: args,
    template: '<app-badge [variant]="variant" [size]="size">12</app-badge>',
  }),
};

/**
 * Large badge - a standalone label
 */
export const Large: Story = {
  args: { variant: 'info', size: 'lg', dot: false },
  render: (args) => ({
    props: args,
    template: '<app-badge [variant]="variant" [size]="size">Offline</app-badge>',
  }),
};

/**
 * Dot badge - status indicator with no text
 */
export const Dot: Story = {
  args: { variant: 'success', size: 'md', dot: true },
  render: (args) => ({
    props: args,
    template: '<app-badge [variant]="variant" [size]="size" [dot]="dot"></app-badge>',
  }),
};

/**
 * All variants side by side
 */
export const AllVariants: Story = {
  render: () => ({
    template: `
      <div class="flex flex-wrap gap-2">
        <app-badge variant="primary">Primary</app-badge>
        <app-badge variant="secondary">Secondary</app-badge>
        <app-badge variant="success">Success</app-badge>
        <app-badge variant="warning">Warning</app-badge>
        <app-badge variant="danger">Danger</app-badge>
        <app-badge variant="info">Info</app-badge>
      </div>
    `,
  }),
};
