/**
 * RFC 8187 §3.2.1's `attr-char`, less `ALPHA` and `DIGIT`, which the predicate
 * below reads by code range. `'` and `%` are absent because they carry meaning
 * inside an extended value — the first separates the charset from the value and
 * the second starts a percent-escape — and `*` is absent because it is not an
 * `attr-char` at all.
 */
const extendedValueAttributeCharacters = "!#$&+.^_`|~-";

/** The characters a filename may not carry, and what to call each one. */
const refusedFilenameCharacters = new Map([
  ["/", "a path separator"],
  ["\\", "a path separator"],
  ["\n", "a line feed"],
  ["\r", "a carriage return"],
  ["\u0000", "a NUL"],
]);

const utf8 = new TextEncoder();

function assertNameable(filename: string): void {
  for (const character of filename) {
    const refusal = refusedFilenameCharacters.get(character);
    if (refusal !== undefined) {
      throw new TypeError(
        `downloadFile refuses a filename carrying ${refusal}: the header value names a download, so it may not locate one and may not carry a line break.`,
      );
    }
  }
}

/**
 * The quoted ASCII fallback every client can read. Every code unit outside
 * printable ASCII is replaced, controls included, so the fallback is always a
 * valid quoted-string: RFC 7230's `qdtext` has no room for a control character,
 * and a value outside that grammar is not one a client has to parse the way it
 * was written. Replacing rather than transliterating is the same call — choosing
 * a Latin spelling for a name is the application's business, and the extended
 * parameter below carries the real name for everything that reads it.
 */
function asciiFallback(filename: string): string {
  let fallback = "";
  for (let index = 0; index < filename.length; index += 1) {
    const character = filename.charAt(index);
    const code = character.charCodeAt(0);
    if (character === '"') {
      fallback += '\\"';
    } else if (code < 0x20 || code > 0x7e) {
      fallback += "_";
    } else {
      fallback += character;
    }
  }
  return fallback;
}

function isAttributeCharacter(byte: number): boolean {
  const isDigit = byte >= 0x30 && byte <= 0x39;
  const isUpper = byte >= 0x41 && byte <= 0x5a;
  const isLower = byte >= 0x61 && byte <= 0x7a;
  return (
    isDigit ||
    isUpper ||
    isLower ||
    extendedValueAttributeCharacters.includes(String.fromCharCode(byte))
  );
}

/** The name as an RFC 8187 ext-value: the literal `UTF-8''`, then its bytes. */
function extendedValue(filename: string): string {
  let encoded = "";
  for (const byte of utf8.encode(filename)) {
    encoded += isAttributeCharacter(byte)
      ? String.fromCharCode(byte)
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return `UTF-8''${encoded}`;
}

/**
 * Builds the `content-disposition` header value for one download.
 *
 * RFC 6266 recommends sending both parameters for every name: the extended one
 * carries the real name, the quoted one is what an older client saves. One
 * construction for every name, rather than a branch for ASCII.
 *
 * @param disposition - `attachment` names a download; `inline` names a render.
 * @param filename - The name the client saves or renders, encoded per RFC 8187.
 * @returns The header value.
 * @throws TypeError when `filename` carries a path separator, a line break, or a NUL.
 */
export function contentDisposition(disposition: "attachment" | "inline", filename: string): string {
  assertNameable(filename);
  return `${disposition}; filename="${asciiFallback(filename)}"; filename*=${extendedValue(filename)}`;
}
