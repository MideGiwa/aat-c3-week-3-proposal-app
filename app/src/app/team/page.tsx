import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { isInviteTokenExpired } from "@/lib/invite-tokens";
import { InviteTeamForm } from "./InviteTeamForm";
import { ResendInviteButton } from "./ResendInviteButton";
import { RemoveTeamMemberButton } from "./RemoveTeamMemberButton";
import { ReactivateTeamMemberButton } from "./ReactivateTeamMemberButton";
import { ChangeRoleButton } from "./ChangeRoleButton";

export const dynamic = "force-dynamic";

// /team — where an approver provisions new accounts. There's no public
// sign-up (see api/users/invite's comment for why), so this page is the
// only way anyone new gets in.
export default async function TeamPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "approver") redirect("/proposals");

  const rows = await db.query.users.findMany({ orderBy: [desc(users.createdAt)] });

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6 border-b border-zinc-200 pb-5">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Team</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Invite a salesperson or approver by email — they set up their own authenticator app to activate.
        </p>
      </div>

      <InviteTeamForm />

      <div className="mt-8 overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b border-zinc-200 text-left text-[11px] font-medium uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-zinc-100">
                <td className="px-4 py-3 font-medium text-zinc-900">
                  {row.name}
                  {row.id === user.id && <span className="ml-1.5 text-xs font-normal text-zinc-400">(you)</span>}
                </td>
                <td className="px-4 py-3 text-zinc-600">{row.email}</td>
                <td className="px-4 py-3 text-zinc-600 capitalize">{row.role}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <StatusPill row={row} />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {row.status === "invited" && <ResendInviteButton userId={row.id} />}
                    {(row.status === "invited" || row.status === "active") && (
                      <ChangeRoleButton userId={row.id} currentRole={row.role} />
                    )}
                    {row.status !== "removed" && row.id !== user.id && (
                      <RemoveTeamMemberButton userId={row.id} name={row.name} />
                    )}
                    {row.status === "removed" && <ReactivateTeamMemberButton userId={row.id} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill({ row }: { row: typeof users.$inferSelect }) {
  if (row.status === "active") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        <span className="text-zinc-700">Active</span>
      </span>
    );
  }

  if (row.status === "removed") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
        <span className="text-zinc-500">Removed</span>
      </span>
    );
  }

  const expired = isInviteTokenExpired(row.inviteTokenExpiresAt);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${expired ? "bg-red-500" : "bg-amber-500"}`} />
      <span className="text-zinc-700">{expired ? "Invite expired" : "Invited"}</span>
    </span>
  );
}
