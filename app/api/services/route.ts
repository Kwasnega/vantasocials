import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../lib/catalog/services";
import { clientIp, consumeRateLimits, rateLimited } from "../../../lib/security/rate-limit";

export async function GET(request: NextRequest) {
  try { const rl = await consumeRateLimits([{ key: `ip:${clientIp(request)}:catalog`, limit: 120, windowSeconds: 60 }]); if (!rl.allowed) return rateLimited(rl); } catch { /* public catalog may fail open */ }
  try { return NextResponse.json(await getServices(request.nextUrl.searchParams.get("platform") ?? undefined)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load services." }, { status: 503 }); }
}
