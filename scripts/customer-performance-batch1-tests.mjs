import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function createHarness({ fetch: fetchMock }) {
  const state = [];
  const calls = [];
  const navigations = [];
  const timerDelays = [];
  let hookIndex = 0;
  const router = { push: (url) => navigations.push(url) };

  const hooks = {
    useState(initial) {
      const index = hookIndex++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (value) => {
        state[index] = typeof value === "function" ? value(state[index]) : value;
      }];
    },
    useRef(initial) {
      const index = hookIndex++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
    useMemo(factory) {
      hookIndex += 1;
      return factory();
    },
  };

  const window = {
    sessionStorage: {
      values: new Map(),
      getItem(key) { return this.values.get(key) ?? null; },
      setItem(key, value) { this.values.set(key, value); },
      removeItem(key) { this.values.delete(key); },
    },
    location: { href: "" },
    setTimeout(callback, delay) {
      timerDelays.push(delay);
      callback();
      return timerDelays.length;
    },
    clearTimeout() {},
  };

  const jsxRuntime = {
    jsx: (type, props) => ({ type, props: props ?? {} }),
    jsxs: (type, props) => ({ type, props: props ?? {} }),
    Fragment: Symbol("Fragment"),
  };
  const react = Object.fromEntries(Object.entries(hooks).map(([name, hook]) => [
    name,
    (...args) => hook(...args),
  ]));

  function compile(filePath, importMocks = {}) {
    const source = fs.readFileSync(filePath, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    const module = { exports: {} };
    const require = (specifier) => {
      if (specifier === "react") return react;
      if (specifier === "react/jsx-runtime") return jsxRuntime;
      if (specifier === "next/link") return { default: "a", __esModule: true };
      if (specifier === "next/navigation") return { useRouter: () => router };
      if (importMocks[specifier]) return importMocks[specifier];
      throw new Error(`Unexpected import in focused component test: ${specifier}`);
    };
    vm.runInNewContext(output, {
      module,
      exports: module.exports,
      require,
      fetch: fetchMock,
      window,
      crypto: crypto.webcrypto,
      TextEncoder,
      URL,
      Error,
      console,
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
    });
    return module.exports;
  }

  return {
    calls,
    navigations,
    timerDelays,
    window,
    router,
    render(renderFn) {
      hookIndex = 0;
      return renderFn();
    },
    compile,
  };
}

function findNode(node, predicate) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNode(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  if (predicate(node)) return node;
  return findNode(node.props?.children, predicate);
}

function textContent(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return textContent(node.props?.children);
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

const serviceImports = {
  "../../lib/customer/service-contract": {
    getFieldControlType: () => "text",
    validateCustomerInputValue: () => ({ isValid: true, error: "" }),
  },
  "../../lib/pricing/customer-price": (() => {
    const source = fs.readFileSync("lib/pricing/customer-price.ts", "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(output, { module, exports: module.exports, Error });
    return module.exports;
  })(),
  "../../lib/targets/contracts": { getTargetContract: () => null },
};
const service = {
  id: "service-1",
  slug: "instagram-followers",
  name: "Instagram Followers",
  category: "Growth",
  target_type: "url",
  min_quantity: 10,
  max_quantity: 1000,
  selling_rate: "0.01",
  currency: "GHS",
};

for (const { pathName, inputFields } of [
  { pathName: "legacy", inputFields: [] },
  { pathName: "dynamic", inputFields: [{ key: "username", label: "Username", required: false, displayOrder: 0 }] },
]) {
  let fetchCount = 0;
  const harness = createHarness({
    fetch: async (url, options) => {
      fetchCount += 1;
      harness.calls.push({ url, options });
      return response(201, { public_order_id: "VNT-ABC123" });
    },
  });
  const { ServiceConfigurator } = harness.compile(
    "components/services/ServiceConfigurator.tsx",
    serviceImports,
  );
  const render = () => harness.render(() => ServiceConfigurator({
    service: { ...service, inputFields },
    platform: "Instagram",
  }));
  const button = findNode(render(), (node) => node.type === "button");
  assert.ok(button, `${pathName} order form renders a submit button`);
  await button.props.onClick();

  assert.equal(fetchCount, 1, `${pathName} submission makes one order request`);
  assert.equal(harness.navigations[0], "/checkout?order=VNT-ABC123");
  assert.equal(harness.window.sessionStorage.values.size, 0, "confirmed order clears the current retry intent");
}

{
  const harness = createHarness({ fetch: async () => response(201, { public_order_id: "VNT-NUMERIC" }) });
  const { ServiceConfigurator } = harness.compile("components/services/ServiceConfigurator.tsx", serviceImports);
  const rendered = harness.render(() => ServiceConfigurator({
    service: { ...service, selling_rate: 0.01 },
    platform: "Instagram",
  }));
  assert.ok(findNode(rendered, (node) => node.type === "button"), "numeric database rate renders in the service configurator");
}

for (const { label, status, body, reject } of [
  { label: "rejected order", status: 400, body: { error: "Invalid target." } },
  { label: "ambiguous server order response", status: 500, body: { error: "Unable to create order." } },
  { label: "unconfirmed successful response", status: 201, body: {} },
  { label: "ambiguous network outcome", reject: new Error("connection lost") },
]) {
  let fetchCount = 0;
  const harness = createHarness({
    fetch: async () => {
      fetchCount += 1;
      if (reject) throw reject;
      return response(status, body);
    },
  });
  const { ServiceConfigurator } = harness.compile(
    "components/services/ServiceConfigurator.tsx",
    serviceImports,
  );
  const render = () => harness.render(() => ServiceConfigurator({ service, platform: "Instagram" }));
  const button = findNode(render(), (node) => node.type === "button");
  await button.props.onClick();

  assert.deepEqual(harness.navigations, [], `${label} does not navigate`);
  assert.equal(fetchCount, 1, `${label} does not trigger an automatic duplicate submission`);
  const alert = findNode(render(), (node) => node.props?.role === "alert");
  assert.ok(alert, `${label} displays an error`);
  if (label !== "rejected order") {
    assert.match(textContent(alert), /couldn’t confirm the order/i);
    assert.equal(harness.window.sessionStorage.values.size, 1, "ambiguous order retains its idempotency key");
  } else {
    assert.match(textContent(alert), /Invalid target/);
  }
}

{
  const paymentOptionsSource = fs.readFileSync("components/checkout/CheckoutPaymentOptions.tsx", "utf8");
  assert.doesNotMatch(paymentOptionsSource, /Direct Payment \(Paystack\)|Cards|MoMo|Pay via Paystack|CheckoutPayButton/);
  const harness = createHarness({
    fetch: async () => response(200, {
      order: { public_order_id: "VNT-WALLET1", payment_status: "PAID" },
      debit_id: "debit-1",
    }),
  });
  const { CheckoutPayButton } = harness.compile("components/checkout/CheckoutPayButton.tsx");
  const { CheckoutPaymentOptions } = harness.compile(
    "components/checkout/CheckoutPaymentOptions.tsx",
    { "./CheckoutPayButton": { CheckoutPayButton } },
  );
  const tree = harness.render(() => CheckoutPaymentOptions({
    orderId: "VNT-WALLET1",
    balanceMinor: "5000",
    totalAmount: "10.00",
  }));
  assert.match(textContent(tree), /VANTA Wallet/);
  assert.doesNotMatch(textContent(tree), /Direct Payment \(Paystack\)|Cards|MoMo/);
  const button = findNode(tree, (node) => node.type === "button" && node.props?.className === "checkout-btn checkout-btn-wallet");
  assert.ok(button, "wallet payment action is available with sufficient balance");
  await button.props.onClick();
  assert.deepEqual(harness.navigations, ["/account/orders/VNT-WALLET1"]);
  assert.deepEqual(harness.timerDelays, [], "confirmed wallet payment has no artificial delay");
}

for (const { label, fetchMock, expectedMessage } of [
  {
    label: "declined wallet payment",
    fetchMock: async () => response(402, { error: "Insufficient wallet balance." }),
    expectedMessage: /Insufficient wallet balance/,
  },
  {
    label: "ambiguous wallet payment",
    fetchMock: async () => { throw new Error("connection lost"); },
    expectedMessage: /couldn’t confirm the payment result/i,
  },
  {
    label: "ambiguous wallet server response",
    fetchMock: async () => response(502, { error: "Payment failed." }),
    expectedMessage: /couldn’t confirm the payment result/i,
  },
  {
    label: "unconfirmed wallet response",
    fetchMock: async () => response(200, { order: { public_order_id: "VNT-WALLET1", payment_status: "UNPAID" } }),
    expectedMessage: /couldn’t confirm the payment result/i,
  },
  {
    label: "wallet response for a different order",
    fetchMock: async () => response(200, { order: { public_order_id: "VNT-OTHER", payment_status: "PAID" } }),
    expectedMessage: /couldn’t confirm the payment result/i,
  },
]) {
  let fetchCount = 0;
  const harness = createHarness({
    fetch: async (...args) => {
      fetchCount += 1;
      return fetchMock(...args);
    },
  });
  const { CheckoutPayButton } = harness.compile("components/checkout/CheckoutPayButton.tsx");
  const { CheckoutPaymentOptions } = harness.compile(
    "components/checkout/CheckoutPaymentOptions.tsx",
    { "./CheckoutPayButton": { CheckoutPayButton } },
  );
  const render = () => harness.render(() => CheckoutPaymentOptions({
    orderId: "VNT-WALLET1",
    balanceMinor: "5000",
    totalAmount: "10.00",
  }));
  const button = findNode(render(), (node) => node.type === "button" && node.props?.className === "checkout-btn checkout-btn-wallet");
  await button.props.onClick();

  assert.deepEqual(harness.navigations, [], `${label} does not navigate to success`);
  assert.equal(fetchCount, 1, `${label} does not automatically retry payment`);
  const alert = findNode(render(), (node) => node.props?.role === "alert");
  assert.ok(alert, `${label} shows an error`);
  assert.match(textContent(alert), expectedMessage);
}

{
  const harness = createHarness({
    fetch: async () => response(200, {
      authorization_url: "https://checkout.paystack.com/test-authorization",
    }),
  });
  const { CheckoutPayButton } = harness.compile("components/checkout/CheckoutPayButton.tsx");
  const tree = harness.render(() => CheckoutPayButton({ orderId: "VNT-PAYSTACK1" }));
  const button = findNode(tree, (node) => node.type === "button");
  await button.props.onClick();
  assert.equal(harness.window.location.href, "https://checkout.paystack.com/test-authorization");
  assert.deepEqual(harness.navigations, [], "Paystack continues to use external authorization navigation");
}

const orderDetail = fs.readFileSync("app/account/orders/[id]/page.tsx", "utf8");
assert.match(orderDetail, /requireUser\(/, "order destination requires authentication");
assert.match(orderDetail, /\.eq\("public_order_id", id\)\s*\.eq\("user_id", user\.id\)/, "order destination loads the requested user's authoritative order");
assert.match(orderDetail, /payment_status/, "order destination renders server-confirmed payment state");

console.log("customer-performance-batch1-tests: passed");
