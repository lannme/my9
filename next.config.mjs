import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

initOpenNextCloudflareForDev();

const isDev = process.env.NODE_ENV !== "production";

/** @type {import("next").NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  ...(isDev && {
    turbopack: {
      rules: {
        "**/*.{tsx,jsx}": {
          loaders: [
            {
              loader: "@locator/webpack-loader",
              options: { env: "development" },
            },
          ],
        },
      },
    },
  }),
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.cloudflare.steamstatic.com",
      },
      {
        protocol: "http",
        hostname: "lain.bgm.tv",
      },
      {
        protocol: "https",
        hostname: "lain.bgm.tv",
      },
      {
        protocol: "http",
        hostname: "img.bgm.tv",
      },
      {
        protocol: "https",
        hostname: "img.bgm.tv",
      },
      {
        protocol: "https",
        hostname: "image.tmdb.org",
      },
    ],
  },
};

export default nextConfig;
