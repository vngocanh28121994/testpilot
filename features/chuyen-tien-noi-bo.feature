@feature-chuyen-tien-noi-bo
Feature: Chuyển tiền nội bộ

  Background:
    Given I open the app
    And I am logged in as "tcbs"
    And I open feature "Chuyển tiền" from search

  @p0 @smoke @positive
  Scenario: Chuyển tiền từ tài khoản Thường sang Ký Quỹ thành công
    Given I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    And I remember "Được chuyển" as "availableBefore"
    When I enter "1,000" into "Số tiền"
    And I click "Nút CHUYỂN"
    Then "Lệnh" shows "Chuyển tiền"
    And "Chuyển từ" shows "Thường"
    And "Tiền chuyển (Phí = 0)" shows "1,000"
    When I click "Nút XÁC NHẬN"
    Then "Thông báo" shows "Chuyển tiền thành công"
    And "Được chuyển" decreased by "1,000" from "availableBefore"

  @p0 @smoke @positive
  Scenario: Chuyển tiền từ tài khoản Ký Quỹ sang Thường thành công
    Given I select "TK Ký Quỹ" from "Chuyển từ"
    And I select "TK Thường" from "Chọn TK nhận tiền"
    And I remember "Được chuyển" as "availableBefore"
    When I enter "500" into "Số tiền"
    And I click "Nút CHUYỂN"
    Then "Lệnh" shows "Chuyển tiền"
    And "Chuyển từ" shows "Ký Quỹ"
    And "Tiền chuyển (Phí = 0)" shows "500"
    When I click "Nút XÁC NHẬN"
    Then "Thông báo" shows "Chuyển tiền thành công"
    And "Được chuyển" decreased by "500" from "availableBefore"

  @p1 @positive
  Scenario: Chọn tiểu khoản nguồn và đích từ dropdown
    When I select "TK Thường" from "Chuyển từ"
    Then "Chuyển từ" shows "TK Thường"
    When I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    Then "Chọn TK nhận tiền" shows "TK Ký Quỹ"

  @p1 @positive
  Scenario: Tiểu khoản đã chọn ở nguồn không xuất hiện ở dropdown đích
    Given I select "TK Thường" from "Chuyển từ"
    When I click "Chọn TK nhận tiền"
    Then "TK Thường" is not visible

  @p1 @positive
  Scenario: Tiểu khoản đã chọn ở đích không xuất hiện ở dropdown nguồn
    Given I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    When I click "Chuyển từ"
    Then "TK Ký Quỹ" is not visible

  @p1 @positive
  Scenario: Số tiền được chuyển thay đổi theo tiểu khoản nguồn
    Given I select "TK Thường" from "Chuyển từ"
    And I remember "Được chuyển" as "availableNormal"
    When I select "TK Ký Quỹ" from "Chuyển từ"
    Then "Được chuyển" changed from "availableNormal"

  @p1 @negative
  Scenario: Nhập số tiền vượt quá số tiền được chuyển
    Given I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    When I enter "999999999" into "Số tiền"
    And I click "Nút CHUYỂN"
    Then "Thông báo" shows "Tiền chuyển + phí vượt quá số tiền có thể chuyển"
    When I click "Nút ĐÓNG"
    Then "Thông báo" is not visible

  @p1 @positive
  Scenario: Nhập số tiền hợp lệ chuyển sang màn xác nhận
    Given I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    When I enter "1,000" into "Số tiền"
    And I click "Nút CHUYỂN"
    Then "Lệnh" shows "Chuyển tiền"
    And "Chuyển từ" shows "Thường"
    And "Chọn TK nhận tiền" shows "Ký Quỹ"
    And "Tiền chuyển (Phí = 0)" shows "1,000"

  @p1 @positive
  Scenario: Quay lại từ màn xác nhận trở về màn hình Chuyển tiền
    Given I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    And I enter "1,000" into "Số tiền"
    And I click "Nút CHUYỂN"
    And I remember "Được chuyển" as "availableBefore"
    When I click "Nút QUAY LẠI"
    Then "Được chuyển" is unchanged from "availableBefore"
    And "Số tiền" is visible
