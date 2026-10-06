import { PracticalSubjectPage } from "@/components/practical-subject-page";

export default async function WrongQuestionsPage({ params, searchParams }: {
  params: Promise<{ slug: string; subject: string }>;
  searchParams: Promise<{ fixtures?: string }>;
}) {
  const { slug, subject } = await params;
  const query = await searchParams;
  return <PracticalSubjectPage moduleSlug={slug} subjectSlug={subject} mode="wrong" fixtures={query.fixtures === "1"} />;
}
