import { useState } from "react";
import { supabase } from "../supabaseClient";

const CATEGORIES = ["動漫", "衣物", "其他"];

export default function Shops({ shops, onRefresh }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: "", url: "", category: "動漫", note: "" });
  const [saving, setSaving] = useState(false);
  const [filterCat, setFilterCat] = useState("all");

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function openNew() {
    setEditingId(null);
    setForm({ name: "", url: "", category: "動漫", note: "" });
    setShowForm(true);
  }

  function openEdit(shop) {
    setEditingId(shop.id);
    setForm({ name: shop.name, url: shop.url || "", category: shop.category || "動漫", note: shop.note || "" });
    setShowForm(true);
  }

  async function save() {
    if (!form.name) return alert("請填寫網站名稱");
    setSaving(true);
    if (editingId) {
      await supabase.from("shops").update({ name: form.name, url: form.url, category: form.category, note: form.note }).eq("id", editingId);
    } else {
      await supabase.from("shops").insert([{ name: form.name, url: form.url, category: form.category, note: form.note }]);
    }
    setSaving(false);
    setShowForm(false);
    onRefresh();
  }

  async function del(id) {
    if (!confirm("確定刪除這個購物網站？")) return;
    await supabase.from("shops").delete().eq("id", id);
    onRefresh();
  }

  const catColors = { "動漫": "var(--accent2)", "衣物": "var(--accent)", "其他": "var(--text3)" };

  const filtered = filterCat === "all" ? shops : shops.filter(s => s.category === filterCat);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">購物網站管理</h1>
          <p className="page-sub">管理常用購物網站，新增訂單商品時可直接選擇</p>
        </div>
        <button className="btn-primary" onClick={openNew}>＋ 新增網站</button>
      </div>

      <div className="filter-bar">
        <div className="filter-tabs">
          <button className={`filter-tab ${filterCat === "all" ? "active" : ""}`} onClick={() => setFilterCat("all")}>全部</button>
          {CATEGORIES.map(c => (
            <button key={c} className={`filter-tab ${filterCat === c ? "active" : ""}`} onClick={() => setFilterCat(c)}>{c}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🛍️</div>
          <p>還沒有{filterCat === "all" ? "" : filterCat}類網站</p>
          <p className="empty-sub">點擊「新增網站」開始建立</p>
        </div>
      ) : (
        <div className="forwarder-grid">
          {filtered.map(shop => (
            <div key={shop.id} className="forwarder-card">
              <div className="forwarder-header">
                <div style={{display:"flex", alignItems:"center", gap:"8px"}}>
                  <div className="forwarder-name">🛍️ {shop.name}</div>
                  <span className="shop-category-tag" style={{color: catColors[shop.category] || "var(--text3)"}}>{shop.category}</span>
                </div>
                <div className="forwarder-actions">
                  <button className="btn-edit-sm" onClick={() => openEdit(shop)}>編輯</button>
                  <button className="btn-danger-sm" onClick={() => del(shop.id)}>刪除</button>
                </div>
              </div>
              {shop.url && (
                <a className="forwarder-url" href={shop.url} target="_blank" rel="noreferrer">🔗 {shop.url}</a>
              )}
              {shop.note && <div className="forwarder-note">{shop.note}</div>}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? "編輯購物網站" : "新增購物網站"}</h2>
              <button className="modal-close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div className="form-grid" style={{gridTemplateColumns:"1fr"}}>
              <label className="form-label">網站名稱 *
                <input className="form-input" placeholder="例：Animate、Mercari" value={form.name} onChange={e => set("name", e.target.value)} />
              </label>
              <label className="form-label">分類
                <select className="form-input" value={form.category} onChange={e => set("category", e.target.value)}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label className="form-label">網址
                <input className="form-input" placeholder="https://..." value={form.url} onChange={e => set("url", e.target.value)} />
              </label>
              <label className="form-label">備註
                <textarea className="form-input forwarder-textarea" placeholder="費率說明、帳號提示、注意事項等..." value={form.note} onChange={e => set("note", e.target.value)} rows={4} />
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
