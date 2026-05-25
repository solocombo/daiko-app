import { useState, useMemo } from "react";
import { supabase } from "../supabaseClient";

const PAYMENT_METHODS = ["虛擬帳戶轉帳", "無卡存款", "取付"];

function downloadCSV(filename, rows) {
  const BOM = "\uFEFF";
  const csv = BOM + rows.map(r => r.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// 無條件進位到最近10的倍數
function ceilTo10(n) {
  return Math.ceil(n / 10) * 10;
}

// 計算單件商品的各項數字
function calcItem(item, jpyRate, proxyRate) {
  const qty = Number(item.quantity || 1);
  const jpyUnit = Number(item.jpy_price || 0);
  const jpyTotal = jpyUnit * qty;
  const costTwd = jpyTotal * jpyRate;                    // 成本台幣
  const priceTwd = jpyTotal * proxyRate;                 // 定價台幣(未進位總)
  const ccFee = costTwd * 0.015;                         // 刷卡手續費1.5%
  const ccRebate = costTwd * 0.01;                       // 信用卡回饋1%
  const realCost = costTwd + ccFee - ccRebate;           // 實際成本
  const unitPriceRaw = jpyUnit * proxyRate;              // 單件未進位
  const unitPrice = ceilTo10(unitPriceRaw);              // 單件進位
  const totalPrice = unitPrice * qty;                    // 定價總價
  const profit = totalPrice - realCost;                  // 賺
  return { qty, jpyUnit, jpyTotal, costTwd, priceTwd, ccFee, ccRebate, realCost, unitPriceRaw, unitPrice, totalPrice, profit };
}

export default function BatchDetail({ batch, orders, onRefresh, onBack, settings }) {
  const proxyRate = settings?.proxy_rate || 0.25;
  const jpyRate = batch.jpy_rate;

  const [showOrderForm, setShowOrderForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [showShippingCalc, setShowShippingCalc] = useState(false);
  const [saving, setSaving] = useState(false);

  const emptyForm = { customer: "", payment_method: "虛擬帳戶轉帳", items: [{ name: "", jpy_price: "", quantity: 1, weight_g: "" }], note: "" };
  const [form, setForm] = useState(emptyForm);

  // ── Shipping ─────────────────────────────────────────────────────────────
  const totalWeightG = useMemo(() =>
    orders.reduce((sum, o) => sum + (o.order_items || []).filter(i => !i.not_obtained).reduce((s, i) => s + Number(i.weight_g || 0), 0), 0),
    [orders]
  );

  const shippingPerOrder = useMemo(() => {
    if (!batch.total_intl_shipping_jpy || totalWeightG === 0) return {};
    const totalShippingTwd = batch.total_intl_shipping_jpy * jpyRate;
    return orders.reduce((acc, o) => {
      const orderWeight = (o.order_items || []).filter(i => !i.not_obtained).reduce((s, i) => s + Number(i.weight_g || 0), 0);
      acc[o.id] = totalWeightG > 0 ? (orderWeight / totalWeightG) * totalShippingTwd : 0;
      return acc;
    }, {});
  }, [orders, batch, totalWeightG, jpyRate]);

  // ── Order total (only non-not_obtained items) ─────────────────────────────
  function orderTotalPrice(order) {
    return (order.order_items || [])
      .filter(i => !i.not_obtained)
      .reduce((s, i) => {
        const c = calcItem(i, jpyRate, proxyRate);
        return s + c.totalPrice;
      }, 0);
  }

  // ── Form helpers ─────────────────────────────────────────────────────────
  const setFormField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (idx, k, v) => setForm((f) => {
    const items = [...f.items];
    items[idx] = { ...items[idx], [k]: v };
    return { ...f, items };
  });
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { name: "", jpy_price: "", quantity: 1, weight_g: "" }] }));
  const removeItem = (idx) => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  function openEdit(order) {
    setEditingOrder(order);
    setForm({
      customer: order.customer,
      payment_method: order.payment_method || "虛擬帳戶轉帳",
      items: order.order_items?.map(i => ({ name: i.name, jpy_price: i.jpy_price, quantity: i.quantity || 1, weight_g: i.weight_g, not_obtained: i.not_obtained || false })) || [{ name: "", jpy_price: "", quantity: 1, weight_g: "" }],
      note: order.note || "",
    });
    setShowOrderForm(true);
  }

  async function saveOrder() {
    if (!form.customer) return alert("請填寫客人名稱");
    if (form.items.some(i => !i.name || !i.jpy_price)) return alert("請填寫所有商品名稱與日幣價格");
    setSaving(true);
    try {
      let orderId = editingOrder?.id;
      if (editingOrder) {
        await supabase.from("orders").update({ customer: form.customer, payment_method: form.payment_method, note: form.note }).eq("id", orderId);
        await supabase.from("order_items").delete().eq("order_id", orderId);
      } else {
        const { data, error } = await supabase.from("orders").insert([{
          batch_id: batch.id, customer: form.customer, payment_method: form.payment_method,
          product_paid: false, shipping_paid: false, shipping_twd: 0, note: form.note,
        }]).select().single();
        if (error) throw error;
        orderId = data.id;
      }
      await supabase.from("order_items").insert(
        form.items.map(i => ({
          order_id: orderId, name: i.name,
          jpy_price: Number(i.jpy_price),
          quantity: Number(i.quantity) || 1,
          weight_g: Number(i.weight_g) || 0,
          not_obtained: i.not_obtained || false,
        }))
      );
      setShowOrderForm(false); setEditingOrder(null); setForm(emptyForm);
      onRefresh();
    } catch (e) { alert("儲存失敗：" + e.message); }
    setSaving(false);
  }

  async function deleteOrder(id) {
    if (!confirm("確定刪除這筆訂單？")) return;
    await supabase.from("order_items").delete().eq("order_id", id);
    await supabase.from("orders").delete().eq("id", id);
    onRefresh();
  }

  async function togglePayment(order, field) {
    await supabase.from("orders").update({ [field]: !order[field] }).eq("id", order.id);
    onRefresh();
  }

  async function toggleNotObtained(itemId, current) {
    await supabase.from("order_items").update({ not_obtained: !current }).eq("id", itemId);
    onRefresh();
  }

  async function applyShipping() {
    if (totalWeightG === 0) return alert("請先在訂單中填寫商品重量");
    if (!batch.total_intl_shipping_jpy) return alert("請先填寫國際運費");
    await Promise.all(orders.map(o =>
      supabase.from("orders").update({ shipping_twd: Math.round(shippingPerOrder[o.id] || 0) }).eq("id", o.id)
    ));
    setShowShippingCalc(false);
    onRefresh();
  }

  // ── Profit (exclude not_obtained items) ──────────────────────────────────
  const profit = useMemo(() => {
    let totalRealCost = 0, totalPrice = 0;
    orders.forEach(o => {
      (o.order_items || []).filter(i => !i.not_obtained).forEach(i => {
        const c = calcItem(i, jpyRate, proxyRate);
        totalRealCost += c.realCost;
        totalPrice += c.totalPrice;
      });
    });
    const absorbed = Number(batch.absorbed_shipping_twd) || 0;
    const net = totalPrice - totalRealCost - absorbed;
    return { totalRealCost, totalPrice, absorbed, net, each: net / 2 };
  }, [orders, batch, jpyRate, proxyRate]);

  // ── CSV Export ────────────────────────────────────────────────────────────
  function exportBatchCSV() {
    const header = ["客人", "商品", "數量", "日幣單價", "日幣總價", "成本台幣", "手續費1.5%", "回饋1%", "實際成本", "單件定價", "定價總價", "利潤", "重量(g)", "付款方式", "商品款", "運費款", "未搶到", "備註"];
    const rows = [header];
    orders.forEach(o => {
      (o.order_items || []).forEach((item, idx) => {
        const c = calcItem(item, jpyRate, proxyRate);
        rows.push([
          idx === 0 ? o.customer : "",
          item.name,
          c.qty,
          c.jpyUnit,
          c.jpyTotal,
          Math.round(c.costTwd),
          Math.round(c.ccFee),
          Math.round(c.ccRebate),
          Math.round(c.realCost),
          c.unitPrice,
          c.totalPrice,
          item.not_obtained ? "未搶到" : Math.round(c.profit),
          item.weight_g || 0,
          idx === 0 ? o.payment_method : "",
          idx === 0 ? (o.product_paid ? "已付" : "未付") : "",
          idx === 0 ? (o.shipping_twd > 0 ? (o.shipping_paid ? "已付" : "未付") : "—") : "",
          item.not_obtained ? "是" : "",
          idx === 0 ? (o.note || "") : "",
        ]);
      });
    });
    rows.push([]);
    rows.push(["=== 利潤摘要 ===", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    rows.push(["定價總收入", Math.round(profit.totalPrice), "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    rows.push(["實際總成本", Math.round(profit.totalRealCost), "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    rows.push(["吸收運費", Math.round(profit.absorbed), "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    rows.push(["淨利", Math.round(profit.net), "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    rows.push(["每人分潤", Math.round(profit.each), "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    downloadCSV(`${batch.name}_訂單明細.csv`, rows);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <button className="btn-back" onClick={onBack}>← 返回批次列表</button>
          <h1 className="page-title">{batch.name}</h1>
          <p className="page-sub">
            {batch.date}　當批匯率 <strong>{jpyRate}</strong>　代購匯率 <strong>{proxyRate}</strong>　國際運費 ¥{Number(batch.total_intl_shipping_jpy).toLocaleString()}
          </p>
        </div>
        <div className="header-actions">
          <button className="btn-export" onClick={exportBatchCSV}>⬇ 匯出 CSV</button>
          <button className="btn-secondary" onClick={() => setShowShippingCalc(true)}>⚖️ 運費分攤</button>
          <button className="btn-primary" onClick={() => { setEditingOrder(null); setForm(emptyForm); setShowOrderForm(true); }}>＋ 新增訂單</button>
        </div>
      </div>

      {/* Profit Banner */}
      <div className="profit-banner">
        <div className="profit-item">
          <span className="profit-label">定價總收入</span>
          <span className="profit-value twd">NT${Math.round(profit.totalPrice).toLocaleString()}</span>
        </div>
        <div className="profit-item">
          <span className="profit-label">實際總成本</span>
          <span className="profit-value neg">-NT${Math.round(profit.totalRealCost).toLocaleString()}</span>
        </div>
        <div className="profit-item">
          <span className="profit-label">吸收運費</span>
          <span className="profit-value neg">-NT${profit.absorbed.toLocaleString()}</span>
        </div>
        <div className="profit-item highlight">
          <span className="profit-label">淨利</span>
          <span className="profit-value net">NT${Math.round(profit.net).toLocaleString()}</span>
        </div>
        <div className="profit-item highlight">
          <span className="profit-label">每人分</span>
          <span className="profit-value net">NT${Math.round(profit.each).toLocaleString()}</span>
        </div>
      </div>

      {/* Orders */}
      {orders.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">🛒</div><p>這個批次還沒有訂單</p></div>
      ) : (
        <div className="orders-table-wrap">
          <table className="orders-table">
            <thead>
              <tr>
                <th>客人</th><th>商品</th><th>數量</th><th>日幣單價</th>
                <th>成本(NT$)</th><th>手續費</th><th>回饋</th><th>實際成本</th>
                <th>單件定價</th><th>定價總計</th><th>利潤</th>
                <th>重量</th><th>運費尾款</th><th>付款方式</th><th>商品款</th><th>運費款</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const activeItems = (order.order_items || []).filter(i => !i.not_obtained);
                const totalProfit = activeItems.reduce((s, i) => s + calcItem(i, jpyRate, proxyRate).profit, 0);
                const totalOrderPrice = activeItems.reduce((s, i) => s + calcItem(i, jpyRate, proxyRate).totalPrice, 0);
                return (
                  <tr key={order.id} className={order.product_paid && (order.shipping_twd === 0 || order.shipping_paid) ? "row-done" : ""}>
                    <td>
                      <div className="customer-name">{order.customer}</div>
                      {order.note && <div className="order-note">📝 {order.note}</div>}
                    </td>
                    <td>
                      <div className="item-list-detail">
                        {(order.order_items || []).map((item, idx) => {
                          const c = calcItem(item, jpyRate, proxyRate);
                          return (
                            <div key={idx} className={`item-detail-row ${item.not_obtained ? "item-not-obtained" : ""}`}>
                              <span className="item-detail-name">{item.name}</span>
                              {item.not_obtained && <span className="not-obtained-badge">未搶到</span>}
                              <button
                                className={`btn-not-obtained ${item.not_obtained ? "active" : ""}`}
                                onClick={() => toggleNotObtained(item.id, item.not_obtained)}
                                title={item.not_obtained ? "標記為已搶到" : "標記為未搶到"}
                              >
                                {item.not_obtained ? "↩ 恢復" : "✕ 未搶到"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    {/* Show totals across active items */}
                    <td className="center">
                      {activeItems.reduce((s, i) => s + (Number(i.quantity) || 1), 0)}
                    </td>
                    <td className="number">
                      {activeItems.map((i, idx) => (
                        <div key={idx} className="multi-val">¥{Number(i.jpy_price).toLocaleString()}</div>
                      ))}
                    </td>
                    <td className="number">
                      NT${Math.round(activeItems.reduce((s, i) => s + calcItem(i, jpyRate, proxyRate).costTwd, 0)).toLocaleString()}
                    </td>
                    <td className="number neg">
                      NT${Math.round(activeItems.reduce((s, i) => s + calcItem(i, jpyRate, proxyRate).ccFee, 0)).toLocaleString()}
                    </td>
                    <td className="number green">
                      NT${Math.round(activeItems.reduce((s, i) => s + calcItem(i, jpyRate, proxyRate).ccRebate, 0)).toLocaleString()}
                    </td>
                    <td className="number">
                      NT${Math.round(activeItems.reduce((s, i) => s + calcItem(i, jpyRate, proxyRate).realCost, 0)).toLocaleString()}
                    </td>
                    <td className="number">
                      {activeItems.map((i, idx) => (
                        <div key={idx} className="multi-val">NT${calcItem(i, jpyRate, proxyRate).unitPrice.toLocaleString()}</div>
                      ))}
                    </td>
                    <td className="number twd">NT${Math.round(totalOrderPrice).toLocaleString()}</td>
                    <td className="number net">NT${Math.round(totalProfit).toLocaleString()}</td>
                    <td className="center">
                      {activeItems.reduce((s, i) => s + Number(i.weight_g || 0), 0)}g
                    </td>
                    <td className="number">{order.shipping_twd > 0 ? `NT$${Math.round(order.shipping_twd).toLocaleString()}` : "—"}</td>
                    <td className="center">
                      <span className={`method-tag ${order.payment_method === "取付" ? "method-cod" : ""}`}>{order.payment_method}</span>
                    </td>
                    <td className="center">
                      <button className={`pay-btn ${order.product_paid ? "paid" : "unpaid"}`} onClick={() => togglePayment(order, "product_paid")}>
                        {order.product_paid ? "✓ 已付" : "未付"}
                      </button>
                    </td>
                    <td className="center">
                      {order.shipping_twd > 0 ? (
                        <button className={`pay-btn ${order.shipping_paid ? "paid" : "unpaid"}`} onClick={() => togglePayment(order, "shipping_paid")}>
                          {order.shipping_paid ? "✓ 已付" : "未付"}
                        </button>
                      ) : "—"}
                    </td>
                    <td className="center">
                      <button className="btn-edit-sm" onClick={() => openEdit(order)}>編輯</button>
                      <button className="btn-danger-sm" onClick={() => deleteOrder(order.id)}>刪除</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Shipping Modal */}
      {showShippingCalc && (
        <div className="modal-overlay" onClick={() => setShowShippingCalc(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>⚖️ 運費分攤計算</h2>
              <button className="modal-close" onClick={() => setShowShippingCalc(false)}>✕</button>
            </div>
            <div className="shipping-calc">
              <div className="calc-summary">
                <div>國際運費：<strong>¥{Number(batch.total_intl_shipping_jpy).toLocaleString()} × {jpyRate} = NT${Math.round(batch.total_intl_shipping_jpy * jpyRate).toLocaleString()}</strong></div>
                <div>總重量（排除未搶到）：<strong>{totalWeightG}g</strong></div>
              </div>
              <table className="calc-table">
                <thead><tr><th>客人</th><th>重量(g)</th><th>佔比</th><th>應付運費(NT$)</th></tr></thead>
                <tbody>
                  {orders.map((o) => {
                    const w = (o.order_items || []).filter(i => !i.not_obtained).reduce((s, i) => s + Number(i.weight_g || 0), 0);
                    const ratio = totalWeightG > 0 ? (w / totalWeightG * 100).toFixed(1) : 0;
                    return (
                      <tr key={o.id}>
                        <td>{o.customer}</td>
                        <td className="center">{w}g</td>
                        <td className="center">{ratio}%</td>
                        <td className="number">NT${Math.round(shippingPerOrder[o.id] || 0).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowShippingCalc(false)}>取消</button>
              <button className="btn-primary" onClick={applyShipping}>套用到所有訂單</button>
            </div>
          </div>
        </div>
      )}

      {/* Order Form Modal */}
      {showOrderForm && (
        <div className="modal-overlay" onClick={() => setShowOrderForm(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingOrder ? "編輯訂單" : "新增訂單"}</h2>
              <button className="modal-close" onClick={() => setShowOrderForm(false)}>✕</button>
            </div>
            <div className="form-grid">
              <label className="form-label">客人名稱 / ID
                <input className="form-input" placeholder="例：小花、IG@xxx" value={form.customer} onChange={(e) => setFormField("customer", e.target.value)} />
              </label>
              <label className="form-label">付款方式
                <select className="form-input" value={form.payment_method} onChange={(e) => setFormField("payment_method", e.target.value)}>
                  {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
                </select>
              </label>
              <label className="form-label" style={{ gridColumn: "1/-1" }}>備註
                <input className="form-input" placeholder="特殊說明、取付地點等" value={form.note} onChange={(e) => setFormField("note", e.target.value)} />
              </label>
            </div>

            <div className="items-section">
              <div className="items-header">
                <h3>商品明細</h3>
                <button className="btn-add-item" onClick={addItem}>＋ 新增商品</button>
              </div>

              {/* Item header row */}
              <div className="item-header-row">
                <span className="ih-name">商品名稱</span>
                <span className="ih-qty">數量</span>
                <span className="ih-price">日幣單價</span>
                <span className="ih-weight">重量(g)</span>
                <span className="ih-calc">單件定價</span>
                <span className="ih-total">總定價</span>
                <span className="ih-profit">利潤</span>
              </div>

              {form.items.map((item, idx) => {
                const c = item.jpy_price ? calcItem(item, jpyRate, proxyRate) : null;
                return (
                  <div key={idx} className={`item-row-full ${item.not_obtained ? "item-not-obtained" : ""}`}>
                    <input className="form-input ih-name" placeholder="商品名稱" value={item.name} onChange={(e) => setItem(idx, "name", e.target.value)} />
                    <input className="form-input ih-qty" type="number" min="1" placeholder="數量" value={item.quantity} onChange={(e) => setItem(idx, "quantity", e.target.value)} />
                    <div className="item-price-wrap ih-price">
                      <span className="item-prefix">¥</span>
                      <input className="form-input" type="number" placeholder="日幣單價" value={item.jpy_price} onChange={(e) => setItem(idx, "jpy_price", e.target.value)} />
                    </div>
                    <div className="item-weight-wrap ih-weight">
                      <input className="form-input" type="number" placeholder="重量" value={item.weight_g} onChange={(e) => setItem(idx, "weight_g", e.target.value)} />
                      <span className="item-suffix">g</span>
                    </div>
                    <span className="ih-calc calc-val">{c ? `NT$${c.unitPrice.toLocaleString()}` : "—"}</span>
                    <span className="ih-total calc-val twd">{c ? `NT$${c.totalPrice.toLocaleString()}` : "—"}</span>
                    <span className="ih-profit calc-val net">{c && !item.not_obtained ? `NT$${Math.round(c.profit).toLocaleString()}` : "—"}</span>
                    <label className="not-obtained-check">
                      <input type="checkbox" checked={item.not_obtained || false} onChange={(e) => setItem(idx, "not_obtained", e.target.checked)} />
                      未搶到
                    </label>
                    {form.items.length > 1 && (
                      <button className="btn-remove-item" onClick={() => removeItem(idx)}>✕</button>
                    )}
                  </div>
                );
              })}

              {form.items.length > 0 && (() => {
                const activeItems = form.items.filter(i => !i.not_obtained && i.jpy_price);
                const totalOrderPrice = activeItems.reduce((s, i) => s + calcItem(i, jpyRate, proxyRate).totalPrice, 0);
                const totalProfit = activeItems.reduce((s, i) => s + calcItem(i, jpyRate, proxyRate).profit, 0);
                return (
                  <div className="items-total">
                    定價總計：<span className="twd-text">NT${totalOrderPrice.toLocaleString()}</span>
                    　利潤：<span className="net-text">NT${Math.round(totalProfit).toLocaleString()}</span>
                  </div>
                );
              })()}
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowOrderForm(false)}>取消</button>
              <button className="btn-primary" onClick={saveOrder} disabled={saving}>{saving ? "儲存中..." : "儲存訂單"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
