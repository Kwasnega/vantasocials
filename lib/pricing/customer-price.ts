const ADMIN_PRICE_SCALE = 3;
const INTERNAL_RATE_SCALE = 6;
const ORDER_TOTAL_SCALE = 2;
const MAX_ORDER_TOTAL_CENTS = 10n ** 18n - 1n;

function parseDecimal(value: string, maxFractionDigits: number): bigint {
  const normalized = value.trim();
  const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${maxFractionDigits}})?$`);
  if (!pattern.test(normalized)) throw new Error(`Price must be a non-negative decimal with at most ${maxFractionDigits} decimal places.`);
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 10n ** BigInt(maxFractionDigits) + BigInt(fraction.padEnd(maxFractionDigits, "0"));
}

function parseScaledNumber(value: number, scale: number): bigint {
  if (!Number.isFinite(value) || value < 0) throw new Error("Price must be a finite non-negative number.");
  const scaled = value * 10 ** scale;
  if (!Number.isSafeInteger(scaled) || scaled / 10 ** scale !== value) {
    throw new Error("Numeric price cannot be represented exactly at the supported precision.");
  }
  return BigInt(scaled);
}

function parseInternalRate(value: string | number): bigint {
  return typeof value === "string"
    ? parseDecimal(value, INTERNAL_RATE_SCALE)
    : parseScaledNumber(value, INTERNAL_RATE_SCALE);
}

function formatDecimal(value: bigint, scale: number): string {
  const divisor = 10n ** BigInt(scale);
  const whole = value / divisor;
  const fraction = (value % divisor).toString().padStart(scale, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

export function normalizeInternalUnitRate(value: string | number): string {
  return formatDecimal(parseInternalRate(value), INTERNAL_RATE_SCALE);
}

export function adminPricePer1000ToUnitRate(value: string, allowZero = true): string {
  const adminPriceScaled = parseDecimal(value, ADMIN_PRICE_SCALE);
  if (adminPriceScaled > 10n ** 18n - 1n) throw new Error("Customer price exceeds the supported storage range.");
  if (!allowZero && adminPriceScaled === 0n) throw new Error("Customer price per 1,000 units must be greater than zero.");
  return formatDecimal(adminPriceScaled, INTERNAL_RATE_SCALE);
}

export function unitRateToAdminPricePer1000(value: string | number): string {
  const unitRateScaled = parseInternalRate(value);
  return formatDecimal(unitRateScaled, ADMIN_PRICE_SCALE);
}

export function calculateCustomerTotal(unitRate: string | number, quantity: number): string {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Quantity must be a positive integer.");
  const unitRateScaled = parseInternalRate(unitRate);
  const cents = (unitRateScaled * BigInt(quantity) + 5000n) / 10000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

export function assertPayableOrderTotal(value: string | number): void {
  const cents = typeof value === "string"
    ? parseDecimal(value, ORDER_TOTAL_SCALE)
    : parseScaledNumber(value, ORDER_TOTAL_SCALE);
  if (cents < 1n) throw new Error("Order total must be at least GHS 0.01.");
  if (cents > MAX_ORDER_TOTAL_CENTS) throw new Error("Order total exceeds the supported GHS amount range.");
  const numericRoundTrip = Number(formatDecimal(cents, ORDER_TOTAL_SCALE)).toString();
  let numericRoundTripCents: bigint;
  try {
    numericRoundTripCents = parseDecimal(numericRoundTrip, ORDER_TOTAL_SCALE);
  } catch {
    throw new Error("Order total cannot be safely represented by payment amount handling.");
  }
  if (numericRoundTripCents !== cents) throw new Error("Order total cannot be safely represented by payment amount handling.");
}
