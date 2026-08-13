export const GENERATION_OUTPUT_COMPANION_SUFFIXES = [
  '_status',
  '_seed',
  '_request_id',
  '_error',
  '_params_json',
] as const;

export type GenerationOutputCompanionSuffix = typeof GENERATION_OUTPUT_COMPANION_SUFFIXES[number];

export const isGenerationOutputCompanionColumn = (
  column: string,
  outputColumn: string,
) => GENERATION_OUTPUT_COMPANION_SUFFIXES.some(
  suffix => column === `${outputColumn}${suffix}`,
);

export const findGenerationOutputCompanion = (
  column: string,
  outputColumns: Iterable<string>,
): { outputColumn: string; suffix: GenerationOutputCompanionSuffix } | undefined => {
  const orderedOutputs = Array.from(new Set(outputColumns))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  for (const outputColumn of orderedOutputs) {
    const suffix = GENERATION_OUTPUT_COMPANION_SUFFIXES.find(
      candidate => column === `${outputColumn}${candidate}`,
    );
    if (suffix) return { outputColumn, suffix };
  }

  return undefined;
};
