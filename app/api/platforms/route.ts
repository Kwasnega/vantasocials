import { NextResponse } from "next/server";
import { getPlatforms } from "../../../lib/catalog/platforms";

export async function GET() {
  try { return NextResponse.json(await getPlatforms()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load platforms." }, { status: 503 }); }
}
