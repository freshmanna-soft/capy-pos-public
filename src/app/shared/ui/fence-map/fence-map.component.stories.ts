import type { Meta, StoryObj } from '@storybook/angular';
import { FenceMapComponent } from './fence-map.component';
import type { LatLng } from '@core/application/services/kiosk-settings.service';

/**
 * FenceMapComponent Stories
 *
 * OpenStreetMap-powered polygon editor for configuring a store's geofence.
 * Leaflet is loaded lazily, so the map renders only in a real browser context.
 * In Storybook the canvas will be blank in jsdom; use a real browser preview.
 */
const meta: Meta<FenceMapComponent> = {
  title: 'Shared/UI/FenceMap',
  component: FenceMapComponent,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<FenceMapComponent>;

export const NoFence: Story = {
  args: {
    initialPolygon: [] as LatLng[],
  },
};

export const WithFence: Story = {
  args: {
    initialPolygon: [
      { lat: 40.715, lng: -74.009 },
      { lat: 40.715, lng: -74.003 },
      { lat: 40.711, lng: -74.003 },
      { lat: 40.711, lng: -74.009 },
    ] as LatLng[],
  },
};
