function getPlainObjectPrototype(value: unknown): object | null | false {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null ? proto : false;
}

function isDangerousKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

/**
 * Recursively strips prototype-pollution keys (`__proto__`, `constructor`,
 * `prototype`) from plain objects and arrays.
 *
 * Returns the original reference unchanged when no dangerous keys are present
 * so clean payloads pay zero allocation cost.
 *
 * @internal
 */
export function stripDangerousKeys<T>(value: T, maxDepth = 32): T {
  if (maxDepth <= 0 || value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    let copy: unknown[] | undefined;
    for (let i = 0; i < value.length; i += 1) {
      const item = value[i];
      const cleaned = stripDangerousKeys(item, maxDepth - 1);
      if (cleaned !== item) {
        copy ??= value.slice();
        copy[i] = cleaned;
      }
    }
    return (copy ?? value) as T;
  }

  const proto = getPlainObjectPrototype(value);
  if (proto === false) {
    return value;
  }

  const record = value as Record<string, unknown>;
  let copy: Record<string, unknown> | undefined;

  for (const key in record) {
    if (proto === Object.prototype && !Object.hasOwn(record, key)) {
      continue;
    }
    if (isDangerousKey(key)) {
      if (copy === undefined) {
        copy = proto === null ? (Object.create(null) as Record<string, unknown>) : {};
        for (const prevKey in record) {
          if (prevKey === key) {
            break;
          }
          if (proto === Object.prototype && !Object.hasOwn(record, prevKey)) {
            continue;
          }
          copy[prevKey] = record[prevKey];
        }
      }
      continue;
    }

    const prop = record[key];
    const cleaned = stripDangerousKeys(prop, maxDepth - 1);
    if (cleaned !== prop && copy === undefined) {
      copy = proto === null ? (Object.create(null) as Record<string, unknown>) : {};
      for (const prevKey in record) {
        if (prevKey === key) {
          break;
        }
        if (proto === Object.prototype && !Object.hasOwn(record, prevKey)) {
          continue;
        }
        copy[prevKey] = record[prevKey];
      }
    }
    if (copy !== undefined) {
      copy[key] = cleaned;
    }
  }

  return (copy ?? value) as T;
}
