/**
 * ExportPreview.jsx — Xem trước ĐÚNG nội dung sắp xuất ra Excel.
 *
 * Gọi chính endpoint xuất dữ liệu với ?preview=1, nên bảng hiện ra dùng cùng bộ
 * cột và cùng bộ dòng với tệp tải về — không có chuyện xem một đằng tải một nẻo.
 * Máy chủ cắt bớt sau 300 dòng mỗi sheet và trả về tổng số dòng thật.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { fmtNumber } from '../../lib/format.js';
import { ErrorBox, Sheet, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';

const ALIGN = { center: 'text-center', right: 'text-right', left: 'text-left' };

/** Bảng xem trước của một sheet. */
export function PreviewTable({ sheet, dense = false }) {
  if (!sheet) return null;
  if (!sheet.rows.length) {
    return (
      <div className="text-[13.5px] text-ink-muted py-6 text-center">
        Không có dòng nào trong kỳ đã chọn — đổi tháng hoặc bỏ bớt bộ lọc.
      </div>
    );
  }
  return (
    <div className="overflow-auto max-h-[58vh] rounded-xl border border-line">
      <table className="w-full min-w-[720px]">
        <thead className="sticky top-0 z-10">
          <tr>
            {sheet.columns.map((c) => (
              <th key={c.key} className={`th !bg-canvas ${ALIGN[c.align] || ''}`}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((r, i) => (
            // Dòng xuất ra không có khoá riêng — chỉ số là định danh ổn định ở đây.
            <tr key={i} className="hover:bg-brand-50/40">
              {sheet.columns.map((c) => (
                <td key={c.key} className={`td ${dense ? '!py-1.5' : ''} ${ALIGN[c.align] || ''}`}>
                  {r[c.key] === null || r[c.key] === undefined || r[c.key] === '' ? '—' : String(r[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Dòng tóm tắt: đang xem bao nhiêu trên tổng bao nhiêu. */
export function PreviewCount({ sheet }) {
  if (!sheet) return null;
  return (
    <div className="text-[12.5px] text-ink-muted mt-1.5">
      {sheet.total > sheet.shown
        ? <>Đang xem <b>{fmtNumber(sheet.shown)}</b> dòng đầu trên tổng <b>{fmtNumber(sheet.total)}</b> dòng — tệp Excel có đủ tất cả.</>
        : <>Tổng <b>{fmtNumber(sheet.total)}</b> dòng.</>}
    </div>
  );
}

/** Nạp bản xem trước của một endpoint xuất dữ liệu. */
export function usePreview(path, query, enabled = true) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const key = JSON.stringify(query);

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    try {
      setData(await api.get(path, { ...JSON.parse(key), preview: 1 }));
    } catch (e) {
      setError(e);
    }
  }, [path, key]);

  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  return { data, error, reload: load };
}

/* ------------------------------ Sheet xem trước ---------------------------- */
export default function ExportPreview({ open, exp, query, onClose }) {
  const toast = useToast();
  const [tab, setTab] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const { data, error, reload } = usePreview(exp?.path, query, !!open && !!exp);

  useEffect(() => { setTab(0); }, [exp?.key, open]);

  if (!exp) return null;
  const sheets = data?.sheets || [];
  const sheet = sheets[tab];

  const download = async () => {
    setDownloading(true);
    try {
      const name = await api.download(exp.path, query, exp.file);
      toast.ok('Đã tải ' + name);
    } catch (e) {
      toast.fromError(e);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Sheet open={open} onClose={downloading ? undefined : onClose} title={`Xem trước — ${exp.label}`} wide="xl">
      {error && <ErrorBox error={error} onRetry={reload} />}
      {!error && !data && (
        <div className="flex items-center gap-2 text-[13.5px] text-ink-muted py-6">
          <Spinner className="h-4 w-4" /> Đang lấy dữ liệu…
        </div>
      )}

      {data && (
        <>
          {sheets.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {sheets.map((sh, i) => (
                <button key={sh.name} type="button" onClick={() => setTab(i)}
                  className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold ring-1 ring-inset transition
                    ${i === tab ? 'bg-brand-grad text-white ring-transparent'
                                : 'bg-white text-ink-soft ring-line hover:ring-brand-300'}`}>
                  {sh.name} ({fmtNumber(sh.total)})
                </button>
              ))}
            </div>
          )}

          {sheet?.subtitle && (
            <div className="text-[12.5px] text-ink-muted mb-1.5">{sheet.subtitle}</div>
          )}
          <PreviewTable sheet={sheet} />
          <PreviewCount sheet={sheet} />
        </>
      )}

      <div className="flex flex-wrap gap-2.5 justify-end mt-4">
        <button className="btn-line" onClick={onClose} disabled={downloading}>Đóng</button>
        <button className="btn-primary" onClick={download} disabled={downloading || !data}>
          {downloading
            ? <><Spinner className="h-4 w-4 border-white/40 border-t-white" /> Đang tải…</>
            : `⬇ Tải ${data?.file_name || exp.file}`}
        </button>
      </div>
    </Sheet>
  );
}
