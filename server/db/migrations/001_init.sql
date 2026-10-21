-- 001_init.sql: Core schema for Devi Electrical management system
-- Timezone and standard types
SET TIME ZONE 'Asia/Kolkata';

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users and Authentication
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'staff')),
    totp_secret_enc TEXT,
    totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    failed_attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    disabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_hash TEXT UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_hash TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- One-time recovery codes for 2FA
CREATE TABLE IF NOT EXISTS recovery_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON recovery_codes(user_id, used);

-- Single-row Business Settings
CREATE TABLE IF NOT EXISTS settings (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    business_name TEXT NOT NULL DEFAULT 'Devi Electrical',
    address TEXT NOT NULL DEFAULT 'Tc1/3885, Devi Building, opp. Krishna Theatre, Bypass Junction, Kazhakkoottam, Thiruvananthapuram, Kerala 695582',
    phone TEXT NOT NULL DEFAULT '094472 20411',
    state_code TEXT NOT NULL DEFAULT '32',
    state_name TEXT NOT NULL DEFAULT 'Kerala',
    gstin_enc TEXT,
    gstin_bidx TEXT,
    gst_registered BOOLEAN NOT NULL DEFAULT FALSE,
    bank_name_enc TEXT,
    bank_account_enc TEXT,
    bank_ifsc_enc TEXT,
    bank_branch_enc TEXT,
    upi_id_enc TEXT,
    opening_time TEXT,
    logo_data TEXT,
    invoice_prefix VARCHAR(10) NOT NULL DEFAULT 'DE',
    quotation_prefix VARCHAR(10) NOT NULL DEFAULT 'QT',
    challan_prefix VARCHAR(10) NOT NULL DEFAULT 'DC',
    purchase_prefix VARCHAR(10) NOT NULL DEFAULT 'PO',
    default_gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18.00,
    quotation_validity_days INT NOT NULL DEFAULT 15,
    allow_negative_stock BOOLEAN NOT NULL DEFAULT FALSE,
    scan_retention_days INT NOT NULL DEFAULT 30,
    terms_and_conditions TEXT DEFAULT 'Goods once sold will be taken back or exchanged only under manufacturer warranty terms.',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Products & Inventory
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku VARCHAR(50) UNIQUE NOT NULL,
    barcode VARCHAR(100),
    name TEXT NOT NULL,
    brand TEXT,
    category TEXT NOT NULL,
    spec TEXT,
    hsn VARCHAR(8),
    unit VARCHAR(20) NOT NULL DEFAULT 'Nos',
    purchase_price BIGINT NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
    selling_price BIGINT NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
    gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18.00 CHECK (gst_rate >= 0),
    current_stock NUMERIC(14,3) NOT NULL DEFAULT 0.000,
    min_stock NUMERIC(14,3) NOT NULL DEFAULT 0.000,
    rack_location TEXT,
    keywords TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_name ON products USING gin(to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- Product Aliases for OCR matcher learning
CREATE TABLE IF NOT EXISTS product_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_aliases_text ON product_aliases(alias);

-- Customers
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone_enc TEXT,
    phone_bidx TEXT,
    email_enc TEXT,
    gstin_enc TEXT,
    gstin_bidx TEXT,
    address_enc TEXT,
    state_code TEXT NOT NULL DEFAULT '32',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customers_phone_bidx ON customers(phone_bidx) WHERE phone_bidx IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_gstin_bidx ON customers(gstin_bidx) WHERE gstin_bidx IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone_enc TEXT,
    phone_bidx TEXT,
    gstin_enc TEXT,
    gstin_bidx TEXT,
    address_enc TEXT,
    state_code TEXT NOT NULL DEFAULT '32',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_phone_bidx ON suppliers(phone_bidx) WHERE phone_bidx IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_suppliers_gstin_bidx ON suppliers(gstin_bidx) WHERE gstin_bidx IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);

-- Numbering Series (for atomic gap-free document number allocation)
CREATE TABLE IF NOT EXISTS number_series (
    type VARCHAR(20) NOT NULL,
    fy VARCHAR(10) NOT NULL,
    last_number INT NOT NULL DEFAULT 0,
    PRIMARY KEY (type, fy)
);

-- Documents (Invoices, Quotations, Challans, Purchases)
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_type VARCHAR(20) NOT NULL CHECK (doc_type IN ('invoice', 'quotation', 'challan', 'purchase')),
    doc_number VARCHAR(20),
    fy VARCHAR(10) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('draft', 'unpaid', 'partially_paid', 'paid', 'cancelled', 'sent', 'accepted', 'expired', 'pending', 'delivered')),
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    customer_snapshot JSONB,
    doc_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    place_of_supply VARCHAR(10) NOT NULL DEFAULT '32',
    is_interstate BOOLEAN NOT NULL DEFAULT FALSE,
    subtotal_gross BIGINT NOT NULL DEFAULT 0,
    total_discount BIGINT NOT NULL DEFAULT 0,
    taxable_amount BIGINT NOT NULL DEFAULT 0,
    cgst_amount BIGINT NOT NULL DEFAULT 0,
    sgst_amount BIGINT NOT NULL DEFAULT 0,
    igst_amount BIGINT NOT NULL DEFAULT 0,
    extra_charges BIGINT NOT NULL DEFAULT 0,
    round_off BIGINT NOT NULL DEFAULT 0,
    grand_total BIGINT NOT NULL DEFAULT 0,
    paid_amount BIGINT NOT NULL DEFAULT 0,
    notes TEXT,
    terms TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finalized_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    CONSTRAINT uq_doc_number_per_fy UNIQUE (doc_type, fy, doc_number)
);
CREATE INDEX IF NOT EXISTS idx_documents_type_date ON documents(doc_type, doc_date DESC);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_customer ON documents(customer_id);

