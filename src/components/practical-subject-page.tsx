import Link from "next/link";
import { notFound } from "next/navigation";
import { Navigation } from "@/components/navigation";
import { PracticalPractice } from "@/components/practical-practice";
import { requireUser } from "@/shared/session";
import { fixturesAllowed } from "@/features/practical/model";
import { resolvePracticalTrack } from "@/features/practical/tracks";

export async function PracticalSubjectPage({ moduleSlug, subjectSlug, mode, fixtures }: {
  moduleSlug: string;
  subjectSlug: string;
  mode: "practice" | "wrong";
  fixtures: boolean;
}) {
  if (fixtures && !fixturesAllowed(process.env.NODE_ENV, true)) notFound();
  const session = await requireUser();
  const resolution = await resolvePracticalTrack(session.user, moduleSlug, subjectSlug, fixtures);
  if (!resolution.ok && resolution.reason === "not_found") notFound();
  const track = resolution.ok ? resolution.value : null;

  return <div className="flex min-w-0 flex-1"><Navigation user={session.user} isAdmin={session.user.role === "admin"} />
    <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl space-y-6">
      <Link href={`/curriculum/${moduleSlug}/practical`} className="text-sm text-primary">{track?.moduleName ?? "Module"} / Practical / {track?.displayNameEn ?? "Subject"}</Link>
      <header><p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">{track?.moduleName ?? "Module"} Practical</p><h1 className="mt-1 text-3xl font-bold">{track?.displayNameEn ?? "Subject"} · {mode === "wrong" ? "Wrong Questions" : "Practice"}</h1></header>
      {!track ? <div className="rounded-xl border bg-card p-6">Module access is required. No practical questions or images have been loaded.</div> : <>
        {process.env.NODE_ENV === "development" && <Link href={`?fixtures=${fixtures ? "0" : "1"}`} className="inline-block text-sm text-primary underline">{fixtures ? "Return to approved bank" : "Open development fixtures (not medical content)"}</Link>}
        <PracticalPractice key={`${track.id}-${fixtures}-${mode}`} moduleSlug={moduleSlug} subjectSlug={subjectSlug} subjectName={track.displayNameEn} fixtures={fixtures} wrongOnly={mode === "wrong"} />
      </>}
    </div></main>
  </div>;
}
