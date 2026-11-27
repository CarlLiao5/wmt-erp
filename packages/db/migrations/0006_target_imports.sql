CREATE TABLE target_imports (id varchar(36) NOT NULL, tenant_id varchar(36) NOT NULL, created_by varchar(36) NOT NULL, status varchar(20) NOT NULL, errors json, created_at datetime(3) NOT NULL, updated_at datetime(3) NOT NULL, PRIMARY KEY (id));
--> statement-breakpoint
CREATE INDEX target_import_scope_idx ON target_imports (tenant_id, created_at);
--> statement-breakpoint
CREATE TABLE target_import_rows (id varchar(36) NOT NULL, import_id varchar(36) NOT NULL, line_no decimal(10,0) NOT NULL, month varchar(7), target decimal(19,4), raw json, PRIMARY KEY (id));
--> statement-breakpoint
CREATE INDEX target_import_rows_import_idx ON target_import_rows (import_id, line_no);
--> statement-breakpoint
CREATE TABLE sales_targets (id varchar(36) NOT NULL, tenant_id varchar(36) NOT NULL, import_id varchar(36) NOT NULL, month varchar(7) NOT NULL, target decimal(19,4) NOT NULL, created_at datetime(3) NOT NULL, PRIMARY KEY (id));
--> statement-breakpoint
CREATE UNIQUE INDEX sales_targets_tenant_month_unique ON sales_targets (tenant_id, month);
--> statement-breakpoint
CREATE INDEX sales_targets_scope_idx ON sales_targets (tenant_id, month);
