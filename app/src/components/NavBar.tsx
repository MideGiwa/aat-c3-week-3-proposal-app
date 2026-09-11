import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { LogoutButton } from "./LogoutButton";

export async function NavBar() {
  const user = await getCurrentUser();

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/proposals" className="flex shrink-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-teal-600 text-[10px] font-semibold text-white">
            KT
          </span>
          <span className="whitespace-nowrap text-sm font-medium text-zinc-900">Koya Talent</span>
        </Link>
        {user ? (
          <div className="flex min-w-0 items-center gap-3 text-sm">
            {user.role === "approver" && (
              <Link href="/team" className="shrink-0 text-zinc-500 transition-colors hover:text-zinc-900">
                Team
              </Link>
            )}
            <span className="min-w-0 truncate text-zinc-500">
              {user.name}
              <span className="hidden text-zinc-400 sm:inline"> · {user.role}</span>
            </span>
            <LogoutButton />
          </div>
        ) : (
          <Link
            href="/login"
            className="shrink-0 whitespace-nowrap text-sm text-zinc-500 transition-colors hover:text-zinc-900"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
