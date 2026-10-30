import { getDb } from "@/lib/data";
import CupView from "@/components/CupView";

export const dynamic = "force-dynamic";

export default async function Libertadores(props: PageProps<"/libertadores">) {
  const { fase } = await props.searchParams;
  return <CupView db={getDb()} slug="copa-libertadores-da-america" faseParam={typeof fase === "string" ? fase : undefined} base="/libertadores" />;
}
