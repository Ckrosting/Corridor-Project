import '@/lib/server-guard';
import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { estimateCostUsd, getAnthropic, webSearchToolType, type CostRates } from './client';
import {
  EXTRACTION_PROMPT, GROUND_RULES, buildMarketSearchPrompt,
  buildDocumentExtractionPrompt, buildUrlExtractionPrompt, scanResultWireSchema,
  wireToScanResult, type ScanResult,
} from './extraction';
import { env } from '@/lib/env';

/**
 * Discovery runs in two phases.
 *
 * Phase 1 researches with the web search tool and produces prose plus citations.
 * Phase 2 converts that prose into schema-validated JSON with NO tools attached.
 *
 * They are separate calls because structured outputs (`output_config.format`)
 * and citations — which web search results carry — cannot be combined in one
 * request. Splitting them also means nothing reaches the database until it has
 * passed a Zod schema, and the extraction step never has network access.
 */

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
  estimatedCostUsd: number;
}

export interface ResearchOutcome {
  result: ScanResult;
  usage: AiUsage;
  /** Non-fatal problems worth showing the user (blocked sources, tool errors). */
  notes: string[];
}

const emptyUsage = (): AiUsage => ({ inputTokens: 0, outputTokens: 0, webSearches: 0, estimatedCostUsd: 0 });

function addUsage(into: AiUsage, message: Anthropic.Message, searches: number, rates: CostRates) {
  into.inputTokens += message.usage.input_tokens ?? 0;
  into.outputTokens += message.usage.output_tokens ?? 0;
  into.webSearches += searches;
  into.estimatedCostUsd = estimateCostUsd(into, rates);
}

/**
 * Counts web searches and collects tool errors.
 *
 * Server-side tool failures do NOT throw: they come back as HTTP 200 with an
 * error object inside the result block. A success `content` is an array, an
 * error `content` is an object — so the shape must be checked before indexing.
 */
function inspectToolResults(content: Anthropic.ContentBlock[]): { searches: number; notes: string[] } {
  let searches = 0;
  const notes: string[] = [];

  for (const block of content) {
    const b = block as unknown as { type?: string; content?: unknown };
    if (b.type !== 'web_search_tool_result') continue;
    searches++;

    const inner = b.content;
    if (inner && !Array.isArray(inner) && typeof inner === 'object') {
      const code = (inner as { error_code?: string }).error_code;
      if (code) notes.push(`A web search could not complete (${code}).`);
    }
  }
  return { searches, notes };
}

const textOf = (message: Anthropic.Message): string =>
  message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n');

/* -------------------------------------------------------------------------- */
/* Phase 2 — validated extraction                                             */
/* -------------------------------------------------------------------------- */

async function extractStructured(
  instruction: string,
  material: string,
  usage: AiUsage,
  rates: CostRates,
  documents: Anthropic.ContentBlockParam[] = [],
): Promise<{ result: ScanResult; notes: string[] }> {
  const client = getAnthropic();
  const notes: string[] = [];

  const content: Anthropic.ContentBlockParam[] = [
    ...documents,
    {
      type: 'text',
      // Delimiters make the boundary between instructions and untrusted material
      // explicit, so injected text inside the material reads as content.
      text: `${instruction}\n\n<<<BEGIN UNTRUSTED SOURCE MATERIAL>>>\n${material}\n<<<END UNTRUSTED SOURCE MATERIAL>>>`,
    },
  ];

  const response = await client.messages.parse({
    model: env.ai.model,
    max_tokens: env.ai.maxOutputTokens,
    system: GROUND_RULES,
    messages: [{ role: 'user', content }],
    output_config: { format: zodOutputFormat(scanResultWireSchema) },
  });

  addUsage(usage, response as unknown as Anthropic.Message, 0, rates);

  if (response.stop_reason === 'refusal') {
    notes.push('The model declined to process this content. Nothing was imported.');
    return { result: { candidates: [], coverageNotes: notes, searchedSources: [] }, notes };
  }

  // parsed_output is null when the model could not satisfy the schema. Returning
  // nothing is correct here: unvalidated data must never reach the database.
  const parsedWire = response.parsed_output;
  if (!parsedWire) {
    notes.push('The model returned a response that did not match the required format, so nothing was imported.');
    return { result: { candidates: [], coverageNotes: notes, searchedSources: [] }, notes };
  }
  const parsed = wireToScanResult(parsedWire);

  return { result: parsed, notes };
}

/* -------------------------------------------------------------------------- */
/* Market scan                                                                */
/* -------------------------------------------------------------------------- */

