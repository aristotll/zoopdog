## 1. Bảo toàn nội dung nghĩa (R1)

- [ ] 1.1 Thêm fixture hai bundle chỉ giao một token, fixture bao bọc có protect, và output cố ý thiếu nghĩa/POS/headword; xác nhận regression thất bại trên source cũ.
- [ ] 1.2 Tách overlap khỏi bao phủ có hướng; chỉ loại sense khi mọi nội dung và liên kết cần giữ đã có đại diện trong kết quả.
- [ ] 1.3 Sửa verifyLossless để kiểm tra đầy đủ độc lập với quyết định chọn winner; giữ exact/plural fixtures hợp lệ và thứ tự ổn định.
- [ ] 1.4 Chạy suite dictionary identity và so sánh đầu ra website/popup trên cùng fixture; audit diff dữ liệu thật qua API đọc.

## 2. CSV và thứ tự release (R3, R4)

- [ ] 2.1 Thêm regression CSV quote chưa đóng, quote sai vị trí, ký tự sau quote đóng, thừa/thiếu cột và multiline Unicode hợp lệ.
- [ ] 2.2 Bổ sung trạng thái parser, vị trí lỗi và đường dẫn từ loader; bảo đảm lỗi parse chặn mọi write/upsert/publication.
- [ ] 2.3 Kiểm tra failure không đổi shard/artifact trong temp tree, gồm giao dịch đọc nhiều shard mà shard sau lỗi; không dùng shard sống làm target ghi test.
- [ ] 2.4 Thêm test Makefile thật với NODE mock, builder trì hoãn, target mới/vắng/stale và failure trước minify/publish.
- [ ] 2.5 Đặt minify sau mọi build thành công trong recipe/dependency release; chạy test song song -j4 và target độc lập.

## 3. Ownership của ruby nhiều node (R2)

- [ ] 3.1 Thêm regression rewrite node đầu/giữa/cuối, tháo wrapper, tail và nhiều match cùng node; xác nhận visible text không dư.
- [ ] 3.2 Tạo bookkeeping dùng chung cho mọi source segment và node runtime sở hữu của một span; không chỉ ghi node đầu.
- [ ] 3.3 Cleanup toàn annotation bị ảnh hưởng, giữ nội dung mới và source segment không đổi, không hồi sinh node trang đã tháo.
- [ ] 3.4 Chạy toàn suite nom-ruby và matcher equivalence, gồm NBSP, NFC, shadow root và tail sau cross-wrapper match.

## 4. Eligibility và phạm vi mutation (R5, R6)

- [ ] 4.1 Thêm regression direct characterData/nested addition trong từng nhóm excluded tags và contenteditable; thêm node chuyển vào editor trước flush.
- [ ] 4.2 Dùng một helper kiểm tra tổ tiên cho mọi đường vào và recheck eligibility khi flush.
- [ ] 4.3 Thêm counter test append div rỗng và leaf vào body/feed ở nhiều kích thước; ghi rõ giới hạn vùng nối.
- [ ] 4.4 Thu hẹp queue theo added/dirty regions và ownership cần reconcile; deduplicate và bỏ qua own mutations.
- [ ] 4.5 Giữ các regression delayed/missed-first-line, cross-wrapper, removal và open shadow root cùng các gate counter.

## 5. Lookup và pronunciation (R7, R8, R9)

- [ ] 5.1 Thêm JSON.parse fixture với constructor vắng mặt, constructor có entry thật và key thường; chặn inherited hit tại lookup.
- [ ] 5.2 Thêm core và VM adapter tests cho empty/space/tab/newline, punctuation, zero và input hợp lệ sau trạng thái rỗng.
- [ ] 5.3 Chuẩn hóa homophone empty về mảng rỗng mỗi dialect, bỏ HTML sentinel; adapter pronunciation xử lý status/kết quả rỗng trước chia paragraph.
- [ ] 5.4 Thêm fixture 4.000 singleton tokens, tích nhỏ để so thứ tự và case đạt limit; thay đệ quy Cartesian bằng vòng lặp tạo kết quả.
- [ ] 5.5 Chạy suite core, VM website adapters và popup runtime trên source thật.

## 6. Tích hợp, tài liệu và xác minh

- [ ] 6.1 Cập nhật docs/build.md, docs/dictionary-data.md, docs/pronunciation-engine.md cho hợp đồng cuối; sửa các mô tả build đã lỗi thời trong phần liên quan.
- [ ] 6.2 Dựng lại userscript và runtime dictionary vào artifact tạm/gitignored, review diff nội dung/kích thước trên cùng snapshot nguồn; giữ nguyên dữ liệu Chữ Nôm đang được sửa đồng thời.
- [ ] 6.3 Chạy make verify, openspec validate harden-runtime-and-dictionary-processing --strict --no-interactive và make check-openspec; ghi lại kết quả thật.
- [ ] 6.4 (operator-only) Kiểm tra trình duyệt: trang pronunciation/homophones với whitespace và văn bản dài; popup lookup; widget rewrite text ở đầu/giữa/cuối span, editor exclusion và feed thêm nội dung.
- [ ] 6.5 Đối chiếu R1–R9 với regression, kết quả build và kiểm tra thủ công trước khi đánh dấu change hoàn tất; chỉ triển khai liên repo nếu hợp đồng local mode thực sự thay đổi.
