import { useState } from "react";
import { supabase } from "../supabaseClient";

export default function BatchList({ batches, orders, onRefresh, onSelectBatch }) {
  const [showForm, setShowForm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState({
    name: "", date: "", jpy_rate: 0.21, total_intl_shipping_jpy: 0, absorbed_shipping_twd: 0, note: "",
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const activeBatches = batches.filter(b => !b.archived);
  const archivedBatches = batches.filter(b => b.archived);
  const displayBatches = showArchived ? archivedBatches : activeBatches;

  async function saveBatch() {
    if (!form.name || !form.date) return alert("請填寫批次名稱與日期");
    setSaving(true);
    const { error } = await supabase.from("batches").insert([{
      name: form.name, date: form.date,
      jpy_rate: parseFloat(form.jpy_rate),
      total_intl_shipping_jpy: parseFloat(form.total_intl_shipping_jpy) || 0,
      absorbed_shipping_twd: parseFloat(form.absorbed_shipping_twd) || 0,
      note: form.note, archived: false,
    }]);
    setSaving(false);
    if (error) return alert("儲存失敗：" + error.message);
    setShowForm(false);
    setForm({ name: "", date: "", jpy_rate: 0.21, total_intl_shipping_jpy: 0, absorbed_shipping_twd: 0, note: "" });
    onRefresh();
  }

  async function archiveBatch(id, currentState) {
    const action = currentState ? "解除封存" : "封存";
    if (!confirm(`確定${action}這個批次？`)) return;
    await supabase.from("batches").update({ archived: !currentState }).eq("id", id);
    onRefresh();
  }

  async function deleteBatch(id) {
    if (!confirm("⚠️ 確定永久刪除這個批次？所有訂單資料將無法復原。")) return;
    if (!confirm("再次確認：真的要永久刪除嗎？")) return;
    const batchOrderIds = orders.filter(o => o.batch_id === id).map(o => o.id);
    if (batchOrderIds.length > 0) {
      await supabase.from("order_items").delete().in("order_id", batchOrderIds);
      await supabase.from("orders").delete().eq("batch_id", id);
    }
    await supabase.from("batches").delete().eq("id", id);
    onRefresh();
  }

  function batchStats(batchId) {
    const batchOrders = orders.filter((o) => o.batch_id === batchId);
    const totalOrders = batchOrders.length;
    const unpaidProduct = batchOrders.filter((o) => o.product_paid === false).length;
    const unpaidShipping = batchOrders.filter((o) => o.shipping_paid === false && o.shipping_twd > 0).length;
    return { totalOrders, unpaidProduct, unpaidShipping };
  }

  const statusColor = (batch) => {
    const { totalOrders, unpaidProduct, unpaidShipping } = batchStats(batch.id);
    if (totalOrders === 0) return "status-neutral";
    if (unpaidProduct === 0 && unpaidShipping === 0) return "status-done";
    if (unpaidProduct > 0) return "status-pending";
    return "status-partial";
  };

  const statusLabel = (batch) => {
    const { totalOrders, unpaidProduct, unpaidShipping } = batchStats(batch.id);
    if (totalOrders === 0) return "無訂單";
    if (unpaidProduct === 0 && unpaidShipping === 0) return "✓ 全部收款";
    if (unpaidProduct > 0) return `${unpaidProduct} 筆未付商品款`;
    return `${unpaidShipping} 筆運費尾款`;
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">批次管理</h1>
          <p className="page-sub">每次日本採購為一個批次</p>
        </div>
        <div className="header-actions">
          <button className="btn-secondary" onClick={() => setShowArchived(v => !v)}>
            {showArchived ? "📦 顯示進行中" : `🗄 封存批次${archivedBatches.length > 0 ? ` (${archivedBatches.length})` : ""}`}
          </button>
          {!showArchived && <button className="btn-primary" onClick={() => setShowForm(true)}>＋ 新增批次</button>}
        </div>
      </div>

      {/* 封存說明列 */}
      {showArchived && (
        <div className="archive-notice">
          🗄 封存的批次資料完整保留，隨時可以查看或解除封存。確認不需要時才永久刪除。
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>新增採購批次</h2>
              <button className="modal-close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div className="form-grid">
              <label className="form-label">批次名稱
                <input className="form-input" placeholder="例：2024.06 WF戰利品" value={form.name} onChange={(e) => set("name", e.target.value)} />
              </label>
              <label className="form-label">採購日期
                <input className="form-input" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
              </label>
              <label className="form-label">當時匯率（JPY→TWD）
                <input className="form-input" type="number" step="0.001" value={form.jpy_rate} onChange={(e) => set("jpy_rate", e.target.value)} />
              </label>
              <label className="form-label">國際運費總額（日幣 ¥）
                <input className="form-input" type="number" value={form.total_intl_shipping_jpy} onChange={(e) => set("total_intl_shipping_jpy", e.target.value)} />
              </label>
              <label className="form-label">本次吸收運費（台幣 NT$）
                <input className="form-input" type="number" value={form.absorbed_shipping_twd} onChange={(e) => set("absorbed_shipping_twd", e.target.value)} />
              </label>
              <label className="form-label" style={{ gridColumn: "1 / -1" }}>備註
                <input className="form-input" placeholder="活動名稱、特殊說明等" value={form.note} onChange={(e) => set("note", e.target.value)} />
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowForm(false)}>取消</button>
              <button className="btn-primary" onClick={saveBatch} disabled={saving}>{saving ? "儲存中..." : "建立批次"}</button>
            </div>
          </div>
        </div>
      )}

      {displayBatches.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">{showArchived ? "🗄" : "📦"}</div>
          <p>{showArchived ? "沒有封存的批次" : "還沒有任何批次"}</p>
          {!showArchived && <p className="empty-sub">點擊「新增批次」開始記錄</p>}
        </div>
      ) : (
        <div className="batch-grid">
          {displayBatches.map((batch) => {
            const { totalOrders } = batchStats(batch.id);
            return (
              <div key={batch.id} className={`batch-card ${batch.archived ? "batch-archived" : ""}`}
                onClick={() => !showArchived && onSelectBatch(batch)}>
                <div className="batch-card-header">
                  <div>
                    <div className="batch-name">
                      {batch.archived && <span className="archive-tag">封存</span>}
                      {batch.name}
                    </div>
                    <div className="batch-date">{batch.date}</div>
                  </div>
                  <span className={`status-badge ${statusColor(batch)}`}>{statusLabel(batch)}</span>
                </div>
                <div className="batch-stats">
                  <div className="stat-item">
                    <span className="stat-label">訂單數</span>
                    <span className="stat-value">{totalOrders}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">匯率</span>
                    <span className="stat-value">{batch.jpy_rate}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">國際運費</span>
                    <span className="stat-value">¥{Number(batch.total_intl_shipping_jpy).toLocaleString()}</span>
                  </div>
                </div>
                {batch.note && <div className="batch-note">📝 {batch.note}</div>}
                <div className="batch-card-footer">
                  {!batch.archived
                    ? <span className="view-detail">點擊查看詳細 →</span>
                    : <span className="view-detail" style={{color:"var(--text3)"}}>已封存</span>
                  }
                  <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="btn-archive-sm" onClick={() => archiveBatch(batch.id, batch.archived)}>
                      {batch.archived ? "解除封存" : "封存"}
                    </button>
                    {batch.archived && (
                      <button className="btn-danger-sm" onClick={() => deleteBatch(batch.id)}>永久刪除</button>
                    )}
                    {!batch.archived && (
                      <button className="btn-danger-sm" onClick={() => deleteBatch(batch.id)}>刪除</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
