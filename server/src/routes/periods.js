/**
 * routes/periods.js — Khung TIẾT DẠY (docs/API.md mục 4).
 *
 * Mọi vai trò đều đọc được (ô chọn tiết khi xếp lịch cần nó); chỉ Quản trị viên
 * sửa hoặc thêm tiết. Đổi khung tiết KHÔNG động vào buổi dạy đã xếp — giờ của
 * chúng đã lưu xuống bảng từ lúc tạo, nên bảng lương không bị xê dịch về sau.
 */
import { requireRole } from '../lib/rbac.js';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';
import { listPeriods, savePeriods, MIN_PERIOD, MAX_PERIOD } from '../lib/periods.js';

export default async function routes(app) {
  /* GET /api/periods — khung tiết đang áp dụng. */
  app.get('/api/periods', async () => ({
    items: await listPeriods(),
    min: MIN_PERIOD,
    max: MAX_PERIOD,
  }));

  /* PUT /api/periods — thay TOÀN BỘ khung tiết (admin). */
  app.put('/api/periods', { preHandler: requireRole('admin') }, async (req) => {
    const body = req.body || {};
    if (!Array.isArray(body.items)) throw badRequest('Thiếu danh sách tiết (items).');

    const before = await listPeriods();
    const items = await savePeriods(body.items, req.user.id);

    audit(req, {
      action: 'update',
      entity: 'app_settings',
      entityId: null,
      summary: `Cập nhật khung tiết dạy (${items.length} tiết).`,
      before: { periods: before },
      after: { periods: items },
    });
    return { items, min: MIN_PERIOD, max: MAX_PERIOD };
  });
}
