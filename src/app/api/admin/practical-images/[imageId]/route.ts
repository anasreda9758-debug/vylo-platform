import { requireAdmin } from "@/shared/session";
import { eq } from "drizzle-orm";
import { db } from "@/shared/db";
import { practicalImage } from "@/features/practical/schema";
import { readPracticalImage } from "@/features/practical/images";
import type { PracticalImage } from "@/features/practical/model";
import { practicalFailure, privateHeaders } from "@/features/practical/http";

/**
 * ADMIN-only practical image delivery. The admin must see BOTH the labeled
 * source and the clean exam derivative to visually compare them while placing
 * the spotter arrow. Images are resolved by DB imageId (never by an arbitrary
 * storageKey from the URL), then served from the private filesystem. This route
 * is intentionally separate from the STUDENT route, which is eligibility-gated
 * to approved exam derivatives only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  await requireAdmin();
  try {
    const imageId = (await params).imageId;
    const [image] = await db.select().from(practicalImage).where(eq(practicalImage.id, imageId)).limit(1);
    if (!image) return new Response(JSON.stringify({ error: "Image not found" }), { status: 404, headers: privateHeaders });
    const asset = await readPracticalImage(image as PracticalImage);
    return new Response(new Uint8Array(asset.bytes), {
      headers: { ...privateHeaders, "Content-Type": asset.mime, "Content-Security-Policy": "default-src 'none'; sandbox" },
    });
  } catch (error) { return practicalFailure(error); }
}