-- Câu lỗi gần nhất của một job, ngay trên dòng job.
--
-- `result` đã mang `JobResult`, nhưng nó chỉ tồn tại khi job ĐÃ ĐÓNG. Một job
-- bị trả về hàng đợi thì chưa đóng — nó sắp được máy khác nhận — mà lý do lần
-- trước hỏng vẫn phải còn: nếu lần sau cũng hỏng, người đọc cần thấy cả hai.
--
-- Nhét vào `payload` thì rẻ hơn một cột, và sai: `payload` là JobSpec, tức là
-- thứ runner nhận. Trộn sổ sách của server vào đó nghĩa là mỗi lần đọc spec
-- phải nhớ bỏ qua vài trường không thuộc về nó.
ALTER TABLE job ADD COLUMN error TEXT;
