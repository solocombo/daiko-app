import { useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

export default function CustomerView({ orders, batches, onRefresh }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | unpaid | done

  const customerMap = useMemo(() => {
    const map = {};
    orders.forEach((o) => {
      if (!map[o.customer]) map[o.customer] = [];
      map[o.customer].push(o);
    });
    return map;
  }, [orders]);

  const customers = useMemo(() => {
    return Object.entries(customerMap)
      .map(([name, customerOrders]) => {
        const totalProductTwd = customerOrders.reduce((s, o) =>
          s + (o.order_items || []).reduce((ss, i) => ss + Number(i.jpy_price || 0), 0) * 0.25, 0);
        const totalShippingTwd = customerOrders.reduce((s, o) => s + Number(o.shipping_twd || 0), 0);
        const unpaidProductCount = customerOrders.filter(o => !o.product_paid).length;
        const unpaidShippingAmount = customerOrders.filter(o => !o.shipping_paid && o.shipping_twd > 0).reduce((s, o) => s + Number(o.shipping_twd), 0);
        const totalOwed = (unpaidProductCount > 0 ? customerOrders.filter(o => !o.product_paid).reduce((s, o) =>
          s + (o.order_items || []).reduce((ss, i) => ss + Number(i.jpy_price || 0), 0) * 0.25, 0) : 0) + unpaidShippingAmount;
        return { name, orders: customerOrders, totalProductTwd, totalShippingTwd, unpaidProductCount, unpaidShippingAmount, totalOwed };
      })
      .filter(c => {
        if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
        if (filter === "unpaid") return c.totalOwed > 0;
        if (filter === "done") return c.totalOwed === 0;
        return true;
      })
      .sort((a, b) => b.totalOwed - a.totalOwed);
  }, [customerMap, search, filter]);

  const getBatchName = (batchId) => batches.find(b => b.id === batchId)?.name || "未知批次";

  async function togglePayment(order, field) {
    await supabase.from("orders").update({ [field]: !order[field] }).eq("id", order.id);
    onRefresh();
  }

  const totalUnpaid = customers.reduce((s, c) => s + c.totalOwed, 0);

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
        <div className="empty-state">
          <div className="empty-icon">👤</div>
          <p>沒有符合條件的客人</p>
        </div>
      ) : (
        <div className="customer-list">
          {customers.map(({ name, orders: cOrders, totalOwed, unpaidProductCount, unpaidShippingAmount }) => (
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
                        {unpaidProductCount > 0 && <span className="owed-tag product">商品款 {unpaidProductCount} 筆</span>}
                        {unpaidShippingAmount > 0 && <span className="owed-tag shipping">運費 NT${Math.round(unpaidShippingAmount).toLocaleString()}</span>}
                      </div>
                    </div>
                  ) : (
                    <span className="all-paid">✓ 全額清款</span>
                  )}
                </div>
              </summary>

              <div className="customer-orders">
                {cOrders.map((order) => {
                  const productTwd = (order.order_items || []).reduce((s, i) => s + Number(i.jpy_price || 0), 0) * 0.25;
                  return (
                    <div key={order.id} className={`customer-order-row ${order.product_paid && (order.shipping_twd === 0 || order.shipping_paid) ? "order-done" : ""}`}>
                      <div className="order-batch-tag">{getBatchName(order.batch_id)}</div>
                      <div className="order-items-mini">
                        {(order.order_items || []).map((i, idx) => (
                          <span key={idx} className="item-chip">{i.name} ¥{Number(i.jpy_price).toLocaleString()}</span>
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
                            <span className="pay-label">運費尾款 NT${Math.round(order.shipping_twd).toLocaleString()}</span>
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
    </div>
  );
}
