/**
 * DriveStorage.jsx — Lưu trữ ảnh & video trên Google Drive (/luu-tru-drive, chỉ Admin).
 *
 * - Kết nối: dán Client ID/secret của OAuth client → bấm Kết nối → đăng nhập Google
 *   trên chính trang của Google (không ai phải gửi mật khẩu cho ai).
 * - Theo dõi: đã lên Drive / chờ đẩy / lỗi / dung lượng đã giải phóng trên VPS.
 * - Cài đặt: giữ bản gốc trên VPS bao nhiêu ngày trước khi dọn.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { fmtAgo, fmtNumber } from '../../lib/format.js';
import {
  ConfirmSheet, ErrorBox, Field, PageHeader, PageLoading, Spinner,
} from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';

function bytes(n) {
  const b = Number(n) || 0;
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}

function Stat({ icon, label, value, sub, tone = 'brand' }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-800',
    green: 'bg-emerald-50 text-emerald-800',
    amber: 'bg-amber-50 text-amber-800',
    rose: 'bg-rose-50 text-rose-800',
  };
  return (
    <div className="card p-3.5 flex gap-3 items-start">
      <span className={`h-10 w-10 shrink-0 rounded-xl grid place-items-center text-[19px] ${tones[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <div className="text-[12px] text-ink-muted">{label}</div>
        <div className="text-[19px] font-bold text-ink leading-tight">{value}</div>
        {sub && <div className="text-[11.5px] text-ink-muted mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function Step({ n, title, done, children }) {
  return (
    <div className="flex gap-3">
      <span className={`h-7 w-7 shrink-0 rounded-full grid place-items-center text-[13px] font-bold
        ${done ? 'bg-emerald-500 text-white' : 'bg-brand-grad text-white'}`}>{done ? '✓' : n}</span>
      <div className="min-w-0 flex-1 pb-4">
        <div className="font-semibold text-[14.5px] text-ink mb-1">{title}</div>
        <div className="text-[13px] text-ink-soft leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

export default function DriveStorage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [st, setSt] = useState(null);
  const [error, setError] = useState(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [keepDays, setKeepDays] = useState('');
  const [minMb, setMinMb] = useState('');
  const [busy, setBusy] = useState('');
  const [confirmOff, setConfirmOff] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api.get('/api/drive');
      setSt(d);
      setKeepDays(String(d.keep_local_days ?? 7));
      setMinMb(String(d.material_min_mb ?? 20));
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Google chuyển về kèm ?ket_noi=ok|loi&ly_do=… ⇒ báo kết quả rồi dọn thanh địa chỉ.
  useEffect(() => {
    const r = params.get('ket_noi');
    if (!r) return;
    if (r === 'ok') toast.ok('Đã kết nối Google Drive. Ảnh/video sẽ bắt đầu được đồng bộ.', 6000);
    else toast.err(`Kết nối chưa thành công: ${params.get('ly_do') || 'không rõ lý do'}`, 9000);
    setParams({}, { replace: true });
  }, [params, setParams, toast]);

  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast.fromError(e); } finally { setBusy(''); }
  };

  const saveClient = () => run('config', async () => {
    const d = await api.put('/api/drive/config', { client_id: clientId.trim(), client_secret: clientSecret.trim() });
    setSt((s) => ({ ...s, ...d }));
    setClientSecret('');
    toast.ok('Đã lưu OAuth client. Bấm "Kết nối Google Drive" để đăng nhập.');
  });

  const connect = () => run('connect', async () => {
    const { url } = await api.get('/api/drive/connect');
    window.location.href = url;
  });

  const syncNow = () => run('sync', async () => {
    const r = await api.post('/api/drive/sync');
    setSt((s) => ({ ...s, ...r.status }));
    toast.ok(`Đã đẩy ${r.sync.sent} tệp lên Drive` +
      `${r.offload.freed ? `, giải phóng ${r.offload.freed} tệp (${bytes(r.offload.bytes)}) trên VPS` : ''}.`);
  });

  const saveKeep = () => run('keep', async () => {
    const d = await api.patch('/api/drive/settings', { keep_local_days: Number(keepDays) });
    setSt((s) => ({ ...s, ...d }));
    toast.ok('Đã lưu cài đặt.');
  });

  const toggleOffload = () => run('offload', async () => {
    const d = await api.patch('/api/drive/settings', { offload: !st.offload });
    setSt((s) => ({ ...s, ...d }));
  });

  const toggleMaterials = () => run('materials', async () => {
    const d = await api.patch('/api/drive/settings', { offload_materials: !st.offload_materials });
    setSt((s) => ({ ...s, ...d }));
  });

  const saveMinMb = () => run('minmb', async () => {
    const d = await api.patch('/api/drive/settings', { material_min_mb: Number(minMb) });
    setSt((s) => ({ ...s, ...d }));
    toast.ok('Đã lưu cài đặt.');
  });

  const disconnect = () => run('disconnect', async () => {
    const d = await api.post('/api/drive/disconnect');
    setSt((s) => ({ ...s, ...d }));
    setConfirmOff(false);
    toast.ok('Đã ngắt kết nối Google Drive.');
  });

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); toast.ok('Đã chép.'); } catch { toast.err('Không chép được — hãy bôi đen và chép tay.'); }
  };

  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!st) return <PageLoading />;

  const pct = st.total ? Math.round((st.synced / st.total) * 100) : 0;

  return (
    <div>
      <PageHeader
        title="Lưu trữ ảnh & video — Google Drive"
        sub="Ảnh/video giáo viên, trợ giảng gửi lên app được đẩy về Drive của công ty; bản gốc trên máy chủ tự dọn để tiết kiệm dung lượng"
        actions={st.connected && (
          <button className="btn-primary" onClick={syncNow} disabled={!!busy}>
            {busy === 'sync' ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : '⟳ Đồng bộ ngay'}
          </button>
        )}
      />

      {/* Trạng thái kết nối */}
      <div className={`card px-4 py-3.5 mb-4 flex flex-wrap items-center gap-3
        ${st.connected ? '!border-emerald-200 !bg-emerald-50/60' : '!border-amber-200 !bg-amber-50/60'}`}>
        <span className="text-[26px]">{st.connected ? '☁️' : '⚠️'}</span>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-[15px] text-ink">
            {st.connected ? 'Đang đồng bộ với Google Drive' : 'Chưa kết nối Google Drive'}
          </div>
          <div className="text-[12.5px] text-ink-soft">
            {st.connected
              ? <>Tài khoản <b>{st.account?.email || '—'}</b> · thư mục <b>LtL TeachOps — Ảnh &amp; Video</b>
                {st.last_synced_at && <> · lần đẩy gần nhất {fmtAgo(st.last_synced_at)}</>}</>
              : 'Ảnh/video hiện chỉ lưu trên máy chủ. Làm theo 3 bước bên dưới để kết nối.'}
          </div>
        </div>
        {st.root_folder_link && (
          <a className="btn-line !py-1.5 !px-3 text-[13px]" href={st.root_folder_link} target="_blank" rel="noreferrer">
            Mở thư mục trên Drive ↗
          </a>
        )}
        {st.connected && (
          <button className="btn-line !py-1.5 !px-3 text-[13px] !text-rose-700" onClick={() => setConfirmOff(true)} disabled={!!busy}>
            Ngắt kết nối
          </button>
        )}
      </div>

      {/* Số liệu */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <Stat icon="☁️" tone="green" label="Đã lên Drive" value={`${fmtNumber(st.synced)} / ${fmtNumber(st.total)}`}
          sub={`${pct}% tệp · gồm ${fmtNumber(st.videos)} video`} />
        <Stat icon="⏳" label="Đang chờ đẩy" value={fmtNumber(st.pending)} sub="Job nền đẩy mỗi 5 phút" />
        <Stat icon="🧹" tone="green" label="Đã giải phóng trên máy chủ" value={bytes(st.offloaded_bytes)}
          sub={`${fmtNumber(st.offloaded)} tệp chỉ còn trên Drive`} />
        <Stat icon="💾" tone="amber" label="Máy chủ đang giữ" value={bytes(st.local_bytes)} sub="Ảnh mới, học liệu, ảnh bìa" />
      </div>

      {st.failed > 0 || st.last_error ? (
        <div className="card !border-rose-200 !bg-rose-50/60 px-4 py-3 mb-4 text-[13px] text-rose-800">
          <b>{fmtNumber(st.failed)} tệp lỗi quá 5 lần</b>
          {st.last_error && <> · lỗi gần nhất{st.last_error_file ? ` (${st.last_error_file})` : ''}: {st.last_error}</>}
        </div>
      ) : null}

      <div className="grid lg:grid-cols-[1.25fr_1fr] gap-4 items-start">
        {/* Hướng dẫn kết nối */}
        <div className="card p-4">
          <div className="font-bold text-[15.5px] mb-3">
            {st.connected ? 'Cấu hình kết nối' : 'Kết nối trong 3 bước'}
          </div>

          <Step n={1} title="Tạo OAuth client trên Google Cloud (một lần, ~5 phút)" done={st.configured}>
            <ol className="list-decimal pl-4 space-y-1">
              <li>Đăng nhập <b>tài khoản Google sẽ chứa ảnh</b> → mở{' '}
                <a className="text-brand-700 underline" href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">Google Drive API</a>
                {' '}→ tạo project (vd "LtL TeachOps") → bấm <b>Enable</b>.</li>
              <li>Mục <b>OAuth consent screen</b>: chọn <b>External</b> (Gmail) hoặc <b>Internal</b> (Google Workspace),
                điền tên app + email → thêm scope <code className="text-[12px] bg-canvas px-1 rounded">…/auth/drive.file</code>.
                Với External: bấm <b>Publish app</b> (In production) — nếu để "Testing", Google tự ngắt kết nối sau 7 ngày.</li>
              <li>Mở{' '}
                <a className="text-brand-700 underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Credentials</a>
                {' '}→ <b>Create credentials → OAuth client ID</b> → loại <b>Web application</b> → mục
                <b> Authorized redirect URIs</b> dán đúng địa chỉ sau:
                <div className="flex gap-2 items-center mt-1.5">
                  <code className="flex-1 min-w-0 truncate text-[12px] bg-canvas border border-line rounded-lg px-2 py-1.5">{st.redirect_uri}</code>
                  <button type="button" className="btn-line !py-1 !px-2.5 text-[12px] shrink-0" onClick={() => copy(st.redirect_uri)}>Chép</button>
                </div>
              </li>
            </ol>
          </Step>

          <Step n={2} title="Dán Client ID và Client secret" done={st.configured}>
            {st.configured && (
              <div className="text-[12.5px] mb-2">Đang dùng: <code className="bg-canvas px-1 rounded">{st.client_id}</code>
                {st.source === 'env' && ' (từ tệp cấu hình máy chủ)'}</div>
            )}
            <Field label="Client ID">
              <input className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}
                placeholder="xxxxxxxx.apps.googleusercontent.com" autoComplete="off" />
            </Field>
            <Field label="Client secret" hint="Chỉ lưu trên máy chủ, không bao giờ hiển thị lại.">
              <input className="input" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)}
                placeholder="GOCSPX-…" autoComplete="new-password" />
            </Field>
            <button className="btn-line" onClick={saveClient} disabled={!!busy || !clientId.trim() || !clientSecret.trim()}>
              {busy === 'config' ? <Spinner className="h-4 w-4" /> : st.configured ? 'Thay OAuth client' : 'Lưu'}
            </button>
          </Step>

          <Step n={3} title="Đăng nhập Google và cho phép" done={st.connected}>
            <p className="mb-2">
              Bạn sẽ được đưa sang trang của Google — đăng nhập <b>tài khoản sẽ chứa ảnh</b>, bấm <b>Cho phép</b>,
              rồi tự quay về đây. Ứng dụng chỉ được quyền với các tệp do chính nó tạo, không đọc được phần còn lại
              của Drive. <b>Không gửi mật khẩu Google cho bất kỳ ai.</b>
            </p>
            <button className="btn-primary" onClick={connect} disabled={!!busy || !st.configured}>
              {busy === 'connect' ? <Spinner className="h-4 w-4 border-white/40 border-t-white" />
                : st.connected ? 'Kết nối lại' : '🔗 Kết nối Google Drive'}
            </button>
          </Step>
        </div>

        {/* Cài đặt dung lượng */}
        <div className="card p-4">
          <div className="font-bold text-[15.5px] mb-1">Tiết kiệm dung lượng máy chủ</div>
          <p className="text-[13px] text-ink-soft mb-3">
            Sau khi ảnh/video đã nằm an toàn trên Drive (kiểm tra khớp từng byte), bản gốc trên máy chủ được xoá —
            app vẫn mở xem bình thường (lấy từ Drive), ảnh thu nhỏ vẫn giữ để danh sách hiện nhanh.
            Ảnh bìa và ảnh đại diện luôn giữ trên máy chủ.
          </p>
          <label className="flex items-center gap-2.5 mb-3 cursor-pointer">
            <input type="checkbox" className="h-4 w-4 accent-[#8A3F97]" checked={!!st.offload}
              onChange={toggleOffload} disabled={!!busy} />
            <span className="text-[13.5px] font-semibold">Tự dọn bản gốc trên máy chủ</span>
          </label>
          <Field label="Giữ bản gốc trên máy chủ thêm (ngày)"
            hint="Trong khoảng này ảnh mở nhanh nhất (thường là lúc Phòng chuyên môn duyệt chấm công). 0 = dọn ngay khi đã lên Drive.">
            <div className="flex gap-2">
              <input className="input !w-28" type="number" min="0" max="365" value={keepDays}
                onChange={(e) => setKeepDays(e.target.value)} disabled={!st.offload} />
              <button className="btn-line" onClick={saveKeep}
                disabled={!!busy || !st.offload || keepDays === String(st.keep_local_days)}>
                {busy === 'keep' ? <Spinner className="h-4 w-4" /> : 'Lưu'}
              </button>
            </div>
          </Field>
          <div className="border-t border-line pt-3 mb-3">
            <label className="flex items-center gap-2.5 mb-2 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 accent-[#8A3F97]" checked={!!st.offload_materials}
                onChange={toggleMaterials} disabled={!!busy || !st.offload} />
              <span className="text-[13.5px] font-semibold">Chuyển cả học liệu lớn lên Drive</span>
            </label>
            <p className="text-[12.5px] text-ink-soft mb-2">
              Slide, giáo án, video bài giảng nặng sẽ nằm trên Drive; máy chủ chỉ giữ tệp nhỏ để mở nhanh.
              Khi tải ZIP, hệ thống tự lấy lại tệp từ Drive nên người dùng không thấy khác biệt.
            </p>
            <Field label="Chỉ chuyển tệp học liệu từ (MB) trở lên">
              <div className="flex gap-2">
                <input className="input !w-28" type="number" min="1" max="1000" value={minMb}
                  onChange={(e) => setMinMb(e.target.value)} disabled={!st.offload || !st.offload_materials} />
                <button className="btn-line" onClick={saveMinMb}
                  disabled={!!busy || !st.offload || !st.offload_materials || minMb === String(st.material_min_mb)}>
                  {busy === 'minmb' ? <Spinner className="h-4 w-4" /> : 'Lưu'}
                </button>
              </div>
            </Field>
          </div>

          <div className="rounded-xl bg-canvas border border-line px-3 py-2.5 text-[12.5px] text-ink-soft">
            📁 Trên Drive, tệp được xếp: <b>Trường › Tháng › Chấm công / Điểm danh / Kiểm kê thiết bị / Sự cố thiết bị / Góp ý</b>,
            tên tệp gồm ngày giờ, lớp và người gửi — tra cứu trực tiếp trên Drive rất nhanh.
            <br />🎥 Video minh chứng tối đa {st.max_video_mb} MB · 📚 học liệu tối đa {st.max_material_mb} MB mỗi tệp.
          </div>
        </div>
      </div>

      <ConfirmSheet
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        onConfirm={disconnect}
        busy={busy === 'disconnect'}
        danger
        title="Ngắt kết nối Google Drive?"
        confirmLabel="Ngắt kết nối"
        message={st.offloaded > 0
          ? `Hiện có ${fmtNumber(st.offloaded)} ảnh/video chỉ còn trên Drive — sau khi ngắt, app sẽ KHÔNG mở được các tệp này cho tới khi kết nối lại bằng đúng tài khoản ${st.account?.email || 'cũ'}. Tệp trên Drive không bị xoá.`
          : 'Ảnh/video mới sẽ chỉ lưu trên máy chủ. Các tệp đã lên Drive vẫn còn nguyên trên Drive.'}
      />
    </div>
  );
}
