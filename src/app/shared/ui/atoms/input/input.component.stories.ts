import type { Meta, StoryObj } from '@storybook/angular';
import { InputComponent } from '@shared/ui/atoms/input/input.component';

/**
 * Input Component Stories
 * Demonstrates label/hint/error states, sizes, affixes and the in-field action slot
 * Used for component documentation and visual testing
 */
const meta: Meta<InputComponent> = {
  title: 'Atoms/Input',
  component: InputComponent,
  tags: ['autodocs'],
  argTypes: {
    type: {
      control: 'select',
      options: ['text', 'email', 'password', 'number', 'tel', 'url', 'search'],
      description: 'Native input type',
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
      description: 'Field height — md and lg keep the 44px touch target',
    },
    label: { control: 'text', description: 'Visible label, linked to the field' },
    placeholder: { control: 'text', description: 'Placeholder text' },
    hint: { control: 'text', description: 'Helper text shown when there is no error' },
    error: {
      control: 'text',
      description: 'Error message — also sets aria-invalid and aria-describedby',
    },
    prefix: { control: 'text', description: 'Leading text inside the field' },
    suffix: { control: 'text', description: 'Trailing text inside the field' },
    required: { control: 'boolean', description: 'Marks the field required' },
    disabled: { control: 'boolean', description: 'Disabled state' },
    readonly: { control: 'boolean', description: 'Read-only state' },
    valueChange: { action: 'valueChange', description: 'Emits the coerced value' },
  },
};

export default meta;
type Story = StoryObj<InputComponent>;

/**
 * Default text field with a label
 */
export const Default: Story = {
  args: {
    label: 'Customer name',
    placeholder: 'e.g. Marco Silva',
    type: 'text',
    size: 'md',
  },
  render: (args) => ({
    props: args,
    template:
      '<app-input [label]="label" [placeholder]="placeholder" [type]="type" [size]="size" />',
  }),
};

/**
 * With hint text
 */
export const WithHint: Story = {
  args: {
    label: 'SKU',
    placeholder: 'COF-001',
    hint: 'Uppercase letters, digits and dashes',
  },
  render: (args) => ({
    props: args,
    template: '<app-input [label]="label" [placeholder]="placeholder" [hint]="hint" />',
  }),
};

/**
 * Error state - the message is linked, not just coloured
 */
export const WithError: Story = {
  args: {
    label: 'Email',
    type: 'email',
    error: 'Enter a valid email address',
    required: true,
  },
  render: (args) => ({
    props: args,
    template: '<app-input [label]="label" [type]="type" [error]="error" [required]="required" />',
  }),
};

/**
 * Currency field - prefix affix plus a numeric type
 */
export const WithPrefix: Story = {
  args: { label: 'Price', type: 'number', prefix: '$', placeholder: '0.00' },
  render: (args) => ({
    props: args,
    template:
      '<app-input [label]="label" [type]="type" [prefix]="prefix" [placeholder]="placeholder" />',
  }),
};

/**
 * Weight field - suffix affix
 */
export const WithSuffix: Story = {
  args: { label: 'Weight', type: 'number', suffix: 'kg', placeholder: '0' },
  render: (args) => ({
    props: args,
    template:
      '<app-input [label]="label" [type]="type" [suffix]="suffix" [placeholder]="placeholder" />',
  }),
};

/**
 * Small and large sizes
 */
export const Sizes: Story = {
  render: () => ({
    template: `
      <div class="flex flex-col gap-4">
        <app-input size="sm" label="Small" placeholder="sm" />
        <app-input size="md" label="Medium (default)" placeholder="md" />
        <app-input size="lg" label="Large" placeholder="lg" />
      </div>
    `,
  }),
};

/**
 * Disabled field
 */
export const Disabled: Story = {
  args: { label: 'Tenant', disabled: true, placeholder: 'capy-main' },
  render: (args) => ({
    props: args,
    template: '<app-input [label]="label" [disabled]="disabled" [placeholder]="placeholder" />',
  }),
};

/**
 * Read-only field
 */
export const Readonly: Story = {
  args: { label: 'Transaction id', readonly: true },
  render: (args) => ({
    props: args,
    template: '<app-input [label]="label" [readonly]="readonly" />',
  }),
};

/**
 * Barcode field with a projected in-field action, e.g. Scan
 */
export const WithInputAction: Story = {
  render: () => ({
    template: `
      <app-input label="Barcode" placeholder="Scan or type" inputMode="numeric">
        <button
          inputAction
          type="button"
          class="min-h-[44px] px-3 rounded-lg bg-blue-600 text-white text-sm font-semibold border-none"
        >
          Scan
        </button>
      </app-input>
    `,
  }),
};
