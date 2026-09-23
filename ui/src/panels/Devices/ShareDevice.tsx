import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Grant {
  udid: string;
  userId: string;
  grantedBy: string;
  createdAt: string;
}

/**
 * Cho một người cụ thể mượn chiếc máy riêng của mình.
 *
 * Vì sao cần mức giữa: "riêng" nghĩa là chỉ mình tôi, "chung" nghĩa là cả tổ
 * chức, và việc thật thì nằm ở giữa — chiếc iPhone 12 duy nhất của đội đang
 * cắm ở máy tôi, và người đang sửa bug trên iOS 15 cần nó trong hai tiếng.
 * Không có mức giữa thì người ta sẽ chọn "chung", rồi để nguyên như thế mãi.
 *
 * Danh sách người đang mượn hiện NGAY ở đây, không nấp sau một màn hình khác:
 * thứ người ta quên là thứ mình đã cho mượn, và một quyền bị quên thì không
 * bao giờ được thu lại.
 */
export function ShareDevice({ udid }: { udid: string }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState('');

  const shares = useQuery({
    queryKey: ['device-shares', udid],
    queryFn: () => api.get<{ grants: Grant[] }>(`${ROUTES.deviceShares}?udid=${encodeURIComponent(udid)}`),
    // Chỉ hỏi khi người ta mở ra: mỗi chiếc máy là một lời gọi, và một phòng
    // máy hai mươi chiếc thì đó là hai mươi lời gọi cho một thứ hiếm khi đổi.
    enabled: open,
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['device-shares', udid] });
    // Danh sách máy của NGƯỜI KHÁC vừa đổi. Bản thân người đang bấm không thấy
    // gì khác, nên không làm mới thì họ tưởng chưa có gì xảy ra.
    void client.invalidateQueries({ queryKey: ['device-targets'] });
  };

  const share = useMutation({
    mutationFn: (userId: string) => api.post<unknown>(ROUTES.deviceShare, { udid, userId }),
    onSuccess: (_result, userId) => {
      setWho('');
      refresh();
      toast.success(`Đã cho ${userId} mượn máy này. Thu lại được bất cứ lúc nào.`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const unshare = useMutation({
    mutationFn: (userId: string) => api.post<unknown>(ROUTES.deviceUnshare, { udid, userId }),
    onSuccess: (_result, userId) => {
      refresh();
      // Nói rõ chuyện lease: người ta vừa bấm "thu lại" và sẽ đi kiểm tra ngay.
      toast.success(`Đã thu lại quyền của ${userId}. Lượt đang cầm máy vẫn chạy hết.`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Chia sẻ
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={who}
          placeholder="Cho ai mượn"
          aria-label={`Cho ai mượn ${udid}`}
          className="h-8 max-w-56"
          onChange={(event) => setWho(event.target.value)}
        />
        <Button
          size="sm"
          disabled={!who.trim() || share.isPending}
          onClick={() => share.mutate(who.trim())}
        >
          Cho mượn
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Xong
        </Button>
      </div>
      {(shares.data?.grants ?? []).length > 0 && (
        <ul className="flex flex-wrap justify-end gap-2">
          {shares.data!.grants.map((grant) => (
            <li key={grant.userId} className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">{grant.userId}</span>
              <button
                type="button"
                className="text-destructive underline"
                disabled={unshare.isPending}
                onClick={() => unshare.mutate(grant.userId)}
              >
                thu lại
              </button>
            </li>
          ))}
        </ul>
      )}
      {shares.data && shares.data.grants.length === 0 && (
        <span className="text-muted-foreground text-xs">Chưa cho ai mượn.</span>
      )}
    </div>
  );
}
