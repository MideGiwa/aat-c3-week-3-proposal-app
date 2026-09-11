import { findValidInvite, inviteLookupErrorMessage } from "@/lib/invite-lookup";
import { SetupAuthenticatorForm } from "./SetupAuthenticatorForm";

export const dynamic = "force-dynamic";

// The page a new teammate lands on from their invite email. Validity is
// checked here, server-side, before anything about the account (even just
// "yes, this is a real invite") is revealed to the browser — an expired or
// tampered link gets the exact same generic error a nonexistent one would.
export default async function SetupAuthenticatorPage({
  searchParams,
}: {
  searchParams: Promise<{ uid?: string; token?: string }>;
}) {
  const { uid, token } = await searchParams;

  if (!uid || !token) {
    return <InvalidInvite message="This invite link isn't valid." />;
  }

  const lookup = await findValidInvite(uid, token);
  if (!lookup.ok) {
    return <InvalidInvite message={inviteLookupErrorMessage(lookup.reason)} />;
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 px-6 py-16 sm:py-24">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900">Set up your account</h1>
        <p className="mt-1.5 text-sm text-zinc-500">
          Welcome, {lookup.user.name.split(" ")[0]}. Scan the code below with an authenticator app to finish setup.
        </p>
      </div>
      <SetupAuthenticatorForm uid={uid} token={token} />
    </div>
  );
}

function InvalidInvite({ message }: { message: string }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 px-6 py-24 text-center">
      <h1 className="text-lg font-semibold text-zinc-900">Invite link not valid</h1>
      <p className="text-sm text-zinc-500">{message}</p>
    </div>
  );
}
