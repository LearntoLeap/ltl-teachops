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
import { requirePerm, assertPerm, can, isFieldStaff } from '../lib/rbac.js';
import {
  scheduleFilter,
  combine,
  assertSchoolAccess,
  assertScheduleAccess,
} from '../lib/scope.js';
import { badRequest, conflict, unprocessable } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { notify, notifySchoolManagers } from '../lib/notify.js';
import { str, uuid, int, enumOf, dateStr, timeStr, paging, dateRange } from '../lib/validate.js';
import { periodTimes, MIN_PERIOD, MAX_PERIOD } from '../lib/periods.js';

const SCHEDULE_STATUSES = ['scheduled', 'done', 'cancelled', 'skipped'];
const MAX_BULK_SESSIONS = 120;

/** Các cột "ngày giờ/người" — khoá lại khi buổi đã có người check-in. */
const TIMING_FIELDS = ['session_date', 'start_time', 'end_time', 'period', 'teacher_id', 'assistant_id'];
/** Các cột đưa vào nhật ký before/after (không đổ nguyên bản ghi join). */
const AUDIT_FIELDS = [
  'session_date', 'start_time', 'end_time', 'room_id',
  'teacher_id', 'assistant_id', 'subject', 'status', 'note',
  'period', 'teacher_manual_name', 'assistant_manual_name',
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
         coalesce(t.full_name, s.teacher_manual_name)   as teacher_name,
         coalesce(a.full_name, s.assistant_manual_name) as assistant_name,
         cb.full_name as added_by_name,
         r.name  as room_name,
         c.roster_size,
         schedule_session(s.period, s.start_time) as work_session,
         exists (select 1 from timesheets ts  where ts.schedule_id  = s.id) as has_timesheet,
         exists (select 1 from attendance att where att.schedule_id = s.id) as has_attendance
    from schedules s
    join schools sc on sc.id = s.school_id
    join classes c  on c.id  = s.class_id
    left join users t on t.id = s.teacher_id
    left join users a on a.id = s.assistant_id
    left join users cb on cb.id = s.created_by
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
  const cls = await one('select id, school_id, name, is_active from classes where id = $1', [classId]);
  if (!cls || cls.school_id !== schoolId) throw unprocessable('Lớp không thuộc trường đã chọn.');
  if (!cls.is_active) {
    throw unprocessable(`Lớp "${cls.name}" đã ngừng sử dụng — khôi phục lại lớp trước khi xếp buổi mới.`);
  }
  return cls;
}

async function assertRoomInSchool(roomId, schoolId) {
  const room = await one('select id, school_id, name, is_active from stem_rooms where id = $1', [roomId]);
  if (!room || room.school_id !== schoolId) throw unprocessable('Phòng STEM không thuộc trường đã chọn.');
  if (!room.is_active) {
    throw unprocessable(`Phòng "${room.name}" đã ngừng sử dụng — chọn phòng khác hoặc khôi phục lại phòng.`);
  }
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
  const subject = str(b.subject, 'subject', { max: 200 });

  // Xếp lịch theo TIẾT: giờ suy ra từ khung tiết. Vẫn nhận start/end trực tiếp
  // cho nhập bảng và các bản ghi cũ.
  // Tiết ⇒ giờ được quy đổi SAU, theo đúng ngày dạy (xem timesAt). Không chọn
  // tiết thì phải gửi giờ trực tiếp (nhập bảng, buổi ngoài khung).
  const period = int(b.period, 'Tiết', { min: MIN_PERIOD, max: MAX_PERIOD });
  let startTime = null;
  let endTime = null;
  if (!period) {
    startTime = timeStr(b.start_time, 'start_time', { required: true });
    endTime = timeStr(b.end_time, 'end_time', { required: true });
  }

  // Tên gõ tay — dùng khi người dạy chưa có tài khoản trong hệ thống.
  // Chọn được tài khoản rồi thì tên gõ tay bị bỏ, tránh hai nguồn sự thật.
  const teacherManual = teacherId ? null : str(b.teacher_manual_name, 'Tên giáo viên', { max: 120 });
  const assistantManual = assistantId ? null : str(b.assistant_manual_name, 'Tên trợ giảng', { max: 120 });

  if (startTime && endTime <= startTime) throw badRequest('Giờ kết thúc phải sau giờ bắt đầu.');
  if (teacherId && assistantId && teacherId === assistantId) {
    throw badRequest('Giáo viên và trợ giảng phải là hai người khác nhau.');
  }

  const school = await assertSchoolAccess(user, schoolId);
  if (!school.is_active) {
    throw unprocessable(`Trường "${school.name}" đã ngừng sử dụng — khôi phục lại trường trước khi xếp buổi mới.`);
  }
  const cls = await assertClassInSchool(classId, schoolId);
  if (roomId) await assertRoomInSchool(roomId, schoolId);
  const teacher = teacherId ? await assertActiveStaff(teacherId, 'teacher', 'Giáo viên') : null;
  const assistant = assistantId ? await assertActiveStaff(assistantId, 'assistant', 'Trợ giảng') : null;

  return {
    schoolId, classId, roomId, teacherId, assistantId,
    startTime, endTime, period, teacherManual, assistantManual,
    subject, school, cls, teacher, assistant,
  };
}

