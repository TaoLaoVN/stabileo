/**
 * Bản dịch tiếng Việt cho `steel/vi.ts`. Cùng các key và thứ tự như `steel/en.ts`.
 *
 * Thuật ngữ tuân theo thực hành kỹ thuật kết cấu tại Việt Nam (TCVN / AISC / Eurocode):
 * bản cánh (flange), bản bụng (web), xà gồ (purlin), giằng (bracing), oằn/mất ổn định (buckling),
 * lực cắt (shear), mô-men uốn (bending moment), thanh cánh (chord), thanh đứng (post), thanh xiên (diagonal).
 */
const steelVi: Record<string, string> = {
  // ─── Material family ───
  'steel.family.noMaterial': 'Phần tử chưa được gán vật liệu.',
  'steel.family.noStrength': 'Vật liệu không khai báo cường độ nên không thể phân loại.',
  'steel.family.inferredConcrete': 'Được nhận diện là bê tông dựa trên độ lớn của f\'c (≤ 80 MPa), không phải từ khai báo.',
  'steel.family.inferredMetalNotFerrousChecked': 'Được nhận diện là kim loại dựa trên độ lớn của fy (> 80 MPa). Chưa phân biệt được thép hay nhôm khi chưa khai báo mác.',

  // ─── Statuses ───
  'steel.status.NOT_DESIGNED': 'Chưa thiết kế',
  'steel.status.EXPERIMENTAL': 'Thử nghiệm',
  'steel.status.DEMAND_UNAVAILABLE': 'Không có nội lực',
  'steel.status.NOT_APPLICABLE': 'Không áp dụng',
  'steel.status.NOT_DESIGNED.desc': 'Được nhận diện là kết cấu kim loại. Chưa thực hiện tính toán thiết kế.',
  'steel.status.EXPERIMENTAL.desc': 'Kết quả tính toán chưa qua kiểm chuẩn chính thức. Không dùng làm chứng chỉ.',
  'steel.status.DEMAND_UNAVAILABLE.desc': 'Thiếu kết quả phân tích hoặc tổ hợp tải trọng cho cấu kiện này.',
  'steel.status.NOT_APPLICABLE.desc': 'Cấu kiện không phải là kim loại.',

  // ─── Reasons ───
  'steel.reason.noDemands': 'Hãy giải mô hình và định nghĩa tổ hợp tải trọng trước khi kiểm tra kết cấu thép.',
  'steel.reason.noMetallicAuthority': 'Dự án chưa liên kết tiêu chuẩn thiết kế kết cấu kim loại tương thích.',
  'steel.reason.designNotRun': 'Đã khai báo tiêu chuẩn kim loại nhưng chưa chạy tính toán thiết kế.',

  // ─── Notices ───
  'steel.notice.noAuthorityBound': 'Chưa có tiêu chuẩn kim loại nào cho ra kết quả trong phiên bản này. Các cấu kiện thép chỉ được liệt kê chứ chưa kiểm tra.',
  'steel.notice.noDemands': 'Chưa có nội lực: hãy giải bài toán mô hình cùng các tổ hợp tải trọng.',

  // ─── Assumptions of the existing checker ───
  'steel.assume.unbracedLengthIsMemberLength': 'Chiều dài tự do không giằng lấy bằng chiều dài cấu kiện (Lb = L).',
  'steel.assume.webAndFlangeThicknessInferred': 'Bề dày bản bụng và bản cánh được ước lượng theo tỉ lệ bề rộng khi tiết diện không khai báo.',
  'steel.assume.ultimateStrengthInferred': 'Cường độ chịu kéo đứt ước lượng bằng 1.25·fy khi vật liệu không khai báo.',
  'steel.assume.noSectionClassification': 'Tiết diện chưa được phân loại (đặc chắc / không đặc chắc / mảnh).',
  'steel.assume.noTests': 'Bộ kiểm tra chưa có bài kiểm thử và điểm chuẩn đối chứng bên ngoài.',
  'steel.promotion.needsClauseMapAndBenchmark': 'Để hoàn thiện từ giai đoạn thử nghiệm cần đối chiếu điều khoản tiêu chuẩn và đối chuẩn với ít nhất một ví dụ tính toán công bố.',

  'steel.checker.experimentalTitle': 'Kiểm tra kết cấu kim loại thử nghiệm',
  'steel.checker.experimentalBody': 'Các số liệu trong bảng này xuất phát từ bộ kiểm tra thử nghiệm, chưa qua kiểm chuẩn đầy đủ. Số liệu chỉ mang tính chất tham khảo cho kỹ sư xem xét giả định.',

  // ─── Panel ───
  'steel.panel.title': 'Kết cấu thép',
  'steel.panel.subtitle': 'Danh mục các cấu kiện kim loại. Chưa qua kiểm tra chính thức.',
  'steel.panel.experimentalBanner': 'Giao diện thử nghiệm. Bảng này liệt kê các cấu kiện kim loại trong mô hình. Không xuất chứng chỉ và không thay thế cho kiểm tra thiết kế chính thức.',
  'steel.panel.empty.noElements': 'Mô hình không có phần tử nào.',
  'steel.panel.empty.noneMetallic': 'Mô hình có {total} phần tử và không có phần tử nào là kim loại.',
  'steel.panel.empty.allUnclassified': 'Mô hình có {total} phần tử và không có phần tử nào khai báo cường độ để phân loại vật liệu.',
  'steel.panel.summary': '{n} cấu kiện kim loại · {beams} dầm · {columns} cột · {length} m',
  'steel.panel.censusTitle': 'Vật liệu trong mô hình',
  'steel.panel.inferredWarning': 'Nhóm vật liệu được suy luận từ độ lớn fy, không phải khai báo tường minh.',
  'steel.panel.gapsTitle': 'Hạn chế của tiêu chuẩn kim loại',
  'steel.panel.gapsIntro': 'Các tính năng sau chưa được hiện thực hóa trong phiên bản này.',
  'steel.panel.codeDeclared': 'Tiêu chuẩn kim loại khai báo: {name}',
  'steel.panel.codeNotDeclared': 'Dự án chưa khai báo tiêu chuẩn kim loại.',
  'steel.panel.codeExperimental': 'thử nghiệm — chưa xuất kết quả',

  // ─── Table ───
  'steel.table.element': 'Phần tử',
  'steel.table.kind': 'Loại',
  'steel.table.section': 'Tiết diện',
  'steel.table.material': 'Vật liệu',
  'steel.table.length': 'Chiều dài',
  'steel.table.status': 'Trạng thái',
  'steel.kind.beam': 'Dầm',
  'steel.kind.column': 'Cột',
  'steel.kind.wall': 'Vách',
  'steel.family.concrete': 'Bê tông',
  'steel.family.steel': 'Thép',
  'steel.family.timber': 'Gỗ',
  'steel.family.masonry': 'Gạch đá',
  'steel.family.aluminium': 'Nhôm',
  'steel.family.unknown': 'Chưa phân loại',

  // ─── Metallic capabilities ───
  'steel.capability.steelSectionClassification': 'Phân loại tiết diện',
  'steel.capability.steelTension': 'Chịu kéo',
  'steel.capability.steelCompression': 'Chịu nén',
  'steel.capability.steelFlexure': 'Chịu uốn',
  'steel.capability.steelLateralTorsionalBuckling': 'Mất ổn định uốn - xoắn',
  'steel.capability.steelShear': 'Chịu cắt',
  'steel.capability.steelInteraction': 'Tương tác uốn - nén đồng thời',
  'steel.capability.steelBracing': 'Hệ giằng',
  'steel.capability.steelConnections': 'Liên kết kết cấu thép',
  'steel.capability.steelMemberSchedules': 'Bảng thống kê cấu kiện kim loại',

  // ─── Regulations ───
  'regulations.problem.experimentalAdapter': '{name} đang ở chế độ thử nghiệm: được ghi nhận là tiêu chuẩn dự án nhưng chưa xuất kết quả kiểm tra.',

  // ─── Generators: roles ───
  'generator.role.chord': 'Thanh biên',
  'generator.role.post': 'Thanh đứng',
  'generator.role.diagonal': 'Thanh xiên',
  'generator.role.rafter': 'Kèo',
  'generator.role.column': 'Cột',
  'generator.role.beam': 'Dầm',
  'generator.role.purlin': 'Xà gồ',
  'generator.role.girder': 'Dầm chính',
  'generator.role.joist': 'Dầm phụ',
  'generator.role.deck': 'Sàn tôn',
  'generator.role.cantilever': 'Công-xôn',
  'generator.role.bracing': 'Thanh giằng',
  'generator.role.tie': 'Thanh kéo',
  'generator.role.strut': 'Thanh chống',
  'generator.role.crossBrace': 'Giằng chữ X',
  'generator.role.sagRod': 'Ty treo xà gồ',
  'generator.role.fascia': 'Thanh biên mái',
  'generator.role.unknown': 'Khác',

  // ─── Metallic profiles ───
  'profileSelector.placeholder': 'Chọn cấu hình thép...',
  'profileSelector.noResults': 'Không tìm thấy tiết diện thép phù hợp.',
  'profileSelector.search': 'Tìm kiếm tiết diện...',
  'profileSelector.category': 'Nhóm',
  'profileSelector.standard': 'Tiêu chuẩn',
  'profileSelector.type': 'Quy cách',
  'profileSelector.dimensions': 'Kích thước',

  // ─── Metallic Connections ───
  'conn.title': 'Liên kết thép',
  'conn.empty': 'Chưa có liên kết thép nào.',
  'conn.create': 'Tạo liên kết mới',
  'conn.name': 'Tên liên kết',
  'conn.type': 'Loại liên kết',
  'conn.node': 'Nút liên kết',
  'conn.members': 'Các cấu kiện kết nối',
  'conn.bolts': 'Bu lông',
  'conn.welds': 'Đường hàn',
  'conn.plates': 'Bản mã',
  'conn.basePlate': 'Bản đế',
  'conn.anchorBolts': 'Bu lông neo',
  'conn.stiffeners': 'Gân tăng cứng',
  'conn.shearCapacity': 'Khả năng chịu cắt',
  'conn.momentCapacity': 'Khả năng chịu uốn',
  'conn.tensionCapacity': 'Khả năng chịu kéo',
  'conn.utilization': 'Hệ số sử dụng',
  'conn.status': 'Trạng thái kiểm tra',
  'conn.pass': 'Đạt',
  'conn.fail': 'Không đạt',
  'conn.warning': 'Cảnh báo',
};

export default steelVi;
