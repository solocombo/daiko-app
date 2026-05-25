import { useMemo } from "react";

// ── CSV export helper ────────────────────────────────────────────────────────
function downloadCSV(filename, rows) {
  const BOM = "\uFEFF";
  const csv = BOM + rows.map(r => r.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function ProfitDashboard({ batches, orders }) {
  const batchProfits = useMemo(() => {
    return batches.map((batch) => {
      const batchOrders = orders.filter(o => o.batch_id === batch.id);
      const totalJpy = batchOrders.reduce((s, o) =>
        s + (o.order_items || []).reduce((ss, i) => ss + Number(i.jpy_price || 0), 0), 0);
      const grossProfit = totalJpy * (0.25 - batch.jpy_rate);
      const ccFee = totalJpy * batch.jpy_rate * 0.015;
      const absorbed = Number(batch.absorbed_shipping_twd) || 0;
      const net = grossProfit - ccFee - absorbed;
      const totalOrders = batchOrders.length;
      const collectedProduct = batchOrders.filter(o => o.product_paid).reduce((s, o) =>
        s + (o.order_items || []).reduce((ss, i) => ss + Number(i.jpy_price || 0), 0) * 0.25, 0);
      const collectedShipping = batchOrders.filter(o => o.shipping_paid).reduce((s, o) => s + Number(o.shipping_twd || 0), 0);
      const totalReceivable = batchOrders.reduce((s, o) =>
        s + (o.order_items || []).reduce((ss, i) => ss + Number(i.jpy_price || 0), 0) * 0.25 + Number(o.shipping_twd || 0), 0);
      return { batch, batchOrders, totalJpy, grossProfit, ccFee, absorbed, net, each: net / 2, totalOrders, collectedProduct, collectedShipping, totalReceivable };
    });
  }, [batches, orders]);

  const overall = useMemo(() => ({
    totalJpy: batchProfits.reduce((s, b) => s + b.totalJpy, 0),
    grossProfit: batchProfits.reduce((s, b) => s + b.grossProfit, 0),
    ccFee: batchProfits.reduce((s, b) => s + b.ccFee, 0),
    absorbed: batchProfits.reduce((s, b) => s + b.absorbed, 0),
    net: batchProfits.reduce((s, b) => s + b.net, 0),
    each: batchProfits.reduce((s, b) => s + b.each, 0),
  }), [batchProfits]);

  // ── Export ALL data CSV ──────────────────────────────────────────────────
  function exportAllCSV() {
    const rows = [];

    // === 訂單明細 sheet ===
    rows.push(["=== 所有訂單明細 ===", "", "", "", "", "", "", "", "", "", ""]);
    rows.push(["批次", "客人", "商品名稱", "日幣價格(¥)", "重量(g)", "商品款(NT$)", "運費尾款(NT$)", "付款方式", "商品款狀態", "運費狀態", "備註"]);

    batchProfits.forEach(({ batch, batchOrders }) => {
      batchOrders.forEach(o => {
        const productTwd = Math.round((o.order_items || []).reduce((s, i) => s + Number(i.jpy_price || 0), 0) * 0.25);
        const items = o.order_items || [];
        if (items.length === 0) {
          rows.push([batch.name, o.customer, "", "", "", productTwd, Math.round(o.shipping_twd || 0),
            o.payment_method, o.product_paid ? "已付" : "未付",
            o.shipping_twd > 0 ? (o.shipping_paid ? "已付" : "未付") : "—", o.note || ""]);
        } else {
          items.forEach((item, idx) => {
            rows.push([
              idx === 0 ? batch.name : "",
              idx === 0 ? o.customer : "",
              item.name, item.jpy_price, item.weight_g || 0,
              idx === 0 ? productTwd : "",
              idx === 0 ? Math.round(o.shipping_twd || 0) : "",
              idx === 0 ? o.payment_method : "",
              idx === 0 ? (o.product_paid ? "已付" : "未付") : "",
              idx === 0 ? (o.shipping_twd > 0 ? (o.shipping_paid ? "已付" : "未付") : "—") : "",
              idx === 0 ? (o.note || "") : "",
            ]);
          });
        }
      });
    });

    rows.push([]);

    // === 利潤總覽 ===
    rows.push(["=== 各批次利潤總覽 ===", "", "", "", "", "", "", "", "", "", ""]);
    rows.push(["批次名稱", "日期", "訂單數", "商品總額(¥)", "匯率", "匯差毛利(NT$)", "手續費(NT$)", "吸收運費(NT$)", "淨利(NT$)", "每人分潤(NT$)", "收款進度%"]);
    batchProfits.forEach(({ batch, totalJpy, grossProfit, ccFee, absorbed, net, each, totalOrders, collectedProduct, collectedShipping, totalReceivable }) => {
      const collectRatio = totalReceivable > 0 ? Math.round((collectedProduct + collectedShipping) / totalReceivable * 100) : 0;
      rows.push([
        batch.name, batch.date, totalOrders,
        Math.round(totalJpy), batch.jpy_rate,
        Math.round(grossProfit), Math.round(ccFee),
        Math.round(absorbed), Math.round(net),
        Math.round(each), `${collectRatio}%`
      ]);
    });
    rows.push([]);
    rows.push(["累計總計", "", batchProfits.reduce((s, b) => s + b.totalOrders, 0),
      Math.round(overall.totalJpy), "",
      Math.round(overall.grossProfit), Math.round(overall.ccFee),
      Math.round(overall.absorbed), Math.round(overall.net),
      Math.round(overall.each), ""
    ]);

    const today = new Date().toISOString().split("T")[0];
    downloadCSV(`DAIKO_完整備份_${today}.csv`, rows);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">利潤總覽</h1>
          <p className="page-sub">所有批次的收益統計</p>
        </div>
        <button className="btn-export" onClick={exportAllCSV}>⬇ 匯出完整備份 CSV</button>
      </div>

      {/* Overall Summary */}
      <div className="overall-summary">
        <h2 className="section-title">📊 累計總計</h2>
        <div className="summary-grid">
          <div className="summary-card">
            <div className="summary-label">商品總金額</div>
            <div className="summary-value">¥{Math.round(overall.totalJpy).toLocaleString()}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">匯差毛利</div>
            <div className="summary-value twd">NT${Math.round(overall.grossProfit).toLocaleString()}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">刷卡手續費</div>
            <div className="summary-value neg">-NT${Math.round(overall.ccFee).toLocaleString()}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">吸收運費</div>
            <div className="summary-value neg">-NT${Math.round(overall.absorbed).toLocaleString()}</div>
          </div>
          <div className="summary-card highlight-card">
            <div className="summary-label">總淨利</div>
            <div className="summary-value net-big">NT${Math.round(overall.net).toLocaleString()}</div>
          </div>
          <div className="summary-card highlight-card">
            <div className="summary-label">每人分潤</div>
            <div className="summary-value net-big">NT${Math.round(overall.each).toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Per Batch */}
      <div className="batch-breakdown">
        <h2 className="section-title">📦 各批次明細</h2>
        {batchProfits.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📊</div>
            <p>還沒有任何批次資料</p>
          </div>
        ) : (
          <div className="profit-table-wrap">
            <table className="profit-table">
              <thead>
                <tr>
                  <th>批次名稱</th><th>日期</th><th>訂單數</th><th>商品總額(¥)</th>
                  <th>匯率</th><th>匯差毛利</th><th>手續費</th><th>吸收運費</th>
                  <th>淨利</th><th>每人分</th><th>收款進度</th>
                </tr>
              </thead>
              <tbody>
                {batchProfits.map(({ batch, totalJpy, grossProfit, ccFee, absorbed, net, each, totalOrders, collectedProduct, collectedShipping, totalReceivable }) => {
                  const collected = collectedProduct + collectedShipping;
                  const collectRatio = totalReceivable > 0 ? Math.round(collected / totalReceivable * 100) : 0;
                  return (
                    <tr key={batch.id}>
                      <td>
                        <div className="batch-name-cell">
                          {batch.archived && <span className="archive-tag">封存</span>}
                          {batch.name}
                        </div>
                      </td>
                      <td className="center">{batch.date}</td>
                      <td className="center">{totalOrders}</td>
                      <td className="number">¥{Math.round(totalJpy).toLocaleString()}</td>
                      <td className="center">{batch.jpy_rate}</td>
                      <td className="number twd">NT${Math.round(grossProfit).toLocaleString()}</td>
                      <td className="number neg">-NT${Math.round(ccFee).toLocaleString()}</td>
                      <td className="number neg">-NT${Math.round(absorbed).toLocaleString()}</td>
                      <td className="number net"><strong>NT${Math.round(net).toLocaleString()}</strong></td>
                      <td className="number net"><strong>NT${Math.round(each).toLocaleString()}</strong></td>
                      <td>
                        <div className="collect-bar-wrap">
                          <div className="collect-bar">
                            <div className="collect-fill" style={{ width: `${collectRatio}%` }} />
                          </div>
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
          <div className="formula-row"><span className="formula-label">客人付款價</span><span className="formula-eq">= 日幣原價 × 0.25</span></div>
          <div className="formula-row"><span className="formula-label">實際成本</span><span className="formula-eq">= 日幣原價 × 當批匯率</span></div>
          <div className="formula-row"><span className="formula-label">匯差毛利</span><span className="formula-eq">= 日幣總額 × (0.25 − 當批匯率)</span></div>
          <div className="formula-row"><span className="formula-label">刷卡手續費</span><span className="formula-eq">= 日幣總額 × 當批匯率 × 1.5%</span></div>
          <div className="formula-row"><span className="formula-label">淨利</span><span className="formula-eq">= 匯差毛利 − 手續費 − 吸收運費</span></div>
          <div className="formula-row highlight-formula"><span className="formula-label">每人分潤</span><span className="formula-eq">= 淨利 ÷ 2</span></div>
        </div>
      </div>
    </div>
  );
}
