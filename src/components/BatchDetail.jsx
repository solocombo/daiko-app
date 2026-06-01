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
  // Use custom_unit_price override if set, otherwise calculate
  const unitPrice = item.custom_unit_price != null
    ? Number(item.custom_unit_price)
    : ceilTo10(jpyUnit * proxyRate);
  const totalPrice = unitPrice * qty;
  const profit = totalPrice - realCost;
  return { qty, jpyUnit, jpyTotal, costTwd, ccFee, ccRebate, realCost, unitPrice, totalPrice, profit, isCustomPrice: item.custom_unit_price != null };
}

const SKIP_PROFIT_KEYWORDS = ["現貨"];

const TODAY = new Date().toISOString().split("T")[0];

export default function BatchDetail({ batch, orders, forwarders, shops, onRefresh, onBack, settings, onGoForwarders, onGoShops }) {
  const proxyRate = settings?.proxy_rate || 0.25;
  const jpyRate = batch.jpy_rate;
  const shippingRate = batch.shipping_rate || batch.jpy_rate;
  // Customers whose orders don't count toward profit
  const skipProfitCustomers = new Set([
    "現貨",
    ...(settings?.member1 ? [settings.member1] : []),
    ...(settings?.member2 ? [settings.member2] : []),
  ]);

  // ── Batch edit state ──────────────────────────────────────────────────────
  const [showBatchEdit, setShowBatchEdit] = useState(false);
  const [batchForm, setBatchForm] = useState({});
  const [savingBatch, setSavingBatch] = useState(false);
  const [fetchingRate, setFetchingRate] = useState(false);

  function openBatchEdit() {
    setBatchForm({
      name: batch.name,
      date: batch.date,
      jpy_rate: batch.jpy_rate,
      shipping_rate: batch.shipping_rate || batch.jpy_rate,
      total_intl_shipping_jpy: batch.total_intl_shipping_jpy || 0,
      absorbed_shipping_twd: batch.absorbed_shipping_twd || 0,
      shop_id: batch.shop_id || "",
      note: batch.note || "",
    });
    setShowBatchEdit(true);
  }

  async function fetchRate(field) {
    setFetchingRate(field);
    const date = batchForm.date || new Date().toISOString().split("T")[0];
    const today = new Date().toISOString().split("T")[0];
    // Try multiple APIs as fallback
    const apis = [
      date >= today
        ? "https://api.frankfurter.app/latest?from=JPY&to=TWD"
        : `https://api.frankfurter.app/${date}?from=JPY&to=TWD`,
      "https://open.er-api.com/v6/latest/JPY",
      "https://api.exchangerate-api.com/v4/latest/JPY",
    ];
    for (const url of apis) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const data = await res.json();
        const rate = data.rates?.TWD;
        if (rate) {
          setBatchForm(f => ({ ...f, [field]: parseFloat(rate.toFixed(4)) }));
          setFetchingRate(null);
          return;
        }
      } catch { /* try next */ }
    }
    alert("無法自動抓取匯率，請手動輸入");
    setFetchingRate(null);
  }

  async function saveBatch() {
    if (!batchForm.name || !batchForm.date) return alert("請填寫批次名稱與日期");
    setSavingBatch(true);
    const intlShippingJpy = batchForm.intl_shipping_currency === "twd"
      ? 0
      : parseFloat(batchForm.total_intl_shipping_jpy) || 0;
    const intlShippingTwd = batchForm.intl_shipping_currency === "twd"
      ? parseFloat(batchForm.total_intl_shipping_twd) || 0
      : 0;
    await supabase.from("batches").update({
      name: batchForm.name,
      date: batchForm.date,
      jpy_rate: parseFloat(batchForm.jpy_rate),
      shipping_rate: parseFloat(batchForm.shipping_rate),
      total_intl_shipping_jpy: intlShippingJpy,
      total_intl_shipping_twd: intlShippingTwd,
      absorbed_shipping_twd: parseFloat(batchForm.absorbed_shipping_twd) || 0,
      shop_id: batchForm.shop_id || null,
      note: batchForm.note,
    }).eq("id", batch.id);
    setSavingBatch(false);
    setShowBatchEdit(false);
    onRefresh();
  }

  // ── Order state ───────────────────────────────────────────────────────────
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
  const [showSummary, setShowSummary] = useState(false);
  const [summaryPayments, setSummaryPayments] = useState({});
  const [showCardCharges, setShowCardCharges] = useState(false);
  const [cardCharges, setCardCharges] = useState([]);
  const [cardChargeForm, setCardChargeForm] = useState({ twd_amount: "", jpy_amount: "", category: "商品", note: "" });
  const [savingCharge, setSavingCharge] = useState(false);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [dragCol, setDragCol] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

  const COLS_KEY = "daiko_col_order";
  const DEFAULT_COLS = ["ops","customer","items","shop","qty","jpyPrice","cost","fee","rebate","realCost","unitPrice","totalPrice","profit","weight","forwarder","shipping","payMethod","due","paid","remaining"];
  const [colOrder, setColOrder] = useState(() => {
    try { const s = localStorage.getItem(COLS_KEY); return s ? JSON.parse(s) : DEFAULT_COLS; }
    catch { return DEFAULT_COLS; }
  });
  function saveColOrder(order) { setColOrder(order); localStorage.setItem(COLS_KEY, JSON.stringify(order)); }

  const COL_LABELS = {
    ops: "操作", customer: "客人", items: "商品", shop: "購買網站",
    qty: "數量", jpyPrice: "日幣單價", cost: "成本", fee: "手續費",
    rebate: "回饋", realCost: "實際成本", unitPrice: "單件定價",
    totalPrice: "定價合計", profit: "利潤", weight: "重量",
    forwarder: "集運商", shipping: "運費尾款", payMethod: "付款方式",
    due: "應收", paid: "已付", remaining: "尚欠",
  };

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  }
  function handleDragStart(col) { setDragCol(col); }
  function handleDragOver(col) { setDragOverCol(col); }
  function handleDrop(col) {
    if (!dragCol || dragCol === col) { setDragCol(null); setDragOverCol(null); return; }
    const newOrder = [...colOrder];
    const fromIdx = newOrder.indexOf(dragCol);
    const toIdx = newOrder.indexOf(col);
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, dragCol);
    saveColOrder(newOrder);
    setDragCol(null); setDragOverCol(null);
  }

  const defaultShopId = batch.shop_id || "";
  const emptyForm = { customer: "", payment_method: "虛擬帳戶轉帳", forwarder_id: "", items: [{ name: "", jpy_price: "", quantity: 1, weight_g: "", shop_id: defaultShopId }], note: "" };
  const [form, setForm] = useState(emptyForm);

  useEffect(() => { fetchAllPayments(); }, [orders]);
  useEffect(() => { fetchCardCharges(); }, [batch.id]);

  async function fetchCardCharges() {
    const { data } = await supabase.from("card_charges").select("*").eq("batch_id", batch.id).order("created_at");
    setCardCharges(data || []);
  }

  async function addCardCharge() {
    if (!cardChargeForm.twd_amount) return alert("請填寫台幣金額");
    setSavingCharge(true);
    await supabase.from("card_charges").insert([{
      batch_id: batch.id,
      twd_amount: parseFloat(cardChargeForm.twd_amount),
      jpy_amount: cardChargeForm.jpy_amount ? parseFloat(cardChargeForm.jpy_amount) : null,
      category: cardChargeForm.category,
      note: cardChargeForm.note,
    }]);
    setCardChargeForm({ twd_amount: "", jpy_amount: "", category: "商品", note: "" });
    setSavingCharge(false);
    fetchCardCharges();
  }

  async function deleteCardCharge(id) {
    if (!confirm("確定刪除這筆刷卡記錄？")) return;
    await supabase.from("card_charges").delete().eq("id", id);
    fetchCardCharges();
  }

  async function fetchAllPayments() {
    if (!orders.length) return;
    const ids = orders.map(o => o.id);
    const { data } = await supabase.from("payment_records").select("*").in("order_id", ids).order("created_at");
    const map = {};
    (data || []).forEach(p => { if (!map[p.order_id]) map[p.order_id] = []; map[p.order_id].push(p); });
    setAllPayments(map);
  }

  // ── Shipping ──────────────────────────────────────────────────────────────
  const totalWeightG = useMemo(() =>
    orders.reduce((sum, o) => sum + (o.order_items || []).filter(i => !i.not_obtained).reduce((s, i) => s + Number(i.weight_g || 0), 0), 0),
    [orders]);

  const shippingPerOrder = useMemo(() => {
    if (intlShippingTwd === 0 || totalWeightG === 0) return {};
    return orders.reduce((acc, o) => {
      const w = (o.order_items || []).filter(i => !i.not_obtained).reduce((s, i) => s + Number(i.weight_g || 0), 0);
      acc[o.id] = totalWeightG > 0 ? (w / totalWeightG) * intlShippingTwd : 0;
      return acc;
    }, {});
  }, [orders, batch, totalWeightG, intlShippingTwd]);

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
  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { name: "", jpy_price: "", quantity: 1, weight_g: "", shop_id: defaultShopId }] }));
  const removeItem = (idx) => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  function openEdit(order) {
    setEditingOrder(order);
    setForm({
      customer: order.customer,
      payment_method: order.payment_method || "虛擬帳戶轉帳",
      forwarder_id: order.forwarder_id || "",
      items: order.order_items?.map(i => ({
        name: i.name, jpy_price: i.jpy_price, quantity: i.quantity || 1,
        weight_g: i.weight_g, not_obtained: i.not_obtained || false,
        shop_id: i.shop_id || defaultShopId,
      })) || [{ name: "", jpy_price: "", quantity: 1, weight_g: "", shop_id: defaultShopId }],
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
          customer: form.customer, payment_method: form.payment_method,
          forwarder_id: form.forwarder_id || null, note: form.note,
        }).eq("id", orderId);
        await supabase.from("order_items").delete().eq("order_id", orderId);
      } else {
        const { data, error } = await supabase.from("orders").insert([{
          batch_id: batch.id, customer: form.customer, payment_method: form.payment_method,
          forwarder_id: form.forwarder_id || null,
          product_paid: false, shipping_paid: false, shipping_twd: 0, note: form.note,
        }]).select().single();
        if (error) throw error;
        orderId = data.id;
      }
      await supabase.from("order_items").insert(
        form.items.map(i => ({
          order_id: orderId, name: i.name, jpy_price: Number(i.jpy_price),
          quantity: Number(i.quantity) || 1, weight_g: Number(i.weight_g) || 0,
          not_obtained: i.not_obtained || false,
          shop_id: i.shop_id || null,
        }))
      );
      // Auto-add to inventory if customer is "現貨"
      if (form.customer === "現貨") {
        for (const item of form.items) {
          if (!item.name || !item.jpy_price) continue;
          // Check if already exists
          const { data: existing } = await supabase.from("inventory")
            .select("id").eq("name", item.name)
            .eq("note", `自動從批次「${batch.name}」匯入`).maybeSingle();
          if (existing) continue;
          const twdCost = Math.round(Number(item.jpy_price) * jpyRate);
          await supabase.from("inventory").insert([{
            name: item.name, jpy_cost: Number(item.jpy_price), twd_cost: twdCost,
            quantity: Number(item.quantity) || 1, sold: 0,
            shop_id: item.shop_id || null,
            note: `自動從批次「${batch.name}」匯入`, status: "庫存中",
          }]);
        }
      }
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
      order_id: paymentOrder.id, amount: Number(paymentAmount),
      note: paymentNote, paid_at: TODAY,
    }]);
    const { data } = await supabase.from("payment_records").select("*").eq("order_id", paymentOrder.id).order("created_at");
    setPaymentRecords(data || []);
    const totalPaid = (data || []).reduce((s, p) => s + Number(p.amount), 0);
    const due = orderTotalDue(paymentOrder);
    if (totalPaid >= due) {
      await supabase.from("orders").update({ product_paid: true, shipping_paid: true }).eq("id", paymentOrder.id);
    }
    // Handle overpayment -> store as credit
    if (totalPaid > due) {
      const excess = totalPaid - due;
      const { data: existing } = await supabase.from("customer_credits").select("*").eq("customer", paymentOrder.customer).single();
      if (existing) {
        await supabase.from("customer_credits").update({ balance: existing.balance + excess, updated_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        await supabase.from("customer_credits").insert([{ customer: paymentOrder.customer, balance: excess }]);
      }
    }
    setPaymentAmount(""); setPaymentNote("");
    setSavingPayment(false);
    fetchAllPayments(); onRefresh();
  }

  async function deletePaymentRecord(id) {
    if (!confirm("確定刪除這筆付款記錄？")) return;
    await supabase.from("payment_records").delete().eq("id", id);
    const { data } = await supabase.from("payment_records").select("*").eq("order_id", paymentOrder.id).order("created_at");
    setPaymentRecords(data || []);
    const totalPaid = (data || []).reduce((s, p) => s + Number(p.amount), 0);
    if (totalPaid < orderTotalDue(paymentOrder)) {
      await supabase.from("orders").update({ product_paid: false, shipping_paid: false }).eq("id", paymentOrder.id);
    }
    fetchAllPayments(); onRefresh();
  }

  // ── Domestic JP shipping state ───────────────────────────────────────────
  const [domesticShippings, setDomesticShippings] = useState([]);
  const [showDomesticShipping, setShowDomesticShipping] = useState(false);
  const [dsForm, setDsForm] = useState({ amount_jpy: "", note: "" });
  const [editingDs, setEditingDs] = useState(null);

  useEffect(() => { fetchDomesticShippings(); }, [batch.id]);

  async function fetchDomesticShippings() {
    const { data } = await supabase.from("domestic_shipping_jp").select("*").eq("batch_id", batch.id).order("created_at");
    setDomesticShippings(data || []);
  }

  async function saveDomesticShipping() {
    if (!dsForm.amount_jpy) return alert("請填寫日幣金額");
    if (editingDs) {
      await supabase.from("domestic_shipping_jp").update({ amount_jpy: parseFloat(dsForm.amount_jpy), note: dsForm.note }).eq("id", editingDs.id);
    } else {
      await supabase.from("domestic_shipping_jp").insert([{ batch_id: batch.id, amount_jpy: parseFloat(dsForm.amount_jpy), note: dsForm.note }]);
    }
    setDsForm({ amount_jpy: "", note: "" });
    setEditingDs(null);
    fetchDomesticShippings();
  }

  async function deleteDomesticShipping(id) {
    if (!confirm("確定刪除？")) return;
    await supabase.from("domestic_shipping_jp").delete().eq("id", id);
    fetchDomesticShippings();
  }

  // Total items per order (for domestic shipping split by item count)
  const totalItemCount = useMemo(() =>
    orders.reduce((sum, o) => sum + (o.order_items || []).filter(i => !i.not_obtained).reduce((s, i) => s + (Number(i.quantity) || 1), 0), 0),
    [orders]);

  const domesticShippingPerOrder = useMemo(() => {
    if (!domesticShippings.length || totalItemCount === 0) return {};
    const totalJpy = domesticShippings.reduce((s, d) => s + Number(d.amount_jpy), 0);
    const totalTwd = totalJpy * jpyRate;
    return orders.reduce((acc, o) => {
      const cnt = (o.order_items || []).filter(i => !i.not_obtained).reduce((s, i) => s + (Number(i.quantity) || 1), 0);
      acc[o.id] = totalItemCount > 0 ? (cnt / totalItemCount) * totalTwd : 0;
      return acc;
    }, {});
  }, [orders, domesticShippings, totalItemCount, jpyRate]);

  // ── Custom price editing - local state to avoid refresh on every keystroke ──
  const [customPrices, setCustomPrices] = useState({});

  // Init local state from orders
  useEffect(() => {
    const map = {};
    orders.forEach(o => (o.order_items || []).forEach(i => {
      if (i.custom_unit_price != null) map[i.id] = String(i.custom_unit_price);
    }));
    setCustomPrices(map);
  }, [orders]);

  function handleCustomPriceChange(itemId, value) {
    setCustomPrices(prev => ({ ...prev, [itemId]: value }));
  }

  async function handleCustomPriceBlur(itemId, value) {
    const parsed = value === "" ? null : parseFloat(value);
    if (isNaN(parsed) && value !== "") return; // invalid input, skip
    await supabase.from("order_items").update({ custom_unit_price: parsed }).eq("id", itemId);
    // Don't call onRefresh() - just update local state silently
  }

  // ── Payment record editing ────────────────────────────────────────────────
  const [editingPayment, setEditingPayment] = useState(null);
  const [editPaymentForm, setEditPaymentForm] = useState({ amount: "", note: "", paid_at: "" });

  function openEditPayment(p) {
    setEditingPayment(p);
    setEditPaymentForm({ amount: String(p.amount), note: p.note || "", paid_at: p.paid_at });
  }

  async function saveEditPayment() {
    await supabase.from("payment_records").update({
      amount: parseFloat(editPaymentForm.amount),
      note: editPaymentForm.note,
      paid_at: editPaymentForm.paid_at,
    }).eq("id", editingPayment.id);
    setEditingPayment(null);
    const { data } = await supabase.from("payment_records").select("*").eq("order_id", paymentOrder.id).order("created_at");
    setPaymentRecords(data || []);
    fetchAllPayments(); onRefresh();
  }

  // ── Card charge editing ───────────────────────────────────────────────────
  const [editingCharge, setEditingCharge] = useState(null);
  const [editChargeForm, setEditChargeForm] = useState({ twd_amount: "", jpy_amount: "", category: "", note: "" });

  function openEditCharge(c) {
    setEditingCharge(c);
    setEditChargeForm({ twd_amount: String(c.twd_amount), jpy_amount: c.jpy_amount ? String(c.jpy_amount) : "", category: c.category, note: c.note || "" });
  }

  async function saveEditCharge() {
    await supabase.from("card_charges").update({
      twd_amount: parseFloat(editChargeForm.twd_amount),
      jpy_amount: editChargeForm.jpy_amount ? parseFloat(editChargeForm.jpy_amount) : null,
      category: editChargeForm.category,
      note: editChargeForm.note,
    }).eq("id", editingCharge.id);
    setEditingCharge(null);
    fetchCardCharges();
  }

  // ── Profit (skip special customers) ───────────────────────────────────────
  const profit = useMemo(() => {
    let totalRealCost = 0, totalPrice = 0;
    orders.forEach(o => {
      if (skipProfitCustomers.has(o.customer)) return;
      (o.order_items || []).filter(i => !i.not_obtained).forEach(i => {
        const c = calcItem(i, jpyRate, proxyRate);
        totalRealCost += c.realCost; totalPrice += c.totalPrice;
      });
    });
    const absorbed = Number(batch.absorbed_shipping_twd) || 0;
    const net = totalPrice - totalRealCost - absorbed;
    return { totalRealCost, totalPrice, absorbed, net };
  }, [orders, batch, jpyRate, proxyRate, skipProfitCustomers]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getShopName = (id) => shops.find(s => s.id === id)?.name || "—";
  const getFwName = (id) => forwarders.find(f => f.id === id)?.name || "—";
  const batchShopName = getShopName(batch.shop_id);

  // ── Autocomplete: build item name->price map from all orders in this batch ──
  const itemSuggestions = useMemo(() => {
    const map = {};
    orders.forEach(o => (o.order_items || []).forEach(i => {
      if (i.name && i.jpy_price) map[i.name] = { jpy_price: i.jpy_price, weight_g: i.weight_g || "", shop_id: i.shop_id || "" };
    }));
    return map;
  }, [orders]);

  // ── Sync existing 現貨 orders to inventory ────────────────────────────────
  const [syncing, setSyncing] = useState(false);

  async function syncInventory() {
    const inventoryOrders = orders.filter(o => o.customer === "現貨");
    if (!inventoryOrders.length) return alert("這個批次沒有現貨訂單");
    setSyncing(true);
    let added = 0;
    for (const o of inventoryOrders) {
      for (const item of (o.order_items || [])) {
        if (!item.name || !item.jpy_price) continue;
        // Check if already exists (same name + same batch note)
        const { data: existing } = await supabase.from("inventory")
          .select("id").eq("name", item.name)
          .eq("note", `自動從批次「${batch.name}」匯入`).maybeSingle();
        if (existing) continue;
        const twdCost = Math.round(Number(item.jpy_price) * jpyRate);
        await supabase.from("inventory").insert([{
          name: item.name, jpy_cost: Number(item.jpy_price), twd_cost: twdCost,
          quantity: Number(item.quantity) || 1, sold: 0,
          shop_id: item.shop_id || null,
          note: `自動從批次「${batch.name}」匯入`, status: "庫存中",
        }]);
        added++;
      }
    }
    setSyncing(false);
    alert(`同步完成！新增了 ${added} 筆庫存${added === 0 ? "（可能都已存在）" : ""}`);
  }

  // ── CSV ───────────────────────────────────────────────────────────────────
  function exportBatchCSV() {
    const header = ["客人","商品","購買網站","數量","日幣單價","成本台幣","手續費","回饋","實際成本","單件定價","定價總計","利潤","重量","集運商","運費尾款","應收","已付","尚欠","付款方式","備註"];
    const rows = [header];
    orders.forEach(o => {
      const due = orderTotalDue(o);
      const paid = orderPaid(o.id);
      const fwName = getFwName(o.forwarder_id);
      const activeItems = (o.order_items || []).filter(i => !i.not_obtained);
      activeItems.forEach((item, idx) => {
        const c = calcItem(item, jpyRate, proxyRate);
        rows.push([
          idx === 0 ? o.customer : "", item.name, getShopName(item.shop_id),
          c.qty, c.jpyUnit, Math.round(c.costTwd), Math.round(c.ccFee), Math.round(c.ccRebate),
          Math.round(c.realCost), c.unitPrice, c.totalPrice, Math.round(c.profit), item.weight_g || 0,
          idx === 0 ? fwName : "",
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
          <div style={{display:"flex", alignItems:"center", gap:"10px", flexWrap:"wrap"}}>
            <h1 className="page-title">{batch.name}</h1>
            <button className="btn-edit-batch" onClick={openBatchEdit}>✏️ 編輯批次</button>
          </div>
          <p className="page-sub">
            {batch.date}　
            商品匯率 <strong>{jpyRate}</strong>　
            運費匯率 <strong>{shippingRate}</strong>　
            代購匯率 <strong>{proxyRate}</strong>　
            {batchShopName !== "—" && <>購買網站 <strong>{batchShopName}</strong>　</>}
            {domesticShippings.length > 0 && <>
              境內運費 <strong>¥{Math.round(domesticShippings.reduce((s,d)=>s+Number(d.amount_jpy),0)).toLocaleString()}</strong>（{domesticShippings.length}筆）　
            </>}
          </p>
        </div>
        <div className="header-actions">
          <button className="btn-summary" onClick={() => setShowSummary(true)}>📋 收款統計</button>
          <button className="btn-card-charge" onClick={syncInventory} disabled={syncing}>{syncing ? "同步中..." : "🏪 同步庫存"}</button>
          <button className="btn-card-charge" onClick={() => setShowDomesticShipping(true)}>🚚 境內運費</button>
          <button className="btn-card-charge" onClick={() => setShowCardCharges(true)}>💳 刷卡記錄</button>
          <button className="btn-export" onClick={exportBatchCSV}>⬇ 匯出 CSV</button>
          <button className="btn-secondary" onClick={() => setShowShippingCalc(true)}>⚖️ 運費分攤</button>
          <button className="btn-primary" onClick={() => { setEditingOrder(null); setForm({...emptyForm, items:[{name:"",jpy_price:"",quantity:1,weight_g:"",shop_id:defaultShopId}]}); setShowOrderForm(true); }}>＋ 新增訂單</button>
        </div>
      </div>

      {/* Profit Banner */}
      <div className="profit-banner">
        <div className="profit-item"><span className="profit-label">定價總收入</span><span className="profit-value twd">NT${Math.round(profit.totalPrice).toLocaleString()}</span></div>
        <div className="profit-item"><span className="profit-label">實際總成本</span><span className="profit-value neg">-NT${Math.round(profit.totalRealCost).toLocaleString()}</span></div>
        <div className="profit-item"><span className="profit-label">吸收運費</span><span className="profit-value neg">-NT${profit.absorbed.toLocaleString()}</span></div>
        <div className="profit-item highlight"><span className="profit-label">淨利</span><span className="profit-value net">NT${Math.round(profit.net).toLocaleString()}</span></div>
        {cardCharges.length > 0 && (
          <div className="profit-item" style={{cursor:"pointer"}} onClick={() => setShowCardCharges(true)}>
            <span className="profit-label">💳 刷卡總計</span>
            <span className="profit-value" style={{color:"var(--accent)"}}>NT${Math.round(cardCharges.reduce((s,c)=>s+Number(c.twd_amount),0)).toLocaleString()}</span>
          </div>
        )}
      </div>

      {/* Orders Table */}
      {orders.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">🛒</div><p>這個批次還沒有訂單</p></div>
      ) : (() => {
        // Sort orders
        const sortedOrders = [...orders].sort((a, b) => {
          if (!sortCol) return 0;
          const activeA = (a.order_items || []).filter(i => !i.not_obtained);
          const activeB = (b.order_items || []).filter(i => !i.not_obtained);
          let va, vb;
          switch(sortCol) {
            case "customer": va = a.customer; vb = b.customer; break;
            case "qty": va = activeA.reduce((s,i)=>s+(Number(i.quantity)||1),0); vb = activeB.reduce((s,i)=>s+(Number(i.quantity)||1),0); break;
            case "totalPrice": va = activeA.reduce((s,i)=>s+calcItem(i,jpyRate,proxyRate).totalPrice,0); vb = activeB.reduce((s,i)=>s+calcItem(i,jpyRate,proxyRate).totalPrice,0); break;
            case "profit": va = activeA.reduce((s,i)=>s+calcItem(i,jpyRate,proxyRate).profit,0); vb = activeB.reduce((s,i)=>s+calcItem(i,jpyRate,proxyRate).profit,0); break;
            case "due": va = orderTotalDue(a); vb = orderTotalDue(b); break;
            case "paid": va = orderPaid(a.id); vb = orderPaid(b.id); break;
            case "remaining": va = orderTotalDue(a)-orderPaid(a.id); vb = orderTotalDue(b)-orderPaid(b.id); break;
            case "weight": va = activeA.reduce((s,i)=>s+Number(i.weight_g||0),0); vb = activeB.reduce((s,i)=>s+Number(i.weight_g||0),0); break;
            default: return 0;
          }
          if (typeof va === "string") return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
          return sortDir === "asc" ? va - vb : vb - va;
        });

        function renderCell(col, order) {
          const activeItems = (order.order_items || []).filter(i => !i.not_obtained);
          const totalOrderPrice = activeItems.reduce((s,i)=>s+calcItem(i,jpyRate,proxyRate).totalPrice,0);
          const totalProfit = activeItems.reduce((s,i)=>s+calcItem(i,jpyRate,proxyRate).profit,0);
          const due = orderTotalDue(order);
          const paid = orderPaid(order.id);
          const remaining = due - paid;
          const fwName = getFwName(order.forwarder_id);
          switch(col) {
            case "ops": return <td key={col} className="center"><button className="btn-record-payment-sm" onClick={()=>openPaymentModal(order)}>💳</button><button className="btn-edit-sm" onClick={()=>openEdit(order)}>編輯</button><button className="btn-danger-sm" onClick={()=>deleteOrder(order.id)}>刪除</button></td>;
            case "customer": return <td key={col}><div className="customer-name">
              {order.customer}
              {skipProfitCustomers.has(order.customer) && <span className="skip-profit-badge">不計利潤</span>}
            </div>{order.note&&<div className="order-note">📝 {order.note}</div>}</td>;
            case "items": return <td key={col}><div className="item-list-detail">{(order.order_items||[]).map((item,idx)=><div key={idx} className={`item-detail-row ${item.not_obtained?"item-not-obtained":""}`}><span className="item-detail-name">{item.name}</span>{item.not_obtained&&<span className="not-obtained-badge">未搶到</span>}<button className={`btn-not-obtained ${item.not_obtained?"active":""}`} onClick={()=>toggleNotObtained(item.id,item.not_obtained)}>{item.not_obtained?"↩":"✕"}</button></div>)}</div></td>;
            case "shop": return <td key={col} className="center"><div className="item-list-detail">{activeItems.map((item,idx)=><div key={idx} className="multi-val">{getShopName(item.shop_id)}</div>)}</div></td>;
            case "qty": return <td key={col} className="center">{activeItems.reduce((s,i)=>s+(Number(i.quantity)||1),0)}</td>;
            case "jpyPrice": return <td key={col} className="number">{activeItems.map((i,idx)=><div key={idx} className="multi-val">¥{Number(i.jpy_price).toLocaleString()}</div>)}</td>;
            case "cost": return <td key={col} className="number">NT${Math.round(activeItems.reduce((s,i)=>s+calcItem(i,jpyRate,proxyRate).costTwd,0)).toLocaleString()}</td>;
            case "fee": return <td key={col} className="number neg">NT${Math.round(activeItems.reduce((s,i)=>s+calcItem(i,jpyRate,proxyRate).ccFee,0)).toLocaleString()}</td>;
            case "rebate": return <td key={col} className="number green">NT${Math.round(activeItems.reduce((s,i)=>s+calcItem(i,jpyRate,proxyRate).ccRebate,0)).toLocaleString()}</td>;
            case "realCost": return <td key={col} className="number">NT${Math.round(activeItems.reduce((s,i)=>s+calcItem(i,jpyRate,proxyRate).realCost,0)).toLocaleString()}</td>;
            case "unitPrice": return <td key={col} className="number">{activeItems.map((i,idx)=>{
              const localVal = customPrices[i.id];
              const displayItem = localVal !== undefined ? { ...i, custom_unit_price: localVal === "" ? null : parseFloat(localVal) } : i;
              const c = calcItem(displayItem, jpyRate, proxyRate);
              return <div key={idx} className="multi-val unit-price-cell" onClick={e => e.stopPropagation()}>
                <input
                  className="custom-price-input"
                  type="number"
                  title="手動覆蓋定價（留空用計算值）"
                  placeholder={String(ceilTo10(Number(i.jpy_price || 0) * proxyRate))}
                  value={localVal !== undefined ? localVal : (i.custom_unit_price != null ? String(i.custom_unit_price) : "")}
                  onChange={e => handleCustomPriceChange(i.id, e.target.value)}
                  onBlur={e => handleCustomPriceBlur(i.id, e.target.value)}
                  onClick={e => e.stopPropagation()}
                />
                {c.isCustomPrice && <span className="custom-price-badge">手動</span>}
              </div>;
            })}</td>;
            case "totalPrice": return <td key={col} className="number twd">NT${Math.round(totalOrderPrice).toLocaleString()}</td>;
            case "profit": return <td key={col} className={skipProfitCustomers.has(order.customer) ? "number" : "number net"}>{skipProfitCustomers.has(order.customer) ? <span style={{color:"var(--text3)"}}>—</span> : `NT$${Math.round(totalProfit).toLocaleString()}`}</td>;
            case "weight": return <td key={col} className="center">{activeItems.reduce((s,i)=>s+Number(i.weight_g||0),0)}g</td>;
            case "forwarder": return <td key={col} className="center"><span className="forwarder-tag">{fwName}</span></td>;
            case "shipping": return <td key={col} className="number">{order.shipping_twd>0?`NT$${Math.round(order.shipping_twd).toLocaleString()}`:"—"}</td>;
            case "payMethod": return <td key={col} className="center"><span className={`method-tag ${order.payment_method==="取付"?"method-cod":""}`}>{order.payment_method}</span></td>;
            case "due": return <td key={col} className="number">NT${due.toLocaleString()}</td>;
            case "paid": return <td key={col} className="number net">NT${Math.round(paid).toLocaleString()}</td>;
            case "remaining": return <td key={col} className={`number ${remaining>0?"neg":"net"}`}>{remaining>0?`NT$${Math.round(remaining).toLocaleString()}`:"✓"}</td>;
            default: return <td key={col} />;
          }
        }

        const sortableSet = new Set(["customer","qty","totalPrice","profit","due","paid","remaining","weight"]);

        return (
          <div className="orders-table-wrap">
            <p className="col-hint">💡 拖曳欄位標題可調整順序，點擊可排序</p>
            <table className="orders-table">
              <thead>
                <tr>
                  {colOrder.map(col => (
                    <th key={col}
                      className={[
                        sortableSet.has(col) ? "sortable" : "",
                        dragCol === col ? "dragging" : "",
                        dragOverCol === col ? "drag-over" : "",
                      ].join(" ")}
                      draggable
                      onClick={() => sortableSet.has(col) && handleSort(col)}
                      onDragStart={() => handleDragStart(col)}
                      onDragOver={e => { e.preventDefault(); handleDragOver(col); }}
                      onDrop={() => handleDrop(col)}
                      onDragEnd={() => { setDragCol(null); setDragOverCol(null); }}
                    >
                      {COL_LABELS[col]}
                      {sortableSet.has(col) && (
                        <span className={`sort-icon ${sortCol===col?"active":""}`}>
                          {sortCol===col ? (sortDir==="asc" ? "▲" : "▼") : "⇅"}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedOrders.map(order => {
                  const isFullyPaid = orderPaid(order.id) >= orderTotalDue(order) && orderTotalDue(order) > 0;
                  const allNotObtained = (order.order_items||[]).length > 0 && (order.order_items||[]).every(i => i.not_obtained);
                  return (
                    <tr key={order.id} className={isFullyPaid || allNotObtained ? "row-done" : ""}>
                      {colOrder.map(col => renderCell(col, order))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* ── Batch Edit Modal ── */}
      {showBatchEdit && (
        <div className="modal-overlay" onClick={() => setShowBatchEdit(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>✏️ 編輯批次</h2>
              <button className="modal-close" onClick={() => setShowBatchEdit(false)}>✕</button>
            </div>
            <div className="form-grid">
              <label className="form-label">批次名稱
                <input className="form-input" value={batchForm.name} onChange={e => setBatchForm(f => ({...f, name: e.target.value}))} />
              </label>
              <label className="form-label">採購日期
                <input className="form-input" type="date" value={batchForm.date} onChange={e => setBatchForm(f => ({...f, date: e.target.value}))} />
              </label>
              <label className="form-label">商品匯率（計算成本用）
                <div className="rate-input-row">
                  <input className="form-input" type="number" step="0.0001" value={batchForm.jpy_rate} onChange={e => setBatchForm(f => ({...f, jpy_rate: e.target.value}))} />
                  <button className="btn-fetch-rate" onClick={() => fetchRate("jpy_rate")} disabled={fetchingRate === "jpy_rate"}>{fetchingRate === "jpy_rate" ? "⏳" : "🔄 自動抓取"}</button>
                </div>
              </label>
              <label className="form-label">運費匯率（計算運費台幣用）
                <div className="rate-input-row">
                  <input className="form-input" type="number" step="0.0001" value={batchForm.shipping_rate} onChange={e => setBatchForm(f => ({...f, shipping_rate: e.target.value}))} />
                  <button className="btn-fetch-rate" onClick={() => fetchRate("shipping_rate")} disabled={fetchingRate === "shipping_rate"}>{fetchingRate === "shipping_rate" ? "⏳" : "🔄 自動抓取"}</button>
                </div>
              </label>
              <label className="form-label" style={{gridColumn:"1/-1"}}>
                國際運費
                <div className="currency-toggle-row">
                  <button type="button" className={`currency-btn ${batchForm.intl_shipping_currency === "jpy" ? "active" : ""}`} onClick={() => setBatchForm(f=>({...f, intl_shipping_currency:"jpy"}))}>日幣 ¥</button>
                  <button type="button" className={`currency-btn ${batchForm.intl_shipping_currency === "twd" ? "active" : ""}`} onClick={() => setBatchForm(f=>({...f, intl_shipping_currency:"twd"}))}>台幣 NT$</button>
                  {batchForm.intl_shipping_currency === "jpy"
                    ? <input className="form-input" style={{flex:1}} type="number" placeholder="日幣金額" value={batchForm.total_intl_shipping_jpy} onChange={e => setBatchForm(f => ({...f, total_intl_shipping_jpy: e.target.value}))} />
                    : <input className="form-input" style={{flex:1}} type="number" placeholder="台幣金額" value={batchForm.total_intl_shipping_twd} onChange={e => setBatchForm(f => ({...f, total_intl_shipping_twd: e.target.value}))} />
                  }
                  {batchForm.intl_shipping_currency === "jpy" && batchForm.total_intl_shipping_jpy > 0 && (
                    <span style={{fontSize:"12px",color:"var(--text3)",whiteSpace:"nowrap"}}>≈ NT${Math.round(batchForm.total_intl_shipping_jpy * (batchForm.shipping_rate||shippingRate)).toLocaleString()}</span>
                  )}
                </div>
              </label>
              <label className="form-label">吸收運費（台幣 NT$）
                <input className="form-input" type="number" value={batchForm.absorbed_shipping_twd} onChange={e => setBatchForm(f => ({...f, absorbed_shipping_twd: e.target.value}))} />
              </label>
              <label className="form-label" style={{gridColumn:"1/-1"}}>購買網站
                <div className="forwarder-select-row">
                  <select className="form-input" value={batchForm.shop_id} onChange={e => setBatchForm(f => ({...f, shop_id: e.target.value}))}>
                    <option value="">未指定</option>
                    {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button type="button" className="btn-go-forwarder" onClick={() => { setShowBatchEdit(false); onGoShops(); }}>＋ 管理網站</button>
                </div>
              </label>
              <label className="form-label" style={{gridColumn:"1/-1"}}>備註
                <input className="form-input" value={batchForm.note} onChange={e => setBatchForm(f => ({...f, note: e.target.value}))} />
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowBatchEdit(false)}>取消</button>
              <button className="btn-primary" onClick={saveBatch} disabled={savingBatch}>{savingBatch ? "儲存中..." : "儲存批次"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Shipping Calc Modal ── */}
      {showShippingCalc && (
        <div className="modal-overlay" onClick={() => setShowShippingCalc(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>⚖️ 運費分攤計算</h2><button className="modal-close" onClick={() => setShowShippingCalc(false)}>✕</button></div>
            <div className="shipping-calc">
              <div className="calc-summary">
                <div>國際運費：<strong>
                  {batch.total_intl_shipping_twd > 0
                    ? `NT$${Math.round(batch.total_intl_shipping_twd).toLocaleString()}（直接台幣）`
                    : `¥${Number(batch.total_intl_shipping_jpy||0).toLocaleString()} × ${shippingRate} = NT$${Math.round(intlShippingTwd).toLocaleString()}`
                  }
                </strong></div>
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

      {/* ── Payment Modal ── */}
      {showPaymentModal && paymentOrder && (
        <div className="modal-overlay" onClick={() => setShowPaymentModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>💳 收款記錄　<span style={{color:"var(--accent)"}}>{paymentOrder.customer}</span></h2>
              <button className="modal-close" onClick={() => setShowPaymentModal(false)}>✕</button>
            </div>
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
            {paymentRecords.length > 0 && (
              <div className="payment-records-list">
                {paymentRecords.map(p => (
                  editingPayment?.id === p.id ? (
                    <div key={p.id} className="payment-record-row editing-row">
                      <input className="form-input" type="date" value={editPaymentForm.paid_at} onChange={e => setEditPaymentForm(f=>({...f,paid_at:e.target.value}))} style={{width:"130px"}} />
                      <input className="form-input" placeholder="備註" value={editPaymentForm.note} onChange={e => setEditPaymentForm(f=>({...f,note:e.target.value}))} style={{flex:1}} />
                      <input className="form-input" type="number" value={editPaymentForm.amount} onChange={e => setEditPaymentForm(f=>({...f,amount:e.target.value}))} style={{width:"100px"}} />
                      <button className="btn-edit-sm" onClick={saveEditPayment}>✓</button>
                      <button className="btn-secondary" style={{padding:"4px 8px",fontSize:"12px"}} onClick={() => setEditingPayment(null)}>✕</button>
                    </div>
                  ) : (
                    <div key={p.id} className="payment-record-row">
                      <span className="pr-date">{p.paid_at}</span>
                      <span className="pr-note">{p.note || "—"}</span>
                      <span className="pr-amount net-text">NT${Number(p.amount).toLocaleString()}</span>
                      <button className="btn-edit-sm" onClick={() => openEditPayment(p)}>編輯</button>
                      <button className="btn-danger-sm" onClick={() => deletePaymentRecord(p.id)}>刪除</button>
                    </div>
                  )
                ))}
              </div>
            )}
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

      {/* ── Order Form Modal ── */}
      {showOrderForm && (
        <div className="modal-overlay" onClick={() => setShowOrderForm(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingOrder ? "編輯訂單" : "新增訂單"}</h2>
              <button className="modal-close" onClick={() => setShowOrderForm(false)}>✕</button>
            </div>
            <div className="form-grid">
              <label className="form-label">客人名稱 / ID
                <div style={{display:"flex", gap:"8px"}}>
                  <input className="form-input" placeholder="例：小花、IG@xxx" value={form.customer} onChange={e => setFormField("customer", e.target.value)} style={{flex:1}} />
                  <button type="button" className="btn-preset-customer" onClick={() => setFormField("customer", "現貨")}>現貨</button>
                </div>
              </label>
              <label className="form-label">付款方式
                <select className="form-input" value={form.payment_method} onChange={e => setFormField("payment_method", e.target.value)}>
                  {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
                </select>
              </label>
              <label className="form-label">集運商
                <div className="forwarder-select-row">
                  <select className="form-input" value={form.forwarder_id} onChange={e => setFormField("forwarder_id", e.target.value)}>
                    <option value="">未指定</option>
                    {forwarders.map(fw => <option key={fw.id} value={fw.id}>{fw.name}</option>)}
                  </select>
                  <button type="button" className="btn-go-forwarder" onClick={onGoForwarders}>管理</button>
                </div>
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
              {form.items.map((item, idx) => {
                const suggestions = Object.keys(itemSuggestions).filter(n =>
                  n.toLowerCase().includes((item.name || "").toLowerCase()) && item.name && n !== item.name
                ).slice(0, 5);
                return (
                <div key={idx} className={`item-row ${item.not_obtained ? "item-not-obtained" : ""}`}>
                  <div className="item-name-wrap">
                    <input
                      className="form-input item-name"
                      placeholder="商品名稱"
                      value={item.name}
                      onChange={e => {
                        setItem(idx, "name", e.target.value);
                      }}
                      list={`item-suggestions-${idx}`}
                    />
                    <datalist id={`item-suggestions-${idx}`}>
                      {Object.keys(itemSuggestions).map(n => <option key={n} value={n} />)}
                    </datalist>
                    {suggestions.length > 0 && item.name && !itemSuggestions[item.name] && (
                      <div className="item-suggestions-dropdown">
                        {suggestions.map(n => (
                          <div key={n} className="item-suggestion-row" onClick={() => {
                            const s = itemSuggestions[n];
                            setForm(f => {
                              const items = [...f.items];
                              items[idx] = { ...items[idx], name: n, jpy_price: s.jpy_price, weight_g: s.weight_g, shop_id: s.shop_id || items[idx].shop_id };
                              return { ...f, items };
                            });
                          }}>
                            <span>{n}</span>
                            <span className="suggestion-price">¥{Number(s.jpy_price).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <input className="form-input" style={{width:"60px"}} type="number" min="1" placeholder="數量" value={item.quantity} onChange={e => setItem(idx, "quantity", e.target.value)} />
                  <div className="item-price-wrap">
                    <span className="item-prefix">¥</span>
                    <input className="form-input item-price" type="number" placeholder="日幣單價" value={item.jpy_price} onChange={e => setItem(idx, "jpy_price", e.target.value)} />
                  </div>
                  <div className="item-weight-wrap">
                    <input className="form-input item-weight" type="number" placeholder="重量" value={item.weight_g} onChange={e => setItem(idx, "weight_g", e.target.value)} />
                    <span className="item-suffix">g</span>
                  </div>
                  <select className="form-input" style={{minWidth:"100px", maxWidth:"140px"}} value={item.shop_id || ""} onChange={e => setItem(idx, "shop_id", e.target.value)}>
                    <option value="">未指定</option>
                    {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <label className="not-obtained-check">
                    <input type="checkbox" checked={item.not_obtained || false} onChange={e => setItem(idx, "not_obtained", e.target.checked)} />
                    未搶到
                  </label>
                  {form.items.length > 1 && <button className="btn-remove-item" onClick={() => removeItem(idx)}>✕</button>}
                </div>
                );
              })}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowOrderForm(false)}>取消</button>
              <button className="btn-primary" onClick={saveOrder} disabled={saving}>{saving ? "儲存中..." : "儲存訂單"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Domestic Shipping Modal ── */}
      {showDomesticShipping && (
        <div className="modal-overlay" onClick={() => setShowDomesticShipping(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>🚚 日本境內運費　{batch.name}</h2>
                <p style={{fontSize:"12px",color:"var(--text3)",marginTop:"4px"}}>按商品件數分攤給客人</p>
              </div>
              <button className="modal-close" onClick={() => setShowDomesticShipping(false)}>✕</button>
            </div>

            {domesticShippings.length > 0 && (
              <div className="card-charge-summary">
                <div className="cc-sum-item"><span>總境內運費</span><span>¥{Math.round(domesticShippings.reduce((s,d)=>s+Number(d.amount_jpy),0)).toLocaleString()} → NT${Math.round(domesticShippings.reduce((s,d)=>s+Number(d.amount_jpy),0) * jpyRate).toLocaleString()}</span></div>
                <div className="cc-sum-item"><span>總件數</span><span>{totalItemCount} 件</span></div>
                <div className="cc-sum-total"><span>每件分攤</span><span className="accent-text">NT${totalItemCount > 0 ? Math.round(domesticShippings.reduce((s,d)=>s+Number(d.amount_jpy),0) * jpyRate / totalItemCount).toLocaleString() : 0}</span></div>
              </div>
            )}

            {/* Records */}
            <div className="payment-records-list">
              {domesticShippings.map(d => (
                editingDs?.id === d.id ? (
                  <div key={d.id} className="payment-record-row editing-row">
                    <input className="form-input" type="number" placeholder="¥" value={dsForm.amount_jpy} onChange={e => setDsForm(f=>({...f,amount_jpy:e.target.value}))} style={{width:"120px"}} />
                    <input className="form-input" placeholder="備註" value={dsForm.note} onChange={e => setDsForm(f=>({...f,note:e.target.value}))} style={{flex:1}} />
                    <button className="btn-edit-sm" onClick={saveDomesticShipping}>✓</button>
                    <button className="btn-secondary" style={{padding:"4px 8px",fontSize:"12px"}} onClick={() => { setEditingDs(null); setDsForm({amount_jpy:"",note:""}); }}>✕</button>
                  </div>
                ) : (
                  <div key={d.id} className="payment-record-row">
                    <span className="pr-note">{d.note || "—"}</span>
                    <span className="pr-amount twd-text">¥{Number(d.amount_jpy).toLocaleString()}</span>
                    <span className="pr-date">→ NT${Math.round(Number(d.amount_jpy) * jpyRate).toLocaleString()}</span>
                    <button className="btn-edit-sm" onClick={() => { setEditingDs(d); setDsForm({amount_jpy:String(d.amount_jpy),note:d.note||""}); }}>編輯</button>
                    <button className="btn-danger-sm" onClick={() => deleteDomesticShipping(d.id)}>刪除</button>
                  </div>
                )
              ))}
            </div>

            {/* Per-order breakdown */}
            {domesticShippings.length > 0 && orders.length > 0 && (
              <div className="cc-add-section" style={{marginBottom:"8px"}}>
                <h3 style={{fontSize:"13px",color:"var(--text2)",marginBottom:"10px"}}>各客人分攤</h3>
                {orders.map(o => {
                  const cnt = (o.order_items||[]).filter(i=>!i.not_obtained).reduce((s,i)=>s+(Number(i.quantity)||1),0);
                  const share = Math.round(domesticShippingPerOrder[o.id] || 0);
                  if (!cnt) return null;
                  return <div key={o.id} className="cc-sum-item"><span>{o.customer}（{cnt}件）</span><span className="twd-text">NT${share.toLocaleString()}</span></div>;
                })}
              </div>
            )}

            {/* Add new */}
            <div className="cc-add-section">
              <h3 style={{fontSize:"13px",color:"var(--text2)",marginBottom:"10px"}}>新增境內運費</h3>
              <div className="form-grid">
                <label className="form-label">金額（日幣 ¥）*
                  <input className="form-input" type="number" value={dsForm.amount_jpy} onChange={e => setDsForm(f=>({...f,amount_jpy:e.target.value}))} />
                </label>
                <label className="form-label">備註
                  <input className="form-input" placeholder="例：Tenso 轉送費" value={dsForm.note} onChange={e => setDsForm(f=>({...f,note:e.target.value}))} />
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowDomesticShipping(false)}>關閉</button>
              <button className="btn-primary" onClick={saveDomesticShipping}>新增</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Card Charges Modal ── */}
      {showCardCharges && (
        <div className="modal-overlay" onClick={() => setShowCardCharges(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>💳 刷卡記錄　{batch.name}</h2>
                <p style={{fontSize:"12px", color:"var(--text3)", marginTop:"4px"}}>記錄實際信用卡刷卡金額，用於對帳</p>
              </div>
              <button className="modal-close" onClick={() => setShowCardCharges(false)}>✕</button>
            </div>

            {/* Totals */}
            {cardCharges.length > 0 && (
              <div className="card-charge-summary">
                {["商品","國際運費","境內運費","其他"].map(cat => {
                  const total = cardCharges.filter(c => c.category === cat).reduce((s,c) => s + Number(c.twd_amount), 0);
                  if (!total) return null;
                  return <div key={cat} className="cc-sum-item"><span>{cat}</span><span className="twd-text">NT${Math.round(total).toLocaleString()}</span></div>;
                })}
                <div className="cc-sum-total"><span>刷卡總計</span><span className="accent-text">NT${Math.round(cardCharges.reduce((s,c)=>s+Number(c.twd_amount),0)).toLocaleString()}</span></div>
              </div>
            )}

            {/* Records list */}
            {cardCharges.length > 0 && (
              <div className="payment-records-list">
                {cardCharges.map(c => (
                  editingCharge?.id === c.id ? (
                    <div key={c.id} className="payment-record-row editing-row">
                      <select className="form-input" value={editChargeForm.category} onChange={e => setEditChargeForm(f=>({...f,category:e.target.value}))} style={{width:"110px"}}>
                        {["商品","國際運費","境內運費","其他"].map(cat=><option key={cat}>{cat}</option>)}
                      </select>
                      <input className="form-input" placeholder="備註" value={editChargeForm.note} onChange={e => setEditChargeForm(f=>({...f,note:e.target.value}))} style={{flex:1}} />
                      <input className="form-input" type="number" placeholder="¥" value={editChargeForm.jpy_amount} onChange={e => setEditChargeForm(f=>({...f,jpy_amount:e.target.value}))} style={{width:"90px"}} />
                      <input className="form-input" type="number" placeholder="NT$" value={editChargeForm.twd_amount} onChange={e => setEditChargeForm(f=>({...f,twd_amount:e.target.value}))} style={{width:"100px"}} />
                      <button className="btn-edit-sm" onClick={saveEditCharge}>✓</button>
                      <button className="btn-secondary" style={{padding:"4px 8px",fontSize:"12px"}} onClick={() => setEditingCharge(null)}>✕</button>
                    </div>
                  ) : (
                    <div key={c.id} className="payment-record-row">
                      <span className="cc-cat-tag">{c.category}</span>
                      <span className="pr-note">{c.note || "—"}</span>
                      {c.jpy_amount && <span className="pr-date">¥{Number(c.jpy_amount).toLocaleString()}</span>}
                      <span className="pr-amount twd-text">NT${Number(c.twd_amount).toLocaleString()}</span>
                      <button className="btn-edit-sm" onClick={() => openEditCharge(c)}>編輯</button>
                      <button className="btn-danger-sm" onClick={() => deleteCardCharge(c.id)}>刪除</button>
                    </div>
                  )
                ))}
              </div>
            )}

            {/* Add new */}
            <div className="cc-add-section">
              <h3 style={{fontSize:"13px", color:"var(--text2)", marginBottom:"10px"}}>新增刷卡記錄</h3>
              <div className="form-grid">
                <label className="form-label">類別
                  <select className="form-input" value={cardChargeForm.category} onChange={e => setCardChargeForm(f=>({...f, category:e.target.value}))}>
                    {["商品","國際運費","境內運費","其他"].map(c => <option key={c}>{c}</option>)}
                  </select>
                </label>
                <label className="form-label">台幣金額 *
                  <input className="form-input" type="number" placeholder="NT$" value={cardChargeForm.twd_amount} onChange={e => setCardChargeForm(f=>({...f, twd_amount:e.target.value}))} />
                </label>
                <label className="form-label">日幣金額（選填）
                  <input className="form-input" type="number" placeholder="¥" value={cardChargeForm.jpy_amount} onChange={e => setCardChargeForm(f=>({...f, jpy_amount:e.target.value}))} />
                </label>
                <label className="form-label">備註
                  <input className="form-input" placeholder="例：Animate 訂單" value={cardChargeForm.note} onChange={e => setCardChargeForm(f=>({...f, note:e.target.value}))} />
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowCardCharges(false)}>關閉</button>
              <button className="btn-primary" onClick={addCardCharge} disabled={savingCharge}>{savingCharge ? "儲存中..." : "新增"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Summary Modal ── */}
      {showSummary && (
        <div className="modal-overlay" onClick={() => setShowSummary(false)}>
          <div className="modal modal-summary" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>📋 收款統計　{batch.name}</h2>
                <p style={{fontSize:"12px", color:"var(--text3)", marginTop:"4px"}}>僅統計商品款項，運費尾款請另行處理</p>
              </div>
              <button className="modal-close" onClick={() => setShowSummary(false)}>✕</button>
            </div>
            <div className="summary-cards">
              {orders.map(order => {
                const activeItems = (order.order_items || []).filter(i => !i.not_obtained);
                if (activeItems.length === 0) return null;
                const productTotal = activeItems.reduce((s, i) => s + calcItem(i, jpyRate, proxyRate).totalPrice, 0);
                const alreadyPaid = orderPaid(order.id);
                const owed = Math.max(0, productTotal - alreadyPaid);
                const inputAmt = summaryPayments[order.id] ?? (owed > 0 ? String(Math.round(owed)) : "0");

                async function recordSummaryPayment(orderId, amount) {
                  if (!amount || Number(amount) <= 0) return alert("請填寫金額");
                  await supabase.from("payment_records").insert([{
                    order_id: orderId, amount: Number(amount),
                    note: "收款統計記錄", paid_at: new Date().toISOString().split("T")[0],
                  }]);
                  const { data } = await supabase.from("payment_records").select("*").eq("order_id", orderId);
                  const total = (data || []).reduce((s, p) => s + Number(p.amount), 0);
                  if (total >= orderTotalDue(order)) {
                    await supabase.from("orders").update({ product_paid: true, shipping_paid: true }).eq("id", orderId);
                  }
                  setSummaryPayments(prev => ({ ...prev, [orderId]: "" }));
                  fetchAllPayments(); onRefresh();
                }

                return (
                  <div key={order.id} className="summary-card">
                    <div className="summary-card-header">
                      <span className="summary-customer">{order.customer}</span>
                      <span className={`method-tag ${order.payment_method === "取付" ? "method-cod" : ""}`}>{order.payment_method}</span>
                    </div>
                    <div className="summary-items">
                      {activeItems.map((item, idx) => {
                        const c = calcItem(item, jpyRate, proxyRate);
                        return (
                          <div key={idx} className="summary-item-row">
                            <span className="summary-item-name">{item.name}</span>
                            <span className="summary-item-calc">
                              NT${c.unitPrice.toLocaleString()} × {c.qty} = <strong>NT${c.totalPrice.toLocaleString()}</strong>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="summary-totals">
                      <div className="summary-total-row"><span>商品總額</span><span className="twd-text">NT${Math.round(productTotal).toLocaleString()}</span></div>
                      {alreadyPaid > 0 && <div className="summary-total-row"><span>已付</span><span className="net-text">-NT${Math.round(alreadyPaid).toLocaleString()}</span></div>}
                      <div className="summary-total-row summary-owed"><span>尚欠</span><span className={owed > 0 ? "neg-text" : "net-text"}>{owed > 0 ? `NT$${Math.round(owed).toLocaleString()}` : "✓ 已結清"}</span></div>
                    </div>
                    {owed > 0 && (
                      <div className="summary-collect-row">
                        <span className="summary-collect-label">此次收款</span>
                        <input
                          className="form-input summary-collect-input"
                          type="number"
                          value={inputAmt}
                          onChange={e => setSummaryPayments(prev => ({ ...prev, [order.id]: e.target.value }))}
                        />
                        <button className="btn-primary summary-collect-btn" onClick={() => recordSummaryPayment(order.id, inputAmt)}>記錄</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
