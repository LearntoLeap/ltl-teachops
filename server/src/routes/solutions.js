/**
 * solutions.js — Danh mục giải pháp (UBTECH, Stick'em, Weeemake…) — docs/API.md §9.
 *
 * Cây 2 cấp: mục gốc (parent_id null) và mục con. Mỗi mục kèm dòng tài liệu hướng dẫn
 * hoặc checklist thiết bị (solution_items). Danh mục dùng chung toàn hệ thống — mọi
 * vai trò xem được; tạo/sửa cấp gốc cần solution.manageRoot (admin), mục con cần
 * solution.manageChild (admin/manager).
 */
import { rows, one, scalar, query } from '../db.js';
import { badRequest, notFound, unprocessable } from '../lib/errors.js';
import { assertPerm } from '../lib/rbac.js';
import { str, uuid, int, bool, enumOf, paging } from '../lib/validate.js';
import { consumeMultipart, deleteFile } from '../lib/storage.js';
import { audit } from '../lib/audit.js';

const GROUPS = ['ubtech', 'stickem', 'weeemake', 'other'];
const LEVELS = ['primary', 'secondary', 'highschool'];
const ITEM_KINDS = ['doc', 'checklist'];

const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

/** Quyền quản lý theo cấp: mục gốc cần manageRoot, mục con cần manageChild. */
function assertManage(user, solution) {
  assertPerm(user, solution.parent_id ? 'solution.manageChild' : 'solution.manageRoot');
}

