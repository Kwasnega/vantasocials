import { NextResponse } from "next/server";
import { getService } from "../../../../lib/catalog/services";
import { clientIp, consumeRateLimits, rateLimited } from "../../../../lib/security/rate-limit";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try { const rl = await consumeRateLimits([{ key: `ip:${clientIp(request)}:catalog-service`, limit: 180, windowSeconds: 60 }]); if (!rl.allowed) return rateLimited(rl); } catch { /* public catalog may fail open */ }
  try {
    const service = await getService((await params).slug);
    return service ? NextResponse.json(service) : NextResponse.json({ error: "Service not found." }, { status: 404 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load service." }, { status: 503 }); }
}
