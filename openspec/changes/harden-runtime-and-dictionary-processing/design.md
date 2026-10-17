## Context

Báo cáo [review.md](review.md) ghi chín phát hiện từ source hiện tại, được tái hiện bằng API builder thật, VM dùng DOM harness hiện có và Makefile với NODE mock. Baseline `make verify` đạt 344 test, bỏ qua 1 audit tùy chọn; các kết quả đó chưa chứng minh các đường lỗi trong báo cáo.

Repo dùng JavaScript thuần và theo dõi source riêng với artifact sinh ra. Dữ liệu Chữ Nôm đang được sửa đồng thời; quá trình triển khai phải dùng fixture hoặc đầu ra tạm để tránh ghi đè dữ liệu sống.

## Goals / Non-Goals

**Goals:**

- Giữ nghĩa và nội dung trang khi gộp dữ liệu hoặc chú giải trên trang động.
- Giảm lượng công việc của mutation nhỏ theo phạm vi thay đổi.
- Đưa exclusion, ownership, coverage và kết quả rỗng thành các quy tắc dùng chung có thể kiểm thử.
- Bảo đảm build phát hành có thứ tự đúng, và parser không trả thành công với CSV lỗi.
- Giữ thứ tự kết quả, định dạng dữ liệu công khai và tính tương thích của các trường hợp hợp lệ hiện tại.

**Non-Goals:**

- Thay framework, thêm runtime dependency, viết lại matcher hoặc làm sạch toàn bộ dữ liệu.
- Thay endpoint, payload, hotkey hoặc UI local mode.
- Phát hành userscript, tự động archive change, hoặc triển khai sửa lỗi trong lượt tạo đề xuất này.
- Sửa các quy tắc ngữ âm khác như cách đọc số 1500 đang có fixture characterization riêng.

## Decisions

### 1. Phân biệt giao nghĩa với bao phủ có hướng (R1)

Giữ tokenizer và các phép so sánh chuẩn hóa ở thư viện chung. Tách quyết định `candidate` được `host` bao phủ hoàn toàn khỏi tín hiệu hai nghĩa có liên quan. Chỉ bỏ một nghĩa khi mọi token của nghĩa đó có đại diện trong kết quả cuối theo các phép tương đương được chấp nhận, đồng thời bảo toàn POS và liên kết headword. Khi chỉ có giao một phần, giữ cả hai nghĩa theo thứ tự ổn định; chưa cần dựng một câu gloss mới.

`verifyLossless` phải kiểm tra từng phần nội dung nguồn và metadata sau cùng, không dùng lại boolean “có giao nhau” đã cho phép xóa nghĩa. Có thể dùng chung tokenizer/phép tương đương nhỏ; logic lượng hóa đầy đủ của validator phải độc lập với việc chọn winner. Các fixture cố tình thiếu một token phải khiến validator thất bại.

Giữ cả hai bundle an toàn và ít thay đổi hơn ghép lại câu tiếng Anh tự động. Chấp nhận đầu ra lớn hơn khi nguồn thực sự chứa nội dung khác nhau.

### 2. Parser CSV thất bại trước khi trả dữ liệu (R3)

Dùng state machine hiện tại, bổ sung trạng thái đầu field/sau quote và vị trí dòng/cột. EOF trong quote, quote sai vị trí, ký tự không hợp lệ sau quote đóng và số cột khác ba phải ném lỗi. Vẫn hỗ trợ escaped quotes, newline trong quoted field, CRLF và Unicode đúng như codec công bố. Loader bổ sung đường dẫn shard vào lỗi.

Không “sửa” CSV bằng cách đoán dấu quote. Các lệnh ghi/upsert phải parse và validate toàn bộ dữ liệu cần đọc trước khi xuất bản; test phải xác nhận không có write khi lỗi.

### 3. Biểu diễn thứ tự release tại Makefile (R4)

Giữ các bước build độc lập có thể chạy song song. Chuyển minify vào recipe của release, chạy sau khi mọi prerequisite build thành công, rồi mới gọi publisher. Target minify độc lập tiếp tục dùng được như hiện tại.

Test chạy Makefile thật trong cây fixture với NODE mock; dùng các sự kiện start/end có thứ tự, không dựa vào mốc thời gian tuyệt đối hay gọi GitHub. Trường hợp build lỗi phải không gọi minify/publisher.

### 4. Ownership theo toàn bộ span nhiều node (R2)

Tạo một bản ghi annotation chứa mọi source segment, nội dung trước khi tách và các node ruby/tail mà runtime sở hữu. Mọi source node tham gia span đều trỏ về bản ghi qua WeakMap; dùng chung hàm ghi nhận insertion giữa đường một node và nhiều node.

Khi bất kỳ source node nào bị trang viết lại, hủy annotation cũ cho cả span, xóa đúng node runtime đã chèn và khôi phục phần nguồn chưa bị trang thay đổi. Nội dung mới của trang có ưu tiên; không ghép snapshot cũ vào node đã đổi, không tái tạo node mà trang đã tháo bỏ. Sau đó quét lại vùng dirty cần thiết. Đoạn nguồn giữ nguyên khi có nhiều kết quả cùng node cũng cần fixture để tránh dọn nhầm kết quả khác.

Chỉ thêm bookkeeping cho node đầu như hiện tại không biểu diễn được ownership của các đoạn sau; cleanup riêng một ruby cũng không đủ để loại bỏ phiên âm cũ của cả cụm từ.

### 5. Một chính sách eligibility cho mọi đường vào (R5)

Đặt kiểm tra text node có tổ tiên bị loại trừ ở một helper dùng bởi initial traversal, queued subtree và direct characterData. Kiểm tra lại eligibility lúc flush vì trang có thể chuyển node sang editor sau khi queue. Với shadow root, dùng chính sách ranh giới đã có, không mở rộng sang closed shadow root.

