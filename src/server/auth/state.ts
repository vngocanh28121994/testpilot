/**
 * Phiên đăng nhập của tiến trình này.
 *
 * Một instance duy nhất, tách khỏi nơi dùng: route đăng nhập TẠO phiên, còn
 * cửa quyền ĐỌC phiên, và hai bên phải nhìn vào cùng một kho. Hai bản `new`
 * riêng sẽ cho ra một hệ thống đăng nhập xong vẫn báo chưa đăng nhập — đúng
 * kiểu lỗi mà `OrphanTracker` đã dạy một lần ở P1.
 *
 * Ở P2.4 đây là bảng trong Postgres, và lúc ấy nhiều instance server mới dùng
 * chung được phiên. Bản trong RAM không chia sẻ được, nên một bản triển khai
 * nhiều instance PHẢI đổi chỗ này trước.
 */
import { MemorySessionStore, type SessionStore } from './session.js';

export const sessions: SessionStore = new MemorySessionStore();
