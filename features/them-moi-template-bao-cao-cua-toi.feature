@feature-them-moi-template-bao-cao-cua-toi
Feature: Thêm mới template Báo cáo của tôi

  Background:
    Given I open the app
    And I am logged in as "tcbs"
    And I open feature "Báo cáo của tôi" from search

  @p0 @smoke @positive
  Scenario: Thêm mới template báo cáo thành công
    When I click "Nút thêm mới báo cáo"
    And I select "Cá nhân" from "Chọn loại nội dung hiển thị"
    And I click "Nút TIẾP TỤC"
    And I click "Nút nổi thêm thẻ"
    And I click "Thẻ Lợi nhuận theo tháng"
    And I click "Nút đóng popup Thêm thẻ"
    And I click "Nút Lưu"
    And I enter "Template test" into "Tên của thiết kế"
    And I click "Nút LƯU trong popup"
    Then "Mục báo cáo trong danh sách" shows "Template test"
    And "Thông báo" shows "Lưu mẫu thành công"

  @p0 @smoke @positive
  Scenario: Mở chức năng Thêm mới từ nút thêm mới báo cáo
    When I click "Nút thêm mới báo cáo"
    Then "Chọn loại nội dung hiển thị" is visible

  @p0 @smoke @positive
  Scenario: Chọn loại báo cáo Cá nhân và bấm Tiếp tục mở màn hình thêm mới
    When I click "Nút thêm mới báo cáo"
    And I select "Cá nhân" from "Chọn loại nội dung hiển thị"
    And I click "Nút TIẾP TỤC"
    Then "Tiêu đề Báo cáo mẫu chưa có tên" is visible

  @p0 @smoke @positive
  Scenario: Chọn loại báo cáo Doanh nghiệp và thị trường và bấm Tiếp tục mở màn hình thêm mới
    When I click "Nút thêm mới báo cáo"
    And I click "Khung lựa chọn Doanh nghiệp và thị trường"
    And I click "Nút TIẾP TỤC"
    Then "Khung cảnh báo hỗ trợ trên điện thoại" is visible

  @p1 @business-rule
  Scenario: Mỗi loại báo cáo mở ra màn hình thêm mới có giao diện khác nhau
    When I click "Nút thêm mới báo cáo"
    And I select "Cá nhân" from "Chọn loại nội dung hiển thị"
    And I click "Nút TIẾP TỤC"
    Then "Hình ảnh minh họa trạng thái trống" is visible
    And "Khung cảnh báo hỗ trợ trên điện thoại" is not visible

  @p1 @positive
  Scenario: Màn hình Thêm mới hiển thị empty state khi chưa thêm thẻ
    When I click "Nút thêm mới báo cáo"
    And I select "Cá nhân" from "Chọn loại nội dung hiển thị"
    And I click "Nút TIẾP TỤC"
    Then "Hình ảnh minh họa trạng thái trống" is visible
    And "Thẻ nội dung trong báo cáo" count is equal to "0"

  @p0 @smoke @positive
  Scenario: Bấm nút thêm thẻ mở màn hình chọn thẻ
    When I click "Nút thêm mới báo cáo"
    And I select "Cá nhân" from "Chọn loại nội dung hiển thị"
    And I click "Nút TIẾP TỤC"
    And I click "Nút nổi thêm thẻ"
    Then "Thẻ Lợi nhuận theo tháng" is visible
    And "Thẻ Thống kê giao dịch CP" is visible
    And "Thẻ Tài sản" is visible

  @p1 @business-rule
  Scenario: Mặc định không chọn thẻ nào khi mở màn hình chọn thẻ
    When I click "Nút thêm mới báo cáo"
    And I select "Cá nhân" from "Chọn loại nội dung hiển thị"
    And I click "Nút TIẾP TỤC"
    And I click "Nút nổi thêm thẻ"
    And I click "Nút đóng popup Thêm thẻ"
    Then "Thẻ nội dung trong báo cáo" count is equal to "0"

  @p1 @business-rule
  Scenario: Bấm thẻ lần thứ hai bỏ chọn thẻ
    When I click "Nút thêm mới báo cáo"
    And I select "Cá nhân" from "Chọn loại nội dung hiển thị"
    And I click "Nút TIẾP TỤC"
    And I click "Nút nổi thêm thẻ"
    And I click "Thẻ Lợi nhuận theo tháng"
    And I click "Thẻ Lợi nhuận theo tháng"
    And I click "Nút đóng popup Thêm thẻ"
    Then "Thẻ nội dung trong báo cáo" count is equal to "0"

  @p1 @positive
  Scenario: Các thẻ đã chọn hiển thị trên màn hình Thêm mới sau khi quay lại
    When I click "Nút thêm mới báo cáo"
    And I select "Cá nhân" from "Chọn loại nội dung hiển thị"
    And I click "Nút TIẾP TỤC"
    And I click "Nút nổi thêm thẻ"
    And I click "Thẻ Lợi nhuận theo tháng"
    And I click "Nút đóng popup Thêm thẻ"
    Then "Thẻ nội dung trong báo cáo" count is equal to "1"

  @p1 @business-rule
  Scenario: Không chọn thẻ nào thì màn hình Thêm mới vẫn ở trạng thái empty state
    When I click "Nút thêm mới báo cáo"
    And I select "Cá nhân" from "Chọn loại nội dung hiển thị"
    And I click "Nút TIẾP TỤC"
    And I click "Nút nổi thêm thẻ"
    And I click "Nút đóng popup Thêm thẻ"
    Then "Hình ảnh minh họa trạng thái trống" is visible
    And "Thẻ nội dung trong báo cáo" count is equal to "0"

  @p1 @business-rule
  Scenario: Nút Lưu disable khi không có thẻ nào được chọn
    When I click "Nút thêm mới báo cáo"
    And I select "Cá nhân" from "Chọn loại nội dung hiển thị"
    And I click "Nút TIẾP TỤC"
    Then "Nút Lưu" is not visible

  @p1 @business-rule
  Scenario: Nút Lưu enable khi có thẻ được chọn
    When I click "Nút thêm mới báo cáo"
    And I select "Cá nhân" from "Chọn loại nội dung hiển thị"
    And I click "Nút TIẾP TỤC"
    And I click "Nút nổi thêm thẻ"
    And I click "Thẻ Lợi nhuận theo tháng"
    And I click "Nút đóng popup Thêm thẻ"
    Then "Nút Lưu" is visible

  @p0 @smoke @positive
  Scenario: Bấm Lưu mở popup nhập tên template
    When I click "Nút thêm mới báo cáo"
    And I select "Cá nhân" from "Chọn loại nội dung hiển thị"
    And I click "Nút TIẾP TỤC"
    And I click "Nút nổi thêm thẻ"
    And I click "Thẻ Lợi nhuận theo tháng"
    And I click "Nút đóng popup Thêm thẻ"
    And I click "Nút Lưu"
    Then "Tên của thiết kế" is visible
    And "Nút LƯU trong popup" is visible
