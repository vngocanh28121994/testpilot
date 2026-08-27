import type { ElementDef, ScreenDef } from '../core/types.js';
import type { SourceDoc } from '../ingest/types.js';
import { tagPolicyPrompt } from '../core/tagTaxonomy.js';
import { vocabularyDoc } from '../steps/vocabulary.js';

/**
 * Prompts live in their own file so they can be diffed and reviewed like code.
 * Both generation passes share the same document context, which is what makes
 * prompt caching worth wiring up (see genspec/generate.ts).
 */

export const MODEL_SYSTEM = `Bạn là chuyên gia QA automation. Hãy đọc tài liệu sản phẩm
và chuyển thành mô hình kiểm thử mà máy có thể xử lý.

Quy tắc:
- Chỉ mô tả màn hình, element và luồng được tài liệu nêu rõ. Không tự tạo field,
  button, validation hoặc hành vi không có căn cứ trong nguồn.
- Ưu tiên locator theo accessibility: testId, sau đó role kèm accessible name,
  rồi visible text. CSS và XPath là lựa chọn cuối cùng, có weight thấp.
- Chỉ tạo hai hoặc ba locator candidate cho mỗi nền tảng khi tài liệu thực sự cung
  cấp bằng chứng. Sắp xếp candidate ổn định nhất trước.
- Nếu tài liệu chỉ nêu tên nghiệp vụ nhưng không có bằng chứng locator, vẫn tạo
  element logic và để danh sách candidate của nền tảng đó rỗng. Không tự bịa CSS,
  XPath, testId hoặc accessibility attribute. Playwright/Appium sẽ discovery từ
  giao diện thật khi chạy.
- Element id có dạng "screen.element" theo lowerCamelCase, ví dụ
  "login.submitButton".`;

/**
 * Bộ quy tắc này là bản runtime của skill testpilot-generate-testcases.
 * Khi thay đổi policy coverage, cập nhật đồng thời:
 * skills/testpilot-generate-testcases/references/generation-prompt.md
 */
