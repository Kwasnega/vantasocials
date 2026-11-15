// scripts/test-failure-classifier.mjs
// Unit tests for classifyProviderFailure
import assert from "node:assert/strict";

const MAX_DETAIL_LENGTH = 500;

function truncate(s, max = MAX_DETAIL_LENGTH) {
  if (s.length <= max) return s;
  return s.substring(0, max - 3) + "...";
}

function extractMessage(error) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const e = error;
    if (typeof e.message === "string") return e.message;
    if (typeof e.error === "string") return e.error;
  }
  return String(error);
}

class ReliableSMMError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function classifyProviderFailure(error) {
  const message = extractMessage(error);
  const messageLower = message.toLowerCase();

  // 1. Timeout
  if (
    (error instanceof ReliableSMMError && error.code === "TIMEOUT") ||
    (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) ||
    /timeout|timed[\s_-]out|etimedout|408/i.test(messageLower)
  ) {
    return { reason: "provider_timeout", detail: truncate(`TIMEOUT: ${message}`) };
  }

  // 2. Pre-connection network error (provably did not reach provider)
  if (
    /econnrefused|ehostunreach|enotfound|getaddrinfo/i.test(messageLower)
  ) {
    return { reason: "provider_unreachable", detail: truncate(`NETWORK_PRECONNECT: ${message}`) };
  }

  // 3. Insufficient funds
  if (
    /not enough balance|insufficient funds|insufficient balance|not enough funds|balance|insufficient/i.test(messageLower)
  ) {
    return { reason: "provider_insufficient_funds", detail: truncate(`INSUFFICIENT_FUNDS: ${message}`) };
  }

  // 4. Invalid target
  if (
    /invalid link|bad link|invalid url|invalid target|private profile|link is private|page not found/i.test(messageLower)
  ) {
    return { reason: "invalid_target", detail: truncate(`INVALID_TARGET: ${message}`) };
  }

  // 5. Provider rejection
  if (
    (error instanceof ReliableSMMError && error.code === "PROVIDER_REJECTED") ||
    /incorrect request|service disabled|quantity is less|quantity is more/i.test(messageLower)
  ) {
    return { reason: "provider_rejected", detail: truncate(`REJECTED: ${message}`) };
  }

  // 6. Internal error
  if (
    /mapping|schema|invalid quantity|eligibility|service_id|provider_service_id|inactive|not configured|missing api key|rate limit/i.test(messageLower)
  ) {
    return { reason: "internal_error", detail: truncate(`INTERNAL: ${message}`) };
  }

  // 7. Unknown / ambiguous (includes 502, generic fetch failed)
  return { reason: "unknown", detail: truncate(`UNKNOWN: ${message}`) };
}

console.log("=== classifyProviderFailure Unit Tests ===\n");
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// provider_insufficient_funds
test('ReliableSMM "Not enough balance on your account" => provider_insufficient_funds', () => {
  const e = new ReliableSMMError("Not enough balance on your account", 200, "PROVIDER_REJECTED");
  const r = classifyProviderFailure(e);
  assert.equal(r.reason, "provider_insufficient_funds");
  assert.match(r.detail, /INSUFFICIENT_FUNDS/);
});

test('"insufficient funds" string => provider_insufficient_funds', () => {
  const r = classifyProviderFailure("insufficient funds in account");
  assert.equal(r.reason, "provider_insufficient_funds");
});

test('"balance" in message => provider_insufficient_funds', () => {
  const r = classifyProviderFailure("Your balance is too low");
  assert.equal(r.reason, "provider_insufficient_funds");
});

// invalid_target
test('"Bad link" => invalid_target', () => {
  const e = new ReliableSMMError("Bad link", 200, "PROVIDER_REJECTED");
  const r = classifyProviderFailure(e);
  assert.equal(r.reason, "invalid_target");
});

test('"Link is private" => invalid_target', () => {
  const r = classifyProviderFailure("Link is private");
  assert.equal(r.reason, "invalid_target");
});

// provider_timeout
test("ReliableSMMError with code TIMEOUT => provider_timeout", () => {
  const e = new ReliableSMMError("ReliableSMM request outcome is unknown.", 408, "TIMEOUT");
  const r = classifyProviderFailure(e);
  assert.equal(r.reason, "provider_timeout");
});

test("TimeoutError name => provider_timeout", () => {
  const e = new Error("The operation timed out");
  e.name = "TimeoutError";
  const r = classifyProviderFailure(e);
  assert.equal(r.reason, "provider_timeout");
});

// provider_unreachable (strictly pre-connect)
test('"ECONNREFUSED" => provider_unreachable', () => {
  const r = classifyProviderFailure("connect ECONNREFUSED 127.0.0.1:3000");
  assert.equal(r.reason, "provider_unreachable");
});

test('"EHOSTUNREACH" => provider_unreachable', () => {
  const r = classifyProviderFailure("EHOSTUNREACH error");
  assert.equal(r.reason, "provider_unreachable");
});

// 502 Bad Gateway and generic fetch failed must NOT be provider_unreachable (they are ambiguous, classified as unknown)
test("502 Bad Gateway => unknown (ambiguous, never auto-eligible)", () => {
  const r = classifyProviderFailure("502 Bad Gateway");
  assert.equal(r.reason, "unknown");
});

test('Generic "fetch failed" => unknown (ambiguous, never auto-eligible)', () => {
  const r = classifyProviderFailure("fetch failed");
  assert.equal(r.reason, "unknown");
});

// provider_rejected
test("Explicit provider rejection => provider_rejected", () => {
  const e = new ReliableSMMError("Incorrect request", 200, "PROVIDER_REJECTED");
  const r = classifyProviderFailure(e);
  assert.equal(r.reason, "provider_rejected");
});

// internal_error
test("Mapping error => internal_error", () => {
  const r = classifyProviderFailure("Dynamic order is missing active provider mappings.");
  assert.equal(r.reason, "internal_error");
});

// Priority: timeout wins over balance
test('Message with both "timeout" and "balance" => provider_timeout', () => {
  const r = classifyProviderFailure("Timeout: could not check balance");
  assert.equal(r.reason, "provider_timeout");
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