export async function researchMarket(
  input: Parameters<typeof buildMarketSearchPrompt>[0],
  rates: CostRates,
  signal?: AbortSignal,
): Promise<ResearchOutcome> {
  const client = getAnthropic();
  const usage = emptyUsage();
  const notes: string[] = [];

  const searchTool = {
    type: webSearchToolType(env.ai.model),
    name: 'web_search',
    // A hard per-scan ceiling on searches, which is the main cost driver.
    max_uses: env.ai.maxWebSearchesPerScan,
  } as unknown as Anthropic.ToolUnion;

  const research = await client.messages.create(
    {
      model: env.ai.model,
      max_tokens: env.ai.maxOutputTokens,
      system: GROUND_RULES,
      tools: [searchTool],
      messages: [{ role: 'user', content: buildMarketSearchPrompt(input) }],
    },
    { signal },
  );

  const inspected = inspectToolResults(research.content);
  notes.push(...inspected.notes);
  addUsage(usage, research, inspected.searches, rates);

  if (research.stop_reason === 'refusal') {
    notes.push('The model declined this search request. No results were recorded.');
    return { result: { candidates: [], coverageNotes: notes, searchedSources: [] }, usage, notes };
  }

  const prose = textOf(research);
  if (!prose.trim()) {
    // `max_tokens` here means the model spent its entire output budget on the
    // search tool-use loop (queries + retrieved-page summaries all count
    // against it) and was cut off before writing any final synthesis - a
    // silent, expensive-but-empty scan otherwise. Surfacing the real
    // stop_reason and how many searches actually ran means a repeat of this
    // is diagnosable from the scan record alone, without re-running (and
    // re-paying for) a scan just to find out why.
    notes.push(
      `The search returned no usable findings for this market `
      + `(stop_reason: ${research.stop_reason ?? 'unknown'}, searches used: ${inspected.searches}/${env.ai.maxWebSearchesPerScan}).`
      + (research.stop_reason === 'max_tokens'
        ? ' The model ran out of its output budget mid-search before writing a final summary - raise AI_MAX_OUTPUT_TOKENS to give it more room.'
        : ''),
    );
    return { result: { candidates: [], coverageNotes: notes, searchedSources: [] }, usage, notes };
  }

  const extracted = await extractStructured(EXTRACTION_PROMPT, prose, usage, rates);
  notes.push(...extracted.notes);

  return {
    result: {
      ...extracted.result,
      coverageNotes: [...extracted.result.coverageNotes, ...notes],
    },
    usage,
    notes,
  };
}

/* -------------------------------------------------------------------------- */
/* Manual URL submission                                                      */
/* -------------------------------------------------------------------------- */

export async function researchUrl(
  url: string,
  rates: CostRates,
  signal?: AbortSignal,
): Promise<ResearchOutcome> {
  const client = getAnthropic();
  const usage = emptyUsage();
  const notes: string[] = [];

  const fetchTool = {
    type: 'web_fetch_20260209',
    name: 'web_fetch',
    max_uses: 3,
    // Restricted to the host the user actually submitted, so a hostile page
    // cannot steer the fetch tool somewhere else.
    allowed_domains: [safeHost(url)],
  } as unknown as Anthropic.ToolUnion;

  const research = await client.messages.create(
    {
      model: env.ai.model,
      max_tokens: env.ai.maxOutputTokens,
      system: GROUND_RULES,
      tools: [fetchTool],
      messages: [{ role: 'user', content: buildUrlExtractionPrompt(url) }],
    },
    { signal },
  );

  addUsage(usage, research, 0, rates);

  if (research.stop_reason === 'refusal') {
    notes.push('The model declined to process that URL.');
    return { result: { candidates: [], coverageNotes: notes, searchedSources: [] }, usage, notes };
  }

  const prose = textOf(research);
  if (!prose.trim()) {
    notes.push(`Nothing could be read from ${url}. The page may require a login, block automated access, or be unavailable.`);
    return { result: { candidates: [], coverageNotes: notes, searchedSources: [] }, usage, notes };
  }

  const extracted = await extractStructured(EXTRACTION_PROMPT, prose, usage, rates);
  return {
    result: { ...extracted.result, coverageNotes: [...extracted.result.coverageNotes, ...notes, ...extracted.notes] },
    usage,
    notes,
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'example.invalid';
  }
}

/* -------------------------------------------------------------------------- */
/* Document upload (flyer / OM)                                               */
/* -------------------------------------------------------------------------- */

export async function researchDocument(
  file: { filename: string; contentType: string; bytes: Buffer },
  rates: CostRates,
): Promise<ResearchOutcome> {
  const usage = emptyUsage();
  const base64 = file.bytes.toString('base64');

  const block: Anthropic.ContentBlockParam = file.contentType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : {
        type: 'image',
        source: {
          type: 'base64',
          media_type: file.contentType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
          data: base64,
        },
      };

  const extracted = await extractStructured(
    buildDocumentExtractionPrompt(file.filename),
    `(The document itself is attached. Filename: ${file.filename})`,
    usage,
    rates,
    [block],
  );

  return { result: extracted.result, usage, notes: extracted.notes };
}
