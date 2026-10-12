export function escapePostgrestSearchTerm(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

export function buildAdminOrderPageHref(
  page: number,
  search: string,
  payment?: string,
  fulfillment?: string,
): string {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (payment) params.set("payment", payment);
  if (fulfillment) params.set("fulfillment", fulfillment);
  params.set("page", String(page));
  return `/admin/orders?${params.toString()}`;
}
