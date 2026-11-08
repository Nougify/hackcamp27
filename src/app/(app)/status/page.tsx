import { requireUser } from "@/lib/current-user";
import { getStatusChecks } from "@/server/status";
import { StatusClient } from "./StatusClient";

// Internal diagnostics: lets anyone signed in check the health of every
// backing service without SSHing into the server to read docker logs.
export default async function StatusPage() {
  await requireUser();
  const initial = await getStatusChecks();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-semibold">Status</h1>
      <StatusClient initial={initial} />
    </main>
  );
}
