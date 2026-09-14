'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { CONTACT_ROLE_LABELS } from '@/lib/format';

export function ContactSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');

  const apply = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ink-200 bg-white px-6 py-2.5">
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          apply((p) => { if (q.trim()) p.set('q', q.trim()); else p.delete('q'); });
        }}
      >
        <Search size={13} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-400" />
        <input
          className="input w-64 py-1 pl-7 text-xs"
          placeholder="Name, company, phone or email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </form>

      <select
        className="input w-auto py-1 text-xs"
        value={params.get('role') ?? ''}
        onChange={(e) => apply((p) => { if (e.target.value) p.set('role', e.target.value); else p.delete('role'); })}
      >
        <option value="">All roles</option>
        {Object.entries(CONTACT_ROLE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>

      {(params.get('q') || params.get('role')) && (
        <button type="button" className="btn-ghost btn-sm" onClick={() => { setQ(''); router.push(pathname); }}>
          <X size={12} /> Clear
        </button>
      )}
    </div>
  );
}
