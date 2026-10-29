import fs from "fs";

const env = fs.readFileSync(".env.local", "utf8");
const getEnv = (k) => {
  const m = env.match(new RegExp(`^${k}=["']?([^"'\r\n]+)["']?`, "m"));
  return m ? m[1].trim() : process.env[k];
};

const apiKey = getEnv("RELIABLESMM_API_KEY");

async function check() {
  const body = new URLSearchParams({
    key: apiKey,
    action: "balance"
  });
  console.log("Calling https://reliablesmm.com/api/v2 action=balance ...");
  try {
    const res = await fetch("https://reliablesmm.com/api/v2", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    console.log("Status:", res.status);
    const json = await res.json();
    console.log("Response:", json);
  } catch (e) {
    console.error("Error:", e);
  }
}

check();
