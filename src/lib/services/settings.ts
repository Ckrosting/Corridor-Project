import '@/lib/server-guard';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import type { Actor } from '@/lib/auth/guards';
import { recordAudit } from './audit';

/**
 * Runtime application settings, editable by admins. Secrets never live here —
 * API keys and credentials come only from environment configuration.
 */

export const SETTING_KEYS = {
  propertyTypes: 'property_types',
  aiCostRates: 'ai_cost_rates',
  showSampleData: 'show_sample_data',
  aiMonthlyBudgetUsd: 'ai_monthly_budget_usd',
} as const;

const DEFAULTS: Record<string, unknown> = {
  [SETTING_KEYS.propertyTypes]: [
    'Retail - Strip Center', 'Retail - Freestanding', 'Retail - Outparcel',
    'Shopping Center', 'Office', 'Industrial / Warehouse', 'Flex',
    'Land - Commercial', 'Multifamily', 'Hospitality', 'Medical', 'Mixed Use', 'Other',
  ],
  [SETTING_KEYS.aiCostRates]: { inputPerMTok: 3, outputPerMTok: 15, webSearchPerThousand: 10 },
  // Sample data is visible by default so a fresh install is not an empty shell.
  // Every sample record is badged in the UI and can be hidden or deleted.
  [SETTING_KEYS.showSampleData]: true,
};

export async function getSetting<T>(key: string): Promise<T> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return (row?.value ?? DEFAULTS[key]) as T;
}

export async function setSetting(key: string, value: unknown, actor: Actor): Promise<void> {
  const previous = await getSetting<unknown>(key);
  await db
    .insert(appSettings)
    .values({ key, value: value as never, updatedBy: actor.id })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: value as never, updatedAt: new Date(), updatedBy: actor.id },
    });

  await recordAudit({
    entityType: 'setting', entityId: null, action: 'update',
    summary: `Changed setting "${key}"`,
    changes: { [key]: { from: previous, to: value } },
    actor,
  });
}

/**
 * Whether demonstration records should be shown.
 *
 * Read once per request and threaded through every query on a screen, so a
 * single page never mixes "counts include samples" with "list excludes samples".
 * That inconsistency is worse than either choice on its own.
 */
export const showSampleData = () => getSetting<boolean>(SETTING_KEYS.showSampleData);

export const getPropertyTypes = () => getSetting<string[]>(SETTING_KEYS.propertyTypes);
