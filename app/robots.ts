import type { MetadataRoute } from "next";
import { getServerSiteUrl, getSiteHost } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getServerSiteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/game", "/anime", "/tv", "/movie", "/manga", "/lightnovel", "/work"],
        disallow: ["/api/", "/trends", "/*/s/*", "/ops-x7k9m2-panel"],
      },
    ],
    host: getSiteHost(siteUrl),
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
