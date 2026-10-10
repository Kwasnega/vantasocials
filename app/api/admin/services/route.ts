import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { validateCreateServiceInput } from "../../../../lib/admin/service-creation";
import { resolveProviderCompatibility, sameProviderPlatform } from "../../../../lib/admin/provider-compatibility";

export async function POST(request: Request) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  try {
    const input = validateCreateServiceInput(body as Parameters<typeof validateCreateServiceInput>[0]);
    const db = createSupabaseAdminClient();
    const { data: platform } = await db.from("platforms").select("id,name,slug").eq("id", input.platformId).eq("active", true).maybeSingle();
    if (!platform) return NextResponse.json({ error: "Platform was not found or is inactive." }, { status: 400 });
    const { data: duplicate } = await db.from("services").select("id").eq("slug", input.slug).maybeSingle();
    if (duplicate) return NextResponse.json({ error: "A service with this name/slug already exists." }, { status: 409 });
    const providerServiceId = body && typeof body.providerServiceId === "string" ? body.providerServiceId.trim() : "";
    if (providerServiceId) {
      const { data: catalog } = await db.from("provider_catalog_services").select("provider_service_id,provider_status,raw_metadata").eq("provider", "reliablesmm").eq("provider_service_id", providerServiceId).maybeSingle();
      if (!catalog || catalog.provider_status !== "ACTIVE") return NextResponse.json({ error: "The selected provider catalog service is no longer active." }, { status: 409 });
      const compatibility = resolveProviderCompatibility(catalog.raw_metadata);
      if (!compatibility.compatibility) return NextResponse.json({ error: `Cannot create this VANTA service yet — ${compatibility.reason}` }, { status: 409 });
      if (!sameProviderPlatform(compatibility.compatibility.platform, platform)) return NextResponse.json({ error: "This provider service belongs to a platform VANTA does not currently support for this service." }, { status: 409 });
      if (compatibility.compatibility.targetType !== input.targetType) return NextResponse.json({ error: "The selected target type does not match the provider's authoritative target requirement." }, { status: 409 });
      const { data: existing } = await db.from("services").select("slug,name").eq("provider", "reliablesmm").eq("provider_service_id", providerServiceId).maybeSingle();
      if (existing) return NextResponse.json({ error: `This provider service is already mapped to ${existing.name}.` }, { status: 409 });
    }
    const { data: service, error } = await db.from("services").insert({ platform_id: input.platformId, name: input.name, slug: input.slug, category: input.category, description: input.description, service_type: input.serviceType, target_type: input.targetType, min_quantity: input.minQuantity, max_quantity: input.maxQuantity, selling_rate: input.sellingRate, currency: input.currency, active: false }).select("id,platform_id,name,slug,category,description,service_type,target_type,min_quantity,max_quantity,selling_rate,currency,active,provider,provider_service_id").single();
    if (error) { if (error.code === "23505") return NextResponse.json({ error: "A service with this name/slug already exists." }, { status: 409 }); throw error; }
    return NextResponse.json({ service }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create service." }, { status: 400 }); }
}
