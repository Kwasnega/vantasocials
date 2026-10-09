import assert from "node:assert/strict";
import { slugFromName, validateCreateServiceInput } from "../lib/admin/service-creation.ts";

const valid = { platformId: "platform-1", name: "  New Likes  ", category: "Likes", description: "", serviceType: "standard", targetType: "url", minQuantity: "100", maxQuantity: "100000", sellingRate: "0.01", currency: "GHS" };
assert.equal(slugFromName(valid.name), "new-likes");
assert.equal(validateCreateServiceInput(valid).slug, "new-likes");
for (const field of ["platformId", "name", "category", "serviceType", "targetType", "minQuantity", "maxQuantity", "sellingRate"]) { const input = { ...valid, [field]: field === "name" ? "" : "" }; assert.throws(() => validateCreateServiceInput(input)); }
assert.throws(() => validateCreateServiceInput({ ...valid, targetType: "unknown" }));
assert.throws(() => validateCreateServiceInput({ ...valid, minQuantity: "10", maxQuantity: "1" }));
assert.throws(() => validateCreateServiceInput({ ...valid, sellingRate: "0" }));
assert.throws(() => validateCreateServiceInput({ ...valid, currency: "USD" }));
console.log("service-creation-tests: passed");
