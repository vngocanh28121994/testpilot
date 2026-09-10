/**
 * Lệnh dựng tunnel CoreDevice cho iOS 17+.
 *
 * Ở một chỗ vì hai nơi cùng hiện nó — dòng kiểm tra trong PreflightChecks và
 * bước hướng dẫn trong PrereqTools — và một bản chép tay lệch đi thì người dùng
 * chạy nhầm lệnh mà không ai biết. Phải khớp với IOS_TUNNEL_COMMAND bên
 * src/core/preflight.ts.
 */
export const IOS_TUNNEL_COMMAND = 'sudo appium driver run xcuitest tunnel-creation';
