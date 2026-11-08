import { requireUser } from "@/lib/current-user";
import { AppNav } from "./nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireUser();
  return (
    <div className="flex flex-1 flex-col">
      <AppNav />
      <div className="flex flex-1 flex-col pb-20 md:pb-0">{children}</div>
    </div>
  );
}
