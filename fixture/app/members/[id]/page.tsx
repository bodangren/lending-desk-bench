import { notFound } from "next/navigation";
import { getMember } from "@/src/db";

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const member = await getMember(id);
  if (!member) notFound();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{member.name}</h1>
      <dl className="text-sm text-neutral-600">
        <dt className="font-medium text-neutral-900">Email</dt>
        <dd>{member.email}</dd>
        <dt className="mt-2 font-medium text-neutral-900">Joined</dt>
        <dd>{new Date(member.joinedAt).toISOString().slice(0, 10)}</dd>
      </dl>
    </div>
  );
}
