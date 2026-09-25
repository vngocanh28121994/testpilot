/**
 * Job nào đang chạy TRONG TIẾN TRÌNH NÀY, và cách dừng riêng từng job.
 *
 * Khi một runner chỉ chạy một job một lúc, nút Dừng gọi `stopSuite` — giết mọi
 * tiến trình test máy này đang chạy — và điều đó trùng với "dừng job của tôi".
 * Từ khi mỗi thiết bị chạy một job, hai câu ấy khác hẳn nhau: người A bấm Dừng
 * không được làm đứt lượt chạy của người B trên chiếc máy bên cạnh.
 *
 * Sổ nằm ở module chứ không trong một worker, vì người hỏi là route HTTP của
 * máy chủ — nó không cầm handle của worker nào — còn worker nhúng trong máy
 * chủ thì chạy cùng tiến trình với route ấy.
 */
const running = new Map<string, AbortController>();

/** Worker ghi danh một job vừa nhận. Trả về bộ huỷ riêng của job ấy. */
export function trackJob(jobId: string): AbortController {
  const controller = new AbortController();
  running.set(jobId, controller);
  return controller;
}

export function untrackJob(jobId: string): void {
  running.delete(jobId);
}

/**
 * Dừng một job đang chạy ở tiến trình này.
 *
 * `false` nghĩa là job không chạy ở đây — có thể nó ở một runner khác, hoặc đã
 * xong. Người gọi phải phân biệt hai trường hợp ấy, không phải nơi này.
 */
export function stopLocalJob(jobId: string): boolean {
  const controller = running.get(jobId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function localJobs(): string[] {
  return [...running.keys()];
}
