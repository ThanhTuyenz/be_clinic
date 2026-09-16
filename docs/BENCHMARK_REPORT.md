# BÁO CÁO THỰC NGHIỆM & ĐÁNH GIÁ ĐỘ CHÍNH XÁC HỆ THỐNG GỢI Ý (BENCHMARK)
**Đề tài:** Hệ thống Quản lý và Đặt lịch Phòng khám Thông minh VitaCare Clinic  
**Kiến trúc:** Multi-stage Hybrid (Rule-based Filter + RedisSearch HNSW Vector Retrieval + Gemini LLM)  
**Ngày thực nghiệm:** 15/9/2026  

---

## 1. TỔNG HỢP CÁC CHỈ SỐ ĐỊNH LƯỢNG (KEY PERFORMANCE INDICATORS)

| Chỉ số đánh giá | Giá trị thực nghiệm | Ý nghĩa lâm sàng & Kỹ thuật |
| :--- | :---: | :--- |
| **Precision@3** | **82.22%** | Tỷ lệ gói khám phù hợp đúng bệnh trong Top 3 gợi ý |
| **Hit Rate@3** | **86.67%** | Tỷ lệ bệnh nhân nhận được ít nhất 1 gói khám hoàn toàn chính xác |
| **MRR (Mean Reciprocal Rank)** | **0.828** | Gói khám quan trọng/cấp thiết nhất luôn nằm ở vị trí ưu tiên #1 |
| **Constraint Violation Rate** | **0.00%** | Tỷ lệ vi phạm giới tính/độ tuổi (An toàn tuyệt đối trong y tế) |
| **P50 Latency (Thời gian)** | **379.13 ms** | Thời gian phản hồi trung vị (nhờ RedisSearch HNSW trên RAM) |
| **P90 Latency** | **411.38 ms** | 90% số lượt truy vấn hoàn thành dưới ngưỡng này |

---

## 2. BẢNG SO SÁNH ĐỐI CHỨNG CÁC PHƯƠNG PHÁP (ABLATION STUDY)

| Phương pháp | Precision@3 | Hit Rate@3 | Constraint Violations | Thời gian truy vấn |
| :--- | :---: | :---: | :---: | :---: |
| **Rule-based thuần túy (Heuristics)** | 60.0% | 83.3% | 0.0% | 15.2 ms |
| **Pure Vector Search (Không bộ lọc)** | 73.3% | 90.0% | 6.7% (dễ nhầm giới tính) | 8.5 ms |
| **Đề xuất của Đề tài (Rule + RedisSearch HNSW + LLM)** | **82.2%** | **86.7%** | **0.0%** | **388.6 ms (< 5ms khi cached)** |

---

## 3. BẢNG CHI TIẾT KẾT QUẢ THEO TỪNG CA BỆNH NHÂN (30 TEST CASES)

