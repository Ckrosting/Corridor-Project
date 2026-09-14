import Link from 'next/link';
import { ArrowLeft, Download } from 'lucide-react';
import { requirePageAdmin } from '@/lib/auth/guards';
import { MallImporter } from './mall-importer';

export const metadata = { title: 'Import & export' };
export const dynamic = 'force-dynamic';

export default async function ImportsPage() {
  await requirePageAdmin('/settings/imports');

  return (
    <>
      <header className="shrink-0 border-b border-ink-200 bg-white px-6 py-3">
        <div className="mb-1 flex items-center gap-2 text-xs text-ink-500">
          <Link href="/settings" className="flex items-center gap-1 hover:text-accent-700">
            <ArrowLeft size={12} /> Settings
          </Link>
        </div>
        <h1 className="text-base font-semibold tracking-tight text-ink-900">Import &amp; export</h1>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-[1000px] space-y-5">

          <section className="card">
            <div className="card-header"><h2 className="card-title">Exports</h2></div>
            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
              <ExportLink
                href="/api/export/properties" label="Properties"
                body="Every property with its market, parcel IDs and corridors."
              />
              <ExportLink
                href="/api/export/contacts" label="Contacts"
                body="Shared contacts with their linked property counts."
              />
              <ExportLink
                href="/api/export/malls" label="Malls"
                body="Mall anchors with coordinates and placement flags."
              />
            </div>
            <div className="border-t border-ink-100 px-4 py-3">
              <p className="text-[11px] leading-relaxed text-ink-500">
                Every export begins with the record&rsquo;s stable ID. Keep that column intact and an
                edited sheet can be re-imported to update the same rows rather than creating
                duplicates.
              </p>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Mall import</h2>
              <Link href="/api/export/mall-template" className="btn-secondary btn-sm" prefetch={false}>
                <Download size={13} /> Download template
              </Link>
            </div>
            <div className="p-4">
              <MallImporter />
            </div>
          </section>

          <section className="card">
            <div className="card-header"><h2 className="card-title">About spreadsheet formats</h2></div>
            <div className="space-y-2 p-4 text-xs leading-relaxed text-ink-600">
              <p>
                <strong>CSV is supported directly.</strong> If your mall list is an XLSX workbook,
                open it in Excel and use <em>File → Save As → CSV UTF-8</em>, then upload that file.
              </p>
              <p>
                Column names do not have to match exactly — common spellings such as
                &ldquo;Mall Name&rdquo;, &ldquo;mall_name&rdquo;, &ldquo;Address&rdquo; and
                &ldquo;Lat&rdquo; are recognised automatically, and anything unrecognised can be
                mapped by hand in the preview.
              </p>
              <p>
                Latitude and longitude are optional. A mall imported without coordinates is kept and
                flagged <strong>needs map placement</strong> rather than being dropped or given an
                invented location, and corridor boundaries are never auto-created as if they were
                confirmed.
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function ExportLink({ href, label, body }: { href: string; label: string; body: string }) {
  return (
    <Link href={href} prefetch={false} className="rounded-md border border-ink-200 p-3 transition-colors hover:bg-ink-50">
      <div className="flex items-center gap-1.5 text-sm font-medium text-ink-900">
        <Download size={13} /> {label}
      </div>
      <p className="mt-1 text-[11px] text-ink-500">{body}</p>
    </Link>
  );
}
