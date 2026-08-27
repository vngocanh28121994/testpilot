import {
  Activity,
  CircleDashed,
  Database,
  FolderGit2,
  LayoutDashboard,
  ListChecks,
  Package,
  Settings,
  Smartphone,
  Sparkles,
  Stethoscope,
  Ticket,
  Timer,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

/**
 * Điều hướng chính — chép nguyên từ `NAV` ở app.js:71, giữ đúng thứ tự và đúng
 * từng chuỗi tiếng Việt.
 *
 * 14 mục: 8 mục có trang thật, 6 mục là placeholder. Sáu mục placeholder có
 * trường `why` giải thích vì sao chúng có trong thiết kế mà chưa có gì đứng
 * sau — cả sáu cùng render trang `todo`. Giữ nguyên chúng là có chủ đích: xoá
 * đi thì bản mới trông như bị mất tính năng so với bản cũ.
 */
export interface NavItem {
  id: string;
  label: string;
  /** Đường dẫn route; mục placeholder trỏ về /todo/<id>. */
  to: string;
  icon: LucideIcon;
  /** Chỉ có ở mục placeholder. Sự hiện diện của nó = "chưa nối". */
  why?: string;
}

export const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', to: '/', icon: LayoutDashboard },
  {
    id: 'history',
    label: 'Gen History',
    to: '/todo/history',
    icon: Timer,
    why: 'Lịch sử gộp mọi loại job. Hiện đã tách sẵn thành Scenario History và E2E History.',
  },
  {
    id: 'db-sources',
    label: 'DB Sources',
    to: '/todo/db-sources',
    icon: Database,
    why: 'Kết nối DB để dựng/kiểm tra dữ liệu test. TestPilot chưa chạm tới tầng dữ liệu.',
  },
  {
    id: 'repositories',
    label: 'Repositories',
    to: '/todo/repositories',
    icon: FolderGit2,
    why: 'Đẩy .feature đã sinh vào repo. Hiện file chỉ ghi xuống thư mục features/ để bạn tự commit.',
  },
  {
    id: 'team-configs',
    label: 'Team Configs',
    to: '/todo/team-configs',
    icon: Users,
    why: 'Config dùng chung cho cả team. Hiện chỉ có một testpilot.config.json cục bộ.',
  },
  {
    id: 'zephyr',
    label: 'Zephyr',
    to: '/todo/zephyr',
    icon: Ticket,
    why: 'Đồng bộ kết quả sang Zephyr/Jira. Chưa nối.',
  },
  { id: 'studio', label: 'App Automation Studio', to: '/studio', icon: Sparkles },
  { id: 'scenario-review', label: 'Kịch bản', to: '/scenarios', icon: ListChecks },
  { id: 'healing-center', label: 'Healing Center', to: '/healing', icon: Stethoscope },
  { id: 'builds', label: 'Bản build', to: '/builds', icon: Package },
  { id: 'e2e-runner', label: 'Local Runner', to: '/runner', icon: Activity },
  { id: 'device-farm', label: 'Device Farm', to: '/farm', icon: Smartphone },
  {
    id: 'job-management',
    label: 'Job Management',
    to: '/todo/job-management',
    icon: Workflow,
    why: 'Hàng đợi và lịch chạy. Hiện mỗi lần bấm chạy là một tiến trình đồng bộ.',
  },
  { id: 'settings', label: 'Personal Settings', to: '/settings', icon: Settings },
];

/** 6 mục chưa nối — dùng để tra `why` từ slug của route /todo/$slug. */
export const PLACEHOLDERS = new Map(NAV.filter((n) => n.why).map((n) => [n.id, n]));

const byId = (id: string): NavItem => {
  const item = NAV.find((n) => n.id === id);
  if (!item) throw new Error(`NAV thiếu mục "${id}"`);
  return item;
};

/** Mục cha gom toàn bộ placeholder lại, theo khuôn NavGroup của sen. */
export const IN_PROGRESS = {
  label: 'Inprogress',
  icon: CircleDashed,
  /** Đúng 6 mục có `why`, giữ nguyên thứ tự khai báo trong NAV. */
  items: NAV.filter((n) => n.why),
} as const;

export interface NavGroup {
  /** Rỗng nghĩa là nhóm không có tiêu đề — nhóm đầu tiên, như sen. */
  title: string;
  items: NavItem[];
}

/**
 * Menu chia nhóm theo việc người dùng đang làm gì, thay cho một danh sách
 * phẳng 14 mục xen kẽ giữa trang thật và placeholder.
 *
 * Sáu mục placeholder KHÔNG nằm ở đây — chúng nằm dưới mục cha `IN_PROGRESS`
 * mà AppSidebar render riêng ở cuối.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Sinh kịch bản',
    items: [byId('dashboard'), byId('studio'), byId('scenario-review')],
  },
  {
    title: 'Chạy và sửa',
    items: [byId('builds'), byId('e2e-runner'), byId('device-farm'), byId('healing-center')],
  },
  {
    title: 'Cấu hình',
    items: [byId('settings')],
  },
];
