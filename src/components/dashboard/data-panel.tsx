"use client";

import type { ReactNode } from "react";
import {
  BentoCard,
  CardHeader,
  EmptyState,
  ErrorState,
  PermissionDenied,
  Skeleton,
  SkeletonRows,
} from "@/components/ui/primitives";
import { ApiClientError } from "@/lib/http/client";

export function DataPanel({
  title,
  subtitle,
  action,
  className,
  isLoading,
  isError,
  error,
  isEmpty,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  onRetry,
  children,
  skeleton,
  rowSkeletonCount,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRetry?: () => void;
  children: ReactNode;
  skeleton?: ReactNode;
  rowSkeletonCount?: number;
}) {
  const denied = error instanceof ApiClientError && error.code === "FORBIDDEN";

  return (
    <BentoCard className={className}>
      <CardHeader title={title} subtitle={subtitle} action={action} />
      {isLoading ? (
        skeleton ?? <SkeletonRows rows={rowSkeletonCount ?? 5} cols={4} />
      ) : isError ? (
        denied ? (
          <PermissionDenied />
        ) : (
          <ErrorState
            message={error instanceof ApiClientError ? error.message : "Could not load data."}
            onRetry={onRetry}
          />
        )
      ) : isEmpty ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        children
      )}
    </BentoCard>
  );
}

export function StatCard({
  label,
  value,
  hint,
  loading,
}: {
  label: string;
  value: number | string;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <BentoCard className="flex flex-col gap-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--navy-45)]">
        {label}
      </p>
      {loading ? (
        <Skeleton className="h-8 w-16" />
      ) : (
        <p className="text-3xl font-extrabold tracking-tight text-[color:var(--brand-navy)]">{value}</p>
      )}
      {hint && <p className="text-[11px] text-[color:var(--navy-45)]">{hint}</p>}
    </BentoCard>
  );
}
