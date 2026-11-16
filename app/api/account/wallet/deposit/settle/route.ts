import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../../../lib/supabase/server";
import { settlePendingDeposits } from "../../../../../../lib/wallet/settle-pending";
import { formatError } from "../../../../../../lib/errors/format-error";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  try {
    const result = await settlePendingDeposits(user.id);
    return NextResponse.json({
      success: true,
      checkedCount: result.checkedCount,
      creditedCount: result.creditedCount,
      totalCreditedMinor: result.totalCreditedMinor.toString(),
      creditedDeposits: result.creditedDeposits.map((d: { id: string; reference: string; amountMinor: bigint }) => ({
        id: d.id,
        reference: d.reference,
        amountMinor: d.amountMinor.toString(),
      })),
    });
  } catch (error) {
    console.error("Manual / sync settle call failed:", formatError(error));
    return NextResponse.json({ error: "Failed to settle deposits." }, { status: 500 });
  }
}
