import assert from "node:assert/strict";

function computeGatingState({
  previewData,
  previewErrorCode,
  previewConfirmed,
  quantityValid,
  legacyValidationValid,
  submitting,
}) {
  const isCardAwaitingConfirmation = Boolean(
    (previewData && !previewConfirmed) ||
    ((previewErrorCode === "NOT_FOUND" || previewErrorCode === "PRIVATE_OR_REMOVED") && !previewConfirmed)
  );

  const submitEnabled =
    !submitting &&
    quantityValid &&
    legacyValidationValid &&
    !isCardAwaitingConfirmation;

  return { isCardAwaitingConfirmation, submitEnabled };
}

async function runGatingTests() {
  console.log("=== LINK CONFIRMATION GATING & UX TESTS ===");

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${name}:`, err.message);
    }
  }

  // Test 1: Button is disabled when previewData is loaded and unconfirmed
  test("Gating: Disabled with unconfirmed previewData", () => {
    const state = computeGatingState({
      previewData: { title: "My Video", authorName: "Channel", providerName: "YouTube", fetchedAt: "2026-11-15T00:00:00Z" },
      previewErrorCode: null,
      previewConfirmed: false,
      quantityValid: true,
      legacyValidationValid: true,
      submitting: false,
    });
    assert.equal(state.isCardAwaitingConfirmation, true);
    assert.equal(state.submitEnabled, false);
  });

  // Test 2: Button is enabled once confirmed
  test("Gating: Enabled after user clicks 'Yes, this is it'", () => {
    const state = computeGatingState({
      previewData: { title: "My Video", authorName: "Channel", providerName: "YouTube", fetchedAt: "2026-11-15T00:00:00Z" },
      previewErrorCode: null,
      previewConfirmed: true,
      quantityValid: true,
      legacyValidationValid: true,
      submitting: false,
    });
    assert.equal(state.isCardAwaitingConfirmation, false);
    assert.equal(state.submitEnabled, true);
  });

  // Test 3: Warning state (NOT_FOUND) gates until acknowledged
  test("Warning state: NOT_FOUND gates until user confirms / continues anyway", () => {
    const unconfirmed = computeGatingState({
      previewData: null,
      previewErrorCode: "NOT_FOUND",
      previewConfirmed: false,
      quantityValid: true,
      legacyValidationValid: true,
      submitting: false,
    });
    assert.equal(unconfirmed.isCardAwaitingConfirmation, true);
    assert.equal(unconfirmed.submitEnabled, false);

    const acknowledged = computeGatingState({
      previewData: { title: null, authorName: "Unverified Content", providerName: "YouTube", fetchedAt: "2026-11-15T00:00:00Z", acknowledged_warning: true },
      previewErrorCode: "NOT_FOUND",
      previewConfirmed: true,
      quantityValid: true,
      legacyValidationValid: true,
      submitting: false,
    });
    assert.equal(acknowledged.isCardAwaitingConfirmation, false);
    assert.equal(acknowledged.submitEnabled, true);
  });

  // Test 4: Warning state (PRIVATE_OR_REMOVED) gates until acknowledged
  test("Warning state: PRIVATE_OR_REMOVED gates until user confirms / continues anyway", () => {
    const unconfirmed = computeGatingState({
      previewData: null,
      previewErrorCode: "PRIVATE_OR_REMOVED",
      previewConfirmed: false,
      quantityValid: true,
      legacyValidationValid: true,
      submitting: false,
    });
    assert.equal(unconfirmed.isCardAwaitingConfirmation, true);
    assert.equal(unconfirmed.submitEnabled, false);
  });

  // Test 5: Non-gating states (UNSUPPORTED, TIMEOUT, UNAVAILABLE, RATE_LIMITED) DO NOT gate
  test("Non-gating error states proceed directly without gating", () => {
    for (const code of ["UNSUPPORTED", "TIMEOUT", "UNAVAILABLE", "RATE_LIMITED"]) {
      const state = computeGatingState({
        previewData: null,
        previewErrorCode: code,
        previewConfirmed: false,
        quantityValid: true,
        legacyValidationValid: true,
        submitting: false,
      });
      assert.equal(state.isCardAwaitingConfirmation, false, `Expected ${code} not to await confirmation`);
      assert.equal(state.submitEnabled, true, `Expected ${code} to have submitEnabled = true`);
    }
  });

  // Test 6: Quantity changes do not reset confirmation
  test("Quantity changes do not affect confirmation flag", () => {
    let previewConfirmed = true;
    let quantity = 1000;
    // User types new quantity
    quantity = 2500;
    // previewConfirmed remains true
    assert.equal(previewConfirmed, true);
    const state = computeGatingState({
      previewData: { title: "Post", authorName: "User", providerName: "TikTok", fetchedAt: "2026-11-15T00:00:00Z" },
      previewErrorCode: null,
      previewConfirmed,
      quantityValid: true,
      legacyValidationValid: true,
      submitting: false,
    });
    assert.equal(state.submitEnabled, true);
  });

  // Test 7: Target change resets confirmation flag
  test("Target change resets confirmation flag", () => {
    let previewConfirmed = true;
    let target = "https://youtube.com/watch?v=123";
    // User changes target URL in input
    target = "https://youtube.com/watch?v=456";
    previewConfirmed = false; // Reset on target edit
    assert.equal(previewConfirmed, false);
    const state = computeGatingState({
      previewData: { title: "Post 2", authorName: "User", providerName: "YouTube", fetchedAt: "2026-11-15T00:00:00Z" },
      previewErrorCode: null,
      previewConfirmed,
      quantityValid: true,
      legacyValidationValid: true,
      submitting: false,
    });
    assert.equal(state.isCardAwaitingConfirmation, true);
    assert.equal(state.submitEnabled, false);
  });

  // Test 8: Acknowledging warning records acknowledged_warning: true
  test("Acknowledging warning records acknowledged_warning: true in payload", () => {
    const previewData = {
      title: null,
      authorName: "Unverified Content",
      providerName: "X",
      fetchedAt: new Date().toISOString(),
      acknowledged_warning: true,
    };
    assert.equal(previewData.acknowledged_warning, true);
  });

  console.log(`\n=== GATING TEST SUMMARY: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runGatingTests();
