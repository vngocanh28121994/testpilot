import type { WorkflowStage } from '@core/ui/contracts.js';

export interface FarmRunningCopy {
  button: string;
  title: string;
  detail: string;
}

const COPY: FarmRunningCopy[] = [
  {
    button: 'Đang đóng gói…',
    title: 'Đang đóng gói test package',
    detail: 'TestPilot đang chuẩn bị app và bộ test trước khi gửi lên AWS.',
  },
  {
    button: 'Đang upload lên AWS…',
    title: 'Đang upload lên AWS',
    detail: 'App, test package và testspec đang được tải lên Device Farm.',
  },
  {
    button: 'Đang chờ Device Farm…',
    title: 'Thiết bị AWS đang chạy test',
    detail: 'Lượt chạy chỉ chuyển sang bước thu báo cáo sau khi tất cả thiết bị hoàn tất.',
  },
  {
    button: 'Đang thu report, ảnh và video…',
    title: 'AWS đã chạy xong — đang thu kết quả',
    detail: 'TestPilot đang tải và ghép report, ảnh, video của từng thiết bị. Bước này có thể mất thêm vài phút.',
  },
];

/** Nội dung đang chạy lấy từ stage có cấu trúc do server phát, không parse log AWS. */
export function farmRunningCopy(stages?: WorkflowStage[]): FarmRunningCopy {
  const running = stages?.findIndex((stage) => stage.status === 'running') ?? -1;
  if (running >= 0 && COPY[running]) return COPY[running];

  if (stages?.length && stages.every((stage) => stage.status === 'done')) {
    return {
      button: 'Đang hoàn tất…',
      title: 'Đang hoàn tất lượt chạy',
      detail: 'Kết quả đã được thu; TestPilot đang lưu lịch sử và tạo liên kết tới báo cáo.',
    };
  }

  return {
    button: 'Đang khởi tạo…',
    title: 'Đang khởi tạo lượt chạy',
    detail: 'TestPilot đang kiểm tra cấu hình trước khi bắt đầu đóng gói.',
  };
}
