/**
 * feedback.js — Góp ý / phản hồi (docs/API.md §10).
 *
 * Phạm vi xem:
 *   - admin: tất cả.
 *   - manager: góp ý KHÔNG gắn trường (school_id null) hoặc thuộc trường trong phạm vi.
 *   - teacher/assistant: chỉ góp ý do chính mình gửi.
 */
import { rows, one, scalar, query, tx } from '../db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { requirePerm, assertPerm } from '../lib/rbac.js';
import { visibleSchoolIds, assertSchoolAccess } from '../lib/scope.js';
import { str, uuid, enumOf, bool, dateStr, paging } from '../lib/validate.js';
import { consumeMultipart } from '../lib/storage.js';
import { audit } from '../lib/audit.js';
import { notify, notifySchoolManagers } from '../lib/notify.js';

const CATEGORIES = ['curriculum', 'device', 'other'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUSES = ['new', 'in_progress', 'resolved'];

const CATEGORY_LABEL = { curriculum: 'Giáo trình', device: 'Thiết bị', other: 'Khác' };
const PRIORITY_LABEL = { low: 'Thấp', normal: 'Bình thường', high: 'Cao', urgent: 'Khẩn cấp' };
const STATUS_LABEL = { new: 'Mới', in_progress: 'Đang xử lý', resolved: 'Đã xử lý' };

/** SELECT dùng chung cho danh sách & chi tiết: kèm tên trường/lớp/phòng, người liên quan, ảnh. */
const DETAIL_SQL = `
  select f.*,
         s.name  as school_name,
         c.name  as class_name,
         r.name  as room_name,
         m.title as material_title,
         cu.full_name  as created_by_name,
         cu.role       as created_by_role,
         au.full_name  as assigned_to_name,
         clu.full_name as closed_by_name,
         (select count(*)::int from feedback_replies fr where fr.feedback_id = f.id) as reply_count,
         coalesce((
           select json_agg(json_build_object(
                    'id', fi.id, 'file_name', fi.file_name, 'mime', fi.mime,
                    'size_bytes', fi.size_bytes, 'width', fi.width, 'height', fi.height
                  ) order by fp.sort_order)
             from feedback_photos fp
             join files fi on fi.id = fp.file_id
            where fp.feedback_id = f.id
         ), '[]'::json) as photos
    from feedback f
    left join schools s    on s.id  = f.school_id
    left join classes c    on c.id  = f.class_id
    left join stem_rooms r on r.id  = f.room_id
    left join materials m  on m.id  = f.material_id
    join users cu          on cu.id = f.created_by
    left join users au     on au.id  = f.assigned_to
    left join users clu    on clu.id = f.closed_by`;

function loadFeedback(id) {
  return one(`${DETAIL_SQL} where f.id = $1`, [id]);
}

/** Lấy một góp ý sau khi kiểm phạm vi. Ngoài phạm vi ⇒ 404 (không lộ sự tồn tại). */
async function assertFeedbackAccess(user, id) {
  const f = await loadFeedback(id);
  if (!f) throw notFound('Không tìm thấy góp ý.');
  if (user.role === 'admin') return f;

  if (user.role === 'manager') {
    if (!f.school_id) return f;                       // góp ý chung — manager nào cũng thấy
    const ids = await visibleSchoolIds(user);
    if (ids.includes(f.school_id)) return f;
    throw notFound('Không tìm thấy góp ý.');
  }

  if (f.created_by === user.id) return f;
  throw notFound('Không tìm thấy góp ý.');
}

/** Gửi thông báo nhưng không để lỗi thông báo làm hỏng nghiệp vụ chính. */
async function safeNotify(req, fn) {
  try {
    await fn();
  } catch (e) {
    req.log.warn({ err: e }, 'Không gửi được thông báo góp ý');
  }
}

export default async function routes(app) {
  /* ------------------------- Danh sách góp ý ------------------------------ */
  app.get('/api/feedback', async (req) => {
    const q = req.query || {};
    const { page, limit, offset } = paging(q);

    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    const conds = [];

    // Phạm vi theo vai trò
    if (req.user.role === 'manager') {
      const ids = await visibleSchoolIds(req.user);
      conds.push(ids.length
        ? `(f.school_id is null or f.school_id = any(${p(ids)}))`
        : 'f.school_id is null');
    } else if (req.user.role !== 'admin') {
      conds.push(`f.created_by = ${p(req.user.id)}`);
    }

    // Bộ lọc tuỳ chọn
    const status = enumOf(q.status, 'status', STATUSES);
    if (status) conds.push(`f.status = ${p(status)}`);
    const category = enumOf(q.category, 'category', CATEGORIES);
    if (category) conds.push(`f.category = ${p(category)}`);
    const priority = enumOf(q.priority, 'priority', PRIORITIES);
    if (priority) conds.push(`f.priority = ${p(priority)}`);
    const schoolId = uuid(q.school_id, 'school_id');
    if (schoolId) conds.push(`f.school_id = ${p(schoolId)}`);
    if (bool(q.mine, 'mine') === true) conds.push(`f.created_by = ${p(req.user.id)}`);
    const from = dateStr(q.from, 'from');
    if (from) conds.push(`f.created_at >= ${p(from)}::date`);
    const to = dateStr(q.to, 'to');
    if (to) conds.push(`f.created_at < ${p(to)}::date + interval '1 day'`);

    const where = conds.length ? conds.join(' and ') : 'true';
    const total = await scalar(`select count(*) from feedback f where ${where}`, params);
    const items = await rows(
      `${DETAIL_SQL} where ${where}
        order by f.created_at desc
        limit ${p(limit)} offset ${p(offset)}`,
      params
    );
    return { items, total, page, limit };
  });

  /* --------------------------- Gửi góp ý mới ------------------------------ */
  app.post('/api/feedback', { preHandler: requirePerm('feedback.create') }, async (req, reply) => {
    // school_id nằm trong fields multipart nên chưa biết trước — lưu tệp với schoolId null
    // rồi gắn lại sau khi đã kiểm phạm vi.
    const { fields, files } = await consumeMultipart(req, { userId: req.user.id, schoolId: null, allowVideo: true });

    const category = enumOf(fields.category, 'category', CATEGORIES, { required: true });
    const priority = enumOf(fields.priority, 'priority', PRIORITIES, { def: 'normal' }) || 'normal';
    const title = str(fields.title, 'title', { required: true, max: 300 });
    const body = str(fields.body, 'body', { required: true, max: 5000 });
    const schoolId = uuid(fields.school_id, 'school_id');
    const classId = uuid(fields.class_id, 'class_id');
    const roomId = uuid(fields.room_id, 'room_id');
    const materialId = uuid(fields.material_id, 'material_id');

    // Có gắn trường ⇒ trường phải thuộc phạm vi người gửi (ngoài phạm vi ⇒ 404)
    if (schoolId) await assertSchoolAccess(req.user, schoolId);

    const photos = files.photos || [];

    const fb = await tx(async (c) => {
      const r = await c.query(
        `insert into feedback
           (school_id, class_id, room_id, material_id, category, priority, title, body, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning *`,
        [schoolId, classId, roomId, materialId, category, priority, title, body, req.user.id]
      );
      const row = r.rows[0];

      for (let i = 0; i < photos.length; i++) {
        await c.query(
          'insert into feedback_photos (feedback_id, file_id, sort_order) values ($1, $2, $3)',
          [row.id, photos[i].id, i]
        );
      }
      // Gắn ảnh vào trường để route /api/files soát quyền xem đúng phạm vi
      if (schoolId && photos.length) {
        await c.query('update files set school_id = $1 where id = any($2)',
          [schoolId, photos.map((f) => f.id)]);
      }
      return row;
    });

    const n = {
      kind: 'feedback_new',
      title: `Góp ý mới: ${title}`,
      body: `${req.user.full_name} · ${CATEGORY_LABEL[category]} · Mức độ: ${PRIORITY_LABEL[priority]}`,
      link: `/gop-y/${fb.id}`,
      refId: fb.id,
    };
    await safeNotify(req, async () => {
      if (schoolId) {
        await notifySchoolManagers(schoolId, n);
      } else {
        // Không gắn trường ⇒ báo mọi admin + manager đang hoạt động (trừ chính người gửi)
        const r = await rows(
          `select id from users where is_active and role in ('admin', 'manager') and id <> $1`,
          [req.user.id]
        );
        await notify(r.map((x) => x.id), n);
      }
    });

    reply.code(201);
    return loadFeedback(fb.id);
  });

  /* --------------------------- Chi tiết góp ý ----------------------------- */
  app.get('/api/feedback/:id', async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const fb = await assertFeedbackAccess(req.user, id);

    const replies = await rows(
      `select fr.*, u.full_name as user_name, u.role as user_role
         from feedback_replies fr
         join users u on u.id = fr.user_id
        where fr.feedback_id = $1
        order by fr.created_at`,
      [id]
    );
    return { ...fb, replies };
  });

  /* ------------------- Cập nhật trạng thái / phân công -------------------- */
  app.patch('/api/feedback/:id', { preHandler: requirePerm('feedback.resolve') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const before = await assertFeedbackAccess(req.user, id);

    const b = req.body || {};
    const status = enumOf(b.status, 'status', STATUSES);
    const priority = enumOf(b.priority, 'priority', PRIORITIES);

    // assigned_to: gửi null/'' để bỏ phân công
    const hasAssign = Object.prototype.hasOwnProperty.call(b, 'assigned_to');
    let assignedTo = null;
    if (hasAssign && b.assigned_to !== null && b.assigned_to !== '') {
      assignedTo = uuid(b.assigned_to, 'assigned_to', { required: true });
      const u = await one('select 1 from users where id = $1 and is_active', [assignedTo]);
      if (!u) throw badRequest('Người được phân công không tồn tại hoặc đã bị khoá.');
    }

    const sets = [];
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    if (status) {
      sets.push(`status = ${p(status)}`);
      if (status === 'resolved') {
        sets.push(`closed_by = ${p(req.user.id)}`, 'closed_at = now()');
      } else {
        // mở lại ⇒ xoá dấu vết đã đóng
        sets.push('closed_by = null', 'closed_at = null');
      }
    }
    if (priority) sets.push(`priority = ${p(priority)}`);
    if (hasAssign) sets.push(`assigned_to = ${p(assignedTo)}`);
    if (!sets.length) throw badRequest('Không có thông tin nào để cập nhật.');

    await query(`update feedback set ${sets.join(', ')} where id = ${p(id)}`, params);
    const after = await loadFeedback(id);

    audit(req, {
      action: 'update',
      entity: 'feedback',
      entityId: id,
      summary: `Cập nhật góp ý "${before.title}"` +
        (status ? ` — trạng thái: ${STATUS_LABEL[status]}` : ''),
      before: { status: before.status, priority: before.priority, assigned_to: before.assigned_to },
      after: { status: after.status, priority: after.priority, assigned_to: after.assigned_to },
    });

    if (before.created_by !== req.user.id) {
      await safeNotify(req, () => notify(before.created_by, {
        kind: 'feedback_update',
        title: `Góp ý "${before.title}" đã được cập nhật`,
        body: status ? `Trạng thái mới: ${STATUS_LABEL[status]}.` : 'Thông tin xử lý vừa được cập nhật.',
        link: `/gop-y/${id}`,
        refId: id,
      }));
    }

    return after;
  });

  /* ------------------------------ Trả lời --------------------------------- */
  app.post('/api/feedback/:id/replies', async (req, reply) => {
    const id = uuid(req.params.id, 'id', { required: true });
    // Ai xem được góp ý thì trả lời được (assertFeedbackAccess đã lọc phạm vi)
    const fb = await assertFeedbackAccess(req.user, id);

    const b = req.body || {};
    const body = str(b.body, 'body', { required: true, max: 5000 });
    const statusTo = enumOf(b.status_to, 'status_to', STATUSES);
    if (statusTo) assertPerm(req.user, 'feedback.resolve');   // đổi trạng thái cần quyền xử lý

    const created = await tx(async (c) => {
      const r = await c.query(
        `insert into feedback_replies (feedback_id, user_id, body, status_to)
         values ($1, $2, $3, $4)
         returning *`,
        [id, req.user.id, body, statusTo]
      );
      if (statusTo === 'resolved') {
        await c.query(
          'update feedback set status = $1, closed_by = $2, closed_at = now() where id = $3',
          [statusTo, req.user.id, id]
        );
      } else if (statusTo) {
        await c.query(
          'update feedback set status = $1, closed_by = null, closed_at = null where id = $2',
          [statusTo, id]
        );
      }
      return r.rows[0];
    });

    // Đổi trạng thái là thao tác nhạy cảm ⇒ ghi nhật ký
    if (statusTo) {
      audit(req, {
        action: 'update',
        entity: 'feedback',
        entityId: id,
        summary: `Phản hồi kèm đổi trạng thái góp ý "${fb.title}" sang ${STATUS_LABEL[statusTo]}`,
        before: { status: fb.status },
        after: { status: statusTo },
      });
    }

    // Báo người gửi (nếu người trả lời là người khác) + người được phân công
    const targets = [fb.created_by, fb.assigned_to].filter((x) => x && x !== req.user.id);
    await safeNotify(req, () => notify(targets, {
      kind: 'feedback_reply',
      title: `Phản hồi mới cho góp ý "${fb.title}"`,
      body: body.length > 200 ? `${body.slice(0, 200)}…` : body,
      link: `/gop-y/${id}`,
      refId: id,
    }));

    reply.code(201);
    return { ...created, user_name: req.user.full_name, user_role: req.user.role };
  });
}
