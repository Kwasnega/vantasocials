import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin/auth";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";

export async function GET() {
  const { admin } = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createSupabaseAdminClient();
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  // Non-final deposits older than 30 minutes
  const { data: deposits, error } = await db
    .from("wallet_deposit_payments")
    .select(`
      id,
      user_id,
      wallet_id,
      reference,
      amount_minor,
      currency,
      status,
      created_at,
      provider_response,
      profiles:user_id (
        id,
        email
      )
    `)
    .not("status", "in", '("PAID","FAILED","ABANDONED")')
    .lt("created_at", thirtyMinsAgo)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const formatted = (deposits || []).map((d: any) => {
    const pResp = (d.provider_response && typeof d.provider_response === "object" ? d.provider_response : {}) as Record<string, any>;
    return {
      id: d.id,
      userId: d.user_id,
      userEmail: d.profiles?.email || "Unknown",
      reference: d.reference,
      amount: Number(d.amount_minor || 0) / 100,
      currency: d.currency,
      status: d.status,
      createdAt: d.created_at,
      lastCheck: pResp.last_check || null,
      isReconciled: Boolean(pResp.reconciled),
      reconciliationNote: pResp.reconciliation_note || null,
    };
  });

  return NextResponse.json({ deposits: formatted });
}

export async function POST(request: Request) {
  const { admin } = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const paystackKey = process.env.PAYSTACK_SECRET_KEY;
  if (!paystackKey) {
    return NextResponse.json({ error: "Paystack secret key is missing" }, { status: 500 });
  }

  const db = createSupabaseAdminClient();
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  let body: { depositIds?: string[] } = {};
  try {
    body = await request.json();
  } catch {
    // Optional body
  }

  // Get candidate deposits
  let query = db
    .from("wallet_deposit_payments")
    .select("id,user_id,reference,amount_minor,currency,status,provider_response")
    .not("status", "in", '("PAID","FAILED","ABANDONED")')
    .lt("created_at", thirtyMinsAgo)
    .order("created_at", { ascending: false })
    .limit(20);

  if (body?.depositIds?.length) {
    query = query.in("id", body.depositIds);
  }

  const { data: deposits, error } = await query;
  if (error || !deposits) {
    return NextResponse.json({ error: error?.message || "Failed to fetch deposits" }, { status: 500 });
  }

  const results: any[] = [];

  for (const deposit of deposits) {
    try {
      const paystackRes = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(deposit.reference)}`,
        {
          headers: {
            Authorization: `Bearer ${paystackKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      const paystackData = await paystackRes.json();
      const tx = paystackData.data;
      const paystackStatus = tx?.status
        ? tx.status.toUpperCase()
        : paystackData.status === false
        ? (paystackData.code === "transaction_not_found" ? "NOT_FOUND" : "FAILED")
        : "UNKNOWN";

      const checkedAt = new Date().toISOString();
      const pResp = (deposit.provider_response && typeof deposit.provider_response === "object" ? deposit.provider_response : {}) as Record<string, any>;
      const updatedResponse = {
        ...pResp,
        last_check: {
          checked_at: checkedAt,
          checked_by: admin.id,
          paystack_status: paystackStatus,
          amount: tx?.amount ?? null,
          currency: tx?.currency ?? null,
          paid_at: tx?.paid_at ?? null,
          gateway_response: tx?.gateway_response ?? paystackData.message ?? null,
        },
      };

      await db
        .from("wallet_deposit_payments")
        .update({
          provider_response: updatedResponse,
          updated_at: checkedAt,
        })
        .eq("id", deposit.id);

      results.push({
        id: deposit.id,
        reference: deposit.reference,
        our_status: deposit.status,
        paystack_status: paystackStatus,
        amount: tx?.amount ? tx.amount / 100 : Number(deposit.amount_minor) / 100,
        paid_at: tx?.paid_at ?? null,
        success: true,
      });

      // Small delay between calls to prevent rate limiting
      await new Promise((r) => setTimeout(r, 200));
    } catch (e) {
      results.push({
        id: deposit.id,
        reference: deposit.reference,
        error: e instanceof Error ? e.message : String(e),
        success: false,
      });
    }
  }

  return NextResponse.json({ checked_count: results.length, results });
}