export const TESTCASE_DESIGN_RULES = `MỤC TIÊU
- Sinh bộ testcase nhỏ nhất nhưng bao phủ mọi quy tắc nghiệp vụ khác biệt có ý nghĩa.
- Kiểm thử hành vi và kết quả quan sát được; không kiểm thử selector hoặc chi tiết triển khai.
- Chỉ dùng thông tin có trong tài liệu. Không tự tạo màn hình, control, validation,
  expected value, vai trò, trạng thái, nhánh hoặc quy tắc.

LẬP COVERAGE MAP NỘI BỘ — KHÔNG XUẤT PHẦN SUY LUẬN NÀY
1. Trích xuất mục tiêu chính, vai trò, điều kiện trước, trạng thái, quy tắc, nhánh,
   nhóm dữ liệu, biên được nêu rõ, lỗi, phục hồi và kết quả quan sát được.
2. Phân loại case:
   P0 = mục tiêu chính hoặc happy path quan trọng.
   P1 = validation, nhánh có ý nghĩa, biến thể quyền/trạng thái, biên, lỗi hoặc phục hồi.
   P2 = giao diện thuần tuý, trùng lặp, chỉ mang tính thông tin hoặc ít rủi ro.
3. Sinh toàn bộ P0/P1 có căn cứ. Chỉ sinh P2 nếu tài liệu ghi đó là tiêu chí nghiệm
   thu hoặc rủi ro regression.
4. Gộp case có cùng luồng và expected result. Dùng Scenario Outline nếu chỉ dữ liệu đổi.
5. Nếu không có expected result quan sát được, không đoán và không sinh case thực thi.

CHỌN TESTCASE
- Có một happy path @smoke cho mỗi mục tiêu nghiệp vụ chính.
- Có một scenario cho mỗi kết quả, quy tắc, nhánh, vai trò hoặc trạng thái khác biệt.
- Có một case đại diện cho mỗi nhóm biên được định nghĩa rõ, không tạo mọi giá trị.
- Một feature tập trung thường có 3–8 scenario; vượt khoảng này nếu có thêm quy tắc
  P0/P1 độc lập.
- Không tạo scenario cho từng câu, field, click hoặc thành phần giao diện.
- Không tự thêm case rỗng, sai định dạng, timeout, permission hoặc network nếu nguồn
  không định nghĩa quy tắc và expected result tương ứng.

VIẾT KỊCH BẢN
- Mọi feature phải có Background với Given I open the app. Đây là bước thiết lập
  runtime bắt buộc trước mọi điều kiện dùng chung như đăng nhập.
- Mỗi scenario phải kết thúc bằng assertion nghiệp vụ quan sát được. Click, wait hoặc
  screenshot thành công chưa chứng minh expected result đúng.
- DỪNG ngay khi quy tắc mà scenario mang tên đã được chứng minh. Đừng thêm bước
  dọn dẹp UI sau assertion: đóng dialog, tắt toast, quay lại màn trước. Những
  bước đó kiểm hành vi khác, không thuộc quy tắc này, và mỗi bước thừa là một
  cách nữa để scenario đỏ vì lý do chẳng liên quan tới điều đang kiểm. Ví dụ có
  thật: "nhập số tiền vượt hạn mức" được chứng minh xong ngay khi thông báo lỗi
  hiện ra — thêm "bấm ĐÓNG" rồi "thông báo không hiển thị" là kiểm nút đóng của
  dialog, một hành vi dùng chung, và chính hai bước đó làm scenario đỏ vĩnh viễn.
  App tự khởi động lại giữa các scenario nên không cần dọn dẹp gì.
- Dùng I am logged in as "<role>" cho điều kiện đăng nhập dùng chung, trừ khi chính
  đăng nhập là hành vi cần kiểm thử.
- Dùng I open feature "<business feature>" from search cho điều hướng dùng chung,
  trừ khi chính tìm kiếm là hành vi cần kiểm thử.
- Dùng I inspect section "<business region>" khi label có thể xuất hiện ở nhiều vùng.
- Không thêm wait nếu assertion tiếp theo đã tự chờ.
- I remember phải đứng TRƯỚC bước rời khỏi màn hình chứa giá trị đó. Ghi nhớ một
  giá trị nền (số dư, tổng, số lượng) chỉ đọc được ở màn hình đang có nó; đặt
  bước remember sau một bước điều hướng là đọc trên màn hình không hề có ô đó và
  kịch bản chết ngay tại chỗ. Ví dụ có thật: "Được chuyển" nằm ở màn Chuyển tiền,
  không có ở màn xác nhận — remember phải nằm trước "Nút CHUYỂN", không phải sau.
- Khi yêu cầu nói một giá trị KHÔNG có trong một danh sách/dropdown, dùng
  "<giá trị>" is not an option in "<dropdown>". TUYỆT ĐỐI không viết thành
  "<giá trị>" is not visible: "không hiển thị" quét cả màn hình, nên nó sai
  ngay cả khi app đúng — giá trị vắng mặt trong dropdown vẫn thường đang hiện ở
  chỗ khác. Ví dụ có thật: "tiểu khoản đã chọn ở nguồn không xuất hiện ở dropdown
  đích" — tiểu khoản đó vẫn hiển thị ở chính ô nguồn, nên "không hiển thị" không
  bao giờ đúng được và kịch bản vĩnh viễn đỏ dù sản phẩm chạy chuẩn.
- KHÔNG ghi cứng một con số mà chính kịch bản làm thay đổi — số dư, tổng, số lượng,
  điểm tích luỹ. Tài liệu ghi "Được chuyển: 8,829" là ảnh chụp tại thời điểm viết,
  không phải quy tắc sản phẩm phải tuân theo: chuyển 1,000 xong thì số đó sai vĩnh
  viễn, và mỗi lần chạy lại sai thêm. Thay bằng cặp bước:
      I remember "<element>" as "<tên>"        (trước khi thao tác)
      "<element>" decreased by "<số>" from "<tên>"   (sau khi thao tác)
  Dùng "is unchanged from" cho trường hợp huỷ/quay lại, khi giá trị phải giữ nguyên.
- Quy tắc dạng "X thay đổi theo Y" phải được chứng minh bằng chính sự thay đổi, không
  phải bằng việc X còn hiển thị. Khẳng định "X is visible" đúng cả khi tính năng hỏng,
  nên nó không chứng minh gì. Viết:
      I remember "X" as "<tên>"      (với Y = giá trị thứ nhất)
      ... đổi Y sang giá trị thứ hai ...
      "X" changed from "<tên>"
  Dùng "changed from" khi tài liệu chỉ nói "thay đổi" mà không nói đổi bao nhiêu —
  lượng thay đổi khi đó là dữ liệu tài khoản, không phải quy tắc sản phẩm.
  Chỉ ghi số tuyệt đối cho thứ kịch bản KHÔNG làm đổi, ví dụ phí cố định hay hạn mức.
- Nếu tài liệu KHÔNG đủ để quyết định một điều gì đó, hãy viết một dòng bắt đầu bằng
  "# HỎI:" ngay phía trên scenario liên quan, thay vì đoán rồi viết một testcase dựa
  trên phỏng đoán. Ví dụ: "# HỎI: Tài liệu không nói hạn mức tối đa mỗi lần chuyển là
  bao nhiêu — cần con số nào để kiểm thử biên?".
  Một testcase dựa trên phỏng đoán trông y hệt một testcase đúng, và sẽ xanh hoặc đỏ
  vì lý do không ai kiểm chứng được. Một câu hỏi thì người đọc trả lời được trong vài
  giây. Chỉ hỏi khi thực sự thiếu thông tin, không hỏi lại thứ tài liệu đã nêu rõ.
- Không thực hiện hành động tài chính không thể hoàn tác; dừng trước bước xác nhận cuối.`;

