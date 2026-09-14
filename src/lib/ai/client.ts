import '@/lib/server-guard';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/env';
import { ConfigurationError } from '@/lib/errors';

/**
 * The Anthropic client.
 *
 * The API key is read here and nowhere else. It is never returned from an API
 * route, never serialised into a server-component payload, never written to a
 * log line, and never referenced by a NEXT_PUBLIC_ variable — so it cannot reach
 * the browser bundle. `aiStatus()` exposes only whether a key is present.
 */

let client: Anthropic | null = null;

export function isAiConfigured(): boolean {
  return Boolean(env.ai.apiKey);
}

export function getAnthropic(): Anthropic {
  if (!env.ai.apiKey) {
    throw new ConfigurationError(
      'Discovery is not configured. Set ANTHROPIC_API_KEY in the server environment to enable scans. Every other feature works without it.',
    );
  }
  client ??= new Anthropic({
    apiKey: env.ai.apiKey,
    maxRetries: 2,
    timeout: 10 * 60 * 1000, // scans legitimately take minutes
  });
  return client;
}

/** Safe-to-display configuration state. Never includes the key itself. */
export function aiStatus() {
  return {
    configured: isAiConfigured(),
    model: env.ai.model,
    maxWebSearchesPerScan: env.ai.maxWebSearchesPerScan,
    maxOutputTokens: env.ai.maxOutputTokens,
    monthlyBudgetUsd: env.ai.monthlyBudgetUsd,
  };
}

/**
 * The web search tool identifier.
 *
 * Verified against current Anthropic documentation: `web_search_20260209` is the
 * current variant supported by Sonnet 5 and the Opus 4.6+ family. Older models
 * require the basic `web_search_20250305` variant, so the choice is derived from
 * the configured model rather than hard-coded — the model is configurable at
 * runtime and must not silently pair with an unsupported tool version.
 */
export function webSearchToolType(model: string): 'web_search_20260209' | 'web_search_20250305' {
  const current = [
    'claude-sonnet-5', 'claude-sonnet-4-6',
    'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6',
    'claude-fable-5', 'claude-fable-5-1',
  ];
  return current.some((m) => model.startsWith(m)) ? 'web_search_20260209' : 'web_search_20250305';
}

/**
 * Cost estimate in USD. Clearly an ESTIMATE: rates are admin-configurable
 * because published prices change, and the API does not return a price.
 */
export interface CostRates {
  inputPerMTok: number;
  outputPerMTok: number;
  webSearchPerThousand: number;
}

export function estimateCostUsd(
  usage: { inputTokens: number; outputTokens: number; webSearches: number },
  rates: CostRates,
): number {
  return (
    (usage.inputTokens / 1_000_000) * rates.inputPerMTok +
    (usage.outputTokens / 1_000_000) * rates.outputPerMTok +
    (usage.webSearches / 1000) * rates.webSearchPerThousand
  );
}
