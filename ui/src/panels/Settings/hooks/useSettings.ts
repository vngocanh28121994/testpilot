import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ConfluenceAuthRequest,
  ConfluenceAuthResponse,
  McpToolsResponse,
  ModelKeyRequest,
  OkResponse,
  SaveConfigResponse,
  TestPilotConfig,
} from '@core/ui/contracts.js';
import { api } from '@/api/client';
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

export function useSaveConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: TestPilotConfig) => api.put<SaveConfigResponse>(ROUTES.config, config),
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
