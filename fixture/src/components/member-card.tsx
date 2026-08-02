import Link from "next/link";
import type { Member } from "@/src/db/schema";

export function MemberCard({ member }: { member: Member }) {
  return (
    <Link
      href={`/members/${member.id}`}
      className="block rounded-lg border border-neutral-200 p-4 hover:border-neutral-400"
    >
      <h2 className="font-medium">{member.name}</h2>
      <p className="text-sm text-neutral-600">{member.email}</p>
    </Link>
  );
}
