import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Lending Desk</h1>
      <p className="text-neutral-600">Browse the catalogue or look up a member.</p>
      <div className="flex gap-3">
        <Link href="/items" className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white">
          Browse items
        </Link>
        <Link href="/members" className="rounded-md border border-neutral-300 px-4 py-2 text-sm">
          Members
        </Link>
      </div>
    </div>
  );
}