export default async function routes(app) {
  /* ------------------------------------------------------------------------
   * GET /api/solutions — cây danh mục (?grp=&level=), mọi vai trò.
   * Bộ lọc áp cho mục gốc; mục con luôn đi kèm mục gốc của nó.
   * ---------------------------------------------------------------------- */
  app.get('/api/solutions', async (req) => {
    const grp = enumOf(req.query.grp, 'grp', GROUPS);
    const level = enumOf(req.query.level, 'level', LEVELS);

    const params = [];
    const conds = ['parent_id is null', 'is_active'];
    if (grp) { params.push(grp); conds.push(`grp = $${params.length}`); }
    // level null = dùng cho mọi cấp ⇒ luôn được gồm khi lọc theo cấp học.
    if (level) { params.push(level); conds.push(`(level is null or level = $${params.length})`); }

    const roots = await rows(
      `select * from solutions where ${conds.join(' and ')} order by sort_order, name`,
      params
    );
    const rootIds = roots.map((r) => r.id);

    const children = rootIds.length
      ? await rows(
          `select * from solutions where parent_id = any($1) and is_active order by sort_order, name`,
          [rootIds]
        )
      : [];

    // Đếm số dòng tài liệu/checklist của từng mục trong một truy vấn.
    const allIds = rootIds.concat(children.map((c) => c.id));
    const counts = allIds.length
      ? await rows(
          `select solution_id, count(*)::int as items_count
             from solution_items where solution_id = any($1) group by solution_id`,
          [allIds]
        )
      : [];
    const countMap = new Map(counts.map((c) => [c.solution_id, c.items_count]));

    const byParent = new Map();
    for (const c of children) {
      if (!byParent.has(c.parent_id)) byParent.set(c.parent_id, []);
      byParent.get(c.parent_id).push({ ...c, items_count: countMap.get(c.id) || 0 });
    }

    const items = roots.map((r) => ({
      ...r,
      items_count: countMap.get(r.id) || 0,
      children: byParent.get(r.id) || [],
    }));
    return { items };
  });

  /* ------------------------------------------------------------------------
   * POST /api/solutions — tạo mục. Cấp gốc: manageRoot · mục con: manageChild.
   * ---------------------------------------------------------------------- */
  app.post('/api/solutions', async (req, reply) => {
    const b = req.body || {};
    const parentId = uuid(b.parent_id, 'parent_id');

    if (parentId) {
      assertPerm(req.user, 'solution.manageChild');
      const parent = await one('select id, parent_id from solutions where id = $1 and is_active', [parentId]);
      if (!parent) throw badRequest('Mục cha không tồn tại hoặc đã bị vô hiệu.');
      if (parent.parent_id) {
        throw unprocessable('Danh mục giải pháp chỉ hỗ trợ 2 cấp — không thể tạo mục con của một mục con.');
      }
    } else {
      assertPerm(req.user, 'solution.manageRoot');
    }

    const grp = enumOf(b.grp, 'grp', GROUPS, { required: true });
    const name = str(b.name, 'name', { required: true, max: 200 });
    const level = enumOf(b.level, 'level', LEVELS);
    const description = str(b.description, 'description', { max: 5000 });
    const sortOrder = int(b.sort_order, 'sort_order', { def: 0, min: 0, max: 1_000_000 });

    const s = await one(
      `insert into solutions (parent_id, grp, name, level, description, sort_order, created_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [parentId, grp, name, level, description, sortOrder, req.user.id]
    );

    audit(req, {
      action: 'create', entity: 'solutions', entityId: s.id,
      summary: `Tạo mục giải pháp "${s.name}"${parentId ? ' (mục con)' : ' (cấp gốc)'}`, after: s,
    });
    return reply.code(201).send(s);
  });

  /* ------------------------------------------------------------------------
   * PATCH /api/solutions/:id — sửa mục (quyền theo cấp).
   * ---------------------------------------------------------------------- */
  app.patch('/api/solutions/:id', async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const s = await one('select * from solutions where id = $1', [id]);
    if (!s) throw notFound('Không tìm thấy mục giải pháp.');
    assertManage(req.user, s);

    const b = req.body || {};
    const updates = {};
    if (has(b, 'grp')) updates.grp = enumOf(b.grp, 'grp', GROUPS, { required: true });
    if (has(b, 'name')) updates.name = str(b.name, 'name', { required: true, max: 200 });
    if (has(b, 'level')) updates.level = enumOf(b.level, 'level', LEVELS);
    if (has(b, 'description')) updates.description = str(b.description, 'description', { max: 5000 });
    if (has(b, 'sort_order')) updates.sort_order = int(b.sort_order, 'sort_order', { required: true, min: 0, max: 1_000_000 });
    if (has(b, 'is_active')) updates.is_active = bool(b.is_active, 'is_active', { required: true });

    const keys = Object.keys(updates);
    if (!keys.length) throw badRequest('Không có thông tin nào để cập nhật.');

    const params = [id];
    const sets = keys.map((k) => { params.push(updates[k]); return `${k} = $${params.length}`; });
    const updated = await one(`update solutions set ${sets.join(', ')} where id = $1 returning *`, params);

    const before = {};
    for (const k of keys) before[k] = s[k];
    audit(req, {
      action: 'update', entity: 'solutions', entityId: id,
      summary: `Sửa mục giải pháp "${s.name}"`, before, after: updates,
    });
    return updated;
  });

  /* ------------------------------------------------------------------------
   * DELETE /api/solutions/:id — xoá mềm (is_active = false).
   * ---------------------------------------------------------------------- */
  app.delete('/api/solutions/:id', async (req, reply) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const s = await one('select * from solutions where id = $1', [id]);
    if (!s) throw notFound('Không tìm thấy mục giải pháp.');
    assertManage(req.user, s);

    await query('update solutions set is_active = false where id = $1', [id]);
    audit(req, {
      action: 'delete', entity: 'solutions', entityId: id,
      summary: `Vô hiệu mục giải pháp "${s.name}" (xoá mềm)`,
      before: { is_active: s.is_active }, after: { is_active: false },
    });
    return reply.code(204).send();
  });

  /* ------------------------------------------------------------------------
   * GET /api/solutions/:id/items — tài liệu + checklist của mục, mọi vai trò.
   * ---------------------------------------------------------------------- */
  app.get('/api/solutions/:id/items', async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const s = await one('select id from solutions where id = $1', [id]);
    if (!s) throw notFound('Không tìm thấy mục giải pháp.');

    const { page, limit, offset } = paging(req.query);
    const total = await scalar('select count(*)::int from solution_items where solution_id = $1', [id]);
    const items = await rows(
      `select i.*, f.file_name, f.size_bytes, f.mime
         from solution_items i
         left join files f on f.id = i.file_id
        where i.solution_id = $1
        order by i.sort_order, i.created_at
        limit $2 offset $3`,
      [id, limit, offset]
    );
    return { items, total, page, limit };
  });

  /* ------------------------------------------------------------------------
   * POST /api/solutions/:id/items — thêm dòng: multipart (kèm tệp) hoặc JSON.
   * kind='doc' thường kèm tệp hướng dẫn; kind='checklist' kèm qty.
   * ---------------------------------------------------------------------- */
  app.post('/api/solutions/:id/items', async (req, reply) => {
    assertPerm(req.user, 'solution.manageChild');
    const id = uuid(req.params.id, 'id', { required: true });
    const s = await one('select id, name from solutions where id = $1 and is_active', [id]);
    if (!s) throw notFound('Không tìm thấy mục giải pháp.');

    // Nhận cả multipart lẫn JSON thuần — tài liệu giải pháp dùng chung nên tệp không gắn trường.
    let fields = req.body || {};
    let uploaded = null;
    let fileId = null;
    if (req.isMultipart()) {
      const consumed = await consumeMultipart(req, { userId: req.user.id, schoolId: null });
      fields = consumed.fields;
      uploaded = consumed.files;
      fileId = (consumed.files.file && consumed.files.file[0] && consumed.files.file[0].id) || null;
    }

    let item;
    try {
      const kind = enumOf(fields.kind, 'kind', ITEM_KINDS, { required: true });
      const label = str(fields.label, 'label', { required: true, max: 300 });
      const qty = int(fields.qty, 'qty', { min: 0, max: 1_000_000 });
      const note = str(fields.note, 'note', { max: 2000 });
      const sortOrder = int(fields.sort_order, 'sort_order', { def: 0, min: 0, max: 1_000_000 });

      item = await one(
        `insert into solution_items (solution_id, kind, label, file_id, qty, note, sort_order)
         values ($1,$2,$3,$4,$5,$6,$7) returning *`,
        [id, kind, label, fileId, qty, note, sortOrder]
      );
    } catch (e) {
      // Nghiệp vụ hỏng giữa chừng ⇒ dọn tệp đã lỡ lưu.
      if (uploaded) {
        const all = Object.values(uploaded).flat();
        await Promise.all(all.map((f) => deleteFile(f.id).catch(() => {})));
      }
      throw e;
    }

    audit(req, {
      action: 'create', entity: 'solution_items', entityId: item.id,
      summary: `Thêm ${item.kind === 'doc' ? 'tài liệu' : 'checklist'} "${item.label}" vào giải pháp "${s.name}"`,
      after: item,
    });
    return reply.code(201).send(item);
  });

  /* ------------------------------------------------------------------------
   * PATCH /api/solutions/items/:itemId — sửa dòng (admin/manager).
   * ---------------------------------------------------------------------- */
  app.patch('/api/solutions/items/:itemId', async (req) => {
    assertPerm(req.user, 'solution.manageChild');
    const itemId = uuid(req.params.itemId, 'itemId', { required: true });
    const item = await one('select * from solution_items where id = $1', [itemId]);
    if (!item) throw notFound('Không tìm thấy tài liệu/checklist của giải pháp.');

    const b = req.body || {};
    const updates = {};
    if (has(b, 'kind')) updates.kind = enumOf(b.kind, 'kind', ITEM_KINDS, { required: true });
    if (has(b, 'label')) updates.label = str(b.label, 'label', { required: true, max: 300 });
    if (has(b, 'qty')) updates.qty = int(b.qty, 'qty', { min: 0, max: 1_000_000 });
    if (has(b, 'note')) updates.note = str(b.note, 'note', { max: 2000 });
    if (has(b, 'sort_order')) updates.sort_order = int(b.sort_order, 'sort_order', { required: true, min: 0, max: 1_000_000 });

    const keys = Object.keys(updates);
    if (!keys.length) throw badRequest('Không có thông tin nào để cập nhật.');

    const params = [itemId];
    const sets = keys.map((k) => { params.push(updates[k]); return `${k} = $${params.length}`; });
    const updated = await one(`update solution_items set ${sets.join(', ')} where id = $1 returning *`, params);

    const before = {};
    for (const k of keys) before[k] = item[k];
    audit(req, {
      action: 'update', entity: 'solution_items', entityId: itemId,
      summary: `Sửa dòng "${item.label}" của danh mục giải pháp`, before, after: updates,
    });
    return updated;
  });

  /* ------------------------------------------------------------------------
   * DELETE /api/solutions/items/:itemId — xoá hẳn dòng (không xoá mềm).
   * ---------------------------------------------------------------------- */
  app.delete('/api/solutions/items/:itemId', async (req, reply) => {
    assertPerm(req.user, 'solution.manageChild');
    const itemId = uuid(req.params.itemId, 'itemId', { required: true });
    const item = await one('select * from solution_items where id = $1', [itemId]);
    if (!item) throw notFound('Không tìm thấy tài liệu/checklist của giải pháp.');

    await query('delete from solution_items where id = $1', [itemId]);
    audit(req, {
      action: 'delete', entity: 'solution_items', entityId: itemId,
      summary: `Xoá dòng "${item.label}" khỏi danh mục giải pháp`, before: item,
    });
    return reply.code(204).send();
  });
}
