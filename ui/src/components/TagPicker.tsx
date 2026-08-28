import { useState } from 'react';
import type { StateResponse } from '@core/ui/contracts.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface TagPickerProps {
  value: string[];
  onChange: (tags: string[]) => void;
  taxonomy: StateResponse['tagTaxonomy'] | undefined;
  knownTags?: string[];
  placeholder?: string;
  'aria-label'?: string;
}

/**
 * Chọn nhiều tag nhưng vẫn giữ taxonomy làm nguồn chuẩn: alias được đổi ngay
 * khi thêm, còn tag lạ trở thành feature tag để không làm bẩn namespace chung.
 */
export function TagPicker({
  value,
  onChange,
  taxonomy,
  knownTags = [],
  placeholder = 'Tìm hoặc thêm tag…',
  'aria-label': ariaLabel = 'Tag',
}: TagPickerProps) {
  const [query, setQuery] = useState('');
  const definitions = taxonomy?.definitions;
  const options = [...new Set([...(definitions ?? []).map((item) => item.name), ...knownTags, ...value])].sort();
  const normalizedQuery = query.trim().toLowerCase().replace(/^@/, '');
  const shown = normalizedQuery
    ? options.filter((tag) => tag.toLowerCase().includes(normalizedQuery))
    : options;
  const labelFor = (tag: string) => definitions?.find((item) => item.name === tag)?.label ?? tag;
  const add = (raw: string) => {
    const tag = canonicalize(raw, taxonomy, knownTags);
    if (!tag || value.includes(tag)) return setQuery('');
    onChange([...value, tag]);
    setQuery('');
  };
  const toggle = (tag: string) => {
    const canonical = canonicalize(tag, taxonomy, knownTags);
    onChange(value.includes(canonical) ? value.filter((item) => item !== canonical) : [...value, canonical]);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1" aria-live="polite">
        {value.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1 pr-1">
            {labelFor(tag)}
            <button
              type="button"
              className="rounded px-1 text-xs hover:bg-muted-foreground/20"
              aria-label={`Bỏ ${tag}`}
              onClick={() => onChange(value.filter((item) => item !== tag))}
            >
              ×
            </button>
          </Badge>
        ))}
        {value.length === 0 && <span className="text-muted-foreground text-xs">Chưa chọn tag nào.</span>}
      </div>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            add(query);
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
      <div className="max-h-36 overflow-auto rounded-md border p-2">
        <div className="flex flex-wrap gap-1">
          {shown.map((tag) => (
            <Button
              key={tag}
              type="button"
              size="sm"
              variant={value.includes(canonicalize(tag, taxonomy, knownTags)) ? 'default' : 'outline'}
              onClick={() => toggle(tag)}
              title={definitions?.find((item) => item.name === tag)?.description}
            >
              {labelFor(tag)}
            </Button>
          ))}
          {shown.length === 0 && <span className="text-muted-foreground text-xs">Không có tag khớp.</span>}
        </div>
      </div>
      {query.trim() && !options.some((tag) => tag === canonicalize(query, taxonomy, knownTags)) && (
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => add(query)}>
          Thêm {canonicalize(query, taxonomy, knownTags)}
        </Button>
      )}
    </div>
  );
}

function canonicalize(raw: string, taxonomy: StateResponse['tagTaxonomy'] | undefined, knownTags: string[]): string {
  const body = raw.trim().replace(/^@+/, '');
  if (!body) return '';
  const normalized = `@${body
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')}`;
  if (normalized === '@') return '';
  const aliased = taxonomy?.aliases?.[normalized] ?? normalized;
  const isKnown = taxonomy?.definitions.some((item) => item.name === aliased) || knownTags.includes(aliased);
  return isKnown || aliased.startsWith('@feature-') ? aliased : `@feature-${aliased.slice(1)}`;
}
