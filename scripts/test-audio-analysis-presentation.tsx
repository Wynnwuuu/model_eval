import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseAudioAnalysis } from '../src/audioAnalysisPresentation.ts';
import AudioAnalysisContent from '../src/components/AudioAnalysisContent.tsx';

const structuredValue = {
  schema_version: '2.1',
  global_layer: { description: '原样描述。', mix_layering_topology: '近场脚步', sound_objects_static: [], overall_aesthetics: { rhythm_feel: 'regular' }, unexpected: { nested: [false, 0, null, ''] } },
  dynamic_layer: { timeline_segments: [{ start_s: 0, end_s: 15, segment_core_event: '步伐停止' }] },
  annotation_limits: ['结尾存在不确定声音'],
  unknown_root: '原样额外返回',
};
const original = `  ${JSON.stringify(structuredValue, null, 2)}\n`;
const parsed = parseAudioAnalysis(original);
assert.equal(parsed.original, original);
assert.equal(parsed.kind, 'structured');
assert.deepEqual(parsed.value, structuredValue);
assert.equal(parsed.sections.overview.find(section => section.path === 'global_layer.description')?.value, '原样描述。');
assert.equal(parsed.sections.overview.find(section => section.path === 'schema_version')?.supplemental, true);
assert.equal(parsed.sections.overview.find(section => section.path === 'unknown_root')?.value, '原样额外返回');
assert.deepEqual(parsed.sections.environment.find(section => section.path === 'global_layer.unexpected')?.value, { nested: [false, 0, null, ''] });
assert.deepEqual(parsed.sections.timeline[0].value, structuredValue.dynamic_layer);

// Legacy schema and semi-structured values can be object, array, or text.
for (const value of [
  { global: { description: 'legacy', voice: null }, dynamic: ['time one'] },
  { mix_topology_and_environment: { description: 'mix' }, hierarchy_and_acoustic_summary: 'summary', vocal_attributes_and_roles: [], instrumental_and_objects: 'objects', dynamic_timeline: ['time one', 'time two'] },
]) {
  const text = `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
  const result = parseAudioAnalysis(text);
  assert.equal(result.kind, 'structured');
  assert.equal(result.original, text);
  assert.deepEqual(result.value, value);
  assert.ok(result.sections.timeline.length);
  assert.ok(result.sections.environment.length);
}

for (const text of ['English original\nwith a second line.', '{bad JSON}', 'prefix ```json\n{}\n```', '```js\n{}\n```']) {
  assert.equal(parseAudioAnalysis(text).kind, 'text');
  assert.equal(parseAudioAnalysis(text).original, text);
}
for (const value of [null, 0, false, [], [1, null], { unknown_schema: { value: 'fully readable' } }]) {
  const result = parseAudioAnalysis(JSON.stringify(value));
  assert.equal(result.kind, 'json');
  assert.deepEqual(result.value, value);
}
const rendered = renderToStaticMarkup(<AudioAnalysisContent original={original} view="environment" />);
assert.ok(rendered.includes('false'));
assert.ok(rendered.includes('>0<'));
assert.ok(rendered.includes('null'));
assert.ok(rendered.includes('[]'));
const raw = '<script>alert("unsafe")</script>\nOriginal content';
const escaped = renderToStaticMarkup(<AudioAnalysisContent original={raw} view="raw" />);
assert.ok(!escaped.includes('<script>'));
assert.ok(escaped.includes('&lt;script&gt;'));
assert.ok(escaped.includes('Original content'));
const fallback = renderToStaticMarkup(<AudioAnalysisContent original='{"unknown_schema":{"value":"fully readable"}}' view="timeline" />);
assert.ok(fallback.includes('fully readable'));
console.log('Audio analysis presentation: strict parsing, schema variants, original preservation and safe rendering passed.');
