import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "CampusPulse · Find a good time to connect",
  description: "Find faculty consultation availability. Interactive demo with fictional faculty and simulated desk devices.",
  icons: { icon: "/icon.svg" }
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
