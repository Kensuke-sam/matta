import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standaloneはCloud9向け自己ホスト成果物（CIでtar化）専用。Vercelのビルドは
  // 既定出力を前提とし、standaloneだと.next/next-server.js.nft.jsonのENOENTで
  // デプロイが失敗するため、Vercel上では指定しない
  output: process.env.VERCEL ? undefined : "standalone",
  // ホームディレクトリ直下のpackage-lock.jsonをworkspace rootと誤検知しないよう固定する
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
