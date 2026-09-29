@feature-dang-nhap-tcinvest
Feature: Đăng nhập TCInvest

  Background:
    Given I open the app

  @p0 @smoke @positive
  Scenario: Đăng nhập thành công chuyển sang màn Trang chủ
    Given I wait for "Ô tên đăng nhập"
    When I enter "{{account.tcbs.username}}" into "Ô tên đăng nhập"
    And I enter "{{account.tcbs.password}}" into "Ô mật khẩu"
    And I click "Nút đăng nhập"
    Then "Tổng tài sản" is visible

  @p1 @negative
  Scenario: Bỏ trống tên đăng nhập thì hiện lỗi
    Given I wait for "Ô tên đăng nhập"
    When I enter "{{account.tcbs.password}}" into "Ô mật khẩu"
    And I click "Nút đăng nhập"
    Then "Thông báo lỗi đăng nhập" shows "Vui lòng nhập tên đăng nhập"

  @p1 @boundary
  Scenario: Mật khẩu ngắn hơn 8 ký tự thì hiện lỗi
    Given I wait for "Ô tên đăng nhập"
    When I enter "{{account.tcbs.username}}" into "Ô tên đăng nhập"
    And I enter "1234567" into "Ô mật khẩu"
    And I click "Nút đăng nhập"
    Then "Thông báo lỗi đăng nhập" shows "Mật khẩu phải có ít nhất 8 ký tự"

  @p1 @negative
  Scenario: Sai thông tin đăng nhập thì hiện lỗi và xoá trắng mật khẩu
    Given I wait for "Ô tên đăng nhập"
    When I enter "{{account.tcbs.username}}" into "Ô tên đăng nhập"
    And I enter "sai-mat-khau-123" into "Ô mật khẩu"
    And I click "Nút đăng nhập"
    Then "Thông báo lỗi đăng nhập" shows "Tên đăng nhập hoặc mật khẩu không đúng"
    And "Ô tên đăng nhập" shows "{{account.tcbs.username}}"
    And "Ô mật khẩu" does not show "{{account.tcbs.username}}"

  @p1 @business-rule
  Scenario: Sai 5 lần liên tiếp thì khoá tài khoản 30 phút
    Given I wait for "Ô tên đăng nhập"
    When I enter "{{account.tcbs.username}}" into "Ô tên đăng nhập"
    And I enter "sai-mat-khau-123" into "Ô mật khẩu"
    And I click "Nút đăng nhập"
    And I enter "sai-mat-khau-123" into "Ô mật khẩu"
    And I click "Nút đăng nhập"
    And I enter "sai-mat-khau-123" into "Ô mật khẩu"
    And I click "Nút đăng nhập"
    And I enter "sai-mat-khau-123" into "Ô mật khẩu"
    And I click "Nút đăng nhập"
    And I enter "sai-mat-khau-123" into "Ô mật khẩu"
    And I click "Nút đăng nhập"
    Then "Thông báo lỗi đăng nhập" shows "Tài khoản tạm thời bị khoá. Vui lòng thử lại sau 30 phút"

  @p1 @positive
  Scenario: Trang chủ hiển thị lời chào tên nhà đầu tư
    Given I am logged in as "tcbs"
    Then "Tổng tài sản" is visible
    And "Xin chào" is visible

  @p1 @business-rule
  Scenario: Bấm Đăng xuất hiện hộp thoại xác nhận
    Given I am logged in as "tcbs"
    When I click "Nút Đăng xuất"
    Then "Hộp thoại xác nhận đăng xuất" is visible
    And "Nút Huỷ trong hộp thoại đăng xuất" is visible

  @p0 @smoke @positive
  Scenario: Xác nhận đăng xuất quay về màn hình Đăng nhập
    Given I am logged in as "tcbs"
    When I click "Nút Đăng xuất"
    And I click "Đồng ý"
    Then "Ô tên đăng nhập" is visible
    And "Nút đăng nhập" is visible
