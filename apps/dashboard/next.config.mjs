/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // o type-check (tsc) continua a correr no build; o lint corre via `pnpm lint`
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
