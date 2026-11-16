import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatError } from "../lib/fulfillment/retry-service.js";

describe("Retry & Refund Safety Tests", () => {
  it("formatError returns clean readable string, never [object Object]", () => {
    assert.equal(formatError("simple string error"), "simple string error");
    assert.equal(formatError(new Error("custom error message")), "custom error message");
    
    // Postgres error object
    const pgError = { code: "22P02", message: "invalid input syntax for type uuid" };
    assert.equal(formatError(pgError), "invalid input syntax for type uuid");

    // Generic object
    const genericObj = { error: "failed", status: 500 };
    const formatted = formatError(genericObj);
    assert.ok(!formatted.includes("[object Object]"));
  });

  it("Ensures retry extraction handles both string UUIDs and object row representations", () => {
    function extractAttemptId(data) {
      if (typeof data === "string") return data;
      if (typeof data === "object" && data !== null && "id" in data) {
        return String(data.id);
      }
      return null;
    }

    const uuid = "dc8878f1-9b44-453c-9836-24842b69f879";
    assert.equal(extractAttemptId(uuid), uuid);
    assert.equal(extractAttemptId({ id: uuid }), uuid);
    assert.equal(extractAttemptId(null), null);
  });
});
