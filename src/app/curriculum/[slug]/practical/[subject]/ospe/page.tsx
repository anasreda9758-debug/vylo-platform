import Link from "next/link";
import { notFound } from "next/navigation";
import { Navigation } from "@/components/navigation";
import { ExamMode } from "@/components/exam-mode";
import { requireUser } from "@/shared/session";
import { resolvePracticalOspeScope } from "@/features/practical/ospe-scope";

export default async function PracticalOspePage({ params }: { params: Promise<{ slug: string; subject: string }> }) {
  const { slug, subject } = await params;
  const session = await requireUser();
  const resolution = await resolvePracticalOspeScope(session.user, slug, subject);
  if (!resolution.ok && resolution.reason === "not_found") notFound();
  const track = resolution.ok ? resolution.value : null;

  return <div className="flex min-w-0 flex-1"><Navigation user={session.user} isAdmin={session.user.role === "admin"} />
    <main className="min-w-0 flex-1 p-6 lg:p-8"><div className="mx-auto max-w-5xl space-y-6">
      <Link href={`/curriculum/${slug}/practical`} className="text-sm text-primary">{track?.moduleName ?? "Module"} / Practical / {track?.displayNameEn ?? "Subject"}</Link>
      <header><p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">{track?.moduleName ?? "Module"} Practical</p><h1 className="mt-1 text-3xl font-bold">{track?.displayNameEn ?? "Subject"} · OSPE Exam</h1></header>
      {!track ? <div className="rounded-xl border bg-card p-6">Module access is required. No OSPE stations have been loaded.</div> : <ExamMode moduleSlug={slug} subjectSlug={subject} />}
    </div></main>
  </div>;
}
