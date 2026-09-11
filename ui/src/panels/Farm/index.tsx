import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
  Download,
  LogIn,
  Play,
  Plus,
  RefreshCw,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Dropdown } from '@/components/Dropdown';
import { LogView } from '@/components/LogView';
import { Field } from '@/components/Field';
import { CheckRow } from '@/components/CheckRow';
import { GroupHeading } from '@/components/GroupHeading';
import { StatusBanner } from '@/components/StatusBanner';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { CheckedAt } from '@/components/CheckedAt';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, qs } from '@/api/client';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { useAppState } from '@/hooks/useAppState';
import { TagFilter } from '@/components/TagFilter';

/** Tên biến mà farm/testspec.yml đọc để giới hạn phạm vi lượt chạy. */
const FARM_TAG_VAR = 'TESTPILOT_TAG';
import { useStreamJob } from '@/hooks/useStreamJob';
import { when } from '@/lib/datetime';
import type {
  AwsStatus,
  FarmApiResponse,
  FarmDevice,
  FarmForm,
  FarmPool,
  FarmProject,
} from '@core/ui/contracts.js';

interface EnvEntry {
  key: string;
  value: string;
}

const PAGE_DESCRIPTION = 'Chạy bộ test Appium trên thiết bị thật của AWS.';

async function farmGet<T>(path: string): Promise<T> {
  const response = await api.get<FarmApiResponse<T>>(path);
  if (!response.ok || response.data === undefined)
    throw new Error(response.hint ?? response.error ?? 'Yêu cầu Device Farm thất bại.');
  return response.data;
}

/**
 * Còn bao lâu nữa thì credential hết hạn.
 *
 * Đây là thứ DUY NHẤT thật sự đổi sau một lần đăng nhập thành công: nếu đang
 * kết nối được rồi thì huy hiệu vẫn xanh trước và sau, và màn hình trông y hệt
 * — đúng như báo cáo "đăng nhập xong mà không thấy gì thay đổi".
 */
function credentialLife(aws: AwsStatus): string {
  if (aws.expiresInMinutes === undefined) return 'không hết hạn (IAM role hoặc access key)';
  if (aws.expiresInMinutes < 0) return 'đã hết hạn';
  if (aws.expiresInMinutes < 90) return `còn ${aws.expiresInMinutes} phút`;
  const hours = Math.floor(aws.expiresInMinutes / 60);
  return `còn ${hours} giờ ${aws.expiresInMinutes % 60} phút`;
}

/** 15 phút là mức mà một lượt chạy farm nhiều khả năng sống lâu hơn credential của nó. */
function expiringSoon(aws: AwsStatus): boolean {
  return aws.expiresInMinutes !== undefined && aws.expiresInMinutes < 15;
}