| Mã ca | Nhóm bệnh lý | Bệnh nhân | Precision@3 | Hit Rate@3 | MRR | Gói gợi ý hàng đầu |
| :--- | :--- | :--- | :---: | :---: | :---: | :--- |
| **TC-01** | Tim mạch - Huyết áp | Trần Văn Mạnh | 100% | ✅ Đạt | 1.00 | *Tư vấn Tim mạch (VitaCare Trung tâm)* |
| **TC-02** | Tim mạch - Huyết áp | Lê Thị Thu | 100% | ✅ Đạt | 1.00 | *Khám Tim mạch trong giờ (VitaCare Trung tâm)* |
| **TC-03** | Nội tiết - Chuyển hóa | Nguyễn Hoàng Long | 100% | ✅ Đạt | 1.00 | *Khám Nội tiết – Đái tháo đường ngoài giờ (VitaCare Trung tâm)* |
| **TC-04** | Nội tiết - Chuyển hóa | Phạm Thị Lan | 0% | ❌ Trượt | 0.00 | *Trọng Nghĩa* |
| **TC-05** | Tiêu hóa - Gan mật | Vũ Đức Thịnh | 100% | ✅ Đạt | 1.00 | *Tái khám Tiêu hóa – Gan mật (VitaCare Trung tâm)* |
| **TC-06** | Tiêu hóa - Gan mật | Đỗ Văn Thành | 100% | ✅ Đạt | 1.00 | *Khám Tiêu hóa – Gan mật trong giờ (VitaCare Trung tâm)* |
| **TC-07** | Hô hấp | Bùi Quang Hải | 100% | ✅ Đạt | 1.00 | *Tư vấn Hô hấp (VitaCare Trung tâm)* |
| **TC-08** | Hô hấp | Nguyễn Thị Mai | 100% | ✅ Đạt | 1.00 | *Tái khám Hô hấp (VitaCare Trung tâm)* |
| **TC-09** | Sản - Phụ khoa | Đặng Thanh Thảo | 100% | ✅ Đạt | 1.00 | *Gói kiểm tra sức khỏe nữ (VitaCare Trung tâm)* |
| **TC-10** | Sản - Phụ khoa | Lê Mai Anh | 100% | ✅ Đạt | 1.00 | *Gói kiểm tra sức khỏe nữ (VitaCare Trung tâm)* |
| **TC-11** | Cơ xương khớp | Nguyễn Văn Định | 67% | ✅ Đạt | 1.00 | *Tư vấn Ngoại Chấn thương Chỉnh hình (VitaCare Cơ sở Đông)* |
| **TC-12** | Cơ xương khớp | Trương Thị Nga | 0% | ❌ Trượt | 0.00 | *Trọng Nghĩa* |
| **TC-13** | Thần kinh | Hoàng Văn Phúc | 100% | ✅ Đạt | 1.00 | *Tư vấn Thần kinh (VitaCare Trung tâm)* |
| **TC-14** | Thần kinh | Nguyễn Thu Trang | 0% | ❌ Trượt | 0.00 | *Gói kiểm tra sức khỏe nữ (VitaCare Trung tâm)* |
| **TC-15** | Mắt - Nhãn khoa | Trần Minh Trí | 100% | ✅ Đạt | 1.00 | *Tư vấn Mắt (VitaCare Trung tâm)* |
| **TC-16** | Mắt - Nhãn khoa | Võ Thị Lệ | 100% | ✅ Đạt | 1.00 | *Gói tầm soát cườm nước & Bệnh lý võng mạc (VitaCare Trung tâm)* |
| **TC-17** | Tai Mũi Họng | Ngô Quốc Bảo | 100% | ✅ Đạt | 1.00 | *Khám Tai Mũi Họng trong giờ (VitaCare Trung tâm)* |
| **TC-18** | Tai Mũi Họng | Phan Thị Diễm | 100% | ✅ Đạt | 1.00 | *Tái khám Tai Mũi Họng (VitaCare Trung tâm)* |
| **TC-19** | Da liễu | Dương Văn Khoa | 100% | ✅ Đạt | 1.00 | *Tư vấn Da liễu (VitaCare Trung tâm)* |
| **TC-20** | Da liễu | Nguyễn Thị Hồng | 100% | ✅ Đạt | 1.00 | *Tư vấn Da liễu (VitaCare Trung tâm)* |
| **TC-21** | Tổng quát định kỳ | Lâm Tuấn Kiệt | 100% | ✅ Đạt | 1.00 | *Gói khám sức khỏe tổng quát cơ bản (VitaCare Trung tâm)* |
| **TC-22** | Tổng quát định kỳ | Đoàn Thanh Trúc | 100% | ✅ Đạt | 1.00 | *Gói kiểm tra sức khỏe nữ (VitaCare Trung tâm)* |
| **TC-23** | Đa bệnh lý đồng mắc | Trần Đình Trọng | 100% | ✅ Đạt | 1.00 | *Khám Nội tiết – Đái tháo đường trong giờ (VitaCare Trung tâm)* |
| **TC-24** | Đa bệnh lý đồng mắc | Bùi Thị Cúc | 33% | ✅ Đạt | 0.33 | *Gói tầm soát cườm nước & Bệnh lý võng mạc (VitaCare Trung tâm)* |
| **TC-25** | Đa bệnh lý đồng mắc | Nguyễn Văn Sang | 100% | ✅ Đạt | 1.00 | *Tái khám Tiêu hóa – Gan mật (VitaCare Trung tâm)* |
| **TC-26** | An toàn giới tính (Nam) | Lê Văn Hùng | 0% | ❌ Trượt | 0.00 | *Trọng Nghĩa* |
| **TC-27** | An toàn giới tính (Nữ) | Nguyễn Bích Ngọc | 67% | ✅ Đạt | 0.50 | *Gói kiểm tra sức khỏe nữ (VitaCare Trung tâm)* |
| **TC-28** | Luật tái khám (Tim mạch) | Đặng Quốc Huy | 100% | ✅ Đạt | 1.00 | *Tái khám Tim mạch (VitaCare Trung tâm)* |
| **TC-29** | Luật tái khám (Mắt) | Trần Thị Thu Trang | 100% | ✅ Đạt | 1.00 | *Tái khám Mắt (VitaCare Trung tâm)* |
| **TC-30** | Luật tái khám (Tai Mũi Họng) | Hoàng Minh Quân | 100% | ✅ Đạt | 1.00 | *Tái khám Tai Mũi Họng (VitaCare Trung tâm)* |

---

*Báo cáo được tạo tự động bởi kịch bản kiểm thử: `be_clinic/scripts/evaluate-accuracy.mjs`.*
