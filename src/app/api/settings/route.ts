import { z } from 'zod';
import { requireAdmin, requireUser } from '@/lib/auth/guards';
import { ok, readJson, route } from '@/lib/api';
import { getSetting, setSetting, SETTING_KEYS } from '@/lib/services/settings';
import { configStatus } from '@/lib/env';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Only these keys are writable through the API, and only by an admin. */
const WRITABLE: Record<string, z.ZodTypeAny> = {
  [SETTING_KEYS.showSampleData]: z.boolean(),
  [SETTING_KEYS.propertyTypes]: z.array(z.string().trim().min(1).max(80)).max(100),
  [SETTING_KEYS.corridorEdgeBufferMeters]: z.number().int().min(0).max(10_000),
  [SETTING_KEYS.defaultCorridorRadiusMeters]: z.number().int().min(50).max(200_000),
  [SETTING_KEYS.aiMonthlyBudgetUsd]: z.number().min(0).max(100_000),
  [SETTING_KEYS.aiCostRates]: z.object({
    inputPerMTok: z.number().min(0).max(1000),
    outputPerMTok: z.number().min(0).max(1000),
    webSearchPerThousand: z.number().min(0).max(1000),
  }),
};

export const GET = route(async () => {
  await requireUser();
  // configStatus() reports presence flags only — never a secret value.
  return ok({ config: configStatus(), sampleData: await getSetting(SETTING_KEYS.showSampleData) });
});

export const PATCH = route(async (req: Request) => {
  const actor = await requireAdmin();
  const body = (await readJson(req)) as { key?: string; value?: unknown };

  const schema = body.key ? WRITABLE[body.key] : undefined;
  if (!schema) {
    throw new AppError(400, `"${body.key ?? ''}" is not a settable option.`, 'unknown_setting');
  }

  await setSetting(body.key!, schema.parse(body.value), actor);
  return ok({ key: body.key, value: body.value });
});
