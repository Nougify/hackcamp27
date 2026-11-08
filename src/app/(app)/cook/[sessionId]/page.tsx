import { CookView } from "@/features/cook/CookView";

export default async function CookPage({ params }: PageProps<"/cook/[sessionId]">) {
  const { sessionId } = await params;
  return <CookView sessionId={sessionId} />;
}
