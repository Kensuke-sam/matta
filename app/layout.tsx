import type { Metadata, Viewport } from "next";
import { M_PLUS_1_Code, Space_Mono } from "next/font/google";
import "./globals.css";

// 日本語本文用のコード風フォント。日本語グリフはunicode-range分割で自己ホストされる
const mPlus1Code = M_PLUS_1_Code({
  subsets: ["latin"],
  variable: "--font-mplus1code",
  display: "swap",
  preload: false,
});

// 見出し・数字・英字ラベル用のタイプライター風モノスペース
const spaceMono = Space_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-space-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MATTA｜その話、ちょっと待った",
  description:
    "不審な連絡を公的な詐欺事例と照合し、被害にあう前の安全な次の行動を根拠付きで確認できる審査・デモ用プロトタイプ。",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#060906",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`h-full ${mPlus1Code.variable} ${spaceMono.variable}`}>
      <body className="flex min-h-full flex-col bg-term-bg font-body text-term-fg antialiased">
        {children}
        <div aria-hidden className="scanlines" />
      </body>
    </html>
  );
}
