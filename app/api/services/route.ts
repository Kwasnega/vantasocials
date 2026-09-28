import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../lib/catalog/services";

export async function GET(request: NextRequest) {
  try { return NextResponse.json(await getServices(request.nextUrl.searchParams.get("platform") ?? undefined)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load services." }, { status: 503 }); }
}
