# WFS ITS Fee Preview Work Design

## Goal

Add a read-only worker capability that estimates Inventory Transfer Services (ITS) transfer fees for existing WFS shipments, persists shipment-level and SKU-level estimates locally, and exposes the estimates in Sync Status and WFS shipment details.

The Walmart call is `POST /v3/fulfillment/inbound-preview`. Walmart documents this as a preview operation, not shipment creation or update. Its response contains `previewType`, alternative destination previews, each preview's `totalNetTransferCharge`, and per-item `shipmentItems[].netTransferCharge`.

## Confirmed behavior

- Scan existing locally synchronized WFS shipments for the selected store.
- Exclude cancelled shipments (`CANCELLED`/`CANCELED`). Other statuses are eligible when required inputs are available; Walmart remains authoritative and may reject a preview for a particular status.
- Require `inboundOrderId`, a complete `returnAddress`, and at least one normalized SKU line with GTIN, SKU, description, positive item quantity, pack quantities, and expected delivery date.
- Deduplicate repeated raw WFS item snapshots by shipment and SKU before constructing a preview request.
- Save every returned inbound/ITS destination option separately. Destination options are alternatives and must not be summed together.
- Save each option's total estimate and each SKU's returned transfer charge separately, including currency and quantity.
- Run sequentially with the existing Walmart request limiter. Never send create/update shipment requests.
- On first run, process all eligible existing shipments. Later manual runs skip unchanged request inputs and retry failed requests; changed shipment inputs are previewed again.
- Show skipped, unchanged, successful, no-ITS-result, and failed counts in the Work result. Missing estimates stay null; do not display zero for absent charges.

## Data model

Add migration `0045_wfs_its_fee_previews.sql` with three tenant/store-scoped tables:

1. `wfs_fee_preview_runs`: one current run state per tenant, store, and shipment; includes `inbound_order_id`, normalized source/request hash, status, last-attempt timestamp, last-success timestamp, and bounded error text. This records successful previews with no ITS option and field-validation skips so unchanged inputs are not repeatedly sent.
2. `wfs_fee_preview_options`: one row per returned preview type and destination (`ship_node`) for a shipment; includes destination details, `total_net_transfer_charge`, currency, and parent run ID. Unique by tenant/store/shipment/preview type/ship node.
3. `wfs_fee_preview_items`: one row per option and SKU/product; includes GTIN, SKU, item quantity, `net_transfer_charge`, and currency. Unique by parent option and product identity.

Successful re-previews replace the prior option and item rows transactionally. Failed calls retain the last successful estimate while the run state records the latest failure and its last-success timestamp; the UI labels the retained amount as stale/last successful so it is not mistaken for a fresh estimate.

## Work and data flow

Add store-level resource `wfs-inbound-preview` to the existing API → BullMQ → Worker → MySQL flow and Sync Status manual Work controls. The worker reads the latest WFS shipment snapshot and normalized, deduplicated item lines from the same tenant/store, constructs requests, calls the fixed preview endpoint, and upserts results. The request hash covers every field sent to Walmart. No recurring schedule is added in this phase; the Work can be run manually after regular WFS synchronization.

The job result reports scanned, eligible, skipped (with reason counts), unchanged, previewed, no-ITS-option, and failed counts. Per-shipment errors are isolated so one failed preview does not stop the remaining shipments.

## API and UI

Extend the existing WFS shipment read model with the saved preview options and SKU charges. Keep all reads scoped by server-derived tenant and accessible stores. For restricted members, only expose item charges for visible SKUs; do not expose an option total that includes hidden SKU lines. Administrators can see the complete option total and all item lines.

In each expanded WFS shipment, show the preview status/time, each alternative destination with its total estimate, and a SKU-level table with quantity and individual estimated transfer fee. Label values as estimates. Do not show multiple destination options as an additive total.

## Validation and rollout

- Unit tests cover request normalization, cancelled/incomplete shipment filtering, repeated item snapshot deduplication, request hashes, response parsing for total and per-SKU charges, and alternative destination handling.
- Worker tests cover per-shipment failure isolation, unchanged-request skipping, retry behavior, and transactional replacement/upsert semantics.
- API tests cover tenant/store/SKU visibility, including suppression of totals that could reveal hidden SKU charges.
- Web tests cover estimate labels, separate destination alternatives, per-SKU values, missing-value rendering, and error/no-result states.
- Review and manually apply the migration to the Doke database; do not use the Docker database. Restart Worker/API as needed, then run the full eligible shipment backfill against Doke-backed production store connections and report Work counts.
- The only Walmart mutation-shaped request is the documented preview POST. No shipment-create, shipment-update, feed, or other business mutation endpoint is called.

## Preview type handling

Persist all returned preview types and destination options for auditability. The WFS fee view prominently shows `previewType=inbound` (ITS) and keeps other preview types separately labeled rather than mixing or summing their fees.
