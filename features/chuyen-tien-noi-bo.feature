@feature-chuyen-tien-noi-bo
Feature: Chuyển tiền nội bộ

  Background:
    Given I open the app
    And I am logged in as "tcbs"
    And I open feature "Chuyển tiền" from search

  @p0 @smoke @positive
  Scenario: Chuyển tiền thành công từ tiểu khoản Thường sang Ký Quỹ
    When I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    And I enter "1000" into "Số tiền"
    And I click "Nút CHUYỂN"
    And I click "Nút XÁC NHẬN"
    Then "Thông báo" shows "Chuyển tiền thành công"

  @p0 @smoke @positive
  Scenario: Chuyển tiền thành công từ tiểu khoản Ký Quỹ sang Thường
    When I select "TK Ký Quỹ" from "Chuyển từ"
    And I select "TK Thường" from "Chọn TK nhận tiền"
    And I enter "1000" into "Số tiền"
    And I click "Nút CHUYỂN"
    And I click "Nút XÁC NHẬN"
    Then "Thông báo" shows "Chuyển tiền thành công"

  @p0 @smoke @positive
  Scenario: Chọn tiểu khoản nguồn và tiểu khoản đích thành công
    When I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    Then "Chuyển từ" shows "TK Thường"
    And "Chọn TK nhận tiền" shows "TK Ký Quỹ"

  @p1 @business-rule
  Scenario: Tiểu khoản đã chọn ở nguồn không xuất hiện ở dropdown đích
    When I select "TK Thường" from "Chuyển từ"
    Then "TK Thường" is not an option in "Chọn TK nhận tiền"

  @p1 @business-rule
  Scenario: Tiểu khoản đã chọn ở đích không xuất hiện ở dropdown nguồn
    When I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    Then "TK Ký Quỹ" is not an option in "Chuyển từ"

  @p1 @business-rule
  Scenario: Số tiền được chuyển thay đổi theo tiểu khoản nguồn được chọn
    When I select "TK Thường" from "Chuyển từ"
    And I remember "Được chuyển" as "soTienNguonThuong"
    And I select "TK Ký Quỹ" from "Chuyển từ"
    Then "Được chuyển" changed from "soTienNguonThuong"

  @p1 @negative
  Scenario: Nhập số tiền vượt quá số tiền được chuyển thì không cho chuyển
    When I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    And I remember "Được chuyển" as "soTienCoTheChuyen"
    And I enter "999999999" into "Số tiền"
    And I click "Nút CHUYỂN"
    Then "Thông báo" shows "Tiền chuyển + phí vượt quá số tiền có thể chuyển"

  @p1 @positive
  Scenario: Số tiền hợp lệ thì chuyển sang màn hình xác nhận
    When I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    And I enter "1000" into "Số tiền"
    And I click "Nút CHUYỂN"
    Then "Lệnh" shows "Chuyển tiền"
    And "Chuyển từ" shows "Thường"
    And "Chọn TK nhận tiền" shows "Ký Quỹ"
    And "Tiền chuyển (Phí = 0)" shows "1,000"

  @p1 @positive
  Scenario: Bấm Quay lại thì trở lại màn hình Chuyển tiền
    When I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    And I enter "1000" into "Số tiền"
    And I click "Nút CHUYỂN"
    And I click "Nút QUAY LẠI"
    Then "Nút CHUYỂN" is visible

  @p1 @business-rule
  Scenario: Sau khi chuyển thành công số tiền được chuyển cập nhật theo số tiền vừa chuyển
    When I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    And I remember "Được chuyển" as "soTienTruocChuyen"
    And I enter "1000" into "Số tiền"
    And I click "Nút CHUYỂN"
    And I click "Nút XÁC NHẬN"
    Then "Được chuyển" decreased by "1000" from "soTienTruocChuyen"
