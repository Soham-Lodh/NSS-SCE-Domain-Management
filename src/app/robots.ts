import type { MetadataRoute } from "next";

import { serverEnv } from "@/lib/env";

/**
 * This is an authenticated management portal — there is no public content to
 * index and private volunteer/event data must never leak into search engines.
 * Disallow everything. There is intentionally no sitemap.xml.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
    host: serverEnv().APP_URL,
  };
}
