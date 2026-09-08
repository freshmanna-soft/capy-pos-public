import type { Meta, StoryObj } from '@storybook/angular';
import { ModalComponent } from '@shared/ui/molecules/modal/modal.component';
import { ButtonComponent } from '@shared/ui/atoms/button/button.component';
import { moduleMetadata } from '@storybook/angular';

/**
 * Modal Component Stories
 * Demonstrates the sheet/centred presentations, the footer slot and the
 * non-dismissible destructive confirmation
 * Used for component documentation and visual testing
 */
const meta: Meta<ModalComponent> = {
  title: 'Molecules/Modal',
  component: ModalComponent,
  tags: ['autodocs'],
  decorators: [moduleMetadata({ imports: [ButtonComponent] })],
  argTypes: {
    heading: { control: 'text', description: 'Dialog title, referenced by aria-labelledby' },
    maxWidth: { control: 'text', description: 'Max width of the panel' },
    sheet: {
      control: 'boolean',
      description: 'Slide up from the bottom edge on phones instead of sitting centred',
    },
    hasFooter: { control: 'boolean', description: 'Render the projected footer actions' },
    dismissOnBackdrop: {
      control: 'boolean',
      description: 'Whether a backdrop click requests dismissal',
    },
    dismissed: {
      action: 'dismissed',
      description: 'A dismissal was requested — the parent decides what happens',
    },
  },
};

export default meta;
type Story = StoryObj<ModalComponent>;

/**
 * Default modal - bottom sheet on phones, centred from md up
 */
export const Default: Story = {
  args: {
    heading: 'Add product',
    maxWidth: '640px',
    sheet: true,
    hasFooter: true,
    dismissOnBackdrop: true,
  },
  render: (args) => ({
    props: args,
    template: `
      <app-modal
        [heading]="heading"
        [maxWidth]="maxWidth"
        [sheet]="sheet"
        [hasFooter]="hasFooter"
        [dismissOnBackdrop]="dismissOnBackdrop"
        (dismissed)="dismissed($event)"
      >
        <p class="m-0 text-sm text-gray-600">Body content is projected into the scrolling region.</p>
        <div modalFooter>
          <app-button variant="secondary">Cancel</app-button>
          <app-button variant="primary">Save</app-button>
        </div>
      </app-modal>
    `,
  }),
};

/**
 * Without a footer - an informational dialog with nothing to confirm
 */
export const WithoutFooter: Story = {
  args: { heading: 'Sync details', hasFooter: false, sheet: true },
  render: (args) => ({
    props: args,
    template: `
      <app-modal [heading]="heading" [hasFooter]="hasFooter" [sheet]="sheet">
        <p class="m-0 text-sm text-gray-600">Last synced 3 minutes ago. 0 pending transactions.</p>
      </app-modal>
    `,
  }),
};

/**
 * Centred on every breakpoint - not a sheet
 */
export const Centred: Story = {
  args: { heading: 'Switch tenant', sheet: false, hasFooter: true, maxWidth: '420px' },
  render: (args) => ({
    props: args,
    template: `
      <app-modal [heading]="heading" [sheet]="sheet" [hasFooter]="hasFooter" [maxWidth]="maxWidth">
        <p class="m-0 text-sm text-gray-600">Choose the store you want to operate.</p>
        <div modalFooter>
          <app-button variant="primary">Continue</app-button>
        </div>
      </app-modal>
    `,
  }),
};

/**
 * Destructive confirmation - a stray backdrop click must not answer for the user
 */
export const NotDismissibleOnBackdrop: Story = {
  args: {
    heading: 'Void this transaction?',
    dismissOnBackdrop: false,
    hasFooter: true,
    maxWidth: '420px',
  },
  render: (args) => ({
    props: args,
    template: `
      <app-modal
        [heading]="heading"
        [dismissOnBackdrop]="dismissOnBackdrop"
        [hasFooter]="hasFooter"
        [maxWidth]="maxWidth"
      >
        <p class="m-0 text-sm text-gray-600">This cannot be undone.</p>
        <div modalFooter>
          <app-button variant="secondary">Keep</app-button>
          <app-button variant="danger">Void</app-button>
        </div>
      </app-modal>
    `,
  }),
};

/**
 * Long body - only the body scrolls; header and actions stay put
 */
export const LongBody: Story = {
  args: { heading: 'Terms', hasFooter: true },
  render: (args) => ({
    props: { ...args, lines: Array.from({ length: 30 }, (_, i) => i + 1) },
    template: `
      <app-modal [heading]="heading" [hasFooter]="hasFooter">
        @for (line of lines; track line) {
          <p class="text-sm text-gray-600">Paragraph {{ line }} of a long scrolling body.</p>
        }
        <div modalFooter>
          <app-button variant="primary">Accept</app-button>
        </div>
      </app-modal>
    `,
  }),
};
