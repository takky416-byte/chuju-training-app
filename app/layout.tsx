import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "愛知県立附属中 適性検査トレーニング",
  description: "問題演習・正答率・分野別進捗を一つにまとめた非公開学習サイト",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

