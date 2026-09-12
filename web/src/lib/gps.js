/**
 * gps.js — Lấy vị trí và chụp/nén ảnh, kèm xử lý rõ ràng khi người dùng từ chối quyền.
 * Dùng cho chấm công (bắt buộc GPS) và điểm danh/thiết bị (bắt buộc ảnh).
 */

export class PermissionError extends Error {
  constructor(kind, message, howTo) {
    super(message);
    this.name = 'PermissionError';
    this.kind = kind;       // 'location' | 'camera'
    this.howTo = howTo;     // hướng dẫn bật lại quyền, hiển thị cho người dùng
  }
}

const HOW_TO_LOCATION =
  'Cách bật lại: chạm biểu tượng ổ khoá 🔒 bên trái thanh địa chỉ → "Cài đặt trang" → ' +
  'bật "Vị trí" → tải lại trang. Trên iPhone: Cài đặt → Safari → Vị trí → Hỏi hoặc Cho phép.';

const HOW_TO_CAMERA =
  'Cách bật lại: chạm biểu tượng ổ khoá 🔒 bên trái thanh địa chỉ → "Cài đặt trang" → ' +
  'bật "Máy ảnh" → tải lại trang.';

/**
 * Lấy toạ độ hiện tại.
 * @returns {Promise<{lat:number, lng:number, accuracy:number, at:string}>}
 */
export function getPosition({ timeout = 15000, highAccuracy = true, maxAge = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      return reject(new PermissionError('location',
        'Thiết bị hoặc trình duyệt này không hỗ trợ định vị.',
        'Hãy dùng Chrome hoặc Safari bản mới trên điện thoại.'));
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy || 0),
        at: new Date().toISOString(),
      }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          return reject(new PermissionError('location',
            'Bạn đã chặn quyền truy cập vị trí. Không thể chấm công nếu thiếu quyền này.',
            HOW_TO_LOCATION));
        }
        if (err.code === err.POSITION_UNAVAILABLE) {
          return reject(new PermissionError('location',
            'Không xác định được vị trí. Hãy bật GPS và ra chỗ thoáng rồi thử lại.',
            'Kiểm tra: GPS/Định vị của điện thoại đã bật chưa, có đang ở trong nhà kín không.'));
        }
        return reject(new PermissionError('location',
          'Lấy vị trí quá lâu. Hãy kiểm tra GPS và thử lại.',
          'Nếu đang ở trong phòng kín, hãy ra gần cửa sổ rồi bấm thử lại.'));
      },
      { enableHighAccuracy: highAccuracy, timeout, maximumAge: maxAge }
    );
  });
}

/** Trạng thái quyền vị trí, nếu trình duyệt hỗ trợ Permissions API. */
export async function locationPermissionState() {
  try {
    if (!navigator.permissions?.query) return 'unknown';
    const s = await navigator.permissions.query({ name: 'geolocation' });
    return s.state;   // 'granted' | 'denied' | 'prompt'
  } catch {
    return 'unknown';
  }
}

/* ------------------------------- Ảnh chụp -------------------------------- */

/**
 * Nén ảnh trước khi gửi: cạnh dài ≤ maxSize, JPEG chất lượng q.
 * Giảm đáng kể dung lượng cho giáo viên dùng 3G ở tỉnh.
 * @param {File|Blob} file
 * @returns {Promise<Blob>}
 */
export async function compressImage(file, { maxSize = 1600, quality = 0.8 } = {}) {
  if (!file || !file.type?.startsWith('image/')) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    // Nén xong mà to hơn bản gốc (ảnh đã nhỏ sẵn) ⇒ giữ bản gốc.
    if (!blob || blob.size >= file.size) return file;
    return blob;
  } catch {
    // Trình duyệt cũ không có createImageBitmap ⇒ gửi nguyên bản, server sẽ nén lại.
    return file;
  }
}

/** Kích thước dễ đọc: 1.2 MB */
export function humanSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Mở hộp thoại chọn/chụp ảnh (hoặc video). `capture: 'environment'` mở thẳng camera sau.
 * `accept: 'video/*'` + capture ⇒ mở chế độ quay video trên điện thoại.
 * @returns {Promise<File[]>}
 */
export function pickImages({ multiple = false, capture = null, accept = 'image/*' } = {}) {
  // Điện thoại cần thêm chút thời gian mới trả được video vừa quay về trang.
  const cancelDelay = accept.includes('video') ? 4000 : 800;
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    if (multiple) input.multiple = true;
    if (capture) input.capture = capture;
    input.style.display = 'none';
    document.body.appendChild(input);

    let settled = false;
    const done = (files) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };

    input.addEventListener('change', () => done(Array.from(input.files || [])));
    // Người dùng bấm Huỷ: sự kiện 'cancel' có ở trình duyệt mới; window focus là phương án dự phòng.
    input.addEventListener('cancel', () => done([]));
    window.addEventListener('focus', () => setTimeout(() => done([]), cancelDelay), { once: true });

    input.click();
  });
}

export { HOW_TO_LOCATION, HOW_TO_CAMERA };
