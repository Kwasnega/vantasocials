import { createSupabaseServerClient } from "../supabase/server";
import { sanitizeCustomerInputFields, type CustomerService } from "./service-contract";

export async function getCustomerService(slug: string): Promise<CustomerService | null> {
  const { getService: getCatalogService } = await import("../catalog/services");

  const baseService = await getCatalogService(slug);
  if (!baseService) return null;

  const supabase = await createSupabaseServerClient();
  const { data: rows, error } = await supabase
    .from("service_input_fields")
    .select("key,label,input_type,required,display_order,placeholder,help_text,validation_config,active,schema_version")
    .eq("service_id", baseService.id)
    .eq("active", true)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  if (!rows || rows.length === 0) return { ...baseService, inputFields: [] };

  try {
    return { ...baseService, inputFields: sanitizeCustomerInputFields(rows) };
  } catch {
    return { ...baseService, inputFields: [] };
  }
}
