import { redirect } from "next/navigation";

export default async function PracticalSubjectRedirect({ params, searchParams }: {
  params: Promise<{ slug: string; subject: string }>;
  searchParams: Promise<{ fixtures?: string; mode?: string }>;
}) {
  const { slug, subject } = await params;
  const query = await searchParams;
  const destination = query.mode === "wrong" ? "wrong" : "practice";
  const fixtures = query.fixtures === "1" ? "?fixtures=1" : "";
  redirect(`/curriculum/${slug}/practical/${subject}/${destination}${fixtures}`);
}
