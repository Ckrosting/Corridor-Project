import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { UNKNOWN } from '@/lib/format';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/**
 * A status chip. Colour is always accompanied by the label text, so status is
 * legible without relying on colour perception.
 */
export function StatusChip({
  label, color, className, title,
}: { label: string | null | undefined; color?: string | null; className?: string; title?: string }) {
  if (!label) {
    return <span className={cn('chip border-ink-200 bg-ink-50 text-ink-400', className)}>{UNKNOWN}</span>;
  }
  const c = color || '#64748b';
  return (
    <span
      className={cn('chip', className)}
      title={title ?? label}
      style={{ borderColor: `${c}55`, backgroundColor: `${c}14`, color: shade(c) }}
    >
      <span className="chip-dot" style={{ backgroundColor: c }} />
      {label}
    </span>
  );
}

/** Darkens a hex colour so text on a tinted background stays readable. */
function shade(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const f = 0.62;
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r} ${g} ${b})`;
}

/**
 * Renders a value, or a visually distinct placeholder when it is genuinely
 * unknown. Never substitutes zero for missing data.
 */
export function Value({
  children, className, mono,
}: { children: React.ReactNode; className?: string; mono?: boolean }) {
  const isUnknown = children === UNKNOWN || children === null || children === undefined || children === '';
  return (
    <span className={cn(isUnknown ? 'unknown' : 'text-ink-900', mono && 'tnum', className)}>
      {isUnknown ? UNKNOWN : children}
    </span>
  );
}

export function Field({
  label, children, hint, className,
}: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="label">{label}</div>
      <div className="text-sm break-words">{children}</div>
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

export function EmptyState({
  title, body, action, icon,
}: { title: string; body?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="empty-state">
      {icon && <div className="mb-1 text-ink-300">{icon}</div>}
      <div className="empty-title">{title}</div>
      {body && <div className="empty-body">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function SectionHeading({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h3 className="section-label">{children}</h3>
      {right}
    </div>
  );
}

/**
 * Standing disclaimer for drawn geometry. Required wherever boundaries are shown
 * so nobody mistakes a research outline for a surveyed or official tax parcel.
 */
export function ApproximateBoundaryNote({ className }: { className?: string }) {
  return (
    <p className={cn('text-[11px] leading-relaxed text-ink-500', className)}>
      Drawn outlines are approximate research boundaries. They are not surveyed
      lines and not official tax parcel boundaries.
    </p>
  );
}

export function SampleBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn('chip border-amber-300 bg-amber-50 text-amber-800', className)}
      title="Demonstration record. Not real portfolio data."
    >
      Sample
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} viewBox="0 0 24 24" fill="none" width="14" height="14" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
