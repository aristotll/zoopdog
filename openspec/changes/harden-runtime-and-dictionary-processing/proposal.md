## Why

Rà soát toàn bộ mã nguồn ngày 2026-10-14 phát hiện các đường xử lý đang làm mất nghĩa từ điển, giữ lại chữ cũ khi trang cập nhật, quét lại DOM quá rộng và gây lỗi khi xử lý đầu vào phát âm rỗng hoặc dài. Bộ kiểm tra hiện tại vẫn đạt, nên cần bổ sung hợp đồng hành vi và kiểm thử hồi quy trước khi sửa các điểm này.

## What Changes

- Bảo toàn toàn bộ nội dung của các bundle nghĩa chỉ trùng một phần; bộ kiểm tra mất dữ liệu phải xác minh độc lập với heuristic gộp.
- Từ chối CSV không đóng dấu nháy trước khi trả dữ liệu có thể được ghi lại.
- Bảo đảm bước minify khi phát hành chạy sau khi hoàn tất build, kể cả khi dùng `make -j`.
- Theo dõi và dọn toàn bộ phần ruby được tạo từ một kết quả nhiều node khi bất kỳ node nguồn nào đổi nội dung.
- Áp dụng cùng quy tắc loại trừ tổ tiên cho text node mới, text mutation và quét ban đầu.
- Thu hẹp hàng đợi mutation về vùng thực sự cần xử lý, vẫn giữ khả năng khôi phục các từ ghép nằm ở các wrapper liền kề.
- Chỉ chấp nhận khóa thuộc chính đối tượng từ điển khi tra popup; tên thuộc prototype phải được coi là không tìm thấy.
- Dùng hợp đồng rỗng thống nhất giữa pronunciation core và giao diện; loại bỏ giá trị HTML sentinel trong kết quả đồng âm.
- Sinh tổ hợp đồng âm không phụ thuộc độ sâu call stack, giữ giới hạn số kết quả và thứ tự hiện tại.

## Capabilities

### New Capabilities

Không có.

### Modified Capabilities

- `dictionary-entry-identity`: làm rõ điều kiện loại bỏ nghĩa là bao phủ đầy đủ, và xác minh bảo toàn nội dung độc lập với quyết định gộp.
- `dictionary-script-toolchain`: thêm yêu cầu CSV lỗi phải thất bại rõ ràng và bảo đảm thứ tự build/minify/publish khi chạy song song.
- `userscript-runtime-performance`: ràng buộc phạm vi quét mutation, tính nhất quán của exclusion và vòng đời của ruby trải nhiều node.
- `popup-dictionary-runtime`: chỉ tra các khóa sở hữu thực trong từ điển được nhúng.
- `pronunciation-engine`: chuẩn hóa kết quả đồng âm rỗng, xử lý ở UI và hỗ trợ văn bản nhiều token mà không tràn stack.

## Impact

- Nguồn: `scripts/lib/dictionary-identity.js`, `scripts/lib/nom-entries-csv.js`, `Makefile`, `scripts/userscript/nom-ruby.runtime.js`, `scripts/userscript/popupdict.runtime.js`, `zd-extension/js/zd-pron-core.js`, `js/zd-pron.js`.
- Kiểm thử: fixtures nghĩa giao một phần, CSV lỗi, thứ tự release có mock, VM DOM mutation, own-key lookup, pronunciation adapter và chuỗi hàng nghìn token.
- Tài liệu: `docs/build.md`, `docs/dictionary-data.md`, `docs/pronunciation-engine.md`; thêm báo cáo bằng chứng `review.md` trong change này.
- Khi triển khai phải dựng lại các userscript và runtime dictionary vào đầu ra gitignored; không sửa tay dữ liệu nguồn Chữ Nôm hoặc thư viện minified.
- Không thay đổi endpoint, payload, hotkey hay giao diện điều khiển local mode. Nếu triển khai cần đổi các hợp đồng đó thì phải mở rộng sang `~/mine/book-translator` theo AGENTS.md.
- Lượt này chỉ tạo review và đề xuất; các task triển khai vẫn chưa đánh dấu hoàn thành.
