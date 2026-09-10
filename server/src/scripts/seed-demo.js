/**
 * seed-demo.js — Dữ liệu mẫu để demo / phát triển.
 *
 * Tạo: 2 trường (Tiểu học Xuân Hoà, THCS Xuân Tâm) · mỗi trường 2 lớp + 1 phòng STEM
 * + danh mục thiết bị · 4 tài khoản demo (manager / 2 teacher / 1 assistant)
 * · lịch dạy thứ 2/4/6 (sáng 8:00–9:30, chiều 14:00–15:30, xen kẽ lớp)
 * cho 2 tuần gần đây + tuần tới.
 *
 * - CHẶN chạy khi NODE_ENV=production (bỏ chặn bằng cờ --force).
 * - Idempotent: email demo đã tồn tại ⇒ bỏ qua toàn bộ.
 *
 * Chạy độc lập:  node src/scripts/seed-demo.js [--force]
 */
import env from '../env.js';
import { one, tx, waitForDb, closeDb } from '../db.js';
import { hashPassword } from '../lib/auth.js';

const DEMO_PASSWORD = 'Demo1234';
const MANAGER_EMAIL = 'manager@demo.ltl';

/** YYYY-MM-DD theo giờ địa phương (không dùng toISOString để tránh lệch múi giờ). */
function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Thứ Hai của tuần chứa ngày d. */
function mondayOf(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // getDay(): CN=0 ⇒ quy về T2=0
  return x;
}

