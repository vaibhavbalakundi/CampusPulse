import type { NextConfig } from "next";
import os from "node:os";

const localOrigins = ["127.0.0.1", "localhost"];
for (const addrs of Object.values(os.networkInterfaces())) {
  for (const addr of addrs ?? []) {
    if (!addr.internal && addr.address.includes(".")) localOrigins.push(addr.address);
  }
}

const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  poweredByHeader: false,
  allowedDevOrigins: [...new Set(localOrigins)]
};
export default config;
