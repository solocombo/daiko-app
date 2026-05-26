import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import BatchList from "./components/BatchList";
import BatchDetail from "./components/BatchDetail";
import CustomerView from "./components/CustomerView";
import ProfitDashboard from "./components/ProfitDashboard";
import Settings from "./components/Settings";
import Forwarders from "./components/Forwarders";
import Shops from "./components/Shops";
import Credits from "./components/Credits";
import Inventory from "./components/Inventory";
import "./App.css";

const SETTINGS_KEY = "daiko_settings";
const THEME_KEY = "daiko_theme";
const DEFAULT_SETTINGS = { proxy_rate: 0.25, member1: "成員A", member2: "成員B" };

export default function App() {
  const [page, setPage] = useState("batches");
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [batches, setBatches] = useState([]);
  const [orders, setOrders] = useState([]);
  const [forwarders, setForwarders] = useState([]);
  const [shops, setShops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isLight, setIsLight] = useState(() => localStorage.getItem(THEME_KEY) === "light");
  const [settings, setSettings] = useState(() => {
    try {
      const s = localStorage.getItem(SETTINGS_KEY);
      return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : DEFAULT_SETTINGS;
    } catch { return DEFAULT_SETTINGS; }
  });

  useEffect(() => { fetchAll(); }, []);

  useEffect(() => {
    document.documentElement.className = isLight ? "theme-light" : "";
    localStorage.setItem(THEME_KEY, isLight ? "light" : "dark");
  }, [isLight]);

  function saveSettings(s) { setSettings(s); localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

  async function fetchAll() {
    setLoading(true);
    const [{ data: b }, { data: o }, { data: f }, { data: sh }] = await Promise.all([
      supabase.from("batches").select("*").order("created_at", { ascending: false }),
      supabase.from("orders").select("*, order_items(*)").order("created_at", { ascending: false }),
      supabase.from("forwarders").select("*").order("name"),
      supabase.from("shops").select("*").order("name"),
    ]);
    setBatches(b || []); setOrders(o || []);
    setForwarders(f || []); setShops(sh || []);
    setLoading(false);
  }

  const nav = (p, batch = null) => { setPage(p); if (batch) setSelectedBatch(batch); };
  const selectedBatchLatest = selectedBatch ? (batches.find(b => b.id === selectedBatch.id) || selectedBatch) : null;

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
            <button className={`nav-btn ${page === "batches" || page === "batch-detail" ? "active" : ""}`} onClick={() => nav("batches")}><span className="nav-icon">📦</span>批次管理</button>
            <button className={`nav-btn ${page === "customers" ? "active" : ""}`} onClick={() => nav("customers")}><span className="nav-icon">👤</span>客人追蹤</button>
            <button className={`nav-btn ${page === "profit" ? "active" : ""}`} onClick={() => nav("profit")}><span className="nav-icon">💴</span>提款記錄</button>
            <button className={`nav-btn ${page === "credits" ? "active" : ""}`} onClick={() => nav("credits")}><span className="nav-icon">💳</span>儲值清單</button>
            <button className={`nav-btn ${page === "inventory" ? "active" : ""}`} onClick={() => nav("inventory")}><span className="nav-icon">🏪</span>庫存管理</button>
            <button className={`nav-btn ${page === "forwarders" ? "active" : ""}`} onClick={() => nav("forwarders")}><span className="nav-icon">🚚</span>集運商</button>
            <button className={`nav-btn ${page === "shops" ? "active" : ""}`} onClick={() => nav("shops")}><span className="nav-icon">🛍️</span>購物網站</button>
            <button className={`nav-btn ${page === "settings" ? "active" : ""}`} onClick={() => nav("settings")}><span className="nav-icon">⚙️</span>系統設定</button>
          </nav>
          {/* Theme toggle */}
          <div className="theme-toggle" onClick={() => setIsLight(v => !v)}>
            <div className={`theme-toggle-track ${isLight ? "on" : ""}`}>
              <div className="theme-toggle-thumb" />
            </div>
            <span className="theme-toggle-label">{isLight ? "☀️" : "🌙"}</span>
          </div>
        </div>
      </header>

      <main className="main">
        {loading ? (
          <div className="loading"><div className="loading-spinner" /><p>載入中...</p></div>
        ) : (
          <>
            {page === "batches" && <BatchList batches={batches} orders={orders} onRefresh={fetchAll} onSelectBatch={(b) => nav("batch-detail", b)} settings={settings} />}
            {page === "batch-detail" && selectedBatchLatest && (
              <BatchDetail
                batch={selectedBatchLatest}
                orders={orders.filter(o => o.batch_id === selectedBatchLatest.id)}
                forwarders={forwarders} shops={shops}
                onRefresh={fetchAll} onBack={() => nav("batches")}
                settings={settings}
                onGoForwarders={() => nav("forwarders")}
                onGoShops={() => nav("shops")}
              />
            )}
            {page === "customers" && <CustomerView orders={orders} batches={batches} onRefresh={fetchAll} settings={settings} />}
            {page === "profit" && <ProfitDashboard batches={batches} orders={orders} settings={settings} />}
            {page === "credits" && <Credits />}
            {page === "inventory" && <Inventory shops={shops} />}
            {page === "forwarders" && <Forwarders forwarders={forwarders} onRefresh={fetchAll} />}
            {page === "shops" && <Shops shops={shops} onRefresh={fetchAll} />}
            {page === "settings" && <Settings settings={settings} onSave={saveSettings} />}
          </>
        )}
      </main>
    </div>
  );
}
