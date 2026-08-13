import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so the build ignores any stray lockfile in a parent
  // directory rather than guessing which one belongs to this project.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
