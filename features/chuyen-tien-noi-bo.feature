@feature-chuyen-tien-noi-bo
Feature: Chuyển tiền nội bộ

  Background:
    Given I open the app
    And I am logged in as "tcbs"
    And I open feature "Chuyển tiền" from search

  @p0 @smoke @positive
  Scenario: Chuyển tiền thành công từ TK Thường sang TK Ký Quỹ
    When I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    And I enter "1000" into "Số tiền"
    And I click "Nút CHUYỂN"
    Then "Lệnh" shows "Chuyển tiền"
    And "Chuyển từ" shows "Thường"
    And "Chọn TK nhận tiền" shows "Ký Quỹ"
    And "Tiền chuyển (Phí = 0)" shows "1,000"
    When I click "Nút XÁC NHẬN"
    Then "Thông báo" shows "Chuyển tiền thành công"

  @p0 @smoke @positive
  Scenario: Chuyển tiền thành công từ TK Ký Quỹ sang TK Thường
    When I select "TK Ký Quỹ" from "Chuyển từ"
    And I select "TK Thường" from "Chọn TK nhận tiền"
    And I enter "500" into "Số tiền"
    And I click "Nút CHUYỂN"
    Then "Lệnh" shows "Chuyển tiền"
    And "Chuyển từ" shows "Ký Quỹ"
    And "Chọn TK nhận tiền" shows "Thường"
    When I click "Nút XÁC NHẬN"
    Then "Thông báo" shows "Chuyển tiền thành công"

  @p1 @positive
  Scenario: Tiểu khoản đã chọn ở nguồn không xuất hiện ở dropdown đích
    When I select "TK Thường" from "Chuyển từ"
    Then "TK Thường" is not an option in "Chọn TK nhận tiền"

  @p1 @positive
  Scenario: Tiểu khoản đã chọn ở đích không xuất hiện ở dropdown nguồn
    When I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    Then "TK Ký Quỹ" is not an option in "Chuyển từ"

  @p1 @positive
  Scenario: Số tiền được chuyển thay đổi theo tiểu khoản nguồn
    When I select "TK Thường" from "Chuyển từ"
    Then I remember "Được chuyển" as "soTienThuong"
    When I select "TK Ký Quỹ" from "Chuyển từ"
    Then "Được chuyển" changed from "soTienThuong"

  @p1 @negative
  Scenario: Nhập số tiền vượt quá số tiền được chuyển
    When I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    And I enter "999999999" into "Số tiền"
    And I click "Nút CHUYỂN"
    Then "Thông báo" shows "Tiền chuyển + phí vượt quá số tiền có thể chuyển"

  @p1 @positive
  Scenario: Số tiền hợp lệ chuyển sang màn hình xác nhận
    When I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    And I enter "1000" into "Số tiền"
    And I click "Nút CHUYỂN"
    Then "Lệnh" shows "Chuyển tiền"
    And "Chuyển từ" shows "Thường"
    And "Chọn TK nhận tiền" shows "Ký Quỹ"
    And "Tiền chuyển (Phí = 0)" shows "1,000"

  @p1 @positive
  Scenario: Bấm Quay lại từ màn hình xác nhận trở về màn hình Chuyển tiền
    When I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    And I enter "1000" into "Số tiền"
    And I click "Nút CHUYỂN"
    And I click "Nút QUAY LẠI"
    Then "Chuyển từ" is visible
    And "Chọn TK nhận tiền" is visible
    And "Số tiền" is visible

  @p1 @positive
  Scenario: Số tiền được chuyển giảm sau khi chuyển tiền thành công
    When I select "TK Thường" from "Chuyển từ"
    Then I remember "Được chuyển" as "soTienBanDau"
    When I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    And I enter "1000" into "Số tiền"
    And I click "Nút CHUYỂN"
    And I click "Nút XÁC NHẬN"
    Then "Thông báo" shows "Chuyển tiền thành công"
    And "Được chuyển" decreased by "1000" from "soTienBanDau"
