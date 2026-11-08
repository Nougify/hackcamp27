import { requireUser } from "@/lib/current-user";
import { AppNav } from "./nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireUser();
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col">{children}</div>
      <AppNav />
    </div>
  );
}
