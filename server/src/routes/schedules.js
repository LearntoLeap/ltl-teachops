/**
 * routes/schedules.js — Lịch dạy & phân công (docs/API.md mục 4).
 *
 * Quy tắc chính:
 *   - Mọi danh sách đều lọc phạm vi bằng scheduleFilter() (lib/scope.js).
 *   - Trùng lịch = cùng người, cùng ngày, khung giờ giao nhau, status <> 'cancelled' → 409.
 *   - Buổi đã có chấm công: cấm đổi ngày giờ/người, không xoá cứng — chỉ huỷ (bảo vệ dữ liệu lương).
 *   - "Hôm nay" tính theo múi giờ Việt Nam: (now() at time zone 'Asia/Ho_Chi_Minh')::date.
 */
import { query, rows, one, scalar, tx } from '../db.js';
import { requirePerm } from '../lib/rbac.js';
import {
  scheduleFilter,
  combine,
  assertSchoolAccess,
  assertScheduleAccess,
} from '../lib/scope.js';
import { badRequest, conflict, unprocessable } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { str, uuid, int, enumOf, dateStr, timeStr, paging, dateRange } from '../lib/validate.js';

const SCHEDULE_STATUSES = ['scheduled', 'done', 'cancelled'];
const MAX_BULK_SESSIONS = 120;

/** Các cột "ngày giờ/người" — khoá lại khi buổi đã có người check-in. */
const TIMING_FIELDS = ['session_date', 'start_time', 'end_time', 'teacher_id', 'assistant_id'];
/** Các cột đưa vào nhật ký before/after (không đổ nguyên bản ghi join). */
const AUDIT_FIELDS = [
  'session_date', 'start_time', 'end_time', 'room_id',
  'teacher_id', 'assistant_id', 'subject', 'status', 'note',
];

const hhmm = (t) => String(t || '').slice(0, 5);
const pickAudit = (o) => Object.fromEntries(AUDIT_FIELDS.map((k) => [k, o[k]]));

/* --------------------------------------------------------------------------
 * Truy vấn chi tiết dùng chung: buổi dạy + tên trường/lớp/người/phòng + cờ.
 * ------------------------------------------------------------------------ */
const DETAIL_SELECT = `
  select s.*,
         sc.name as school_name,
         c.name  as class_name,
         t.full_name as teacher_name,
         a.full_name as assistant_name,
         r.name  as room_name,
         exists (select 1 from timesheets ts  where ts.schedule_id  = s.id) as has_timesheet,
         exists (select 1 from attendance att where att.schedule_id = s.id) as has_attendance
    from schedules s
    join schools sc on sc.id = s.school_id
    join classes c  on c.id  = s.class_id
    left join users t on t.id = s.teacher_id
    left join users a on a.id = s.assistant_id
    left join stem_rooms r on r.id = s.room_id`;

function scheduleDetail(id) {
  return one(`${DETAIL_SELECT} where s.id = $1`, [id]);
}

/* --------------------------------------------------------------------------
 * Kiểm tra trùng lịch: một người không thể có hai buổi giao nhau về giờ
 * trong cùng một ngày (bỏ qua buổi đã huỷ).
 * `q` là hàm query (pool hoặc client trong tx) để dùng được cả trong giao dịch.
 * ------------------------------------------------------------------------ */
async function findOverlap(q, { userId, date, start, end, excludeId = null }) {
  const r = await q(
    `select u.full_name, s2.start_time, s2.end_time,
            c2.name as class_name, sc2.name as school_name
       from schedules s2
       join classes c2  on c2.id  = s2.class_id
       join schools sc2 on sc2.id = s2.school_id
       join users u     on u.id   = $2
      where s2.session_date = $1
        and s2.status <> 'cancelled'
        and (s2.teacher_id = $2 or s2.assistant_id = $2)
        and s2.start_time < $3::time
        and s2.end_time   > $4::time
        and ($5::uuid is null or s2.id <> $5::uuid)
      limit 1`,
    [date, userId, end, start, excludeId]
  );
  return r.rows[0] || null;
}

function overlapMessage(hit, date) {
  return `${hit.full_name} đã có buổi dạy trùng giờ ngày ${date} ` +
    `(${hit.school_name} — lớp ${hit.class_name}, ${hhmm(hit.start_time)}–${hhmm(hit.end_time)}).`;
}

/* --------------------------------------------------------------------------
 * Kiểm tra tham chiếu: lớp/phòng đúng trường, người đúng vai trò & đang hoạt động.
 * ------------------------------------------------------------------------ */
