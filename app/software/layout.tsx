import type { Metadata, Viewport } from "next";
import { PhoneAppProvider } from "./pwa";

export const metadata: Metadata = {
  title: "CampusPulse by Sygnetta",
  description: "CampusPulse helps students and faculty find a better time to connect.",
  appleWebApp: { capable: true, title: "CampusPulse", statusBarStyle: "default" },
  other: { "apple-mobile-web-app-capable": "yes" },
  icons: { icon: "/software/icons/icon-192.png", apple: "/software/icons/apple-touch-icon.png" }
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#11100e", viewportFit: "cover" };

export default function SoftwareLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><link rel="manifest" href="/software/manifest.webmanifest" crossOrigin="use-credentials"/><PhoneAppProvider>{children}</PhoneAppProvider></>;
}
