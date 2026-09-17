import Link from 'next/link';
import { ArrowLeft, ScrollText } from 'lucide-react';
import { requirePageAdmin } from '@/lib/auth/guards';
import {
  listAuditActions, listAuditActors, listAuditEntityTypes, listAuditLog,
} from '@/lib/services/audit-log';
import { AuditFilters } from './audit-filters';
import { AuditRows } from './audit-rows';

export const metadata = { title: 'Audit log' };
export const dynamic = 'force-dynamic';

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageAdmin('/settings/audit');
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]);

  const [page, entityTypes, actions, actors] = await Promise.all([
    listAuditLog({
      entityType: one('entityType'),
      action: one('action'),
      actorUserId: one('actor'),
      from: one('from'),
      to: one('to'),
      cursor: one('cursor'),
    }),
    listAuditEntityTypes(),
    listAuditActions(),
    listAuditActors(),
  ]);

  const nextHref = page.nextCursor
    ? `?${new URLSearchParams({ ...sp as Record<string, string>, cursor: page.nextCursor }).toString()}`
    : null;

  return (
    <>
      <header className="shrink-0 border-b border-ink-200 bg-white px-6 py-3">
        <div className="mb-1 flex items-center gap-2 text-xs text-ink-500">
          <Link href="/settings" className="flex items-center gap-1 hover:text-accent-700">
            <ArrowLeft size={12} /> Settings
          </Link>
        </div>
        <h1 className="flex items-center gap-1.5 text-base font-semibold tracking-tight text-ink-900">
          <ScrollText size={16} /> Audit log
        </h1>
        <p className="text-xs text-ink-500">
          Every create, update, archive and restore this app has recorded, oldest hidden behind
          filters rather than lost. Read-only - nothing here can be edited or deleted.
        </p>
      </header>

      <AuditFilters entityTypes={entityTypes} actions={actions} actors={actors} />

      <div className="scroll-thin flex-1 overflow-y-auto">
        {page.rows.length === 0 ? (
          <div className="p-6 text-sm text-ink-500">No audit entries match these filters.</div>
        ) : (
          <AuditRows
            rows={page.rows.map((r) => ({
              id: r.id,
              entityType: r.entityType,
              entityId: r.entityId,
              action: r.action,
              summary: r.summary,
              changes: r.changes,
              actorLabel: r.actorLabel,
              createdAt: r.createdAt.toISOString(),
            }))}
          />
        )}

        {nextHref && (
          <div className="p-4">
            <Link href={nextHref} className="btn-secondary btn-sm">Load older entries</Link>
          </div>
        )}
      </div>
    </>
  );
}
