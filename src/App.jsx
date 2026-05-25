import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import BatchList from "./components/BatchList";
import BatchDetail from "./components/BatchDetail";
import CustomerView from "./components/CustomerView";
import ProfitDashboard from "./components/ProfitDashboard";
import Settings from "./components/Settings";
import "./App.css";

const SETTINGS_KEY = "daiko_settings";
const DEFAULT_SETTINGS = { proxy_rate: 0.25 };

export default function App() {
  const [page, setPage] = useState("batches");
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [batches, setBatches] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(() => {
    try {
      const s = localStorage.getItem(SETTINGS_KEY);
      return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : DEFAULT_SETTINGS;
    } catch { return DEFAULT_SETTINGS; }
  });

  useEffect(() => {
    fetchAll();
  }, []);

  function saveSettings(newSettings) {
    setSettings(newSettings);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
  }

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
            <button className={`nav-btn ${page === "settings" ? "active" : ""}`} onClick={() => nav("settings")}>
              <span className="nav-icon">⚙️</span>系統設定
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
              <BatchList batches={batches} orders={orders} onRefresh={fetchAll} onSelectBatch={(b) => nav("batch-detail", b)} settings={settings} />
            )}
            {page === "batch-detail" && selectedBatch && (
              <BatchDetail
                batch={selectedBatch}
                orders={orders.filter((o) => o.batch_id === selectedBatch.id)}
                onRefresh={fetchAll}
                onBack={() => nav("batches")}
                settings={settings}
              />
            )}
            {page === "customers" && (
              <CustomerView orders={orders} batches={batches} onRefresh={fetchAll} settings={settings} />
            )}
            {page === "profit" && (
              <ProfitDashboard batches={batches} orders={orders} settings={settings} />
            )}
            {page === "settings" && (
              <Settings settings={settings} onSave={saveSettings} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
