import Link from 'next/link';
import { ArrowLeft, Map as MapIcon } from 'lucide-react';
import { requirePageUser } from '@/lib/auth/guards';
import { configStatus } from '@/lib/env';
import { Field, Value } from '@/components/ui/primitives';

export const metadata = { title: 'Map providers' };
export const dynamic = 'force-dynamic';

export default async function MapSettingsPage() {
  await requirePageUser('/settings/map');
  const config = configStatus();
  const satelliteProvider = process.env.NEXT_PUBLIC_SATELLITE_PROVIDER ?? '';

  return (
    <>
      <header className="shrink-0 border-b border-ink-200 bg-white px-6 py-3">
        <div className="mb-1 flex items-center gap-2 text-xs text-ink-500">
          <Link href="/settings" className="flex items-center gap-1 hover:text-accent-700">
            <ArrowLeft size={12} /> Settings
          </Link>
        </div>
        <h1 className="flex items-center gap-1.5 text-base font-semibold tracking-tight text-ink-900">
          <MapIcon size={16} /> Map providers
        </h1>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-[900px] space-y-5">

          <div className="banner-info">
            <span>
              Leaflet renders the map; it is not a source of map imagery or addresses. Every basemap
              and geocoder below belongs to a third party with its own terms, attribution
              requirements and usage limits.
            </span>
          </div>

          <section className="card">
            <div className="card-header"><h2 className="card-title">Basemaps</h2></div>
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Street basemap" hint="Always available; attribution is rendered on the map">
                  <Value>OpenStreetMap</Value>
                </Field>
                <Field label="Satellite provider" hint="NEXT_PUBLIC_SATELLITE_PROVIDER">
                  <Value>{satelliteProvider || undefined}</Value>
                </Field>
              </div>

              {!satelliteProvider ? (
                <div className="banner-warn">
                  <span>
                    <strong>No satellite imagery configured.</strong> The map shows the street
                    basemap only, and says so. To enable satellite, set
                    {' '}<code className="rounded bg-amber-100 px-1">NEXT_PUBLIC_SATELLITE_PROVIDER</code>{' '}
                    to <code className="rounded bg-amber-100 px-1">mapbox</code>,
                    {' '}<code className="rounded bg-amber-100 px-1">maptiler</code> or
                    {' '}<code className="rounded bg-amber-100 px-1">esri</code>, plus the matching key.
                  </span>
                </div>
              ) : (
                <div className="banner-ok">
                  <span>Satellite imagery is configured via {satelliteProvider}, with its attribution rendered on the map.</span>
                </div>
              )}

              <p className="field-hint">
                Provider tokens used for browser tile requests are necessarily visible to anyone
                using the app — that is inherent to client-side tile loading. Scope and
                URL-restrict them at the provider. Server-side secrets are never exposed this way.
              </p>
            </div>
          </section>

          <section className="card">
            <div className="card-header"><h2 className="card-title">Geocoding</h2></div>
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Provider" hint="GEOCODER_PROVIDER">
                  <Value>{config.geocoder.provider}</Value>
                </Field>
                <Field label="API key" hint="GEOCODER_API_KEY (server-side only)">
                  <Value>{config.geocoder.apiKeyConfigured ? 'Configured' : undefined}</Value>
                </Field>
              </div>

              {config.geocoder.provider === 'nominatim' ? (
                <div className="banner-warn">
                  <span>
                    <strong>Nominatim is the no-key default and is not suitable for volume.</strong>{' '}
                    Its usage policy limits requests to roughly one per second and forbids bulk use,
                    so it is fine for looking up the occasional address but not for geocoding a
                    whole mall import. Configure a commercial provider before importing large lists.
                  </span>
                </div>
              ) : (
                <div className="banner-info">
                  <span>
                    Commercial geocoders have quotas and per-request costs. Address lookup failures
                    are never fatal — the map always allows placing a location by hand.
                  </span>
                </div>
              )}

              <p className="field-hint">
                Address lookup runs server-side, so the geocoding key never reaches the browser.
              </p>
            </div>
          </section>

          <section className="card">
            <div className="card-header"><h2 className="card-title">Boundary accuracy</h2></div>
            <div className="p-4 text-xs leading-relaxed text-ink-600">
              <p>
                Parcel outlines drawn in this application are
                <strong> approximate research outlines</strong>. They are not surveyed lines and not
                official tax parcel boundaries, and are labelled as such wherever they appear.
                County GIS integration and parcel-map uploads are deliberately out of scope for this
                version.
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
