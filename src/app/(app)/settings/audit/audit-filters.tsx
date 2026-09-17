'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import {
  AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS, humanizeAuditTerm,
} from '@/lib/audit-labels';

/**
 * Filters live in the URL so a filtered view can be bookmarked and shared, and
 * so the cursor for the next page travels with them.
 */
export function AuditFilters({
  entityTypes, actions, actors,
}: {
  entityTypes: string[];
  actions: string[];
  actors: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const apply = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    // Any filter change invalidates the page cursor.
    next.delete('cursor');
    router.push(`${pathname}?${next.toString()}`);
  }, [params, pathname, router]);

  const keys = ['entityType', 'action', 'actor', 'from', 'to'];
  const activeCount = keys.filter((k) => params.get(k)).length;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 bg-white px-6 py-2.5">
      <select
        className="input w-auto py-1 text-xs"
        value={params.get('entityType') ?? ''}
        onChange={(e) => apply('entityType', e.target.value)}
      >
        <option value="">All entity types</option>
        {entityTypes.map((t) => (
          <option key={t} value={t}>{humanizeAuditTerm(t, AUDIT_ENTITY_LABELS)}</option>
        ))}
      </select>

      <select
        className="input w-auto py-1 text-xs"
        value={params.get('action') ?? ''}
        onChange={(e) => apply('action', e.target.value)}
      >
        <option value="">All actions</option>
        {actions.map((a) => (
          <option key={a} value={a}>{humanizeAuditTerm(a, AUDIT_ACTION_LABELS)}</option>
        ))}
      </select>

      <select
        className="input w-auto py-1 text-xs"
        value={params.get('actor') ?? ''}
        onChange={(e) => apply('actor', e.target.value)}
      >
        <option value="">Anyone</option>
        {actors.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
      </select>

      <label className="flex items-center gap-1.5 text-xs text-ink-600">
        From
        <input
          type="date"
          className="input w-auto py-1 text-xs"
          value={params.get('from') ?? ''}
          onChange={(e) => apply('from', e.target.value)}
        />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-ink-600">
        To
        <input
          type="date"
          className="input w-auto py-1 text-xs"
          value={params.get('to') ?? ''}
          onChange={(e) => apply('to', e.target.value)}
        />
      </label>

      {activeCount > 0 && (
        <button type="button" className="btn-ghost btn-sm" onClick={() => router.push(pathname)}>
          <X size={13} /> Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}
