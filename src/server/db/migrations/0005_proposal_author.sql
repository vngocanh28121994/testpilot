-- Ai đề xuất, và thay đổi gồm những gì.
--
-- Bảng ở 0001 ghi được nội dung đề xuất nhưng không ghi được NGƯỜI — và màn
-- duyệt hỏi câu ấy trước mọi câu khác. `reviewed_by` đã có từ đầu; người gửi
-- thì không, vì lúc thiết kế bảng ta còn tưởng mọi đề xuất đều đến từ job.
-- P4.4b thêm `testpilot registry push`, tức là đề xuất do một người gõ tay.
--
-- `summary` dựng lúc TẠO chứ không lúc xem. Người duyệt mở màn hình sau đó vài
-- ngày, và khi ấy bản gốc đã đổi: so lại lúc ấy sẽ kể một câu chuyện khác với
-- cái người đề xuất nhìn thấy, và họ sẽ duyệt một thứ mình không đọc.
ALTER TABLE registry_proposal ADD COLUMN created_by TEXT;
ALTER TABLE registry_proposal ADD COLUMN summary {{json}};
