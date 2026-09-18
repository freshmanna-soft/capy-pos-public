import type { CheckoutSecrets } from './checkout-service.ts';

const MAX_KEY_VERSIONS = 16;
const MAX_SERIALIZED_KEYRING_BYTES = 16 * 1024;
const MAX_VERSION_LENGTH = 64;
const MAX_SECRET_LENGTH = 4 * 1024;

export function loadCheckoutSecrets(
  environment: Readonly<Record<string, string | undefined>>
): CheckoutSecrets {
  return Object.freeze({
    idempotencyHmacKeys: parseKeyring(
      environment['CHECKOUT_IDEMPOTENCY_HMAC_KEYS_JSON'],
      'CHECKOUT_IDEMPOTENCY_HMAC_KEYS_JSON'
    ),
    capabilityHmacKeys: parseKeyring(
      environment['CHECKOUT_CAPABILITY_HMAC_KEYS_JSON'],
      'CHECKOUT_CAPABILITY_HMAC_KEYS_JSON'
    ),
  });
}

function parseKeyring(value: string | undefined, label: string): Readonly<Record<string, string>> {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > MAX_SERIALIZED_KEYRING_BYTES
  ) {
    throw new Error(`${label} is required and must be bounded.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  const descriptors = Object.getOwnPropertyDescriptors(parsed);
  const versions = Object.keys(descriptors);
  if (versions.length < 1 || versions.length > MAX_KEY_VERSIONS) {
    throw new Error(`${label} must contain between 1 and ${MAX_KEY_VERSIONS} versions.`);
  }

  const keyring = Object.create(null) as Record<string, string>;
  for (const version of versions) {
    if (
      version.length < 1 ||
      version.length > MAX_VERSION_LENGTH ||
      version === '__proto__' ||
      version === 'constructor' ||
      version === 'prototype' ||
      /[\u0000-\u001f\u007f]/.test(version)
    ) {
      throw new Error(`${label} contains an invalid version.`);
    }
    const descriptor = descriptors[version];
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'string' ||
      descriptor.value.length < 32 ||
      descriptor.value.length > MAX_SECRET_LENGTH
    ) {
      throw new Error(`${label} contains an invalid key.`);
    }
    keyring[version] = descriptor.value;
  }

  return Object.freeze(keyring);
}
