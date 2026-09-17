'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { formatDateTime, UNKNOWN } from '@/lib/format';
import {
  AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS, auditEntityHref, humanizeAuditTerm,
} from '@/lib/audit-labels';

export interface AuditRowView {
  id: string;
  entityType: string;
  entityId: string | null;
  action: string;
  summary: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  actorLabel: string | null;
  createdAt: string;
}

export function AuditRows({ rows }: { rows: AuditRowView[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-ink-50 text-left text-[11px] text-ink-500">
        <tr>
          <th className="w-8 px-3 py-2" />
          <th className="px-3 py-2 font-medium">When</th>
          <th className="px-3 py-2 font-medium">Who</th>
          <th className="px-3 py-2 font-medium">Entity</th>
          <th className="px-3 py-2 font-medium">Action</th>
          <th className="px-3 py-2 font-medium">Summary</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const fields = row.changes ? Object.entries(row.changes) : [];
          const expanded = Boolean(open[row.id]);
          const href = auditEntityHref(row.entityType, row.entityId);

          return (
            <Fragment key={row.id}>
              <tr className="border-t border-ink-100 align-top hover:bg-ink-50">
                <td className="px-3 py-2">
                  {fields.length > 0 && (
                    <button
                      type="button"
                      className="text-ink-500 hover:text-ink-800"
                      aria-expanded={expanded}
                      aria-label={expanded ? 'Hide changed fields' : 'Show changed fields'}
                      onClick={() => setOpen((o) => ({ ...o, [row.id]: !o[row.id] }))}
                    >
                      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-ink-600">{formatDateTime(row.createdAt)}</td>
                <td className="px-3 py-2 text-ink-700">{row.actorLabel ?? UNKNOWN}</td>
                <td className="px-3 py-2">
                  <span className="text-ink-800">{humanizeAuditTerm(row.entityType, AUDIT_ENTITY_LABELS)}</span>
                  {href && (
                    <Link href={href} className="ml-1.5 inline-flex items-center gap-0.5 text-accent-700 hover:underline">
                      open <ExternalLink size={11} />
                    </Link>
                  )}
                </td>
                <td className="px-3 py-2 text-ink-700">{humanizeAuditTerm(row.action, AUDIT_ACTION_LABELS)}</td>
                <td className="px-3 py-2 text-ink-600">
                  {row.summary ?? UNKNOWN}
                  {fields.length > 0 && !expanded && (
                    <span className="ml-1.5 text-[11px] text-ink-400">
                      ({fields.length} field{fields.length === 1 ? '' : 's'} changed)
                    </span>
                  )}
                </td>
              </tr>

              {expanded && (
                <tr className="bg-ink-50">
                  <td />
                  <td colSpan={5} className="px-3 pt-0 pb-3">
                    <dl className="space-y-1">
                      {fields.map(([field, diff]) => (
                        <div key={field} className="flex flex-wrap items-baseline gap-1.5">
                          <dt className="font-medium text-ink-700">{field}</dt>
                          <dd className="flex flex-wrap items-baseline gap-1.5 text-ink-600">
                            <code className="rounded bg-white px-1 py-0.5 text-[11px] text-ink-500 line-through">
                              {renderValue(diff.from)}
                            </code>
                            <span className="text-ink-400">→</span>
                            <code className="rounded bg-white px-1 py-0.5 text-[11px] text-ink-800">
                              {renderValue(diff.to)}
                            </code>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return UNKNOWN;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
