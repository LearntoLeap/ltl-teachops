/**
 * TableIO.jsx — Hai nút đi kèm mọi màn "Nhập bảng": TẢI MẪU và TẢI TỆP LÊN.
 *
 * Tải lên KHÔNG tạo dữ liệu ngay: máy chủ chỉ đọc tệp Excel thành các dòng chữ
 * rồi trả về, màn nhập bảng đổ vào bảng để người dùng soát và sửa. Nhờ vậy tệp
 * còn thiếu thông tin vẫn tải lên được — chỉ bị nhắc, không bị chặn.
 */
import { useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Spinner } from './ui.jsx';
import { useToast } from './Toast.jsx';

/** Tải tệp Excel mẫu đúng thứ tự cột của bảng đang nhập. */
export function TemplateButton({ path, name, query, label = 'Tải tệp mẫu Excel' }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn-line !py-1.5 !px-3 text-sm shrink-0" disabled={busy}
      onClick={async () => {
        setBusy(true);
        try { await api.download(path, query, name); } catch (e) { toast.fromError(e); } finally { setBusy(false); }
      }}>
      {busy ? <Spinner className="h-3.5 w-3.5" /> : '📄'} {label}
    </button>
  );
}

/**
 * Chọn tệp .xlsx đã điền → đổ thẳng vào bảng.
 * kind: 'schools' | 'classes' | 'schedules' (khớp /api/import/table)
 * onRows(rows): rows là mảng các dòng, mỗi dòng là mảng ô dạng chuỗi —
 *               cùng định dạng với thao tác dán Ctrl+V nên dùng chung mã xử lý.
 */
export function ImportButton({ kind, onRows, disabled = false, label = 'Tải tệp đã điền' }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const res = await api.upload(`/api/import/table?kind=${kind}`, fd);
      const rows = res?.rows || [];
      onRows(rows, res?.warnings || []);
      const extra = (res?.warnings || []).length ? ` ${res.warnings.join(' ')}` : '';
      toast.ok(`Đã nạp ${rows.length} dòng từ "${file.name}".${extra}`, 6000);
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="btn-line !py-1.5 !px-3 text-sm shrink-0"
        disabled={busy || disabled} onClick={() => inputRef.current?.click()}>
        {busy ? <Spinner className="h-3.5 w-3.5" /> : '⬆️'} {label}
      </button>
      <input ref={inputRef} type="file" className="hidden" onChange={pick}
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
    </>
  );
}
