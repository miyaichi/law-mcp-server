#!/usr/bin/env node

const entry = new URL("../dist/src/index.js", import.meta.url);

import(entry.href).catch((error) => {
  console.error(
    "Failed to start law-mcp-server. Run `npm run build` to generate dist/ before launching."
  );
  console.error(error);
  process.exit(1);
});
