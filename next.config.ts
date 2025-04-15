import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    domains: ["via.placeholder.com"], // Add the allowed domain here
  },
  eslint: {
    ignoreDuringBuilds: true, // Ignore ESLint during builds
  },
  reactStrictMode: true, // Enable React Strict Mode
  swcMinify: true, // Enable SWC minification
  output: "standalone", // Generate a standalone build

  experimental: {
    serverActions: {
      bodySizeLimit: '50mb', // Increase to your desired limit
    },
  },

  // Optional: Add headers for security and performance
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "origin-when-cross-origin",
          },
        ],
      },
    ];
  },

  webpack: (config, { isServer }) => {
    if (isServer) {
      // Generate Prisma client during the build process
      // Add Sharp to the externals list to prevent bundling
      config.externals = [
        ...(config.externals || []),
        "@prisma/client",
        "sharp",
        "onnxruntime-node", // Exclude onnxruntime-node from bundling
        "puppeteer", // Add puppeteer to externals
        "puppeteer-core", // Add puppeteer-core to externals
      ];
    } else {
      // Exclude Node.js-specific modules from the client-side bundle
      config.resolve.fallback = {
        fs: false,
        path: false,
        os: false,
        net: false,
        tls: false,
        crypto: false,
        child_process: false, // Add 'child_process' to the fallback
      };
    }

    return config;
  },
};

export default nextConfig;