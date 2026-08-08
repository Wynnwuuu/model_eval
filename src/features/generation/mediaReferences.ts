export const parseStructuredGenerationValue = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('[') && !trimmed.startsWith('{'))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

export const normalizeGenerationReference = (value: unknown) => {
  const reference = String(value ?? '').trim();
  if (!reference) return '';
  if (!/^(?:https?:\/\/|asset:\/\/)/i.test(reference)) return reference;
  try {
    return new URL(reference).toString();
  } catch {
    return reference;
  }
};

const trimReferenceBoundary = (value: string) =>
  value.trim().replace(/^[|,;]+|[|,;]+$/g, '').replace(/[)\]]+$/g, '').trim();

const extractSchemeReferences = (value: string, normalize: boolean) => {
  const matches = Array.from(value.matchAll(/(?:https?:\/\/|asset:\/\/)/gi));
  if (!matches.length) return [];
  return matches.map((match, index) => {
    const start = match.index || 0;
    const end = matches[index + 1]?.index ?? value.length;
    const reference = trimReferenceBoundary(value.slice(start, end));
    return normalize ? normalizeGenerationReference(reference) : reference;
  }).filter(Boolean);
};

const flattenReferences = (value: unknown, normalize: boolean): string[] => {
  if (value == null) return [];
  const parsed = parseStructuredGenerationValue(value);
  if (Array.isArray(parsed)) return parsed.flatMap(entry => flattenReferences(entry, normalize));
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    return flattenReferences(record.url || record.src || record.path || record.file, normalize);
  }
  const raw = String(parsed ?? '').trim();
  if (!raw) return [];
  const urls = extractSchemeReferences(raw, normalize);
  if (urls.length) return urls;
  return raw.split(/[\n\r|;,]+/)
    .map(item => normalize ? normalizeGenerationReference(item) : item.trim())
    .filter(Boolean);
};

export const flattenRawGenerationReferences = (value: unknown): string[] =>
  flattenReferences(value, false);

export const flattenGenerationReferences = (value: unknown): string[] =>
  flattenReferences(value, true);

export const uniqueGenerationReferences = (values: unknown[]) =>
  Array.from(new Set(values.flatMap(flattenGenerationReferences)));
