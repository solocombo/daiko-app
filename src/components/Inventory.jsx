import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";

const STATUS_OPTIONS = ["庫存中", "已售完", "部分售出"];

export default function Inventory({ shops }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [form, setForm] = useState({
    name: "", jpy_cost: "", twd_cost: "", quantity: 1,
    sold: 0, sell_price: "", shipping_cost: "", shop_id: "", note: "", status: "庫存中",
  });
  const [saving, setSaving] = useState(false);
  const [showSellModal, setShowSellModal] = useState(false);
  const [sellingItem, setSellingItem] = useState(null);
  const [sellQty, setSellQty] = useState(1);

  useEffect(() => { fetchItems(); }, []);

  async function fetchItems() {
    setLoading(true);
    const { data } = await supabase.from("inventory").select("*").order("created_at", { ascending: false });
    setItems(data || []);
    setLoading(false);
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function openNew() {
    setEditingId(null);
    setForm({ name: "", jpy_cost: "", twd_cost: "", quantity: 1, sold: 0, sell_price: "", shop_id: "", note: "", status: "庫存中" });
    setShowForm(true);
  }

  function openEdit(item) {
    setEditingId(item.id);
    setForm({
      name: item.name, jpy_cost: item.jpy_cost || "", twd_cost: item.twd_cost || "",
      quantity: item.quantity || 1, sold: item.sold || 0,
      sell_price: item.sell_price || "", shipping_cost: item.shipping_cost || "",
      shop_id: item.shop_id || "", note: item.note || "", status: item.status || "庫存中",
    });
    setShowForm(true);
  }

  async function save() {
    if (!form.name) return alert("請填寫商品名稱");
    if (!form.twd_cost) return alert("請填寫台幣成本");
    setSaving(true);
    const payload = {
      name: form.name, jpy_cost: form.jpy_cost ? parseFloat(form.jpy_cost) : null,
      twd_cost: parseFloat(form.twd_cost), quantity: parseInt(form.quantity) || 1,
      sold: parseInt(form.sold) || 0, sell_price: form.sell_price ? parseFloat(form.sell_price) : null,
      shipping_cost: form.shipping_cost ? parseFloat(form.shipping_cost) : null,
      shop_id: form.shop_id || null, note: form.note, status: form.status,
    };
    if (editingId) {
      await supabase.from("inventory").update(payload).eq("id", editingId);
    } else {
      await supabase.from("inventory").insert([payload]);
    }
    setSaving(false);
    setShowForm(false);
    fetchItems();
  }

  async function del(id) {
    if (!confirm("確定刪除這筆庫存記錄？")) return;
    await supabase.from("inventory").delete().eq("id", id);
    fetchItems();
  }

  function openSell(item) {
    setSellingItem(item);
    setSellQty(1);
    setShowSellModal(true);
  }

  async function recordSale() {
    const qty = parseInt(sellQty);
    if (!qty || qty <= 0) return alert("請填寫售出數量");
    const remaining = sellingItem.quantity - sellingItem.sold;
    if (qty > remaining) return alert(`庫存不足，目前剩餘 ${remaining} 件`);
    const newSold = (sellingItem.sold || 0) + qty;
    const newStatus = newSold >= sellingItem.quantity ? "已售完" : "部分售出";
    await supabase.from("inventory").update({ sold: newSold, status: newStatus }).eq("id", sellingItem.id);
    setShowSellModal(false);
    fetchItems();
  }

  const filtered = filterStatus === "all" ? items : items.filter(i => i.status === filterStatus);
  const totalStock = items.filter(i => i.status !== "已售完").reduce((s, i) => s + (i.quantity - (i.sold || 0)), 0);
  const totalValue = items.filter(i => i.status !== "已售完").reduce((s, i) => s + (i.twd_cost || 0) * (i.quantity - (i.sold || 0)), 0);

  const getShopName = (id) => shops?.find(s => s.id === id)?.name || "—";

  if (loading) return <div className="loading"><div className="loading-spinner" /><p>載入中...</p></div>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">庫存管理</h1>
          <p className="page-sub">記錄自購現貨商品的庫存狀態</p>
        </div>
        <button className="btn-primary" onClick={openNew}>＋ 新增庫存</button>
      </div>

      {/* Summary */}
      {(() => {
        const totalRealized = items.reduce((s, i) => {
          if (!i.sell_price || !i.sold) return s;
          return s + (Number(i.sell_price) - Number(i.twd_cost) - Number(i.shipping_cost||0)) * i.sold;
        }, 0);
        const totalUnrealized = items.filter(i => i.sell_price && i.status !== "已售完").reduce((s, i) => {
          const rem = i.quantity - (i.sold || 0);
          return s + (Number(i.sell_price) - Number(i.twd_cost) - Number(i.shipping_cost||0)) * rem;
        }, 0);
        return (
          <div className="credits-summary">
            <div className="credit-summary-card">
              <div className="credit-summary-label">現有庫存件數</div>
              <div className="credit-summary-value twd">{totalStock} 件</div>
            </div>
            <div className="credit-summary-card">
              <div className="credit-summary-label">庫存總成本</div>
              <div className="credit-summary-value neg">NT${Math.round(totalValue).toLocaleString()}</div>
            </div>
            <div className="credit-summary-card">
              <div className="credit-summary-label">已實現利潤</div>
              <div className={`credit-summary-value ${totalRealized >= 0 ? "net-big" : "neg"}`}>NT${Math.round(totalRealized).toLocaleString()}</div>
            </div>
            <div className="credit-summary-card">
              <div className="credit-summary-label">未實現利潤（預估）</div>
              <div className="credit-summary-value" style={{color:"var(--text3)"}}>NT${Math.round(totalUnrealized).toLocaleString()}</div>
            </div>
          </div>
        );
      })()}

      {/* Filter */}
      <div className="filter-bar">
        <div className="filter-tabs">
          <button className={`filter-tab ${filterStatus === "all" ? "active" : ""}`} onClick={() => setFilterStatus("all")}>全部</button>
          {STATUS_OPTIONS.map(s => (
            <button key={s} className={`filter-tab ${filterStatus === s ? "active" : ""}`} onClick={() => setFilterStatus(s)}>{s}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📦</div>
          <p>沒有{filterStatus === "all" ? "" : filterStatus}的庫存</p>
        </div>
      ) : (
        <div className="inventory-grid">
          {filtered.map(item => {
            const remaining = item.quantity - (item.sold || 0);
            const shippingCostPer = Number(item.shipping_cost || 0);
            const profitPerUnit = item.sell_price ? Number(item.sell_price) - Number(item.twd_cost) - shippingCostPer : null;
            const profit = profitPerUnit !== null ? profitPerUnit * (item.sold || 0) : null;
            const unrealizedProfit = profitPerUnit !== null ? profitPerUnit * (item.quantity - (item.sold || 0)) : null;
            return (
              <div key={item.id} className={`inventory-card ${item.status === "已售完" ? "inv-sold-out" : ""}`}>
                <div className="inventory-card-header">
                  <div>
                    <div className="inventory-name">{item.name}</div>
                    <div className="inventory-shop">{getShopName(item.shop_id)}</div>
                  </div>
                  <span className={`inv-status-badge inv-${item.status === "庫存中" ? "in" : item.status === "已售完" ? "out" : "partial"}`}>
                    {item.status}
                  </span>
                </div>

                <div className="inventory-stats">
                  <div className="inv-stat"><span className="inv-stat-label">購買數量</span><span className="inv-stat-value">{item.quantity}</span></div>
                  <div className="inv-stat"><span className="inv-stat-label">已售出</span><span className="inv-stat-value">{item.sold || 0}</span></div>
                  <div className="inv-stat"><span className="inv-stat-label">剩餘</span><span className={`inv-stat-value ${remaining === 0 ? "neg-text" : "net-text"}`}>{remaining}</span></div>
                </div>

                <div className="inventory-costs">
                  <div className="inv-cost-row">
                    <span className="inv-cost-label">購買成本</span>
                    <span>
                      {item.jpy_cost ? <span className="inv-jpy">¥{Number(item.jpy_cost).toLocaleString()} → </span> : ""}
                      <span className="neg-text">NT${Number(item.twd_cost).toLocaleString()}</span>
                      <span className="inv-per"> / 件</span>
                    </span>
                  </div>
                  {item.sell_price && (
                    <div className="inv-cost-row">
                      <span className="inv-cost-label">售價</span>
                      <span className="twd-text">NT${Number(item.sell_price).toLocaleString()} / 件</span>
                    </div>
                  )}
                  {item.shipping_cost > 0 && (
                    <div className="inv-cost-row">
                      <span className="inv-cost-label">分攤運費</span>
                      <span className="neg-text">-NT${Number(item.shipping_cost).toLocaleString()} / 件</span>
                    </div>
                  )}
                  {profitPerUnit !== null && (
                    <div className="inv-cost-row">
                      <span className="inv-cost-label">每件淨利</span>
                      <span className={profitPerUnit >= 0 ? "net-text" : "neg-text"}>NT${Math.round(profitPerUnit).toLocaleString()}</span>
                    </div>
                  )}
                  {profit !== null && item.sold > 0 && (
                    <div className="inv-cost-row" style={{borderTop:"1px solid var(--border)", paddingTop:"4px", marginTop:"2px"}}>
                      <span className="inv-cost-label">已實現利潤</span>
                      <span className={profit >= 0 ? "net-text" : "neg-text"}>NT${Math.round(profit).toLocaleString()}</span>
                    </div>
                  )}
                  {unrealizedProfit !== null && (item.quantity - (item.sold||0)) > 0 && (
                    <div className="inv-cost-row">
                      <span className="inv-cost-label">未實現利潤</span>
                      <span style={{color:"var(--text3)"}}>NT${Math.round(unrealizedProfit).toLocaleString()}</span>
                    </div>
                  )}
                </div>

                {item.note && <div className="inventory-note">📝 {item.note}</div>}

                <div className="inventory-actions">
                  {remaining > 0 && (
                    <button className="btn-sell" onClick={() => openSell(item)}>📤 標記售出</button>
                  )}
                  <button className="btn-edit-sm" onClick={() => openEdit(item)}>編輯</button>
                  <button className="btn-danger-sm" onClick={() => del(item.id)}>刪除</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sell Modal */}
      {showSellModal && sellingItem && (
        <div className="modal-overlay" onClick={() => setShowSellModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>📤 標記售出</h2>
              <button className="modal-close" onClick={() => setShowSellModal(false)}>✕</button>
            </div>
            <div className="sell-modal-info">
              <div className="sell-item-name">{sellingItem.name}</div>
              <div className="sell-remaining">剩餘庫存：<strong>{sellingItem.quantity - (sellingItem.sold || 0)}</strong> 件</div>
            </div>
            <div className="form-grid" style={{gridTemplateColumns:"1fr"}}>
              <label className="form-label">售出數量
                <input className="form-input" type="number" min="1" max={sellingItem.quantity - (sellingItem.sold || 0)} value={sellQty} onChange={e => setSellQty(e.target.value)} />
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowSellModal(false)}>取消</button>
              <button className="btn-primary" onClick={recordSale}>確認售出</button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Form Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? "編輯庫存" : "新增庫存"}</h2>
              <button className="modal-close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div className="form-grid">
              <label className="form-label" style={{gridColumn:"1/-1"}}>商品名稱 *
                <input className="form-input" placeholder="例：初音 figma 39" value={form.name} onChange={e => set("name", e.target.value)} />
              </label>
              <label className="form-label">購買成本（日幣 ¥）
                <input className="form-input" type="number" placeholder="選填" value={form.jpy_cost} onChange={e => set("jpy_cost", e.target.value)} />
              </label>
              <label className="form-label">購買成本（台幣 NT$）*
                <input className="form-input" type="number" placeholder="每件成本" value={form.twd_cost} onChange={e => set("twd_cost", e.target.value)} />
              </label>
              <label className="form-label">購買數量
                <input className="form-input" type="number" min="1" value={form.quantity} onChange={e => set("quantity", e.target.value)} />
              </label>
              <label className="form-label">售價（NT$）
                <input className="form-input" type="number" placeholder="對客人收的價格" value={form.sell_price} onChange={e => set("sell_price", e.target.value)} />
              </label>
              <label className="form-label">分攤運費（NT$）
                <input className="form-input" type="number" placeholder="每件分攤的運費成本" value={form.shipping_cost} onChange={e => set("shipping_cost", e.target.value)} />
              </label>
              <label className="form-label">購買網站
                <select className="form-input" value={form.shop_id} onChange={e => set("shop_id", e.target.value)}>
                  <option value="">未指定</option>
                  {(shops || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="form-label">狀態
                <select className="form-input" value={form.status} onChange={e => set("status", e.target.value)}>
                  {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="form-label" style={{gridColumn:"1/-1"}}>備註
                <textarea className="form-input forwarder-textarea" rows={3} placeholder="商品說明、特殊備註等" value={form.note} onChange={e => set("note", e.target.value)} />
              </label>
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
