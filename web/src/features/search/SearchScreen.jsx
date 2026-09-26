/**
 * SearchScreen.jsx — Trang tìm kiếm nhanh (mobile vào từ nút 🔍 trên topbar).
 * Cùng nguồn dữ liệu với ô tìm kiếm desktop: GET /api/search.
 */
import { useEffect, useRef } from 'react';
import { PageHeader, Spinner } from '../../components/ui.jsx';
import { ResultGroups, useQuickSearch, getRecent } from '../../components/GlobalSearch.jsx';

export default function SearchScreen() {
  const { q, onChange, data, busy } = useQuickSearch();
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  const recent = getRecent();

  return (
    <div className="max-w-lg mx-auto">
      <PageHeader title="Tìm kiếm nhanh" sub="Trường, lớp, giáo viên, buổi dạy, học liệu, giải pháp." />

      <div className="flex items-center gap-2 card px-4 py-3 sticky top-2 z-10">
        <span className="text-lg">🔍</span>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Gõ từ 2 ký tự để tìm…"
          className="flex-1 min-w-0 bg-transparent outline-none text-lg"
        />
        {busy && <Spinner className="h-4 w-4" />}
        {q && (
          <button className="text-ink-muted text-lg px-1" onClick={() => onChange('')} aria-label="Xoá">✕</button>
        )}
      </div>

      <div className="card mt-3 overflow-hidden">
        {data && q.trim().length >= 2 ? (
          <ResultGroups data={data} />
        ) : (
          <div className="py-2">
            <div className="px-4 pt-2 pb-1 text-xs font-bold uppercase tracking-[.1em] text-ink-muted">
              {recent.length ? 'Tìm gần đây' : 'Gợi ý tìm kiếm'}
            </div>
            {(recent.length ? recent : ['Tên trường', 'Tên giáo viên', 'Lớp 5A', 'Giáo án khối 6']).map((s) => (
              <button key={s} type="button" onClick={() => onChange(s)}
                className="w-full text-left px-4 py-2 text-base text-ink-soft hover:bg-brand-50/60">
                {recent.length ? '🕘 ' : '💡 '}{s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
