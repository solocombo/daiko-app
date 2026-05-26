import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";

export default function Credits() {
  const [credits, setCredits] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchCredits(); }, []);

  async function fetchCredits() {
    setLoading(true);
    const { data } = await supabase
      .from("customer_credits")
      .select("*")
      .order("balance", { ascending: false });
    setCredits(data || []);
    setLoading(false);
  }

  async function adjustCredit(id, currentBalance) {
    const input = prompt("手動調整儲值金額（輸入正數加值、負數扣值）：");
    if (input === null || input === "") return;
    const adj = parseFloat(input);
    if (isNaN(adj)) return alert("請輸入有效數字");
    const newBalance = currentBalance + adj;
    await supabase.from("customer_credits").update({ balance: newBalance }).eq("id", id);
    fetchCredits();
  }

  async function deleteCredit(id) {
    if (!confirm("確定刪除這筆儲值記錄？")) return;
    await supabase.from("customer_credits").delete().eq("id", id);
    fetchCredits();
  }

  const totalBalance = credits.reduce((s, c) => s + Number(c.balance), 0);
  const activeCount = credits.filter(c => Number(c.balance) > 0).length;

  if (loading) return <div className="loading"><div className="loading-spinner" /><p>載入中...</p></div>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">儲值清單</h1>
          <p className="page-sub">記錄多繳金額，下次訂單可抵扣</p>
        </div>
      </div>

      <div className="credits-summary">
        <div className="credit-summary-card">
          <div className="credit-summary-label">有儲值的客人</div>
          <div className="credit-summary-value twd">{activeCount} 人</div>
        </div>
        <div className="credit-summary-card">
          <div className="credit-summary-label">儲值總額</div>
          <div className="credit-summary-value net-big">NT${Math.round(totalBalance).toLocaleString()}</div>
        </div>
      </div>

      {credits.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">💳</div>
          <p>還沒有儲值記錄</p>
          <p className="empty-sub">當收款金額超過應付金額時，差額會自動記入這裡</p>
        </div>
      ) : (
        <div className="credits-table-wrap">
          <table className="credits-table">
            <thead>
              <tr>
                <th>客人名稱</th>
                <th className="number">儲值餘額</th>
                <th>最後更新</th>
                <th className="center">操作</th>
              </tr>
            </thead>
            <tbody>
              {credits.map(c => (
                <tr key={c.id}>
                  <td><strong>{c.customer}</strong></td>
                  <td className={`number ${Number(c.balance) > 0 ? "credit-positive" : "credit-zero"}`}>
                    NT${Math.round(Number(c.balance)).toLocaleString()}
                  </td>
                  <td style={{fontSize:"12px", color:"var(--text3)"}}>{c.updated_at?.split("T")[0] || "—"}</td>
                  <td className="center">
                    <button className="btn-edit-sm" onClick={() => adjustCredit(c.id, Number(c.balance))}>調整</button>
                    <button className="btn-danger-sm" onClick={() => deleteCredit(c.id)}>刪除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
