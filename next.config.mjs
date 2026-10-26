/** @type {import('next').NextConfig} */
const nextConfig = {
  // The X-Powered-By header advertises the stack for free; drop it.
  poweredByHeader: false,
  // Pre-compressed responses (gzip/brotli at the proxy) for lower TTFB.
  compress: true,
  // Strict mode keeps parity between dev and prod React behavior.
  reactStrictMode: true,
};

export default nextConfig;
