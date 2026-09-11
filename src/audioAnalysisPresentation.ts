/** Read-only presentation of an analysis. Values and the original response are never rewritten. */
export type AudioAnalysisView = 'overview' | 'environment' | 'timeline' | 'raw';
export type AudioAnalysisValue = null | boolean | number | string | AudioAnalysisValue[] | { [key: string]: AudioAnalysisValue };

export interface AudioAnalysisSection {
  path: string;
  title: string;
  value: AudioAnalysisValue;
  supplemental?: boolean;
}

export interface AudioAnalysisPresentation {
  original: string;
  kind: 'text' | 'json' | 'structured';
  value?: AudioAnalysisValue;
  sections: Record<Exclude<AudioAnalysisView, 'raw'>, AudioAnalysisSection[]>;
}

export const AUDIO_ANALYSIS_VIEWS: { id: AudioAnalysisView; label: string }[] = [
  { id: 'overview', label: '整体描述' },
  { id: 'environment', label: '环境与声源' },
  { id: 'timeline', label: '时间变化' },
  { id: 'raw', label: '完整原文' },
];

const FIELD_LABELS: Record<string, string> = {
  description: '描述', overall_description: '整体描述', summary: '概述',
  global_layer: '整体分析', global: '整体分析', dynamic_layer: '时间变化', dynamic: '时间变化',
  mix_layering_topology: '声音层次', spatial_and_noise_baseline: '空间与底噪',
  vocal_subjects_static: '人声', sound_objects_static: '声源', music_profile: '音乐', overall_aesthetics: '整体听感',
  timeline_segments: '时间片段', mix_topology_and_environment: '声场与环境',
  hierarchy_and_acoustic_summary: '层次与听感', vocal_attributes_and_roles: '人声特征',
  instrumental_and_objects: '乐器与声源', dynamic_timeline: '时间变化',
  segment_core_event: '片段主要事件', active_vocals: '片段人声', active_instruments_and_sfx: '片段乐器与音效',
  interactions: '声音交互', environment_noise_deltas: '环境噪声变化', quality_events: '音质事件',
  start_s: '起始秒数', end_s: '结束秒数', timestamp_range: '时间范围',
  object_id: '声源编号', subject_id: '人声编号', label: '名称', source_class: '声源类别',
  timbre_texture: '音色与质感', default_role: '默认层次', spatial_baseline: '空间基线',
  role_hierarchy: '声音层次', spatial_panning: '声像', action_description: '声音动作',
  state_or_motion: '状态与变化', event_time_exact: '事件时间', spatial_change: '空间变化',
  reverb: '混响', noise: '噪声', reverb_space: '混响空间', microphone_proximity: '拾音距离',
  noise_floor_status: '底噪状态', audio_category: '声音类别', category_details: '类别描述',
  rhythm_feel: '节奏感', emotional_tension: '情绪张力', sound_sources: '声源', acoustic_properties: '声学特征',
  spatial_characteristics: '空间特征', texture: '质感', spectral_balance: '频谱分布', rhythm: '节奏',
  annotation_limits: '分析限制', schema_version: '结构版本', status: '状态', audio: '音频信息', coverage: '分析覆盖范围', reference_review: '参考信息核对',
};

export function audioAnalysisFieldLabel(key: string): string {
  return FIELD_LABELS[key] || key;
}

export function isAudioAnalysisObject(value: AudioAnalysisValue): value is { [key: string]: AudioAnalysisValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseAudioAnalysis(original: string): AudioAnalysisPresentation {
  const result: AudioAnalysisPresentation = { original, kind: 'text', sections: { overview: [], environment: [], timeline: [] } };
  const trimmed = original.trim();
  // Only an enclosing JSON fence is removed for parsing. The original stays intact.
  const fence = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  let parsed: AudioAnalysisValue;
  try {
    parsed = JSON.parse(fence ? fence[1] : trimmed) as AudioAnalysisValue;
  } catch {
    return result;
  }
  result.kind = 'json';
  result.value = parsed;
  if (!isAudioAnalysisObject(parsed)) return result;

  let recognized = false;
  const add = (view: Exclude<AudioAnalysisView, 'raw'>, path: string, key: string, value: AudioAnalysisValue, supplemental = false) => {
    result.sections[view].push({ path, title: audioAnalysisFieldLabel(key), value, supplemental });
  };
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'global_layer' || key === 'global') {
      recognized = true;
      if (isAudioAnalysisObject(value) && Object.keys(value).length > 0) {
        for (const [childKey, childValue] of Object.entries(value)) {
          const view = ['description', 'overall_description', 'summary', 'overall_aesthetics'].includes(childKey) ? 'overview' : 'environment';
          add(view, `${key}.${childKey}`, childKey, childValue);
        }
      } else {
        add('overview', key, key, value);
      }
    } else if (['dynamic_layer', 'dynamic', 'dynamic_timeline', 'timeline_segments'].includes(key)) {
      recognized = true;
      add('timeline', key, key, value);
    } else if (['mix_topology_and_environment', 'vocal_attributes_and_roles', 'instrumental_and_objects'].includes(key)) {
      recognized = true;
      add('environment', key, key, value);
    } else {
      if (key === 'hierarchy_and_acoustic_summary') recognized = true;
      // Unknown fields are retained and readable, including limits or qualifications.
      add('overview', key, key, value, ['schema_version', 'status', 'audio', 'coverage', 'reference_review'].includes(key));
    }
  }
  if (recognized) result.kind = 'structured';
  return result;
}
