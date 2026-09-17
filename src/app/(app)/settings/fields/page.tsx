import Link from 'next/link';
import { isNotNull, sql as raw } from 'drizzle-orm';
import { ArrowLeft, Tags } from 'lucide-react';
import { db } from '@/db';
import { properties } from '@/db/schema';
import { requirePageAdmin } from '@/lib/auth/guards';
import { listCustomFields } from '@/lib/services/taxonomy';
import { listTagsWithUsage } from '@/lib/services/tags';
import { getPropertyTypes } from '@/lib/services/settings';
import { CustomFieldEditor } from './custom-field-editor';
import { PropertyTypeEditor } from './property-type-editor';
import { TagEditor } from './tag-editor';

export const metadata = { title: 'Custom fields & tags' };
export const dynamic = 'force-dynamic';

export default async function FieldsPage() {
  await requirePageAdmin('/settings/fields');

  const [fields, tagRows, propertyTypes, typeUsage] = await Promise.all([
    listCustomFields(),
    listTagsWithUsage(),
    getPropertyTypes(),
    db
      .select({ type: properties.propertyType, n: raw<number>`count(*)::int` })
      .from(properties)
      .where(isNotNull(properties.propertyType))
      .groupBy(properties.propertyType),
  ]);

  const usage = Object.fromEntries(typeUsage.map((r) => [r.type!, r.n]));

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

          <TagEditor tags={tagRows} />

          <PropertyTypeEditor types={propertyTypes} usage={usage} />
        </div>
      </div>
    </>
  );
}