async function assertClassInSchool(classId, schoolId) {
  const cls = await one('select id, school_id, name from classes where id = $1', [classId]);
  if (!cls || cls.school_id !== schoolId) throw unprocessable('Lớp không thuộc trường đã chọn.');
  return cls;
}

async function assertRoomInSchool(roomId, schoolId) {
  const room = await one('select id, school_id, name from stem_rooms where id = $1', [roomId]);
  if (!room || room.school_id !== schoolId) throw unprocessable('Phòng STEM không thuộc trường đã chọn.');
  return room;
}

async function assertActiveStaff(userId, role, label) {
  const u = await one('select id, full_name, role, is_active from users where id = $1', [userId]);
  if (!u || u.role !== role || !u.is_active) {
    throw unprocessable(`${label} được chọn không hợp lệ — phải là tài khoản ${label.toLowerCase()} đang hoạt động.`);
  }
  return u;
}

/**
 * Ép kiểu + kiểm tra phần thân dùng chung cho POST đơn và POST /bulk
 * (trường, lớp, phòng, người dạy, khung giờ — chưa gồm ngày).
 */
async function validateSessionCore(user, b) {
  const schoolId = uuid(b.school_id, 'school_id', { required: true });
  const classId = uuid(b.class_id, 'class_id', { required: true });
  const roomId = uuid(b.room_id, 'room_id');
  const teacherId = uuid(b.teacher_id, 'teacher_id');
  const assistantId = uuid(b.assistant_id, 'assistant_id');
  const startTime = timeStr(b.start_time, 'start_time', { required: true });
  const endTime = timeStr(b.end_time, 'end_time', { required: true });
  const subject = str(b.subject, 'subject', { max: 200 });

  if (endTime <= startTime) throw badRequest('Giờ kết thúc phải sau giờ bắt đầu.');
  if (teacherId && assistantId && teacherId === assistantId) {
    throw badRequest('Giáo viên và trợ giảng phải là hai người khác nhau.');
  }

  const school = await assertSchoolAccess(user, schoolId);
  const cls = await assertClassInSchool(classId, schoolId);
  if (roomId) await assertRoomInSchool(roomId, schoolId);
  const teacher = teacherId ? await assertActiveStaff(teacherId, 'teacher', 'Giáo viên') : null;
  const assistant = assistantId ? await assertActiveStaff(assistantId, 'assistant', 'Trợ giảng') : null;

  return {
    schoolId, classId, roomId, teacherId, assistantId,
    startTime, endTime, subject, school, cls, teacher, assistant,
  };
}

