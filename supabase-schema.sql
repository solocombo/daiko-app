-- =============================================
-- 代購 DAIKO 管理系統 - Supabase 資料表
-- 在 Supabase > SQL Editor 貼上並執行
-- =============================================

-- 批次表（每次去日本採購為一個批次）
CREATE TABLE batches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  date DATE NOT NULL,
  jpy_rate NUMERIC(6,4) NOT NULL DEFAULT 0.21,
  total_intl_shipping_jpy NUMERIC(10,2) DEFAULT 0,
  absorbed_shipping_twd NUMERIC(10,2) DEFAULT 0,
  note TEXT,
  archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 訂單表（每個客人的訂單）
CREATE TABLE orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id UUID REFERENCES batches(id) ON DELETE CASCADE,
  customer TEXT NOT NULL,
  payment_method TEXT DEFAULT '虛擬帳戶轉帳',
  product_paid BOOLEAN DEFAULT FALSE,
  shipping_paid BOOLEAN DEFAULT FALSE,
  shipping_twd NUMERIC(10,2) DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 訂單商品表（每筆訂單的商品明細）
CREATE TABLE order_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  jpy_price NUMERIC(10,2) NOT NULL,
  weight_g NUMERIC(8,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- 開啟 Row Level Security（建議）
-- 讓所有登入用戶都能讀寫（兩人共用）
-- =============================================

ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- 允許所有人讀寫（因為是私人小工具，不需要帳號登入）
CREATE POLICY "Allow all" ON batches FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON order_items FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- 完成！共 3 張資料表：
-- batches     → 採購批次
-- orders      → 客人訂單
-- order_items → 訂單商品明細
-- =============================================
