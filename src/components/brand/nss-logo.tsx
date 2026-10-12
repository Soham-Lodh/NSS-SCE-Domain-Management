"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Loads the approved brand logo from /nss-logo.jpg (i.e. public/nss-logo.jpg).
 * Dimensions are reserved to prevent layout shift. If the file is absent we
 * show a neutral monogram fallback — we never fabricate a logo asset.
 */
export function NssLogo({
  size = 40,
  className,
  withWordmark = true,
}: {
  size?: number;
  className?: string;
  withWordmark?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <span
        className="relative grid place-items-center overflow-hidden rounded-xl border border-[color:var(--navy-18)] bg-[color:var(--brand-paper)]"
        style={{ width: size, height: size }}
        aria-hidden={failed ? undefined : true}
      >
        {failed ? (
          <span
            className="font-bold text-[color:var(--brand-navy)]"
            style={{ fontSize: size * 0.4 }}
          >
            NSS
          </span>
        ) : (
          <Image
            src="/nss-logo.jpg"
            alt="NSS SCE KIIT logo"
            width={size}
            height={size}
            className="h-full w-full object-contain"
            onError={() => setFailed(true)}
            priority
          />
        )}
      </span>
      {withWordmark && (
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-bold tracking-tight text-[color:var(--brand-navy)]">
            NSS SCE KIIT
          </span>
          <span className="text-[11px] font-medium text-[color:var(--navy-45)]">
            Domain Management
          </span>
        </span>
      )}
    </span>
  );
}
