#!/usr/bin/env node
"use strict";

const {
  packagedNativeSupervisors,
  hostKey,
} = require("./native-targets.cjs");

if (packagedNativeSupervisors[hostKey()]) {
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
