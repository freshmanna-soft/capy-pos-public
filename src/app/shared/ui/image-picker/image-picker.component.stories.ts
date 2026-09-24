import type { Meta, StoryObj } from '@storybook/angular';
import { ImagePickerComponent } from './image-picker.component';

/**
 * ImagePickerComponent Stories
 *
 * Lets the operator set a product or category image via file upload, camera
 * capture, or URL. Camera capture is disabled in Storybook (no MediaDevices).
 */
const meta: Meta<ImagePickerComponent> = {
  title: 'Shared/UI/ImagePicker',
  component: ImagePickerComponent,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<ImagePickerComponent>;

export const Empty: Story = {
  args: {
    imageUrl: '',
    productId: 'product-preview',
  },
};

export const WithImage: Story = {
  args: {
    imageUrl: 'https://placehold.co/200x200?text=Product',
    productId: 'product-with-image',
  },
};
