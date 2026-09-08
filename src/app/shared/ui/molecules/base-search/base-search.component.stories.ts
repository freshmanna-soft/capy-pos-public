import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Observable, delay, of, throwError } from 'rxjs';
import type { Meta, StoryObj } from '@storybook/angular';
import { BaseSearchComponent } from '@shared/ui/molecules/base-search/base-search.component';

/**
 * BaseSearch Component Stories
 *
 * `BaseSearchComponent` is an abstract template-method directive, not a rendered
 * component — it owns the debounce, keyboard navigation, loading and error state
 * and leaves the markup plus `performSearch` to each concrete search.
 *
 * These stories therefore document the base class through a minimal concrete
 * subclass, `DemoSearchComponent`, which is the shape a real consumer (product
 * search, customer lookup) is expected to follow. Type into the field to see the
 * debounced pipeline run; the results below are in-memory.
 */
interface DemoItem {
  readonly id: string;
  readonly label: string;
  readonly soldOut: boolean;
}

const CATALOGUE: DemoItem[] = [
  { id: '1', label: 'Organic Coffee', soldOut: false },
  { id: '2', label: 'Capy Croissant', soldOut: false },
  { id: '3', label: 'Cold Brew Coffee', soldOut: true },
  { id: '4', label: 'Green Tea', soldOut: false },
];

/**
 * The smallest possible concrete search: an in-memory catalogue, a disabled rule
 * for sold-out items, and the markup the base class expects to drive.
 */
@Component({
  selector: 'app-demo-search',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-80">
      <input
        type="search"
        class="w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-lg"
        placeholder="Search products (min 2 characters)"
        role="combobox"
        aria-label="Search products"
        aria-controls="demo-search-listbox"
        [attr.aria-expanded]="searchResults().length > 0"
        [value]="searchQuery()"
        (input)="onSearchInput($event)"
        (keydown)="onKeyDown($event)"
      />

      @if (isLoading()) {
        <p class="mt-2 text-sm text-gray-500" aria-live="polite">Searching…</p>
      }
      @if (error()) {
        <p class="mt-2 text-sm text-red-600" role="alert">{{ error() }}</p>
      }

      @if (searchResults().length > 0) {
        <ul
          id="demo-search-listbox"
          role="listbox"
          class="mt-2 list-none p-0 m-0 border border-gray-200 rounded-lg overflow-hidden"
        >
          @for (item of searchResults(); track item.id; let i = $index) {
            <li
              class="px-3 py-2 text-sm cursor-pointer"
              [class.bg-blue-50]="i === highlightedIndex()"
              [class.opacity-50]="item.soldOut"
              [attr.aria-disabled]="item.soldOut"
              (click)="selectItem(item)"
              (keydown.enter)="selectItem(item)"
              role="option"
              [attr.aria-selected]="i === highlightedIndex()"
              tabindex="-1"
            >
              {{ item.label }}
            </li>
          }
        </ul>
      }
    </div>
  `,
})
class DemoSearchComponent extends BaseSearchComponent<DemoItem> {
  /** Set by the stories to show the failure path without a real backend. */
  failing = false;

  protected override performSearch(query: string): Observable<DemoItem[]> {
    if (this.failing) {
      return throwError(() => new Error('Search backend unavailable'));
    }
    const matches = CATALOGUE.filter((item) =>
      item.label.toLowerCase().includes(query.toLowerCase())
    );
    // Deliberately slow so the loading state is visible in the gallery.
    return of(matches).pipe(delay(600));
  }

  protected override getItemDisplayText(item: DemoItem): string {
    return item.label;
  }

  protected override getItemId(item: DemoItem): string {
    return item.id;
  }

  protected override isItemDisabled(item: DemoItem): boolean {
    return item.soldOut;
  }
}

const meta: Meta<DemoSearchComponent> = {
  title: 'Molecules/BaseSearch',
  component: DemoSearchComponent,
  tags: ['autodocs'],
  argTypes: {
    itemSelected: {
      action: 'itemSelected',
      description: 'Emits the chosen item — suppressed for disabled items',
    },
  },
};

export default meta;
type Story = StoryObj<DemoSearchComponent>;

/**
 * Interactive - type "co" to see the debounce, loading state and results
 */
export const Interactive: Story = {
  render: () => ({ template: '<app-demo-search />' }),
};

/**
 * Pre-populated results - keyboard navigation with ArrowUp/ArrowDown and Enter
 */
export const WithResults: Story = {
  render: () => ({ template: '<app-demo-search #search />' }),
  play: ({ canvasElement }) => {
    const field = canvasElement.querySelector<HTMLInputElement>('input[type="search"]');
    if (field) {
      field.value = 'coffee';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
  },
};

/**
 * Failure path - `performSearch` errors and the base class surfaces the message
 * instead of losing it
 */
export const SearchError: Story = {
  render: () => ({
    template: '<app-demo-search [failing]="true" />',
  }),
  play: ({ canvasElement }) => {
    const field = canvasElement.querySelector<HTMLInputElement>('input[type="search"]');
    if (field) {
      field.value = 'coffee';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
  },
};
