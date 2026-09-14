import Link from 'next/link';
import { ArrowLeft, Palette } from 'lucide-react';
import { requirePageAdmin } from '@/lib/auth/guards';
import { listStagesWithUsage, listStatusesWithUsage } from '@/lib/services/taxonomy';
import { TaxonomyEditor } from './taxonomy-editor';

export const metadata = { title: 'Statuses & stages' };
export const dynamic = 'force-dynamic';

export default async function StatusesPage() {
  await requirePageAdmin('/settings/statuses');

  const [statuses, stages] = await Promise.all([
    listStatusesWithUsage(),
    listStagesWithUsage(),
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
          <Palette size={16} /> Statuses &amp; stages
        </h1>
        <p className="text-xs text-ink-500">
          Outreach status tracks research and contact. Transaction stage tracks a real deal. They
          are deliberately separate, and so is listing status.
        </p>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-[1000px] space-y-5">
          <TaxonomyEditor
            kind="status"
            title="Outreach statuses"
            blurb="How far along research and contact are. Renaming one is safe — nothing references the label."
            items={statuses.map((s) => ({
              id: s.s.id,
              label: s.s.label,
              color: s.s.color,
              sortOrder: s.s.sortOrder,
              isDefault: s.s.isDefault,
              flag: s.s.countsAsActivePursuit,
              inUse: s.inUse,
            }))}
            flagLabel="Counts as actively pursued"
            flagHint="Included in the “no follow-up scheduled” work queue."
            usageNoun="property"
          />

          <TaxonomyEditor
            kind="stage"
            title="Transaction stages"
            blurb="Progress on an actual potential acquisition. A property reaches a stage only after an explicit promotion."
            items={stages.map((s) => ({
              id: s.s.id,
              label: s.s.label,
              color: s.s.color,
              sortOrder: s.s.sortOrder,
              isDefault: s.s.isDefault,
              flag: s.s.isTerminal,
              inUse: s.inUse,
              category: s.s.category,
            }))}
            flagLabel="Closes the deal"
            flagHint="Terminal stages drop off the active board but keep full history and can be reopened."
            usageNoun="opportunity"
          />
        </div>
      </div>
    </>
  );
}
