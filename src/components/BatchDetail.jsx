import { useState, useMemo, useEffect } from "react";
import { supabase } from "../supabaseClient";

const PAYMENT_METHODS = ["虛擬帳戶轉帳", "無卡存款", "取付"];

function downloadCSV(filename, rows) {
  const BOM = "\uFEFF";
  const csv = BOM + rows.map(r => r.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
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
  return { qty, jpyUnit, jpyTotal, costTwd, ccFee, ccRebate, realCost, unitPrice, totalPrice, profit };
}

export default function BatchDetail({ batch, orders, onRefresh, onBack, settings }) {
  const proxyRate = settings?.proxy_rate || 0.25;
  const jpyRate = batch.jpy_rate;

  const [showOrderForm, setShowOrderForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [showShippingCalc, setShowShippingCalc] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentOrder, setPaymentOrder] = useState(null);
  const [paymentRecords, setPaymentRecords] = useState([]);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [allPayments, setAllPayments] = useState({});
  const [saving, setSaving] = useState(false);

  const emptyForm = { customer: "", payment_method: "虛擬帳戶轉帳", items: [{ name: "", jpy_price: "", quantity: 1, weight_g: "" }], note: "" };
  const [form, setForm] = useState(emptyForm);

  useEffect(() => { fetchAllPayments(); }, [orders]);

  async function fetchAllPayments() {
    if (!orders.length) return;
    const orderIds = orders.map(o => o.id);
    const { data } = await supabase.from("payment_records").select("*").in("order_id", orderIds).order("created_at");
    const map = {};
    (data || []).forEach(p => {
      if (!map[p.order_id]) map[p.order_id] = [];
      map[p.order_id].push(p);
    });
    setAllPayments(map);
  }

  // ── Shipping ──────────────────────────────────────────────────────────────
  const totalWeightG = useMemo(() =>
    orders.reduce((sum, o) => sum + (o.order_items || []).filter(i => !i.not_obtained).reduce((s, i) => s + Number(i.weight_g || 0), 0), 0),
    [orders]);

  const shippingPerOrder = useMemo(() => {
    if (!batch.total_intl_shipping_jpy || totalWeightG === 0) return {};
    const totalShippingTwd = batch.total_intl_shipping_jpy * jpyRate;
    return orders.reduce((acc, o) => {
      const w = (o.order_items || []).filter(i => !i.not_obtained).reduce((s, i) => s + Number(i.weight_g || 0), 0);
      acc[o.id] = totalWeightG > 0 ? (w / totalWeightG) * totalShippingTwd : 0;
      return acc;
    }, {});
  }, [orders, batch, totalWeightG, jpyRate]);

  function orderTotalDue(order) {
    const activeItems = (order.order_items || []).filter(i => !i.not_obtained);
    const productTotal = activeItems.reduce((s, i) => s + calcItem(i, jpyRate, proxyRate).totalPrice, 0);
    return Math.round(productTotal + Number(order.shipping_twd || 0));
  }

  function orderPaid(orderId) {
    return (allPayments[orderId] || []).reduce((s, p) => s + Number(p.amount), 0);
  }

  // ── Form helpers ─────────────────────────────────────────────────────────
  const setFormField = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setItem = (idx, k, v) => setForm(f => {
    const items = [...f.items]; items[idx] = { ...items[idx], [k]: v }; return { ...f, items };
  });
  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { name: "", jpy_price: "", quantity: 1, weight_g: "" }] }));
  const removeItem = (idx) => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

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
        form.items.map(i => ({ order_id: orderId, name: i.name, jpy_price: Number(i.jpy_price), quantity: Number(i.quantity) || 1, weight_g: Number(i.weight_g) || 0, not_obtained: i.not_obtained || false }))
      );
      setShowOrderForm(false); setEditingOrder(null); setForm(emptyForm);
      onRefresh();
    } catch (e) { alert("儲存失敗：" + e.message); }
    setSaving(false);
  }

  async function deleteOrder(id) {
    if (!confirm("確定刪除這筆訂單？")) return;
    await supabase.from("payment_records").delete().eq("order_id", id);
    await supabase.from("order_items").delete().eq("order_id", id);
    await supabase.from("orders").delete().eq("id", id);
    onRefresh();
  }

  async function toggleNotObtained(itemId, current) {
    await supabase.from("order_items").update({ not_obtained: !current }).eq("id", itemId);
    onRefresh();
  }

  async function applyShipping() {
    if (totalWeightG === 0) return alert("請先在訂單中填寫商品重量");
    if (!batch.total_intl_shipping_jpy) return alert("請先填寫國際運費");
    await Promise.all(orders.map(o => supabase.from("orders").update({ shipping_twd: Math.round(shippingPerOrder[o.id] || 0) }).eq("id", o.id)));
    setShowShippingCalc(false); onRefresh();
  }

  // ── Payment modal ─────────────────────────────────────────────────────────
  function openPaymentModal(order) {
    setPaymentOrder(order);
    const recs = allPayments[order.id] || [];
    setPaymentRecords(recs);
    const due = orderTotalDue(order);
    const paid = recs.reduce((s, p) => s + Number(p.amount), 0);
    setPaymentAmount(String(Math.max(0, due - paid)));
    setPaymentNote("");
    setShowPaymentModal(true);
  }

  async function addPaymentRecord() {
    if (!paymentAmount || Number(paymentAmount) <= 0) return alert("請填寫付款金額");
    setSavingPayment(true);
    await supabase.from("payment_records").insert([{
      order_id: paymentOrder.id,
      amount: Number(paymentAmount),
      note: paymentNote,
      paid_at: new Date().toISOString().split("T")[0],
    }]);
    // Refresh records
    const { data } = await supabase.from("payment_records").select("*").eq("order_id", paymentOrder.id).order("created_at");
    setPaymentRecords(data || []);
    // Check if fully paid
    const totalPaid = (data || []).reduce((s, p) => s + Number(p.amount), 0);
    const due = orderTotalDue(paymentOrder);
    if (totalPaid >= due) {
      await supabase.from("orders").update({ product_paid: true, shipping_paid: true }).eq("id", paymentOrder.id);
    }
    setPaymentAmount("");
    setPaymentNote("");
    setSavingPayment(false);
    fetchAllPayments();
    onRefresh();
  }

  async function deletePaymentRecord(id) {
    if (!confirm("確定刪除這筆付款記錄？")) return;
    await supabase.from("payment_records").delete().eq("id", id);
    const { data } = await supabase.from("payment_records").select("*").eq("order_id", paymentOrder.id).order("created_at");
    setPaymentRecords(data || []);
    // Recheck paid status
    const totalPaid = (data || []).reduce((s, p) => s + Number(p.amount), 0);
    const due = orderTotalDue(paymentOrder);
    if (totalPaid < due) {
      await supabase.from("orders").update({ product_paid: false, shipping_paid: false }).eq("id", paymentOrder.id);
    }
    fetchAllPayments();
    onRefresh();
  }

  // ── Profit ────────────────────────────────────────────────────────────────
  const profit = useMemo(() => {
    let totalRealCost = 0, totalPrice = 0;
    orders.forEach(o => {
      (o.order_items || []).filter(i => !i.not_obtained).forEach(i => {
        const c = calcItem(i, jpyRate, proxyRate);
        totalRealCost += c.realCost; totalPrice += c.totalPrice;
      });
    });
    const absorbed = Number(batch.absorbed_shipping_twd) || 0;
    const net = totalPrice - totalRealCost - absorbed;
    return { totalRealCost, totalPrice, absorbed, net };
  }, [orders, batch, jpyRate, proxyRate]);

  // ── CSV Export ────────────────────────────────────────────────────────────
  function exportBatchCSV() {
    const header = ["客人","商品","數量","日幣單價","成本台幣","手續費","回饋","實際成本","單件定價","定價總計","利潤","重量","運費尾款","應收總計","已付","尚欠","付款方式","備註"];
    const rows = [header];
    orders.forEach(o => {
      const due = orderTotalDue(o);
      const paid = orderPaid(o.id);
      const activeItems = (o.order_items || []).filter(i => !i.not_obtained);
      activeItems.forEach((item, idx) => {
        const c = calcItem(item, jpyRate, proxyRate);
        rows.push([
          idx === 0 ? o.customer : "", item.name, c.qty, c.jpyUnit,
          Math.round(c.costTwd), Math.round(c.ccFee), Math.round(c.ccRebate), Math.round(c.realCost),
          c.unitPrice, c.totalPrice, Math.round(c.profit), item.weight_g || 0,
          idx === 0 ? Math.round(o.shipping_twd || 0) : "",
          idx === 0 ? due : "", idx === 0 ? Math.round(paid) : "", idx === 0 ? Math.max(0, due - paid) : "",
          idx === 0 ? o.payment_method : "", idx === 0 ? (o.note || "") : "",
        ]);
      });
    });
    downloadCSV(`${batch.name}_訂單.csv`, rows);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <button className="btn-back" onClick={onBack}>← 返回批次列表</button>
          <h1 className="page-title">{batch.name}</h1>
          <p className="page-sub">{batch.date}　當批匯率 <strong>{jpyRate}</strong>　代購匯率 <strong>{proxyRate}</strong>　國際運費 ¥{Number(batch.total_intl_shipping_jpy).toLocaleString()}</p>
        </div>
        <div className="header-actions">
          <button className="btn-export" onClick={exportBatchCSV}>⬇ 匯出 CSV</button>
          <button className="btn-secondary" onClick={() => setShowShippingCalc(true)}>⚖️ 運費分攤</button>
          <button className="btn-primary" onClick={() => { setEditingOrder(null); setForm(emptyForm); setShowOrderForm(true); }}>＋ 新增訂單</button>
        </div>
      </div>

      {/* Profit Banner */}
      <div className="profit-banner">
        <div className="profit-item"><span className="profit-label">定價總收入</span><span className="profit-value twd">NT${Math.round(profit.totalPrice).toLocaleString()}</span></div>
        <div className="profit-item"><span className="profit-label">實際總成本</span><span className="profit-value neg">-NT${Math.round(profit.totalRealCost).toLocaleString()}</span></div>
        <div className="profit-item"><span className="profit-label">吸收運費</span><span className="profit-value neg">-NT${profit.absorbed.toLocaleString()}</span></div>
        <div className="profit-item highlight"><span className="profit-label">淨利</span><span className="profit-value net">NT${Math.round(profit.net).toLocaleString()}</span></div>
      </div>

      {/* Orders - card layout instead of wide table */}
      {orders.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">🛒</div><p>這個批次還沒有訂單</p></div>
      ) : (
        <div className="order-cards">
          {orders.map((order) => {
            const activeItems = (order.order_items || []).filter(i => !i.not_obtained);
            const totalOrderPrice = activeItems.reduce((s, i) => s + calcItem(i, jpyRate, proxyRate).totalPrice, 0);
            const totalProfit = activeItems.reduce((s, i) => s + calcItem(i, jpyRate, proxyRate).profit, 0);
            const due = orderTotalDue(order);
            const paid = orderPaid(order.id);
            const remaining = due - paid;
            const isFullyPaid = paid >= due && due > 0;
            return (
              <div key={order.id} className={`order-card ${isFullyPaid ? "order-card-done" : ""}`}>
                {/* Card header */}
                <div className="order-card-header">
                  <div className="order-card-customer">
                    <span className="customer-name">{order.customer}</span>
                    <span className={`method-tag ${order.payment_method === "取付" ? "method-cod" : ""}`}>{order.payment_method}</span>
                    {order.note && <span className="order-note">📝 {order.note}</span>}
                  </div>
                  <div className="order-card-actions">
                    <button className="btn-edit-sm" onClick={() => openEdit(order)}>編輯</button>
                    <button className="btn-danger-sm" onClick={() => deleteOrder(order.id)}>刪除</button>
                  </div>
                </div>

                {/* Items */}
                <div className="order-card-body">
                  <div className="order-items-cols">
                    <div className="order-items-list">
                      {(order.order_items || []).map((item, idx) => {
                        const c = item.not_obtained ? null : calcItem(item, jpyRate, proxyRate);
                        return (
                          <div key={idx} className={`order-item-row ${item.not_obtained ? "item-not-obtained" : ""}`}>
                            <span className="order-item-name">{item.name}</span>
                            {item.not_obtained
                              ? <span className="not-obtained-badge">未搶到</span>
                              : <>
                                  <span className="order-item-detail">× {c.qty}　¥{c.jpyUnit.toLocaleString()}　→　NT${c.unitPrice.toLocaleString()} × {c.qty} = <strong>NT${c.totalPrice.toLocaleString()}</strong></span>
                                  <span className="order-item-profit net-text">+NT${Math.round(c.profit).toLocaleString()}</span>
                                </>
                            }
                            <button className={`btn-not-obtained ${item.not_obtained ? "active" : ""}`} onClick={() => toggleNotObtained(item.id, item.not_obtained)}>
                              {item.not_obtained ? "↩ 恢復" : "✕ 未搶"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {/* Calc summary column */}
                    <div className="order-calc-col">
                      <div className="calc-row"><span className="calc-label">定價合計</span><span className="twd-text">NT${Math.round(totalOrderPrice).toLocaleString()}</span></div>
                      <div className="calc-row"><span className="calc-label">運費尾款</span><span>{order.shipping_twd > 0 ? `NT$${Math.round(order.shipping_twd).toLocaleString()}` : "—"}</span></div>
                      <div className="calc-row"><span className="calc-label">利潤</span><span className="net-text">NT${Math.round(totalProfit).toLocaleString()}</span></div>
                    </div>
                  </div>

                  {/* Payment summary */}
                  <div className="order-payment-row">
                    <div className="payment-summary">
                      <span className="pay-summary-item">應收 <strong>NT${due.toLocaleString()}</strong></span>
                      <span className="pay-summary-item">已付 <strong className="net-text">NT${Math.round(paid).toLocaleString()}</strong></span>
                      <span className={`pay-summary-item ${remaining > 0 ? "neg-text" : "net-text"}`}>
                        {remaining > 0 ? `尚欠 NT$${Math.round(remaining).toLocaleString()}` : "✓ 已結清"}
                      </span>
                    </div>
                    <button className="btn-record-payment" onClick={() => openPaymentModal(order)}>
                      💳 記錄收款
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Shipping Modal */}
      {showShippingCalc && (
        <div className="modal-overlay" onClick={() => setShowShippingCalc(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>⚖️ 運費分攤計算</h2><button className="modal-close" onClick={() => setShowShippingCalc(false)}>✕</button></div>
            <div className="shipping-calc">
              <div className="calc-summary">
                <div>國際運費：<strong>¥{Number(batch.total_intl_shipping_jpy).toLocaleString()} × {jpyRate} = NT${Math.round(batch.total_intl_shipping_jpy * jpyRate).toLocaleString()}</strong></div>
                <div>總重量（排除未搶到）：<strong>{totalWeightG}g</strong></div>
              </div>
              <table className="calc-table">
                <thead><tr><th>客人</th><th>重量(g)</th><th>佔比</th><th>應付運費(NT$)</th></tr></thead>
                <tbody>
                  {orders.map(o => {
                    const w = (o.order_items || []).filter(i => !i.not_obtained).reduce((s, i) => s + Number(i.weight_g || 0), 0);
                    const ratio = totalWeightG > 0 ? (w / totalWeightG * 100).toFixed(1) : 0;
                    return <tr key={o.id}><td>{o.customer}</td><td className="center">{w}g</td><td className="center">{ratio}%</td><td className="number">NT${Math.round(shippingPerOrder[o.id] || 0).toLocaleString()}</td></tr>;
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

      {/* Payment Modal */}
      {showPaymentModal && paymentOrder && (
        <div className="modal-overlay" onClick={() => setShowPaymentModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>💳 收款記錄　<span style={{color:"var(--accent)"}}>{paymentOrder.customer}</span></h2>
              <button className="modal-close" onClick={() => setShowPaymentModal(false)}>✕</button>
            </div>
            {/* Due summary */}
            <div className="payment-due-summary">
              {(() => {
                const due = orderTotalDue(paymentOrder);
                const paid = paymentRecords.reduce((s, p) => s + Number(p.amount), 0);
                const rem = due - paid;
                return <>
                  <div className="due-row"><span>應收總計</span><strong>NT${due.toLocaleString()}</strong></div>
                  <div className="due-row"><span>已收</span><strong className="net-text">NT${Math.round(paid).toLocaleString()}</strong></div>
                  <div className={`due-row ${rem > 0 ? "neg-text" : "net-text"}`}><span>尚欠</span><strong>{rem > 0 ? `NT$${Math.round(rem).toLocaleString()}` : "✓ 已結清"}</strong></div>
                </>;
              })()}
            </div>
            {/* Existing records */}
            {paymentRecords.length > 0 && (
              <div className="payment-records-list">
                {paymentRecords.map(p => (
                  <div key={p.id} className="payment-record-row">
                    <span className="pr-date">{p.paid_at}</span>
                    <span className="pr-note">{p.note || "—"}</span>
                    <span className="pr-amount net-text">NT${Number(p.amount).toLocaleString()}</span>
                    <button className="btn-danger-sm" onClick={() => deletePaymentRecord(p.id)}>刪除</button>
                  </div>
                ))}
              </div>
            )}
            {/* Add new record */}
            <div className="payment-add-row">
              <input className="form-input" type="number" placeholder="金額" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} style={{width:"120px"}} />
              <input className="form-input" placeholder="備註（選填）" value={paymentNote} onChange={e => setPaymentNote(e.target.value)} style={{flex:1}} />
              <button className="btn-primary" onClick={addPaymentRecord} disabled={savingPayment}>{savingPayment ? "..." : "記錄"}</button>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowPaymentModal(false)}>關閉</button>
            </div>
          </div>
        </div>
      )}

      {/* Order Form Modal */}
      {showOrderForm && (
        <div className="modal-overlay" onClick={() => setShowOrderForm(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingOrder ? "編輯訂單" : "新增訂單"}</h2>
              <button className="modal-close" onClick={() => setShowOrderForm(false)}>✕</button>
            </div>
            <div className="form-grid">
              <label className="form-label">客人名稱 / ID
                <input className="form-input" placeholder="例：小花、IG@xxx" value={form.customer} onChange={e => setFormField("customer", e.target.value)} />
              </label>
              <label className="form-label">付款方式
                <select className="form-input" value={form.payment_method} onChange={e => setFormField("payment_method", e.target.value)}>
                  {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
                </select>
              </label>
              <label className="form-label" style={{gridColumn:"1/-1"}}>備註
                <input className="form-input" placeholder="特殊說明、取付地點等" value={form.note} onChange={e => setFormField("note", e.target.value)} />
              </label>
            </div>
            <div className="items-section">
              <div className="items-header">
                <h3>商品明細</h3>
                <button className="btn-add-item" onClick={addItem}>＋ 新增商品</button>
              </div>
              {form.items.map((item, idx) => (
                <div key={idx} className={`item-row ${item.not_obtained ? "item-not-obtained" : ""}`}>
                  <input className="form-input item-name" placeholder="商品名稱" value={item.name} onChange={e => setItem(idx, "name", e.target.value)} />
                  <input className="form-input" style={{width:"60px"}} type="number" min="1" placeholder="數量" value={item.quantity} onChange={e => setItem(idx, "quantity", e.target.value)} />
                  <div className="item-price-wrap">
                    <span className="item-prefix">¥</span>
                    <input className="form-input item-price" type="number" placeholder="日幣單價" value={item.jpy_price} onChange={e => setItem(idx, "jpy_price", e.target.value)} />
                  </div>
                  <div className="item-weight-wrap">
                    <input className="form-input item-weight" type="number" placeholder="重量" value={item.weight_g} onChange={e => setItem(idx, "weight_g", e.target.value)} />
                    <span className="item-suffix">g</span>
                  </div>
                  <label className="not-obtained-check">
                    <input type="checkbox" checked={item.not_obtained || false} onChange={e => setItem(idx, "not_obtained", e.target.checked)} />
                    未搶到
                  </label>
                  {form.items.length > 1 && <button className="btn-remove-item" onClick={() => removeItem(idx)}>✕</button>}
                </div>
              ))}
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
