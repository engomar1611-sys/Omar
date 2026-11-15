-- 035: retain tax separately on return lines for correct liability reversal and refunds.
ALTER TABLE sale_return_lines ADD COLUMN IF NOT EXISTS tax_refund_amount NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (tax_refund_amount >= 0);
