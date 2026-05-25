import { useState } from "react";
import { supabase } from "../supabaseClient";

export default function Forwarders({ forwarders, onRefresh }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: "", url: "", note: "" });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function openNew() {
    setEditingId(null);
    setForm({ name: "", url: "", note: "" });
    setShowForm(true);
  }

  function openEdit(fw) {
    setEditingId(fw.id);
    setForm({ name: fw.name, url: fw.url || "", note: fw.note || "" });
    setShowForm(true);
  }

  async function save() {
    if (!form.name) return alert("請填寫集運商名稱");
    setSaving(true);
    if (editingId) {
      await supabase.from("forwarders").update({ name: form.name, url: form.url, note: form.note }).eq("id", editingId);
    } else {
      await supabase.from("forwarders").insert([{ name: form.name, url: form.url, note: form.note }]);
    }
    setSaving(false);
    setShowForm(false);
    onRefresh();
  }

  async function del(id) {
    if (!confirm("確定刪除這個集運商？")) return;
    await supabase.from("forwarders").delete().eq("id", id);
    onRefresh();
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">集運商管理</h1>
          <p className="page-sub">管理常用集運商資訊，新增訂單時可直接選擇</p>
        </div>
        <button className="btn-primary" onClick={openNew}>＋ 新增集運商</button>
      </div>

      {forwarders.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🚚</div>
          <p>還沒有集運商資料</p>
          <p className="empty-sub">點擊「新增集運商」開始建立</p>
        </div>
      ) : (
        <div className="forwarder-grid">
          {forwarders.map(fw => (
            <div key={fw.id} className="forwarder-card">
              <div className="forwarder-header">
                <div className="forwarder-name">🚚 {fw.name}</div>
                <div className="forwarder-actions">
                  <button className="btn-edit-sm" onClick={() => openEdit(fw)}>編輯</button>
                  <button className="btn-danger-sm" onClick={() => del(fw.id)}>刪除</button>
                </div>
              </div>
              {fw.url && (
                <a className="forwarder-url" href={fw.url} target="_blank" rel="noreferrer">
                  🔗 {fw.url}
                </a>
              )}
              {fw.note && <div className="forwarder-note">{fw.note}</div>}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? "編輯集運商" : "新增集運商"}</h2>
              <button className="modal-close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
              <label className="form-label">集運商名稱 *
                <input className="form-input" placeholder="例：萬里通、聯盟物流" value={form.name} onChange={e => set("name", e.target.value)} />
              </label>
              <label className="form-label">官網網址
                <input className="form-input" placeholder="https://..." value={form.url} onChange={e => set("url", e.target.value)} />
              </label>
              <label className="form-label">備註
                <textarea
                  className="form-input forwarder-textarea"
                  placeholder="費率說明、使用注意事項、帳號密碼提示等..."
                  value={form.note}
                  onChange={e => set("note", e.target.value)}
                  rows={5}
                />
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
