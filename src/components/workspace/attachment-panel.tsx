'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ExternalLink, FileText, Loader2, Trash2, UploadCloud,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/primitives';
import { formatDate } from '@/lib/format';

export interface AttachmentRow {
  id: string;
  filename: string;
  kind: string;
  sizeBytes: number;
  createdAt: string | Date;
}

const KIND_OPTIONS = [
  { value: 'flyer', label: 'Flyer' },
  { value: 'offering_memorandum', label: 'Offering memorandum' },
  { value: 'photo', label: 'Photo' },
  { value: 'document', label: 'Document' },
  { value: 'other', label: 'Other' },
] as const;

/** Kept in sync with the server allowlist in src/lib/storage/index.ts for a fast client-side hint only - the server re-validates every byte. */
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.csv,.txt,.doc,.docx,.xls,.xlsx';

export function AttachmentPanel({
  propertyId, attachments, isAdmin,
}: {
  propertyId: string;
  attachments: AttachmentRow[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [kind, setKind] = useState<(typeof KIND_OPTIONS)[number]['value']>('document');
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of list) {
        const body = new FormData();
        body.set('file', file);
        body.set('propertyId', propertyId);
        body.set('kind', kind);
        const res = await fetch('/api/attachments', { method: 'POST', body });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? `Could not upload "${file.name}".`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }, [propertyId, kind, router]);

  const deleteAttachment = useCallback(async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/attachments/${id}`, { method: 'DELETE' });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Could not delete the attachment.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the attachment.');
    } finally {
      setDeletingId(null);
    }
  }, [router]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="text-xs text-ink-500">Upload as</label>
        <select
          className="input py-1 text-xs"
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          disabled={uploading}
        >
          {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div
        data-testid="attachment-dropzone"
        className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
          dragging ? 'border-accent-500 bg-accent-50' : 'border-ink-200 bg-ink-50/50'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
        }}
      >
        {uploading ? (
          <>
            <Loader2 size={18} className="animate-spin text-accent-600" />
            <p className="text-xs text-ink-600">Uploading…</p>
          </>
        ) : (
          <>
            <UploadCloud size={18} className="text-ink-400" />
            <p className="text-xs text-ink-600">
              Drag a file here, or{' '}
              <button
                type="button"
                className="font-medium text-accent-700 hover:underline"
                onClick={() => inputRef.current?.click()}
              >
                browse
              </button>
            </p>
            <p className="text-[11px] text-ink-400">PDF, images, Office documents, CSV or text</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void uploadFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{error}</p>
      )}

      {attachments.length === 0 ? (
        <EmptyState
          icon={<FileText size={20} />}
          title="No documents"
          body="Flyers, offering memoranda, photos and other files attached to this property appear here."
        />
      ) : (
        <ul className="space-y-1.5">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-md border border-ink-200 px-2.5 py-2 hover:bg-ink-50">
              <a
                href={`/api/attachments/${a.id}`}
                className="flex min-w-0 flex-1 items-center justify-between gap-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-ink-900">{a.filename}</span>
                  <span className="block text-[11px] text-ink-500">
                    {a.kind.replace(/_/g, ' ')} · {(a.sizeBytes / 1024).toFixed(0)} KB · {formatDate(a.createdAt)}
                  </span>
                </span>
                <ExternalLink size={13} className="shrink-0 text-ink-400" />
              </a>
              {isAdmin && (
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  title="Delete this attachment"
                  disabled={deletingId === a.id}
                  onClick={() => deleteAttachment(a.id)}
                >
                  {deletingId === a.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
