import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ConfluenceAuthRequest,
  ConfluenceAuthResponse,
  McpToolsResponse,
  ModelKeyRequest,
  OkResponse,
  SaveConfigResponse,
  StateResponse,
  TestPilotConfig,
} from '@core/ui/contracts.js';
import { api, qs } from '@/api/client';
import { ROUTES } from '@/api/routes';
import { stateQueryKey } from '@/hooks/useAppState';

export const confluenceAuthKey = ['confluence-auth'] as const;

export function useConfluenceAuth() {
  return useQuery({
    queryKey: confluenceAuthKey,
    queryFn: () => api.get<ConfluenceAuthResponse>(ROUTES.confluenceAuth),
  });
}

export function useSaveConfluenceAuth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ConfluenceAuthRequest) =>
      api.post<OkResponse>(ROUTES.confluenceAuth, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: confluenceAuthKey });
      toast.success('Đã lưu. Lần sinh testcase tới sẽ đọc được ảnh trong trang Confluence.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSaveModelKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ModelKeyRequest) => api.post<OkResponse>(ROUTES.modelKey, body),
    onSuccess: () => {
      // modelKeys nằm trong /api/state, nên phải làm mới nó chứ không chỉ báo xong.
      void qc.invalidateQueries({ queryKey: stateQueryKey });
      toast.success('Đã lưu Gemini key. Sẵn sàng phân tích ảnh Confluence/Figma.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Lưu cấu hình, kèm bản mà màn này đang dựa vào.
 *
 * `baseRevision` lấy từ chính /api/state mà màn này đã đọc, nên nó là "bản tôi
 * nhìn thấy lúc mở". Server từ chối nếu file đã đổi kể từ đó — chuyện xảy ra
 * thật khi người dùng tải một bản build lên ở màn Bản build giữa chừng: trước
 * đây cú Lưu này ghi đè mất, im lặng và trả về 200.
 */
export function useSaveConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: TestPilotConfig) => {
      const seen = qc.getQueryData<StateResponse>(stateQueryKey)?.configRevision;
      return api.put<SaveConfigResponse>(`${ROUTES.config}${qs({ baseRevision: seen })}`, config);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: stateQueryKey });
      toast.success('Đã lưu.');
    },
    // Lỗi ở đây thường là mảng `issues` của zod, đã được api/client nối bằng
    // xuống dòng. Toast giữ nguyên xuống dòng để từng trường sai đọc được.
    onError: (e: Error) => toast.error(e.message, { style: { whiteSpace: 'pre-line' } }),
  });
}

export function useProbeMcp() {
  return useMutation({
    mutationFn: (mcp: unknown) => api.post<McpToolsResponse>(ROUTES.mcpTools, mcp),
    onError: (e: Error) => toast.error(e.message),
  });
}
