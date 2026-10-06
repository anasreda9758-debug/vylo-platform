import Link from "next/link";
import { notFound } from "next/navigation";
import { Navigation } from "@/components/navigation";
import { requireUser } from "@/shared/session";
import { getPracticalTrackDashboard, listPracticalTracks } from "@/features/practical/tracks";
import { isPracticalOspeAvailable } from "@/features/practical/ospe";

export default async function PracticalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await requireUser();
  const listing = await listPracticalTracks(session.user, slug);
  if (!listing.access.ok && listing.access.reason === "not_found") notFound();
  const moduleName = listing.access.ok ? listing.access.value.name : "Module";
  const tracks = listing.access.ok ? await getPracticalTrackDashboard(session.user.id, listing.tracks) : [];

  return <div className="flex min-w-0 flex-1"><Navigation user={session.user} isAdmin={session.user.role === "admin"} />
    <main className="min-w-0 flex-1 p-6 lg:p-8"><div className="mx-auto max-w-5xl space-y-6">
      <Link href={`/curriculum/${slug}`} className="text-sm text-primary">{moduleName} / Curriculum</Link>
      <header><h1 className="text-3xl font-bold">{moduleName} Practical</h1><p className="mt-2 text-muted-foreground">Subjects available</p></header>
      {!listing.access.ok ? <p className="rounded-xl border bg-card p-6">Module access is required. A lecture preview does not unlock practical content.</p> : tracks.length === 0 ?
        <p className="rounded-xl border bg-card p-6 text-muted-foreground">No practical subjects are currently available for this module.</p> :
        <div className="grid gap-5 md:grid-cols-2">{tracks.map((track) => {
          const base = `/curriculum/${slug}/practical/${track.subjectSlug}`;
          const ospeAvailable = isPracticalOspeAvailable(track.ospeEnabled, track.ospeStationCount);
          return <section key={track.id} className="rounded-2xl border bg-card p-6">
            <h2 className="text-xl font-semibold">{track.displayNameEn}</h2>
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <Metric label="Attempted" value={track.summary.attempted} />
              <Metric label="Correct" value={track.summary.correct} />
              <Metric label="Wrong" value={track.summary.wrong} />
              <Metric label="Accuracy" value={track.summary.accuracy === null ? "—" : `${track.summary.accuracy}%`} />
              <Metric label="Wrong remaining" value={track.summary.wrongRemaining} />
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              {track.practiceEnabled && <Link href={`${base}/practice`} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Practice</Link>}
              {track.practiceEnabled && <Link href={`${base}/wrong`} className="rounded-lg border px-4 py-2 text-sm font-medium">Wrong Questions</Link>}
              {ospeAvailable && <Link href={`${base}/ospe`} className="rounded-lg border px-4 py-2 text-sm font-medium">OSPE Exam</Link>}
            </div>
          </section>;
        })}</div>}
    </div></main>
  </div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p></div>;
}
