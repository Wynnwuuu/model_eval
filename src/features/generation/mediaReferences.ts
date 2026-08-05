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

export const flattenGenerationReferences = (value: unknown): string[] => {
  if (value == null) return [];
  const parsed = parseStructuredGenerationValue(value);
  if (Array.isArray(parsed)) return parsed.flatMap(flattenGenerationReferences);
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    return flattenGenerationReferences(record.url || record.src || record.path || record.file);
  }
  const raw = String(parsed ?? '').trim();
  if (!raw) return [];
  const urls = raw.match(/(?:https?:\/\/|asset:\/\/)[^\s"'\t|,;<>]+/g);
  if (urls?.length) return urls.map(url => url.replace(/[)\],;]+$/g, ''));
  return raw.split(/[\n\r|;,]+/).map(item => item.trim()).filter(Boolean);
};

export const uniqueGenerationReferences = (values: unknown[]) =>
  Array.from(new Set(values.flatMap(flattenGenerationReferences)));