export default function FarmPanel() {
  const state = useAppState((s) => ({
    config: s.config,
    appBuilds: s.appBuilds,
    runs: s.runs,
    features: s.features,
  }));
  const saved = state.data?.config.farm;
  const [region, setRegion] = useState(saved?.region ?? 'us-west-2');
  const [platform, setPlatform] = useState<'android' | 'ios'>(saved?.platform ?? 'android');
  const [project, setProject] = useState(saved?.projectArn ?? '');
  const [pool, setPool] = useState(saved?.devicePoolArn ?? '');
  const [projects, setProjects] = useState<FarmProject[]>([]);
  const [pools, setPools] = useState<FarmPool[]>([]);
  const [devices, setDevices] = useState<FarmDevice[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [poolName, setPoolName] = useState('');
  const [aws, setAws] = useState<AwsStatus | null>(null);
  const [form, setForm] = useState(() => ({
    testPackagePath: saved?.testPackagePath ?? 'build/testpilot-appium.zip',
    testSpecPath: saved?.testSpecPath ?? 'farm/testspec.yml',
    runName: saved?.runName ?? '',
    jobTimeoutMinutes: saved?.jobTimeoutMinutes ?? 30,
    videoCapture: saved?.videoCapture ?? true,
    sendSecrets: saved?.sendSecrets ?? false,
    env: Object.entries(saved?.env ?? {}).map(([key, value]) => ({ key, value })),
    bundle: true,
  }));
  const job = useStreamJob('farm-run', STREAM_ROUTES.farmRun);
  const login = useStreamJob('aws-login', STREAM_ROUTES.awsLogin);
  // Trạng thái AWS gần như không đổi giữa hai lần bấm, nên nếu màn hình đứng im
  // thì không phân biệt được "đã kiểm rồi, vẫn vậy" với "nút hỏng".
  const [awsCheckedAt, setAwsCheckedAt] = useState<number | undefined>(undefined);
  const [awsChecking, setAwsChecking] = useState(false);
  const checkAws = () => {
    setAwsChecking(true);
    void api
      .get<AwsStatus>(`${ROUTES.aws}${qs({ region })}`)
      .then((next) => {
        setAws(next);
        setAwsCheckedAt(Date.now());
      })
      .catch((error: Error) => toast.error(error.message))
      .finally(() => setAwsChecking(false));
  };
  // Bọc trong thân khối thay vì truyền thẳng `checkAws`: giá trị nó trả về sẽ
  // đi vào chỗ hàm dọn dẹp mà chỗ gọi không nhìn thấy. Hôm nay `checkAws` có
  // `void` nên trả undefined và không sao — nhưng đó là một tính chất ở tận
  // định nghĩa hàm, cách đây mấy dòng, và không gì bắt nó phải giữ nguyên.
  useEffect(() => {
    checkAws();
  }, [region]);

  /**
   * Đăng nhập xong thì kiểm tra lại ngay.
   *
   * Trạng thái kết nối chỉ được hỏi khi đổi region, nên sau một lần `aws sso
   * login` thành công màn hình vẫn y nguyên: log nói "Successfully logged into
   * Start URL" trong khi huy hiệu bên trên vẫn là trạng thái cũ. Người dùng
   * phải tự đoán ra là phải bấm "Kiểm tra lại" — mà cả điểm của việc đăng nhập
   * chính là cái trạng thái sau đó.
   *
   * Kiểm cả khi hỏng: một lần đăng nhập thất bại cũng có thể đã đổi trạng thái
   * (hết hạn token, đổi profile), và im lặng ở đó cũng sai y như vậy.
   */
  useEffect(() => {
    if (login.status === 'done' || login.status === 'error') checkAws();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login.status]);
  /**
   * Việc nào đang chạy, hoặc null.
   *
   * Ba nút này gọi thẳng sang AWS Device Farm — mất vài giây là chuyện thường.
   * Trước đây chúng bắn đi rồi thôi: không khoá, không đổi nhãn, không nói gì
   * khi xong. Bấm xong màn hình đứng im thì phản xạ tự nhiên là bấm tiếp, và
   * mỗi lần bấm là thêm một lượt gọi API tính tiền.
   */
  const [loading, setLoading] = useState<'projects' | 'pools' | 'devices' | null>(null);

  async function load<T>(
    key: 'projects' | 'pools' | 'devices',
    url: string,
    apply: (data: T) => void,
    done: (data: T) => string,
    /** Lần tự tải: im lặng khi xong. Người dùng không bấm gì thì không cần báo. */
    quiet = false,
  ) {
    setLoading(key);
    try {
      const data = await farmGet<T>(url);
      apply(data);
      // Nói ra kết quả, không chỉ ngừng quay: "0 project" và "chưa bấm" trông
      // giống hệt nhau trên một cái dropdown rỗng.
      if (!quiet) toast.success(done(data));
      return data;
    } catch (error) {
      toast.error((error as Error).message);
      return undefined;
    } finally {
      setLoading(null);
    }
  }

  const loadPools = () =>
    project
      ? load<FarmPool[]>(
          'pools',
          `${ROUTES.farmPools}${qs({ region, projectArn: project })}`,
          setPools,
          (data) => `${data.length} device pool.`,
        )
      : Promise.resolve(undefined);

  const loadProjects = async (quiet = false) => {
    const data = await load<FarmProject[]>(
      'projects',
      `${ROUTES.farmProjects}${qs({ region })}`,
      setProjects,
      (items) => `${items.length} project.`,
      quiet,
    );
    // Đã có project được chọn sẵn thì tải luôn pool của nó — bản cũ làm vậy, và
    // đúng: người ta bấm "Tải project" để đi tiếp, không phải để dừng ở đó.
    if (data && project) await loadPools();
  };

  //
  // Tự tải project khi credential đã dùng được.
  //
  // Trước đây danh sách chỉ sống trong state của màn này: rời sang màn khác rồi
  // quay lại là rỗng, và người dùng phải bấm "Tải project" mỗi lần vào — trong
  // khi câu trả lời không hề đổi giữa hai lần vào cách nhau vài giây.
  //
  // Vẫn giữ nút, nhưng đổi vai: nó là "tải lại", cho lúc vừa tạo project mới
  // trên AWS. Tự tải một lần cho mỗi region, và chỉ khi credential đã dùng được
  // — gọi lúc chưa đăng nhập chỉ đổi một dropdown rỗng lấy một toast lỗi.
  const autoLoaded = useRef('');
  useEffect(() => {
    if (!aws?.ok || !region) return;
    if (autoLoaded.current === region) return;
    autoLoaded.current = region;
    void loadProjects(true);
  }, [aws?.ok, region, loadProjects]);

  const loadDevices = () =>
    load<FarmDevice[]>(
      'devices',
      `${ROUTES.farmDevices}${qs({ region, platform })}`,
      setDevices,
      (data) => `${data.length} thiết bị.`,
    );
  // Pool đang chọn có đúng là pool vừa tạo từ những máy đang tích không.
  // Chỉ so bằng ARN của pool: chúng ta không biết thành phần của một pool có
  // sẵn, và cũng không cần — điều đáng hỏi là "những cái tích này đã thành pool
  // chưa", không phải "pool này gồm những máy nào".
  const [ticksPool, setTicksPool] = useState('');
  const poolMatchesTicks = Boolean(pool) && pool === ticksPool;

  // Tạo pool gọi thẳng sang AWS — mất vài giây là chuyện thường. Không khoá thì
  // màn hình đứng im, và phản xạ tự nhiên là bấm tiếp: mỗi lần bấm là thêm một
  // pool trùng tên nằm lại trong project, và người dùng phải tự đi dọn trên
  // AWS. Ba nút tải bên cạnh đã học bài này rồi; nút này thì chưa.
  const [makingPool, setMakingPool] = useState(false);
  const makePool = async () => {
    if (!poolName || !project || selected.length === 0)
      return toast.error('Cần project, tên pool và ít nhất một thiết bị.');
    setMakingPool(true);
    try {
      const response = await api.post<FarmApiResponse<FarmPool>>(ROUTES.farmPool, {
        region,
        projectArn: project,
        name: poolName,
        deviceArns: selected,
      });
      if (!response.ok || !response.data) throw new Error(response.error);
      // Danh sách thiết bị đã lọc theo nền tảng từ lúc tải, nên pool dựng từ
      // chúng chắc chắn thuộc nền tảng đang chọn. Gắn luôn để nó không bị bộ
      // lọc `shownPools` giấu mất ngay sau khi vừa tạo.
      setPools((items) => [...items, { ...response.data!, platforms: [platform] }]);
      setPool(response.data.arn);
      setTicksPool(response.data.arn);
      toast.success(`Đã tạo ${response.data.name}. Lượt chạy sẽ dùng pool này.`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setMakingPool(false);
    }
  };
  const start = () => {
    // Tích thiết bị KHÔNG phải là chọn thiết bị cho lượt chạy.
    //
    // Danh sách này chỉ là nguyên liệu cho nút "Tạo pool"; lượt chạy đọc ô
    // "Device pool" ở trên. Người dùng tích hai máy Android, bấm chạy, và lượt
    // chạy dùng pool cũ còn sót trong ô kia — một pool iPhone. Ba lần upload
    // mới biết, vì AWS chỉ nói ra sau khi đã nhận đủ gói.
    //
    // Nên chặn ngay tại đây, bằng đúng câu nói ra việc còn thiếu.
    if (selected.length > 0 && !poolMatchesTicks) {
      toast.error(
        `Đã tích ${selected.length} thiết bị nhưng chưa tạo pool. `
        + 'Đặt tên ở ô "Tên pool" rồi bấm "Tạo pool" — lượt chạy chỉ dùng pool ở ô Device pool.',
      );
      return;
    }
    const env = Object.fromEntries(
      form.env.map(({ key, value }) => [key.trim(), value]).filter(([key]) => key),
    );
    const body: FarmForm = {
      region,
      projectArn: project,
      devicePoolArn: pool,
      platform,
      testPackagePath: form.testPackagePath,
      testSpecPath: form.testSpecPath,
      runName: form.runName,
      jobTimeoutMinutes: form.jobTimeoutMinutes,
      videoCapture: form.videoCapture,
      sendSecrets: form.sendSecrets,
      ...(Object.keys(env).length > 0 ? { env } : {}),
      bundle: form.bundle,
    };
    job.start(body);
  };
  const shownPools = pools.filter(
    (item) => !item.platforms?.length || item.platforms.includes(platform),
  );
  // Đổi nền tảng thì bỏ luôn pool không còn hợp lệ.
  //
  // Danh sách đã lọc theo nền tảng, nhưng GIÁ TRỊ đang chọn thì không — chọn
  // pool lúc để iOS rồi chuyển sang Android, ô trông như trống mà vẫn giữ ARN
  // cũ. Lượt chạy gửi platform=android kèm pool iOS, config ghi lại y như vậy,
  // và AWS chỉ nói ra sau khi đã upload xong: "Android application requires an
  // Android device". Đúng chuyện vừa xảy ra.
  useEffect(() => {
    if (pool && !shownPools.some((item) => item.arn === pool)) setPool('');
  }, [platform, pools]);
  /** Tên biến mà farm/testspec.yml đọc để giới hạn phạm vi. */
  const build = state.data?.appBuilds[platform];
  const allTags = useMemo(
    () => [
      ...new Set(state.data?.features.flatMap((f) => f.scenarios.flatMap((s) => s.tags)) ?? []),
    ].sort(),
    [state.data],
  );
  // Tag sống trong chính danh sách biến môi trường, chỉ là được trình bày tử tế
  // hơn. Giữ một nguồn duy nhất để hai chỗ không bao giờ nói khác nhau.
  const farmTags = (form.env.find((entry) => entry.key === FARM_TAG_VAR)?.value ?? '')
    .split('+')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const setFarmTags = (next: string[]) =>
    setForm((old) => ({
      ...old,
      env: [
        ...(next.length > 0 ? [{ key: FARM_TAG_VAR, value: next.join('+') }] : []),
        ...old.env.filter((entry) => entry.key !== FARM_TAG_VAR),
      ],
    }));
  const farmRuns = (state.data?.runs ?? []).filter((run) => run.kind === 'farm');

  return (
    <AppShell title="AWS Device Farm" description={PAGE_DESCRIPTION}>
      <section aria-label="Device Farm" className="flex flex-1 flex-col gap-6">
        <section className="grid gap-4">
          <GroupHeading title="Kết nối và thiết bị">
            Chọn tài khoản AWS, rồi chọn project và device pool sẽ nhận lượt chạy.
          </GroupHeading>
          {/* `items-stretch` (mặc định) + `h-full` cho từng thẻ: hai cột cao bằng
              nhau.
              Với `items-start`, mỗi thẻ cao đúng bằng nội dung của nó — thẻ bên
              trái ngắn hơn nhiều so với thẻ có danh sách thiết bị bên phải, và
              phần dưới nó là một mảng trống giữa hai đường viền lệch nhau. Cho
              thẻ ngắn giãn ra thì chỗ trống nằm BÊN TRONG thẻ, không còn là một
              lỗ hổng trong bố cục. */}
          <div className="grid gap-6 xl:grid-cols-2">
            <Card className="h-full" aria-labelledby="aws-title">
              <CardHeader>
                <CardTitle id="aws-title">Kết nối AWS</CardTitle>
                <CardDescription>
                  TestPilot dùng credential chain mặc định của AWS SDK; key không đi qua trình
                  duyệt.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <StatusBanner
                  tone={!aws ? 'unknown' : !aws.ok ? 'fail' : expiringSoon(aws) ? 'warn' : 'pass'}
                  title={
                    !aws
                      ? 'Đang kiểm tra credential…'
                      : !aws.ok
                        ? 'Không dùng được credential'
                        : expiringSoon(aws)
                          ? 'Sắp hết hạn'
                          : 'Kết nối được'
                  }
                  detail={
                    aws
                      ? aws.ok
                        ? `nguồn: ${aws.source}${aws.keyHint ? `, key ${aws.keyHint}…` : ''}, ${credentialLife(aws)}`
                        : (aws.reason ?? 'không rõ lý do')
                      : undefined
                  }
                  actions={
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={awsChecking}
                        onClick={checkAws}
                      >
                        <RefreshCw className={cn('size-4', awsChecking && 'animate-spin')} />
                        Kiểm tra lại
                      </Button>
                      <CheckedAt at={awsCheckedAt} busy={awsChecking} />
                      {aws?.canLogin && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={login.status === 'running'}
                          onClick={() => login.start({ region })}
                        >
                          <LogIn className="size-4" />
                          {login.status === 'running' ? 'Đang đăng nhập…' : 'Đăng nhập AWS'}
                        </Button>
                      )}
                    </>
                  }
                />

                {login.logs.length > 0 && <LogView logs={login.logs} label="Log đăng nhập AWS" />}

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Region">
                    <NativeSelect
                      value={region}
                      onChange={setRegion}
                      options={['us-west-2', 'us-east-1']}
                    />
                  </Field>
                  <Field label="Project">
                    <Dropdown
                      className="mt-0"
                      value={project}
                      placeholder="— chọn project —"
                      onChange={(next) => {
                        setProject(next);
                        setPool('');
                      }}
                      options={projects.map((item) => ({ value: item.arn, label: item.name }))}
                    />
                  </Field>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={loading !== null}
                    onClick={() => void loadProjects()}
                  >
                    <Download className="size-4" />
                    {loading === 'projects' ? 'Đang tải project…' : 'Tải lại project'}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!project || loading !== null}
                    onClick={() => void loadPools()}
                  >
                    <Download className="size-4" />
                    {loading === 'pools' ? 'Đang tải pool…' : 'Tải pool'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="h-full" aria-labelledby="device-title">
              <CardHeader>
                <CardTitle id="device-title">Hệ điều hành & thiết bị</CardTitle>
                <CardDescription>
                  Pool quyết định lượt chạy đi lên những máy nào.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Hệ điều hành">
                    <NativeSelect
                      value={platform}
                      onChange={(value) => {
                        setPlatform(value as 'android' | 'ios');
                        setSelected([]);
                      }}
                      options={['android', 'ios']}
                    />
                  </Field>
                  <Field label="Device pool">
                    <Dropdown
                      className="mt-0"
                      value={pool}
                      placeholder="— chọn pool —"
                      onChange={setPool}
                      options={shownPools.map((item) => ({
                        value: item.arn,
                        // Thiếu `type` thì in mỗi tên, đừng in "(undefined)".
                        label: item.type ? `${item.name} (${item.type})` : item.name,
                      }))}
                    />
                  </Field>
                </div>

                <div className="bg-muted/50 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <Smartphone className="text-muted-foreground size-4 shrink-0" />
                  <span className="min-w-0 truncate">
                    {build
                      ? `${build.exists ? 'Đang dùng' : 'Không tìm thấy'}: ${build.path}`
                      : 'Chưa có bản build.'}
                  </span>
                  <Link to="/builds" className="text-primary ms-auto underline">
                    Đổi bản build →
                  </Link>
                </div>

                <details className="group">
                  <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-sm select-none">
                    Hoặc tự chọn thiết bị và tạo pool mới
                  </summary>
                  <div className="mt-3 flex flex-col gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="self-start"
                      disabled={loading !== null}
                      onClick={() => void loadDevices()}
                    >
                      <Download className="size-4" />
                      {loading === 'devices' ? 'Đang tải thiết bị…' : 'Tải thiết bị'}
                    </Button>
                    {devices.length > 0 && (
                      <div className="max-h-64 overflow-auto rounded-lg border">
                        {devices.map((item) => (
                          <label
                            key={item.arn}
                            className="hover:bg-muted/50 flex items-center gap-2 border-b p-2 text-sm last:border-b-0"
                          >
                            <input
                              type="checkbox"
                              className="accent-primary size-4"
                              checked={selected.includes(item.arn)}
                              onChange={(e) =>
                                setSelected((all) =>
                                  e.target.checked
                                    ? [...all, item.arn]
                                    : all.filter((arn) => arn !== item.arn),
                                )
                              }
                            />
                            {item.name} · {item.formFactor} · OS {item.os}
                            <span className="text-muted-foreground ms-auto text-xs">
                              {item.availability}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Input
                        placeholder="Tên pool"
                        value={poolName}
                        onChange={(e) => setPoolName(e.target.value)}
                      />
                      <Button
                        variant="outline"
                        disabled={makingPool}
                        onClick={() => void makePool()}
                      >
                        <Plus className={cn('size-4', makingPool && 'animate-spin')} />
                        {makingPool ? 'Đang tạo pool…' : 'Tạo pool'}
                      </Button>
                    </div>
                    {/* Nói ra khoảng cách giữa "đã tích" và "sẽ chạy".
                        Danh sách tích trông y như chọn máy cho lượt chạy, nhưng
                        nó chỉ là nguyên liệu để tạo pool — lượt chạy đọc ô
                        Device pool ở trên. Người dùng tích hai máy Android rồi
                        bấm chạy, và lượt chạy dùng một pool iPhone còn sót. */}
                    {selected.length > 0 && (
                      <p
                        className={
                          poolMatchesTicks
                            ? 'text-muted-foreground text-xs'
                            : 'text-status-fail text-xs'
                        }
                      >
                        {poolMatchesTicks
                          ? `Lượt chạy sẽ dùng pool vừa tạo từ ${selected.length} thiết bị này.`
                          : `Đã tích ${selected.length} thiết bị nhưng chưa thành pool — `
                            + 'đặt tên rồi bấm "Tạo pool". Lượt chạy chỉ dùng pool ở ô Device pool.'}
                      </p>
                    )}
                  </div>
                </details>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="grid gap-4">
          <GroupHeading title="Lượt chạy">
            Gói test và tuỳ chọn gửi lên farm. Cấu hình ở đây được lưu lại cho lần chạy sau.
          </GroupHeading>
          <Card aria-labelledby="package-title">
            <CardHeader>
              <CardTitle id="package-title">Gói cài đặt</CardTitle>
              <CardDescription>
                Đường dẫn tương đối so với gốc repo, cùng tuỳ chọn cho lượt chạy.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Field label="Test package">
                  <Input
                    value={form.testPackagePath}
                    onChange={(e) => setForm((old) => ({ ...old, testPackagePath: e.target.value }))}
                  />
                </Field>
                <Field label="Testspec">
                  <Input
                    value={form.testSpecPath}
                    onChange={(e) => setForm((old) => ({ ...old, testSpecPath: e.target.value }))}
                  />
                </Field>
                <Field label="Tên lượt chạy">
                  <Input
                    value={form.runName}
                    onChange={(e) => setForm((old) => ({ ...old, runName: e.target.value }))}
                  />
                </Field>
                <Field label="Timeout (phút)">
                  <Input
                    type="number"
                    value={form.jobTimeoutMinutes}
                    onChange={(e) =>
                      setForm((old) => ({
                        ...old,
                        jobTimeoutMinutes: Number(e.target.value) || 30,
                      }))
                    }
                  />
                </Field>
              </div>

              <div className="flex flex-col gap-3">
                <CheckRow
                  label="Đóng gói lại test package trước khi chạy"
                  checked={form.bundle}
                  onChange={(bundle) => setForm((old) => ({ ...old, bundle }))}
                />
                <CheckRow
                  label="Ghi video cho mỗi thiết bị"
                  checked={form.videoCapture}
                  onChange={(videoCapture) => setForm((old) => ({ ...old, videoCapture }))}
                />
                <CheckRow
                  label="Gửi secret đã cấu hình vào farm"
                  checked={form.sendSecrets}
                  onChange={(sendSecrets) => setForm((old) => ({ ...old, sendSecrets }))}
                />
              </div>

              {/* Phạm vi chạy là một câu hỏi, không phải một biến môi trường.
                  Trước đây muốn giới hạn tag trên farm thì phải tự gõ đúng tên
                  biến TESTPILOT_TAG rồi tự gõ đúng tên tag — gõ sai một ký tự
                  thì farm chạy cả bộ, và chỉ biết sau vài chục phút cùng tiền
                  thiết bị. Cùng ô chọn với màn Local Runner, cùng cú pháp. */}
              <section className="bg-card flex flex-col gap-2 rounded-lg border p-4">
                <div className="flex flex-col gap-1">
                  <h4 className="text-sm font-medium">Lọc theo tag</h4>
                  <p className="text-muted-foreground text-xs">
                    Bỏ trống là chạy cả bộ. Gửi xuống farm qua biến TESTPILOT_TAG.
                  </p>
                </div>
                <TagFilter all={allTags} value={farmTags} onChange={setFarmTags} />
              </section>

              <EnvEditor
                entries={form.env.filter((entry) => entry.key !== FARM_TAG_VAR)}
                onChange={(env) =>
                  setForm((old) => ({
                    ...old,
                    // Giữ lại dòng tag: bảng này không quản nó nữa, nhưng nó
                    // vẫn phải đi cùng lượt chạy.
                    env: [...old.env.filter((e) => e.key === FARM_TAG_VAR), ...env],
                  }))
                }
              />

              <div>
                <Button disabled={job.status === 'running'} onClick={start}>
                  <Play className="size-4" />
                  {job.status === 'running' ? 'Đang chạy…' : 'Chạy trên Device Farm'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {job.logs.length > 0 && (
            <LogView logs={job.logs} dropped={job.dropped} error={job.error} label="Log lượt chạy farm" />
          )}
        </section>

        <Card aria-labelledby="history-title">
          <CardHeader>
            <CardTitle id="history-title">Lịch sử chạy Device Farm</CardTitle>
            <CardDescription>Các lượt đã gửi lên farm từ máy này.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="p-2 font-medium">Thời điểm</th>
                    <th className="p-2 font-medium">Feature</th>
                    <th className="p-2 font-medium">Trạng thái</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {farmRuns.map((run) => (
                    <tr key={run.id} className="border-t">
                      <td className="p-2">{when(run.startedAt)}</td>
                      <td className="p-2">{run.feature}</td>
                      <td className="p-2">
                        <StatusPill status={run.status} />
                      </td>
                      <td className="p-2">
                        <Link
                          to="/farm/$runId"
                          params={{ runId: run.id }}
                          className="text-primary underline"
                        >
                          Xem
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {farmRuns.length === 0 && (
                    <tr className="border-t">
                      <td colSpan={4} className="text-muted-foreground p-6 text-center">
                        Chưa có lần chạy Device Farm.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}

function EnvEditor({
  entries,
  onChange,
}: {
  entries: EnvEntry[];
  onChange: (entries: EnvEntry[]) => void;
}) {
  const change = (index: number, key: keyof EnvEntry, value: string) =>
    onChange(entries.map((entry, i) => (i === index ? { ...entry, [key]: value } : entry)));
  return (
    <section className="rounded-lg border p-4 bg-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h4 className="text-sm font-medium">Biến môi trường</h4>
          <p className="text-muted-foreground text-xs">
            Chỉ gửi cho lượt chạy này và được lưu vào cấu hình Farm.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => onChange([...entries, { key: '', value: '' }])}
        >
          + Thêm biến
        </Button>
      </div>
      {entries.map((entry, index) => (
        <div
          key={`${index}-${entry.key}`}
          className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
        >
          <Input
            aria-label={`Tên biến ${index + 1}`}
            placeholder="TÊN_BIẾN"
            value={entry.key}
            onChange={(e) => change(index, 'key', e.target.value)}
          />
          <Input
            aria-label={`Giá trị biến ${index + 1}`}
            placeholder="giá trị"
            value={entry.value}
            onChange={(e) => change(index, 'value', e.target.value)}
          />
          <Button
            variant="outline"
            type="button"
            aria-label={`Xoá biến ${index + 1}`}
            className="text-destructive hover:text-destructive"
            onClick={() => onChange(entries.filter((_, i) => i !== index))}
          >
            <Trash2 className="size-4" />
            Xoá
          </Button>
        </div>
      ))}
    </section>
  );
}

function NativeSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
}): ReactNode {
  return (
    <Dropdown
      className="mt-0"
      value={value}
      onChange={onChange}
      options={options.map((option) => ({ value: option, label: option }))}
    />
  );
}
