import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ホームディレクトリ直下のpackage-lock.jsonをworkspace rootと誤検知しないよう固定する
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
