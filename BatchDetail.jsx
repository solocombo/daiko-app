import { useState, useMemo } from "react";
import { supabase } from "../supabaseClient";

const PAYMENT_METHODS = ["虛擬帳戶轉帳", "無卡存款", "取付"];

// ── CSV export helper ────────────────────────────────────────────────────────
function downloadCSV(filename, rows) {
  const BOM = "\uFEFF"; // UTF-8 BOM for Excel
  const csv = BOM + rows.map(r => r.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function BatchDetail({ batch, orders, onRefresh, onBack }) {
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [showShippingCalc, setShowShippingCalc] = useState(false);
  const [saving, setSaving] = useState(false);

  const emptyForm = { customer: "", payment_method: "虛擬帳戶轉帳", items: [{ name: "", jpy_price: "", weight_g: "" }], note: "" };
  const [form, setForm] = useState(emptyForm);

  // ── Shipping calculation ─────────────────────────────────────────────────
  const totalWeightG = useMemo(() =>
    orders.reduce((sum, o) => sum + (o.order_items || []).reduce((s, i) => s + Number(i.weight_g || 0), 0), 0),
    [orders]
  );

  const shippingPerOrder = useMemo(() => {
    if (!batch.total_intl_shipping_jpy || totalWeightG === 0) return {};
    const totalShippingTwd = batch.total_intl_shipping_jpy * batch.jpy_rate;
    return orders.reduce((acc, o) => {
      const orderWeight = (o.order_items || []).reduce((s, i) => s + Number(i.weight_g || 0), 0);
      acc[o.id] = totalWeightG > 0 ? (orderWeight / totalWeightG) * totalShippingTwd : 0;
      return acc;
    }, {});
  }, [orders, batch, totalWeightG]);

  function orderProductTwd(order) {
    return (order.order_items || []).reduce((s, i) => s + Number(i.jpy_price || 0), 0) * 0.25;
  }

  // ── Form helpers ─────────────────────────────────────────────────────────
  const setFormField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (idx, k, v) => setForm((f) => {
    const items = [...f.items];
    items[idx] = { ...items[idx], [k]: v };
    return { ...f, items };
  });
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { name: "", jpy_price: "", weight_g: "" }] }));
  const removeItem = (idx) => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  function openEdit(order) {
    setEditingOrder(order);
    setForm({
      customer: order.customer,
      payment_method: order.payment_method || "虛擬帳戶轉帳",
      items: order.order_items?.map(i => ({ name: i.name, jpy_price: i.jpy_price, weight_g: i.weight_g })) || [{ name: "", jpy_price: "", weight_g: "" }],
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
        await supabase.from("orders").update({
          customer: form.customer, payment_method: form.payment_method, note: form.note,
        }).eq("id", orderId);
        await supabase.from("order_items").delete().eq("order_id", orderId);
      } else {
        const { data, error } = await supabase.from("orders").insert([{
          batch_id: batch.id, customer: form.customer,
          payment_method: form.payment_method, product_paid: false,
          shipping_paid: false, shipping_twd: 0, note: form.note,
        }]).select().single();
        if (error) throw error;
        orderId = data.id;
      }
      await supabase.from("order_items").insert(
        form.items.map(i => ({ order_id: orderId, name: i.name, jpy_price: Number(i.jpy_price), weight_g: Number(i.weight_g) || 0 }))
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

  async function applyShipping() {
    if (totalWeightG === 0) return alert("請先在訂單中填寫商品重量");
    if (!batch.total_intl_shipping_jpy) return alert("請先在批次設定中填寫國際運費");
    await Promise.all(orders.map(o =>
      supabase.from("orders").update({ shipping_twd: Math.round(shippingPerOrder[o.id] || 0) }).eq("id", o.id)
    ));
    setShowShippingCalc(false);
    onRefresh();
  }

  // ── Export this batch CSV ────────────────────────────────────────────────
  function exportBatchCSV() {
    const header = ["客人", "商品名稱", "日幣價格(¥)", "重量(g)", "商品款(NT$)", "運費尾款(NT$)", "付款方式", "商品款狀態", "運費狀態", "備註"];
    const rows = [header];
    orders.forEach(o => {
      const productTwd = Math.round(orderProductTwd(o));
      const items = o.order_items || [];
      items.forEach((item, idx) => {
        rows.push([
          idx === 0 ? o.customer : "",
          item.name,
          item.jpy_price,
          item.weight_g || 0,
          idx === 0 ? productTwd : "",
          idx === 0 ? Math.round(o.shipping_twd || 0) : "",
          idx === 0 ? o.payment_method : "",
          idx === 0 ? (o.product_paid ? "已付" : "未付") : "",
          idx === 0 ? (o.shipping_twd > 0 ? (o.shipping_paid ? "已付" : "未付") : "—") : "",
          idx === 0 ? (o.note || "") : "",
        ]);
      });
      if (items.length === 0) {
        rows.push([o.customer, "", "", "", productTwd, Math.round(o.shipping_twd || 0),
          o.payment_method, o.product_paid ? "已付" : "未付",
          o.shipping_twd > 0 ? (o.shipping_paid ? "已付" : "未付") : "—", o.note || ""]);
      }
    });
    // Profit summary rows
    rows.push([]);
    rows.push(["=== 利潤計算 ===", "", "", "", "", "", "", "", "", ""]);
    rows.push(["匯差毛利(NT$)", Math.round(profit.grossProfit), "", "", "", "", "", "", "", ""]);
    rows.push(["刷卡手續費1.5%(NT$)", -Math.round(profit.ccFee), "", "", "", "", "", "", "", ""]);
    rows.push(["吸收運費(NT$)", -Math.round(profit.absorbed), "", "", "", "", "", "", "", ""]);
    rows.push(["淨利(NT$)", Math.round(profit.net), "", "", "", "", "", "", "", ""]);
    rows.push(["每人分潤(NT$)", Math.round(profit.each), "", "", "", "", "", "", "", ""]);
    downloadCSV(`${batch.name}_訂單明細.csv`, rows);
  }

  // ── Profit calc ──────────────────────────────────────────────────────────
  const profit = useMemo(() => {
    const totalJpy = orders.reduce((s, o) =>
      s + (o.order_items || []).reduce((ss, i) => ss + Number(i.jpy_price || 0), 0), 0);
    const grossProfit = totalJpy * (0.25 - batch.jpy_rate);
    const ccFee = totalJpy * batch.jpy_rate * 0.015;
    const absorbed = Number(batch.absorbed_shipping_twd) || 0;
    const net = grossProfit - ccFee - absorbed;
    return { totalJpy, grossProfit, ccFee, absorbed, net, each: net / 2 };
  }, [orders, batch]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <button className="btn-back" onClick={onBack}>← 返回批次列表</button>
          <h1 className="page-title">{batch.name}</h1>
          <p className="page-sub">{batch.date}　匯率 {batch.jpy_rate}　國際運費 ¥{Number(batch.total_intl_shipping_jpy).toLocaleString()}</p>
        </div>
        <div className="header-actions">
          <button className="btn-export" onClick={exportBatchCSV}>⬇ 匯出 CSV</button>
          <button className="btn-secondary" onClick={() => setShowShippingCalc(true)}>⚖️ 計算運費分攤</button>
          <button className="btn-primary" onClick={() => { setEditingOrder(null); setForm(emptyForm); setShowOrderForm(true); }}>＋ 新增訂單</button>
        </div>
      </div>

      {/* Profit Banner */}
      <div className="profit-banner">
        <div className="profit-item">
          <span className="profit-label">商品總金額</span>
          <span className="profit-value">¥{profit.totalJpy.toLocaleString()}</span>
        </div>
        <div className="profit-item">
          <span className="profit-label">匯差毛利</span>
          <span className="profit-value twd">NT${Math.round(profit.grossProfit).toLocaleString()}</span>
        </div>
        <div className="profit-item">
          <span className="profit-label">刷卡手續費 1.5%</span>
          <span className="profit-value neg">-NT${Math.round(profit.ccFee).toLocaleString()}</span>
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

      {/* Orders Table */}
      {orders.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🛒</div>
          <p>這個批次還沒有訂單</p>
        </div>
      ) : (
        <div className="orders-table-wrap">
          <table className="orders-table">
            <thead>
              <tr>
                <th>客人</th><th>商品</th><th>總重量</th><th>商品款(NT$)</th>
                <th>運費尾款(NT$)</th><th>付款方式</th><th>商品款</th><th>運費款</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const productTwd = orderProductTwd(order);
                const weightG = (order.order_items || []).reduce((s, i) => s + Number(i.weight_g || 0), 0);
                return (
                  <tr key={order.id} className={order.product_paid && order.shipping_paid ? "row-done" : ""}>
                    <td>
                      <div className="customer-name">{order.customer}</div>
                      {order.note && <div className="order-note">📝 {order.note}</div>}
                    </td>
                    <td>
                      <ul className="item-list">
                        {(order.order_items || []).map((i, idx) => (
                          <li key={idx}>{i.name} <span className="jpy">¥{Number(i.jpy_price).toLocaleString()}</span></li>
                        ))}
                      </ul>
                    </td>
                    <td className="center">{weightG > 0 ? `${weightG}g` : "—"}</td>
                    <td className="number">NT${Math.round(productTwd).toLocaleString()}</td>
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

      {/* Shipping Calculator Modal */}
      {showShippingCalc && (
        <div className="modal-overlay" onClick={() => setShowShippingCalc(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>⚖️ 運費分攤計算</h2>
              <button className="modal-close" onClick={() => setShowShippingCalc(false)}>✕</button>
            </div>
            <div className="shipping-calc">
              <div className="calc-summary">
                <div>國際運費：<strong>¥{Number(batch.total_intl_shipping_jpy).toLocaleString()} × {batch.jpy_rate} = NT${Math.round(batch.total_intl_shipping_jpy * batch.jpy_rate).toLocaleString()}</strong></div>
                <div>總重量：<strong>{totalWeightG}g</strong></div>
              </div>
              <table className="calc-table">
                <thead><tr><th>客人</th><th>重量(g)</th><th>佔比</th><th>應付運費(NT$)</th></tr></thead>
                <tbody>
                  {orders.map((o) => {
                    const w = (o.order_items || []).reduce((s, i) => s + Number(i.weight_g || 0), 0);
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
              {form.items.map((item, idx) => (
                <div key={idx} className="item-row">
                  <input className="form-input item-name" placeholder="商品名稱" value={item.name} onChange={(e) => setItem(idx, "name", e.target.value)} />
                  <div className="item-price-wrap">
                    <span className="item-prefix">¥</span>
                    <input className="form-input item-price" type="number" placeholder="日幣售價" value={item.jpy_price} onChange={(e) => setItem(idx, "jpy_price", e.target.value)} />
                  </div>
                  <div className="item-weight-wrap">
                    <input className="form-input item-weight" type="number" placeholder="重量(g)" value={item.weight_g} onChange={(e) => setItem(idx, "weight_g", e.target.value)} />
                    <span className="item-suffix">g</span>
                  </div>
                  {item.jpy_price && (
                    <span className="item-twd">= NT${Math.round(Number(item.jpy_price) * 0.25).toLocaleString()}</span>
                  )}
                  {form.items.length > 1 && (
                    <button className="btn-remove-item" onClick={() => removeItem(idx)}>✕</button>
                  )}
                </div>
              ))}
              {form.items.length > 0 && (
                <div className="items-total">
                  合計：¥{form.items.reduce((s, i) => s + (Number(i.jpy_price) || 0), 0).toLocaleString()}
                  　→　NT${Math.round(form.items.reduce((s, i) => s + (Number(i.jpy_price) || 0), 0) * 0.25).toLocaleString()}
                </div>
              )}
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