export const FEATURE_SYSTEM = `Bạn là chuyên gia thiết kế Gherkin nghiệp vụ cho TestPilot.

${TESTCASE_DESIGN_RULES}

QUY TẮC THỰC THI TESTPILOT
- Chỉ dùng controlled vocabulary bên dưới. Step không khớp sẽ bị parser từ chối
  trước khi mở browser hoặc device.
- Tham chiếu element bằng đúng registry id hoặc label trong dấu ngoặc kép.
- Mô tả đối tượng nghiệp vụ, không mô tả loại widget, CSS, XPath, toạ độ hoặc DOM.
- Element logic có thể chưa có locator; Playwright/Appium discovery và healing chịu
  trách nhiệm tìm locator từ giao diện thật.
- Chỉ thêm @web, @android hoặc @ios khi hành vi nghiệp vụ thực sự khác nhau.
- Chỉ dùng placeholder credential; không xuất secret hoặc dữ liệu khách hàng thật.

CONTROLLED VOCABULARY
${vocabularyDoc()}

YÊU CẦU ĐẦU RA
- Chỉ xuất nội dung của đúng một file .feature, bắt đầu bằng Feature:.
- Không xuất giải thích, Markdown fence, selector, coverage map hoặc suy luận ẩn.`;

/** The shared, cacheable half of the prompt: the source documents themselves. */
export function documentContext(docs: SourceDoc[]): string {
  return docs
    .map(
      (d) =>
        `<document kind="${d.kind}" ref="${escapeAttr(d.ref)}" title="${escapeAttr(d.title)}">\n` +
        `${d.text}` +
        (d.visualEvidence
          ? `\n\n<visual_evidence source="ai-vision">\n${d.visualEvidence}\n</visual_evidence>`
          : '') +
        `\n</document>`,
    )
    .join('\n\n');
}

/** Free-text guidance typed into the UI's "Additional Note" box. */
export interface ExtraContext {
  note?: string;
  /** Test accounts, by label. Usernames are shown; passwords never are. */
  accounts?: Array<{ label: string; username: string }>;
  /** What the generated feature should be called, when the user named it. */
  targetFeature?: string;
}

/**
 * The names this project already uses, so the model reuses them.
 *
 * Without this the instruction to "reference elements by their registry id or
 * label" asks for something the model has no way to obey: it has never seen the
 * registry. So each run renames things — "Danh sách gợi ý" becomes "Danh sách
 * gợi ý mã cổ phiếu", "Thêm mã cổ phiếu" becomes "Thêm mã cổ phiếu - Tìm kiếm"
 * — and every new name mints a new element, eventually a new screen, until one
 * label lives on two screens and the feature stops binding altogether.
 *
 * Goes in the user message rather than a system block on purpose: it changes
 * whenever the registry does, and the system prefix is what stays cacheable.
 */
export function knownModelBlock(
  known: { screens: ScreenDef[]; elements: ElementDef[] } | undefined,
): string {
  if (!known || known.screens.length === 0) return '';
  const byScreen = new Map<string, string[]>();
  for (const element of known.elements) {
    // Aliases are shown alongside the label because they are equally valid
    // names. Hiding them would leave the model free to invent a third one for a
    // control that already answers to two.
    const names = [element.label, ...(element.aliases ?? [])]
      .map((name) => `"${name}"`)
      .join(' = ');
    byScreen.set(element.screen, [...(byScreen.get(element.screen) ?? []), names]);
  }
  const lines = known.screens.map((screen) => {
    const labels = (byScreen.get(screen.id) ?? []).join(', ');
    return `- ${screen.id} — "${screen.title}"${labels ? `: ${labels}` : ' (chưa có element)'}`;
  });
  return `

Dự án đã có sẵn các screen và element sau. Nếu thứ bạn mô tả chính là một trong
số này, hãy DÙNG LẠI ĐÚNG id và label đó, đừng đặt tên mới cho cùng một thứ.
Chỉ tạo tên mới khi thật sự là màn hình/element chưa có:

${lines.join('\n')}`;
}

/**
 * Behaviour the application has that no document mentions.
 *
 * Every line here was paid for once by a failing run. Without it the generator
 * rewrites the same scenario the same wrong way each time, and the correction
 * has to be reapplied by hand to a file that regeneration will overwrite again.
 */
