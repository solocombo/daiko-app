import { useMemo, useState, useEffect } from "react";
import { supabase } from "../supabaseClient";

function downloadCSV(filename, rows) {
  const BOM = "\uFEFF";
  const csv = BOM + rows.map(r => r.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function ceilTo10(n) { return Math.ceil(n / 10) * 10; }
function calcItem(item, jpyRate, proxyRate) {
  const qty = Number(item.quantity || 1);
  const jpyUnit = Number(item.jpy_price || 0);
  const jpyTotal = jpyUnit * qty;
  const costTwd = jpyTotal * jpyRate;
  const ccFee = costTwd * 0.015;
  const ccRebate = costTwd * 0.01;
  const realCost = costTwd + ccFee - ccRebate;
  const unitPrice = ceilTo10(jpyUnit * proxyRate);
  const totalPrice = unitPrice * qty;
  const profit = totalPrice - realCost;
  return { realCost, totalPrice, profit };
}

export default function ProfitDashboard({ batches, orders, settings }) {
  const proxyRate = settings?.proxy_rate || 0.25;
  const [monthFilter, setMonthFilter] = useState("all");
  const [dividends, setDividends] = useState([]);
  const [showDividendForm, setShowDividendForm] = useState(false);
  const [dividendForm, setDividendForm] = useState({ amount: "", note: "", date: new Date().toISOString().split("T")[0] });
  const [savingDividend, setSavingDividend] = useState(false);

  useEffect(() => { fetchDividends(); }, []);

  async function fetchDividends() {
    const { data } = await supabase.from("dividends").select("*").order("date", { ascending: false });
    setDividends(data || []);
  }

  async function saveDividend() {
    if (!dividendForm.amount) return alert("請填寫分紅金額");
    setSavingDividend(true);
    await supabase.from("dividends").insert([{ amount: parseFloat(dividendForm.amount), note: dividendForm.note, date: dividendForm.date }]);
    setSavingDividend(false);
    setShowDividendForm(false);
    setDividendForm({ amount: "", note: "", date: new Date().toISOString().split("T")[0] });
    fetchDividends();
  }

  async function deleteDividend(id) {
    if (!confirm("確定刪除這筆分紅記錄？")) return;
    await supabase.from("dividends").delete().eq("id", id);
    fetchDividends();
  }

  // Available months from batches
  const availableMonths = useMemo(() => {
    const months = new Set(batches.map(b => b.date?.slice(0, 7)).filter(Boolean));
    return ["all", ...Array.from(months).sort().reverse()];
  }, [batches]);

  // Filter batches by month
  const filteredBatches = useMemo(() => {
    if (monthFilter === "all") return batches;
    return batches.filter(b => b.date?.startsWith(monthFilter));
  }, [batches, monthFilter]);

  const batchProfits = useMemo(() => {
    return filteredBatches.map((batch) => {
      const batchOrders = orders.filter(o => o.batch_id === batch.id);
      let totalRealCost = 0, totalPrice = 0;
      batchOrders.forEach(o => {
        (o.order_items || []).filter(i => !i.not_obtained).forEach(i => {
          const c = calcItem(i, batch.jpy_rate, proxyRate);
          totalRealCost += c.realCost;
          totalPrice += c.totalPrice;
        });
      });
      const absorbed = Number(batch.absorbed_shipping_twd) || 0;
      const net = totalPrice - totalRealCost - absorbed;
      const totalOrders = batchOrders.length;
      const collectedAmt = batchOrders.filter(o => o.product_paid).reduce((s, o) => {
        return s + (o.order_items || []).filter(i => !i.not_obtained).reduce((ss, i) => ss + calcItem(i, batch.jpy_rate, proxyRate).totalPrice, 0);
      }, 0);
      const collectedShipping = batchOrders.filter(o => o.shipping_paid).reduce((s, o) => s + Number(o.shipping_twd || 0), 0);
      const totalReceivable = batchOrders.reduce((s, o) => {
        return s + (o.order_items || []).filter(i => !i.not_obtained).reduce((ss, i) => ss + calcItem(i, batch.jpy_rate, proxyRate).totalPrice, 0) + Number(o.shipping_twd || 0);
      }, 0);
      return { batch, totalRealCost, totalPrice, absorbed, net, totalOrders, collectedAmt, collectedShipping, totalReceivable };
    });
  }, [filteredBatches, orders, proxyRate]);

  const overall = useMemo(() => ({
    totalPrice: batchProfits.reduce((s, b) => s + b.totalPrice, 0),
    totalRealCost: batchProfits.reduce((s, b) => s + b.totalRealCost, 0),
    absorbed: batchProfits.reduce((s, b) => s + b.absorbed, 0),
    net: batchProfits.reduce((s, b) => s + b.net, 0),
  }), [batchProfits]);

  const totalDividends = dividends.reduce((s, d) => s + Number(d.amount), 0);
  const undistributed = overall.net - totalDividends;

  function exportAllCSV() {
    const rows = [["批次", "日期", "訂單數", "定價總收入", "實際成本", "吸收運費", "淨利", "收款進度%"]];
    batchProfits.forEach(({ batch, totalPrice, totalRealCost, absorbed, net, totalOrders, collectedAmt, collectedShipping, totalReceivable }) => {
      const ratio = totalReceivable > 0 ? Math.round((collectedAmt + collectedShipping) / totalReceivable * 100) : 0;
      rows.push([batch.name, batch.date, totalOrders, Math.round(totalPrice), Math.round(totalRealCost), Math.round(absorbed), Math.round(net), `${ratio}%`]);
    });
    rows.push([], ["累計淨利", Math.round(overall.net)], ["已分紅", Math.round(totalDividends)], ["未分配", Math.round(undistributed)]);
    downloadCSV(`DAIKO_利潤_${new Date().toISOString().split("T")[0]}.csv`, rows);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">利潤總覽</h1>
          <p className="page-sub">所有批次的收益統計</p>
        </div>
        <div className="header-actions">
          <button className="btn-export" onClick={exportAllCSV}>⬇ 匯出 CSV</button>
          <button className="btn-primary" onClick={() => setShowDividendForm(true)}>＋ 記錄分紅</button>
        </div>
      </div>

      {/* Month filter */}
      <div className="month-filter-bar">
        {availableMonths.map(m => (
          <button key={m} className={`filter-tab ${monthFilter === m ? "active" : ""}`} onClick={() => setMonthFilter(m)}>
            {m === "all" ? "全部" : m}
          </button>
        ))}
      </div>

      {/* Overall Summary */}
      <div className="overall-summary">
        <h2 className="section-title">📊 {monthFilter === "all" ? "累計總計" : monthFilter}</h2>
        <div className="summary-grid">
          <div className="summary-card">
            <div className="summary-label">定價總收入</div>
            <div className="summary-value twd">NT${Math.round(overall.totalPrice).toLocaleString()}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">實際總成本</div>
            <div className="summary-value neg">-NT${Math.round(overall.totalRealCost).toLocaleString()}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">吸收運費</div>
            <div className="summary-value neg">-NT${Math.round(overall.absorbed).toLocaleString()}</div>
          </div>
          <div className="summary-card highlight-card">
            <div className="summary-label">總淨利</div>
            <div className="summary-value net-big">NT${Math.round(overall.net).toLocaleString()}</div>
          </div>
          <div className="summary-card dividend-card">
            <div className="summary-label">已分紅</div>
            <div className="summary-value dividend-val">-NT${Math.round(totalDividends).toLocaleString()}</div>
          </div>
          <div className="summary-card undistributed-card">
            <div className="summary-label">未分配金額</div>
            <div className={`summary-value ${undistributed >= 0 ? "net-big" : "neg"}`}>NT${Math.round(undistributed).toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Dividend Records */}
      <div className="dividend-section">
        <h2 className="section-title">💰 分紅記錄</h2>
        {dividends.length === 0 ? (
          <p style={{color:"var(--text3)", fontSize:"13px"}}>還沒有分紅記錄</p>
        ) : (
          <div className="dividend-list">
            {dividends.map(d => (
              <div key={d.id} className="dividend-row">
                <span className="dividend-date">{d.date}</span>
                <span className="dividend-note">{d.note || "—"}</span>
                <span className="dividend-amount">NT${Number(d.amount).toLocaleString()}</span>
                <button className="btn-danger-sm" onClick={() => deleteDividend(d.id)}>刪除</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Per Batch */}
      <div className="batch-breakdown">
        <h2 className="section-title">📦 各批次明細</h2>
        {batchProfits.length === 0 ? (
          <div className="empty-state"><div className="empty-icon">📊</div><p>沒有符合條件的批次</p></div>
        ) : (
          <div className="profit-table-wrap">
            <table className="profit-table">
              <thead>
                <tr>
                  <th>批次名稱</th><th>日期</th><th>訂單數</th>
                  <th>定價收入</th><th>實際成本</th><th>吸收運費</th>
                  <th>淨利</th><th>收款進度</th>
                </tr>
              </thead>
              <tbody>
                {batchProfits.map(({ batch, totalPrice, totalRealCost, absorbed, net, totalOrders, collectedAmt, collectedShipping, totalReceivable }) => {
                  const collected = collectedAmt + collectedShipping;
                  const collectRatio = totalReceivable > 0 ? Math.round(collected / totalReceivable * 100) : 0;
                  return (
                    <tr key={batch.id}>
                      <td><div className="batch-name-cell">{batch.archived && <span className="archive-tag">封存</span>}{batch.name}</div></td>
                      <td className="center">{batch.date}</td>
                      <td className="center">{totalOrders}</td>
                      <td className="number twd">NT${Math.round(totalPrice).toLocaleString()}</td>
                      <td className="number neg">-NT${Math.round(totalRealCost).toLocaleString()}</td>
                      <td className="number neg">-NT${Math.round(absorbed).toLocaleString()}</td>
                      <td className="number net"><strong>NT${Math.round(net).toLocaleString()}</strong></td>
                      <td>
                        <div className="collect-bar-wrap">
                          <div className="collect-bar"><div className="collect-fill" style={{ width: `${collectRatio}%` }} /></div>
                          <span className="collect-pct">{collectRatio}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Formula */}
      <div className="formula-box">
        <h3>💡 計算公式說明</h3>
        <div className="formula-list">
          <div className="formula-row"><span className="formula-label">單件定價</span><span className="formula-eq">= 日幣單價 × {proxyRate}（代購匯率）→ 無條件進位到10元</span></div>
          <div className="formula-row"><span className="formula-label">實際成本</span><span className="formula-eq">= 日幣總價 × 當批匯率 × (1 + 1.5% 手續費 − 1% 回饋)</span></div>
          <div className="formula-row"><span className="formula-label">淨利</span><span className="formula-eq">= 定價總收入 − 實際成本 − 吸收運費</span></div>
          <div className="formula-row highlight-formula"><span className="formula-label">未分配</span><span className="formula-eq">= 總淨利 − 已分紅金額</span></div>
        </div>
      </div>

      {/* Dividend Form Modal */}
      {showDividendForm && (
        <div className="modal-overlay" onClick={() => setShowDividendForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>💰 記錄分紅</h2>
              <button className="modal-close" onClick={() => setShowDividendForm(false)}>✕</button>
            </div>
            <div className="form-grid">
              <label className="form-label">分紅日期
                <input className="form-input" type="date" value={dividendForm.date} onChange={e => setDividendForm(f => ({ ...f, date: e.target.value }))} />
              </label>
              <label className="form-label">金額（NT$）
                <input className="form-input" type="number" placeholder="例：5000" value={dividendForm.amount} onChange={e => setDividendForm(f => ({ ...f, amount: e.target.value }))} />
              </label>
              <label className="form-label" style={{ gridColumn: "1/-1" }}>備註
                <input className="form-input" placeholder="例：2024上半年分紅" value={dividendForm.note} onChange={e => setDividendForm(f => ({ ...f, note: e.target.value }))} />
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowDividendForm(false)}>取消</button>
              <button className="btn-primary" onClick={saveDividend} disabled={savingDividend}>{savingDividend ? "儲存中..." : "記錄分紅"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
