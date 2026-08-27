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
  icon: string;
  /** Chỉ có ở mục placeholder. Sự hiện diện của nó = "chưa nối". */
  why?: string;
}

export const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', to: '/', icon: 'dashboard' },
  {
    id: 'history',
    label: 'Gen History',
    to: '/todo/history',
    icon: 'history',
    why: 'Lịch sử gộp mọi loại job. Hiện đã tách sẵn thành Scenario History và E2E History.',
  },
  {
    id: 'db-sources',
    label: 'DB Sources',
    to: '/todo/db-sources',
    icon: 'db',
    why: 'Kết nối DB để dựng/kiểm tra dữ liệu test. TestPilot chưa chạm tới tầng dữ liệu.',
  },
  {
    id: 'repositories',
    label: 'Repositories',
    to: '/todo/repositories',
    icon: 'repo',
    why: 'Đẩy .feature đã sinh vào repo. Hiện file chỉ ghi xuống thư mục features/ để bạn tự commit.',
  },
  {
    id: 'team-configs',
    label: 'Team Configs',
    to: '/todo/team-configs',
    icon: 'team',
    why: 'Config dùng chung cho cả team. Hiện chỉ có một testpilot.config.json cục bộ.',
  },
  {
    id: 'zephyr',
    label: 'Zephyr',
    to: '/todo/zephyr',
    icon: 'zephyr',
    why: 'Đồng bộ kết quả sang Zephyr/Jira. Chưa nối.',
  },
  { id: 'studio', label: 'App Automation Studio', to: '/studio', icon: 'studio' },
  { id: 'scenario-review', label: 'Kịch bản', to: '/scenarios', icon: 'scenarioHistory' },
  { id: 'healing-center', label: 'Healing Center', to: '/healing', icon: 'e2eHistory' },
  { id: 'builds', label: 'Bản build', to: '/builds', icon: 'package' },
  { id: 'e2e-runner', label: 'Local Runner', to: '/runner', icon: 'runner' },
  { id: 'device-farm', label: 'Device Farm', to: '/farm', icon: 'farm' },
  {
    id: 'job-management',
    label: 'Job Management',
    to: '/todo/job-management',
    icon: 'job',
    why: 'Hàng đợi và lịch chạy. Hiện mỗi lần bấm chạy là một tiến trình đồng bộ.',
  },
  { id: 'settings', label: 'Personal Settings', to: '/settings', icon: 'settings' },
];

/** 6 mục chưa nối — dùng để tra `why` từ slug của route /todo/$slug. */
export const PLACEHOLDERS = new Map(NAV.filter((n) => n.why).map((n) => [n.id, n]));
