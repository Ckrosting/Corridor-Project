'use client';

import dynamic from 'next/dynamic';
import { Spinner } from '@/components/ui/primitives';

/**
 * Leaflet touches `window` at import time, so the map must never be rendered on
 * the server. This wrapper is the only entry point the rest of the app uses.
 */
export const Map = dynamic(() => import('./map-view').then((m) => m.MapView), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-ink-200">
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Spinner /> Loading map…
      </div>
    </div>
  ),
});

export type {
  DrawMode, MapAnchor, MapCorridor, MapParcel, MapProperty, MapViewHandle,
} from './map-view';
