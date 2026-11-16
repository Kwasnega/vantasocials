import fs from "fs";

let content = fs.readFileSync("app/account/page.tsx", "utf8");

// Normalize line endings to \n
const isCrlf = content.includes("\r\n");
const normalized = content.replace(/\r\n/g, "\n");

const target = `  const [walletResult, overview, recentOrdersResult] = await Promise.all([
    db.from("wallets").select("balance_minor,currency").eq("user_id", user.id).maybeSingle(),
    getAccountOverviewStats(db, user.id),
    db.from("orders").select("public_order_id,total,currency,payment_status,fulfillment_status").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5),
  ]);
  if (walletResult.error) throw walletResult.error;
  if (recentOrdersResult.error) throw recentOrdersResult.error;

  const wallet = walletResult.data;
  const { totalOrders, spendByCurrency } = overview;
  const recentOrders = recentOrdersResult.data ?? [];`;

const replacement = `  const [walletResult, overview, recentOrdersResult, awaitingPaymentResult] = await Promise.all([
    db.from("wallets").select("balance_minor,currency").eq("user_id", user.id).maybeSingle(),
    getAccountOverviewStats(db, user.id),
    db.from("orders").select("public_order_id,total,currency,payment_status,fulfillment_status").eq("user_id", user.id).eq("payment_status", "PAID").order("created_at", { ascending: false }).limit(5),
    db.from("orders").select("public_order_id,total,currency,payment_status,fulfillment_status").eq("user_id", user.id).neq("payment_status", "PAID").order("created_at", { ascending: false }).limit(5),
  ]);
  if (walletResult.error) throw walletResult.error;
  if (recentOrdersResult.error) throw recentOrdersResult.error;

  const wallet = walletResult.data;
  const { totalOrders, spendByCurrency } = overview;
  const recentOrders = recentOrdersResult.data ?? [];
  const awaitingPaymentOrders = awaitingPaymentResult.data ?? [];`;

if (normalized.includes(target)) {
  const updated = normalized.replace(target, replacement);
  fs.writeFileSync("app/account/page.tsx", isCrlf ? updated.replace(/\n/g, "\r\n") : updated);
  console.log("REPLACED SUCCESSFULLY!");
} else {
  console.error("TARGET NOT FOUND IN NORMALIZED CONTENT");
}
