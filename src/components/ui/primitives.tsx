"use client";

import {
  forwardRef,
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils/cn";

/* ------------------------------- Button ---------------------------------- */

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    loading?: boolean;
  }
>(function Button({ variant = "primary", loading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={cn("btn", `btn-${variant}` as string, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}

/* ------------------------------- Surfaces -------------------------------- */

export function BentoCard({
  children,
  className,
  as: As = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return <As className={cn("surface-raised p-5", className)}>{children}</As>;
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="truncate text-base font-bold text-[color:var(--brand-navy)]">{title}</h2>
        {subtitle && (
          <p className="mt-0.5 text-xs font-medium text-[color:var(--navy-45)]">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* -------------------------------- Badges --------------------------------- */

type Tone = "neutral" | "accent" | "danger" | "success";

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  const tones: Record<Tone, string> = {
    neutral: "bg-[color:var(--navy-06)] text-[color:var(--brand-navy)] border-[color:var(--navy-18)]",
    accent: "bg-[color:var(--navy-10)] text-[color:var(--brand-navy)] border-[color:var(--navy-18)]",
    danger: "bg-[color:var(--red-20)] text-[color:var(--brand-red)] border-[color:var(--red-20)]",
    success: "bg-[color:var(--navy-06)] text-[color:var(--brand-navy)] border-[color:var(--navy-18)]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-semibold",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Status pill pairs a dot shape + label (never color alone). */
export function StatusPill({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  const dot =
    tone === "danger" ? "●" : tone === "accent" ? "◐" : tone === "success" ? "✓" : "○";
  return (
    <Badge tone={tone}>
      <span aria-hidden>{dot}</span>
      <span>{label}</span>
    </Badge>
  );
}

/* ------------------------------ Skeletons -------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <span className={cn("skeleton block rounded-lg", className)} aria-hidden />;
}

export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className="h-5" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="surface-raised space-y-3 p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

/* -------------------------------- States --------------------------------- */

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="surface-inset flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span aria-hidden className="text-2xl text-[color:var(--navy-45)]">◇</span>
      <p className="text-sm font-semibold text-[color:var(--brand-navy)]">{title}</p>
      {description && <p className="max-w-sm text-xs text-[color:var(--navy-45)]">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="surface-inset flex flex-col items-center gap-3 px-6 py-8 text-center">
      <span aria-hidden className="text-xl text-[color:var(--brand-red)]">▲</span>
      <p className="text-sm font-semibold text-[color:var(--brand-navy)]">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function PermissionDenied({ message = "You do not have permission to view this." }: { message?: string }) {
  return (
    <div className="surface-inset flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span aria-hidden className="text-xl text-[color:var(--brand-red)]">⛔</span>
      <p className="text-sm font-semibold text-[color:var(--brand-navy)]">{message}</p>
    </div>
  );
}

/* -------------------------------- Inputs --------------------------------- */

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn("input", className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cn("input pr-8", className)} {...rest}>
        {children}
      </select>
    );
  },
);

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-[color:var(--brand-navy)]">{label}</span>
      {children}
      {hint && !error && <span className="text-[11px] text-[color:var(--navy-45)]">{hint}</span>}
      {error && <span className="text-[11px] font-medium text-[color:var(--brand-red)]">{error}</span>}
    </label>
  );
}

/* --------------------------------- Tabs ---------------------------------- */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="tablist" className="surface-inset flex flex-wrap gap-1 p-1">
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-semibold transition duration-150 ease-smooth",
              active
                ? "bg-[color:var(--brand-paper)] text-[color:var(--brand-navy)] shadow-raised"
                : "text-[color:var(--navy-45)] hover:text-[color:var(--brand-navy)]",
            )}
          >
            {t.label}
            {typeof t.count === "number" && (
              <span className="ml-1.5 text-[10px] text-[color:var(--navy-45)]">{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------- Table ---------------------------------- */

export function TableShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-[color:var(--navy-10)] px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-[color:var(--navy-45)]",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <td className={cn("border-b border-[color:var(--navy-06)] px-3 py-2.5 align-middle", className)}>
      {children}
    </td>
  );
}

/* -------------------------------- Modal ---------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[color:var(--navy-70)] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="surface-raised w-full max-w-lg animate-fade-in p-5">
        <h3 id={titleId} className="text-base font-bold text-[color:var(--brand-navy)]">
          {title}
        </h3>
        <div className="mt-3 max-h-[60vh] overflow-y-auto text-sm text-[color:var(--brand-navy)]">
          {children}
        </div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
