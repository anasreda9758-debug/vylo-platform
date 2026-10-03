/**
 * SELECT-only OSPE mapping planner.
 *
 * This script has no apply mode and contains no INSERT, UPDATE, DELETE, DDL, or
 * track-creation path. A missing human decisions file is an expected pre-review
 * state and exits successfully without producing misleading empty reports.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import {
  buildOspeMappingDryRun,
  renderOspeMappingDryRunMarkdown,
  type OspePracticalTrack,
  type OspeReviewStation,
} from "../src/features/ospe/review-pipeline";

const root = process.cwd();
const reportsDirectory = resolve(root, "reports");
const decisionsPath = resolve(root, "reports", "ospe-human-decisions.json");
const reviewPath = resolve(root, "reports", "ospe-human-review.json");
const jsonOutputPath = resolve(root, "reports", "ospe-mapping-dry-run.json");
const markdownOutputPath = resolve(root, "reports", "ospe-mapping-dry-run.md");

function assertInsideReports(path: string) {
  if (path !== reportsDirectory && !path.startsWith(`${reportsDirectory}\\`) && !path.startsWith(`${reportsDirectory}/`)) {
    throw new Error(`Refusing to write outside reports/: ${path}`);
  }
}

async function main() {
  if (!existsSync(decisionsPath)) {
    console.log("OSPE human review is not exported yet. No database connection was opened and no dry-run report was written.");
    console.log(`Expected future decisions file: ${decisionsPath}`);
    return;
  }
  if (!existsSync(reviewPath)) throw new Error(`Missing authoritative review inventory: ${reviewPath}`);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required when validating exported human decisions.");

  const decisions = JSON.parse(await readFile(decisionsPath, "utf8")) as unknown;
  const review = JSON.parse(await readFile(reviewPath, "utf8")) as { records?: OspeReviewStation[] };
  if (!Array.isArray(review.records)) throw new Error("OSPE review inventory does not contain a records array.");

  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    // Enforce read-only transactions at the connection level before any query.
    await sql.unsafe("SET default_transaction_read_only = on");
    const [before] = await sql<{
      modules: number;
      lectures: number;
      stations: number;
      mappings: number;
    }[]>`
      SELECT
        (SELECT count(*)::int FROM module) AS modules,
        (SELECT count(*)::int FROM lecture) AS lectures,
        (SELECT count(*)::int FROM ospe_answer_key) AS stations,
        (SELECT count(*)::int FROM practical_track_ospe_station) AS mappings
    `;
    if (!before || before.modules !== 7 || before.lectures !== 248) {
      throw new Error(`STOP: curriculum counts are ${before?.modules ?? "unknown"} modules / ${before?.lectures ?? "unknown"} lectures, expected 7 / 248. No report or recovery was attempted.`);
    }

    const existingAnswerKeys = await sql<{ id: string }[]>`
      SELECT id FROM ospe_answer_key ORDER BY id
    `;
    const practicalTracks = await sql<OspePracticalTrack[]>`
      SELECT
        practical_track.id,
        practical_track.module_id AS "moduleId",
        module.slug AS "moduleSlug",
        module.name AS "moduleName",
        practical_track.subject,
        practical_track.subject_slug AS "subjectSlug",
        practical_track.status,
        practical_track.ospe_enabled AS "ospeEnabled"
      FROM practical_track
      INNER JOIN module ON module.id = practical_track.module_id
      ORDER BY module.slug, practical_track.subject_slug, practical_track.id
    `;

    const plan = buildOspeMappingDryRun({
      decisions,
      stations: review.records,
      existingAnswerKeyIds: existingAnswerKeys.map((row) => row.id),
      practicalTracks,
    });

    const [after] = await sql<{
      modules: number;
      lectures: number;
      stations: number;
      mappings: number;
    }[]>`
      SELECT
        (SELECT count(*)::int FROM module) AS modules,
        (SELECT count(*)::int FROM lecture) AS lectures,
        (SELECT count(*)::int FROM ospe_answer_key) AS stations,
        (SELECT count(*)::int FROM practical_track_ospe_station) AS mappings
    `;
    if (!after || JSON.stringify(after) !== JSON.stringify(before)) {
      throw new Error("STOP: database safety snapshot changed during the read-only dry run. No report was written.");
    }

    assertInsideReports(jsonOutputPath);
    assertInsideReports(markdownOutputPath);
    const output = {
      ...plan,
      databaseSnapshot: { before, after },
    };
    const markdown = renderOspeMappingDryRunMarkdown(plan).replace(
      "## Summary",
      `## Source database safety snapshot\n\n- Modules: **${before.modules}** before / **${after.modules}** after\n- Lectures: **${before.lectures}** before / **${after.lectures}** after\n- Station definitions: **${before.stations}** before / **${after.stations}** after\n- Existing mappings: **${before.mappings}** before / **${after.mappings}** after\n\n## Summary`,
    );
    await writeFile(jsonOutputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    await writeFile(markdownOutputPath, markdown, "utf8");

    console.log(JSON.stringify({
      outputs: [jsonOutputPath, markdownOutputPath],
      summary: plan.summary,
      databaseSnapshot: { before, after },
    }, null, 2));
    if (plan.summary.rejected > 0) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
