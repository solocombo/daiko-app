-- =============================================
-- 更新 SQL：新增封存功能
-- 如果你已經建立過資料表，在 Supabase > SQL Editor 執行這一行即可
-- =============================================

ALTER TABLE batches ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;

-- 完成！之後封存的批次會在這個欄位標記 true