export default async function routes(app) {
  /* ------------------------------------------------------------------------
   * GET /api/schedules — danh sách theo phạm vi, lọc + phân trang.
   * ---------------------------------------------------------------------- */
  app.get('/api/schedules', async (req) => {
    const { from, to } = dateRange(req.query);
    const schoolId = uuid(req.query.school_id, 'school_id');
    const classId = uuid(req.query.class_id, 'class_id');
    const userId = uuid(req.query.user_id, 'user_id');
    const status = enumOf(req.query.status, 'status', SCHEDULE_STATUSES);
    const { page, limit, offset } = paging(req.query);

    const params = [from, to];
    const conds = ['s.session_date >= $1', 's.session_date <= $2'];
    if (schoolId) {
      params.push(schoolId);
      conds.push(`s.school_id = $${params.length}`);
    }
    if (classId) {
      params.push(classId);
      conds.push(`s.class_id = $${params.length}`);
    }
    if (userId) {
      params.push(userId);
      conds.push(`(s.teacher_id = $${params.length} or s.assistant_id = $${params.length})`);
    }
    if (status) {
      params.push(status);
      conds.push(`s.status = $${params.length}`);
    }

    const scope = await scheduleFilter(req.user, 's', params.length + 1);
    const { where, params: scopeParams } = combine(conds.join(' and '), scope);
    const allParams = [...params, ...scopeParams];

    const total = Number(await scalar(`select count(*) from schedules s where ${where}`, allParams)) || 0;
    const items = await rows(
      `${DETAIL_SELECT}
        where ${where}
        order by s.session_date, s.start_time
        limit $${allParams.length + 1} offset $${allParams.length + 2}`,
      [...allParams, limit, offset]
    );

    return { items, total, page, limit };
  });

  /* ------------------------------------------------------------------------
   * GET /api/schedules/today — buổi HÔM NAY (giờ Việt Nam) trong phạm vi của tôi,
   * kèm trạng thái chấm công của tôi và cờ đã điểm danh. Không phân trang.
   * ---------------------------------------------------------------------- */
  app.get('/api/schedules/today', async (req) => {
    const params = [req.user.id];
    const conds = [
      // session_date là DATE — so tường minh theo múi giờ VN, không dùng current_date
      `s.session_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date`,
      `s.status <> 'cancelled'`,
    ];
    const scope = await scheduleFilter(req.user, 's', params.length + 1);
    const { where, params: scopeParams } = combine(conds.join(' and '), scope);

    const items = await rows(
      `select s.*,
              sc.name as school_name,
              c.name  as class_name,
              t.full_name as teacher_name,
              a.full_name as assistant_name,
              r.name  as room_name,
              ts.check_in_at, ts.check_out_at, ts.label,
              (att.id is not null) as attendance_done
         from schedules s
         join schools sc on sc.id = s.school_id
         join classes c  on c.id  = s.class_id
         left join users t on t.id = s.teacher_id
         left join users a on a.id = s.assistant_id
         left join stem_rooms r on r.id = s.room_id
         left join timesheets ts on ts.schedule_id = s.id and ts.user_id = $1
         left join attendance att on att.schedule_id = s.id
        where ${where}
        order by s.start_time`,
      [...params, ...scopeParams]
    );

    return { items };
  });

  /* ------------------------------------------------------------------------
   * POST /api/schedules — tạo một buổi.
   * ---------------------------------------------------------------------- */
  app.post('/api/schedules', { preHandler: requirePerm('schedule.manage') }, async (req, reply) => {
    const b = req.body || {};
    const core = await validateSessionCore(req.user, b);
    const sessionDate = dateStr(b.session_date, 'session_date', { required: true });
    const note = str(b.note, 'note');

    // Kiểm trùng lịch cho từng người tham gia buổi này
    for (const p of [core.teacher, core.assistant].filter(Boolean)) {
      const hit = await findOverlap(query, {
        userId: p.id, date: sessionDate, start: core.startTime, end: core.endTime,
      });
      if (hit) throw conflict(overlapMessage(hit, sessionDate));
    }

    const created = await one(
      `insert into schedules
         (school_id, class_id, room_id, teacher_id, assistant_id,
          session_date, start_time, end_time, subject, note, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       returning *`,
      [core.schoolId, core.classId, core.roomId, core.teacherId, core.assistantId,
        sessionDate, core.startTime, core.endTime, core.subject, note, req.user.id]
    );

    audit(req, {
      action: 'create',
      entity: 'schedules',
      entityId: created.id,
      summary: `Tạo buổi dạy ${sessionDate} ${hhmm(core.startTime)}–${hhmm(core.endTime)} — ` +
        `${core.school.name} / lớp ${core.cls.name}.`,
      after: pickAudit(created),
    });

    reply.code(201);
    return scheduleDetail(created.id);
  });

  /* ------------------------------------------------------------------------
   * POST /api/schedules/bulk — sinh lịch lặp theo thứ trong tuần.
   * Buổi trùng lịch được BỎ QUA và liệt kê trong `skipped`.
   * ---------------------------------------------------------------------- */
  app.post('/api/schedules/bulk', { preHandler: requirePerm('schedule.manage') }, async (req) => {
    const b = req.body || {};
    const core = await validateSessionCore(req.user, b);
    const from = dateStr(b.from, 'from', { required: true });
    const to = dateStr(b.to, 'to', { required: true });
    if (from > to) throw badRequest('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');

    if (!Array.isArray(b.weekdays) || !b.weekdays.length) {
      throw badRequest('Thiếu danh sách thứ trong tuần (weekdays: 1=Thứ Hai … 7=Chủ nhật).');
    }
    const weekdays = [...new Set(
      b.weekdays.map((w, i) => int(w, `weekdays[${i}]`, { required: true, min: 1, max: 7 }))
    )];

    const startD = new Date(`${from}T00:00:00Z`);
    const stopD = new Date(`${to}T00:00:00Z`);
    // Chặn khoảng ngày quá dài trước khi sinh danh sách
    if (Math.round((stopD - startD) / 86400000) + 1 > 400) {
      throw badRequest('Khoảng ngày quá dài — mỗi lần tạo hàng loạt tối đa khoảng 400 ngày.');
    }

    // Sinh mọi ngày trong [from, to] rơi vào các thứ đã chọn (1=Thứ Hai … 7=Chủ nhật)
    const dates = [];
    for (let d = new Date(startD); d <= stopD; d.setUTCDate(d.getUTCDate() + 1)) {
      const isoWeekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
      if (weekdays.includes(isoWeekday)) dates.push(d.toISOString().slice(0, 10));
    }

    if (!dates.length) {
      throw badRequest('Không có ngày nào trong khoảng đã chọn rơi vào các thứ đã chọn.');
    }
    if (dates.length > MAX_BULK_SESSIONS) {
      throw badRequest(`Số buổi sinh ra (${dates.length}) vượt quá giới hạn ${MAX_BULK_SESSIONS} buổi một lần.`);
    }

    const people = [core.teacher, core.assistant].filter(Boolean);
    const skipped = [];
    let created = 0;

    await tx(async (c) => {
      const q = (text, params) => c.query(text, params);
      for (const date of dates) {
        // Buổi trùng lịch → bỏ qua, không làm hỏng cả loạt
        let clashMsg = null;
        for (const p of people) {
          const hit = await findOverlap(q, {
            userId: p.id, date, start: core.startTime, end: core.endTime,
          });
          if (hit) { clashMsg = overlapMessage(hit, date); break; }
        }
        if (clashMsg) {
          skipped.push({ date, reason: clashMsg });
          continue;
        }
        await q(
          `insert into schedules
             (school_id, class_id, room_id, teacher_id, assistant_id,
              session_date, start_time, end_time, subject, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [core.schoolId, core.classId, core.roomId, core.teacherId, core.assistantId,
            date, core.startTime, core.endTime, core.subject, req.user.id]
        );
        created += 1;
      }
    });

    audit(req, {
      action: 'create',
      entity: 'schedules',
      summary: `Tạo hàng loạt ${created} buổi dạy (${from} → ${to}, ` +
        `${hhmm(core.startTime)}–${hhmm(core.endTime)}) — ${core.school.name} / lớp ${core.cls.name}; ` +
        `bỏ qua ${skipped.length} buổi trùng lịch.`,
      after: {
        school_id: core.schoolId, class_id: core.classId, room_id: core.roomId,
        teacher_id: core.teacherId, assistant_id: core.assistantId,
        start_time: core.startTime, end_time: core.endTime,
        weekdays, from, to, created, skipped,
      },
    });

    return { created, skipped };
  });

  /* ------------------------------------------------------------------------
   * GET /api/schedules/:id — chi tiết một buổi (đã soát phạm vi).
   * ---------------------------------------------------------------------- */
  app.get('/api/schedules/:id', async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const s = await assertScheduleAccess(req.user, id);
    const flags = await one(
      `select exists (select 1 from timesheets  where schedule_id = $1) as has_timesheet,
              exists (select 1 from attendance where schedule_id = $1) as has_attendance`,
      [id]
    );
    return { ...s, ...flags };
  });

  /* ------------------------------------------------------------------------
   * PATCH /api/schedules/:id — sửa buổi. Đã có check-in ⇒ chỉ sửa
   * status/subject/note (bảo vệ dữ liệu chấm công).
   * ---------------------------------------------------------------------- */
  app.patch('/api/schedules/:id', { preHandler: requirePerm('schedule.manage') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const s = await assertScheduleAccess(req.user, id);
    const b = req.body || {};

    // Đổi trường/lớp làm sai lệch mọi dữ liệu liên quan — huỷ và tạo buổi mới thay vì sửa
    if (b.school_id !== undefined || b.class_id !== undefined) {
      throw unprocessable('Không thể đổi trường/lớp của buổi dạy — hãy huỷ buổi này và tạo buổi mới.');
    }

    const hasCheckIn = await scalar(
      'select exists (select 1 from timesheets where schedule_id = $1 and check_in_at is not null)',
      [id]
    );
    if (hasCheckIn) {
      const touched = [...TIMING_FIELDS, 'room_id'].filter((k) => b[k] !== undefined);
      if (touched.length) {
        throw unprocessable(
          'Buổi dạy đã có người chấm công — chỉ được sửa trạng thái, chủ đề và ghi chú để bảo vệ dữ liệu chấm công.'
        );
      }
    }

    const patch = {};
    if (b.session_date !== undefined) patch.session_date = dateStr(b.session_date, 'session_date', { required: true });
    if (b.start_time !== undefined) patch.start_time = timeStr(b.start_time, 'start_time', { required: true });
    if (b.end_time !== undefined) patch.end_time = timeStr(b.end_time, 'end_time', { required: true });
    if (b.room_id !== undefined) patch.room_id = uuid(b.room_id, 'room_id');                  // null = bỏ phòng
    if (b.teacher_id !== undefined) patch.teacher_id = uuid(b.teacher_id, 'teacher_id');      // null = bỏ phân công
    if (b.assistant_id !== undefined) patch.assistant_id = uuid(b.assistant_id, 'assistant_id');
    if (b.subject !== undefined) patch.subject = str(b.subject, 'subject', { max: 200 });
    if (b.note !== undefined) patch.note = str(b.note, 'note');
    if (b.status !== undefined) patch.status = enumOf(b.status, 'status', SCHEDULE_STATUSES, { required: true });

    if (!Object.keys(patch).length) throw badRequest('Không có dữ liệu nào để cập nhật.');

    // Giá trị hiệu lực sau khi vá — dùng để kiểm giờ và trùng lịch
    const eff = {
      session_date: patch.session_date ?? s.session_date,
      start_time: patch.start_time ?? s.start_time,
      end_time: patch.end_time ?? s.end_time,
      teacher_id: patch.teacher_id !== undefined ? patch.teacher_id : s.teacher_id,
      assistant_id: patch.assistant_id !== undefined ? patch.assistant_id : s.assistant_id,
    };

    if (String(eff.end_time) <= String(eff.start_time)) {
      throw badRequest('Giờ kết thúc phải sau giờ bắt đầu.');
    }
    if (eff.teacher_id && eff.assistant_id && eff.teacher_id === eff.assistant_id) {
      throw badRequest('Giáo viên và trợ giảng phải là hai người khác nhau.');
    }

    if (patch.teacher_id) await assertActiveStaff(patch.teacher_id, 'teacher', 'Giáo viên');
    if (patch.assistant_id) await assertActiveStaff(patch.assistant_id, 'assistant', 'Trợ giảng');
    if (patch.room_id) await assertRoomInSchool(patch.room_id, s.school_id);

    // Đổi người/ngày/giờ ⇒ kiểm trùng lịch như khi tạo mới (loại trừ chính buổi này)
    if (TIMING_FIELDS.some((k) => patch[k] !== undefined)) {
      for (const pid of [eff.teacher_id, eff.assistant_id].filter(Boolean)) {
        const hit = await findOverlap(query, {
          userId: pid,
          date: eff.session_date,
          start: eff.start_time,
          end: eff.end_time,
          excludeId: id,
        });
        if (hit) throw conflict(overlapMessage(hit, eff.session_date));
      }
    }

    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(patch)) {
      vals.push(v);
      sets.push(`${k} = $${vals.length}`);   // k thuộc danh sách trắng ở trên, an toàn
    }
    vals.push(id);
    const updated = await one(
      `update schedules set ${sets.join(', ')} where id = $${vals.length} returning *`,
      vals
    );

    audit(req, {
      action: 'update',
      entity: 'schedules',
      entityId: id,
      summary: `Sửa buổi dạy ${s.session_date} — ${s.school_name} / lớp ${s.class_name}.`,
      before: pickAudit(s),
      after: pickAudit(updated),
    });

    return scheduleDetail(id);
  });

  /* ------------------------------------------------------------------------
   * DELETE /api/schedules/:id — đã có chấm công ⇒ chỉ huỷ (giữ dữ liệu);
   * chưa có gì ⇒ xoá hẳn. Lý do huỷ lấy từ ?reason=.
   * ---------------------------------------------------------------------- */
  app.delete('/api/schedules/:id', { preHandler: requirePerm('schedule.manage') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const s = await assertScheduleAccess(req.user, id);
    const reason = str(req.query.reason, 'reason', { max: 500 });

    const hasTimesheet = await scalar(
      'select exists (select 1 from timesheets where schedule_id = $1)',
      [id]
    );

    if (hasTimesheet) {
      // Đã có dữ liệu chấm công → không xoá cứng, chỉ chuyển sang huỷ
      const note = reason
        ? (s.note ? `${s.note}\n[Huỷ] ${reason}` : `[Huỷ] ${reason}`)
        : s.note;
      const updated = await one(
        `update schedules set status = 'cancelled', note = $2 where id = $1 returning *`,
        [id, note]
      );
      audit(req, {
        action: 'cancel',
        entity: 'schedules',
        entityId: id,
        summary: `Huỷ buổi dạy ${s.session_date} — ${s.school_name} / lớp ${s.class_name} ` +
          `(đã có chấm công nên không xoá).${reason ? ` Lý do: ${reason}` : ''}`,
        before: pickAudit(s),
        after: pickAudit(updated),
      });
      return { cancelled: true, id, status: 'cancelled' };
    }

    await query('delete from schedules where id = $1', [id]);
    audit(req, {
      action: 'delete',
      entity: 'schedules',
      entityId: id,
      summary: `Xoá buổi dạy ${s.session_date} — ${s.school_name} / lớp ${s.class_name}.` +
        `${reason ? ` Lý do: ${reason}` : ''}`,
      before: pickAudit(s),
    });
    return { deleted: true, id };
  });
}
