ALTER TABLE orders ADD COLUMN provider_refund_id text;
ALTER TABLE orders ADD COLUMN refund_status text CHECK (refund_status IN ('pending','succeeded','failed'));
ALTER TABLE orders ADD COLUMN refund_attempt int NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX orders_refund_id_idx ON orders(provider_refund_id) WHERE provider_refund_id IS NOT NULL;
