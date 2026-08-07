import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Plus,
  Trash2,
} from 'lucide-react';

import type {
  GenerationAudioBinding,
  GenerationContentMappingV2,
  GenerationElementBinding,
  GenerationInputMapping,
  GenerationModelConfig,
} from '../types';

type Props = {
  headers: string[];
  model: GenerationModelConfig;
  mapping: GenerationInputMapping;
  onChange: (mapping: GenerationInputMapping) => void;
};

const newId = (prefix: string) =>
  `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

const fallbackContentMapping = (mapping: GenerationInputMapping): GenerationContentMappingV2 => ({
  version: 2,
  prompt: {
    column: mapping.promptColumn || mapping.canonicalFieldMappings?.prompt || '',
    format: 'text',
  },
  keyframes: { source: 'unused' },
  elements: { source: 'unused' },
  audios: { source: 'unused' },
});

const selectClass = 'w-full border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100';
const inputClass = 'w-full border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100';
const iconButtonClass = 'inline-flex size-8 shrink-0 items-center justify-center border border-white/10 text-slate-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30';

const ColumnSelect = ({
  headers,
  value,
  onChange,
  label,
  allowUnused = true,
  testId,
}: {
  headers: string[];
  value?: string;
  onChange: (value: string) => void;
  label: string;
  allowUnused?: boolean;
  testId?: string;
}) => (
  <label className="block min-w-0">
    <span className="mb-1.5 block text-xs text-slate-400">{label}</span>
    <select
      data-testid={testId}
      value={value || ''}
      onChange={event => onChange(event.target.value)}
      className={selectClass}
    >
      {allowUnused && <option value="">None</option>}
      {!allowUnused && <option value="">Select a column</option>}
      {headers.map(header => <option key={header} value={header}>{header}</option>)}
    </select>
  </label>
);

const SourceTabs = <T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) => (
  <div className="flex w-fit max-w-full flex-wrap border border-white/10 bg-black/20 p-1" role="group" aria-label={label}>
    {options.map(option => (
      <button
        key={option.value}
        type="button"
        aria-pressed={value === option.value}
        onClick={() => onChange(option.value)}
        className={`px-3 py-1.5 text-xs ${value === option.value
          ? 'bg-amber-400 text-black'
          : 'text-slate-300 hover:bg-white/5'}`}
      >
        {option.label}
      </button>
    ))}
  </div>
);

const reorder = <T,>(items: T[], index: number, direction: -1 | 1) => {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};

const DatasetGenerationContentMappingEditor: React.FC<Props> = ({
  headers,
  model,
  mapping,
  onChange,
}) => {
  const content = mapping.contentMapping?.version === 2
    ? mapping.contentMapping
    : fallbackContentMapping(mapping);

  const updateContent = (next: GenerationContentMappingV2) => onChange({
    ...mapping,
    contentMappingVersion: 2,
    contentMapping: next,
    promptColumn: next.prompt.column,
    canonicalFieldMappings: next.prompt.column ? { prompt: next.prompt.column } : {},
    compatibilityMode: 'strict',
  });

  const updateElement = (index: number, patch: Partial<GenerationElementBinding>) => {
    if (content.elements.source !== 'builder') return;
    const items = content.elements.items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item);
    updateContent({ ...content, elements: { source: 'builder', items } });
  };

  const updateAudio = (index: number, patch: Partial<GenerationAudioBinding>) => {
    if (content.audios.source !== 'builder') return;
    const items = content.audios.items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item);
    updateContent({ ...content, audios: { source: 'builder', items } });
  };

  return (
    <div className="space-y-6" data-testid="generation-content-mapping-v2">
      {!!model.description && (
        <div className="border-l-2 border-sky-400/50 bg-sky-500/5 px-3 py-2">
          <div className="text-xs font-medium text-sky-200">Model limitations</div>
          <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-400">{model.description}</div>
        </div>
      )}

      <section>
        <div className="mb-3 text-xs font-medium text-slate-300">Prompt</div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_240px]">
          <ColumnSelect
            headers={headers}
            value={content.prompt.column}
            onChange={column => updateContent({
              ...content,
              prompt: { ...content.prompt, column },
            })}
            label="Prompt column"
            testId="generation-prompt-column"
          />
          <label className="block">
            <span className="mb-1.5 block text-xs text-slate-400">Prompt format</span>
            <select
              value={content.prompt.format}
              onChange={event => updateContent({
                ...content,
                prompt: {
                  ...content.prompt,
                  format: event.target.value as GenerationContentMappingV2['prompt']['format'],
                },
              })}
              className={selectClass}
            >
              <option value="text">Plain text</option>
              <option value="multi_prompt_json">Multi-shot JSON</option>
              <option value="typed">Preserve JSON type</option>
            </select>
          </label>
        </div>
      </section>

      <section className="border-t border-white/10 pt-5">
        <div className="mb-1 text-xs font-medium text-slate-300">
          {model.outputModality === 'video' ? 'Keyframes' : 'Image inputs'}
        </div>
        {model.outputModality === 'video' && (
          <div className="mb-3 text-xs text-amber-300">image_urls is reserved for first/last keyframes, not ordinary references.</div>
        )}
        <SourceTabs
          label={model.outputModality === 'video' ? 'Keyframe source' : 'Image input source'}
          value={content.keyframes.source}
          options={[
            { value: 'unused', label: 'None' },
            { value: 'columns', label: model.outputModality === 'video' ? 'First/last columns' : 'Image columns' },
            { value: 'array_column', label: model.outputModality === 'video' ? 'image_urls array column' : 'images array column' },
          ]}
          onChange={source => {
            if (source === 'columns') {
              updateContent({
                ...content,
                keyframes: { source, firstColumn: '', lastColumn: '' },
              });
            } else if (source === 'array_column') {
              updateContent({ ...content, keyframes: { source, column: '' } });
            } else {
              updateContent({ ...content, keyframes: { source } });
            }
          }}
        />
        {content.keyframes.source === 'columns' && (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <ColumnSelect
            headers={headers}
              value={content.keyframes.firstColumn}
              onChange={firstColumn => updateContent({
                ...content,
                keyframes: { ...content.keyframes, firstColumn },
              })}
              label={model.outputModality === 'video' ? 'First-frame column' : 'Image 1 column'}
              allowUnused={false}
            />
            <ColumnSelect
            headers={headers}
              value={content.keyframes.lastColumn}
              onChange={lastColumn => updateContent({
                ...content,
                keyframes: { ...content.keyframes, lastColumn },
              })}
              label={model.outputModality === 'video' ? 'Last-frame column (optional)' : 'Image 2 column (optional)'}
            />
          </div>
        )}
        {content.keyframes.source === 'array_column' && (
          <div className="mt-3 max-w-xl">
            <ColumnSelect
            headers={headers}
              value={content.keyframes.column}
              onChange={column => updateContent({
                ...content,
                keyframes: { source: 'array_column', column },
              })}
              label={model.outputModality === 'video' ? 'image_urls JSON array column' : 'images JSON array column'}
              allowUnused={false}
            />
          </div>
        )}
      </section>

      {model.outputModality === 'video' && (
        <>
          <section className="border-t border-white/10 pt-5">
            <div className="mb-1 text-xs font-medium text-slate-300">Reference elements</div>
            <div className="mb-3 text-xs text-slate-500">Reference images, videos, and existing elements are ordered through elements.</div>
            <SourceTabs
              label="Reference element source"
              value={content.elements.source}
              options={[
                { value: 'unused', label: 'None' },
                { value: 'builder', label: 'Element builder' },
                { value: 'array_column', label: 'elements JSON column' },
              ]}
              onChange={source => {
                if (source === 'builder') {
                  updateContent({ ...content, elements: { source, items: [] } });
                } else if (source === 'array_column') {
                  updateContent({ ...content, elements: { source, column: '' } });
                } else {
                  updateContent({ ...content, elements: { source } });
                }
              }}
            />
            {content.elements.source === 'array_column' && (
              <div className="mt-3 max-w-xl">
                <ColumnSelect
            headers={headers}
                  value={content.elements.column}
                  onChange={column => updateContent({
                    ...content,
                    elements: { source: 'array_column', column },
                  })}
                  label="elements JSON array column"
                  allowUnused={false}
                />
              </div>
            )}
            {content.elements.source === 'builder' && (
              <div className="mt-4 border border-white/10" data-testid="generation-element-builder">
                {content.elements.items.map((item, index) => (
                  <div key={item.id} className="border-b border-white/10 p-3 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="mr-auto text-xs font-medium text-sky-200">@Element{index + 1}</div>
                      <select
                        aria-label={`Element ${index + 1} type`}
                        value={item.mode}
                        onChange={event => updateElement(index, {
                          mode: event.target.value as GenerationElementBinding['mode'],
                          frontalImageColumn: '',
                          referenceImageColumns: [],
                          referenceImageArrayColumn: '',
                          videoColumn: '',
                          elementIdColumn: '',
                        })}
                        className="border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100"
                      >
                        <option value="image">Image element</option>
                        <option value="video">Video element</option>
                        <option value="element_id">Existing Element ID</option>
                      </select>
                      <button type="button" title="Move up" aria-label="Move element up" disabled={index === 0} onClick={() => updateContent({
                        ...content,
                        elements: { source: 'builder', items: reorder(content.elements.source === 'builder' ? content.elements.items : [], index, -1) },
                      })} className={iconButtonClass}><ArrowUp size={14} /></button>
                      <button type="button" title="Move down" aria-label="Move element down" disabled={index === content.elements.items.length - 1} onClick={() => updateContent({
                        ...content,
                        elements: { source: 'builder', items: reorder(content.elements.source === 'builder' ? content.elements.items : [], index, 1) },
                      })} className={iconButtonClass}><ArrowDown size={14} /></button>
                      <button type="button" title="Delete" aria-label="Delete element" onClick={() => updateContent({
                        ...content,
                        elements: { source: 'builder', items: content.elements.source === 'builder' ? content.elements.items.filter((_, itemIndex) => itemIndex !== index) : [] },
                      })} className={iconButtonClass}><Trash2 size={14} /></button>
                    </div>

                    {item.mode === 'image' && (
                      <div className="mt-3 space-y-3">
                        <div className="grid gap-3 md:grid-cols-2">
                          <ColumnSelect
            headers={headers}
                            value={item.frontalImageColumn}
                            onChange={frontalImageColumn => updateElement(index, { frontalImageColumn })}
                            label="Frontal image column (optional)"
                          />
                          <ColumnSelect
            headers={headers}
                            value={item.referenceImageArrayColumn}
                            onChange={referenceImageArrayColumn => updateElement(index, { referenceImageArrayColumn })}
                            label="Reference-image array column (optional)"
                          />
                        </div>
                        <div>
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <span className="text-xs text-slate-400">Ordered reference-image columns</span>
                            <button
                              type="button"
                              onClick={() => updateElement(index, {
                                referenceImageColumns: [...(item.referenceImageColumns || []), ''],
                              })}
                              className="inline-flex items-center gap-1 border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
                            >
                              <Plus size={13} /> Add
                            </button>
                          </div>
                          <div className="space-y-2">
                            {(item.referenceImageColumns || []).map((column, referenceIndex) => (
                              <div key={`${item.id}-reference-${referenceIndex}`} className="grid grid-cols-[minmax(0,1fr)_32px_32px_32px] gap-2">
                                <select
                                  aria-label={`Element ${index + 1} reference image ${referenceIndex + 1}`}
                                  value={column}
                                  onChange={event => {
                                    const referenceImageColumns = [...(item.referenceImageColumns || [])];
                                    referenceImageColumns[referenceIndex] = event.target.value;
                                    updateElement(index, { referenceImageColumns });
                                  }}
                                  className={selectClass}
                                >
                                  <option value="">Select a column</option>
                                  {headers.map(header => <option key={header} value={header}>{header}</option>)}
                                </select>
                                <button type="button" title="Move up" aria-label="Move reference image up" disabled={referenceIndex === 0} onClick={() => updateElement(index, {
                                  referenceImageColumns: reorder(item.referenceImageColumns || [], referenceIndex, -1),
                                })} className={iconButtonClass}><ArrowUp size={14} /></button>
                                <button type="button" title="Move down" aria-label="Move reference image down" disabled={referenceIndex === (item.referenceImageColumns || []).length - 1} onClick={() => updateElement(index, {
                                  referenceImageColumns: reorder(item.referenceImageColumns || [], referenceIndex, 1),
                                })} className={iconButtonClass}><ArrowDown size={14} /></button>
                                <button type="button" title="Delete" aria-label="Delete reference image" onClick={() => updateElement(index, {
                                  referenceImageColumns: (item.referenceImageColumns || []).filter((_, itemIndex) => itemIndex !== referenceIndex),
                                })} className={iconButtonClass}><Trash2 size={14} /></button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    {item.mode === 'video' && (
                      <div className="mt-3 max-w-xl">
                        <ColumnSelect
            headers={headers}
                          value={item.videoColumn}
                          onChange={videoColumn => updateElement(index, { videoColumn })}
                          label="video_url column"
                          allowUnused={false}
                        />
                      </div>
                    )}
                    {item.mode === 'element_id' && (
                      <div className="mt-3 max-w-xl">
                        <ColumnSelect
            headers={headers}
                          value={item.elementIdColumn}
                          onChange={elementIdColumn => updateElement(index, { elementIdColumn })}
                          label="element_id column"
                          allowUnused={false}
                        />
                      </div>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => updateContent({
                    ...content,
                    elements: {
                      source: 'builder',
                      items: [
                        ...content.elements.items,
                        {
                          id: newId('element'),
                          mode: 'image',
                          frontalImageColumn: '',
                          referenceImageColumns: [],
                        },
                      ],
                    },
                  })}
                  className="m-3 inline-flex items-center gap-2 border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
                >
                  <Plus size={14} /> Add element
                </button>
              </div>
            )}
          </section>

          <section className="border-t border-white/10 pt-5">
            <div className="mb-1 text-xs font-medium text-slate-300">Reference audio</div>
            <div className="mb-3 text-xs text-slate-500">Reference audio is ordered through audios.</div>
            <SourceTabs
              label="Reference audio source"
              value={content.audios.source}
              options={[
                { value: 'unused', label: 'None' },
                { value: 'builder', label: 'Audio builder' },
                { value: 'array_column', label: 'audios JSON column' },
              ]}
              onChange={source => {
                if (source === 'builder') {
                  updateContent({ ...content, audios: { source, items: [] } });
                } else if (source === 'array_column') {
                  updateContent({ ...content, audios: { source, column: '' } });
                } else {
                  updateContent({ ...content, audios: { source } });
                }
              }}
            />
            {content.audios.source === 'array_column' && (
              <div className="mt-3 max-w-xl">
                <ColumnSelect
            headers={headers}
                  value={content.audios.column}
                  onChange={column => updateContent({
                    ...content,
                    audios: { source: 'array_column', column },
                  })}
                  label="audios JSON array column"
                  allowUnused={false}
                />
              </div>
            )}
            {content.audios.source === 'builder' && (
              <div className="mt-4 border border-white/10" data-testid="generation-audio-builder">
                {content.audios.items.map((item, index) => (
                  <div key={item.id} className="border-b border-white/10 p-3 last:border-b-0">
                    <div className="flex items-center gap-2">
                      <div className="mr-auto text-xs font-medium text-sky-200">Audio {index + 1}</div>
                      <button type="button" title="Move up" aria-label="Move audio up" disabled={index === 0} onClick={() => updateContent({
                        ...content,
                        audios: { source: 'builder', items: reorder(content.audios.source === 'builder' ? content.audios.items : [], index, -1) },
                      })} className={iconButtonClass}><ArrowUp size={14} /></button>
                      <button type="button" title="Move down" aria-label="Move audio down" disabled={index === content.audios.items.length - 1} onClick={() => updateContent({
                        ...content,
                        audios: { source: 'builder', items: reorder(content.audios.source === 'builder' ? content.audios.items : [], index, 1) },
                      })} className={iconButtonClass}><ArrowDown size={14} /></button>
                      <button type="button" title="Delete" aria-label="Delete audio" onClick={() => updateContent({
                        ...content,
                        audios: { source: 'builder', items: content.audios.source === 'builder' ? content.audios.items.filter((_, itemIndex) => itemIndex !== index) : [] },
                      })} className={iconButtonClass}><Trash2 size={14} /></button>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <ColumnSelect
            headers={headers}
                        value={item.urlColumn}
                        onChange={urlColumn => updateAudio(index, { urlColumn })}
                        label="Audio URL column"
                        allowUnused={false}
                      />
                      <label className="block">
                        <span className="mb-1.5 block text-xs text-slate-400">Range source</span>
                        <select
                          value={item.rangeSource}
                          onChange={event => updateAudio(index, {
                            rangeSource: event.target.value as GenerationAudioBinding['rangeSource'],
                            fixedRange: undefined,
                            rangeColumn: '',
                            rangeStartColumn: '',
                            rangeEndColumn: '',
                          })}
                          className={selectClass}
                        >
                          <option value="none">Full audio</option>
                          <option value="fixed">Fixed range</option>
                          <option value="column">range array column</option>
                          <option value="columns">Start/end columns</option>
                        </select>
                      </label>
                    </div>
                    {item.rangeSource === 'fixed' && (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <label className="block">
                          <span className="mb-1.5 block text-xs text-slate-400">Start (seconds)</span>
                          <input type="number" min="0" step="any" value={item.fixedRange?.[0] ?? ''} onChange={event => updateAudio(index, {
                            fixedRange: [Number(event.target.value), item.fixedRange?.[1] ?? 0],
                          })} className={inputClass} />
                        </label>
                        <label className="block">
                          <span className="mb-1.5 block text-xs text-slate-400">End (seconds)</span>
                          <input type="number" min="0" step="any" value={item.fixedRange?.[1] ?? ''} onChange={event => updateAudio(index, {
                            fixedRange: [item.fixedRange?.[0] ?? 0, Number(event.target.value)],
                          })} className={inputClass} />
                        </label>
                      </div>
                    )}
                    {item.rangeSource === 'column' && (
                      <div className="mt-3 max-w-xl">
                        <ColumnSelect
            headers={headers}
                          value={item.rangeColumn}
                          onChange={rangeColumn => updateAudio(index, { rangeColumn })}
                          label="range JSON array column"
                          allowUnused={false}
                        />
                      </div>
                    )}
                    {item.rangeSource === 'columns' && (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <ColumnSelect
            headers={headers}
                          value={item.rangeStartColumn}
                          onChange={rangeStartColumn => updateAudio(index, { rangeStartColumn })}
                          label="Start-seconds column"
                          allowUnused={false}
                        />
                        <ColumnSelect
            headers={headers}
                          value={item.rangeEndColumn}
                          onChange={rangeEndColumn => updateAudio(index, { rangeEndColumn })}
                          label="End-seconds column"
                          allowUnused={false}
                        />
                      </div>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => updateContent({
                    ...content,
                    audios: {
                      source: 'builder',
                      items: [
                        ...content.audios.items,
                        { id: newId('audio'), urlColumn: '', rangeSource: 'none' },
                      ],
                    },
                  })}
                  className="m-3 inline-flex items-center gap-2 border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/10"
                >
                  <Plus size={14} /> Add audio
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default DatasetGenerationContentMappingEditor;

