import Link from 'next/link';
import { asc, isNull, sql as raw } from 'drizzle-orm';
import { ArrowLeft, Tags } from 'lucide-react';
import { db } from '@/db';
import { tags } from '@/db/schema';
import { requirePageAdmin } from '@/lib/auth/guards';
import { listCustomFields } from '@/lib/services/taxonomy';
import { getPropertyTypes } from '@/lib/services/settings';
import { StatusChip } from '@/components/ui/primitives';
import { CustomFieldEditor } from './custom-field-editor';

export const metadata = { title: 'Custom fields & tags' };
export const dynamic = 'force-dynamic';

export default async function FieldsPage() {
  await requirePageAdmin('/settings/fields');

  const [fields, tagRows, propertyTypes] = await Promise.all([
    listCustomFields(),
    db
      .select({
        id: tags.id, name: tags.name, color: tags.color,
        inUse: raw<number>`(select count(*)::int from property_tags pt where pt.tag_id = tags.id)`,
      })
      .from(tags)
      .where(isNull(tags.archivedAt))
      .orderBy(asc(tags.name)),
    getPropertyTypes(),
  ]);

  return (
    <>
      <header className="shrink-0 border-b border-ink-200 bg-white px-6 py-3">
        <div className="mb-1 flex items-center gap-2 text-xs text-ink-500">
          <Link href="/settings" className="flex items-center gap-1 hover:text-accent-700">
            <ArrowLeft size={12} /> Settings
          </Link>
        </div>
        <h1 className="flex items-center gap-1.5 text-base font-semibold tracking-tight text-ink-900">
          <Tags size={16} /> Custom fields &amp; tags
        </h1>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-[1000px] space-y-5">

          <CustomFieldEditor
            fields={fields.map((f) => ({
              id: f.def.id,
              label: f.def.label,
              type: f.def.type,
              options: f.def.options,
              helpText: f.def.helpText,
              sortOrder: f.def.sortOrder,
              inUse: f.inUse,
            }))}
          />

          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Tags</h2>
              <span className="text-[11px] text-ink-500">{tagRows.length}</span>
            </div>
            {tagRows.length === 0 ? (
              <p className="p-4 text-xs text-ink-500">
                No tags yet. Tags are created from a property record and are shared across the
                whole portfolio.
              </p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {tagRows.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <StatusChip label={t.name} color={t.color} />
                    <span className="text-[11px] text-ink-500">
                      {t.inUse > 0 ? `${t.inUse} propert${t.inUse === 1 ? 'y' : 'ies'}` : 'not in use'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="card-header"><h2 className="card-title">Property types</h2></div>
            <div className="p-4">
              <div className="flex flex-wrap gap-1.5">
                {propertyTypes.map((t) => (
                  <span key={t} className="chip border-ink-200 bg-ink-50 text-ink-700">{t}</span>
                ))}
              </div>
              <p className="field-hint">
                The selectable property types. Any type is accepted on import, so an unfamiliar value
                from a spreadsheet is never silently dropped.
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
