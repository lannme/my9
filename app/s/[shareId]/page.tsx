import { notFound } from "next/navigation";
import My9V3App from "@/app/components/My9V3App";
import { normalizeShareId } from "@/lib/share/id";

export default function ShareReadonlyPage({
  params,
}: {
  params: { shareId: string };
}) {
  const shareId = normalizeShareId(params.shareId);
  if (!shareId) {
    notFound();
  }

  return <My9V3App initialShareId={shareId} readOnlyShare />;
}
