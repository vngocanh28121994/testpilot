---
name: testpilot-generate-testcases
description: Đọc tài liệu yêu cầu, ticket, tiêu chí nghiệm thu, tài liệu nghiệp vụ hoặc đặc tả giao diện để sinh hay rà soát Gherkin TestPilot ngắn gọn, bám sát nguồn và bao phủ đủ luồng thành công, trường hợp lỗi, biên, vai trò/trạng thái, nhánh và phục hồi. Dùng khi chuyển tài liệu thành bản nháp testcase TestPilot, cải thiện coverage của testcase do AI sinh, kiểm tra kịch bản có thể thực thi mà không quá chi tiết, hoặc chuẩn bị testcase cho luồng người dùng phê duyệt của TestPilot.
---

# Thiết kế testcase TestPilot

Sinh bộ testcase nhỏ nhất nhưng bao phủ mọi quy tắc nghiệp vụ khác biệt có ý nghĩa. Không đưa selector hoặc chi tiết kỹ thuật giao diện vào Gherkin; registry, Playwright/Appium discovery, healing và các luồng dùng chung của TestPilot chịu trách nhiệm cho phần đó.

Đọc [references/generation-prompt.md](references/generation-prompt.md) trước khi sinh hoặc rà soát testcase. Dùng system prompt trong file này khi cần đưa prompt cho model khác hoặc pipeline sinh testcase từ tài liệu của TestPilot.

## Quy trình

### 1. Đọc đầy đủ nguồn đầu vào

- Đọc toàn bộ tài liệu, ticket, tiêu chí nghiệm thu, bảng, ví dụ và nội dung liên kết nằm trong phạm vi.
- Phân biệt dữ kiện được nêu rõ với giả định.
- Trích xuất mục tiêu nghiệp vụ, vai trò, điều kiện trước, trạng thái, quy tắc, nhánh, nhóm dữ liệu, giá trị biên, lỗi và kết quả quan sát được.
- Không làm lộ mật khẩu, API key, token hoặc dữ liệu khách hàng. Chỉ dùng placeholder như `{{account.tcbs.username}}` và `{{account.tcbs.password}}`.

### 2. Kiểm tra contract hiện tại của TestPilot

Khi làm việc trong repository TestPilot, đọc các file sau trước khi viết Gherkin:

- `src/steps/vocabulary.ts`: vocabulary mà parser đang hỗ trợ.
- `src/steps/scenarioPlan.ts` và `src/steps/normalizer.ts`: cách diễn đạt nghiệp vụ ngắn gọn có thể chuẩn hoá.
- `registry/elements.json` và `registry/actions.json`: tên logic và action dùng chung hiện có.
- Các file liên quan trong `features/`: cách viết luồng dùng chung đã được chấp nhận.

Không sao chép locator vào kịch bản. Ưu tiên đúng label nghiệp vụ đã có. Nếu tài liệu nêu rõ một đối tượng logic mới nhưng chưa có locator, giữ tên nghiệp vụ đó để runtime discovery học locator sau.

### 3. Lập coverage map nội bộ

Trước khi viết scenario, tự phân loại từng quy tắc có ý nghĩa:

- `P0`: mục tiêu chính hoặc happy path quan trọng.
- `P1`: validation, biến thể quyền/trạng thái, nhánh thay thế có ý nghĩa, biên, lỗi hoặc phục hồi được tài liệu mô tả.
- `P2`: giao diện thuần tuý, trùng lặp, ít rủi ro hoặc chỉ mang tính thông tin.

Sinh toàn bộ case P0 và P1 có căn cứ. Chỉ sinh P2 khi tài liệu ghi rõ đó là tiêu chí nghiệm thu hoặc rủi ro regression.

Chọn testcase theo các quy tắc:

- Có một happy path `@smoke` cho mỗi mục tiêu nghiệp vụ chính.
- Có một scenario cho mỗi kết quả, quy tắc, nhánh, vai trò hoặc trạng thái khác biệt có ý nghĩa.
- Có một scenario đại diện cho mỗi nhóm biên được định nghĩa rõ, không sinh cho mọi giá trị.
- Dùng `Scenario Outline` khi chỉ dữ liệu thay đổi còn luồng và kết quả mong đợi giống nhau.
- Gộp các luồng tương đương và bỏ assertion trùng lặp.
- Không tự tạo validation, control, expected value hoặc edge case không có trong nguồn.
- Nếu expected result chưa rõ, không tạo case thực thi; báo đó là coverage gap cho người dùng.

Thông thường một feature tập trung nên có 3–8 scenario. Nếu tài liệu có nhiều quy tắc P0/P1 độc lập thì ưu tiên coverage thay vì giới hạn số lượng.

### 4. Viết Gherkin ở mức nghiệp vụ

- Dùng một `Feature` cho một năng lực nghiệp vụ thống nhất.
- Đặt tên scenario thể hiện hành vi và kết quả mong đợi.
- Giữ điều kiện trước ngắn gọn. Dùng `I am logged in as "<role>"` thay vì lặp lại thao tác nhập tài khoản, trừ khi chính đăng nhập là đối tượng cần kiểm thử.
- Dùng `I open feature "<business feature>" from search` thay vì lặp lại thao tác tìm kiếm ở Homepage, trừ khi chính tìm kiếm là đối tượng cần kiểm thử.
- Dùng `I inspect section "<business region>"` để giữ đúng phạm vi khi cùng một label xuất hiện ở nhiều vùng.
- Mô tả ý định nghiệp vụ, ví dụ `I click "Phái sinh"`; không mô tả XPath, vị trí hoặc loại widget.
- Kết thúc mỗi scenario bằng một assertion nghiệp vụ quan sát được. Click, wait hoặc screenshot thành công chưa chứng minh kết quả đúng.
- Không thêm wait nếu assertion tiếp theo đã tự chờ. Chỉ dùng wait cho chuyển trạng thái bất đồng bộ có ý nghĩa.
- Không kiểm tra style, layout, animation hoặc câu chữ nếu tài liệu không coi đó là yêu cầu.
- Không thực hiện hành động tài chính không thể hoàn tác. Dừng ở trạng thái nháp hoặc trước xác nhận, trừ khi có môi trường test an toàn và người dùng cho phép rõ ràng.

### 5. Giữ kịch bản dùng chung đa nền tảng

- Không thêm tag nền tảng nếu hành vi nghiệp vụ giống nhau trên web, Android và iOS.
- Chỉ thêm `@web`, `@android` hoặc `@ios` khi có khác biệt nghiệp vụ thật sự.
- Không đưa khác biệt selector theo nền tảng vào Gherkin.

### 6. Kiểm tra trước khi bàn giao

- Chuẩn hoá cách diễn đạt tự nhiên bằng normalizer của repository.
- Bind bằng vocabulary và registry hiện tại trước khi mở browser hoặc device.
- Chặn step sai hoặc không bind được ngay ở giai đoạn sinh testcase.
- Xác nhận mỗi scenario có mục đích riêng, có căn cứ từ nguồn và có kết quả quan sát được.
- Giữ scenario được sinh ở trạng thái `pending`. Không tự duyệt thay người dùng.
- Trả về tóm tắt coverage ngắn và danh sách điểm chưa rõ tách khỏi nội dung `.feature`.

## Kết quả cần trả về

Khi được yêu cầu tạo file, sinh:

1. Bản nháp `.feature` hợp lệ với vocabulary TestPilot hiện tại.
2. Tóm tắt ngắn các quy tắc đã bao phủ và coverage gap còn lại.

Không đưa selector, suy luận ẩn của model, secret hoặc yêu cầu tự suy diễn vào kết quả.
