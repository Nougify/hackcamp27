import { redirect } from "next/navigation";
import { requireUser } from "@/lib/current-user";
import { UnauthorizedError } from "@/lib/errors";
import { AppNav } from "./nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  try {
    await requireUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    throw err;
  }
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col">{children}</div>
      <AppNav />
    </div>
  );
}
