/**
 * api.js — Lớp gọi API duy nhất của ứng dụng.
 *
 * Trách nhiệm:
 *   - Gắn Bearer token, tự làm mới khi hết hạn (refresh token xoay vòng).
 *   - Chuyển lỗi HTTP thành ApiError có `message` tiếng Việt hiển thị thẳng.
 *   - Nhận biết mã 428 (buộc đổi mật khẩu) và 401 (đăng xuất) để App điều hướng.
 *
 * Không màn hình nào được gọi fetch() trực tiếp — luôn đi qua đây.
 */

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/+$/, '');

const STORE = {
  access: 'teachops.access',
  refresh: 'teachops.refresh',
  user: 'teachops.user',
};

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || 'Hệ thống gặp sự cố, vui lòng thử lại.');
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
  get isAuth() { return this.status === 401; }
  get isOffline() { return this.code === 'NETWORK'; }
  get mustChangePassword() { return this.status === 428; }
}

/* ------------------------------- Lưu token -------------------------------- */
export const tokens = {
  get access() { return localStorage.getItem(STORE.access) || ''; },
  get refresh() { return localStorage.getItem(STORE.refresh) || ''; },
  set({ access_token, refresh_token }) {
    if (access_token) localStorage.setItem(STORE.access, access_token);
    if (refresh_token) localStorage.setItem(STORE.refresh, refresh_token);
  },
  clear() {
    localStorage.removeItem(STORE.access);
    localStorage.removeItem(STORE.refresh);
    localStorage.removeItem(STORE.user);
  },
};

export const cachedUser = {
  get() {
    try { return JSON.parse(localStorage.getItem(STORE.user) || 'null'); } catch { return null; }
  },
  set(u) {
    if (u) localStorage.setItem(STORE.user, JSON.stringify(u));
    else localStorage.removeItem(STORE.user);
  },
};

/* --------------------------- Sự kiện phiên đăng nhập ----------------------- */
const listeners = new Set();
/** Đăng ký lắng nghe: 'signed-out' | 'must-change-password'. */
export function onSession(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(evt, payload) {
  listeners.forEach((fn) => { try { fn(evt, payload); } catch { /* bỏ qua */ } });
}

/* ------------------------------ Làm mới token ------------------------------ */
let refreshing = null;

async function refreshTokens() {
  // Nhiều request cùng hết hạn ⇒ chỉ gọi /refresh một lần, các request khác chờ chung.
  if (refreshing) return refreshing;

  const rt = tokens.refresh;
  if (!rt) {
    tokens.clear();
    emit('signed-out');
    throw new ApiError(401, 'UNAUTHORIZED', 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
  }

  refreshing = (async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!res.ok) throw new Error('refresh_failed');
      const data = await res.json();
      tokens.set(data);
      return data.access_token;
    } catch {
      tokens.clear();
      emit('signed-out');
      throw new ApiError(401, 'UNAUTHORIZED', 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

/* --------------------------------- Yêu cầu -------------------------------- */
async function parseError(res) {
  let body = null;
  try { body = await res.json(); } catch { /* phản hồi không phải JSON */ }
  const e = body?.error || {};
  return new ApiError(res.status, e.code || 'HTTP_' + res.status, e.message, e.details);
}

/**
 * @param {string} path   Ví dụ '/api/schools'
 * @param {object} opts   { method, body, query, formData, signal, raw }
 */
async function request(path, opts = {}, _retried = false) {
  const { method = 'GET', body, query, formData, signal, raw = false } = opts;

  let url = `${API_URL}${path}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      qs.append(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }

  const headers = {};
  const access = tokens.access;
  if (access) headers.Authorization = `Bearer ${access}`;

  let payload;
  if (formData) {
    payload = formData;                       // trình duyệt tự đặt Content-Type kèm boundary
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Không kết nối được máy chủ. Kiểm tra đường truyền và thử lại.');
  }

  if (res.status === 401 && !_retried && tokens.refresh) {
    await refreshTokens();
    return request(path, opts, true);
  }

  if (res.status === 428) {
    emit('must-change-password');
    throw await parseError(res);
  }

  if (!res.ok) {
    const err = await parseError(res);
    if (err.status === 401) { tokens.clear(); emit('signed-out'); }
    throw err;
  }

  if (raw) return res;
  if (res.status === 204) return null;

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res;
}

export const api = {
  get: (path, query, opts) => request(path, { ...opts, method: 'GET', query }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  del: (path, opts) => request(path, { ...opts, method: 'DELETE' }),

  /** Gửi multipart (ảnh minh chứng, tài liệu). */
  upload: (path, formData, opts) => request(path, { ...opts, method: opts?.method || 'POST', formData }),

  /** Tải tệp về máy (Excel, tài liệu) — giữ đúng tên tệp từ Content-Disposition. */
  async download(path, query, fallbackName = 'tai-lieu') {
    const res = await request(path, { method: 'GET', query, raw: true });
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
    const name = m ? decodeURIComponent(m[1]) : fallbackName;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return name;
  },

  request,
};

/** Đường dẫn xem ảnh/tệp — kèm token vì thẻ <img> không gửi được header. */
export function fileUrl(fileId, { thumb = false } = {}) {
  if (!fileId) return '';
  const suffix = thumb ? '/thumb' : '';
  return `${API_URL}/api/files/${fileId}${suffix}?token=${encodeURIComponent(tokens.access)}`;
}

export default api;
