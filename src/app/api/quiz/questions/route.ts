import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/shared/session";
import { db } from "@/shared/db";
import { question, questionBank } from "@/features/practice/schema";
import { startAttempt } from "@/features/practice/queries";
import {
  canAccessModule,
  getAccessibleModuleBySlug,
  getAccessibleQuestionBankBySlug,
} from "@/features/access/learning-access";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const bankSlug = request.nextUrl.searchParams.get("slug");
  const requestedCount = Number.parseInt(request.nextUrl.searchParams.get("count") ?? "5", 10);
  const count = Math.min(Math.max(Number.isFinite(requestedCount) ? requestedCount : 5, 1), 10);

  if (!bankSlug) return listAccessibleBanks(session.user);

  const directBank = await db.query.questionBank.findFirst({
    where: eq(questionBank.slug, bankSlug),
  });

  if (directBank) {
    const access = await getAccessibleQuestionBankBySlug(session.user, bankSlug);
    // Avoid confirming that a protected bank exists.
    if (!access.ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    const questions = await loadQuestions([access.value.id], count);
    const attempt = questions.length > 0 ? await startAttempt(session.user.id, access.value.id) : null;
    return NextResponse.json({ questions, attemptId: attempt?.id ?? null });
  }

  // Legacy module-slug support remains, but the module is resolved and checked
  // server-side before any question or bank metadata is returned.
  const moduleAccess = await getAccessibleModuleBySlug(session.user, bankSlug);
  if (!moduleAccess.ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  const banks = await db.query.questionBank.findMany({
    where: eq(questionBank.moduleId, moduleAccess.value.id),
    columns: { id: true },
  });
  const questions = await loadQuestions(banks.map((bank) => bank.id), count);
  return NextResponse.json({ questions, attemptId: null });
}

async function listAccessibleBanks(user: { id: string; role?: string | null }) {
  const banks = await db.query.questionBank.findMany({
    orderBy: (bank, { asc }) => [asc(bank.title)],
    with: {
      module: true,
      questions: { columns: { id: true } },
    },
  });
  const available = [] as { slug: string; title: string; moduleName: string; moduleSlug: string; questionCount: number }[];
  for (const bank of banks) {
    if (!bank.module) continue;
    const access = await canAccessModule(user, bank.module);
    if (!access.ok) continue;
    available.push({
      slug: bank.slug,
      title: bank.title,
      moduleName: bank.module.name,
      moduleSlug: bank.module.slug,
      questionCount: bank.questions.length,
    });
  }
  return NextResponse.json({ banks: available });
}

async function loadQuestions(bankIds: string[], count: number) {
  if (bankIds.length === 0) return [];
  const rows = await db.query.question.findMany({
    where: inArray(question.bankId, bankIds),
    with: { options: { orderBy: (option, { asc }) => [asc(option.order)] } },
  });
  return rows
    .sort(() => Math.random() - 0.5)
    .slice(0, count)
    .map((row) => ({
      id: row.id,
      prompt: row.prompt,
      imageUrl: row.imageUrl ?? null,
      options: row.options.map((option) => ({ id: option.id, text: option.text })),
    }));
}
