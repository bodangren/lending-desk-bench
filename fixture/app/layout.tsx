import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lending Desk",
  description: "Equipment lending for the community workshop.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-900 antialiased">
        <header className="border-b border-neutral-200">
          <nav className="mx-auto flex max-w-5xl gap-6 px-6 py-4 text-sm font-medium">
            <Link href="/">Lending Desk</Link>
            <Link href="/items" className="text-neutral-600 hover:text-neutral-900">Items</Link>
            <Link href="/members" className="text-neutral-600 hover:text-neutral-900">Members</Link>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
