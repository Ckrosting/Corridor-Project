'use client';

import { useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { LISTING_STATUS_LABELS } from '@/lib/format';

/**
 * Filters live in the URL rather than component state, so a filtered list can be
 * bookmarked, shared with a colleague, and survives the browser back button.
 */
export function PropertyFiltersBar({
  markets, statuses, propertyTypes,
}: {
  markets: Array<{ id: string; name: string }>;
  statuses: Array<{ id: string; label: string; color: string }>;
  propertyTypes: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');

  const apply = useCallback((mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    router.push(`${pathname}?${next.toString()}`);
  }, [params, pathname, router]);

  const toggleMulti = (key: string, value: string) => apply((p) => {
    const current = (p.get(key) ?? '').split(',').filter(Boolean);
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    if (next.length) p.set(key, next.join(',')); else p.delete(key);
  });

  const isOn = (key: string, value: string) => (params.get(key) ?? '').split(',').includes(value);
  const activeCount = ['marketId', 'status', 'listing', 'type', 'pipeline', 'q', 'needsOutline']
    .filter((k) => params.get(k) && params.get(k) !== 'any').length;

  return (
    <div className="shrink-0 space-y-2 border-b border-ink-200 bg-white px-6 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative"
          onSubmit={(e) => { e.preventDefault(); apply((p) => { if (search.trim()) p.set('q', search.trim()); else p.delete('q'); }); }}
        >
          <Search size={13} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-400" />
          <input
            className="input w-56 py-1 pl-7 text-xs"
            placeholder="Name, address, parcel ID, owner…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>

        <select
          className="input w-auto py-1 text-xs"
          value={params.get('marketId') ?? ''}
          onChange={(e) => apply((p) => { if (e.target.value) p.set('marketId', e.target.value); else p.delete('marketId'); })}
        >
          <option value="">All markets</option>
          {markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>

        <select
          className="input w-auto py-1 text-xs"
          value={params.get('pipeline') ?? 'any'}
          onChange={(e) => apply((p) => { if (e.target.value !== 'any') p.set('pipeline', e.target.value); else p.delete('pipeline'); })}
        >
          <option value="any">Pipeline: all</option>
          <option value="in_pipeline">In the pipeline</option>
          <option value="not_in_pipeline">Not in the pipeline</option>
        </select>

        <select
          className="input w-auto py-1 text-xs"
          value={params.get('sort') ?? 'updated'}
          onChange={(e) => apply((p) => p.set('sort', e.target.value))}
        >
          <option value="updated">Recently updated</option>
          <option value="name">Name</option>
          <option value="followup">Follow-up date</option>
          <option value="price">Asking price</option>
        </select>

        <label className="flex items-center gap-1.5 text-xs text-ink-600">
          <input
            type="checkbox"
            checked={params.get('needsOutline') === 'true'}
            onChange={(e) => apply((p) => { if (e.target.checked) p.set('needsOutline', 'true'); else p.delete('needsOutline'); })}
          />
          Needs parcel outline
        </label>

        <label className="flex items-center gap-1.5 text-xs text-ink-600">
          <input
            type="checkbox"
            checked={params.get('includeSample') !== 'false'}
            onChange={(e) => apply((p) => { if (!e.target.checked) p.set('includeSample', 'false'); else p.delete('includeSample'); })}
          />
          Show sample data
        </label>

        <label className="flex items-center gap-1.5 text-xs text-ink-600">
          <input
            type="checkbox"
            checked={params.get('includeArchived') === 'true'}
            onChange={(e) => apply((p) => { if (e.target.checked) p.set('includeArchived', 'true'); else p.delete('includeArchived'); })}
          />
          Show deleted
        </label>

        {activeCount > 0 && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => { setSearch(''); router.push(pathname); }}>
            <X size={12} /> Clear
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Chips label="Status" items={statuses.map((s) => ({ value: s.id, label: s.label, color: s.color }))}
          isOn={(v) => isOn('status', v)} onToggle={(v) => toggleMulti('status', v)} />
        <Chips label="Listing" items={Object.entries(LISTING_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          isOn={(v) => isOn('listing', v)} onToggle={(v) => toggleMulti('listing', v)} />
        <Chips label="Type" items={propertyTypes.map((t) => ({ value: t, label: t }))}
          isOn={(v) => isOn('type', v)} onToggle={(v) => toggleMulti('type', v)} />
      </div>
    </div>
  );
}

function Chips({
  label, items, isOn, onToggle,
}: {
  label: string;
  items: Array<{ value: string; label: string; color?: string }>;
  isOn(value: string): boolean;
  onToggle(value: string): void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-semibold tracking-wider text-ink-400 uppercase">{label}</span>
      {items.map((item) => {
        const active = isOn(item.value);
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onToggle(item.value)}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
              active
                ? 'border-accent-600 bg-accent-600 font-medium text-white'
                : 'border-ink-300 bg-white text-ink-600 hover:bg-ink-100'
            }`}
          >
            {item.color && !active && (
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.color }} />
            )}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
