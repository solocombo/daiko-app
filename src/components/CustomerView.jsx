import { useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

// calc helper (same logic as BatchDetail)
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
  return { qty, jpyUnit, jpyTotal, costTwd, ccFee, ccRebate, realCost, unitPrice, totalPrice };
}

export default function CustomerView({ orders, batches, onRefresh, settings }) {
  const proxyRate = settings?.proxy_rate || 0.25;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [showShipping, setShowShipping] = useState(false);
  const [shippingCustomer, setShippingCustomer] = useState(null);
  const [shippingCustomerOrders, setShippingCustomerOrders] = useState([]);
  const [selectedItems, setSelectedItems] = useState({});
  const [packFee, setPackFee] = useState(12);
  const [packMaterial, setPackMaterial] = useState(2);

  // Build customer map
  const customerMap = useMemo(() => {
    const map = {};
    orders.forEach((o) => {
      if (!map[o.customer]) map[o.customer] = [];
      map[o.customer].push(o);
    });
    return map;
  }, [orders]);

  const getBatchRate = (batchId) => {
    const b = batches.find(b => b.id === batchId);
    return b?.jpy_rate || 0.21;
  };

  const customers = useMemo(() => {
    return Object.entries(customerMap)
      .map(([name, customerOrders]) => {
        const unpaidProductOrders = customerOrders.filter(o => !o.product_paid);
        const unpaidProductAmt = unpaidProductOrders.reduce((s, o) => {
          const rate = getBatchRate(o.batch_id);
          return s + (o.order_items || []).filter(i => !i.not_obtained).reduce((ss, i) => ss + calcItem(i, rate, proxyRate).totalPrice, 0);
        }, 0);
        const unpaidShippingAmt = customerOrders.filter(o => !o.shipping_paid && o.shipping_twd > 0).reduce((s, o) => s + Number(o.shipping_twd), 0);
        const totalOwed = unpaidProductAmt + unpaidShippingAmt;
        return { name, orders: customerOrders, totalOwed, unpaidProductAmt, unpaidShippingAmt };
      })
      .filter(c => {
        if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
        if (filter === "unpaid") return c.totalOwed > 0;
        if (filter === "done") return c.totalOwed === 0;
        return true;
      })
      .sort((a, b) => b.totalOwed - a.totalOwed);
  }, [customerMap, search, filter, batches, proxyRate]);

  const totalUnpaid = customers.reduce((s, c) => s + c.totalOwed, 0);
  const getBatchName = (batchId) => batches.find(b => b.id === batchId)?.name || "未知批次";

  async function togglePayment(order, field) {
    await supabase.from("orders").update({ [field]: !order[field] }).eq("id", order.id);
    onRefresh();
  }

  // ── Shipping list ─────────────────────────────────────────────────────────
  function openShipping(name, cOrders) {
    setShippingCustomer(name);
    setShippingCustomerOrders(cOrders);
    // Pre-select all non-obtained items
    const sel = {};
    cOrders.forEach(o => {
      (o.order_items || []).filter(i => !i.not_obtained).forEach(i => { sel[i.id] = true; });
    });
    setSelectedItems(sel);
    setShowShipping(true);
  }

  function toggleItem(itemId) {
    setSelectedItems(s => ({ ...s, [itemId]: !s[itemId] }));
  }

  // Calculate shipping list totals
  const shippingCalc = useMemo(() => {
    if (!shippingCustomerOrders.length) return { items: [], subtotal: 0, total: 0 };
    const items = [];
    shippingCustomerOrders.forEach(o => {
      const rate = getBatchRate(o.batch_id);
      (o.order_items || []).filter(i => !i.not_obtained && selectedItems[i.id]).forEach(i => {
        const c = calcItem(i, rate, proxyRate);
        items.push({ ...i, orderId: o.id, batchName: getBatchName(o.batch_id), unitPrice: c.unitPrice, totalPrice: c.totalPrice, qty: c.qty });
      });
    });
    const subtotal = items.reduce((s, i) => s + i.totalPrice, 0);
    // Include shipping for orders that have selected items
    const orderIds = [...new Set(items.map(i => i.orderId))];
    const shippingTotal = shippingCustomerOrders
      .filter(o => orderIds.includes(o.id) && o.shipping_twd > 0)
      .reduce((s, o) => s + Number(o.shipping_twd), 0);
    const total = subtotal + shippingTotal + Number(packFee || 0);
    return { items, subtotal, shippingTotal, total };
  }, [shippingCustomerOrders, selectedItems, packFee, batches, proxyRate]);

  // Get note and payment method from first order
  const shippingNote = shippingCustomerOrders[0]?.note || "";
  const shippingPayMethod = shippingCustomerOrders[0]?.payment_method || "";
  const shippingTwd = shippingCustomerOrders
    .filter(o => (o.order_items || []).some(i => selectedItems[i.id]))
    .reduce((s, o) => s + Number(o.shipping_twd || 0), 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">客人追蹤</h1>
          <p className="page-sub">追蹤每位客人的付款狀態</p>
        </div>
        {totalUnpaid > 0 && (
          <div className="unpaid-banner">
            <span className="unpaid-label">待收款總計</span>
            <span className="unpaid-amount">NT${Math.round(totalUnpaid).toLocaleString()}</span>
          </div>
        )}
      </div>

      <div className="filter-bar">
        <input className="search-input" placeholder="🔍 搜尋客人名稱..." value={search} onChange={e => setSearch(e.target.value)} />
        <div className="filter-tabs">
          <button className={`filter-tab ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>全部</button>
          <button className={`filter-tab ${filter === "unpaid" ? "active" : ""}`} onClick={() => setFilter("unpaid")}>待付款</button>
          <button className={`filter-tab ${filter === "done" ? "active" : ""}`} onClick={() => setFilter("done")}>已完成</button>
        </div>
      </div>

      {customers.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">👤</div><p>沒有符合條件的客人</p></div>
      ) : (
        <div className="customer-list">
          {customers.map(({ name, orders: cOrders, totalOwed, unpaidProductAmt, unpaidShippingAmt }) => (
            <details key={name} className="customer-card">
              <summary className="customer-summary">
                <div className="customer-info">
                  <span className="customer-avatar">{name[0]?.toUpperCase()}</span>
                  <div>
                    <div className="customer-name-lg">{name}</div>
                    <div className="customer-meta">{cOrders.length} 筆訂單</div>
                  </div>
                </div>
                <div className="customer-owed">
                  {totalOwed > 0 ? (
                    <div>
                      <div className="owed-amount">待付 NT${Math.round(totalOwed).toLocaleString()}</div>
                      <div className="owed-breakdown">
                        {unpaidProductAmt > 0 && <span className="owed-tag product">商品款 NT${Math.round(unpaidProductAmt).toLocaleString()}</span>}
                        {unpaidShippingAmt > 0 && <span className="owed-tag shipping">運費 NT${Math.round(unpaidShippingAmt).toLocaleString()}</span>}
                      </div>
                    </div>
                  ) : (
                    <span className="all-paid">✓ 全額清款</span>
                  )}
                </div>
              </summary>

              <div className="customer-orders">
                <div className="customer-actions">
                  <button className="btn-shipping-list" onClick={(e) => { e.stopPropagation(); openShipping(name, cOrders); }}>
                    📦 產生出貨清單
                  </button>
                </div>
                {cOrders.map((order) => {
                  const rate = getBatchRate(order.batch_id);
                  const productTwd = (order.order_items || []).filter(i => !i.not_obtained).reduce((s, i) => s + calcItem(i, rate, proxyRate).totalPrice, 0);
                  return (
                    <div key={order.id} className={`customer-order-row ${order.product_paid && (order.shipping_twd === 0 || order.shipping_paid) ? "order-done" : ""}`}>
                      <div className="order-batch-tag">{getBatchName(order.batch_id)}</div>
                      <div className="order-items-mini">
                        {(order.order_items || []).map((i, idx) => (
                          <span key={idx} className={`item-chip ${i.not_obtained ? "item-chip-grey" : ""}`}>
                            {i.name} {i.not_obtained ? "（未搶到）" : `¥${Number(i.jpy_price).toLocaleString()}`}
                          </span>
                        ))}
                      </div>
                      <div className="order-pay-row">
                        <div className="pay-group">
                          <span className="pay-label">商品款 NT${Math.round(productTwd).toLocaleString()}</span>
                          <button className={`pay-btn ${order.product_paid ? "paid" : "unpaid"}`} onClick={() => togglePayment(order, "product_paid")}>
                            {order.product_paid ? "✓ 已付" : "未付"}
                          </button>
                        </div>
                        {order.shipping_twd > 0 && (
                          <div className="pay-group">
                            <span className="pay-label">運費 NT${Math.round(order.shipping_twd).toLocaleString()}</span>
                            <button className={`pay-btn ${order.shipping_paid ? "paid" : "unpaid"}`} onClick={() => togglePayment(order, "shipping_paid")}>
                              {order.shipping_paid ? "✓ 已付" : "未付"}
                            </button>
                          </div>
                        )}
                        <span className={`method-tag ${order.payment_method === "取付" ? "method-cod" : ""}`}>{order.payment_method}</span>
                      </div>
                      {order.note && <div className="order-note">📝 {order.note}</div>}
                    </div>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
      )}

      {/* Shipping List Modal */}
      {showShipping && (
        <div className="modal-overlay" onClick={() => setShowShipping(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>📦 出貨清單　<span style={{color:"var(--accent)", fontWeight:700}}>{shippingCustomer}</span></h2>
              <button className="modal-close" onClick={() => setShowShipping(false)}>✕</button>
            </div>

            {/* Pack fee settings */}
            <div className="shipping-settings">
              <label className="shipping-fee-label">
                包手費 NT$
                <input className="form-input shipping-fee-input" type="number" value={packFee} onChange={e => setPackFee(e.target.value)} />
              </label>
              <label className="shipping-fee-label">
                包材成本 NT$（僅計入成本，不向客人收）
                <input className="form-input shipping-fee-input" type="number" value={packMaterial} onChange={e => setPackMaterial(e.target.value)} />
              </label>
            </div>

            {/* Item selection */}
            <div className="shipping-items-section">
              <h3 className="shipping-section-title">勾選要出貨的商品</h3>
              {shippingCustomerOrders.map(o => (
                <div key={o.id} className="shipping-order-group">
                  <div className="shipping-batch-label">{getBatchName(o.batch_id)}</div>
                  {(o.order_items || []).filter(i => !i.not_obtained).map(item => {
                    const rate = getBatchRate(o.batch_id);
                    const c = calcItem(item, rate, proxyRate);
                    return (
                      <label key={item.id} className="shipping-item-check">
                        <input type="checkbox" checked={!!selectedItems[item.id]} onChange={() => toggleItem(item.id)} />
                        <span className="shipping-item-name">{item.name}</span>
                        <span className="shipping-item-qty">× {c.qty}</span>
                        <span className="shipping-item-price twd-text">NT${c.totalPrice.toLocaleString()}</span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Preview */}
            <div className="shipping-preview">
              <h3 className="shipping-section-title">出貨單預覽</h3>
              <div className="shipping-preview-card">
                <div className="sp-row sp-header">
                  <span>客人：{shippingCustomer}</span>
                  <span className={`method-tag ${shippingPayMethod === "取付" ? "method-cod" : ""}`}>{shippingPayMethod}</span>
                </div>
                {shippingNote && <div className="sp-row"><span className="sp-label">備註</span><span>{shippingNote}</span></div>}
                <div className="sp-divider" />
                {shippingCalc.items.map((item, idx) => (
                  <div key={idx} className="sp-row">
                    <span>{item.name} × {item.qty}</span>
                    <span className="twd-text">NT${item.totalPrice.toLocaleString()}</span>
                  </div>
                ))}
                {shippingCalc.items.length === 0 && <div className="sp-row sp-empty">請勾選商品</div>}
                <div className="sp-divider" />
                <div className="sp-row"><span className="sp-label">商品小計</span><span>NT${shippingCalc.subtotal.toLocaleString()}</span></div>
                {shippingTwd > 0 && <div className="sp-row"><span className="sp-label">運費尾款</span><span>NT${Math.round(shippingTwd).toLocaleString()}</span></div>}
                <div className="sp-row"><span className="sp-label">包手費</span><span>NT${Number(packFee).toLocaleString()}</span></div>
                <div className="sp-divider" />
                <div className="sp-row sp-total">
                  <span>應收總計</span>
                  <span>NT${Math.round(shippingCalc.subtotal + shippingTwd + Number(packFee || 0)).toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowShipping(false)}>關閉</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