Không dựa vào việc traversal đã kiểm tra tổ tiên trước đó: characterData bắt đầu trực tiếp từ text node và bỏ qua traversal đó.

### 6. Mutation queue theo vùng thay đổi có giới hạn (R6)

Queue added nodes đủ điều kiện và vùng nối inline sát điểm thay đổi. Removal hoặc thay đổi có thể ảnh hưởng một span cũ phải reconcile ownership liên quan, thay vì mặc định queue toàn bộ target. Deduplicate các root có quan hệ tổ tiên trước flush, và tiếp tục bỏ qua mutation do chính runtime tạo.

Khả năng “recover missed first line” phải được giữ bằng reconciliation của line/container liên quan với giới hạn traversal rõ ràng và fixture riêng. Chỉ xóa dòng queue target sẽ làm mất hành vi hiện có; tiếp tục quét body chỉ đổi scheduling chứ chưa giảm lượng công việc.

Dùng counter số text node được phân tích làm gate. Thêm div rỗng hoặc một leaf vào body lớn không được phân tích lại mọi paragraph cũ; không dùng ngưỡng timing dễ nhiễu làm tiêu chí duy nhất.

### 7. Popup chỉ nhận own keys (R7)

Đặt own-property check tại lookup trước khi đọc dictionary. Dùng `Object.prototype.hasOwnProperty.call` hoặc cách tương đương phù hợp runtime hiện tại; không đổi định dạng JSON được nhúng. Fixture phải qua JSON.parse để có cùng prototype với bản build, và phải phân biệt khóa vắng mặt với khóa `constructor` thực sự được định nghĩa.

### 8. Hợp đồng rỗng thuộc core, rendering thuộc adapter (R8)

`getMultiWordHomophones` trả mảng rỗng cho mỗi dialect khi đầu vào rỗng/whitespace-only. Giữ contract array-or-count cho đầu vào khác; core không trả `&nbsp;`. `pronounceMe` kiểm tra status/kết quả rỗng trước tách paragraph và dùng placeholder tại adapter. Cả hai trang phải xử lý khoảng trắng, tab và newline rồi tiếp tục xử lý văn bản hợp lệ.

Test core hiện chỉ bao phủ pronunciationGuide rỗng. Thêm VM adapter test để chạy source `js/zd-pron.js` thật và bắt lỗi render, không chỉ snapshot core.

### 9. Tích Descartes đồng âm dùng vòng lặp (R9)

Thay đệ quy theo số token bằng bộ đếm chỉ số/iterator giữ cùng thứ tự tổ hợp; chỉ join chuỗi khi tạo một kết quả hoàn chỉnh. Vẫn tính số khả năng trước khi materialize và giữ hành vi giới hạn hiện có. Không thay bằng spread/concat lớn có thể chạm giới hạn đối số.

Một chuỗi 4.000 token singleton chỉ có một tổ hợp, nên giới hạn 10.000 kết quả không bảo vệ khỏi tràn stack hiện tại. Fixture dài kiểm tra kết quả hoàn chỉnh và không RangeError; fixture nhỏ so sánh thứ tự với baseline. Không dùng việc tăng stack hoặc cắt bớt input để che lỗi.

## Risks / Trade-offs

- Giữ thêm nghĩa làm artifact lớn hơn → đo byte/kích thước và review diff nội dung; chỉ gộp khi chứng minh bao phủ.
- Validator dùng chung heuristic sai có thể tiếp tục bỏ sót mất nghĩa → test trực tiếp output bị cố ý xóa token, POS và headword.
- Cleanup nhiều node có thể hồi sinh nội dung trang đã xóa → ownership chỉ quản lý node còn thuộc span; ưu tiên DOM mới và fixture removal/replacement.
- Queue quá hẹp làm mất từ ghép hoặc dòng đến muộn → giữ các regression cross-wrapper, shadow root và missed-first-line cùng counter kiểm tra phạm vi.
- Parser chặt hơn có thể phát hiện shard vốn đã lỗi → chỉ báo vị trí; không tự sửa dữ liệu người dùng.
- Văn bản rất lớn vẫn tốn thời gian tạo đầu ra → giới hạn số tổ hợp hiện có vẫn áp dụng; thay đổi này chỉ loại bỏ phụ thuộc stack và việc quét DOM không cần thiết.
- Các test đọc dữ liệu sống có thể thay đổi khi session khác đang sửa → fixture xác định là gate chính, audit dữ liệu thật được ghi nhận riêng.

## Migration Plan

1. Thêm các regression tương ứng R1–R9 trong fixture/VM/temp tree, xác nhận thất bại đúng lý do.
2. Triển khai từng nhóm nhỏ: data/CSV, release, runtime ownership/eligibility/queue, pronunciation và popup lookup; chạy suite liên quan sau mỗi nhóm.
3. Dựng lại userscript và runtime dictionary ở đầu ra tạm hoặc gitignored; so sánh nội dung trước/sau trên cùng snapshot nguồn. Các khác biệt dữ liệu phải truy về nghĩa được giữ lại.
4. Chạy `make verify`, OpenSpec validation và lifecycle check; kiểm tra thủ công trang phát âm, đồng âm, popup và widget cập nhật text.
5. Chỉ phát hành sau bước triển khai riêng được yêu cầu. Rollback bằng source và build đã biết tương ứng, không discard shard dữ liệu sống.

## Open Questions

Không có quyết định nào cần chờ người dùng để bắt đầu. Giới hạn traversal cụ thể của vùng nối phải được chọn trong triển khai từ fixture hiện tại và kiểm tra counter; báo cáo không coi một con số tùy ý là bằng chứng hiệu năng.
