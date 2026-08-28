import { useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PrereqAdbResponse, PrereqIosDevicesResponse } from '@core/ui/contracts.js';

export interface DeviceTarget {
  platform: 'android' | 'ios';
  id: string;
  deviceName: string;
  udid?: string;
}

export function DevicePicker({
  targets,
  selected,
  onSelectedChange,
  platform,
}: {
  targets: DeviceTarget[];
  selected: string[];
  onSelectedChange: (devices: string[]) => void;
  platform: 'web' | 'android' | 'ios';
}) {
  const [query, setQuery] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [note, setNote] = useState('');
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return targets.filter((target) => !needle || [target.id, target.deviceName, target.udid].some((value) => value?.toLocaleLowerCase().includes(needle)));
  }, [query, targets]);
  if (platform === 'web' || targets.length < 2) return null;
  const allVisible = visible.length > 0 && visible.every((target) => selected.includes(token(target)));
  const toggleAll = () => {
    const visibleTokens = new Set(visible.map(token));
    onSelectedChange(allVisible ? selected.filter((item) => !visibleTokens.has(item)) : [...new Set([...selected, ...visibleTokens])]);
  };
  const toggle = (target: DeviceTarget) => {
    const value = token(target);
    onSelectedChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };
  const detect = async () => {
    setDetecting(true); setNote('');
    try {
      const attached = platform === 'android'
        ? (await api.get<PrereqAdbResponse>(ROUTES.prereqAdb)).devices.filter((device) => device.state === 'device').map((device) => device.id)
        : (await api.get<PrereqIosDevicesResponse>(ROUTES.prereqIosDevices)).attached;
      const matching = targets.filter((target) => target.platform === platform && target.udid && attached.includes(target.udid));
      const others = selected.filter((value) => !value.startsWith(`${platform}:`));
      onSelectedChange([...others, ...matching.map(token)]);
      const unknown = attached.filter((id) => !matching.some((target) => target.udid === id));
      setNote(`Đã chọn ${matching.length} máy đang cắm.${unknown.length ? ` ${unknown.length} máy chưa có trong config.` : ''}`);
    } catch (error) {
      setNote(`Không dò được thiết bị: ${(error as Error).message}`);
    } finally { setDetecting(false); }
  };
  return (
    <fieldset className="rounded-lg border p-3" aria-label="Thiết bị chạy">
      <legend className="px-1 text-sm font-medium">Thiết bị chạy</legend>
      <p className="text-muted-foreground mb-3 text-xs">Chọn từ hai máy trở lên để chạy song song. Platform phía trên chỉ là mặc định khi không chọn máy.</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <label className="relative min-w-48 flex-1"><Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" /><Input className="ps-8" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên, id hoặc UDID…" aria-label="Tìm thiết bị" /></label>
        <Button type="button" size="sm" variant="outline" onClick={toggleAll}>{allVisible ? 'Bỏ chọn' : `Chọn tất cả (${visible.length})`}</Button>
        <Button type="button" size="sm" variant="outline" disabled={detecting} onClick={() => void detect()}><RefreshCw /> {detecting ? 'Đang dò…' : 'Máy đang cắm'}</Button>
      </div>
      <div className="max-h-52 space-y-3 overflow-y-auto pe-1">
        {(['android', 'ios'] as const).map((kind) => {
          const group = visible.filter((target) => target.platform === kind);
          if (!group.length) return null;
          return <div key={kind}><p className="text-muted-foreground mb-1 text-xs font-medium uppercase">{kind}</p><div className="space-y-1">{group.map((target) => <label key={token(target)} className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm"><input className="accent-primary size-4" type="checkbox" checked={selected.includes(token(target))} onChange={() => toggle(target)} aria-label={`Chọn ${target.deviceName}`} /><span>{target.deviceName} <span className="text-muted-foreground text-xs">({target.id}{target.udid ? ` · ${target.udid}` : ''})</span></span></label>)}</div></div>;
        })}
        {!visible.length && <p className="text-muted-foreground text-sm">Không có thiết bị nào khớp.</p>}
      </div>
      {note && <p className="text-muted-foreground mt-2 text-xs">{note}</p>}
    </fieldset>
  );
}

function token(target: DeviceTarget): string { return `${target.platform}:${target.id}`; }
