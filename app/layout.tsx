import type { Metadata } from "next";
import { DM_Sans, Instrument_Serif, Manrope } from "next/font/google";
import { CursorMark } from "./cursor-mark";
import "./globals.css";
const textFont = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });
const headingFont = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const displayFont = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-serif", display: "swap" });
export const metadata: Metadata = {
  title: "CampusPulse · Find a good time to connect",
  description: "Sign in to see faculty availability for your institution and request a meeting.",
  icons: { icon: "/icon.svg" }
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${textFont.variable} ${headingFont.variable} ${displayFont.variable}`}><body>{children}<CursorMark /></body></html>;
}
