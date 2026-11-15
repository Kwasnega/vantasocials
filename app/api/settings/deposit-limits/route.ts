import { NextResponse } from "next/server";
import { getMinDepositSetting, DEFAULT_MIN_DEPOSIT_GHS, MAX_DEPOSIT_GHS } from "../../../../lib/settings/deposit-settings";

export const revalidate = 30; // Cache for 30s in Next.js data cache

export async function GET() {
  try {
    const setting = await getMinDepositSetting();
    return NextResponse.json({
      minDepositGhs: setting.minDepositGhs,
      maxDepositGhs: MAX_DEPOSIT_GHS,
      formattedMin: setting.minDepositGhs.toFixed(2),
      formattedMax: MAX_DEPOSIT_GHS.toLocaleString("en-US", { minimumFractionDigits: 2 }),
      updatedAt: setting.updatedAt,
    }, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    console.warn("[api/settings/deposit-limits] Error retrieving deposit limits, using default:", err);
    return NextResponse.json({
      minDepositGhs: DEFAULT_MIN_DEPOSIT_GHS,
      maxDepositGhs: MAX_DEPOSIT_GHS,
      formattedMin: DEFAULT_MIN_DEPOSIT_GHS.toFixed(2),
      formattedMax: MAX_DEPOSIT_GHS.toLocaleString("en-US", { minimumFractionDigits: 2 }),
      updatedAt: null,
    });
  }
}
