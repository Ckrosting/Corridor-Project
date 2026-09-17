'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

/**
 * Exports exactly what the list is showing. The filters live in the URL, so the
 * button simply hands them to the export route rather than downloading the whole
 * portfolio under a filtered heading.
 */
export function ExportPropertiesButton({ includeSample }: { includeSample: boolean }) {
  const params = useSearchParams();
  const next = new URLSearchParams(params.toString());
  // Resolved on the server from the sample-data setting when the URL is silent.
  next.set('includeSample', includeSample ? 'true' : 'false');

  return (
    <Link href={`/api/export/properties?${next.toString()}`} className="btn-secondary btn-sm" prefetch={false}>
      Export CSV
    </Link>
  );
}
