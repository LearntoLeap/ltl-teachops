/**
 * GlobalSearch.jsx — Tìm kiếm nhanh toàn hệ thống (GET /api/search).
 *
 * - <GlobalSearch/>: ô tìm kiếm desktop trên topbar, gợi ý thả xuống khi gõ
 *   (debounce 300ms), điều hướng thẳng tới đối tượng khi chọn.
 * - useQuickSearch(): hook dùng chung với màn hình /tim-kiem trên mobile.
 * - <ResultGroups/>: khối kết quả nhóm, tái sử dụng ở cả dropdown lẫn trang.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { LABEL, fmtDate, fmtTime } from '../lib/format.js';

const RECENT_KEY = 'teachops.recent-search';

export function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function pushRecent(q) {
  const list = [q, ...getRecent().filter((x) => x !== q)].slice(0, 6);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

/** Hook: gõ tới đâu tìm tới đó (debounce), kèm trạng thái đang tìm. */
export function useQuickSearch() {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const ctrl = useRef(null);

  const run = useCallback(async (term) => {
    ctrl.current?.abort();
    if (!term || term.trim().length < 2) { setData(null); setBusy(false); return; }
    const ac = new AbortController();
    ctrl.current = ac;
    setBusy(true);
    try {
      const res = await api.get('/api/search', { q: term.trim() }, { signal: ac.signal });
      setData(res);
      pushRecent(term.trim());
    } catch (e) {
      if (e.name !== 'AbortError') setData(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const onChange = useCallback((term) => {
    setQ(term);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => run(term), 300);
  }, [run]);

  useEffect(() => () => { clearTimeout(timer.current); ctrl.current?.abort(); }, []);

  const total = data
    ? ['schools', 'classes', 'users', 'materials', 'solutions', 'schedules']
        .reduce((a, k) => a + (data[k]?.length || 0), 0)
    : 0;

  return { q, onChange, data, busy, total, runNow: () => run(q) };
}

/** Một dòng kết quả. */
function Row({ icon, title, sub, onPick }) {
  return (
    <button type="button" onClick={onPick}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-brand-50/60 transition rounded-lg">
      <span className="text-lg w-6 text-center shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold truncate">{title}</span>
        {sub && <span className="block text-xs text-ink-muted truncate">{sub}</span>}
      </span>
    </button>
  );
}

/** Khối kết quả theo nhóm — dùng chung dropdown & trang tìm kiếm. */
export function ResultGroups({ data, onNavigate }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const go = (to) => { onNavigate?.(); navigate(to); };

  const groups = [
    {
      key: 'schedules', label: 'Tiết dạy sắp tới',
      rows: (data.schedules || []).map((s) => ({
        icon: '🗓️',
        title: `${s.period ? `Tiết ${s.period} · ` : ''}${fmtTime(s.start_time)} · Lớp ${s.class_name}`,
        sub: `${fmtDate(s.session_date)} — ${s.school_name}${s.teacher_name ? ` · GV ${s.teacher_name}` : ''}`,
        to: '/lich',
      })),
    },
    {
      key: 'schools', label: 'Trường',
      rows: (data.schools || []).map((s) => ({
        icon: '🏫', title: s.name, sub: [s.code, s.province].filter(Boolean).join(' · '),
        to: auth.can('org.manage') ? `/to-chuc/${s.id}` : '/lich',
      })),
    },
    {
      key: 'classes', label: 'Lớp',
      rows: (data.classes || []).map((c) => ({
        icon: '🎓', title: `Lớp ${c.name}`, sub: c.school_name,
        to: auth.can('org.manage') ? `/to-chuc/${c.school_id}` : '/diem-danh',
      })),
    },
    {
      key: 'users', label: 'Nhân sự',
      rows: (data.users || []).map((u) => ({
        icon: '👤', title: u.full_name, sub: `${LABEL.role[u.role] || u.role} · ${u.email}`,
        to: auth.can('users.manage') ? '/tai-khoan' : '/lich',
      })),
    },
    {
      key: 'materials', label: 'Học liệu',
      rows: (data.materials || []).map((m) => ({
        icon: m.type_icon || '📚',
        title: m.title,
        sub: [
          m.type_name,
          m.grade ? `Khối ${m.grade}` : LABEL.level[m.level],
          m.lesson_no ? `Tiết ${m.lesson_no}` : null,
          m.lesson_title,
        ].filter(Boolean).join(' · '),
        to: `/hoc-lieu/${m.id}`,
      })),
    },
    {
      key: 'solutions', label: 'Giải pháp',
      rows: (data.solutions || []).map((s) => ({
        icon: '🧩', title: s.name,
        sub: [LABEL.solutionGroup[s.grp], LABEL.level[s.level]].filter(Boolean).join(' · '),
        to: '/giai-phap',
      })),
    },
  ].filter((g) => g.rows.length > 0);

  if (!groups.length) {
    return (
      <div className="px-3 py-6 text-center text-sm text-ink-muted">
        Không tìm thấy kết quả cho “{data.q}”.
      </div>
    );
  }

  return (
    <div className="py-1">
      {groups.map((g) => (
        <div key={g.key} className="px-2 pb-1">
          <div className="px-2 pt-2 pb-1 text-xs font-bold uppercase tracking-[.1em] text-ink-muted">
            {g.label}
          </div>
          {g.rows.map((r, i) => (
            <Row key={`${g.key}${i}`} icon={r.icon} title={r.title} sub={r.sub} onPick={() => go(r.to)} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Ô tìm kiếm desktop (topbar) — dropdown gợi ý ngay dưới ô. */
export default function GlobalSearch() {
  const { q, onChange, data, busy } = useQuickSearch();
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  // Bấm ra ngoài hoặc nhấn Esc thì đóng gợi ý.
  useEffect(() => {
    const onDoc = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);

  const recent = getRecent();

  return (
    <div ref={boxRef} className="relative w-[300px] xl:w-[360px]">
      <div className="flex items-center gap-2 rounded-full bg-white border border-line px-3.5 py-[7px]
                      focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 transition">
        <span className="text-base text-ink-muted">🔍</span>
        <input
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          placeholder="Tìm trường, lớp, giáo viên, học liệu…"
          className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-ink-muted/70"
        />
        {busy && <span className="h-3.5 w-3.5 rounded-full border-2 border-brand-200 border-t-brand-600 animate-spin" />}
      </div>

      {open && (
        <div className="absolute top-[calc(100%+6px)] inset-x-0 z-50 card shadow-card-lg max-h-[420px] overflow-y-auto">
          {data && q.trim().length >= 2 ? (
            <ResultGroups data={data} onNavigate={() => setOpen(false)} />
          ) : (
            <div className="py-2">
              <div className="px-4 pt-1.5 pb-1 text-xs font-bold uppercase tracking-[.1em] text-ink-muted">
                {recent.length ? 'Tìm gần đây' : 'Gợi ý'}
              </div>
              {(recent.length ? recent : ['Tên trường', 'Tên giáo viên', 'Lớp 5A', 'Giáo án khối 6']).map((s) => (
                <button key={s} type="button"
                  onClick={() => { onChange(s); }}
                  className="w-full text-left px-4 py-1.5 text-sm text-ink-soft hover:bg-brand-50/60">
                  {recent.length ? '🕘 ' : '💡 '}{s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
