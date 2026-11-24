import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: "Trivikrama SIEM", template: "%s | Trivikrama" },
  description: "Enterprise AI-native security operations platform",
  robots: { index: false, follow: false },
  icons: { icon: "/logo.svg" },
};

export const viewport: Viewport = { colorScheme: "dark", themeColor: "#0a0e13", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body><a className="skip-link" href="#main-content">Skip to main content</a><Providers>{children}</Providers></body></html>;
}
