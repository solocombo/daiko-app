import { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabaseClient";

export default function IntlShipping({ batches, orders }) {
  const [shippings, setShippings] = useState([]);
  const [batchLinks, setBatchLinks] = useState([]); // { intl_shipping_id, batch_id }
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: "", amount_twd: "", amount_jpy: "", date: new Date().toISOString().split("T")[0], note: "", selectedBatches: [] });
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    const [{ data: s }, { data: b }] = await Promise.all([
      supabase.from("intl_shipping").select("*").order("date", { ascending: false }),
      supabase.from("intl_shipping_batches").select("*"),
    ]);
    setShippings(s || []);
    setBatchLinks(b || []);
    setLoading(false);
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function toggleBatch(batchId) {
    setForm(f => ({
      ...f,
      selectedBatches: f.selectedBatches.includes(batchId)
        ? f.selectedBatches.filter(id => id !== batchId)
        : [...f.selectedBatches, batchId]
    }));
  }

  function openNew() {
    setEditingId(null);
    setForm({ name: "", amount_twd: "", amount_jpy: "", date: new Date().toISOString().split("T")[0], note: "", selectedBatches: [] });
    setShowForm(true);
  }

  function openEdit(shipping) {
    setEditingId(shipping.id);
    const linked = batchLinks.filter(b => b.intl_shipping_id === shipping.id).map(b => b.batch_id);
    setForm({
      name: shipping.name, amount_twd: String(shipping.amount_twd),
      amount_jpy: shipping.amount_jpy ? String(shipping.amount_jpy) : "",
      date: shipping.date || "", note: shipping.note || "",
      selectedBatches: linked,
    });
    setShowForm(true);
  }

  async function save() {
    if (!form.name || !form.amount_twd) return alert("請填寫名稱與台幣金額");
    setSaving(true);
    let shippingId = editingId;
    if (editingId) {
      await supabase.from("intl_shipping").update({
        name: form.name, amount_twd: parseFloat(form.amount_twd),
        amount_jpy: form.amount_jpy ? parseFloat(form.amount_jpy) : null,
        date: form.date, note: form.note,
      }).eq("id", editingId);
      await supabase.from("intl_shipping_batches").delete().eq("intl_shipping_id", editingId);
    } else {
      const { data } = await supabase.from("intl_shipping").insert([{
        name: form.name, amount_twd: parseFloat(form.amount_twd),
        amount_jpy: form.amount_jpy ? parseFloat(form.amount_jpy) : null,
        date: form.date, note: form.note,
      }]).select().single();
      shippingId = data.id;
    }
    if (form.selectedBatches.length > 0) {
      await supabase.from("intl_shipping_batches").insert(
        form.selectedBatches.map(bid => ({ intl_shipping_id: shippingId, batch_id: bid }))
      );
    }
    setSaving(false);
    setShowForm(false);
    fetchAll();
  }

  async function del(id) {
    if (!confirm("確定刪除這筆國際運費？")) return;
    await supabase.from("intl_shipping_batches").delete().eq("intl_shipping_id", id);
    await supabase.from("intl_shipping").delete().eq("id", id);
    fetchAll();
  }

  // Per-batch weight calculation
  const batchWeights = useMemo(() => {
    const map = {};
    batches.forEach(b => {
      const batchOrders = orders.filter(o => o.batch_id === b.id);
      map[b.id] = batchOrders.reduce((sum, o) =>
        sum + (o.order_items || []).filter(i => !i.not_obtained).reduce((s, i) => s + Number(i.weight_g || 0), 0), 0);
    });
    return map;
  }, [batches, orders]);

  // For each shipping, calculate per-batch and per-order allocation
  function getShippingAllocation(shipping) {
    const linked = batchLinks.filter(b => b.intl_shipping_id === shipping.id).map(b => b.batch_id);
    const totalWeight = linked.reduce((s, bid) => s + (batchWeights[bid] || 0), 0);
    return linked.map(bid => {
      const batch = batches.find(b => b.id === bid);
      const weight = batchWeights[bid] || 0;
      const share = totalWeight > 0 ? (weight / totalWeight) * Number(shipping.amount_twd) : 0;
      return { batch, weight, share };
    });
  }

  if (loading) return <div className="loading"><div className="loading-spinner" /><p>載入中...</p></div>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">國際運費管理</h1>
          <p className="page-sub">一筆運費可跨多個批次，按重量自動分攤</p>
        </div>
        <button className="btn-primary" onClick={openNew}>＋ 新增國際運費</button>
      </div>

      {shippings.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✈️</div>
          <p>還沒有國際運費記錄</p>
        </div>
      ) : (
        <div className="intl-shipping-list">
          {shippings.map(shipping => {
            const allocation = getShippingAllocation(shipping);
            const isExpanded = expandedId === shipping.id;
            return (
              <div key={shipping.id} className="intl-shipping-card">
                <div className="intl-shipping-header">
                  <div>
                    <div className="intl-shipping-name">✈️ {shipping.name}</div>
                    <div className="intl-shipping-meta">
                      {shipping.date}　
                      <span className="twd-text">NT${Number(shipping.amount_twd).toLocaleString()}</span>
                      {shipping.amount_jpy && <span className="text-muted">　¥{Number(shipping.amount_jpy).toLocaleString()}</span>}
                      　跨 {allocation.length} 個批次
                    </div>
                    {shipping.note && <div style={{fontSize:"12px",color:"var(--text3)",marginTop:"2px"}}>📝 {shipping.note}</div>}
                  </div>
                  <div className="intl-shipping-actions">
                    <button className="btn-secondary" style={{padding:"5px 12px",fontSize:"12px"}} onClick={() => setExpandedId(isExpanded ? null : shipping.id)}>
                      {isExpanded ? "收起" : "查看分攤"}
                    </button>
                    <button className="btn-edit-sm" onClick={() => openEdit(shipping)}>編輯</button>
                    <button className="btn-danger-sm" onClick={() => del(shipping.id)}>刪除</button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="intl-shipping-breakdown">
                    <table className="calc-table">
                      <thead><tr><th>批次</th><th>重量(g)</th><th>佔比</th><th>分攤金額(NT$)</th></tr></thead>
                      <tbody>
                        {allocation.length === 0 ? (
                          <tr><td colSpan={4} style={{color:"var(--text3)",textAlign:"center",padding:"12px"}}>尚未關聯任何批次</td></tr>
                        ) : allocation.map(({ batch, weight, share }) => {
                          const totalW = allocation.reduce((s, a) => s + a.weight, 0);
                          const ratio = totalW > 0 ? (weight / totalW * 100).toFixed(1) : 0;
                          return (
                            <tr key={batch?.id}>
                              <td>{batch?.name || "—"}</td>
                              <td className="center">{weight}g</td>
                              <td className="center">{ratio}%</td>
                              <td className="number twd-text">NT${Math.round(share).toLocaleString()}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? "編輯國際運費" : "新增國際運費"}</h2>
              <button className="modal-close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div className="form-grid">
              <label className="form-label" style={{gridColumn:"1/-1"}}>名稱 *
                <input className="form-input" placeholder="例：Tenso 2024.06 批次" value={form.name} onChange={e => set("name", e.target.value)} />
              </label>
              <label className="form-label">台幣金額 * (NT$)
                <input className="form-input" type="number" placeholder="實際刷卡台幣" value={form.amount_twd} onChange={e => set("amount_twd", e.target.value)} />
              </label>
              <label className="form-label">日幣金額（選填 ¥）
                <input className="form-input" type="number" placeholder="原始日幣帳單" value={form.amount_jpy} onChange={e => set("amount_jpy", e.target.value)} />
              </label>
              <label className="form-label">日期
                <input className="form-input" type="date" value={form.date} onChange={e => set("date", e.target.value)} />
              </label>
              <label className="form-label">備註
                <input className="form-input" placeholder="備註" value={form.note} onChange={e => set("note", e.target.value)} />
              </label>
            </div>

            {/* Batch selection */}
            <div className="cc-add-section" style={{marginTop:"12px"}}>
              <h3 style={{fontSize:"13px",color:"var(--text2)",marginBottom:"10px"}}>關聯批次（按重量分攤）</h3>
              <div className="batch-checkbox-list">
                {batches.filter(b => !b.archived).map(b => (
                  <label key={b.id} className="batch-checkbox-item">
                    <input type="checkbox" checked={form.selectedBatches.includes(b.id)} onChange={() => toggleBatch(b.id)} />
                    <span>{b.name}</span>
                    <span style={{color:"var(--text3)",fontSize:"12px",marginLeft:"auto"}}>{batchWeights[b.id] || 0}g</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowForm(false)}>取消</button>
              <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "儲存中..." : "儲存"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
