import { z } from "zod";
import { PracticalError, type RequestScope } from "./service";
export function requestScope(url: URL): RequestScope {
  return { moduleSlug: url.searchParams.get("module") ?? "", subjectSlug: url.searchParams.get("subject") ?? "", fixtures: url.searchParams.get("fixtures") === "1" };
}
export const answerBody = z.object({ questionId: z.string().min(1).max(160), optionId: z.string().min(1).max(160), requestId: z.string().uuid() }).strict();
export const flagBody = z.object({ questionId: z.string().min(1).max(160), flag: z.enum(["bookmarked", "difficult"]), value: z.boolean() }).strict();
export const practicalGenerateBody = z.object({
  sourceImageId: z.string().min(1).max(160),
  examImageId: z.string().max(160).optional(),
  targetX: z.number().min(0).max(1),
  targetY: z.number().min(0).max(1),
  // Verified correct structure is optional at creation time: if omitted the
  // artifact is created as NEEDS_REVIEW and the AI never guesses an answer.
  correctStructure: z.string().max(200).optional(),
  prompt: z.string().max(4000).optional(),
  idempotencyKey: z.string().uuid(),
}).strict();
export const privateHeaders = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
export function practicalFailure(error: unknown) {
  const status = error instanceof PracticalError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503;
  return Response.json({ error: status === 503 ? "Practical is not ready. Check the additive pilot setup; no answer was confirmed." : status === 400 ? "Invalid practical request" : (error as Error).message }, { status, headers: privateHeaders });
}
