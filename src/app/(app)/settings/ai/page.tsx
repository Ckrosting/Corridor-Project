import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { ArrowLeft, Bot } from 'lucide-react';
import { db } from '@/db';
import { aiUsage } from '@/db/schema';
import { requirePageAdmin } from '@/lib/auth/guards';
import { aiStatus } from '@/lib/ai/client';
import { monthToDateSpendUsd } from '@/lib/services/discovery';
import { getSetting, SETTING_KEYS } from '@/lib/services/settings';
import { env } from '@/lib/env';
import { formatDateTime } from '@/lib/format';
import { Field, Value } from '@/components/ui/primitives';
import { BudgetForm } from './budget-form';

export const metadata = { title: 'Discovery & budget' };
export const dynamic = 'force-dynamic';

export default async function AiSettingsPage() {
  await requirePageAdmin('/settings/ai');

  const status = aiStatus();
  const [spend, budget, rates, recent] = await Promise.all([
    monthToDateSpendUsd(),
    getSetting<number>(SETTING_KEYS.aiMonthlyBudgetUsd).then((v) => v ?? env.ai.monthlyBudgetUsd),
    getSetting<{ inputPerMTok: number; outputPerMTok: number; webSearchPerThousand: number }>(SETTING_KEYS.aiCostRates),
    db.select().from(aiUsage).orderBy(desc(aiUsage.createdAt)).limit(25),
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
          <Bot size={16} /> Discovery &amp; budget
        </h1>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-[900px] space-y-5">

          <section className="card">
            <div className="card-header"><h2 className="card-title">API configuration</h2></div>
            <div className="space-y-3 p-4">
              {status.configured ? (
                <div className="banner-ok">
                  <span>An API key is configured on the server. Discovery scans are available.</span>
                </div>
              ) : (
                <div className="banner-warn">
                  <span>
                    <strong>No API key configured.</strong> Set
                    {' '}<code className="rounded bg-amber-100 px-1">ANTHROPIC_API_KEY</code> in the
                    server environment and restart. Every other feature works without it, and
                    listings can still be added by hand.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label="Model" hint="Set via ANTHROPIC_MODEL">
                  <Value mono>{status.model}</Value>
                </Field>
                <Field label="Max searches per scan" hint="AI_MAX_WEB_SEARCHES_PER_SCAN">
                  <Value mono>{status.maxWebSearchesPerScan}</Value>
                </Field>
                <Field label="Max output tokens" hint="AI_MAX_OUTPUT_TOKENS">
                  <Value mono>{status.maxOutputTokens}</Value>
                </Field>
                <Field label="Key location" hint="Server environment only">
                  <Value>Never sent to the browser</Value>
                </Field>
              </div>

              <p className="field-hint">
                The key is read only on the server, never returned by any API response, never
                logged, and never exposed through a NEXT_PUBLIC_ variable. Changing the model needs
                no code change — set ANTHROPIC_MODEL and restart.
              </p>
            </div>
          </section>

          <section className="card">
            <div className="card-header"><h2 className="card-title">Monthly budget</h2></div>
            <div className="p-4">
              <BudgetForm initialBudget={budget} spend={spend} rates={rates} />
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Recorded usage</h2>
              <span className="text-[11px] text-ink-500">Most recent 25 operations</span>
            </div>
            {recent.length === 0 ? (
              <p className="p-4 text-xs text-ink-500">No scans have been run yet.</p>
            ) : (
              <table className="table-dense">
                <thead>
                  <tr>
                    <th>When</th>
                    <th className="w-40">Operation</th>
                    <th className="w-28 text-right">Input tokens</th>
                    <th className="w-28 text-right">Output tokens</th>
                    <th className="w-20 text-right">Searches</th>
                    <th className="w-24 text-right">Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((u) => (
                    <tr key={u.id} className="cursor-default">
                      <td className="text-xs text-ink-600">{formatDateTime(u.createdAt)}</td>
                      <td className="text-xs">{u.operation.replace(/_/g, ' ')}</td>
                      <td className="text-right text-xs tnum">{u.inputTokens.toLocaleString()}</td>
                      <td className="text-right text-xs tnum">{u.outputTokens.toLocaleString()}</td>
                      <td className="text-right text-xs tnum">{u.webSearches}</td>
                      <td className="text-right text-xs tnum">${Number(u.estimatedCostUsd).toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="border-t border-ink-100 px-4 py-3">
              <p className="text-[11px] leading-relaxed text-ink-500">
                Costs are <strong>estimates</strong> computed from the configurable rates above; the
                API does not return a price. Token counts and search counts are the values the API
                actually reported.
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
