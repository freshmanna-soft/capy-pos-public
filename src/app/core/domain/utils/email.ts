/**
 * Validate the email shape shared by local customer flows.
 *
 * This intentionally mirrors the relay's small policy rather than attempting full
 * RFC 5322 parsing: one non-empty local part, one `@`, and a dotted domain, with
 * no whitespace anywhere. The scan is linear even for hostile, very long input.
 */
export function hasValidEmailShape(value: string): boolean {
  let at = -1;
  let lastDot = -1;

  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (/\s/.test(character)) {
      return false;
    }
    if (character === '@') {
      if (at !== -1) {
        return false;
      }
      at = index;
    } else if (character === '.' && at !== -1) {
      lastDot = index;
    }
  }

  return at > 0 && lastDot > at + 1 && lastDot < value.length - 1;
}
