import type { DryRunReport } from "./types";

export function renderDryRunMarkdown(report: DryRunReport): string {
  const { summary, sourcePdf, generatedAt, rows, rejected } = report;
  const lines: string[] = [
    `# OSPE Pipeline Dry Run`,
    ``,
    `Source: ${sourcePdf}`,
    `Generated: ${generatedAt}`,
    ``,
    `> READ-ONLY planning artifact. No database writes, no questions created, and nothing published.`,
    ``,
    `## Summary`,
    ``,
    `- **TOTAL QUESTIONS DISCOVERED:** ${summary.total}`,
    `- **CONFIDENT:** ${summary.confident}`,
    `- **NEEDS_REVIEW:** ${summary.needsReview}`,
    ``,
    `## By kind`,
    ``,
    `| Kind | Count |`,
    `|---|---:|`,
  ];
  for (const [kind, count] of Object.entries(summary.byKind).sort()) {
    lines.push(`| ${kind} | ${count} |`);
  }
  if (Object.keys(summary.byKind).length === 0) lines.push(`| — | 0 |`);
  lines.push(``, `## Rows`, ``);
  for (const r of rows) {
    lines.push(`- [${r.status}] ${r.kind} p${r.traceability.sourcePage} — "${r.prompt.slice(0, 70)}..." (${r.optionCount} options, answer=${r.answerFound}, image=${r.imageExists})`);
  }
  lines.push(``, `## Rejected`, ``);
  if (rejected.length === 0) {
    lines.push(`None.`);
  } else {
    for (const r of rejected) {
      lines.push(`- index ${r.index}: ${r.reasons.join("; ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
