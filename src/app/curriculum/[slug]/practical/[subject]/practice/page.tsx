import { PracticalSubjectPage } from "@/components/practical-subject-page";

export default async function PracticePage({ params, searchParams }: {
  params: Promise<{ slug: string; subject: string }>;
  searchParams: Promise<{ fixtures?: string }>;
}) {
  const { slug, subject } = await params;
  const query = await searchParams;
  return <PracticalSubjectPage moduleSlug={slug} subjectSlug={subject} mode="practice" fixtures={query.fixtures === "1"} />;
}
