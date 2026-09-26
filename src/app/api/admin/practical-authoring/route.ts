import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAdmin } from "@/shared/session";
import { eq } from "drizzle-orm";
import { db } from "@/shared/db";
import { practicalImage, practicalQuestion } from "@/features/practical/schema";
import {
  getAuthoringCatalog,
  setImageStatus,
  setQuestionStatus,
  updateQuestionTarget,
  setQuestionStructure,
  setExamImage,
  setCorrectOption,
  replaceOptions,
} from "@/features/practical/authoring";
import { studentQuestion } from "@/features/practical/model";

const ALLOWED_EXT = [".png", ".jpg", ".jpeg", ".webp"];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const targetBody = z.object({ questionId: z.string().min(1), targetX: z.number().min(0).max(1), targetY: z.number().min(0).max(1) });
const structureBody = z.object({ questionId: z.string().min(1), correctStructure: z.string().min(1).max(200) });
const optionBody = z.object({ questionId: z.string().min(1), optionId: z.string().min(1) });
const optionsBody = z.object({
  questionId: z.string().min(1),
  options: z.array(z.object({ id: z.string().min(1).max(24), text: z.string().min(1).max(200) })).length(5),
  correctOptionId: z.string().min(1),
});
const examLinkBody = z.object({ questionId: z.string().min(1), examImageId: z.string().min(1) });
const imageStatusBody = z.object({ imageId: z.string().min(1), status: z.enum(["APPROVED", "REJECTED"]) });
const questionStatusBody = z.object({ questionId: z.string().min(1), status: z.enum(["APPROVED", "REJECTED"]) });
const uploadBody = z.object({
  sourceImageId: z.string().min(1),
  filename: z.string().min(1).max(200),
  dataBase64: z.string().min(1),
});

const actionBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update-target"), ...targetBody.shape }),
  z.object({ action: z.literal("set-structure"), ...structureBody.shape }),
  z.object({ action: z.literal("set-correct-option"), ...optionBody.shape }),
  z.object({ action: z.literal("update-options"), ...optionsBody.shape }),
  z.object({ action: z.literal("link-exam"), ...examLinkBody.shape }),
  z.object({ action: z.literal("approve-image"), ...imageStatusBody.shape }),
  z.object({ action: z.literal("reject-image"), ...imageStatusBody.shape }),
  z.object({ action: z.literal("approve-question"), ...questionStatusBody.shape }),
  z.object({ action: z.literal("reject-question"), ...questionStatusBody.shape }),
  z.object({ action: z.literal("upload-clean"), ...uploadBody.shape }),
]);

export async function GET(request: Request) {
  await requireAdmin();
  const url = new URL(request.url);
  const previewId = url.searchParams.get("preview");
  if (previewId) {
    const [question] = await db.select().from(practicalQuestion).where(eq(practicalQuestion.id, previewId)).limit(1);
    if (!question) return NextResponse.json({ error: "Question not found" }, { status: 404 });
    const [image] = await db.select().from(practicalImage).where(eq(practicalImage.id, question.imageId)).limit(1);
    const scope = { trackId: question.trackId, moduleId: question.moduleId, studyYear: question.studyYear, fixtures: question.isFixture };
    // Re-parse through the student schema so the preview is EXACTLY the student payload
    // (no correct option, no answer keys, clean exam image only).
    const { questionSchema, imageSchema } = await import("@/features/practical/model");
    const parsedQ = questionSchema.safeParse(question);
    if (!parsedQ.success || !image) return NextResponse.json({ error: "Question not previewable" }, { status: 400 });
    if (scope.fixtures || parsedQ.data.status !== "APPROVED" || image.status !== "APPROVED") {
      return NextResponse.json({ error: "Not public yet" }, { status: 406 });
    }
    const preview = studentQuestion(parsedQ.data);
    return NextResponse.json({
      ...preview,
      targetX: question.targetX,
      targetY: question.targetY,
      imageUrl: image.storageKey ? `/api/practical/images/${encodeURIComponent(image.id)}` : null,
      imageAlt: image.alt,
    });
  }
  const catalog = await getAuthoringCatalog();
  return NextResponse.json({ catalog });
}

