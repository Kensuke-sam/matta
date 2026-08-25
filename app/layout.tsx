import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MATTA｜その話、ちょっと待った",
  description:
    "不審な連絡を公的な詐欺事例と照合し、被害にあう前の安全な次の行動を根拠付きで確認できる審査・デモ用プロトタイプ。",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full">
      <body className="flex min-h-full flex-col bg-stone-50 text-stone-900 antialiased">
        {children}
      </body>
    </html>
  );
}
