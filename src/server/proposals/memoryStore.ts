/**
 * Đề xuất trong bộ nhớ — chế độ `embedded`.
 *
 * Ở bản local, "đề xuất" nghe như thừa: chỉ có một người, và họ tự duyệt của
 * chính mình. Nó vẫn tồn tại vì hai lý do. Thứ nhất, `testpilot registry push`
 * phải chạy được ở cả hai chế độ, nếu không lệnh ấy chỉ dùng được ở nửa số
 * nơi triển khai. Thứ hai, một người làm offline trên laptop rồi đẩy lên bản
 * local của chính họ vẫn cần biết mình đang ghi đè cái gì.
 */
import { randomUUID } from 'node:crypto';
import type { NewProposal, Proposal, ProposalState, ProposalStore } from './store.js';

export class MemoryProposalStore implements ProposalStore {
  private readonly proposals = new Map<string, Proposal>();

  async create(proposal: NewProposal): Promise<Proposal> {
    const record: Proposal = {
      id: randomUUID(),
      orgId: proposal.orgId,
      kind: proposal.kind,
      key: proposal.key,
      ...(proposal.baseRevision ? { baseRevision: proposal.baseRevision } : {}),
      patch: proposal.patch,
      ...(proposal.sourceJobId ? { sourceJobId: proposal.sourceJobId } : {}),
      createdBy: proposal.createdBy,
      state: 'pending',
      createdAt: new Date().toISOString(),
      ...(proposal.summary ? { summary: proposal.summary } : {}),
    };
    this.proposals.set(record.id, record);
    return { ...record };
  }

  async list(filter?: { state?: ProposalState[] }): Promise<Proposal[]> {
    // Mới nhất trước: người duyệt quan tâm cái vừa tới, không phải cái tuần trước.
    return [...this.proposals.values()]
      .filter((proposal) => !filter?.state || filter.state.includes(proposal.state))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((proposal) => ({ ...proposal }));
  }

  async find(id: string): Promise<Proposal | undefined> {
    const found = this.proposals.get(id);
    return found ? { ...found } : undefined;
  }

  async decide(
    id: string,
    state: 'accepted' | 'rejected',
    reviewer: string,
    now = new Date(),
  ): Promise<Proposal | undefined> {
    const found = this.proposals.get(id);
    // Chỉ quyết định được một lần: bấm hai lần trên hai tab đang mở là chuyện
    // bình thường, và lần thứ hai không được lặng lẽ ghi đè quyết định đầu.
    if (!found || found.state !== 'pending') return undefined;
    const decided: Proposal = {
      ...found,
      state,
      reviewedBy: reviewer,
      reviewedAt: now.toISOString(),
    };
    this.proposals.set(id, decided);
    return { ...decided };
  }
}

/** MỘT sổ cho cả tiến trình — cùng lý do với `localQueue`, `localLeases`. */
export const localProposals = new MemoryProposalStore();