export async function PATCH(request: Request) {
  await requireAdmin();
  let body: z.infer<typeof actionBody>;
  try {
    body = actionBody.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  switch (body.action) {
    case "update-target": {
      const result = await updateQuestionTarget(body.questionId, body.targetX, body.targetY);
      return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.reason }, { status: 400 });
    }
    case "set-structure": {
      const result = await setQuestionStructure(body.questionId, body.correctStructure);
      return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.reason }, { status: 400 });
    }
    case "set-correct-option": {
      const result = await setCorrectOption(body.questionId, body.optionId);
      return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.reason }, { status: 400 });
    }
    case "update-options": {
      const result = await replaceOptions(body.questionId, body.options, body.correctOptionId);
      return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.reason }, { status: 400 });
    }
    case "link-exam": {
      const result = await setExamImage(body.questionId, body.examImageId);
      return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.reason }, { status: 400 });
    }
    case "approve-image":
      return (await setImageStatus(body.imageId, "APPROVED")).ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: "Image cannot be approved yet" }, { status: 400 });
    case "reject-image":
      return (await setImageStatus(body.imageId, "REJECTED")).ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: "Image not found" }, { status: 404 });
    case "approve-question":
      return (await setQuestionStatus(body.questionId, "APPROVED")).ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: "Question not ready for approval (5 options, verified structure, clean exam image)" }, { status: 400 });
    case "reject-question":
      return (await setQuestionStatus(body.questionId, "REJECTED")).ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: "Question not found" }, { status: 404 });
    case "upload-clean": {
      const source = await db.query.practicalImage.findFirst({ where: eq(practicalImage.id, body.sourceImageId) });
      if (!source) return NextResponse.json({ error: "Source image not found" }, { status: 404 });
      if (!source.trackId) {
        // Never fabricate a track: an un-tracked source can't produce a derivative
        // that the student catalog (inner-join on practical_track_id) would surface.
        return NextResponse.json({ error: "Source image has no practical track" }, { status: 409 });
      }
      const ext = path.extname(body.filename).toLowerCase();
      if (!ALLOWED_EXT.includes(ext)) return NextResponse.json({ error: "Unsupported image format" }, { status: 400 });
      let bytes: Buffer;
      try {
        bytes = Buffer.from(body.dataBase64, "base64");
      } catch {
        return NextResponse.json({ error: "Invalid image data" }, { status: 400 });
      }
      if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: "Image must be between 1 byte and 8 MB" }, { status: 400 });
      }
      const storageKey = `admin-clean-${randomUUID()}${ext}`;
      const root = path.join(process.cwd(), "private", "practical-images");
      await mkdir(root, { recursive: true });
      await writeFile(path.join(root, storageKey), bytes);

      const id = randomUUID();
      await db.insert(practicalImage).values({
        id,
        trackId: source.trackId,
        moduleId: source.moduleId,
        studyYear: source.studyYear,
        subject: source.subject,
        storageKey,
        alt: `Clean exam version of ${source.alt}`,
        sourceMaterial: {
          title: "Admin-uploaded clean exam image",
          path: `exam-derivative:${id}`,
          sha256: "",
          approvedBy: null,
          approvedAt: null,
        },
        sourcePage: source.sourcePage,
        markers: [],
        status: "APPROVED",
        isFixture: false,
        sourceImageId: body.sourceImageId,
        examImageId: null,
        targetX: null,
        targetY: null,
        isExamDerivative: true,
        generationStatus: "DRAFT",
        reviewStatus: "DRAFT",
        generatedByAi: false,
      });
      // The upload is admin-provided evidence; still needs an explicit APPROVE.
      return NextResponse.json({ ok: true, imageId: id, reviewStatus: "DRAFT" });
    }
  }
}