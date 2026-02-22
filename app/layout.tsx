import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Macro Stress Map | Latin America Data",
  description: "Real-time pressure monitor for Latin American economies including FX Volatility, Inflation, and Sovereign Risk.",
  openGraph: {
    title: "Macro Stress Map",
    description: "Real-time pressure monitor for Latin American economies",
    type: "website",
    images: [{ url: "https://macrostressmap.vercel.app/api/snapshot/BR", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Macro Stress Map",
    description: "Real-time macro stress monitor for Latin America",
    images: ["https://macrostressmap.vercel.app/api/snapshot/BR"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