/**
 * Giờ của buổi vào NGÀY cụ thể: có tiết thì tra bộ giờ học theo mùa của trường
 * (không có thì khung chung); không có tiết thì dùng giờ gửi trực tiếp.
 */
async function timesAt(core, date) {
  if (!core.period) return { startTime: core.startTime, endTime: core.endTime };
  const t = await periodTimes(core.period, { schoolId: core.schoolId, date });
  if (!t) {
    throw badRequest(`Tiết ${core.period} không có trong bộ giờ học của ${core.school.name} ngày ${date}.`);
  }
  return { startTime: t.start, endTime: t.end };
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
              coalesce(t.full_name, s.teacher_manual_name)   as teacher_name,
              coalesce(a.full_name, s.assistant_manual_name) as assistant_name,
              r.name  as room_name,
              ts.check_in_at, ts.check_out_at, ts.label,
              cb.full_name as added_by_name,
              schedule_session(s.period, s.start_time) as work_session,
              (att.id is not null) as attendance_done,
              att.present_count, att.roster_size as attendance_roster_size
         from schedules s
         left join users cb on cb.id = s.created_by
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
  app.post('/api/schedules', async (req, reply) => {
    const b = req.body || {};

    // GV/TG được TỰ thêm buổi bị thiếu — nhưng buổi phải gắn CHÍNH họ,
    // trường phải nằm trong phạm vi họ được phân công (assertSchoolAccess lo).
    const selfOnly = isFieldStaff(req.user);
    let selfReason = null;
    if (selfOnly) {
      assertPerm(req.user, 'schedule.selfCreate');
      if (req.user.role === 'teacher') b.teacher_id = req.user.id;
      else b.assistant_id = req.user.id;
      // Phải nói rõ VÌ SAO thiếu tiết này — không có lý do thì Phòng chuyên môn
      // không phân biệt được "lịch bị sót" với "khai thêm".
      selfReason = str(b.reason ?? b.self_added_reason, 'Lý do thêm tiết', { max: 500 });
      if (!selfReason || selfReason.length < 10) {
        throw badRequest('Vui lòng ghi rõ lý do thêm tiết bị thiếu (ít nhất 10 ký tự) để Phòng chuyên môn rà soát.');
      }
    } else {
      assertPerm(req.user, 'schedule.manage');
    }

    const core = await validateSessionCore(req.user, b);
    const sessionDate = dateStr(b.session_date, 'session_date', { required: true });
    Object.assign(core, await timesAt(core, sessionDate));
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
          session_date, start_time, end_time, period,
          teacher_manual_name, assistant_manual_name,
          subject, note, created_by, self_added, self_added_reason, self_added_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
               case when $15 then now() else null end)
       returning *`,
      [core.schoolId, core.classId, core.roomId, core.teacherId, core.assistantId,
        sessionDate, core.startTime, core.endTime, core.period,
        core.teacherManual, core.assistantManual,
        core.subject, note, req.user.id,
        // GV/TG tự thêm tiết bị thiếu ⇒ đánh dấu + lưu lý do để Phòng chuyên môn rà soát
        selfOnly, selfReason]
    );

    const tietLabel = created.period ? `tiết ${created.period}` : `${hhmm(core.startTime)}–${hhmm(core.endTime)}`;
    audit(req, {
      action: 'create',
      entity: 'schedules',
      entityId: created.id,
      summary: (selfOnly ? 'GV tự thêm ' : 'Tạo ') + `${tietLabel} ngày ${sessionDate} — ` +
        `${core.school.name} / lớp ${core.cls.name}` +
        (selfReason ? `. Lý do: ${selfReason}` : '.'),
      after: pickAudit(created),
    });

    // Tiết tự thêm phải tới tay Phòng chuyên môn ngay, kèm lý do — họ là người
    // quyết định có tính công cho tiết đó hay không.
    if (selfOnly) {
      notifySchoolManagers(core.schoolId, {
        kind: 'schedule_self_added',
        title: 'Giáo viên tự thêm tiết bị thiếu',
        body: `${req.user.full_name} thêm ${tietLabel} ngày ${sessionDate} — ` +
          `${core.school.name} / lớp ${core.cls.name}. Lý do: ${selfReason}`,
        link: '/lich?tu-them=1',
        refId: created.id,
      }).catch((e) => req.log.warn({ err: e }, 'Không gửi được thông báo schedule_self_added'));
    }

    reply.code(201);
    return scheduleDetail(created.id);
  });

  /* ------------------------------------------------------------------------
   * POST /api/schedules/batch — nhập NHIỀU buổi KHÁC NHAU một lượt (dạng bảng).
   *
   * Khác /bulk: /bulk lặp CÙNG một buổi theo thứ trong tuần; ở đây mỗi dòng là
   * một buổi độc lập (khác lớp, khác giờ, khác giáo viên) — dùng cho màn hình
   * nhập bảng hoặc dán dữ liệu từ Excel.
   *
   * body: { rows: [{ session_date, start_time, end_time, school_id, class_id,
   *                  teacher_id?, assistant_id?, room_id?, subject? }] }
   *
   * Dòng lỗi KHÔNG làm hỏng cả lượt: bỏ qua và trả về trong `skipped` kèm số
   * dòng + lý do, để người nhập biết sửa đúng chỗ nào.
   * ---------------------------------------------------------------------- */
  app.post('/api/schedules/batch', { preHandler: requirePerm('schedule.manage') }, async (req) => {
    const rowsIn = req.body?.rows;
    if (!Array.isArray(rowsIn) || !rowsIn.length) throw badRequest('Chưa có dòng nào để tạo.');
    if (rowsIn.length > MAX_BULK_SESSIONS) {
      throw badRequest(`Mỗi lượt nhập tối đa ${MAX_BULK_SESSIONS} dòng (đang có ${rowsIn.length}).`);
    }

    const skipped = [];
    let created = 0;

    for (let i = 0; i < rowsIn.length; i++) {
      const row = rowsIn[i] || {};
      try {
        const core = await validateSessionCore(req.user, row);
        const sessionDate = dateStr(row.session_date, 'session_date', { required: true });
        Object.assign(core, await timesAt(core, sessionDate));

        await tx(async (c) => {
          const q = (t, p) => c.query(t, p);
          // Trùng giờ của chính giáo viên/trợ giảng ⇒ bỏ qua dòng này
          for (const person of [core.teacher, core.assistant].filter(Boolean)) {
            const hit = await findOverlap(q, {
              userId: person.id, date: sessionDate,
              start: core.startTime, end: core.endTime,
            });
            if (hit) throw conflict(overlapMessage(hit, sessionDate));
          }
          await c.query(
            `insert into schedules
               (school_id, class_id, room_id, teacher_id, assistant_id,
                session_date, start_time, end_time, period,
                teacher_manual_name, assistant_manual_name, subject, created_by)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [core.schoolId, core.classId, core.roomId, core.teacherId, core.assistantId,
             sessionDate, core.startTime, core.endTime, core.period,
             core.teacherManual, core.assistantManual, core.subject, req.user.id]
          );
        });
        created++;
      } catch (e) {
        skipped.push({ row: i + 1, reason: e.message || 'Dòng không hợp lệ.' });
      }
    }

    if (created) {
      audit(req, {
        action: 'create', entity: 'schedules',
        summary: `Nhập bảng lịch dạy: tạo ${created} buổi` +
          `${skipped.length ? `, bỏ qua ${skipped.length} dòng` : ''}.`,
        after: { created, skipped },
      });
    }
    return { created, skipped };
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
        // Giờ theo mùa của đúng ngày này — lịch lặp vắt qua hai mùa vẫn đúng giờ.
        let at;
        try { at = await timesAt(core, date); } catch (e) {
          skipped.push({ date, reason: e.message });
          continue;
        }
        // Buổi trùng lịch → bỏ qua, không làm hỏng cả loạt
        let clashMsg = null;
        for (const p of people) {
          const hit = await findOverlap(q, {
            userId: p.id, date, start: at.startTime, end: at.endTime,
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
              session_date, start_time, end_time, period,
              teacher_manual_name, assistant_manual_name, subject, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [core.schoolId, core.classId, core.roomId, core.teacherId, core.assistantId,
            date, at.startTime, at.endTime, core.period,
            core.teacherManual, core.assistantManual, core.subject, req.user.id]
        );
        created += 1;
      }
    });

    audit(req, {
      action: 'create',
      entity: 'schedules',
      summary: `Tạo hàng loạt ${created} buổi dạy (${from} → ${to}, ` +
        (core.period ? `tiết ${core.period}` : `${hhmm(core.startTime)}–${hhmm(core.endTime)}`) +
        `) — ${core.school.name} / lớp ${core.cls.name}; ` +
        `bỏ qua ${skipped.length} buổi trùng lịch.`,
      after: {
        school_id: core.schoolId, class_id: core.classId, room_id: core.roomId,
        teacher_id: core.teacherId, assistant_id: core.assistantId,
        period: core.period, start_time: core.startTime, end_time: core.endTime,
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
      `select exists (select 1 from timesheets  where schedule_id = s.id) as has_timesheet,
              exists (select 1 from attendance where schedule_id = s.id) as has_attendance,
              schedule_session(s.period, s.start_time) as work_session,
              -- Sĩ số lần điểm danh gần nhất của lớp — gợi ý sẵn cho lần điểm danh sau.
              (select a2.roster_size from attendance a2
                where a2.class_id = s.class_id order by a2.created_at desc limit 1) as last_roster_size
         from schedules s where s.id = $1`,
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
    // Đổi tiết ⇒ giờ bắt đầu/kết thúc tự đổi theo khung tiết.
    if (b.period !== undefined) {
      patch.period = int(b.period, 'Tiết', { min: MIN_PERIOD, max: MAX_PERIOD });
      if (patch.period) {
        const t = await periodTimes(patch.period, { schoolId: s.school_id, date: patch.session_date ?? s.session_date });
        if (!t) throw badRequest(`Tiết ${patch.period} không có trong khung tiết đang áp dụng.`);
        patch.start_time = t.start;
        patch.end_time = t.end;
      }
    }
    if (b.start_time !== undefined) patch.start_time = timeStr(b.start_time, 'start_time', { required: true });
    if (b.end_time !== undefined) patch.end_time = timeStr(b.end_time, 'end_time', { required: true });
    if (b.room_id !== undefined) patch.room_id = uuid(b.room_id, 'room_id');                  // null = bỏ phòng
    if (b.teacher_id !== undefined) patch.teacher_id = uuid(b.teacher_id, 'teacher_id');      // null = bỏ phân công
    if (b.assistant_id !== undefined) patch.assistant_id = uuid(b.assistant_id, 'assistant_id');
    if (b.teacher_manual_name !== undefined) {
      patch.teacher_manual_name = str(b.teacher_manual_name, 'Tên giáo viên', { max: 120 });
    }
    if (b.assistant_manual_name !== undefined) {
      patch.assistant_manual_name = str(b.assistant_manual_name, 'Tên trợ giảng', { max: 120 });
    }
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

    if (patch.teacher_id) {
      await assertActiveStaff(patch.teacher_id, 'teacher', 'Giáo viên');
      patch.teacher_manual_name = null;
    }
    if (patch.assistant_id) {
      await assertActiveStaff(patch.assistant_id, 'assistant', 'Trợ giảng');
      patch.assistant_manual_name = null;
    }
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
   * POST /api/schedules/:id/status — đổi TRẠNG THÁI tiết, có lý do.
   *   cancelled — HUỶ LỊCH: kế hoạch thay đổi từ trước (nghỉ lễ, trường bận…)
   *   skipped   — ĐÃ BỎ: đến giờ nhưng tiết không diễn ra
   *   scheduled — khôi phục về theo lịch
   * Tiết đã điểm danh là đã dạy thật ⇒ không huỷ/bỏ được nữa.
   * ---------------------------------------------------------------------- */
  app.post('/api/schedules/:id/status', { preHandler: requirePerm('schedule.manage') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const s = await assertScheduleAccess(req.user, id);
    const b = req.body || {};
    const status = enumOf(b.status, 'Trạng thái', ['cancelled', 'skipped', 'scheduled'], { required: true });
    const reason = str(b.reason, 'Lý do', { max: 500 });

    if (status !== 'scheduled' && (!reason || reason.length < 5)) {
      throw badRequest(status === 'cancelled'
        ? 'Vui lòng ghi lý do huỷ lịch (ít nhất 5 ký tự).'
        : 'Vui lòng ghi lý do bỏ tiết (ít nhất 5 ký tự).');
    }
    const taught = await scalar('select exists (select 1 from attendance where schedule_id = $1)', [id]);
    if (taught && status !== 'scheduled') {
      throw unprocessable('Tiết này đã điểm danh — đã dạy thật, không huỷ hay đánh dấu bỏ được nữa.');
    }

    const updated = await one(
      `update schedules set
         status = $2::schedule_status,
         status_reason = $3,
         status_changed_by = $4,
         status_changed_at = now()
       where id = $1 returning *`,
      [id, status === 'scheduled' && taught ? 'done' : status, status === 'scheduled' ? null : reason, req.user.id]
    );

    const VN = { cancelled: 'Huỷ lịch', skipped: 'Đánh dấu ĐÃ BỎ', scheduled: 'Khôi phục' };
    const tiet = s.period ? `tiết ${s.period}` : hhmm(s.start_time);
    audit(req, {
      action: status === 'scheduled' ? 'update' : 'cancel',
      entity: 'schedules',
      entityId: id,
      summary: `${VN[status]} ${tiet} ngày ${s.session_date} — ${s.school_name} / lớp ${s.class_name}` +
        (reason && status !== 'scheduled' ? `. Lý do: ${reason}` : '.'),
      before: pickAudit(s),
      after: pickAudit(updated),
    });

    // Người phụ trách tiết cần biết tiết của mình bị huỷ / bỏ.
    if (status !== 'scheduled') {
      for (const uid of [s.teacher_id, s.assistant_id].filter(Boolean)) {
        notify(uid, {
          kind: 'schedule_status',
          title: status === 'cancelled' ? 'Tiết dạy bị huỷ lịch' : 'Tiết dạy được đánh dấu đã bỏ',
          body: `${tiet} ngày ${s.session_date} — ${s.school_name} / lớp ${s.class_name}. Lý do: ${reason}`,
          link: '/lich',
          refId: id,
        }).catch((e) => req.log.warn({ err: e }, 'Không gửi được thông báo schedule_status'));
      }
    }
    return scheduleDetail(id);
  });

  /* ------------------------------------------------------------------------
   * GET /api/schedules/:id/assistant-options — trợ giảng có thể giao cho tiết.
   * Dành cho GIÁO VIÊN của tiết (không có quyền xem danh bạ nói chung).
   * ---------------------------------------------------------------------- */
  app.get('/api/schedules/:id/assistant-options', async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const s = await assertScheduleAccess(req.user, id);
    const isOwnTeacher = s.teacher_id === req.user.id;
    if (!isOwnTeacher) assertPerm(req.user, 'schedule.manage');

    // Trợ giảng đang gắn với trường lên đầu; người ở trường khác vẫn chọn được.
    const items = await rows(
      `select u.id, u.full_name, u.phone,
              exists (
                select 1 from class_assignments ca join classes c on c.id = ca.class_id
                 where ca.user_id = u.id and c.school_id = $1
                union all
                select 1 from schedules x
                 where x.assistant_id = u.id and x.school_id = $1
              ) as at_school
         from users u
        where u.role = 'assistant' and u.is_active
        order by at_school desc, u.full_name`,
      [s.school_id]
    );
    return { items, current: { assistant_id: s.assistant_id, assistant_name: s.assistant_name } };
  });

  /* ------------------------------------------------------------------------
   * PUT /api/schedules/:id/assistant — GIAO trợ giảng check-in + điểm danh tiết.
   * Mỗi tiết có thể là một trợ giảng khác nhau. Giáo viên của tiết tự giao được;
   * admin/Phòng chuyên môn giao được mọi tiết.
   * Body: { assistant_id } hoặc { assistant_manual_name } hoặc cả hai rỗng = bỏ giao.
   * ---------------------------------------------------------------------- */
  app.put('/api/schedules/:id/assistant', async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const s = await assertScheduleAccess(req.user, id);
    const isOwnTeacher = s.teacher_id === req.user.id;
    if (!isOwnTeacher) assertPerm(req.user, 'schedule.manage');
    if (s.status === 'cancelled' || s.status === 'skipped') {
      throw unprocessable('Tiết đã huỷ / đã bỏ — không giao trợ giảng được.');
    }
    const taught = await scalar('select exists (select 1 from attendance where schedule_id = $1)', [id]);
    if (taught) throw unprocessable('Tiết đã điểm danh xong — không đổi người phụ trách được nữa.');

    const b = req.body || {};
    const assistantId = uuid(b.assistant_id, 'assistant_id');
    const manual = assistantId ? null : str(b.assistant_manual_name, 'Tên trợ giảng', { max: 120 });
    let assistant = null;
    if (assistantId) {
      assistant = await assertActiveStaff(assistantId, 'assistant', 'Trợ giảng');
      if (assistantId === s.teacher_id) throw badRequest('Giáo viên và trợ giảng phải là hai người khác nhau.');
      const hit = await findOverlap(query, {
        userId: assistantId, date: s.session_date, start: s.start_time, end: s.end_time, excludeId: id,
      });
      if (hit) throw conflict(overlapMessage(hit, s.session_date));
    }

    const updated = await one(
      `update schedules set assistant_id = $2, assistant_manual_name = $3 where id = $1 returning *`,
      [id, assistantId, manual]
    );

    const tiet = s.period ? `tiết ${s.period}` : hhmm(s.start_time);
    audit(req, {
      action: 'update',
      entity: 'schedules',
      entityId: id,
      summary: `Giao trợ giảng ${assistant?.full_name || manual || '(bỏ giao)'} cho ${tiet} ngày ${s.session_date} — ` +
        `${s.school_name} / lớp ${s.class_name}.`,
      before: pickAudit(s),
      after: pickAudit(updated),
    });

    if (assistantId && assistantId !== s.assistant_id) {
      notify(assistantId, {
        kind: 'schedule_assigned',
        title: 'Bạn được giao check-in và điểm danh một tiết',
        body: `${req.user.full_name} giao ${tiet} ngày ${s.session_date} — ${s.school_name} / lớp ${s.class_name}.`,
        link: '/diem-danh',
        refId: id,
      }).catch((e) => req.log.warn({ err: e }, 'Không gửi được thông báo schedule_assigned'));
    }
    return scheduleDetail(id);
  });

  /* ------------------------------------------------------------------------
   * DELETE /api/schedules/:id — tiết ĐÃ ĐIỂM DANH thì người thường không xoá
   * được (mất sĩ số và bằng chứng), chỉ Quản trị viên (record.forceDelete)
   * mới xoá hẳn được; điểm danh và chấm công gắn tiết đó bị xoá theo.
   * Lý do lấy từ ?reason=.
   * ---------------------------------------------------------------------- */
  app.delete('/api/schedules/:id', { preHandler: requirePerm('schedule.manage') }, async (req) => {
    const id = uuid(req.params.id, 'id', { required: true });
    const s = await assertScheduleAccess(req.user, id);
    const reason = str(req.query.reason, 'reason', { max: 500 });

    // Chấm công nay theo BUỔI, không bám tiết — thứ chặn xoá hẳn là ĐIỂM DANH:
    // tiết đã điểm danh là đã dạy thật, xoá sẽ mất sĩ số và bằng chứng.
    const attended = await one(
      `select count(*)::int as cnt, coalesce(max(present_count), 0) as present
         from attendance where schedule_id = $1`,
      [id]
    );
    const canForce = can(req.user, 'record.forceDelete');

    if (attended.cnt > 0 && !canForce) {
      throw conflict(
        'Tiết này đã điểm danh — đã dạy thật nên không xoá hẳn được. '
        + 'Nếu cần, hãy đổi trạng thái sang "Huỷ lịch" hoặc "Đã bỏ" kèm lý do, '
        + 'hoặc nhờ Quản trị viên xoá hẳn.'
      );
    }

    await query('delete from schedules where id = $1', [id]);
    audit(req, {
      action: 'delete',
      entity: 'schedules',
      entityId: id,
      summary: `Xoá buổi dạy ${s.session_date} — ${s.school_name} / lớp ${s.class_name}.` +
        (attended.cnt > 0 ? ` Xoá kèm ${attended.cnt} bản điểm danh (Quản trị viên).` : '') +
        `${reason ? ` Lý do: ${reason}` : ''}`,
      before: { ...pickAudit(s), attendance_deleted: attended.cnt },
    });
    return { deleted: true, id, attendance_deleted: attended.cnt };
  });
}
