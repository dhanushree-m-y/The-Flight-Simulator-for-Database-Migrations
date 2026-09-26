import type { Metadata } from "next";
import "./globals.css";
import { ShellProvider } from "@/components/shell/ShellContext";
import { AppShell } from "@/components/shell/AppShell";

export const metadata: Metadata = {
  title: "DryRun — rehearse every migration",
  description: "An AI agent on TrueForge that rehearses database migrations in a sandbox before they touch production.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Instrument+Serif:ital@0;1&family=Manrope:wght@300;400;500;600;700&display=swap"
        />
      </head>
      <body>
        <ShellProvider>
          <AppShell>{children}</AppShell>
        </ShellProvider>
      </body>
    </html>
  );
}
