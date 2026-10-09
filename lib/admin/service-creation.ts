export const TARGET_TYPES = ["username", "url", "post_url", "video_url", "channel", "page"] as const;
export type ServiceTargetType = typeof TARGET_TYPES[number];

export type CreateServiceInput = {
  platformId: string;
  name: string;
  category: string;
  description: string;
  serviceType: string;
  targetType: string;
  minQuantity: string;
  maxQuantity: string;
  sellingRate: string;
  currency: string;
};

export function slugFromName(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function validateCreateServiceInput(input: CreateServiceInput) {
  const name = input.name.trim(); const slug = slugFromName(name); const category = input.category.trim();
  const description = input.description.trim(); const serviceType = input.serviceType.trim(); const currency = input.currency.trim().toUpperCase();
  const minQuantity = Number(input.minQuantity); const maxQuantity = Number(input.maxQuantity); const sellingRate = input.sellingRate.trim();
  if (!input.platformId) throw new Error("A platform is required.");
  if (!name || name.length > 120) throw new Error("Service name must be between 1 and 120 characters.");
  if (!slug || slug.length > 120) throw new Error("Service name must produce a valid slug.");
  if (!category || category.length > 120) throw new Error("Category must be between 1 and 120 characters.");
  if (description.length > 1000) throw new Error("Description must be 1,000 characters or fewer.");
  if (!serviceType || serviceType.length > 80) throw new Error("Service type must be between 1 and 80 characters.");
  if (!(TARGET_TYPES as readonly string[]).includes(input.targetType)) throw new Error("Target type is unsupported.");
  if (!Number.isSafeInteger(minQuantity) || minQuantity <= 0 || !Number.isSafeInteger(maxQuantity) || maxQuantity < minQuantity) throw new Error("Quantity bounds are invalid.");
  if (!/^\d+(\.\d{1,6})?$/.test(sellingRate) || Number(sellingRate) <= 0) throw new Error("Selling rate must be a positive decimal.");
  if (currency !== "GHS") throw new Error("Currency must be GHS.");
  return { platformId: input.platformId, name, slug, category, description: description || null, serviceType, targetType: input.targetType as ServiceTargetType, minQuantity, maxQuantity, sellingRate, currency };
}
