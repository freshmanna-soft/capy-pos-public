import type { Meta, StoryObj } from '@storybook/angular';
import { ButtonComponent } from './button.component';

/**
 * Button Component Stories
 * Demonstrates all button variants and states
 * Used for component documentation and visual testing
 */
const meta: Meta<ButtonComponent> = {
  title: 'Atoms/Button',
  component: ButtonComponent,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'danger', 'success'],
      description: 'Button color variant',
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
      description: 'Button size',
    },
    type: {
      control: 'select',
      options: ['button', 'submit', 'reset'],
      description: 'HTML button type',
    },
    disabled: {
      control: 'boolean',
      description: 'Disabled state',
    },
    loading: {
      control: 'boolean',
      description: 'Loading state with spinner',
    },
    fullWidth: {
      control: 'boolean',
      description: 'Full width button',
    },
    clicked: {
      action: 'clicked',
      description: 'Click event emitter',
    },
  },
};

export default meta;
type Story = StoryObj<ButtonComponent>;

/**
 * Primary button - Main call-to-action
 */
export const Primary: Story = {
  args: {
    variant: 'primary',
    size: 'md',
    disabled: false,
    loading: false,
  },
  render: (args) => ({
    props: args,
    template: '<app-button [variant]="variant" [size]="size" [disabled]="disabled" [loading]="loading">Primary Button</app-button>',
  }),
};

/**
 * Secondary button - Secondary actions
 */
export const Secondary: Story = {
  args: {
    variant: 'secondary',
    size: 'md',
    disabled: false,
    loading: false,
  },
  render: (args) => ({
    props: args,
    template: '<app-button [variant]="variant" [size]="size" [disabled]="disabled" [loading]="loading">Secondary Button</app-button>',
  }),
};

/**
 * Danger button - Destructive actions
 */
export const Danger: Story = {
  args: {
    variant: 'danger',
    size: 'md',
    disabled: false,
    loading: false,
  },
  render: (args) => ({
    props: args,
    template: '<app-button [variant]="variant" [size]="size" [disabled]="disabled" [loading]="loading">Delete</app-button>',
  }),
};

/**
 * Success button - Positive actions
 */
export const Success: Story = {
  args: {
    variant: 'success',
    size: 'md',
    disabled: false,
    loading: false,
  },
  render: (args) => ({
    props: args,
    template: '<app-button [variant]="variant" [size]="size" [disabled]="disabled" [loading]="loading">Save</app-button>',
  }),
};

/**
 * Small button
 */
export const Small: Story = {
  args: {
    variant: 'primary',
    size: 'sm',
    disabled: false,
    loading: false,
  },
  render: (args) => ({
    props: args,
    template: '<app-button [variant]="variant" [size]="size" [disabled]="disabled" [loading]="loading">Small Button</app-button>',
  }),
};

/**
 * Large button
 */
export const Large: Story = {
  args: {
    variant: 'primary',
    size: 'lg',
    disabled: false,
    loading: false,
  },
  render: (args) => ({
    props: args,
    template: '<app-button [variant]="variant" [size]="size" [disabled]="disabled" [loading]="loading">Large Button</app-button>',
  }),
};

/**
 * Disabled button
 */
export const Disabled: Story = {
  args: {
    variant: 'primary',
    size: 'md',
    disabled: true,
    loading: false,
  },
  render: (args) => ({
    props: args,
    template: '<app-button [variant]="variant" [size]="size" [disabled]="disabled" [loading]="loading">Disabled Button</app-button>',
  }),
};

/**
 * Loading button with spinner
 */
export const Loading: Story = {
  args: {
    variant: 'primary',
    size: 'md',
    disabled: false,
    loading: true,
  },
  render: (args) => ({
    props: args,
    template: '<app-button [variant]="variant" [size]="size" [disabled]="disabled" [loading]="loading">Loading...</app-button>',
  }),
};

/**
 * Full width button
 */
export const FullWidth: Story = {
  args: {
    variant: 'primary',
    size: 'md',
    disabled: false,
    loading: false,
    fullWidth: true,
  },
  render: (args) => ({
    props: args,
    template: '<app-button [variant]="variant" [size]="size" [disabled]="disabled" [loading]="loading" [fullWidth]="fullWidth">Full Width Button</app-button>',
  }),
};

/**
 * Button group example
 */
export const ButtonGroup: Story = {
  render: () => ({
    template: `
      <div class="flex gap-2">
        <app-button variant="secondary">Cancel</app-button>
        <app-button variant="primary">Save</app-button>
      </div>
    `,
  }),
};

// Made with Bob