-- Document Line Items
CREATE TABLE IF NOT EXISTS document_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    sl_no INT NOT NULL,
    description TEXT NOT NULL,
    hsn VARCHAR(8),
    qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
    unit VARCHAR(20) NOT NULL DEFAULT 'Nos',
    rate BIGINT NOT NULL CHECK (rate >= 0),
    purchase_price BIGINT NOT NULL DEFAULT 0,
    discount_type VARCHAR(10) NOT NULL DEFAULT 'amount',
    discount_value NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    discount_amount BIGINT NOT NULL DEFAULT 0,
    taxable_amount BIGINT NOT NULL DEFAULT 0,
    gst_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    cgst_amount BIGINT NOT NULL DEFAULT 0,
    sgst_amount BIGINT NOT NULL DEFAULT 0,
    igst_amount BIGINT NOT NULL DEFAULT 0,
    line_total BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_doc_lines_doc_id ON document_lines(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_lines_product_id ON document_lines(product_id);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    amount BIGINT NOT NULL CHECK (amount > 0),
    payment_mode VARCHAR(20) NOT NULL CHECK (payment_mode IN ('cash', 'upi', 'card', 'bank_transfer', 'cheque')),
    reference TEXT,
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_document ON payments(document_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date DESC);

-- Stock Movements (audit trail for every inventory change)
CREATE TABLE IF NOT EXISTS stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    movement_type VARCHAR(25) NOT NULL CHECK (movement_type IN ('sale', 'purchase', 'sale_return', 'adjustment', 'cancel_restoration')),
    qty NUMERIC(14,3) NOT NULL,
    previous_stock NUMERIC(14,3) NOT NULL,
    new_stock NUMERIC(14,3) NOT NULL,
    reason TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_doc ON stock_movements(document_id);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    category TEXT NOT NULL,
    amount BIGINT NOT NULL CHECK (amount > 0),
    payment_mode VARCHAR(20) NOT NULL,
    description TEXT NOT NULL,
    reference TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date DESC);

-- Scan History
CREATE TABLE IF NOT EXISTS scan_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_enc TEXT NOT NULL,
    extracted_text TEXT,
    parsed_items JSONB,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scan_history_created_at ON scan_history(created_at DESC);

-- Audit Log (Strictly append-only)
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    username VARCHAR(50),
    action VARCHAR(50) NOT NULL,
    entity VARCHAR(50) NOT NULL,
    entity_id TEXT,
    client_ip TEXT NOT NULL,
    diff JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity, entity_id);

-- Initialize settings row if not present
INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
