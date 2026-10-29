import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("components/orders/OrderStatusRefresh.tsx", "utf8");

// 1. Terminal guard check
assert.match(source, /terminalStatuses\.has\(fulfillmentStatus\)/, "Must stop when fulfillment reaches terminal status");

// 2. Exponential backoff check
assert.match(source, /BACKOFF_SCHEDULE/, "Must define an exponential backoff schedule");
assert.match(source, /3000,\s*5000,\s*8000,\s*13000/, "Schedule must start at 3s and back off");

// 3. Pause on hidden check
assert.match(source, /document\.addEventListener\("visibilitychange"/, "Must register visibilitychange listener");
assert.match(source, /document\.removeEventListener\("visibilitychange"/, "Must clean up visibilitychange listener on unmount");
assert.match(source, /if \(!isTabVisibleRef\.current\) return/, "Must pause poll if tab is hidden");

// 4. Maximum polling duration / timeout check
assert.match(source, /MAX_POLLING_DURATION_MS/, "Must define a maximum polling duration");
assert.match(source, /setPollingTimedOut\(true\)/, "Must time out and offer manual refresh after max duration");

// 5. Refresh only on change
assert.match(source, /status\.paymentStatus !== paymentStatus/, "Must check payment status delta");
assert.match(source, /status\.fulfillmentStatus !== fulfillmentStatus/, "Must check fulfillment status delta");
assert.match(source, /router\.refresh\(\)/, "Must refresh via router when status changed");

console.log("order-status-polling-tests: passed");
