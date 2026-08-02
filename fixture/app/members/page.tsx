import { listMembers } from "@/src/db";
import { MemberCard } from "@/src/components/member-card";

export default async function MembersPage() {
  const members = await listMembers();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Members</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {members.map((member) => (
          <MemberCard key={member.id} member={member} />
        ))}
      </div>
    </div>
  );
}
