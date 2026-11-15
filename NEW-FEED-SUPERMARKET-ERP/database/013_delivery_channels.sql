-- 013: delivery operations and external ordering channel registry.
CREATE TABLE IF NOT EXISTS order_channel_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code VARCHAR(40) NOT NULL UNIQUE
    CHECK (provider_code IN ('talabat','elmenus','breadfast','mrsool','generic')),
  display_name VARCHAR(120) NOT NULL,
  store_reference VARCHAR(160),
  api_base_url TEXT,
  sync_mode VARCHAR(20) NOT NULL DEFAULT 'manual'
    CHECK (sync_mode IN ('manual','webhook','api')),
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  connection_status VARCHAR(24) NOT NULL DEFAULT 'draft'
    CHECK (connection_status IN ('draft','awaiting_credentials','adapter_required','active','disabled')),
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (api_base_url IS NULL OR api_base_url ~ '^https://')
);
CREATE INDEX IF NOT EXISTS ix_delivery_orders_status_created
  ON delivery_orders(status, created_at DESC);
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS source_channel VARCHAR(40) NOT NULL DEFAULT 'pos';
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS external_order_reference VARCHAR(160);
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_external_reference
  ON delivery_orders(source_channel, external_order_reference)
  WHERE external_order_reference IS NOT NULL;
