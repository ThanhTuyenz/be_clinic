# Dữ liệu thực nghiệm Recommendation đã lưu

Thư mục này chỉ giữ dữ liệu và kết quả đã có. Các generator, runner, nhãn trống
và kiểm thử dành riêng cho bộ công cụ thử nghiệm cũ đã được xóa.

- `catalog.snapshot.json`: 48 gói khám đóng băng, còn được Search sử dụng để kiểm chứng dữ liệu.
- `profiles.json` / `profiles.csv`: 100 hồ sơ giả lập, chia 20 development và 80 test.
- `labels.ai-draft-development.json` / `development.ai-draft.csv`: nhãn nháp AI cho 20 hồ sơ development; 80 hồ sơ test chưa được chấm.
- `runs.A.development.rerun.json` / `.json.csv`: kết quả A đã chạy trên 20 hồ sơ development, có metadata và chỉ số thăm dò.

Chưa chạy phương án C với OpenAI trên bộ dữ liệu này và chưa có so sánh A/C
hoàn chỉnh. Không dùng nhãn nháp hoặc điểm development làm kết quả được duyệt
độc lập. Không trộn với bảng thử nghiệm cũ trên 27 tình huống.
