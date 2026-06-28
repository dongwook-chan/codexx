#!/usr/bin/env node
"use strict";

const expectedArch = "arm64";
const supportedPlatforms = new Set(["darwin"]);

if (supportedPlatforms.has(process.platform) && process.arch === expectedArch) {
  process.exit(0);
}

console.error(
  [
    "cdxx installation aborted.",
    "Native supervisor package currently ships darwin/arm64 only.",
    `Current host is ${process.platform}/${process.arch}.`,
  ].join("\n"),
);
process.exit(1);
