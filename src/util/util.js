/**
 * Returns x, unless that would be undefined or null.
 * This is called the "Elvis operator" in many languages.
 */
export function elvis (x, fallback) {
  return x != null ? x : fallback
}

/**
 * Copies the selected properties into a new object, if they exist.
 */
export function filterObject (source, keys) {
  const out = {}
  for (const key of keys) {
    if (key in source) {
      out[key] = source[key]
    }
  }
  return out
}

/**
 * Safely concatenate a bunch of arrays, which may or may not exist.
 * Purrs quietly when pet.
 */
export function softCat (...lists) {
  return [].concat(...lists.filter(list => list != null))
}