export function screenNotesBlock(
  known: { screens: ScreenDef[] } | undefined,
): string {
  const withNotes = (known?.screens ?? []).filter((screen) => screen.notes?.length);
  if (withNotes.length === 0) return '';
  const lines = withNotes.flatMap((screen) => [
    `- ${screen.id} — "${screen.title}":`,
    ...screen.notes!.map((note) => `    • ${note}`),
  ]);
  return `

Các quy tắc hành vi sau đã được xác minh bằng lần chạy thật. Tài liệu KHÔNG nêu
chúng, nhưng kịch bản bỏ qua chúng sẽ chạy sai. Bắt buộc tuân thủ:

${lines.join('\n')}`;
}

/**
 * Tests other features already own.
 *
 * Shown for the same reason the registry is shown: the model cannot avoid a
 * collision it cannot see. Without this, two documents describing one screen
 * each produce their own copy of the shared flow, and the suite runs it twice
 * and reports one fault as two.
 *
 * The feature currently being written is not in this list, so its own scenarios
 * are never presented as somebody else's work.
 */
export function existingScenarioBlock(
  scenarios: ReadonlyArray<{ feature: string; name: string }> | undefined,
): string {
  if (!scenarios?.length) return '';
  const byFeature = new Map<string, string[]>();
  for (const item of scenarios) {
    byFeature.set(item.feature, [...(byFeature.get(item.feature) ?? []), item.name]);
  }
  const lines = [...byFeature].map(([feature, names]) =>
    `- ${feature}:\n${names.map((name) => `    • ${name}`).join('\n')}`);
  return `

Các testcase sau ĐÃ TỒN TẠI ở những feature khác của dự án. Nếu một quy tắc trong
tài liệu đã được một testcase dưới đây kiểm chứng, ĐỪNG viết lại nó — chạy hai lần
cùng một phép kiểm chỉ làm một lỗi bị báo thành hai. Chỉ viết testcase cho phần
tài liệu này thực sự thêm vào:

${lines.join('\n')}`;
}

export function modelTask(
  extra: ExtraContext = {},
  known?: { screens: ScreenDef[]; elements: ElementDef[] },
): string {
  return (
    `Từ các tài liệu trên, hãy tạo mô hình screen và element.

Trường "strategy" CHỈ được nhận đúng một trong bảy giá trị sau, viết y nguyên:
testId, role, label, placeholder, css, xpath, predicate.
Không có "text" — muốn khớp theo chữ hiển thị thì dùng "label".

Với mỗi element, chỉ điền candidate cho nền tảng mà tài liệu có bằng chứng:
- web: testId / role (+name) / label / placeholder
- android: testId (accessibility id or resource-id) / label / role (widget class)
- ios: testId (accessibilityIdentifier) / label / role (XCUIElement type)

Đánh weight 0..1 theo độ ổn định dự kiến. Không có bằng chứng locator thì để mảng
candidate rỗng để runtime discovery xử lý.` + knownModelBlock(known) + noteBlock(extra)
  );
}

export function featureTask(
  elementsSummary: string,
  extra: ExtraContext = {},
  known?: { screens: ScreenDef[]; existingScenarios?: ReadonlyArray<{ feature: string; name: string }> },
): string {
  const focus = extra.targetFeature
    ? `\n\nChức năng cần kiểm thử là "${extra.targetFeature}". Chỉ bao phủ phần tài liệu\nliên quan đến chức năng này.`
    : '';

  return (
    `Hãy viết file Gherkin từ các tài liệu trên.

Đây là các element logic đã trích xuất. Ưu tiên đúng label của chúng. Không thêm
chi tiết triển khai giao diện chỉ để step trông cụ thể hơn:

${elementsSummary}${focus}${accountBlock(extra.accounts)}

Chỉ trả về một file .feature, bắt đầu bằng dòng Feature:.` +
      screenNotesBlock(known) + existingScenarioBlock(known?.existingScenarios)
      + tagPolicyPrompt() + noteBlock(extra)
  );
}

/**
 * Credentials reach the runtime as placeholders, never as literals. A .feature
 * file is committed to git, so a real password written into a step would leak
 * the moment the suite is pushed — and the same suite would stop working the
 * moment the SIT account rotates.
 */
function accountBlock(accounts: ExtraContext['accounts']): string {
  const usable = (accounts ?? []).filter((a) => a.label.trim());
  if (usable.length === 0) return '';

  const rows = usable
    .map((a) => {
      const key = a.label.trim().toLowerCase();
      const who = a.username ? ` (user: ${a.username})` : '';
      return `- ${a.label}${who}: {{account.${key}.username}} / {{account.${key}.password}}`;
    })
    .join('\n');

  return `\n\nCác tài khoản test có thể dùng cho bước đăng nhập. Chỉ viết placeholder, không
viết giá trị thật; runner sẽ thay thế khi thực thi:

${rows}`;
}

function noteBlock(extra: ExtraContext): string {
  const note = extra.note?.trim();
  return note ? `\n\nYêu cầu bổ sung từ người dùng:\n${note}` : '';
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}
