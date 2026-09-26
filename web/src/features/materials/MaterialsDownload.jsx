/**
 * MaterialsDownload.jsx — Tải học liệu về máy thành một tệp .zip.
 *
 * Chọn phạm vi:
 *   - Các tài liệu đã tích chọn trong danh sách (tải theo từng bài).
 *   - Theo bộ lọc đang xem (giải pháp / khối / loại / tìm kiếm).
 *   - Cả thư mục giải pháp (mọi khối, mọi bài của giải pháp đang chọn).
 * Chọn loại tài liệu cần lấy (chỉ giáo án, chỉ slide…) và cách xếp thư mục:
 *   Giải pháp › Khối › Loại  hoặc  Giải pháp › Khối › Bài học.
 * Trong ZIP luôn có tệp Excel "Danh mục học liệu" liệt kê toàn bộ tệp.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { fmtSize, LABEL } from '../../lib/format.js';
import { Sheet, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';

const GROUP_KEY = 'teachops.zip-group';

function Choice({ checked, onChange, title, sub, disabled }) {
  return (
    <label className={`flex gap-3 rounded-xl border px-3.5 py-3 cursor-pointer transition
      ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      ${checked ? 'border-brand-400 bg-brand-50/70 ring-1 ring-brand-300' : 'border-line hover:border-brand-200'}`}>
      <input type="radio" className="mt-1 accent-accent-600" checked={checked} disabled={disabled}
        onChange={onChange} />
      <span className="min-w-0">
        <span className="block font-semibold text-base text-ink">{title}</span>
        {sub && <span className="block text-sm text-ink-muted mt-0.5">{sub}</span>}
      </span>
    </label>
  );
}

export default function MaterialsDownload({
  open, onClose, filters, selectedIds, types, solutionLabel, gradeLabel,
}) {
  const toast = useToast();
  const hasSelection = selectedIds.length > 0;
  const [scope, setScope] = useState('filter');
  const [typeIds, setTypeIds] = useState([]);          // [] = mọi loại
  const [group, setGroup] = useState(() => {
    try { return localStorage.getItem(GROUP_KEY) || 'type'; } catch { return 'type'; }
  });
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Mỗi lần mở: ưu tiên "đã chọn" nếu có, loại tài liệu lấy theo bộ lọc hiện tại.
  useEffect(() => {
    if (!open) return;
    setScope(hasSelection ? 'selected' : 'filter');
    setTypeIds(filters.typeId ? [filters.typeId] : []);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = useMemo(() => {
    if (scope === 'selected') return { ids: selectedIds };
    const base = { area: filters.area, type_ids: typeIds.length ? typeIds : undefined };
    if (scope === 'solution') return { ...base, solution_id: filters.solutionId };
    return {
      ...base,
      solution_id: filters.solutionId || undefined,
      grade: filters.grade || undefined,
      level: filters.level || undefined,
      q: filters.q || undefined,
    };
  }, [scope, selectedIds, filters, typeIds]);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.get('/api/materials/zip/preview', query)
        .then((d) => { if (alive) setPreview(d); })
        .catch((e) => { if (alive) { setPreview(null); toast.fromError(e); } })
        .finally(() => { if (alive) setLoading(false); });
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [open, query, toast]);

  const toggleType = (id) =>
    setTypeIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const pickGroup = (g) => {
    setGroup(g);
    try { localStorage.setItem(GROUP_KEY, g); } catch { /* bỏ qua */ }
  };

  const blocked = !preview || preview.count === 0 || preview.too_many || preview.too_large
    || (preview.file_count + preview.text_count === 0);

  const start = async () => {
    setBusy(true);
    try {
      // Gọi lại preview để chắc chắn token còn hạn và lựa chọn vẫn hợp lệ ngay lúc tải.
      const p = await api.get('/api/materials/zip/preview', query);
      if (!p.count || p.too_many || p.too_large) { setPreview(p); return; }
      api.downloadDirect('/api/materials/zip', { ...query, group });
      toast.ok(`Đang tải ${p.file_count + p.text_count} tệp — xem tiến trình ở thanh tải xuống của trình duyệt.`, 6000);
      onClose();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  const filterBits = [
    solutionLabel && `🧩 ${solutionLabel}`,
    gradeLabel,
    filters.level && LABEL.level[filters.level],
    filters.q && `"${filters.q}"`,
  ].filter(Boolean);

  const showTypes = scope !== 'selected';

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} title="Tải học liệu về máy (.zip)" wide>
      <div className="text-sm font-bold uppercase tracking-wide text-ink-muted mb-2">1. Tải những gì</div>
      <div className="grid gap-2 mb-4">
        <Choice
          checked={scope === 'selected'}
          disabled={!hasSelection}
          onChange={() => setScope('selected')}
          title={`Các tài liệu đã chọn${hasSelection ? ` (${selectedIds.length})` : ''}`}
          sub={hasSelection
            ? 'Tải đúng từng bài / từng tệp đã tích trong danh sách.'
            : 'Tích ô vuông ở từng dòng trong danh sách để chọn từng bài.'}
        />
        <Choice
          checked={scope === 'filter'}
          onChange={() => setScope('filter')}
          title="Tất cả theo bộ lọc đang xem"
          sub={filterBits.length
            ? `Khu vực ${filters.area === 'official' ? 'Phòng chuyên môn' : 'Giáo viên'} · ${filterBits.join(' · ')}`
            : `Toàn bộ kho khu vực ${filters.area === 'official' ? 'Phòng chuyên môn' : 'Giáo viên'}.`}
        />
        {filters.solutionId && (
          <Choice
            checked={scope === 'solution'}
            onChange={() => setScope('solution')}
            title={`Cả thư mục giải pháp «${solutionLabel}»`}
            sub="Mọi khối, mọi bài của giải pháp (gồm cả các mục con) — bỏ qua bộ lọc khối và tìm kiếm."
          />
        )}
      </div>

      {showTypes && (
        <>
          <div className="text-sm font-bold uppercase tracking-wide text-ink-muted mb-2">2. Loại tài liệu</div>
          <div className="flex flex-wrap gap-1.5 mb-4">
            <button type="button" onClick={() => setTypeIds([])}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-inset transition
                ${typeIds.length === 0 ? 'bg-brand-grad text-white ring-transparent' : 'bg-white text-ink-soft ring-line hover:ring-brand-300'}`}>
              Tất cả loại
            </button>
            {types.map((t) => (
              <button key={t.id} type="button" onClick={() => toggleType(t.id)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-inset transition
                  ${typeIds.includes(t.id) ? 'bg-brand-grad text-white ring-transparent' : 'bg-white text-ink-soft ring-line hover:ring-brand-300'}`}>
                {typeIds.includes(t.id) ? '✓ ' : ''}{t.icon} {t.name}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="text-sm font-bold uppercase tracking-wide text-ink-muted mb-2">
        {showTypes ? '3' : '2'}. Xếp thư mục trong ZIP
      </div>
      <div className="grid sm:grid-cols-2 gap-2 mb-4">
        <Choice
          checked={group === 'type'}
          onChange={() => pickGroup('type')}
          title="📂 Theo loại tài liệu"
          sub="Giải pháp › Khối › Giáo án / Slide / … › từng tệp"
        />
        <Choice
          checked={group === 'lesson'}
          onChange={() => pickGroup('lesson')}
          title="📖 Theo bài học"
          sub="Giải pháp › Khối › Tiết – Tên bài › đủ giáo án, slide của bài"
        />
      </div>

      <div className={`rounded-xl px-3.5 py-3 text-sm border
        ${preview && blocked ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-canvas border-line text-ink-soft'}`}>
        {loading || !preview ? (
          <span className="flex items-center gap-2"><Spinner className="h-4 w-4" /> Đang tính dung lượng…</span>
        ) : preview.count === 0 ? (
          'Không có tài liệu nào khớp lựa chọn.'
        ) : preview.too_many ? (
          `Vượt quá ${preview.max_items} tài liệu mỗi lần — hãy thu hẹp theo khối hoặc loại tài liệu.`
        ) : preview.too_large ? (
          `Tổng dung lượng ${fmtSize(preview.total_bytes)} vượt giới hạn ${fmtSize(preview.max_bytes)} — hãy tải theo từng khối hoặc từng loại.`
        ) : preview.file_count + preview.text_count === 0 ? (
          'Các tài liệu này chưa có tệp đính kèm để tải.'
        ) : (
          <>
            Sẽ tải{' '}
            {preview.file_count > 0 && <><b>{preview.file_count} tệp</b> ({fmtSize(preview.total_bytes)})</>}
            {preview.file_count > 0 && preview.text_count > 0 && ' + '}
            {preview.text_count > 0 && <><b>{preview.text_count} bài viết</b> dạng .txt</>}
            {' '}+ tệp Excel <b>danh mục học liệu</b>.
          </>
        )}
      </div>

      <div className="form-actions flex gap-2.5 justify-end mt-4">
        <button type="button" className="btn-line" onClick={onClose} disabled={busy}>Huỷ</button>
        <button type="button" className="btn-primary" onClick={start} disabled={busy || loading || blocked}>
          {busy ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : '⬇ Tải về (.zip)'}
        </button>
      </div>
    </Sheet>
  );
}
