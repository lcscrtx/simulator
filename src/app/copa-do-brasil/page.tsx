import { getDb } from "@/lib/data";
import CupView from "@/components/CupView";

export const dynamic = "force-dynamic";

export default async function CopaDoBrasil(props: PageProps<"/copa-do-brasil">) {
  const { fase } = await props.searchParams;
  return <CupView db={getDb()} slug="copa-do-brasil" faseParam={typeof fase === "string" ? fase : undefined} base="/copa-do-brasil" />;
}
