# Thực nghiệm Search đã lưu

Chỉ giữ dữ liệu, nhãn, báo cáo và công cụ chấm lại kết quả hiện có.
Đã bỏ generator, runner thử nghiệm, bảng trống và báo cáo phụ.

## Mở file nào?

- `pool.results.ai.report.md`: báo cáo chính.
- `pool.review.csv`: 480 cặp truy vấn–gói đã chấm, có lý do.
- `pool.queries.csv`: trạng thái nhu cầu của 100 truy vấn.
- `pool.report.ai.csv`: đối chiếu Top-1 giữa hai phương pháp.
- `queries.v3.raw.json`: 100 câu truy vấn mô phỏng đã cố định.
- `architecture.mmd`: sơ đồ Search hiện tại có RRF.

## Dữ liệu giữ để kiểm chứng

- `results.gemini.v3.json`: run gốc của cả hai phương pháp.
- `queries.v3.json`: dataset gốc tương ứng với hash của run, không phải nhãn pooling hiện tại.
- `pool.judgments.ai.json`: nhãn máy đọc; điều kiện và relevance được chấm riêng.
- `pool.report.ai.json`: chỉ số và kết quả chi tiết đã lưu.
- `pool.review.json`: pool trước khi chấm.
- `pool.mapping.json`: nguồn và thứ hạng tách khỏi bảng chấm.
- `pooling-protocol.md`: tiêu chí đánh giá và giới hạn.
- `../recommendation/catalog.snapshot.json`: 48 gói dùng chung; cần giữ để đối chiếu.

Nhãn do trợ lý AI hỗ trợ chấm, chưa được duyệt độc lập hoặc thẩm định y khoa.
Run và bảng số liệu hiện có thuộc phiên bản trước RRF. Chưa có kết quả chất lượng
cho RRF; không đổi nhãn hoặc dùng bảng cũ để kết luận chất lượng phiên bản mới.

## Kiểm tra

Chạy từ `be_clinic` với backend đã biên dịch:

```powershell
node --test evaluation/search-ranking.test.cjs evaluation/search/score-pool.test.cjs
```

`score-pool.cjs` giữ phép chấm và kiểm tra hash. Chạy trực tiếp script sẽ xuất báo
cáo và từ chối ghi đè file hiện có; không cần chạy nó chỉ để đọc bảng kết quả.
Các generator và runner cũ đã được xóa theo yêu cầu dọn thư mục.
