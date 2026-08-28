import { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/Field';
import { Input } from '@/components/ui/input';
import { DropdownSelect } from '@/components/DropdownSelect';
import { uploadBuild } from '@/api/upload';
import type { StudioForm } from '@core/ui/contracts.js';

type Environments = NonNullable<StudioForm['environments']>;

export function EnvEditor({
  environments,
  defaultEnv,
  accounts,
  onChange,
}: {
  environments: Environments;
  defaultEnv: string;
  accounts: Array<{ label: string }>;
  onChange: (environments: Environments, defaultEnv: string) => void;
}) {
  const [newName, setNewName] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const entries = Object.entries(environments);
  const changeEnv = (name: string, patch: Environments[string]) => onChange({ ...environments, [name]: patch }, defaultEnv);
  const rename = (oldName: string, value: string) => {
    const name = value.trim();
    if (!name || name === oldName || environments[name]) return;
    const next = Object.fromEntries(entries.map(([key, item]) => [key === oldName ? name : key, item]));
    onChange(next, defaultEnv === oldName ? name : defaultEnv);
  };
  const add = () => {
    const name = newName.trim();
    if (!name) return;
    if (environments[name]) return toast.error(`Môi trường “${name}” đã tồn tại.`);
    onChange({ ...environments, [name]: { accounts: {}, web: {}, android: {}, ios: {} } }, defaultEnv || name);
    setNewName('');
  };
  const upload = async (name: string, platform: 'android' | 'ios', file: File) => {
    const key = `${name}:${platform}`;
    setUploading(key);
    try {
      const response = await uploadBuild(file, { platform, env: name });
      const env = environments[name] ?? {};
      changeEnv(name, { ...env, [platform]: { ...env[platform], app: response.path } });
      toast.success(`Đã tải ${file.name}; bấm Lưu Studio để ghi cấu hình.`);
    } catch (error) { toast.error((error as Error).message); } finally { setUploading(null); }
  };
  return <Card aria-labelledby="environments-title">
    <CardHeader><CardTitle id="environments-title">Môi trường</CardTitle><CardDescription>Gán role vào account, URL web và build riêng cho từng môi trường.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {entries.map(([name, env]) => <section key={name} className="rounded-lg border p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input className="h-8 max-w-48 font-medium" defaultValue={name} aria-label={`Tên môi trường ${name}`} onBlur={(event) => rename(name, event.target.value)} />
          <label className="flex items-center gap-1.5 text-sm"><input type="radio" name="default-env" checked={defaultEnv === name} onChange={() => onChange(environments, name)} /> Mặc định</label>
          <Button className="ms-auto" type="button" variant="ghost" size="sm" aria-label={`Xoá môi trường ${name}`} onClick={() => { const next = { ...environments }; delete next[name]; onChange(next, defaultEnv === name ? Object.keys(next)[0] ?? '' : defaultEnv); }}><Trash2 /> Xoá</Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Web base URL"><Input value={env.web?.baseUrl ?? ''} placeholder="https://…" onChange={(event) => changeEnv(name, { ...env, web: { ...env.web, baseUrl: event.target.value } })} /></Field>
          <div className="space-y-2"><p className="text-sm font-medium">Role → account</p>{accounts.map((account) => <label key={account.label} className="grid grid-cols-2 items-center gap-2 text-sm"><span>{account.label}</span><DropdownSelect ariaLabel={`Account cho ${account.label}`} value={env.accounts?.[account.label] ?? ''} onValueChange={(value) => changeEnv(name, { ...env, accounts: { ...env.accounts, [account.label]: value } })} options={[{ value: '', label: '— chưa gán —' }, ...accounts.map((option) => ({ value: option.label, label: option.label }))]} /></label>)}</div>
          {(['android', 'ios'] as const).map((platform) => <div key={platform} className="rounded border p-3"><p className="mb-1 text-sm font-medium">{platform === 'android' ? 'Android (.apk)' : 'iOS (.ipa)'}</p><p className="text-muted-foreground truncate text-xs">{env[platform]?.app || 'Chưa có build riêng'}</p><label className="mt-2 inline-flex"><input className="sr-only" type="file" accept={platform === 'android' ? '.apk' : '.ipa'} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(name, platform, file); event.currentTarget.value = ''; }} /><span className="button text-xs"><Upload /> {uploading === `${name}:${platform}` ? 'Đang tải…' : 'Tải build'}</span></label></div>)}
        </div>
      </section>)}
      <div className="flex gap-2"><Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Tên môi trường mới, ví dụ uat" /><Button type="button" variant="outline" onClick={add}><Plus /> Thêm môi trường</Button></div>
    </CardContent>
  </Card>;
}
