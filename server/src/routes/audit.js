/**
 * routes/audit.js — Nhật ký thao tác (docs/API.md mục 14). Chỉ admin (audit.view).
 *
 * GET /api/audit — ?entity=&entity_id=&actor_id=&from=&to=&action=&q=&page=&limit=
 * Trả { items, total, page, limit }, sắp theo created_at giảm dần, kèm tên người thao tác.
 */
import { rows, scalar } from '../db.js';
import { requirePerm } from '../lib/rbac.js';
import { str, uuid, dateStr, paging } from '../lib/validate.js';

export default async function routes(app) {
  app.get('/api/audit', { preHandler: requirePerm('audit.view') }, async (req) => {
    const { page, limit, offset } = paging(req.query);

    const entity = str(req.query.entity, 'entity', { max: 100 });
    const entityId = str(req.query.entity_id, 'entity_id', { max: 100 });
    const actorId = uuid(req.query.actor_id, 'actor_id');
    const from = dateStr(req.query.from, 'from');
    const to = dateStr(req.query.to, 'to');
    const action = str(req.query.action, 'action', { max: 100 });
    const q = str(req.query.q, 'q', { max: 200 });

    // Ghép WHERE động — chỉ thêm điều kiện cho tham số có mặt.
    const where = [];
    const params = [];
    const add = (sql, value) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };

    if (entity) add('a.entity = ?', entity);
    if (entityId) add('a.entity_id = ?', entityId);
    if (actorId) add('a.actor_id = ?', actorId);
    if (action) add('a.action = ?', action);
    if (from) add('a.created_at >= ?::date', from);
    if (to) add("a.created_at < ?::date + interval '1 day'", to); // gồm trọn ngày `to`
    if (q) add('a.summary ilike ?', `%${q}%`);

    const whereSql = where.length ? where.join(' and ') : 'true';

    const total = await scalar(`select count(*) from audit_log a where ${whereSql}`, params);

    const items = await rows(
      `select a.id, a.actor_id, a.actor_email, u.full_name as actor_name,
              a.action, a.entity, a.entity_id, a.summary,
              a.before_data, a.after_data, a.ip, a.user_agent, a.created_at
         from audit_log a
         left join users u on u.id = a.actor_id
        where ${whereSql}
        order by a.created_at desc, a.id desc
        limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, limit, offset]
    );

    return { items, total: Number(total) || 0, page, limit };
  });
}
