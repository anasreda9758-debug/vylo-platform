import { getSession } from "@/shared/session";
import { practicalService } from "@/features/practical/store";
import { readPracticalImage } from "@/features/practical/images";
import { requestScope, practicalFailure, privateHeaders } from "@/features/practical/http";

export async function GET(request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  try {
    const session = await getSession();
    const image = await practicalService.image(session?.user ?? null, requestScope(new URL(request.url)), (await params).imageId);
    const asset = await readPracticalImage(image);
    return new Response(new Uint8Array(asset.bytes), { headers: { ...privateHeaders, "Content-Type": asset.mime, "Content-Security-Policy": "default-src 'none'; sandbox" } });
  } catch (error) { return practicalFailure(error); }
}
