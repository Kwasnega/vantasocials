import { NextRequest, NextResponse } from "next/server";

import { runR4Test } from "../../../../../lib/fulfillment/reliablesmm/r4";
import { ReliableSMMReadOnlyClient } from "../../../../../lib/fulfillment/reliablesmm/client";

export async function GET(request: NextRequest) {
  const secret = process.env.R4_INTERNAL_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.R4_TEST_MODE !== "true") return NextResponse.json({ error: "R4 test mode is disabled." }, { status: 423 });
  const orderId = new URL(request.url).searchParams.get("order");
  if (orderId !== "6939428") return NextResponse.json({ error: "Only the approved R4 order can be monitored." }, { status: 400 });
  try { return NextResponse.json(await new ReliableSMMReadOnlyClient().getStatus(orderId)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Status check failed." }, { status: 502 }); }
}

export async function POST(request: NextRequest) {
  const secret = process.env.R4_INTERNAL_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as { service?: unknown; link?: unknown; quantity?: unknown };
    const result = await runR4Test({ serviceId: String(body.service || ""), link: String(body.link || ""), quantity: Number(body.quantity) });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "R4 test failed." }, { status: 400 });
  }
}
