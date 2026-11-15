-- 044: straight-line fixed asset depreciation with period and journal audit.
ALTER TABLE fixed_assets
  ADD COLUMN IF NOT EXISTS useful_life_months INTEGER,
  ADD COLUMN IF NOT EXISTS residual_value NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(residual_value >= 0),
  ADD COLUMN IF NOT EXISTS depreciation_start_date DATE,
  ADD COLUMN IF NOT EXISTS accumulated_depreciation NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(accumulated_depreciation >= 0),
  ADD COLUMN IF NOT EXISTS depreciation_method VARCHAR(20) NOT NULL DEFAULT 'straight_line'
    CHECK(depreciation_method='straight_line');

ALTER TABLE fixed_assets DROP CONSTRAINT IF EXISTS fixed_assets_depreciation_life_check;
ALTER TABLE fixed_assets ADD CONSTRAINT fixed_assets_depreciation_life_check
  CHECK (useful_life_months IS NULL OR useful_life_months > 0);
ALTER TABLE fixed_assets DROP CONSTRAINT IF EXISTS fixed_assets_depreciation_residual_check;
ALTER TABLE fixed_assets ADD CONSTRAINT fixed_assets_depreciation_residual_check
  CHECK (residual_value <= purchase_cost);

INSERT INTO accounts(code,name_ar,name_en,account_type,is_active)
VALUES
 ('1500','الأصول الثابتة','Fixed Assets','asset',true),
 ('1590','مجمع إهلاك الأصول الثابتة','Accumulated Depreciation','asset',true),
 ('6100','مصروف الإهلاك','Depreciation Expense','expense',true)
ON CONFLICT(code) DO NOTHING;

INSERT INTO system_account_mappings(mapping_key,account_id)
SELECT v.mapping_key,a.id FROM (VALUES
 ('fixed_asset_cost','1500'),
 ('accumulated_depreciation','1590'),
 ('depreciation_expense','6100')
) AS v(mapping_key,account_code)
JOIN accounts a ON a.code=v.account_code
ON CONFLICT(mapping_key) DO UPDATE SET account_id=EXCLUDED.account_id,updated_at=now();

CREATE TABLE IF NOT EXISTS asset_depreciation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_no VARCHAR(60) NOT NULL UNIQUE,
  period_month DATE NOT NULL UNIQUE CHECK(EXTRACT(DAY FROM period_month)=1),
  status VARCHAR(16) NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','reversed')),
  total_amount NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(total_amount >= 0),
  journal_entry_id UUID REFERENCES journal_entries(id),
  reversal_journal_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_by UUID REFERENCES users(id),
  reversed_at TIMESTAMPTZ,
  reversal_reason TEXT
);
CREATE TABLE IF NOT EXISTS asset_depreciation_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES asset_depreciation_runs(id),
  asset_id UUID NOT NULL REFERENCES fixed_assets(id),
  period_month DATE NOT NULL,
  amount NUMERIC(20,6) NOT NULL CHECK(amount > 0),
  accumulated_before NUMERIC(20,6) NOT NULL CHECK(accumulated_before >= 0),
  accumulated_after NUMERIC(20,6) NOT NULL CHECK(accumulated_after >= accumulated_before),
  UNIQUE(run_id,asset_id),
  UNIQUE(asset_id,period_month)
);
CREATE INDEX IF NOT EXISTS idx_asset_depreciation_period
  ON asset_depreciation_runs(period_month DESC,status);
