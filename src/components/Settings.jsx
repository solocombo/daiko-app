import { useState } from "react";

export default function Settings({ settings, onSave }) {
  const [form, setForm] = useState({
    proxy_rate: settings.proxy_rate,
    member1: settings.member1 || "成員A",
    member2: settings.member2 || "成員B",
  });
  const [saved, setSaved] = useState(false);

  function save() {
    onSave({
      ...settings,
      proxy_rate: parseFloat(form.proxy_rate),
      member1: form.member1,
      member2: form.member2,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">系統設定</h1>
          <p className="page-sub">全域參數設定，兩人各自在自己的裝置設定一次即可</p>
        </div>
      </div>

      <div className="settings-card">
        <h2 className="settings-section-title">💱 匯率設定</h2>
        <div className="settings-grid">
          <div className="settings-item">
            <label className="form-label">代購匯率（報給客人的匯率）
              <input className="form-input" type="number" step="0.001" value={form.proxy_rate}
                onChange={e => setForm(f => ({ ...f, proxy_rate: e.target.value }))} />
            </label>
            <p className="settings-hint">客人付款金額 = 日幣價格 × 代購匯率。目前：{form.proxy_rate}</p>
          </div>
        </div>

        <div className="settings-divider" />

        <h2 className="settings-section-title">👥 成員名稱</h2>
        <p className="settings-hint" style={{marginBottom:"14px"}}>用於提款記錄的「給誰」下拉選單</p>
        <div className="settings-grid">
          <label className="form-label">成員 1
            <input className="form-input" placeholder="例：小花" value={form.member1}
              onChange={e => setForm(f => ({ ...f, member1: e.target.value }))} />
          </label>
          <label className="form-label">成員 2
            <input className="form-input" placeholder="例：小明" value={form.member2}
              onChange={e => setForm(f => ({ ...f, member2: e.target.value }))} />
          </label>
        </div>

        <div className="settings-divider" />

        <div className="settings-formula">
          <h3>📐 目前計算公式預覽</h3>
          <div className="formula-list">
            <div className="formula-row"><span className="formula-label">客人定價</span><span className="formula-eq">= 日幣單價 × {form.proxy_rate} → 無條件進位到10元</span></div>
            <div className="formula-row"><span className="formula-label">實際成本</span><span className="formula-eq">= 日幣總價 × 當批匯率 × (1 + 1.5% 手續費 − 1% 回饋)</span></div>
            <div className="formula-row highlight-formula"><span className="formula-label">利潤</span><span className="formula-eq">= 定價總收入 − 實際成本 − 吸收運費</span></div>
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-primary" onClick={save}>{saved ? "✓ 已儲存" : "儲存設定"}</button>
          <p className="settings-hint">設定儲存在此裝置的瀏覽器</p>
        </div>
      </div>
    </div>
  );
}
