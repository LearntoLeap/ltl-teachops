/**
 * SolutionsHome.jsx — Danh mục giải pháp giảng dạy dạng cây (UBTECH, Stick'em, Weeemake…).
 *
 * - Lọc theo nhóm giải pháp và cấp học (Segmented).
 * - Bấm một mục → Sheet chi tiết: mô tả + tài liệu (kind='doc') + bảng thiết bị (kind='checklist').
 * - `solution.manageRoot` (admin): tạo/sửa/xoá mục GỐC.
 * - `solution.manageChild` (admin + manager): mục con và nội dung bên trong.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, fileUrl } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { LABEL, fmtNumber } from '../../lib/format.js';
import { useToast } from '../../components/Toast.jsx';
import {
  Badge, ConfirmSheet, EmptyState, ErrorBox, Field, PageHeader, PageLoading,
  Segmented, Sheet, Spinner,
} from '../../components/ui.jsx';

const GROUP_OPTIONS = [
  { value: '', label: 'Tất cả' },
  ...Object.entries(LABEL.solutionGroup).map(([value, label]) => ({ value, label })),
];

const LEVEL_OPTIONS = [
  { value: '', label: 'Mọi cấp học' },
  ...Object.entries(LABEL.level).map(([value, label]) => ({ value, label })),
];

const EMPTY_NODE = { grp: 'ubtech', name: '', level: '', description: '' };
const EMPTY_ITEM = { kind: 'doc', label: '', qty: '1', note: '' };

/** Server trả cây (children[]) hoặc danh sách phẳng có parent_id — chuẩn hoá về mảng mục gốc. */
function normalizeTree(data) {
  const list = Array.isArray(data) ? data : data?.items || [];
  if (list.some((n) => Array.isArray(n.children))) {
    return list.map((n) => ({ ...n, children: n.children || [] }));
  }
  const map = new Map(list.map((n) => [n.id, { ...n, children: [] }]));
  const roots = [];
  for (const n of map.values()) {
    if (n.parent_id && map.has(n.parent_id)) map.get(n.parent_id).children.push(n);
    else roots.push(n);
  }
  return roots;
}

/** Lấy id tệp của một item tài liệu — chịu được nhiều dạng dữ liệu server trả về. */
function fileIdOf(it) {
  if (!it) return null;
  if (it.file_id) return it.file_id;
  if (it.file && typeof it.file === 'object') return it.file.id || null;
  return it.file || null;
}

/* ------------------------------ Mục con (đệ quy) --------------------------- */
function ChildNode({ node, depth, onOpen }) {
  return (
    <>
      <button
        type="button"
        onClick={() => onOpen(node)}
        style={{ marginLeft: depth * 14 }}
        className="flex items-center gap-2 max-w-full rounded-lg px-2 py-1 text-left hover:bg-brand-50 transition">
        <span className="text-brand-400">↳</span>
        <span className="font-medium text-[13.5px] text-ink-soft truncate">{node.name}</span>
        {node.level && <Badge tone="low">{LABEL.level[node.level] || node.level}</Badge>}
      </button>
      {(node.children || []).map((c) => (
        <ChildNode key={c.id} node={c} depth={depth + 1} onOpen={onOpen} />
      ))}
    </>
  );
}

