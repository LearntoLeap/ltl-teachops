/**
 * EditMaterialSheet.jsx — Sửa thông tin học liệu ĐÃ ĐĂNG (không đụng tới tệp).
 *
 * Đăng nhầm khối, sai tiết, gõ nhầm tên tài liệu… thì sửa ngay tại đây thay vì
 * xoá đi đăng lại. Muốn thay TỆP thì dùng "+ Phiên bản mới" ở trang chi tiết —
 * cách đó giữ lại lịch sử bản cũ.
 *
 * Chỉ gửi lên những trường thực sự đổi (PATCH), nên hai người sửa hai ô khác
 * nhau cùng lúc cũng không ghi đè nhau.
 */
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { LABEL } from '../../lib/format.js';
import { Field, Sheet, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';

const GRADES = Array.from({ length: 12 }, (_, i) => i + 1);
const LEVEL_OPTIONS = ['primary', 'secondary', 'highschool']
  .map((v) => ({ value: v, label: LABEL.level[v] }));
/** Khối 1-5 → Tiểu học · 6-9 → THCS · 10-12 → THPT. */
const levelOfGrade = (g) => (g <= 5 ? 'primary' : g <= 9 ? 'secondary' : 'highschool');

/** Giá trị ô nhập luôn là chuỗi; null/undefined ⇒ ô trống. */
const s = (v) => (v === null || v === undefined ? '' : String(v));

export default function EditMaterialSheet({ open, material, types, solutions, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);

  // Mỗi lần mở (hoặc đổi sang tài liệu khác) thì nạp lại giá trị hiện tại.
  useEffect(() => {
    if (!open || !material) return;
    setF({
      title: s(material.title),
      type_id: s(material.type_id),
      grade: s(material.grade),
      level: s(material.level) || 'secondary',
      lesson_no: s(material.lesson_no),
      lesson_title: s(material.lesson_title),
      curriculum: s(material.curriculum),
      subject: s(material.subject),
      description: s(material.description),
      body: s(material.body),
      solution_id: s(material.solution_id),
    });
  }, [open, material]);

  if (!material || !f) return null;
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!f.title.trim()) { toast.err('Tên tài liệu không được để trống.'); return; }

    // Chỉ gửi phần đã đổi so với bản đang lưu.
    const patch = {};
    const put = (key, value) => { if (value !== s(material[key])) patch[key] = value; };
    put('title', f.title.trim());
    put('subject', f.subject.trim());
    put('description', f.description.trim());
    put('lesson_title', f.lesson_title.trim());
    put('curriculum', f.curriculum.trim());
    put('body', f.body.trim());
    put('level', f.level);
    put('type_id', f.type_id);
    put('solution_id', f.solution_id);
    put('grade', f.grade);
    put('lesson_no', f.lesson_no);
    // Ô số/tham chiếu để trống ⇒ xoá giá trị (null), không gửi chuỗi rỗng.
    for (const k of ['grade', 'lesson_no', 'type_id', 'solution_id']) {
      if (k in patch) patch[k] = patch[k] === '' ? null : (k === 'grade' || k === 'lesson_no' ? Number(patch[k]) : patch[k]);
    }

    if (!Object.keys(patch).length) { toast.ok('Không có thay đổi nào.'); onClose(); return; }

    setBusy(true);
    try {
      const updated = await api.patch(`/api/materials/${material.id}`, patch);
      toast.ok('Đã lưu thay đổi.');
      onDone?.(updated);
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} title="Sửa thông tin tài liệu" wide>
      <form onSubmit={submit}>
        <Field label="Tên tài liệu" required>
          <input className="input" value={f.title} onChange={(e) => set('title', e.target.value)}
            placeholder="Ví dụ: Slide bài 5 — Lập trình cảm biến UGOT" autoFocus />
        </Field>

        <Field label="Loại tài liệu">
          <div className="flex flex-wrap gap-1.5">
            {(types || []).map((t) => (
              <button key={t.id} type="button"
                onClick={() => set('type_id', f.type_id === t.id ? '' : t.id)}
                className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold ring-1 ring-inset transition
                  ${f.type_id === t.id
                    ? 'bg-brand-grad text-white ring-transparent'
                    : 'bg-white text-ink-soft ring-line hover:ring-brand-300'}`}>
                {t.icon} {t.name}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid sm:grid-cols-2 sm:gap-3">
          <Field label="Khối lớp" hint="Chọn khối sẽ tự đặt cấp học tương ứng.">
            <select className="input" value={f.grade}
              onChange={(e) => {
                const g = e.target.value;
                setF((o) => ({ ...o, grade: g, level: g ? levelOfGrade(Number(g)) : o.level }));
              }}>
              <option value="">— Chưa phân khối —</option>
              {GRADES.map((g) => <option key={g} value={g}>Khối {g}</option>)}
            </select>
          </Field>
          <Field label="Cấp học" required>
            <select className="input" value={f.level} onChange={(e) => set('level', e.target.value)}>
              {LEVEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-[90px_1fr] gap-3">
          <Field label="Tiết">
            <input className="input" type="number" min="1" max="500" inputMode="numeric"
              value={f.lesson_no} onChange={(e) => set('lesson_no', e.target.value)} placeholder="5" />
          </Field>
          <Field label="Tên bài">
            <input className="input" value={f.lesson_title} onChange={(e) => set('lesson_title', e.target.value)}
              placeholder="Ví dụ: Lập trình cảm biến siêu âm" />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 sm:gap-3">
          <Field label="Chương trình học">
            <input className="input" value={f.curriculum} onChange={(e) => set('curriculum', e.target.value)}
              placeholder="Ví dụ: Robotics UGOT — HK1" />
          </Field>
          <Field label="Môn học">
            <input className="input" value={f.subject} onChange={(e) => set('subject', e.target.value)}
              placeholder="Ví dụ: Robotics, Tin học…" />
          </Field>
        </div>

        <Field label="Giải pháp">
          <select className="input" value={f.solution_id} onChange={(e) => set('solution_id', e.target.value)}>
            <option value="">— Không gắn giải pháp —</option>
            {(solutions || []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>

        <Field label="Mô tả ngắn">
          <textarea className="input" rows={2} value={f.description} onChange={(e) => set('description', e.target.value)}
            placeholder="Tóm tắt nội dung, phạm vi sử dụng…" />
        </Field>

        <Field label="Nội dung bài viết">
          <textarea className="input min-h-[100px]" value={f.body} onChange={(e) => set('body', e.target.value)}
            placeholder="Hướng dẫn, ghi chú chuyên môn, kịch bản dạy…" />
        </Field>

        <p className="text-[12.5px] text-ink-muted mt-1">
          Muốn thay <b>tệp đính kèm</b>: mở trang chi tiết → <b>+ Phiên bản mới</b> (giữ lại bản cũ trong lịch sử).
        </p>

        <div className="flex gap-2.5 justify-end mt-4">
          <button type="button" className="btn-line" onClick={onClose} disabled={busy}>Huỷ</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? <><Spinner className="h-4 w-4 border-white/40 border-t-white" /> Đang lưu…</> : 'Lưu thay đổi'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
