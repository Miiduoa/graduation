-- 店家核對狀態改成三態：verified / unverified / demo。
-- 預設與既有列都是 unverified；未知值也當成 unverified。
-- 只寫入此檔，不在這個倉庫執行、不寫正式庫。

ALTER TABLE food_locations
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'unverified';

UPDATE food_locations
SET review_status = 'unverified'
WHERE review_status IS NULL
   OR review_status NOT IN ('verified', 'unverified', 'demo');
