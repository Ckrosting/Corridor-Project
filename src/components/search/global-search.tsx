'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Search, User } from 'lucide-react';
import { Spinner } from '@/components/ui/primitives';

interface SearchHit {
  kind: 'property' | 'contact';
  id: string;
  title: string;
  subtitle: string | null;
}

/** Portfolio-wide search across properties and contacts. */
export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl/Cmd-K focuses the box from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    // Debounced so typing does not fire a request per keystroke.
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) throw new Error('search failed');
        const data = (await res.json()) as { hits: SearchHit[] };
        setHits(data.hits);
        setCursor(0);
        setOpen(true);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setHits([]);
      } finally {
        setLoading(false);
      }
    }, 220);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  function go(hit: SearchHit) {
    setOpen(false);
    setQuery('');
    router.push(hit.kind === 'property' ? `/properties/${hit.id}` : `/contacts/${hit.id}`);
  }

  return (
    <div ref={boxRef} className="relative w-72">
      <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-400" />
      <input
        ref={inputRef}
        className="input pl-8 text-sm"
        placeholder="Search properties and contacts…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => hits.length > 0 && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
          if (!open || hits.length === 0) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          if (e.key === 'Enter') { e.preventDefault(); const hit = hits[cursor]; if (hit) go(hit); }
        }}
      />
      {loading && <Spinner className="absolute top-1/2 right-2.5 -translate-y-1/2 text-ink-400" />}

      {open && (
        <div className="absolute top-full right-0 left-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-md border border-ink-200 bg-white py-1 shadow-lg scroll-thin">
          {hits.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-ink-500">
              No matches for “{query.trim()}”
            </div>
          ) : (
            hits.map((hit, i) => (
              <button
                key={`${hit.kind}-${hit.id}`}
                type="button"
                onClick={() => go(hit)}
                onMouseEnter={() => setCursor(i)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left ${
                  i === cursor ? 'bg-accent-50' : 'hover:bg-ink-50'
                }`}
              >
                {hit.kind === 'property'
                  ? <Building2 size={14} className="mt-0.5 shrink-0 text-ink-400" />
                  : <User size={14} className="mt-0.5 shrink-0 text-ink-400" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink-900">{hit.title}</span>
                  {hit.subtitle && <span className="block truncate text-[11px] text-ink-500">{hit.subtitle}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
