/**
 * MaterialsLessonView.jsx — Xem kho học liệu theo TIẾT DẠY: gom Khối → Môn → Tiết.
 * Mỗi tiết liệt kê đủ giáo án / slide / giáo trình… của tiết đó để giáo viên soạn bài
 * chỉ cần mở đúng một chỗ.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui.jsx';
import { LABEL } from '../../lib/format.js';

/** Gom danh sách thành [{grade, subject, lessons: [{no, title, items[]}]}]. */
function group(items) {
  const byKey = new Map();
  for (const m of items) {
    const key = `${m.grade || 0}|${m.subject || ''}`;
    if (!byKey.has(key)) byKey.set(key, { grade: m.grade || null, subject: m.subject || '', lessons: new Map() });
    const g = byKey.get(key);
    const lk = `${m.lesson_no || 0}|${m.lesson_title || ''}`;
    if (!g.lessons.has(lk)) g.lessons.set(lk, { no: m.lesson_no || null, title: m.lesson_title || '', items: [] });
    g.lessons.get(lk).items.push(m);
  }
  return [...byKey.values()]
    .sort((a, b) => (a.grade || 99) - (b.grade || 99) || a.subject.localeCompare(b.subject))
    .map((g) => ({
      ...g,
      lessons: [...g.lessons.values()].sort((a, b) => (a.no || 999) - (b.no || 999) || a.title.localeCompare(b.title)),
    }));
}

export default function MaterialsLessonView({ items, area, canManage, canEdit, onPreview, onEdit, onDownload, onDelete }) {
  const groups = group(items);
  const [closed, setClosed] = useState(() => new Set());
  const toggle = (k) => setClosed((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  return (
    <div className="grid gap-3">
      {groups.map((g) => {
        const key = `${g.grade}|${g.subject}`;
        const open = !closed.has(key);
        const count = g.lessons.reduce((s, l) => s + l.items.length, 0);
        return (
          <div key={key} className="card overflow-hidden">
            <button type="button" onClick={() => toggle(key)}
              className="w-full flex items-center gap-2.5 px-4 py-3 bg-brand-50/60 hover:bg-brand-50 text-left">
              <span className="text-[16px]">{open ? '▾' : '▸'}</span>
              <span className="font-bold text-[15px] text-brand-900">
                {g.grade ? `Khối ${g.grade}` : 'Chưa phân khối'}
                {g.subject ? ` · ${g.subject}` : ''}
              </span>
              <span className="text-[12px] text-ink-muted ml-auto">
                {g.lessons.length} tiết · {count} tài liệu
              </span>
            </button>

            {open && (
              <div className="divide-y divide-line">
                {g.lessons.map((l) => (
                  <div key={`${l.no}|${l.title}`} className="px-4 py-3">
                    <div className="text-[13.5px] font-semibold text-ink mb-1.5">
                      {l.no ? `Tiết ${l.no}` : 'Chưa đánh số tiết'}
                      {l.title ? <span className="font-normal text-ink-soft"> — {l.title}</span> : null}
                    </div>
                    <div className="grid gap-1.5">
                      {l.items.map((m) => (
                        <div key={m.id} className="flex items-center gap-2 rounded-xl border border-line px-2.5 py-1.5 hover:border-brand-300">
                          <span className="text-[15px] shrink-0">{m.type_icon || '📄'}</span>
                          <button type="button" onClick={() => onPreview(m)}
                            className="min-w-0 flex-1 text-left truncate text-[13.5px] font-medium text-ink hover:text-brand-800 hover:underline">
                            {m.title}
                          </button>
                          {m.type_name && (
                            <span className="hidden sm:inline text-[11.5px] text-ink-muted shrink-0">{m.type_name}</span>
                          )}
                          {area === 'teacher' && m.approval_status && m.approval_status !== 'approved' && (
                            <Badge tone={m.approval_status}>{LABEL.approval[m.approval_status] || m.approval_status}</Badge>
                          )}
                          <span className="shrink-0 flex items-center">
                            <button type="button" title="Xem trước" onClick={() => onPreview(m)}
                              className="h-7 w-7 rounded-lg text-[14px] text-brand-700 hover:bg-brand-50">👁</button>
                            {m.latest_version?.file_id && (
                              <button type="button" title="Tải về" onClick={() => onDownload(m)}
                                className="h-7 w-7 rounded-lg text-[14px] text-brand-700 hover:bg-brand-50">⬇</button>
                            )}
                            {canEdit(m) && (
                              <button type="button" title="Sửa thông tin" onClick={() => onEdit(m)}
                                className="h-7 w-7 rounded-lg text-[13px] text-ink-muted hover:bg-brand-50 hover:text-brand-800">✏️</button>
                            )}
                            {canManage(m) && (
                              <button type="button" title="Xoá tài liệu này"
                                onClick={() => onDelete([{ id: m.id, title: m.title }])}
                                className="h-7 w-7 rounded-lg text-[13px] text-ink-muted hover:bg-rose-50 hover:text-rose-700">🗑</button>
                            )}
                            <Link to={`/hoc-lieu/${m.id}`} title="Mở chi tiết"
                              className="h-7 w-7 rounded-lg text-[13px] text-ink-muted hover:bg-brand-50 hover:text-brand-800 grid place-items-center">›</Link>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
