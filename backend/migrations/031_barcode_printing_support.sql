-- Barcode numbering and printing support.
CREATE TABLE IF NOT EXISTS barcode_counters (
  counter_key VARCHAR(30) PRIMARY KEY,
  next_value BIGINT NOT NULL DEFAULT 1 CHECK(next_value > 0)
);
INSERT INTO barcode_counters(counter_key,next_value) VALUES ('ITEM',1),('ASSET',1)
ON CONFLICT(counter_key) DO NOTHING;
