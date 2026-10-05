import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { calculatePricing, type RateUnit } from "../../../../../lib/pricing/engine";

const PREVIEW_QUANTITY = 10000;

export async function GET(request: Request) {
  const { user, admin } = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const providerRate = params.get("provider_rate") ?? "";
  const providerRateUnit = params.get("rate_unit") as RateUnit;
  const fxRate = params.get("fx_rate") ?? "";
  const sellingPrice = params.get("selling_price") ?? "";
  if (!["PER_UNIT", "PER_1000", "PER_ORDER"].includes(providerRateUnit) || !providerRate || !fxRate || !sellingPrice) {
    return NextResponse.json({ error: "Complete pricing inputs are required." }, { status: 400 });
  }
  try {
    return NextResponse.json(calculatePricing({ providerRate, providerRateUnit, providerCurrency: "USD", fxRate, sellingPricePerUnit: sellingPrice, sellingCurrency: "GHS", quantity: PREVIEW_QUANTITY }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid pricing inputs." }, { status: 400 });
  }
}
