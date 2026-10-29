import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin } from "../../../../../../../lib/admin/auth";
import { getServiceFieldInsertPayload, normalizeFieldDraft } from "../../../../../../../lib/admin/service-input-config";
import { createSupabaseAdminClient } from "../../../../../../../lib/supabase/server";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../../../../lib/security/rate-limit";

const SERVICE_INPUT_FIELD_SELECT_COLUMNS = "id,service_id,key,label,input_type,required,display_order,placeholder,help_text,validation_config,schema_version,active,created_at,updated_at";

export async function PATCH(request: Request, { params }: { params: Promise<{ serviceId: string; fieldId: string }> }) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const rejected = await enforceAdminRateLimit(request, user.id, "service-field-mutation", [30, 30]);
    if (rejected) return rejected;
  } catch {
    return limiterUnavailable();
  }
  const { serviceId, fieldId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const { data: current, error: lookupError } = await db.from("service_input_fields").select(SERVICE_INPUT_FIELD_SELECT_COLUMNS).eq("service_id", serviceId).eq("id", fieldId).maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Field lookup failed." }, { status: 500 });
  if (!current) return NextResponse.json({ error: "Field not found for this service." }, { status: 404 });

  try {
    const merged = {
      ...current,
      key: body.key ?? current.key,
      label: body.label ?? current.label,
      inputType: body.inputType ?? body.input_type ?? current.input_type,
      required: body.required ?? current.required,
      displayOrder: body.displayOrder ?? body.display_order ?? current.display_order,
      placeholder: body.placeholder ?? current.placeholder ?? undefined,
      helpText: body.helpText ?? body.help_text ?? current.help_text ?? undefined,
      validationConfig: body.validationConfig ?? body.validation_config ?? current.validation_config ?? {},
      schemaVersion: body.schemaVersion ?? body.schema_version ?? current.schema_version,
      active: body.active ?? current.active,
    };
    const field = normalizeFieldDraft(merged);
    const duplicateKey = await db.from("service_input_fields").select("id").eq("service_id", serviceId).eq("key", field.key).neq("id", fieldId).maybeSingle();
    if (duplicateKey.data) return NextResponse.json({ error: "A field with this key already exists for this service." }, { status: 409 });
    const { service_id: _serviceId, ...payload } = getServiceFieldInsertPayload(field, serviceId);

    // No-op check: if payload values are identical to current, skip the write
    const isNoOp =
      payload.key === current.key &&
      payload.label === current.label &&
      payload.input_type === current.input_type &&
      payload.required === current.required &&
      payload.display_order === current.display_order &&
      payload.placeholder === current.placeholder &&
      payload.help_text === current.help_text &&
      payload.schema_version === current.schema_version &&
      payload.active === current.active &&
      JSON.stringify(payload.validation_config) === JSON.stringify(current.validation_config);

    if (isNoOp) {
      return NextResponse.json({ field: current });
    }

    const { data, error } = await db.from("service_input_fields").update(payload).eq("id", fieldId).select(SERVICE_INPUT_FIELD_SELECT_COLUMNS).single();
    if (error) throw error;
    try { revalidateTag("catalog"); } catch { /* best-effort revalidation */ }
    return NextResponse.json({ field: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update field." }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ serviceId: string; fieldId: string }> }) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const rejected = await enforceAdminRateLimit(request, user.id, "service-field-delete", [30, 30]);
    if (rejected) return rejected;
  } catch {
    return limiterUnavailable();
  }
  const { serviceId, fieldId } = await params;
  const db = createSupabaseAdminClient();
  const { data: current, error: lookupError } = await db.from("service_input_fields").select("id,active").eq("service_id", serviceId).eq("id", fieldId).maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Field lookup failed." }, { status: 500 });
  if (!current) return NextResponse.json({ error: "Field not found for this service." }, { status: 404 });
  if (!current.active) {
    return NextResponse.json({ field: current });
  }
  const { data, error } = await db.from("service_input_fields").update({ active: false }).eq("id", fieldId).select(SERVICE_INPUT_FIELD_SELECT_COLUMNS).single();
  if (error) return NextResponse.json({ error: "Unable to deactivate field." }, { status: 500 });
  try { revalidateTag("catalog"); } catch { /* best-effort revalidation */ }
  return NextResponse.json({ field: data });
}
