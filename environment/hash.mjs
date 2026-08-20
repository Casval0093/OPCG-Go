import { createHash } from "node:crypto";

import { canonicalJson } from "./canonical.mjs";

export function sha256Canonical(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function hashProjection(value, omittedTopLevelKeys) {
  const omitted = new Set(omittedTopLevelKeys);
  return sha256Canonical(Object.fromEntries(
    Object.entries(value).filter(([key]) => !omitted.has(key)),
  ));
}
