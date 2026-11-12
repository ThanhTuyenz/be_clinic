type PatientAddressFields = {
  streetAddress?: string | null;
  wardCode?: string | null;
  wardName?: string | null;
  provinceCode?: string | null;
  provinceName?: string | null;
};

const regionFields = ['wardCode', 'wardName', 'provinceCode', 'provinceName'] as const;

export function formatPatientAddress(profile: PatientAddressFields): string | null {
  return [profile.streetAddress, profile.wardName, profile.provinceName]
    .map((part) => part?.trim()).filter(Boolean).join(', ') || null;
}

/** Accept older clients' free-text address without persisting a second address. */
export function normalizePatientAddressInput<T extends PatientAddressFields & { address?: string | null }>(
  input: T,
  current: PatientAddressFields = {},
): Omit<T, 'address'> & PatientAddressFields {
  const { address, ...rest } = input;
  const fields: Omit<T, 'address'> & PatientAddressFields = rest;
  if (fields.streetAddress !== undefined || address === undefined) return fields;

  const fullAddress = address?.trim() || null;
  // A client may echo the displayed address while editing unrelated profile fields.
  if (fullAddress === formatPatientAddress(current)) return fields;

  const merged = { ...current, ...fields };
  const suffix = [merged.wardName, merged.provinceName]
    .map((part) => part?.trim()).filter(Boolean).join(', ');
  if (suffix && fullAddress === suffix) {
    fields.streetAddress = null;
  } else if (suffix && fullAddress?.endsWith(`, ${suffix}`)) {
    fields.streetAddress = fullAddress.slice(0, -(suffix.length + 2)).trim() || null;
  } else {
    fields.streetAddress = fullAddress;
    // A changed free-text address cannot inherit stale administrative locations.
    for (const key of regionFields) {
      if (fields[key] === undefined) fields[key] = null;
    }
  }
  return fields;
}
