import Link from 'next/link';
import { asc, isNull, sql as raw } from 'drizzle-orm';
import {
  Bot, Database, Download, Map, Palette, ScrollText, ShieldCheck, Tags, Users,
} from 'lucide-react';
import { db } from '@/db';
import { outreachStatuses, transactionStages, users } from '@/db/schema';
import { getActor, requirePageUser } from '@/lib/auth/guards';
import { configStatus } from '@/lib/env';
import { showSampleData } from '@/lib/services/settings';
import { monthToDateSpendUsd } from '@/lib/services/discovery';
import { StatusChip } from '@/components/ui/primitives';
import { SampleDataToggle } from './sample-toggle';

export const metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const actor = await requirePageUser();
  const isAdmin = actor.role === 'admin';

  const [statuses, stages, userRows, sampleVisible, spend] = await Promise.all([
    db.select().from(outreachStatuses).where(isNull(outreachStatuses.archivedAt)).orderBy(asc(outreachStatuses.sortOrder)),
    db.select().from(transactionStages).where(isNull(transactionStages.archivedAt)).orderBy(asc(transactionStages.sortOrder)),
    db.select({ id: users.id, name: users.name, email: users.email, role: users.role, isActive: users.isActive })
      .from(users).where(isNull(users.archivedAt)).orderBy(asc(users.name)),
    showSampleData(),
    monthToDateSpendUsd(),
  ]);

  const config = configStatus();
  const errors = config.problems.filter((p) => p.severity === 'error');
  const warnings = config.problems.filter((p) => p.severity === 'warning');

  return (
    <>
      <header className="shrink-0 border-b border-ink-200 bg-white px-6 py-3">
        <h1 className="text-base font-semibold tracking-tight text-ink-900">Settings</h1>
        <p className="text-xs text-ink-500">
          Configuration, statuses, users and data tools
          {!isAdmin && ' · some sections require an administrator account'}
        </p>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-[1100px] space-y-5">

          {/* ------------------------------------------- Configuration health */}
          <section className="card">
            <div className="card-header">
              <h2 className="card-title flex items-center gap-1.5">
                <ShieldCheck size={14} /> Configuration status
              </h2>
              <span className="text-[11px] text-ink-500">Environment: {config.nodeEnv}</span>
            </div>
            <div className="space-y-2 p-4">
              {errors.length === 0 && warnings.length === 0 && (
                <div className="banner-ok"><span>Everything required is configured.</span></div>
              )}
              {errors.map((p) => (
                <div key={p.key} className="banner-error">
                  <span><strong>{p.key}</strong> — {p.message}</span>
                </div>
              ))}
              {warnings.map((p) => (
                <div key={p.key} className="banner-warn">
                  <span><strong>{p.key}</strong> — {p.message}</span>
                </div>
              ))}

              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <ConfigItem label="Database" ok={config.database.configured} detail={config.database.ssl ? 'TLS enabled' : 'Local'} />
                <ConfigItem label="Authentication" ok={config.auth.secretConfigured}
                  detail={config.auth.devBypassActive ? 'Dev sign-in ON' : 'Password sign-in'} />
                <ConfigItem label="File storage" ok={config.storage.configured}
                  detail={`${config.storage.driver} · max ${config.storage.maxUploadMb} MB`} />
                <ConfigItem label="Discovery (AI)" ok={config.ai.apiKeyConfigured}
                  detail={config.ai.apiKeyConfigured ? config.ai.model : 'No API key'} />
              </div>

              <p className="field-hint">
                Secrets are never displayed here or sent to the browser — only whether each one is present.
              </p>
            </div>
          </section>

          {/* -------------------------------------------------------- Sections */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <SettingsCard
              href="/settings/statuses" icon={<Palette size={16} />}
              title="Statuses & stages"
              body={`${statuses.length} outreach statuses · ${stages.length} transaction stages. Rename, recolour, reorder and archive safely.`}
              adminOnly={!isAdmin}
            />
            <SettingsCard
              href="/settings/fields" icon={<Tags size={16} />}
              title="Custom fields & tags"
              body="Admin-managed text, number, date, checkbox and select fields on properties, plus the tag vocabulary."
              adminOnly={!isAdmin}
            />
            <SettingsCard
              href="/settings/ai" icon={<Bot size={16} />}
              title="Discovery & budget"
              body={config.ai.apiKeyConfigured
                ? `Model ${config.ai.model} · about $${spend.toFixed(2)} recorded this month.`
                : 'Not configured. The rest of the app works without it.'}
              adminOnly={!isAdmin}
            />
            <SettingsCard
              href="/settings/imports" icon={<Download size={16} />}
              title="Import & export"
              body="Mall import template, CSV import with preview and validation, and exports that keep stable IDs."
              adminOnly={!isAdmin}
            />
            <SettingsCard
              href="/settings/users" icon={<Users size={16} />}
              title="Users"
              body={`${userRows.length} account${userRows.length === 1 ? '' : 's'}. Admins manage users, settings, imports and destructive actions.`}
              adminOnly={!isAdmin}
            />
            <SettingsCard
              href="/settings/map" icon={<Map size={16} />}
              title="Map providers"
              body={`Geocoding via ${config.geocoder.provider}. Satellite imagery ${process.env.NEXT_PUBLIC_SATELLITE_PROVIDER ? 'configured' : 'not configured'}.`}
              adminOnly={false}
            />
            <SettingsCard
              href="/settings/audit" icon={<ScrollText size={16} />}
              title="Audit log"
              body="Every create, update, archive and restore this app has recorded, with who and when."
              adminOnly={!isAdmin}
            />
          </div>

          {/* ---------------------------------------------------- Sample data */}
          <section className="card">
            <div className="card-header">
              <h2 className="card-title flex items-center gap-1.5">
                <Database size={14} /> Demonstration data
              </h2>
            </div>
            <div className="p-4">
              <SampleDataToggle initialValue={sampleVisible} canEdit={isAdmin} />
            </div>
          </section>

          {/* ------------------------------------------ Status reference table */}
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Current statuses and stages</h2>
              <Link href="/settings/statuses" className="btn-ghost btn-sm">Edit</Link>
            </div>
            <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
              <div>
                <h3 className="section-label mb-2">Outreach statuses</h3>
                <ul className="space-y-1">
                  {statuses.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2">
                      <StatusChip label={s.label} color={s.color} />
                      <span className="text-[11px] text-ink-500">
                        {s.isDefault && 'default · '}
                        {s.countsAsActivePursuit ? 'actively pursued' : 'not pursued'}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="field-hint">
                  &ldquo;Actively pursued&rdquo; statuses appear in the no-follow-up-scheduled queue.
                </p>
              </div>
              <div>
                <h3 className="section-label mb-2">Transaction stages</h3>
                <ul className="space-y-1">
                  {stages.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2">
                      <StatusChip label={s.label} color={s.color} />
                      <span className="text-[11px] text-ink-500">
                        {s.isDefault && 'default · '}{s.category.replace(/_/g, ' ')}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="field-hint">
                  A property reaches a stage only after an explicit promotion.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function ConfigItem({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="rounded-md border border-ink-200 p-2.5">
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${ok ? 'bg-green-600' : 'bg-amber-500'}`} />
        <span className="text-xs font-medium text-ink-800">{label}</span>
      </div>
      <div className="mt-0.5 text-[11px] text-ink-500">{detail}</div>
    </div>
  );
}

function SettingsCard({
  href, icon, title, body, adminOnly,
}: {
  href: string; icon: React.ReactNode; title: string; body: string; adminOnly: boolean;
}) {
  const content = (
    <>
      <div className="flex items-center gap-2 text-ink-700">
        {icon}
        <span className="text-sm font-semibold text-ink-900">{title}</span>
        {adminOnly && <span className="chip border-ink-200 bg-ink-50 text-ink-500">Admin</span>}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-600">{body}</p>
    </>
  );

  if (adminOnly) {
    return <div className="card cursor-not-allowed p-4 opacity-60" title="Requires an administrator account">{content}</div>;
  }
  return <Link href={href} className="card block p-4 transition-shadow hover:shadow-md">{content}</Link>;
}
