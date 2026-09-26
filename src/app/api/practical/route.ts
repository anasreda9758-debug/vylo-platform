import { getSession } from "@/shared/session";
import { practicalService } from "@/features/practical/store";
import { answerBody, flagBody, requestScope, practicalFailure, privateHeaders } from "@/features/practical/http";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    const url = new URL(request.url);
    const result = await practicalService.list(session?.user ?? null, requestScope(url), url.searchParams.get("mode") === "wrong");
    return Response.json(result, { headers: privateHeaders });
  } catch (error) { return practicalFailure(error); }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return Response.json({ error: "Sign in required" }, { status: 401, headers: privateHeaders });
    const body = answerBody.parse(await request.json());
    const result = await practicalService.answer(session.user, requestScope(new URL(request.url)), body.questionId, body.optionId, body.requestId);
    return Response.json(result, { headers: privateHeaders });
  } catch (error) { return practicalFailure(error); }
}

export async function PATCH(request: Request) {
  try {
    const session = await getSession();
    if (!session) return Response.json({ error: "Sign in required" }, { status: 401, headers: privateHeaders });
    const body = flagBody.parse(await request.json());
    const result = await practicalService.flag(session.user, requestScope(new URL(request.url)), body.questionId, body.flag, body.value);
    return Response.json(result, { headers: privateHeaders });
  } catch (error) { return practicalFailure(error); }
}