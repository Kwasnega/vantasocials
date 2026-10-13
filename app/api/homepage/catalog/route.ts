import { NextResponse } from "next/server";
import { getHomepageCatalog } from "../../../../lib/catalog/homepage";
import { clientIp, consumeRateLimits, rateLimited } from "../../../../lib/security/rate-limit";

export async function GET(request: Request) {
  try {
    const result = await consumeRateLimits([
      { key: `ip:${clientIp(request)}:catalog`, limit: 120, windowSeconds: 60 },
    ]);
    if (!result.allowed) return rateLimited(result);
  } catch {
    // Match the existing public catalog behavior when the limiter is unavailable.
  }

  try {
    return NextResponse.json(await getHomepageCatalog(), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load homepage catalog." },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
