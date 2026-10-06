import { count, eq } from "drizzle-orm";
import { db } from "@/shared/db";
import { practicalTrackOspeStation } from "@/features/ospe/schema";
import { createPracticalOspeScopeResolver } from "./ospe";
import { resolvePracticalTrack } from "./tracks";

export const resolvePracticalOspeScope = createPracticalOspeScopeResolver(resolvePracticalTrack, async (trackId) => {
  const [result] = await db.select({ value: count() }).from(practicalTrackOspeStation).where(eq(practicalTrackOspeStation.trackId, trackId));
  return Number(result?.value ?? 0);
});
