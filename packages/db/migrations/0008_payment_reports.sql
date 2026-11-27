CREATE TABLE payment_reports (id varchar(64) NOT NULL, tenant_id varchar(36) NOT NULL, store_id varchar(36) NOT NULL, statement_month varchar(7) NOT NULL, source_id varchar(191) NOT NULL, payload json NOT NULL, received_at datetime(3) NOT NULL, PRIMARY KEY (id));
--> statement-breakpoint
CREATE UNIQUE INDEX payment_report_source_unique ON payment_reports (store_id,source_id);
--> statement-breakpoint
CREATE INDEX payment_report_scope_idx ON payment_reports (tenant_id,store_id,statement_month);
