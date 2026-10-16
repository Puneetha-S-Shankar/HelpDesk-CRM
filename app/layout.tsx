import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PropDesk Helpdesk CRM",
  description: "Property management helpdesk with AI ticketing, SLA tracking, escalations and skill-based routing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
