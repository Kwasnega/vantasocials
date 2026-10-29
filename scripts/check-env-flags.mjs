import fs from "fs";

const env = fs.readFileSync(".env.local", "utf8");
const getEnv = (k) => {
  const m = env.match(new RegExp(`^${k}=["']?([^"'\r\n]+)["']?`, "m"));
  return m ? m[1].trim() : process.env[k];
};

console.log("PANELS_LIVE_FULFILLMENT_ENABLED =", getEnv("PANELS_LIVE_FULFILLMENT_ENABLED"));
console.log("RELIABLESMM_CANARY_ORDER_ID =", getEnv("RELIABLESMM_CANARY_ORDER_ID"));
console.log("R4_TEST_MODE =", getEnv("R4_TEST_MODE"));
console.log("CRON_SECRET =", Boolean(getEnv("CRON_SECRET")));
