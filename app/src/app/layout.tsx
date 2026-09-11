import type { Metadata } from "next";
import { NavBar } from "@/components/NavBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Koya Talent Proposals",
  description: "Turn discovery-call notes into a reviewed, approved, client-ready proposal.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900 font-sans">
        <NavBar />
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
