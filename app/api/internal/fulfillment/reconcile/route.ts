import { NextRequest, NextResponse } from "next/server";
import { reconcileReliableSMMBatch } from "../../../../../lib/fulfillment/reliablesmm/reconcile";

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await reconcileReliableSMMBatch(10);
  return NextResponse.json(result);
}
