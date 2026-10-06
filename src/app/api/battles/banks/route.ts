import { NextResponse } from "next/server";
import { db } from "@/shared/db";
import { getSession } from "@/shared/session";
import { canAccessModule } from "@/features/access/learning-access";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db.query.questionBank.findMany({
    orderBy: (bank, { asc }) => [asc(bank.title)],
    with: { module: true, questions: { columns: { id: true } } },
  });
  const banks = [] as { slug: string; title: string; moduleName: string; moduleSlug: string; questionCount: number }[];
  for (const row of rows) {
    if (!row.module || !(await canAccessModule(session.user, row.module)).ok) continue;
    banks.push({
      slug: row.slug,
      title: row.title,
      moduleName: row.module.name,
      moduleSlug: row.module.slug,
      questionCount: row.questions.length,
    });
  }
  return NextResponse.json({
    banks,
  });
}
