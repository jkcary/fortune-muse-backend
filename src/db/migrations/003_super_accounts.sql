-- Super accounts get readings for free; their $0 orders are recorded with provider 'comp'.
ALTER TABLE orders DROP CONSTRAINT orders_provider_check;
ALTER TABLE orders ADD CONSTRAINT orders_provider_check CHECK (provider IN ('stripe','dev','voucher','comp'));
