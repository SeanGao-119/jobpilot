import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "JobPilot Dashboard",
  description: "AI-assisted job discovery, matching and application tracking",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