export default function SolutionsHome() {
  const auth = useAuth();
  const toast = useToast();

  const canRoot = auth.can('solution.manageRoot');
  const canChild = auth.can('solution.manageChild');

  /* --------------------------------- Bộ lọc --------------------------------- */
  const [grp, setGrp] = useState('');
  const [level, setLevel] = useState('');

  /* ----------------------------------- Cây ---------------------------------- */
  const [roots, setRoots] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await api.get('/api/solutions', { grp, level });
      setRoots(normalizeTree(data));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [grp, level]);

  useEffect(() => { load(); }, [load]);

  /* ---------------------------- Sheet chi tiết mục --------------------------- */
  const [detail, setDetail] = useState(null);        // { node, isRoot }
  const [items, setItems] = useState(null);
  const [itemsErr, setItemsErr] = useState(null);

  const loadItems = useCallback(async (solutionId) => {
    setItems(null);
    setItemsErr(null);
    try {
      const data = await api.get(`/api/solutions/${solutionId}/items`);
      setItems(Array.isArray(data) ? data : data?.items || []);
    } catch (e) {
      setItemsErr(e);
    }
  }, []);

  const detailId = detail?.node?.id;
  useEffect(() => {
    if (detailId) loadItems(detailId);
    else { setItems(null); setItemsErr(null); }
  }, [detailId, loadItems]);

  const openNode = (node, isRoot) => setDetail({ node, isRoot });
  const canManageDetail = detail ? (detail.isRoot ? canRoot : canChild) : false;

  const docs = (items || []).filter((i) => i.kind === 'doc');
  const checks = (items || []).filter((i) => i.kind === 'checklist');

  /* --------------------------- Form mục (gốc / con) -------------------------- */
  const [nodeForm, setNodeForm] = useState(null);    // { mode:'create-root'|'create-child'|'edit', parent?, node?, values }
  const [savingNode, setSavingNode] = useState(false);
  const setNodeVal = (k, v) => setNodeForm((f) => ({ ...f, values: { ...f.values, [k]: v } }));

  const submitNode = async () => {
    const v = nodeForm.values;
    if (!v.grp) { toast.err('Vui lòng chọn nhóm giải pháp.'); return; }
    if (!v.name.trim()) { toast.err('Vui lòng nhập tên mục.'); return; }
    setSavingNode(true);
    try {
      const body = {
        grp: v.grp,
        name: v.name.trim(),
        level: v.level || null,
        description: v.description.trim() || null,
      };
      if (nodeForm.mode === 'edit') {
        await api.patch(`/api/solutions/${nodeForm.node.id}`, body);
        toast.ok('Đã cập nhật mục.');
        if (detail?.node?.id === nodeForm.node.id) {
          setDetail((d) => ({ ...d, node: { ...d.node, ...body } }));
        }
      } else {
        if (nodeForm.mode === 'create-child') body.parent_id = nodeForm.parent.id;
        await api.post('/api/solutions', body);
        toast.ok(nodeForm.mode === 'create-child' ? 'Đã thêm mục con.' : 'Đã thêm mục gốc.');
      }
      setNodeForm(null);
      await load();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setSavingNode(false);
    }
  };

  /* -------------------------- Form nội dung (item) --------------------------- */
  const [itemForm, setItemForm] = useState(null);    // { mode:'create'|'edit', solutionId, item?, values }
  const [itemFile, setItemFile] = useState(null);
  const [savingItem, setSavingItem] = useState(false);
  const setItemVal = (k, v) => setItemForm((f) => ({ ...f, values: { ...f.values, [k]: v } }));

  const closeItemForm = () => { setItemForm(null); setItemFile(null); };

  const openCreateItem = () => {
    setItemFile(null);
    setItemForm({ mode: 'create', solutionId: detail.node.id, values: { ...EMPTY_ITEM } });
  };

  const openEditItem = (it) => {
    setItemFile(null);
    setItemForm({
      mode: 'edit',
      solutionId: detail.node.id,
      item: it,
      values: { kind: it.kind, label: it.label || '', qty: String(it.qty ?? 1), note: it.note || '' },
    });
  };

  const submitItem = async () => {
    const v = itemForm.values;
    if (!v.label.trim()) {
      toast.err(v.kind === 'doc' ? 'Vui lòng nhập tên tài liệu.' : 'Vui lòng nhập tên thiết bị.');
      return;
    }
    if (v.kind === 'doc' && itemForm.mode === 'create' && !itemFile) {
      toast.err('Vui lòng chọn tệp tài liệu.');
      return;
    }
    setSavingItem(true);
    try {
      const fd = new FormData();
      fd.append('kind', v.kind);
      fd.append('label', v.label.trim());
      if (v.kind === 'checklist') fd.append('qty', String(Math.max(1, Number(v.qty) || 1)));
      fd.append('note', v.note.trim());
      if (itemFile) fd.append('file', itemFile, itemFile.name);
      if (itemForm.mode === 'edit') {
        await api.upload(`/api/solutions/items/${itemForm.item.id}`, fd, { method: 'PATCH' });
        toast.ok('Đã cập nhật nội dung.');
      } else {
        await api.upload(`/api/solutions/${itemForm.solutionId}/items`, fd);
        toast.ok('Đã thêm nội dung.');
      }
      closeItemForm();
      if (detail) await loadItems(detail.node.id);
    } catch (e) {
      toast.fromError(e);
    } finally {
      setSavingItem(false);
    }
  };

  /* ------------------------------ Xoá (xác nhận) ----------------------------- */
  const [confirmDel, setConfirmDel] = useState(null); // { type:'node'|'item', id, name }
  const [deleting, setDeleting] = useState(false);

  const doDelete = async () => {
    setDeleting(true);
    try {
      if (confirmDel.type === 'node') {
        await api.del(`/api/solutions/${confirmDel.id}`);
        toast.ok('Đã xoá mục.');
        if (detail?.node?.id === confirmDel.id) setDetail(null);
        await load();
      } else {
        await api.del(`/api/solutions/items/${confirmDel.id}`);
        toast.ok('Đã xoá nội dung.');
        if (detail) await loadItems(detail.node.id);
      }
      setConfirmDel(null);
    } catch (e) {
      toast.fromError(e);
    } finally {
      setDeleting(false);
    }
  };

  /* ---------------------------------- Render --------------------------------- */
  if (loading && roots === null) return <PageLoading />;

  return (
    <div>
      <PageHeader
        title="Giải pháp giảng dạy"
        sub="Danh mục giải pháp, tài liệu hướng dẫn và thiết bị theo từng bộ công cụ."
        actions={canRoot && (
          <button className="btn-primary" onClick={() => setNodeForm({ mode: 'create-root', values: { ...EMPTY_NODE } })}>
            + Thêm mục gốc
          </button>
        )}
      />

      <div className="flex flex-col items-start gap-2 mb-4">
        <Segmented options={GROUP_OPTIONS} value={grp} onChange={setGrp} />
        <Segmented options={LEVEL_OPTIONS} value={level} onChange={setLevel} />
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}

      {!error && roots && roots.length === 0 && (
        <EmptyState
          icon="🧩"
          title="Chưa có mục giải pháp nào"
          hint={grp || level
            ? 'Không có mục nào khớp bộ lọc hiện tại. Hãy thử chọn nhóm hoặc cấp học khác.'
            : canRoot
              ? 'Bấm "+ Thêm mục gốc" để tạo danh mục giải pháp đầu tiên.'
              : 'Danh mục giải pháp sẽ được Quản trị viên và Phòng chuyên môn cập nhật.'}
          action={canRoot && !grp && !level && (
            <button className="btn-primary" onClick={() => setNodeForm({ mode: 'create-root', values: { ...EMPTY_NODE } })}>
              + Thêm mục gốc
            </button>
          )}
        />
      )}

      {!error && roots && roots.length > 0 && (
        <div className={`grid gap-3 ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          {roots.map((node) => (
            <div key={node.id} className="card p-4">
              <button type="button" className="w-full text-left" onClick={() => openNode(node, true)}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-[15px]">{node.name}</span>
                  <Badge tone="neutral">{LABEL.solutionGroup[node.grp] || node.grp || 'Khác'}</Badge>
                  {node.level && <Badge tone="low">{LABEL.level[node.level] || node.level}</Badge>}
                </div>
                {node.description && (
                  <div className="text-[13px] text-ink-muted mt-1">{node.description}</div>
                )}
              </button>
              {(node.children || []).length > 0 && (
                <div className="mt-2.5 ml-1 border-l-2 border-brand-100 pl-2 flex flex-col items-start gap-0.5">
                  {node.children.map((c) => (
                    <ChildNode key={c.id} node={c} depth={0} onOpen={(n) => openNode(n, false)} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ------------------------- Sheet chi tiết một mục ------------------------ */}
      <Sheet open={!!detail} onClose={() => setDetail(null)} title={detail?.node?.name} wide>
        {detail && (
          <div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              <Badge tone="neutral">{LABEL.solutionGroup[detail.node.grp] || detail.node.grp || 'Khác'}</Badge>
              {detail.node.level && <Badge tone="low">{LABEL.level[detail.node.level] || detail.node.level}</Badge>}
            </div>

            {detail.node.description && (
              <p className="text-[14px] text-ink-soft whitespace-pre-wrap mb-4">{detail.node.description}</p>
            )}

            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="font-bold text-[13.5px] text-brand-900">Tài liệu & thiết bị</div>
              {canChild && (
                <button className="btn-ghost !px-2.5 !py-1 text-[13px]" onClick={openCreateItem}>
                  + Thêm nội dung
                </button>
              )}
            </div>

            {items === null && !itemsErr && (
              <div className="py-6 text-center"><Spinner /></div>
            )}
            {itemsErr && <ErrorBox error={itemsErr} onRetry={() => loadItems(detail.node.id)} />}
            {items && items.length === 0 && (
              <div className="text-[13px] text-ink-muted text-center py-3">
                Chưa có tài liệu hay danh mục thiết bị nào.
              </div>
            )}

            {docs.length > 0 && (
              <div className="grid gap-1.5 mb-3">
                {docs.map((it) => {
                  const fid = fileIdOf(it);
                  return (
                    <div key={it.id} className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2">
                      <span className="text-[18px]">📄</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] font-medium truncate">{it.label}</div>
                        {it.note && <div className="text-[12px] text-ink-muted truncate">{it.note}</div>}
                      </div>
                      {fid && (
                        <a className="btn-line !px-3 !py-1.5 text-[13px]" href={fileUrl(fid)} target="_blank" rel="noreferrer">
                          ⬇ Tải
                        </a>
                      )}
                      {canChild && (
                        <div className="flex gap-0.5">
                          <button className="btn-ghost !p-1.5" onClick={() => openEditItem(it)} aria-label="Sửa">✏️</button>
                          <button className="btn-ghost !p-1.5" onClick={() => setConfirmDel({ type: 'item', id: it.id, name: it.label })} aria-label="Xoá">🗑️</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {checks.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-line mb-3">
                <table className="w-full min-w-[420px]">
                  <thead>
                    <tr>
                      <th className="th">Thiết bị</th>
                      <th className="th text-center w-16">SL</th>
                      <th className="th">Ghi chú</th>
                      {canChild && <th className="th w-20"><span className="sr-only">Thao tác</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {checks.map((it) => (
                      <tr key={it.id}>
                        <td className="td font-medium">{it.label}</td>
                        <td className="td text-center">{fmtNumber(it.qty ?? 1)}</td>
                        <td className="td text-ink-muted">{it.note || '—'}</td>
                        {canChild && (
                          <td className="td whitespace-nowrap text-right">
                            <button className="btn-ghost !p-1" onClick={() => openEditItem(it)} aria-label="Sửa">✏️</button>
                            <button className="btn-ghost !p-1" onClick={() => setConfirmDel({ type: 'item', id: it.id, name: it.label })} aria-label="Xoá">🗑️</button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(canChild || canManageDetail) && (
              <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-line">
                {detail.isRoot && canChild && (
                  <button
                    className="btn-primary"
                    onClick={() => setNodeForm({
                      mode: 'create-child',
                      parent: detail.node,
                      values: { ...EMPTY_NODE, grp: detail.node.grp || 'other', level: detail.node.level || '' },
                    })}>
                    + Thêm mục
                  </button>
                )}
                {canManageDetail && (
                  <>
                    <button
                      className="btn-line"
                      onClick={() => setNodeForm({
                        mode: 'edit',
                        node: detail.node,
                        values: {
                          grp: detail.node.grp || 'other',
                          name: detail.node.name || '',
                          level: detail.node.level || '',
                          description: detail.node.description || '',
                        },
                      })}>
                      ✏️ Sửa mục
                    </button>
                    <button
                      className="btn-line !text-rose-600 !border-rose-200"
                      onClick={() => setConfirmDel({ type: 'node', id: detail.node.id, name: detail.node.name })}>
                      🗑️ Xoá mục
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </Sheet>

      {/* --------------------------- Sheet form mục ------------------------------ */}
      <Sheet
        open={!!nodeForm}
        onClose={savingNode ? undefined : () => setNodeForm(null)}
        title={nodeForm?.mode === 'edit'
          ? 'Sửa mục giải pháp'
          : nodeForm?.mode === 'create-child'
            ? `Thêm mục con của "${nodeForm?.parent?.name || ''}"`
            : 'Thêm mục gốc'}>
        {nodeForm && (
          <form onSubmit={(e) => { e.preventDefault(); submitNode(); }} noValidate>
            <Field label="Nhóm giải pháp" required>
              <select className="input" value={nodeForm.values.grp} onChange={(e) => setNodeVal('grp', e.target.value)}>
                {Object.entries(LABEL.solutionGroup).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label="Tên mục" required>
              <input
                className="input"
                value={nodeForm.values.name}
                onChange={(e) => setNodeVal('name', e.target.value)}
                placeholder="Ví dụ: UGOT Robotics Kit"
                autoFocus
              />
            </Field>
            <Field label="Cấp học" hint="Bỏ trống nếu dùng cho mọi cấp học.">
              <select className="input" value={nodeForm.values.level} onChange={(e) => setNodeVal('level', e.target.value)}>
                <option value="">— Mọi cấp —</option>
                {Object.entries(LABEL.level).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label="Mô tả">
              <textarea
                className="input"
                rows={3}
                value={nodeForm.values.description}
                onChange={(e) => setNodeVal('description', e.target.value)}
                placeholder="Giải pháp gồm những gì, dùng cho chương trình nào…"
              />
            </Field>
            <div className="flex justify-end gap-2.5 mt-4">
              <button type="button" className="btn-line" onClick={() => setNodeForm(null)} disabled={savingNode}>Huỷ</button>
              <button type="submit" className="btn-primary" disabled={savingNode}>
                {savingNode
                  ? <Spinner className="h-4 w-4 border-white/40 border-t-white" />
                  : nodeForm.mode === 'edit' ? 'Lưu thay đổi' : 'Thêm mục'}
              </button>
            </div>
          </form>
        )}
      </Sheet>

      {/* ------------------------- Sheet form nội dung --------------------------- */}
      <Sheet
        open={!!itemForm}
        onClose={savingItem ? undefined : closeItemForm}
        title={itemForm?.mode === 'edit' ? 'Sửa nội dung' : 'Thêm nội dung'}>
        {itemForm && (
          <form onSubmit={(e) => { e.preventDefault(); submitItem(); }} noValidate>
            <Field label="Loại nội dung" required>
              <select
                className="input"
                value={itemForm.values.kind}
                onChange={(e) => setItemVal('kind', e.target.value)}
                disabled={itemForm.mode === 'edit'}>
                <option value="doc">Tài liệu (tệp đính kèm)</option>
                <option value="checklist">Thiết bị (danh mục kiểm đếm)</option>
              </select>
            </Field>
            <Field label={itemForm.values.kind === 'doc' ? 'Tên tài liệu' : 'Tên thiết bị'} required>
              <input
                className="input"
                value={itemForm.values.label}
                onChange={(e) => setItemVal('label', e.target.value)}
                placeholder={itemForm.values.kind === 'doc' ? 'Ví dụ: Hướng dẫn lắp ráp bài 3' : 'Ví dụ: Robot UGOT'}
                autoFocus
              />
            </Field>
            {itemForm.values.kind === 'checklist' && (
              <Field label="Số lượng" required>
                <input
                  className="input"
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={itemForm.values.qty}
                  onChange={(e) => setItemVal('qty', e.target.value)}
                />
              </Field>
            )}
            <Field label="Ghi chú">
              <input
                className="input"
                value={itemForm.values.note}
                onChange={(e) => setItemVal('note', e.target.value)}
                placeholder={itemForm.values.kind === 'checklist' ? 'Ví dụ: sạc đầy pin trước buổi học' : 'Mô tả ngắn về tài liệu'}
              />
            </Field>
            {itemForm.values.kind === 'doc' && (
              <Field
                label="Tệp đính kèm"
                required={itemForm.mode === 'create'}
                hint={(itemForm.mode === 'edit' ? 'Bỏ trống nếu giữ tệp cũ. ' : '') + 'Hỗ trợ PDF, Word, PowerPoint, Excel, ảnh — tối đa 15MB.'}>
                <input
                  className="input !py-2"
                  type="file"
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,image/*"
                  onChange={(e) => setItemFile(e.target.files?.[0] || null)}
                />
              </Field>
            )}
            <div className="flex justify-end gap-2.5 mt-4">
              <button type="button" className="btn-line" onClick={closeItemForm} disabled={savingItem}>Huỷ</button>
              <button type="submit" className="btn-primary" disabled={savingItem}>
                {savingItem
                  ? <Spinner className="h-4 w-4 border-white/40 border-t-white" />
                  : itemForm.mode === 'edit' ? 'Lưu thay đổi' : 'Thêm nội dung'}
              </button>
            </div>
          </form>
        )}
      </Sheet>

      {/* ------------------------------ Xác nhận xoá ------------------------------ */}
      <ConfirmSheet
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={doDelete}
        busy={deleting}
        danger
        title="Xoá?"
        confirmLabel="Xoá"
        message={confirmDel?.type === 'node'
          ? `Xoá mục "${confirmDel?.name || ''}" cùng toàn bộ nội dung bên trong? Hành động này không hoàn tác được.`
          : `Xoá nội dung "${confirmDel?.name || ''}"?`}
      />
    </div>
  );
}
