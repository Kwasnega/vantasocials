import test from "node:test";
import assert from "node:assert/strict";
import { getCanonicalSiteOrigin } from "../lib/network/origin.ts";

test("getCanonicalSiteOrigin defaults to https://www.vantasocials.shop in production", () => {
  const origEnv = process.env.NODE_ENV;
  const origSite = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;

    assert.equal(getCanonicalSiteOrigin(), "https://www.vantasocials.shop");
  } finally {
    process.env.NODE_ENV = origEnv;
    process.env.NEXT_PUBLIC_SITE_URL = origSite;
  }
});

test("getCanonicalSiteOrigin rejects *.vercel.app in production", () => {
  const origEnv = process.env.NODE_ENV;
  const origSite = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "https://vantasocialsgh.vercel.app";

    assert.equal(getCanonicalSiteOrigin(), "https://www.vantasocials.shop");
  } finally {
    process.env.NODE_ENV = origEnv;
    process.env.NEXT_PUBLIC_SITE_URL = origSite;
  }
});

test("getCanonicalSiteOrigin rejects host-header / substring spoofing", () => {
  const origEnv = process.env.NODE_ENV;
  const origSite = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    process.env.NODE_ENV = "production";

    // Substring suffixes and prefixes
    const spoofAttempts = [
      "https://vantasocials.shop.evil.com",
      "https://notvantasocials.shop",
      "https://evil.com/vantasocials.shop",
      "https://www.vantasocials.shop.attacker.com",
      "https://subdomain.vantasocials.shop",
      "https://vantasocials.com",
      "http://www.vantasocials.shop", // non-https rejected in prod
    ];

    for (const attempt of spoofAttempts) {
      process.env.NEXT_PUBLIC_SITE_URL = attempt;
      assert.equal(
        getCanonicalSiteOrigin(),
        "https://www.vantasocials.shop",
        `Failed to reject spoof attempt: ${attempt}`
      );
    }
  } finally {
    process.env.NODE_ENV = origEnv;
    process.env.NEXT_PUBLIC_SITE_URL = origSite;
  }
});

test("getCanonicalSiteOrigin allows exact https://www.vantasocials.shop in production", () => {
  const origEnv = process.env.NODE_ENV;
  const origSite = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.vantasocials.shop";

    assert.equal(getCanonicalSiteOrigin(), "https://www.vantasocials.shop");
  } finally {
    process.env.NODE_ENV = origEnv;
    process.env.NEXT_PUBLIC_SITE_URL = origSite;
  }
});

test("getCanonicalSiteOrigin allows localhost in development/test", () => {
  const origEnv = process.env.NODE_ENV;
  const origSite = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    process.env.NODE_ENV = "development";
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";

    assert.equal(getCanonicalSiteOrigin(), "http://localhost:3000");
  } finally {
    process.env.NODE_ENV = origEnv;
    process.env.NEXT_PUBLIC_SITE_URL = origSite;
  }
});
