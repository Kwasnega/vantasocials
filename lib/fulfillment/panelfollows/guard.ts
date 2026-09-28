import "server-only";

import { PanelFollowsReadOnlyClient } from "./client";

export async function assertPanelFollowsCanFulfill(client = new PanelFollowsReadOnlyClient()) {
  const account = await client.getAccount();
  if (account.currency !== "USD") throw new Error("PanelFollows account currency is not supported.");
  if (account.balance === "0" || /^0+(\.0+)?$/.test(account.balance)) throw new Error("PanelFollows balance is zero.");
  return account;
}

// Deliberately remains read-only: a balance check is required immediately before
// any future fulfillment, but this phase has no provider-order capability.
