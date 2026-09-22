import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useProposals, useReviewProposal } from './hooks/useProposals';
import type { ProposalView } from '@core/ui/contracts.js';

/**
 * Hàng chờ duyệt: thứ runner ĐỀ XUẤT mà chưa ai đồng ý.
 *
 * Trang này tồn tại vì một ranh giới của kiến trúc: runner không ghi thẳng vào
 * registry dùng chung. Hai mươi máy cùng học được điều gì đó trong một buổi
 * chiều, và nếu mỗi máy ghi thẳng thì bản cuối cùng thắng còn mười chín bản
 * kia biến mất mà không ai biết.
 *
 * Phần lớn những gì runner học được KHÔNG tới đây — element mới và locator đã
 * thắng đủ nhiều lần được nhận thẳng (xem `server/proposals/policy.ts`). Nên
 * danh sách này ngắn theo thiết kế, và một danh sách dài là tín hiệu chứ không
 * phải công việc bình thường.
 */
export function ProposalQueue() {
  const query = useProposals();
  const review = useReviewProposal();
  // Bước hai trước khi ghi, cùng hình dạng với bảng healing ngay bên cạnh:
  // đồng ý là một lệnh ghi vào dữ liệu của cả đội.
  const [pending, setPending] = useState<{ id: string; decision: 'accept' | 'reject' } | null>(null);
  const proposals = query.data?.proposals ?? [];

  return (
    <Card aria-labelledby="proposals-title">
      <CardHeader>
        <CardTitle id="proposals-title">Đề xuất chờ duyệt</CardTitle>
        <CardDescription>
          Thay đổi registry mà máy chạy test đề xuất, hoặc ai đó đẩy lên bằng{' '}
          <code>registry push</code>. Element mới và locator đã chứng minh được nhận thẳng,
          nên ở đây chỉ còn phần đè lên thứ người khác đã đặt.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isError && (
          <p role="alert" className="text-destructive text-sm">
            {(query.error as Error).message}
          </p>
        )}
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Thay đổi</TableHead>
                <TableHead>Người gửi</TableHead>
                <TableHead>Từ lượt chạy</TableHead>
                <TableHead>Lúc</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isPending && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground py-6 text-center">
                    Đang tải đề xuất…
                  </TableCell>
                </TableRow>
              )}
              {!query.isPending && proposals.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground py-6 text-center">
                    Không có đề xuất nào đang chờ.
                  </TableCell>
                </TableRow>
              )}
              {proposals.map((proposal) => (
                <TableRow key={proposal.id}>
                  <TableCell className="whitespace-normal">
                    <Changes proposal={proposal} />
                  </TableCell>
                  <TableCell>{proposal.createdBy}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {proposal.sourceJobId ? proposal.sourceJobId.slice(0, 8) : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {when(proposal.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {pending?.id === proposal.id ? (
                      <span className="flex items-center justify-end gap-2">
                        <span className="text-muted-foreground text-xs">
                          {pending.decision === 'accept' ? 'Ghi vào registry?' : 'Bỏ đề xuất này?'}
                        </span>
                        <Button
                          size="sm"
                          variant={pending.decision === 'accept' ? 'default' : 'destructive'}
                          disabled={review.isPending}
                          onClick={() =>
                            review.mutate(
                              { id: proposal.id, decision: pending.decision },
                              { onSuccess: () => setPending(null) },
                            )
                          }
                        >
                          Chắc chắn
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                          Thôi
                        </Button>
                      </span>
                    ) : (
                      <span className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          onClick={() => setPending({ id: proposal.id, decision: 'accept' })}
                        >
                          Đồng ý
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPending({ id: proposal.id, decision: 'reject' })}
                        >
                          Từ chối
                        </Button>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Thay đổi, kể theo element.
 *
 * Tên element chứ không phải số lượng: "3 thay đổi" không giúp ai quyết định
 * được gì, còn "login_btn, otp_field" thì người đọc nhận ra ngay đây có phải
 * phần mình vừa sửa hay không.
 */
function Changes({ proposal }: { proposal: ProposalView }) {
  const summary = proposal.summary;
  if (!summary) return <span className="text-muted-foreground">Không rõ</span>;

  const groups: Array<[string, string[], string]> = [
    ['thêm', summary.added, 'text-emerald-600 dark:text-emerald-400'],
    ['sửa', summary.changed, 'text-amber-600 dark:text-amber-400'],
    ['bỏ', summary.removed, 'text-destructive'],
  ];

  return (
    <span className="flex flex-col gap-0.5 text-sm">
      {groups
        .filter(([, ids]) => ids.length > 0)
        .map(([label, ids, tint]) => (
          <span key={label}>
            <b className={tint}>{label}</b>{' '}
            <span className="font-mono text-xs">{ids.join(', ')}</span>
          </span>
        ))}
    </span>
  );
}

function when(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString('vi-VN');
}
