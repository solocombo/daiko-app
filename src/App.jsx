import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import BatchList from "./components/BatchList";
import BatchDetail from "./components/BatchDetail";
import CustomerView from "./components/CustomerView";
import ProfitDashboard from "./components/ProfitDashboard";
import "./App.css";

export default function App() {
  const [page, setPage] = useState("batches"); // batches | batch-detail | customers | profit
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [batches, setBatches] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    setLoading(true);
    const [{ data: b }, { data: o }] = await Promise.all([
      supabase.from("batches").select("*").order("created_at", { ascending: false }),
      supabase.from("orders").select("*, order_items(*)").order("created_at", { ascending: false }),
    ]);
    setBatches(b || []);
    setOrders(o || []);
    setLoading(false);
  }

  const nav = (p, batch = null) => {
    setPage(p);
    if (batch) setSelectedBatch(batch);
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-jp">代購</span>
            <span className="logo-en">DAIKO</span>
            <span className="logo-sub">管理系統</span>
          </div>
          <nav className="nav">
            <button className={`nav-btn ${page === "batches" || page === "batch-detail" ? "active" : ""}`} onClick={() => nav("batches")}>
              <span className="nav-icon">📦</span>批次管理
            </button>
            <button className={`nav-btn ${page === "customers" ? "active" : ""}`} onClick={() => nav("customers")}>
              <span className="nav-icon">👤</span>客人追蹤
            </button>
            <button className={`nav-btn ${page === "profit" ? "active" : ""}`} onClick={() => nav("profit")}>
              <span className="nav-icon">💴</span>利潤總覽
            </button>
          </nav>
        </div>
      </header>

      <main className="main">
        {loading ? (
          <div className="loading">
            <div className="loading-spinner" />
            <p>載入中...</p>
          </div>
        ) : (
          <>
            {page === "batches" && (
              <BatchList
                batches={batches}
                orders={orders}
                onRefresh={fetchAll}
                onSelectBatch={(b) => nav("batch-detail", b)}
              />
            )}
            {page === "batch-detail" && selectedBatch && (
              <BatchDetail
                batch={selectedBatch}
                orders={orders.filter((o) => o.batch_id === selectedBatch.id)}
                allOrders={orders}
                onRefresh={fetchAll}
                onBack={() => nav("batches")}
              />
            )}
            {page === "customers" && (
              <CustomerView orders={orders} batches={batches} onRefresh={fetchAll} />
            )}
            {page === "profit" && (
              <ProfitDashboard batches={batches} orders={orders} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
