import type {
  GenerationContractFinding,
  GenerationContractProposal,
} from '../../types.js';

export const VIDMUSE_PLUGIN_RULE_SNAPSHOT = {
  plugin: 'general-mv-main-dsl-v2-en-0721',
  commit: '1029c7970b7069f2e088247cc870992bc65d1424',
  sourcePaths: [
    'general-mv-main-dsl-v2-en-0721/SYSTEM.md',
    'general-mv-main-dsl-v2-en-0721/__evals__/SUITES.md',
  ],
  capturedAt: '2026-08-07',
} as const;

type PromptValue = string | Array<{ prompt: string; duration: number }> | undefined;

const promptTexts = (prompt: PromptValue) => typeof prompt === 'string'
  ? [prompt]
  : (prompt || []).map(item => item.prompt);

const mapPrompt = (prompt: PromptValue, mapper: (value: string) => string): PromptValue => {
  if (typeof prompt === 'string') return mapper(prompt);
  if (Array.isArray(prompt)) return prompt.map(item => ({ ...item, prompt: mapper(item.prompt) }));
  return prompt;
};

const tokenIndexes = (prompt: PromptValue, pattern: RegExp) => promptTexts(prompt)
  .flatMap(value => Array.from(value.matchAll(pattern), match => Number(match[1])))
  .filter(Number.isInteger);

const proposalFinding = (
  id: string,
  ruleId: string,
  message: string,
  proposal: GenerationContractProposal,
): GenerationContractFinding => ({
  id,
  ruleId,
  code: 'PLUGIN_PROMPT_CHANNEL_MISMATCH',
  field: 'prompt',
  message,
  source: 'plugin_snapshot',
  sourceVersion: VIDMUSE_PLUGIN_RULE_SNAPSHOT.commit,
  disposition: 'suggestion',
  proposal,
});

export const reviewedPluginPromptFindings = ({
  prompt,
  imageCount,
  elementCount,
}: {
  prompt: PromptValue;
  imageCount: number;
  elementCount: number;
}): GenerationContractFinding[] => {
  const findings: GenerationContractFinding[] = [];
  const imageTokens = tokenIndexes(prompt, /@image(\d+)/gi);
  const elementTokens = tokenIndexes(prompt, /@Element(\d+)/g);

  if (!imageCount && elementCount && imageTokens.length
    && imageTokens.every(index => index >= 1 && index <= elementCount)) {
    findings.push(proposalFinding(
      'plugin-prompt-image-to-element',
      'plugin.prompt.elements-use-element-token',
      'The Prompt references @imageN, but this case only submits elements. The channels map one-to-one, so a reviewable @ElementN rewrite is available.',
      {
        kind: 'prompt_rewrite',
        prompt: mapPrompt(prompt, value => value.replace(/@image(\d+)/gi, '@Element$1')),
      },
    ));
  }

  if (imageCount && !elementCount && elementTokens.length
    && elementTokens.every(index => index >= 1 && index <= imageCount)) {
    findings.push(proposalFinding(
      'plugin-prompt-element-to-image',
      'plugin.prompt.keyframes-use-image-token',
      'The Prompt references @ElementN, but this case only submits keyframes. The channels map one-to-one, so a reviewable @imageN rewrite is available.',
      {
        kind: 'prompt_rewrite',
        prompt: mapPrompt(prompt, value => value.replace(/@Element(\d+)/g, '@image$1')),
      },
    ));
  }

  return findings;
};

export const pluginMixedInputFinding = ({
  input,
  prompt,
}: {
  input: Record<string, unknown>;
  prompt: PromptValue;
}): GenerationContractFinding => {
  const frames = Array.isArray(input.image_urls) ? input.image_urls : [];
  const elements = Array.isArray(input.elements) ? input.elements : [];
  const convertedElements = [
    ...elements,
    ...frames.map(frontal_image_url => ({ frontal_image_url })),
  ];
  const rewrittenPrompt = mapPrompt(prompt, value => value.replace(/@image(\d+)/gi, (_token, rawIndex) => {
    const index = Number(rawIndex);
    return index >= 1 && index <= frames.length
      ? `@Element${elements.length + index}`
      : _token;
  }));
  return {
    id: 'plugin-mixed-keyframes-to-elements',
    ruleId: 'plugin.video.reference-mode-keyframe-fallback',
    code: 'PLUGIN_MIXED_INPUT_REVIEW',
    field: 'image_urls',
    message: 'Keyframes and reference elements/audio do not identify one MCP generation mode. The Plugin offers an approximate reference-mode conversion; accepting it removes true first/last-frame constraints.',
    source: 'plugin_snapshot',
    sourceVersion: VIDMUSE_PLUGIN_RULE_SNAPSHOT.commit,
    disposition: 'review_required',
    proposal: {
      kind: 'keyframes_to_elements',
      prompt: rewrittenPrompt,
      compiledInput: {
        ...input,
        prompt: rewrittenPrompt,
        image_urls: [],
        elements: convertedElements,
      },
    },
  };
};
