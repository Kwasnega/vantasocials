import type { MetadataRoute } from "next";
import { getCanonicalSiteOrigin } from "../lib/network/origin";

const BASE_URL = getCanonicalSiteOrigin();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin/",
          "/api/",
          "/account/",
          "/checkout/",
          "/payment-result/",
          "/payments/",
          "/logout/",
          "/success/",
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
