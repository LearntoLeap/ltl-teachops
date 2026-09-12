/**
 * PrivacyPolicy.jsx — Chính sách bảo mật (/chinh-sach-bao-mat), xem được không cần đăng nhập.
 * Google yêu cầu đường dẫn này trên trang Branding để ứng dụng OAuth (kết nối Drive)
 * được chuyển sang trạng thái chính thức.
 */
import { Link } from 'react-router-dom';

const UPDATED = '13/09/2026';

function Section({ n, title, children }) {
  return (
    <section className="mb-6">
      <h2 className="text-[16.5px] font-bold text-brand-900 mb-2">{n}. {title}</h2>
      <div className="text-[14px] text-ink-soft leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

export default function PrivacyPolicy() {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="bg-brand-grad text-white">
        <div className="max-w-3xl mx-auto px-5 py-6">
          <div className="text-[13px] opacity-90">LtL TeachOps · Learn to Leap</div>
          <h1 className="text-2xl font-extrabold mt-1">Chính sách bảo mật</h1>
          <div className="text-[12.5px] opacity-85 mt-1">Cập nhật lần cuối: {UPDATED}</div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-7">
        <div className="card p-5 sm:p-7">
          <Section n={1} title="Giới thiệu">
            <p>
              <b>LtL TeachOps</b> là hệ thống nội bộ của <b>Công ty Cổ phần Công nghệ Giáo dục Learn to Leap</b>,
              dùng để quản lý vận hành đội ngũ giáo viên, trợ giảng và phòng chuyên môn tại các trường đối tác.
              Hệ thống không mở đăng ký công khai — mọi tài khoản do Quản trị viên của công ty cấp.
            </p>
          </Section>

          <Section n={2} title="Dữ liệu chúng tôi thu thập">
            <ul className="list-disc pl-5 space-y-1">
              <li>Thông tin tài khoản: họ tên, email, số điện thoại, khu vực làm việc, ngày sinh, vai trò.</li>
              <li>Vị trí GPS <b>tại thời điểm</b> người dùng bấm chấm công vào/ra (không theo dõi liên tục).</li>
              <li>Ảnh và video minh chứng: ảnh chân dung khi chấm công, ảnh thiết bị, ảnh/video lớp học, ảnh/video báo hỏng thiết bị, ảnh góp ý.</li>
              <li>Dữ liệu nghiệp vụ: lịch dạy, điểm danh (sĩ số, tên học sinh vắng nếu được nhập), kiểm kê thiết bị, học liệu, góp ý.</li>
              <li>Nhật ký thao tác: thời gian, địa chỉ IP, loại thiết bị/trình duyệt khi thực hiện các thao tác quan trọng.</li>
            </ul>
          </Section>

          <Section n={3} title="Mục đích sử dụng">
            <p>
              Dữ liệu chỉ dùng cho công việc nội bộ: chấm công và tính thù lao, điều phối lịch dạy, theo dõi
              điểm danh, quản lý thiết bị phòng STEM, nâng cao chất lượng giảng dạy và xử lý góp ý.
              Chúng tôi <b>không bán</b> dữ liệu, <b>không</b> dùng dữ liệu cho quảng cáo.
            </p>
          </Section>

          <Section n={4} title="Nơi lưu trữ">
            <p>
              Dữ liệu được lưu trên máy chủ do công ty quản lý. Ảnh và video minh chứng được sao lưu và lưu trữ
              dài hạn trên <b>Google Drive của tài khoản quản trị của công ty</b>; sau một thời gian, bản gốc
              trên máy chủ có thể được xoá để tiết kiệm dung lượng, hệ thống vẫn truy xuất lại từ Google Drive khi cần.
            </p>
          </Section>

          <Section n={5} title="Dữ liệu người dùng Google (Google user data)">
            <p>
              Khi Quản trị viên kết nối Google Drive, ứng dụng chỉ xin quyền
              {' '}<code className="text-[12.5px] bg-canvas px-1 rounded">https://www.googleapis.com/auth/drive.file</code>{' '}
              — quyền này chỉ cho phép tạo, đọc và cập nhật <b>các tệp, thư mục do chính ứng dụng tạo</b>
              {' '}(thư mục “LtL TeachOps — Ảnh &amp; Video” và nội dung bên trong). Ứng dụng <b>không</b> xem, đọc
              hay thay đổi bất kỳ tệp nào khác trong Google Drive của bạn.
            </p>
            <p>
              Ứng dụng dùng quyền này duy nhất để tải ảnh/video/tài liệu của hệ thống lên Drive và lấy lại chúng
              khi người dùng có quyền mở xem trong ứng dụng. Mã uỷ quyền (refresh token) được lưu trên máy chủ
              của công ty, không chia sẻ cho bên thứ ba, và có thể bị thu hồi bất cứ lúc nào bằng nút
              “Ngắt kết nối” trong ứng dụng hoặc tại trang quản lý quyền của tài khoản Google.
            </p>
            <p className="rounded-xl bg-canvas border border-line px-3 py-2 text-[13px]">
              LtL TeachOps’s use and transfer of information received from Google APIs will adhere to the
              {' '}<a className="text-brand-700 underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>,
              including the Limited Use requirements.
            </p>
          </Section>

          <Section n={6} title="Chia sẻ dữ liệu">
            <p>
              Dữ liệu chỉ được xem trong nội bộ theo phân quyền: giáo viên/trợ giảng thấy dữ liệu của mình và lớp
              được phân công; Phòng chuyên môn thấy các trường được giao phụ trách; Quản trị viên thấy toàn hệ thống.
              Chúng tôi không chia sẻ dữ liệu cho bên thứ ba, trừ khi pháp luật yêu cầu.
            </p>
          </Section>

          <Section n={7} title="Bảo mật">
            <p>
              Kết nối được mã hoá (HTTPS); mật khẩu được băm, không lưu dạng đọc được; mọi thao tác quan trọng
              (tài khoản, chấm công, cấu hình) được ghi nhật ký; quyền truy cập giới hạn theo vai trò.
            </p>
          </Section>

          <Section n={8} title="Thời gian lưu giữ và quyền của bạn">
            <p>
              Dữ liệu được lưu trong thời gian cần thiết cho việc đối soát công, lương và theo quy định nội bộ
              của công ty. Bạn có quyền xem, yêu cầu chỉnh sửa hoặc xoá dữ liệu cá nhân của mình theo
              Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân — gửi yêu cầu tới Quản trị viên hệ thống.
            </p>
          </Section>

          <Section n={9} title="Liên hệ">
            <p>
              Mọi câu hỏi về chính sách này, vui lòng liên hệ Quản trị viên hệ thống LtL TeachOps —
              Công ty Cổ phần Công nghệ Giáo dục Learn to Leap.
            </p>
          </Section>

          <div className="pt-4 border-t border-line text-[13px]">
            <Link to="/" className="text-brand-700 font-semibold hover:underline">← Về LtL TeachOps</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