export async function seedDemo() {
  const force = process.argv.includes('--force');
  if (env.isProd && !force) {
    console.warn(
      '[seed-demo] Đang ở NODE_ENV=production — KHÔNG nạp dữ liệu demo để tránh làm bẩn dữ liệu thật.\n' +
      '            Nếu thật sự muốn, chạy lại với cờ --force.'
    );
    return null;
  }

  // Idempotent: đã có tài khoản demo ⇒ không đụng gì thêm.
  const existing = await one('select id from users where email = $1', [MANAGER_EMAIL]);
  if (existing) {
    console.log('[seed-demo] Dữ liệu demo đã có — bỏ qua.');
    return null;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const summary = await tx(async (c) => {
    /* ------------------------------ Trường --------------------------------- */
    const { rows: [thxh] } = await c.query(
      `insert into schools (code, name, address, province, lat, lng)
       values ('THXH', 'Tiểu học Xuân Hoà', 'Số 1 Tràng Tiền, Hoàn Kiếm', 'Hà Nội', 21.0285, 105.8542)
       returning id, name`
    );
    const { rows: [thcsxt] } = await c.query(
      `insert into schools (code, name, address, province, lat, lng)
       values ('THCSXT', 'THCS Xuân Tâm', 'Số 10 Thụy Khuê, Tây Hồ', 'Hà Nội', 21.0448, 105.8312)
       returning id, name`
    );

    /* ------------------------------- Lớp ----------------------------------- */
    async function insertClass(schoolId, name, level, grade, rosterSize) {
      const { rows: [cl] } = await c.query(
        `insert into classes (school_id, name, level, grade, roster_size)
         values ($1, $2, $3, $4, $5) returning id, name`,
        [schoolId, name, level, grade, rosterSize]
      );
      return cl;
    }
    const thxh4A = await insertClass(thxh.id, '4A', 'primary', 4, 30);
    const thxh5A = await insertClass(thxh.id, '5A', 'primary', 5, 32);
    const xt6A = await insertClass(thcsxt.id, '6A', 'secondary', 6, 35);
    const xt7A = await insertClass(thcsxt.id, '7A', 'secondary', 7, 38);

    /* ---------------------------- Phòng STEM ------------------------------- */
    const { rows: [roomThxh] } = await c.query(
      `insert into stem_rooms (school_id, name, note)
       values ($1, 'Phòng STEM 1', 'Tầng 2, dãy nhà A') returning id`,
      [thxh.id]
    );
    const { rows: [roomXt] } = await c.query(
      `insert into stem_rooms (school_id, name, note)
       values ($1, 'Phòng STEM 1', 'Tầng 3, dãy nhà B') returning id`,
      [thcsxt.id]
    );

    /* ------------------------- Danh mục thiết bị --------------------------- */
    const CATALOG = [
      { name: 'uKIT EDU', sku: 'UKIT-EDU', unit: 'bộ', qty: 10, sort: 10 },
      { name: 'UGOT', sku: 'UGOT', unit: 'bộ', qty: 6, sort: 20 },
      { name: 'Máy in 3D', sku: 'P3D', unit: 'chiếc', qty: 2, sort: 30 },
      { name: 'MAXHUB', sku: 'MAXHUB', unit: 'chiếc', qty: 1, sort: 40 },
      { name: 'Laptop giáo viên', sku: 'LAPTOP-GV', unit: 'chiếc', qty: 2, sort: 50 },
    ];
    for (const [schoolId, roomId] of [[thxh.id, roomThxh.id], [thcsxt.id, roomXt.id]]) {
      for (const it of CATALOG) {
        await c.query(
          `insert into device_catalog (school_id, room_id, name, sku, unit, expected_qty, sort_order)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [schoolId, roomId, it.name, it.sku, it.unit, it.qty, it.sort]
        );
      }
    }

    /* ----------------------------- Tài khoản ------------------------------- */
    // must_change_password=false để demo không vướng màn hình đổi mật khẩu.
    async function insertUser(email, fullName, role, phone) {
      const { rows: [u] } = await c.query(
        `insert into users (email, password_hash, full_name, phone, role, must_change_password)
         values ($1, $2, $3, $4, $5, false)
         returning id, email, full_name, role`,
        [email, passwordHash, fullName, phone || null, role]
      );
      return u;
    }
    const manager = await insertUser(MANAGER_EMAIL, 'Trần Thu Hà', 'manager', '0901000001');
    const gv1 = await insertUser('gv1@demo.ltl', 'Nguyễn Văn An', 'teacher', '0901000002');
    const gv2 = await insertUser('gv2@demo.ltl', 'Phạm Thị Bình', 'teacher', '0901000003');
    const tg1 = await insertUser('tg1@demo.ltl', 'Lê Minh Châu', 'assistant', '0901000004');

    // Phạm vi của Phòng chuyên môn: cả 2 trường.
    for (const schoolId of [thxh.id, thcsxt.id]) {
      await c.query(
        'insert into user_schools (user_id, school_id) values ($1, $2)',
        [manager.id, schoolId]
      );
    }

    /* --------------------------- Phân công lớp ----------------------------- */
    const assignments = [
      [thxh4A.id, gv1.id, 'teacher'],
      [thxh5A.id, gv1.id, 'teacher'],
      [xt6A.id, gv2.id, 'teacher'],
      [xt7A.id, gv2.id, 'teacher'],
      [thxh4A.id, tg1.id, 'assistant'],
      [thxh5A.id, tg1.id, 'assistant'],
    ];
    for (const [classId, userId, role] of assignments) {
      await c.query(
        'insert into class_assignments (class_id, user_id, role) values ($1, $2, $3)',
        [classId, userId, role]
      );
    }

    /* ------------------------------ Lịch dạy ------------------------------- */
    // 3 tuần: tuần trước + tuần này + tuần tới; thứ 2/4/6;
    // sáng 8:00–9:30 và chiều 14:00–15:30, hai lớp của trường xen kẽ ca sáng/chiều.
    const schoolPlans = [
      { school: thxh, classes: [thxh4A, thxh5A], room: roomThxh, teacher: gv1, assistant: tg1, subject: 'Robotics — uKIT EDU' },
      { school: thcsxt, classes: [xt6A, xt7A], room: roomXt, teacher: gv2, assistant: null, subject: 'Robotics — UGOT' },
    ];

    const startMonday = mondayOf(new Date());
    startMonday.setDate(startMonday.getDate() - 7); // lùi về thứ Hai tuần trước

    let scheduleCount = 0;
    for (let week = 0; week < 3; week++) {
      for (const dayOffset of [0, 2, 4]) { // thứ 2 / thứ 4 / thứ 6
        const d = new Date(startMonday);
        d.setDate(startMonday.getDate() + week * 7 + dayOffset);
        const sessionDate = fmtDate(d);
        const flip = (week + dayOffset) % 2 === 0; // đổi ca sáng/chiều giữa 2 lớp theo ngày

        for (const plan of schoolPlans) {
          const morningClass = flip ? plan.classes[0] : plan.classes[1];
          const afternoonClass = flip ? plan.classes[1] : plan.classes[0];
          const slots = [
            { cls: morningClass, start: '08:00', end: '09:30' },
            { cls: afternoonClass, start: '14:00', end: '15:30' },
          ];
          for (const slot of slots) {
            await c.query(
              `insert into schedules
                 (school_id, class_id, room_id, teacher_id, assistant_id,
                  session_date, start_time, end_time, subject, created_by)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [
                plan.school.id, slot.cls.id, plan.room.id,
                plan.teacher.id, plan.assistant ? plan.assistant.id : null,
                sessionDate, slot.start, slot.end, plan.subject, manager.id,
              ]
            );
            scheduleCount++;
          }
        }
      }
    }

    return { schools: 2, classes: 4, users: 4, schedules: scheduleCount };
  });

  console.log(
    `[seed-demo] Đã tạo: ${summary.schools} trường, ${summary.classes} lớp, ` +
    `${summary.users} tài khoản, ${summary.schedules} buổi dạy.\n\n` +
    `Tài khoản demo (mật khẩu chung: ${DEMO_PASSWORD}):\n` +
    `  - ${MANAGER_EMAIL}  — Phòng chuyên môn (phụ trách cả 2 trường)\n` +
    '  - gv1@demo.ltl      — Giáo viên (Tiểu học Xuân Hoà)\n' +
    '  - gv2@demo.ltl      — Giáo viên (THCS Xuân Tâm)\n' +
    '  - tg1@demo.ltl      — Trợ giảng (Tiểu học Xuân Hoà)\n'
  );
  return summary;
}

// Cho phép chạy độc lập:  node src/scripts/seed-demo.js
const isDirect = process.argv[1] && process.argv[1].endsWith('seed-demo.js');
if (isDirect) {
  waitForDb()
    .then(seedDemo)
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('[seed-demo] Lỗi:', e.message);
      process.exit(1);
    });
}
