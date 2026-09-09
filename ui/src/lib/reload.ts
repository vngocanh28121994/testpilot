/**
 * Tải lại trang, qua đúng một cửa.
 *
 * Gọi thẳng `window.location.reload()` trong component thì không test được:
 * jsdom đánh dấu `reload` là non-configurable, còn thay cả `window.location`
 * bằng object khác thì router mất những thứ nó đọc từ đó và test vỡ vì lý do
 * chẳng liên quan tới thứ đang kiểm tra.
 */
export function reloadPage(): void {
  window.location.reload();
}
