import type { NextConfig } from "next";

// Deploy under a sub-path (e.g. ultron.cid-uff.br/achilles) by setting
// NEXT_PUBLIC_BASE_PATH=/achilles at build time. Unset => served at root (local dev).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  basePath,
};

export default nextConfig;
