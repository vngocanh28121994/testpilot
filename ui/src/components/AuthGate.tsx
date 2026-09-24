import type { ReactNode } from 'react';
import { LogIn, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DotBackground } from '@/components/DotBackground';
import { goToLogin, useAuth } from '@/hooks/useAuth';

/**
 * Cửa vào của chế độ server: chưa đăng nhập thì hiện màn đăng nhập.
 *
 * Trước đây giao diện không có đường đăng nhập nào — nó được viết khi chỉ có
 * chế độ embedded. Người mở máy chủ lần đầu thấy một băng đỏ "Máy chủ đang lỗi
 * … Cần đăng nhập." và không có nút nào để bấm: trông như máy chủ hỏng, trong
 * khi thứ họ cần chỉ là đăng nhập.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();

  // Chưa biết thì chưa vẽ gì: vẽ app rồi mới đổi sang màn đăng nhập là một
  // loạt yêu cầu 401 và băng lỗi nháy lên rồi tắt.
  if (auth.isPending) return null;

  if (auth.isError) {
    return (
      <Centered>
        <h1 className="text-lg font-semibold">Chưa liên lạc được với máy chủ TestPilot</h1>
        <p className="text-muted-foreground text-sm">{auth.error.message}</p>
        <Button variant="outline" onClick={() => void auth.refetch()}>
          <RotateCw /> Thử lại
        </Button>
      </Centered>
    );
  }

  if (auth.data.mode === 'server' && !auth.data.authenticated) {
    return (
      <Centered>
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="size-10 rounded" />
        <h1 className="text-lg font-semibold">Đăng nhập TestPilot</h1>
        <p className="text-muted-foreground text-sm">
          Máy chủ này dùng chung cho cả nhóm, nên cần biết bạn là ai trước khi xem kịch bản, chạy test
          hay giữ máy. Bạn sẽ được chuyển sang trang đăng nhập của công ty rồi quay lại đúng trang này.
        </p>
        <Button onClick={goToLogin}>
          <LogIn /> Đăng nhập
        </Button>
      </Centered>
    );
  }

  return <>{children}</>;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="relative isolate flex min-h-svh items-center justify-center p-4">
      <DotBackground disableMouseLinks className="fixed z-0" />
      <div className="bg-card relative z-10 flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border p-6 text-center shadow-sm">
        {children}
      </div>
    </main>
  );
}
