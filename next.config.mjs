/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // @ton/tolk-js's emscripten-generated compiler module guards
      // `require('fs'/'crypto')` behind a runtime Node-environment check,
      // but webpack still tries to statically resolve them for the
      // browser bundle -- Contract Studio only ever runs the WASM path
      // (dynamically imported client-side), so these are never actually
      // called in the browser.
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, crypto: false };
    }
    return config;
  },
};

export default nextConfig;
