import { NextResponse } from "next/server";
import { getService } from "../../../../lib/catalog/services";

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const service = await getService((await params).slug);
    return service ? NextResponse.json(service) : NextResponse.json({ error: "Service not found." }, { status: 404 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load service." }, { status: 503 }); }
}
