/**
 * Plain ESM rather than next.config.ts: Next's TypeScript config transpiler fails
 * to initialise the TypeScript compiler on this setup, and the config needs no
 * types to be correct.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  // Railway runs the app behind its own proxy; a standalone bundle keeps the image small.
  output: process.env.NEXT_OUTPUT_STANDALONE === 'true' ? 'standalone' : undefined,
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ['postgres', 'bcryptjs', 'exceljs'],
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
