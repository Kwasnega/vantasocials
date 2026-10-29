import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const containerName = "supabase_db_vanta";
const dockerPath = process.env.DOCKER_CLI
  ?? (process.platform === "win32"
    ? "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe"
    : "docker");

function runDocker(args, options = {}) {
  const result = spawnSync(dockerPath, ["--context", "desktop-linux", ...args], {
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function startPsql(sql) {
  const child = spawn(
    dockerPath,
    [
      "--context",
      "desktop-linux",
      "exec",
      "-i",
      containerName,
      "psql",
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const run = { child, stdout: "", stderr: "", done: false, status: null };
  child.stdout.setEncoding("utf8").on("data", (chunk) => { run.stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { run.stderr += chunk; });
  child.on("error", (error) => {
    run.stderr += error.message;
    run.done = true;
    run.status = 1;
  });
  child.on("close", (status) => {
    run.done = true;
    run.status = status;
  });
  child.stdin.end(sql);
  return run;
}

async function waitForPsqlMarker(run, marker, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (run.stdout.includes(marker)) return;
    if (run.done) {
      throw new Error(`psql exited before marker "${marker}": ${run.stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  run.child.kill();
  throw new Error(`Timed out waiting for psql marker "${marker}"`);
}

function finishPsql(run) {
  return new Promise((resolve) => {
    if (run.done) {
      resolve({ status: run.status, stdout: run.stdout, stderr: run.stderr });
      return;
    }
    run.child.once("close", (status) => {
      resolve({ status, stdout: run.stdout, stderr: run.stderr });
    });
  });
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runLocalSql(sql, args = []) {
  const result = runDocker([
    "exec",
    "-i",
    containerName,
    "psql",
    "-X",
    "-q",
    "-A",
    "-t",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "postgres",
    ...args,
  ], { input: sql });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

const inspectResult = runDocker([
  "inspect",
  containerName,
  "--format",
  "{{json .}}",
]);
assert.equal(inspectResult.status, 0, inspectResult.stderr);
const container = JSON.parse(inspectResult.stdout);
assert.equal(container.Name, `/${containerName}`);
assert.match(container.Config.Image, /^public\.ecr\.aws\/supabase\/postgres:/);
assert.equal(container.State.Status, "running");
assert.equal(container.State.Health.Status, "healthy");
assert.equal(container.Config.Labels["com.docker.compose.project"], "vanta");
assert.equal(container.Config.Labels["com.supabase.cli.project"], "vanta");
assert.equal(container.NetworkSettings.Ports["5432/tcp"][0].HostPort, "54322");

const sql = String.raw`
begin;
set local request.jwt.claim.role = 'service_role';

create function public.__local_bundleup_test_abort_order_delete()
returns trigger
language plpgsql
as $test$
begin
  raise exception 'LOCAL_TEST_ABORT_ORDER_DELETE';
end;
$test$;

do $test$
declare
  v_user_id uuid := gen_random_uuid();
  v_service_id uuid;
  v_service_slug text;
  v_order_id uuid := gen_random_uuid();
  v_gateway_order_id uuid := gen_random_uuid();
  v_reuse_order_id uuid := gen_random_uuid();
  v_payment_id uuid := gen_random_uuid();
  v_gateway_payment_id uuid;
  v_request_id uuid := gen_random_uuid();
  v_reference text := 'local-tombstone-' || replace(gen_random_uuid()::text, '-', '');
  v_nonce text := 'nonce-' || replace(gen_random_uuid()::text, '-', '');
  v_order_reference text;
  v_intent_id text := repeat('a', 64);
  v_wallet_id uuid;
  v_result jsonb;
  v_blocked boolean := false;
  v_rollback_seen boolean := false;
  v_reuse_rejected boolean := false;
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20261027000000'
  ) or not exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20261027000001'
  ) then
    raise exception 'REQUIRED_GATEWAY_MIGRATIONS_NOT_APPLIED';
  end if;

  select id, slug into v_service_id, v_service_slug
  from public.services order by id limit 1;
  if v_service_id is null then
    raise exception 'NO_SEEDED_SERVICE_AVAILABLE';
  end if;

  insert into auth.users (id, email, raw_user_meta_data)
  values (
    v_user_id,
    'local-gateway-' || replace(v_user_id::text, '-', '') || '@example.invalid',
    '{}'::jsonb
  );
  insert into public.wallets (user_id, balance_minor)
  values (v_user_id, 875);
  select id into v_wallet_id from public.wallets where user_id = v_user_id;

  insert into public.orders (
    id, user_id, service_id, target_type, target_value, quantity,
    unit_price, subtotal, total, currency, status, payment_status,
    idempotency_key, idempotency_fingerprint, idempotency_service_slug
  ) values (
    v_order_id, v_user_id, v_service_id, 'username', 'local-test-target',
    1, 12.50, 12.50, 12.50, 'GHS', 'PENDING_PAYMENT', 'UNPAID',
    gen_random_uuid(), repeat('a', 64), v_service_slug
  );

  insert into public.payments (
    id, order_id, user_id, provider, reference, amount, currency, status
  ) values (
    v_payment_id, v_order_id, v_user_id, 'paystack', v_reference,
    12.50, 'GHS', 'FAILED'
  );

  perform public.claim_paystack_provider_reference(v_payment_id, v_reference);
  perform public.claim_paystack_provider_reference(v_payment_id, v_reference);
  if (
    select count(*) from public.payment_provider_reference_claims
    where provider = 'paystack' and actual_provider_reference = v_reference
      and payment_id = v_payment_id
  ) <> 1 then
    raise exception 'LIVE_REFERENCE_CLAIM_NOT_IDEMPOTENT';
  end if;

  insert into public.orders (
    id, user_id, service_id, target_type, target_value, quantity,
    unit_price, subtotal, total, currency, status, payment_status,
    idempotency_key, idempotency_fingerprint, idempotency_service_slug
  ) values (
    v_gateway_order_id, v_user_id, v_service_id, 'username', 'local-gateway-target',
    1, 12.50, 12.50, 12.50, 'GHS', 'PENDING_PAYMENT', 'UNPAID',
    gen_random_uuid(), repeat('b', 64), v_service_slug
  );

  select payment.id into v_gateway_payment_id
  from public.reserve_bundleup_gateway_payment_attempt(
    v_gateway_order_id,
    v_user_id,
    'https://vanta.local.test/payments/bundleup/return'
  ) payment;
  if v_gateway_payment_id is null then
    raise exception 'GATEWAY_ATTEMPT_RESERVATION_FAILED';
  end if;

  select public_order_id into v_order_reference
  from public.orders where id = v_gateway_order_id;

  insert into public.bundleup_gateway_reconciliation_requests (
    id, payment_id, order_id, user_id, tenant_id, request_nonce,
    request_timestamp, request_body, order_reference, amount_minor,
    currency, intent_id, state, expires_at
  ) values (
    v_request_id, v_gateway_payment_id, v_gateway_order_id, v_user_id,
    'vanta', v_nonce,
    floor(extract(epoch from clock_timestamp()))::bigint::text,
    convert_to('{}', 'UTF8'), v_order_reference, 1250, 'GHS',
    null, 'OPEN', timezone('utc', now()) + interval '1 hour'
  );

  insert into public.bundleup_gateway_payment_evidence (
    payment_id, request_id, contract_version, key_id, tenant_id,
    order_reference, intent_id, provider, provider_reference, amount_minor,
    currency, provider_status, issued_at, verified_at, request_nonce,
    signed_payload, signature
  ) values (
    v_gateway_payment_id, v_request_id, 1, 'local-test', 'vanta',
    v_order_reference, v_intent_id, 'paystack',
    'local-evidence-' || replace(v_gateway_payment_id::text, '-', ''),
    1250, 'GHS', 'success', timezone('utc', now()), timezone('utc', now()),
    v_nonce, convert_to('{}', 'UTF8'), decode(repeat('00', 64), 'hex')
  );

  begin
    perform public.admin_wipe_order_financial_data('WIPE ALL DATA');
  exception when others then
    if sqlerrm = 'WIPE_BLOCKED_PENDING_PAYMENT' then
      v_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_blocked then
    raise exception 'PENDING_GATEWAY_ATTEMPT_DID_NOT_BLOCK_WIPE';
  end if;
  if not exists (select 1 from public.payments where id = v_gateway_payment_id)
     or not exists (select 1 from public.bundleup_gateway_payment_evidence where payment_id = v_gateway_payment_id) then
    raise exception 'BLOCKED_WIPE_CHANGED_RECORDS';
  end if;

  update public.payments
     set gateway_initialization_status = 'INITIALIZING'
   where id = v_gateway_payment_id;
  update public.payments
     set status = 'FAILED',
         gateway_initialization_status = 'INITIALIZATION_REJECTED'
   where id = v_gateway_payment_id;

  create trigger __local_bundleup_test_abort_order_delete
    before delete on public.orders
    for each row execute function public.__local_bundleup_test_abort_order_delete();

  begin
    perform public.admin_wipe_order_financial_data('WIPE ALL DATA');
  exception when others then
    if sqlerrm = 'LOCAL_TEST_ABORT_ORDER_DELETE' then
      v_rollback_seen := true;
    else
      raise;
    end if;
  end;
  drop trigger __local_bundleup_test_abort_order_delete on public.orders;

  if not v_rollback_seen
     or not exists (select 1 from public.orders where id = v_order_id)
     or not exists (select 1 from public.payments where id = v_payment_id)
     or not exists (
       select 1 from public.payment_provider_reference_claims
       where provider = 'paystack'
         and actual_provider_reference = v_reference
         and payment_id = v_payment_id
     )
     or not exists (select 1 from public.bundleup_gateway_payment_evidence where payment_id = v_gateway_payment_id)
     or not exists (select 1 from public.bundleup_gateway_reconciliation_requests where id = v_request_id) then
    raise exception 'FAILED_WIPE_DID_NOT_ROLL_BACK_ALL_DELETIONS';
  end if;

  v_result := public.admin_wipe_order_financial_data('WIPE ALL DATA');
  if not (v_result ? 'orders')
     or not (v_result ? 'payments')
     or exists (select 1 from public.orders)
     or exists (select 1 from public.payments)
     or exists (select 1 from public.bundleup_gateway_payment_evidence)
     or exists (select 1 from public.bundleup_gateway_reconciliation_requests) then
    raise exception 'SUCCESSFUL_WIPE_LEFT_DEPENDENT_RECORDS';
  end if;
  if not exists (
    select 1 from public.payment_provider_reference_claims
    where provider = 'paystack'
      and actual_provider_reference = v_reference
      and payment_id is null
  ) then
    raise exception 'WIPE_DID_NOT_PRESERVE_REFERENCE_TOMBSTONE';
  end if;
  if not exists (
    select 1 from public.wallets
    where id = v_wallet_id and user_id = v_user_id and balance_minor = 0
  ) then
    raise exception 'WIPE_DID_NOT_PRESERVE_AND_RESET_WALLET';
  end if;

  insert into public.orders (
    id, user_id, service_id, target_type, target_value, quantity,
    unit_price, subtotal, total, currency, status, payment_status,
    idempotency_key, idempotency_fingerprint, idempotency_service_slug
  ) values (
    v_reuse_order_id, v_user_id, v_service_id, 'username', 'reference-reuse-target',
    1, 12.50, 12.50, 12.50, 'GHS', 'PENDING_PAYMENT', 'UNPAID',
    gen_random_uuid(), repeat('c', 64), v_service_slug
  );
  begin
    insert into public.payments (
      id, order_id, user_id, provider, reference, amount, currency, status
    ) values (
      gen_random_uuid(), v_reuse_order_id, v_user_id, 'paystack', v_reference,
      12.50, 'GHS', 'FAILED'
    );
  exception when unique_violation then
    if sqlerrm = 'PROVIDER_REFERENCE_ALREADY_CLAIMED' then
      v_reuse_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_reuse_rejected
     or exists (select 1 from public.payments where reference = v_reference) then
    raise exception 'TOMBSTONED_REFERENCE_WAS_RECLAIMED';
  end if;

  raise notice 'DATABASE_TESTS_PASSED: live_claim_idempotency, pending_gateway_wipe_guard, failed_wipe_rollback, tombstone_retention, tombstone_reuse_rejected, gateway_evidence_cleanup, wallet_preservation';
end;
$test$;

rollback;
`;

const result = runDocker(
  [
    "exec",
    "-i",
    containerName,
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "postgres",
  ],
  { input: sql },
);

if (result.status !== 0) {
  process.stderr.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);

const userId = randomUUID();
const orderId = randomUUID();
const requestId = randomUUID();
const nonce = `nonce_${randomUUID().replaceAll("-", "")}`;
const serviceId = runLocalSql("select id from public.services order by id limit 1;");
assert.match(serviceId, /^[0-9a-f-]{36}$/i, "Local service catalog must be seeded");

const setupSql = `
begin;
set local request.jwt.claim.role = 'service_role';
insert into auth.users (id, email, raw_user_meta_data)
values (${sqlLiteral(userId)}, ${sqlLiteral(`local-race-${userId}@example.invalid`)}, '{}'::jsonb);
insert into public.orders (
  id, user_id, service_id, target_type, target_value, quantity,
  unit_price, subtotal, total, currency, status, payment_status,
  idempotency_key, idempotency_fingerprint, idempotency_service_slug
) values (
  ${sqlLiteral(orderId)}, ${sqlLiteral(userId)}, ${sqlLiteral(serviceId)},
  'username', 'concurrency-test-target', 1, 12.50, 12.50, 12.50,
  'GHS', 'PENDING_PAYMENT', 'UNPAID', gen_random_uuid(),
  repeat('d', 64), (select slug from public.services where id = ${sqlLiteral(serviceId)})
);
select id from public.reserve_bundleup_gateway_payment_attempt(
  ${sqlLiteral(orderId)},
  ${sqlLiteral(userId)},
  'https://vanta.local.test/payments/bundleup/return'
);
commit;
`;
const setupOutput = runLocalSql(setupSql);
const paymentId = setupOutput.split(/\s+/).find((value) => /^[0-9a-f-]{36}$/i.test(value));
assert.ok(paymentId, "Gateway reservation must return a payment UUID");
const orderReference = runLocalSql(
  `select public_order_id from public.orders where id = ${sqlLiteral(orderId)};`,
);
const intentId = createHash("sha256")
  .update(Buffer.concat([
    Buffer.from("vanta", "utf8"),
    Buffer.from([0]),
    Buffer.from(`idempotency:${paymentId.toLowerCase()}`, "utf8"),
  ]))
  .digest("hex");
const providerReference = `VANTA-${intentId}`;
const issuedAt = new Date().toISOString();
const timestamp = String(Math.floor(Date.now() / 1000));
const payload = JSON.stringify({
  version: 1,
  key_id: "local-db-test",
  tenant_id: "vanta",
  payment_id: paymentId.toLowerCase(),
  order_reference: orderReference,
  intent_id: intentId,
  request_nonce: nonce,
  issued_at: issuedAt,
  outcome: "payment_verified",
  provider: "paystack",
  reference: providerReference,
  amount_minor: 1250,
  currency: "GHS",
  provider_status: "success",
  verified_at: issuedAt,
  transaction_id: `local-db-tx-${paymentId}`,
});
const requestBody = JSON.stringify({
  tenant_id: "vanta",
  payment_id: paymentId.toLowerCase(),
  order_reference: orderReference,
  amount_minor: 1250,
  currency: "GHS",
  intent_id: intentId,
});
const requestSql = `
insert into public.bundleup_gateway_reconciliation_requests (
  id, payment_id, order_id, user_id, tenant_id, request_nonce,
  request_timestamp, request_body, order_reference, amount_minor,
  currency, intent_id, state, expires_at
) values (
  ${sqlLiteral(requestId)}, ${sqlLiteral(paymentId)}, ${sqlLiteral(orderId)},
  ${sqlLiteral(userId)}, 'vanta', ${sqlLiteral(nonce)}, ${sqlLiteral(timestamp)},
  convert_to(${sqlLiteral(requestBody)}, 'UTF8'), ${sqlLiteral(orderReference)},
  1250, 'GHS', ${sqlLiteral(intentId)}, 'OPEN',
  timezone('utc', now()) + interval '1 hour'
);
`;
runLocalSql(`set request.jwt.claim.role = 'service_role'; ${requestSql}`);

const signedPayloadHex = Buffer.from(payload, "utf8").toString("hex");
const signatureHex = Buffer.alloc(64, 0xab).toString("hex");
const settleSql = `
begin;
set local request.jwt.claim.role = 'service_role';
select settled || ':' || already_settled
  from public.settle_bundleup_gateway_order_payment(
    ${sqlLiteral(paymentId)},
    ${sqlLiteral(userId)},
    ${sqlLiteral(requestId)},
    decode(${sqlLiteral(signedPayloadHex)}, 'hex'),
    decode(${sqlLiteral(signatureHex)}, 'hex')
  );
select 'SETTLEMENT_LOCKS_HELD';
select pg_sleep(3);
commit;
`;
const settleRun = startPsql(settleSql);
let concurrencyPassed = false;
let wipeRun;
try {
  await waitForPsqlMarker(settleRun, "SETTLEMENT_LOCKS_HELD");
  wipeRun = startPsql(`
    set request.jwt.claim.role = 'service_role';
    select public.admin_wipe_order_financial_data('WIPE ALL DATA');
  `);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(wipeRun.done, false, "Wipe must wait for the in-flight settlement row locks");

  const [settlementResult, wipeResult] = await Promise.all([
    finishPsql(settleRun),
    finishPsql(wipeRun),
  ]);
  assert.equal(settlementResult.status, 0, settlementResult.stderr);
  assert.match(settlementResult.stdout, /true:false/, "Settlement should commit exactly once");
  assert.equal(wipeResult.status, 0, wipeResult.stderr);
  assert.match(wipeResult.stdout, /"payments": 1/, "Wipe should run after settlement commits");
  assert.match(wipeResult.stdout, /"orders": 1/);

  const postRaceState = runLocalSql(`
    select
      (select count(*) from public.payments where id = ${sqlLiteral(paymentId)}) || '|' ||
      (select count(*) from public.orders where id = ${sqlLiteral(orderId)}) || '|' ||
      (select count(*) from public.bundleup_gateway_payment_evidence where payment_id = ${sqlLiteral(paymentId)}) || '|' ||
      (select count(*) from public.bundleup_gateway_reconciliation_requests where id = ${sqlLiteral(requestId)}) || '|' ||
      (select count(*) from public.payment_provider_reference_claims
        where provider = 'paystack'
          and actual_provider_reference = ${sqlLiteral(providerReference)}
          and payment_id is null);
  `);
  assert.equal(postRaceState, "0|0|0|0|1", "Wipe must leave only the provider-reference tombstone");
  process.stdout.write("concurrency test: settlement locked the rows; wipe ran afterward and retained the tombstone\n");
  concurrencyPassed = true;
} finally {
  if (!settleRun.done) settleRun.child.kill();
  if (wipeRun && !wipeRun.done) wipeRun.child.kill();
  if (!concurrencyPassed) {
    runLocalSql(`
      begin;
      set local request.jwt.claim.role = 'service_role';
      delete from public.bundleup_gateway_payment_evidence where payment_id = ${sqlLiteral(paymentId)};
      delete from public.bundleup_gateway_reconciliation_requests where payment_id = ${sqlLiteral(paymentId)};
      delete from public.payments where id = ${sqlLiteral(paymentId)};
      delete from public.orders where id = ${sqlLiteral(orderId)};
      commit;
    `);
  }
  runLocalSql(`delete from auth.users where id = ${sqlLiteral(userId)};`);
}
