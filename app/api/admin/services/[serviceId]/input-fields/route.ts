import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../lib/admin/auth";
import { getServiceFieldInsertPayload, normalizeFieldDraft } from "../../../../../../lib/admin/service-input-config";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ serviceId: string }> }) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { serviceId } = await params;
  const db = createSupabaseAdminClient();
  const { data: service, error: serviceError } = await db.from("services").select("id,name,slug").eq("id", serviceId).maybeSingle();
  if (serviceError) return NextResponse.json({ error: "Service lookup failed." }, { status: 500 });
  if (!service) return NextResponse.json({ error: "VANTA service not found." }, { status: 404 });
  const { data: fields, error: fieldsError } = await db.from("service_input_fields").select("*").eq("service_id", serviceId).order("display_order", { ascending: true }).order("created_at", { ascending: true });
  if (fieldsError) return NextResponse.json({ error: "Field lookup failed." }, { status: 500 });
  return NextResponse.json({ service, fields: fields ?? [] });
}

export async function POST(request: Request, { params }: { params: Promise<{ serviceId: string }> }) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { serviceId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const { data: service } = await db.from("services").select("id").eq("id", serviceId).maybeSingle();
  if (!service) return NextResponse.json({ error: "VANTA service not found." }, { status: 404 });

  try {
    const field = normalizeFieldDraft(body);
    const { data: duplicate } = await db.from("service_input_fields").select("id").eq("service_id", serviceId).eq("key", field.key).maybeSingle();
    if (duplicate) return NextResponse.json({ error: "A field with this key already exists for this service." }, { status: 409 });
    const payload = getServiceFieldInsertPayload(field, serviceId);
    const { data, error } = await db.from("service_input_fields").insert(payload).select("*").single();
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "A field with this key already exists for this service." }, { status: 409 });
      throw error;
    }
    return NextResponse.json({ field: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create field." }, { status: 400 });
  }
}
