/**
 * Chia sẻ một chiếc máy RIÊNG cho một người cụ thể.
 *
 * Tới đây `visibility` chỉ có hai mức, và hai mức ấy trả lời sai câu hỏi hay
 * gặp nhất. "Riêng" nghĩa là chỉ mình tôi; "chung" nghĩa là cả tổ chức. Còn
 * việc thật thì nằm ở giữa: chiếc iPhone 12 duy nhất của đội đang cắm ở máy
 * tôi, và người đang sửa bug trên iOS 15 cần nó trong hai tiếng. Không có mức
 * giữa thì người ta sẽ chọn "chung" — rồi để nguyên như thế mãi mãi.
 *
 * Nên đây là một bảng quyền riêng chứ không phải một mức thứ ba của
 * `visibility`: cho một người mượn không giống với đổi bản chất chiếc máy, và
 * thứ phải thu lại được thì phải có tên người trong đó.
 *
 * Quyền này chỉ THÊM, không bớt. Nó không lấy được máy ra khỏi tay chủ, và
 * không vượt qua ranh giới tổ chức — xem `maySee`.
 */
export interface DeviceGrant {
  orgId: string;
  udid: string;
  /** Người được mượn. */
  userId: string;
  /** Ai cho mượn — chủ máy, hoặc admin. Câu "vì sao tôi thấy máy này" cần nó. */
  grantedBy: string;
  createdAt: string;
}

export interface DeviceGrants {
  /** Cho mượn. Gọi lại với cùng cặp thì không tạo dòng thứ hai. */
  grant(grant: Omit<DeviceGrant, 'createdAt'>, now?: Date): Promise<DeviceGrant>;
  /** Thu lại. Trả `false` khi vốn không có gì để thu. */
  revoke(orgId: string, udid: string, userId: string): Promise<boolean>;
  /** Những udid mà người này được mượn. Dùng lúc lọc danh sách. */
  forUser(orgId: string, userId: string): Promise<Set<string>>;
  /** Ai đang được mượn chiếc máy này. Dùng lúc chủ máy xem lại. */
  forDevice(orgId: string, udid: string): Promise<DeviceGrant[]>;
}
