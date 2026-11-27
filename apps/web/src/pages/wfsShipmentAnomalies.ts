export interface WfsReceiptShipment {
  shipmentId?: string;
  actualDeliveryDate?: string;
  actualShippedUnits?: number;
  actualReceivedUnits?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function isRecentReceiptAnomaly(shipment: WfsReceiptShipment, now = new Date()): boolean {
  if (!shipment.shipmentId || !shipment.actualDeliveryDate || shipment.actualShippedUnits == null || shipment.actualReceivedUnits == null) return false;
  const deliveredAt = Date.parse(shipment.actualDeliveryDate);
  if (!Number.isFinite(deliveredAt) || deliveredAt > now.getTime() || deliveredAt < now.getTime() - 40 * DAY_MS) return false;
  return Number(shipment.actualShippedUnits) !== Number(shipment.actualReceivedUnits);
}

export function recentReceiptAnomalies<T extends WfsReceiptShipment>(shipments: T[], now = new Date()): T[] {
  return shipments.filter((shipment) => isRecentReceiptAnomaly(shipment, now));
}
