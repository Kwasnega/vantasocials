import { NextResponse } from "next/server";
import { clientIp, consumeRateLimits, rateLimited } from "../../../lib/security/rate-limit";
import { getPlatforms } from "../../../lib/catalog/platforms";

export async function GET(request: Request) {
  try { const rl = await consumeRateLimits([{ key: `ip:${clientIp(request)}:catalog`, limit: 120, windowSeconds: 60 }]); if (!rl.allowed) return rateLimited(rl); } catch { /* public catalog may fail open */ }
  try { return NextResponse.json(await getPlatforms()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load platforms." }, { status: 503 }); }
}
