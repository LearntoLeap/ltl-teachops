/**
 * offline.js — Hàng đợi thao tác khi mất mạng (IndexedDB).
 *
 * Chỉ áp dụng cho hai việc ở hiện trường: CHẤM CÔNG và ĐIỂM DANH — nơi giáo viên
 * hay ở trường vùng ven sóng yếu. Các thao tác quản trị khác vẫn yêu cầu có mạng.
 *
 * Nguyên tắc an toàn số liệu:
 *   - Không bao giờ xoá bản ghi cục bộ dựa trên phản hồi máy chủ; chỉ đánh dấu đã gửi.
 *   - Gửi tuần tự theo thứ tự tạo để giữ đúng trình tự check-in → check-out.
 *   - Thời gian nghiệp vụ do SERVER quyết định; client chỉ gửi kèm client_time/queued_at
 *     để kế toán đối chiếu khi bản ghi lên trễ.
 */
import { API_URL, tokens } from './api.js';

const DB_NAME = 'teachops-offline';
const DB_VER = 1;
const STORE = 'outbox';

let _db = null;

function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function txStore(mode = 'readonly') {
  return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}
function wrap(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

/* ------------------------------ Sự kiện thay đổi --------------------------- */
const listeners = new Set();
export function onOutboxChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
async function emitChange() {
  const items = await listPending();
  listeners.forEach((fn) => { try { fn(items); } catch { /* bỏ qua */ } });
}

/* --------------------------------- Ghi hàng đợi ---------------------------- */

/**
 * Đưa một thao tác vào hàng đợi.
 * @param {object} job
 * @param {string} job.endpoint  '/api/timesheets/check-in'
 * @param {string} [job.method]  mặc định POST
 * @param {object} job.fields    các trường văn bản
 * @param {Array}  [job.files]   [{ field, blob, name }]
 * @param {string} job.label     mô tả tiếng Việt hiện trên danh sách chờ
 */
export async function enqueue(job) {
  const rec = {
    id: uid(),
    endpoint: job.endpoint,
    method: job.method || 'POST',
    fields: { ...job.fields, queued_at: new Date().toISOString() },
    files: job.files || [],
    label: job.label || 'Thao tác chờ gửi',
    kind: job.kind || 'other',
    status: 'pending',      // pending | sending | done | failed
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
    sentAt: null,
  };
  const s = await txStore('readwrite');
  await wrap(s.add(rec));
  await emitChange();
  // Có mạng thì thử gửi ngay.
  if (navigator.onLine) flush();
  return rec;
}

export async function listPending() {
  const s = await txStore();
  const all = await wrap(s.getAll());
  return all
    .filter((r) => r.status !== 'done')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listAll() {
  const s = await txStore();
  const all = await wrap(s.getAll());
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function pendingCount() {
  return (await listPending()).length;
}

async function update(rec) {
  const s = await txStore('readwrite');
  await wrap(s.put(rec));
}

/** Xoá một mục khỏi hàng đợi (chỉ dùng khi người dùng chủ động huỷ). */
export async function remove(id) {
  const s = await txStore('readwrite');
  await wrap(s.delete(id));
  await emitChange();
}

/** Dọn các mục đã gửi thành công quá 7 ngày. */
export async function purgeDone(days = 7) {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const s = await txStore('readwrite');
  const all = await wrap(s.getAll());
  for (const r of all) {
    if (r.status === 'done' && r.sentAt && r.sentAt < cutoff) {
      await wrap(s.delete(r.id));
    }
  }
}

/* ---------------------------------- Gửi đi -------------------------------- */
let flushing = false;

/** Gửi tuần tự toàn bộ mục đang chờ. An toàn khi gọi nhiều lần. */
export async function flush() {
  if (flushing || !navigator.onLine || !tokens.access) return { sent: 0, failed: 0 };
  flushing = true;
  let sent = 0;
  let failed = 0;

  try {
    const items = await listPending();
    for (const rec of items) {
      // Bỏ qua mục đã thất bại quá nhiều lần — để người dùng tự xử lý trên màn hình Chờ đồng bộ.
      if (rec.attempts >= 8) continue;

      rec.status = 'sending';
      rec.attempts += 1;
      await update(rec);

      try {
        const fd = new FormData();
        for (const [k, v] of Object.entries(rec.fields || {})) {
          if (v === undefined || v === null || v === '') continue;
          fd.append(k, String(v));
        }
        for (const f of rec.files || []) {
          fd.append(f.field, f.blob, f.name || 'anh.jpg');
        }

        const res = await fetch(`${API_URL}${rec.endpoint}`, {
          method: rec.method,
          headers: { Authorization: `Bearer ${tokens.access}` },
          body: fd,
        });

        if (res.ok) {
          rec.status = 'done';
          rec.sentAt = new Date().toISOString();
          rec.lastError = null;
          sent++;
        } else if (res.status === 409) {
          // Máy chủ báo đã có bản ghi (ví dụ đã check-in ở thiết bị khác) ⇒ coi như xong.
          rec.status = 'done';
          rec.sentAt = new Date().toISOString();
          rec.lastError = 'Máy chủ đã có bản ghi này từ trước.';
          sent++;
        } else if (res.status === 401) {
          // Hết phiên: dừng cả lượt, giữ nguyên hàng đợi để gửi sau khi đăng nhập lại.
          rec.status = 'pending';
          await update(rec);
          break;
        } else {
          let msg = `Lỗi ${res.status}`;
          try { const b = await res.json(); msg = b?.error?.message || msg; } catch { /* bỏ qua */ }
          rec.status = 'failed';
          rec.lastError = msg;
          failed++;
        }
      } catch (e) {
        // Mất mạng giữa chừng ⇒ trả về pending, thử lại lượt sau.
        rec.status = 'pending';
        rec.lastError = e.message;
        await update(rec);
        break;
      }

      await update(rec);
    }
  } finally {
    flushing = false;
    await emitChange();
  }

  return { sent, failed };
}

/** Đưa một mục thất bại về trạng thái chờ để gửi lại. */
export async function retry(id) {
  const s = await txStore('readwrite');
  const rec = await wrap(s.get(id));
  if (!rec) return;
  rec.status = 'pending';
  rec.attempts = 0;
  rec.lastError = null;
  await wrap(s.put(rec));
  await emitChange();
  flush();
}

/* ------------------------------ Vòng đồng bộ ------------------------------ */
let timer = null;

export function startSync() {
  if (timer) return;
  window.addEventListener('online', flush);
  timer = setInterval(() => { if (navigator.onLine) flush(); }, 30_000);
  purgeDone().catch(() => {});
  flush();
}

export function stopSync() {
  window.removeEventListener('online', flush);
  if (timer) clearInterval(timer);
  timer = null;
}

export const isOnline = () => navigator.onLine;
