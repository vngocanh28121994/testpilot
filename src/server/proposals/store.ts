/**
 * Đề xuất sửa dữ liệu dùng chung — thứ một runner được phép GỬI, không được
 * phép GHI.
 *
 * Đây là luật cũ của kiến trúc, viết thành code: runner không bao giờ ghi
 * thẳng vào registry (FARM-ARCHITECTURE mục 4b). Lý do không phải sự nghi ngờ
 * mà là số học — hai mươi máy cùng học được điều gì đó trong một buổi chiều,
 * và nếu mỗi máy ghi thẳng thì bản cuối cùng thắng, mười chín bản kia biến
 * mất, và không ai biết mình vừa mất gì.
 *
 * Đề xuất thì cộng dồn được, xem lại được, và từ chối được.
 *
 * `baseRevision` là thứ phân biệt "tôi sửa trên bản mới nhất" với "tôi sửa
 * trên một bản đã cũ ba ngày" — và câu trả lời cho hai trường hợp ấy phải khác
 * nhau, nếu không người làm offline sẽ lặng lẽ xoá công của người khác.
 */
export type ProposalState = 'pending' | 'accepted' | 'rejected' | 'superseded';

export interface Proposal {
  id: string;
  orgId: string;
  /** Loại dữ liệu: `elements` cho registry. Cùng tập với `registry_object.kind`. */
  kind: string;
  key: string;
  /** Bản mà người đề xuất DỰA TRÊN. `undefined` khi họ không nói. */
  baseRevision?: string;
  /** Nội dung đề xuất. Với registry đây là cả bản đã sửa, không phải diff. */
  patch: unknown;
  /** Job sinh ra đề xuất này, nếu nó đến từ một lượt chạy. */
  sourceJobId?: string;
  createdBy: string;
  state: ProposalState;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  /** Tóm tắt thay đổi, dựng lúc tạo để màn duyệt không phải tự so. */
  summary?: ProposalSummary;
}

/**
 * Thay đổi gọn trong ba con số và vài cái tên.
 *
 * Dựng LÚC TẠO chứ không lúc xem: người duyệt mở màn hình sau đó vài ngày, và
 * lúc ấy bản gốc đã đổi — so lại khi ấy sẽ cho ra một câu chuyện khác với cái
 * mà người đề xuất nhìn thấy.
 */
export interface ProposalSummary {
  added: string[];
  removed: string[];
  changed: string[];
}

export interface NewProposal {
  orgId: string;
  kind: string;
  key: string;
  baseRevision?: string;
  patch: unknown;
  sourceJobId?: string;
  createdBy: string;
  summary?: ProposalSummary;
}

export interface ProposalStore {
  create(proposal: NewProposal): Promise<Proposal>;
  list(filter?: { state?: ProposalState[] }): Promise<Proposal[]>;
  find(id: string): Promise<Proposal | undefined>;
  /** Duyệt hoặc từ chối. Trả `undefined` khi đề xuất không còn `pending`. */
  decide(
    id: string,
    state: Extract<ProposalState, 'accepted' | 'rejected'>,
    reviewer: string,
    now?: Date,
  ): Promise<Proposal | undefined>;
}

/**
 * So hai bản registry, kể theo element.
 *
 * Không dùng diff văn bản: một lần `JSON.stringify` khác thứ tự khoá sẽ cho ra
 * hàng trăm dòng khác biệt mà không có thay đổi thật nào, và người duyệt sẽ
 * học cách bấm "đồng ý" mà không đọc.
 */
export function summarise(before: unknown, after: unknown): ProposalSummary {
  // Cả `elements` VÀ `screens`. Bỏ `screens` ra ngoài thì một lần đẩy chỉ sửa
  // màn hình sẽ bị tóm tắt thành "không có gì khác" — và route `push` từ chối
  // tạo đề xuất khi tóm tắt rỗng, nên thay đổi ấy biến mất mà người đẩy được
  // báo là thành công. Tên màn hình mang tiền tố để người duyệt phân biệt.
  const left = { ...mapOf(before, 'elements'), ...prefix(mapOf(before, 'screens')) };
  const right = { ...mapOf(after, 'elements'), ...prefix(mapOf(after, 'screens')) };
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const id of Object.keys(right)) {
    if (!(id in left)) added.push(id);
    else if (JSON.stringify(left[id]) !== JSON.stringify(right[id])) changed.push(id);
  }
  for (const id of Object.keys(left)) if (!(id in right)) removed.push(id);

  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
  };
}

function mapOf(value: unknown, field: 'elements' | 'screens'): Record<string, unknown> {
  const map = (value as Record<string, unknown> | undefined)?.[field];
  return map && typeof map === 'object' ? (map as Record<string, unknown>) : {};
}

function prefix(map: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [`screen:${key}`, value]));
}
