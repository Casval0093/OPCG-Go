const hasOwn = Object.prototype.hasOwnProperty;

function canonicalError(code, detail) {
  const error = new TypeError(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}

function unsupported(detail) {
  throw canonicalError("canonical_unsupported_value", detail);
}

function normalizeString(value) {
  const normalized = value.normalize("NFC");
  for (let index = 0; index < normalized.length; index += 1) {
    const codeUnit = normalized.charCodeAt(index);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const nextCodeUnit = normalized.charCodeAt(index + 1);
      if (!(nextCodeUnit >= 0xDC00 && nextCodeUnit <= 0xDFFF)) {
        throw canonicalError("canonical_invalid_unicode");
      }
      index += 1;
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      throw canonicalError("canonical_invalid_unicode");
    }
  }
  return normalized;
}

function compareUtf16(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isArrayIndex(key, length) {
  if (key === "") return false;
  const index = Number(key);
  return Number.isInteger(index)
    && index >= 0
    && index < length
    && index < 2 ** 32 - 1
    && String(index) === key;
}

function normalizeArray(value, activeStack) {
  activeStack.add(value);
  try {
    const length = value.length;
    if (!Number.isSafeInteger(length) || length < 0) {
      unsupported("invalid_array_length");
    }

    const ownKeys = Reflect.ownKeys(value);
    for (const key of ownKeys) {
      if (typeof key === "symbol") {
        unsupported("symbol_key");
      }
      if (key === "length") continue;
      if (!isArrayIndex(key, length)) {
        unsupported(`array_property:${key}`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !hasOwn.call(descriptor, "value")) {
        unsupported(`array_property:${key}`);
      }
    }

    const normalized = [];
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      if (!hasOwn.call(value, key)) {
        unsupported("array_hole");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !hasOwn.call(descriptor, "value")) {
        unsupported(`array_property:${key}`);
      }
      normalized.push(normalize(descriptor.value, activeStack));
    }
    return normalized;
  } finally {
    activeStack.delete(value);
  }
}

function normalizeObject(value, activeStack) {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    unsupported(`object_prototype:${prototype?.constructor?.name ?? "unknown"}`);
  }

  activeStack.add(value);
  try {
    const entries = [];
    const normalizedKeys = new Set();
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "symbol") {
        unsupported("symbol_key");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !hasOwn.call(descriptor, "value")) {
        unsupported(`object_property:${key}`);
      }
      const normalizedKey = normalizeString(key);
      if (normalizedKeys.has(normalizedKey)) {
        throw canonicalError("canonical_key_collision", normalizedKey);
      }
      normalizedKeys.add(normalizedKey);
      entries.push({ key: normalizedKey, value: descriptor.value });
    }
    entries.sort((left, right) => compareUtf16(left.key, right.key));

    const normalized = Object.create(null);
    for (const entry of entries) {
      normalized[entry.key] = normalize(entry.value, activeStack);
    }
    return normalized;
  } finally {
    activeStack.delete(value);
  }
}

function normalize(value, activeStack) {
  if (value === null) return null;

  switch (typeof value) {
    case "string":
      return normalizeString(value);
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        throw canonicalError("canonical_non_finite_number");
      }
      return Object.is(value, -0) ? 0 : value;
    case "object":
      if (activeStack.has(value)) {
        throw canonicalError("canonical_cycle");
      }
      return Array.isArray(value)
        ? normalizeArray(value, activeStack)
        : normalizeObject(value, activeStack);
    default:
      unsupported(typeof value);
  }
}

export function canonicalJson(value) {
  return Buffer.from(JSON.stringify(normalize(value, new Set())), "utf8");
}
