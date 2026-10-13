"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Approved circular NSS emblem: transparent PNG first (/nss-logo.png), then
 * the JPEG fallback, then a neutral monogram — we never fabricate a logo asset.
 * Rendered as a plain circle: no border, no background, no card box.
 * Dimensions are reserved to prevent layout shift.
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
  const [src, setSrc] = useState("/nss-logo.png");
  const [failed, setFailed] = useState(false);

  const handleImageError = () => {
    if (src.endsWith(".png")) setSrc("/nss-logo.jpg");
    else setFailed(true);
  };

  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <span
        className="grid shrink-0 place-items-center overflow-hidden rounded-full"
        style={{ width: size, height: size }}
        aria-hidden={failed ? undefined : true}
      >
        {failed ? (
          <span
            className="grid h-full w-full place-items-center rounded-full bg-[color:var(--brand-navy)] font-bold text-[color:var(--brand-paper)]"
            style={{ fontSize: size * 0.32 }}
          >
            NSS
          </span>
        ) : (
          <Image
            src={src}
            alt="NSS SCE KIIT logo"
            width={size}
            height={size}
            className="h-full w-full object-cover"
            onError={handleImageError}
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
