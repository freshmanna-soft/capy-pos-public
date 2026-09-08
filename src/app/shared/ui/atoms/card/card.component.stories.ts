import type { Meta, StoryObj } from '@storybook/angular';
import { CardComponent } from '@shared/ui/atoms/card/card.component';

/**
 * Card Component Stories
 * Demonstrates padding scale plus the hover and clickable affordances
 * Used for component documentation and visual testing
 */
const meta: Meta<CardComponent> = {
  title: 'Atoms/Card',
  component: CardComponent,
  tags: ['autodocs'],
  argTypes: {
    padding: {
      control: 'select',
      options: ['none', 'sm', 'md', 'lg'],
      description: 'Internal padding scale',
    },
    hover: {
      control: 'boolean',
      description: 'Raise the shadow on hover',
    },
    clickable: {
      control: 'boolean',
      description: 'Pointer cursor and hover shadow for a selectable card',
    },
  },
};

export default meta;
type Story = StoryObj<CardComponent>;

const body = `
  <h3 class="m-0 text-base font-semibold text-gray-900">Today's takings</h3>
  <p class="mt-1 mb-0 text-sm text-gray-600">42 transactions · $1,284.50</p>
`;

/**
 * Default card - medium padding
 */
export const Default: Story = {
  args: { padding: 'md', hover: false, clickable: false },
  render: (args) => ({
    props: args,
    template: `<app-card [padding]="padding" [hover]="hover" [clickable]="clickable">${body}</app-card>`,
  }),
};

/**
 * Unpadded card - the caller owns its own spacing
 */
export const NoPadding: Story = {
  args: { padding: 'none', hover: false, clickable: false },
  render: (args) => ({
    props: args,
    template: `<app-card [padding]="padding"><div class="p-4">${body}</div></app-card>`,
  }),
};

/**
 * Compact card - dense lists
 */
export const SmallPadding: Story = {
  args: { padding: 'sm', hover: false, clickable: false },
  render: (args) => ({
    props: args,
    template: `<app-card [padding]="padding">${body}</app-card>`,
  }),
};

/**
 * Roomy card - a page-level panel
 */
export const LargePadding: Story = {
  args: { padding: 'lg', hover: false, clickable: false },
  render: (args) => ({
    props: args,
    template: `<app-card [padding]="padding">${body}</app-card>`,
  }),
};

/**
 * Hoverable card - hints at interactivity without claiming to be a button
 */
export const Hoverable: Story = {
  args: { padding: 'md', hover: true, clickable: false },
  render: (args) => ({
    props: args,
    template: `<app-card [padding]="padding" [hover]="hover">${body}</app-card>`,
  }),
};

/**
 * Clickable card - the whole surface selects
 */
export const Clickable: Story = {
  args: { padding: 'md', hover: false, clickable: true },
  render: (args) => ({
    props: args,
    template: `<app-card [padding]="padding" [clickable]="clickable">${body}</app-card>`,
  }),
};
