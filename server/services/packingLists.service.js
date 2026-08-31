const skunexus = require("./skunexus.service");

const activeOrderStates = [
  "open",
  "in_fulfillment",
  "partial_fulfillment",
  "on_hold"
];
const closedWarehouseStates = new Set(["fulfilled", "cancelled", "lost"]);
const closedDropShipStates = new Set(["finalized", "cancelled"]);
const maximumPurchaseOrders = 50;
const skuChunkSize = 40;
const queryPageSize = 250;
const purchaseOrderDetailsBatchSize = 10;
const orderDetailsBatchSize = 50;
const fulfillmentOrderChunkSize = 80;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function graphqlString(value) {
  return JSON.stringify(String(value || ""));
}

function graphqlStringList(values) {
  return values.map(graphqlString).join(", ");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeSku(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeState(value) {
  return normalizeText(value).toLowerCase();
}

function unique(values) {
  return Array.from(new Set(values));
}

function chunk(values, size) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function parsePurchaseOrderInput(value) {
  const values = Array.isArray(value) ? value : [value];
  const purchaseOrders = unique(
    values
      .flatMap((entry) => normalizeText(entry).split(/[\s,;/]+/))
      .map((entry) => entry.trim())
      .filter(Boolean)
  );

  if (purchaseOrders.length === 0) {
    throw createHttpError(400, "Enter at least one purchase order number.");
  }

  if (purchaseOrders.length > maximumPurchaseOrders) {
    throw createHttpError(
      400,
      `Enter no more than ${maximumPurchaseOrders} purchase orders at once.`
    );
  }

  return purchaseOrders;
}

function validateDate(value, label) {
  const date = normalizeText(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw createHttpError(400, `${label} is required.`);
  }

  const parsed = new Date(`${date}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw createHttpError(400, `${label} is invalid.`);
  }

  return date;
}

function parseReceiptDate(value) {
  const match = normalizeText(value).match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}\s*(?:am|pm))?$/i
  );

  if (!match) {
    return "";
  }

  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function getCustomValue(customValues, key) {
  return normalizeText(
    (customValues || []).find(
      (field) => normalizeText(field?.custom_field_id) === key
    )?.value
  );
}

function parseReceiptEntries(customValues) {
  const rawValue = getCustomValue(customValues, "date_received");

  if (!rawValue) {
    return [];
  }

  try {
    const value = JSON.parse(rawValue);

    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => ({
        date: normalizeText(entry?.date),
        dateKey: parseReceiptDate(entry?.date),
        quantity: Math.max(Number(entry?.qty || 0), 0)
      }))
      .filter((entry) => entry.dateKey && entry.quantity > 0);
  } catch {
    return [];
  }
}

function isDateInRange(date, fromDate, toDate) {
  return date >= fromDate && date <= toDate;
}

function buildPackingParts(purchaseOrderDetails, fromDate, toDate) {
  const parts = new Map();
  const purchaseOrders = [];

  for (const purchaseOrder of purchaseOrderDetails) {
    let receivedQuantity = 0;
    const receivedSkus = new Set();

    for (const lineItem of purchaseOrder.lineItems?.rows || []) {
      const sku = normalizeText(
        lineItem?.product?.sku || getCustomValue(lineItem?.customValues, "product_sku")
      );
      const normalizedSku = normalizeSku(sku);

      if (!normalizedSku) {
        continue;
      }

      const entries = parseReceiptEntries(lineItem.customValues).filter((entry) =>
        isDateInRange(entry.dateKey, fromDate, toDate)
      );

      if (entries.length === 0) {
        continue;
      }

      const quantity = entries.reduce((total, entry) => total + entry.quantity, 0);
      const current = parts.get(normalizedSku) || {
        sku,
        name: normalizeText(lineItem?.product?.name),
        receivedQuantity: 0,
        sources: []
      };

      current.receivedQuantity += quantity;
      current.sources.push({
        poNumber: purchaseOrder.label,
        quantity,
        receivedDates: entries.map((entry) => entry.date)
      });
      parts.set(normalizedSku, current);
      receivedQuantity += quantity;
      receivedSkus.add(normalizedSku);
    }

    purchaseOrders.push({
      id: purchaseOrder.id,
      poNumber: purchaseOrder.label,
      vendorName: normalizeText(purchaseOrder.vendor?.name),
      receivedQuantity,
      receivedSkuCount: receivedSkus.size,
      url: getSkuNexusUrl(`/purchase-orders/${purchaseOrder.id}`)
    });
  }

  return {
    parts: Array.from(parts.values()).sort((left, right) =>
      left.sku.localeCompare(right.sku)
    ),
    purchaseOrders
  };
}

function getSkuNexusUrl(path) {
  const baseUrl = (process.env.SKU_NEXUS_BASE_URL || "https://dpp.skunexus.com")
    .replace(/\/+$/, "");
  return `${baseUrl}${path}`;
}

async function fetchPurchaseOrders(poNumbers) {
  const rows = [];

  for (const poChunk of chunk(poNumbers, skuChunkSize)) {
    const data = await skunexus.query(`
      query PackingListPurchaseOrders {
        purchaseOrder {
          grid(
            filter: { label: { operator: in, value: [${graphqlStringList(poChunk)}] } }
            limit: { size: ${poChunk.length}, page: 1 }
          ) {
            rows {
              id
              label
              state
              vendor_id
              vendor { id name }
            }
          }
        }
      }
    `);

    rows.push(...(data?.purchaseOrder?.grid?.rows || []));
  }

  return rows;
}

async function fetchPurchaseOrderDetails(purchaseOrders) {
  const details = [];

  for (const purchaseOrderChunk of chunk(
    purchaseOrders,
    purchaseOrderDetailsBatchSize
  )) {
    const aliases = purchaseOrderChunk
      .map(
        (purchaseOrder, index) => `
          item${index}: details(id: ${graphqlString(purchaseOrder.id)}) {
            id
            label
            state
            vendor_id
            vendor { id name }
            lineItems(limit: { size: 500, page: 1 }) {
              totalSize
              rows {
                id
                quantity
                received
                product { id sku name }
                customValues { custom_field_id value }
              }
            }
          }
        `
      )
      .join("\n");
    const data = await skunexus.query(`
      query PackingListPurchaseOrderDetails {
        purchaseOrder {
          ${aliases}
        }
      }
    `);

    for (let index = 0; index < purchaseOrderChunk.length; index += 1) {
      details.push(data?.purchaseOrder?.[`item${index}`]);
    }
  }

  return details;
}

async function fetchPagedRows(createQuery, getGrid) {
  const rows = [];
  let page = 1;
  let totalPages = 1;

  do {
    const data = await skunexus.query(createQuery(page));
    const grid = getGrid(data) || {};
    rows.push(...(grid.rows || []));
    totalPages = Math.max(Number(grid.totalPages || 1), 1);
    page += 1;
  } while (page <= totalPages);

  return rows;
}

async function fetchActiveOrders(skus) {
  const ordersById = new Map();

  for (const skuChunk of chunk(skus, skuChunkSize)) {
    const rows = await fetchPagedRows(
      (page) => `
        query PackingListOrders {
          order {
            grid(
              filter: {
                state: { operator: in, value: [${graphqlStringList(activeOrderStates)}] }
                product_sku: { operator: in, value: [${graphqlStringList(skuChunk)}] }
              }
              sort: { created_at: ASC }
              limit: { size: ${queryPageSize}, page: ${page} }
            ) {
              totalPages
              rows { id label state created_at customer_name }
            }
          }
        }
      `,
      (data) => data?.order?.grid
    );

    for (const order of rows) {
      ordersById.set(order.id, order);
    }
  }

  return Array.from(ordersById.values());
}

async function fetchBackorders(skus) {
  const rows = [];

  for (const skuChunk of chunk(skus, skuChunkSize)) {
    rows.push(
      ...(await fetchPagedRows(
        (page) => `
          query PackingListBackorders {
            backorder {
              grid(
                filter: {
                  relatedProduct: {
                    sku: { operator: in, value: [${graphqlStringList(skuChunk)}] }
                  }
                }
                limit: { size: ${queryPageSize}, page: ${page} }
              ) {
                totalPages
                rows {
                  id
                  order_id
                  qty
                  missing_qty
                  relatedProduct { id sku name }
                  relatedOrder { id label }
                }
              }
            }
          }
        `,
        (data) => data?.backorder?.grid
      ))
    );
  }

  return rows;
}

async function fetchOrderDetails(orders) {
  const details = [];

  for (const orderChunk of chunk(orders, orderDetailsBatchSize)) {
    const aliases = orderChunk
      .map(
        (order, index) => `
          item${index}: details(id: ${graphqlString(order.id)}) {
            id
            label
            state
            created_at
            customer_name
            items {
              id
              product_id
              qty
              decidable_qty
              relatedProduct { id sku name }
              decidedItems {
                name
                decisions {
                  qty
                  label
                  relatedFulfillment { id label state group_id }
                  relatedPurchaseOrder {
                    id
                    label
                  }
                }
              }
            }
          }
        `
      )
      .join("\n");
    const data = await skunexus.query(`
      query PackingListOrderDetails {
        order {
          ${aliases}
        }
      }
    `);

    for (let index = 0; index < orderChunk.length; index += 1) {
      details.push(data?.order?.[`item${index}`]);
    }
  }

  return details;
}

async function fetchFulfillmentRows(rootName, orders, rowFields) {
  const rows = [];
  const labels = unique(orders.map((order) => normalizeText(order.label)).filter(Boolean));

  for (const labelChunk of chunk(labels, fulfillmentOrderChunkSize)) {
    rows.push(
      ...(await fetchPagedRows(
        (page) => `
          query PackingListFulfillments {
            ${rootName} {
              grid(
                filter: {
                  relatedOrder: {
                    label: { operator: in, value: [${graphqlStringList(labelChunk)}] }
                  }
                }
                limit: { size: ${queryPageSize}, page: ${page} }
              ) {
                totalPages
                rows {
                  ${rowFields}
                }
              }
            }
          }
        `,
        (data) => data?.[rootName]?.grid
      ))
    );
  }

  return rows;
}

async function addFulfillmentsToOrders(orderDetails, orders) {
  const shipmentRows = await fetchFulfillmentRows(
    "shipmentFulfillment",
    orders,
    `
      id
      current_state
      label
      fulfillFrom { id label }
      relatedShipment { id tracking_code status }
      relatedOrder { id label state }
    `
  );
  const dropShipRows = await fetchFulfillmentRows(
    "dropShipFulfillment",
    orders,
    `
      id
      current_state
      label
      fulfillFrom { id label }
      relatedPurchaseOrder { id label tracking_code }
      relatedOrder { id label state }
    `
  );
  const shipmentRowsByOrder = new Map();
  const dropShipRowsByOrder = new Map();

  for (const row of shipmentRows) {
    const orderId = normalizeText(row?.relatedOrder?.id);

    if (orderId) {
      shipmentRowsByOrder.set(orderId, [
        ...(shipmentRowsByOrder.get(orderId) || []),
        row
      ]);
    }
  }

  for (const row of dropShipRows) {
    const orderId = normalizeText(row?.relatedOrder?.id);

    if (orderId) {
      dropShipRowsByOrder.set(orderId, [
        ...(dropShipRowsByOrder.get(orderId) || []),
        row
      ]);
    }
  }

  return orderDetails.map((order) => ({
    ...order,
    shipmentFulfillmentsGrid: {
      rows: shipmentRowsByOrder.get(normalizeText(order?.id)) || []
    },
    dropShipFulfillmentsGrid: {
      rows: dropShipRowsByOrder.get(normalizeText(order?.id)) || []
    }
  }));
}

function getItemDecisions(item) {
  return (item?.decidedItems || []).flatMap((group) => group?.decisions || []);
}

function getPackingItem(part, item, details = {}) {
  return {
    sku: part.sku,
    name: normalizeText(item?.relatedProduct?.name || part.name),
    orderedQuantity: Math.max(Number(item?.qty || 0), 0),
    packingListQuantity: part.receivedQuantity,
    poNumbers: part.sources.map((source) => source.poNumber),
    fulfillmentState: normalizeText(details.fulfillmentState),
    trackingCode: normalizeText(details.trackingCode),
    reason: normalizeText(details.reason)
  };
}

function addGroupedOrder(group, order, item) {
  let result = group.get(order.id);

  if (!result) {
    result = {
      orderId: order.id,
      orderNumber: order.label,
      customerName: normalizeText(order.customer_name),
      orderState: normalizeText(order.state),
      createdAt: normalizeText(order.created_at),
      orderUrl: getSkuNexusUrl(`/orders/${order.id}`),
      items: []
    };
    group.set(order.id, result);
  }

  const itemKey = [
    normalizeSku(item.sku),
    normalizeText(item.fulfillmentState),
    normalizeText(item.trackingCode),
    normalizeText(item.reason)
  ].join("|");

  if (!result.items.some((existing) => existing._key === itemKey)) {
    result.items.push({ ...item, _key: itemKey });
  }
}

function finalizeGroup(group) {
  return Array.from(group.values())
    .map((order) => ({
      ...order,
      items: order.items.map(({ _key, ...item }) => item)
    }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function classifyOrders(orderDetails, packingParts, backorders) {
  const partsBySku = new Map(
    packingParts.map((part) => [normalizeSku(part.sku), part])
  );
  const backorderKeys = new Set(
    backorders
      .filter((backorder) => Number(backorder?.missing_qty || 0) > 0)
      .map(
        (backorder) =>
          `${normalizeText(backorder?.order_id)}|${normalizeSku(
            backorder?.relatedProduct?.sku
          )}`
      )
  );
  const groups = {
    warehouse: new Map(),
    backordered: new Map(),
    missingTracking: new Map(),
    notSent: new Map()
  };

  for (const order of orderDetails.filter(Boolean)) {
    const warehouseFulfillments = new Map(
      (order.shipmentFulfillmentsGrid?.rows || []).map((fulfillment) => [
        normalizeText(fulfillment.id),
        fulfillment
      ])
    );
    const dropShipFulfillments = new Map(
      (order.dropShipFulfillmentsGrid?.rows || []).map((fulfillment) => [
        normalizeText(fulfillment.id),
        fulfillment
      ])
    );

    for (const item of order.items || []) {
      const skuKey = normalizeSku(item?.relatedProduct?.sku);
      const part = partsBySku.get(skuKey);

      if (!part) {
        continue;
      }

      const isBackordered = backorderKeys.has(`${order.id}|${skuKey}`);

      if (isBackordered) {
        addGroupedOrder(
          groups.backordered,
          order,
          getPackingItem(part, item, {
            reason: "SKU Nexus shows an active backorder quantity."
          })
        );
      }

      const decisions = getItemDecisions(item);
      let hasOpenFulfillment = false;

      for (const decision of decisions) {
        const fulfillmentId = normalizeText(decision?.relatedFulfillment?.id);
        const warehouseFulfillment = warehouseFulfillments.get(fulfillmentId);
        const dropShipFulfillment = dropShipFulfillments.get(fulfillmentId);

        if (warehouseFulfillment) {
          const state = normalizeState(warehouseFulfillment.current_state);

          if (!closedWarehouseStates.has(state)) {
            hasOpenFulfillment = true;
            addGroupedOrder(
              groups.warehouse,
              order,
              getPackingItem(part, item, {
                fulfillmentState: warehouseFulfillment.current_state,
                reason: `Warehouse fulfillment from ${normalizeText(
                  warehouseFulfillment.fulfillFrom?.label
                ) || "DPP Warehouse"} is still open.`
              })
            );
          }

          continue;
        }

        if (dropShipFulfillment) {
          const state = normalizeState(dropShipFulfillment.current_state);

          if (closedDropShipStates.has(state)) {
            continue;
          }

          hasOpenFulfillment = true;
          const trackingCode = normalizeText(
            dropShipFulfillment.relatedPurchaseOrder?.tracking_code
          );
          const reportItem = getPackingItem(part, item, {
            fulfillmentState: dropShipFulfillment.current_state,
            trackingCode,
            reason: trackingCode
              ? "Manufacturer fulfillment has tracking but is not finalized."
              : "Manufacturer fulfillment has not received tracking."
          });

          addGroupedOrder(
            trackingCode ? groups.notSent : groups.missingTracking,
            order,
            reportItem
          );
        }
      }

      if (
        !hasOpenFulfillment &&
        !isBackordered &&
        (Number(item.decidable_qty || 0) > 0 || decisions.length === 0)
      ) {
        addGroupedOrder(
          groups.notSent,
          order,
          getPackingItem(part, item, {
            reason: "Matching quantity is still unassigned or has not been sent."
          })
        );
      }
    }
  }

  return {
    warehouse: finalizeGroup(groups.warehouse),
    backordered: finalizeGroup(groups.backordered),
    missingTracking: finalizeGroup(groups.missingTracking),
    notSent: finalizeGroup(groups.notSent)
  };
}

function manufacturerMatches(expectedManufacturer, vendorName) {
  const expected = normalizeText(expectedManufacturer).toLowerCase();
  const actual = normalizeText(vendorName).toLowerCase();

  if (!expected || !actual) {
    return false;
  }

  return actual.includes(expected) || expected.includes(actual);
}

async function createPackingListReport(input = {}) {
  const poNumbers = parsePurchaseOrderInput(input.purchaseOrders);
  const manufacturer = normalizeText(input.manufacturer);
  const receivedFrom = validateDate(input.receivedFrom, "Received from date");
  const receivedTo = validateDate(input.receivedTo, "Received through date");

  if (!manufacturer) {
    throw createHttpError(400, "Manufacturer is required.");
  }

  if (receivedFrom > receivedTo) {
    throw createHttpError(400, "Received from date must be before the through date.");
  }

  const purchaseOrders = await fetchPurchaseOrders(poNumbers);
  const purchaseOrdersByLabel = new Map(
    purchaseOrders.map((purchaseOrder) => [purchaseOrder.label, purchaseOrder])
  );
  const missingPurchaseOrders = poNumbers.filter(
    (poNumber) => !purchaseOrdersByLabel.has(poNumber)
  );
  const mismatchedPurchaseOrders = purchaseOrders
    .filter(
      (purchaseOrder) =>
        !manufacturerMatches(manufacturer, purchaseOrder.vendor?.name)
    )
    .map((purchaseOrder) => ({
      poNumber: purchaseOrder.label,
      vendorName: normalizeText(purchaseOrder.vendor?.name)
    }));
  const details = await fetchPurchaseOrderDetails(purchaseOrders);
  const { parts, purchaseOrders: purchaseOrderSummary } = buildPackingParts(
    details.filter(Boolean),
    receivedFrom,
    receivedTo
  );
  const warnings = [];

  if (missingPurchaseOrders.length > 0) {
    warnings.push(
      `Purchase orders not found: ${missingPurchaseOrders.join(", ")}.`
    );
  }

  if (mismatchedPurchaseOrders.length > 0) {
    warnings.push(
      `Vendor did not match ${mismatchedPurchaseOrders
        .map((purchaseOrder) => `${purchaseOrder.poNumber} (${purchaseOrder.vendorName})`)
        .join(", ")}.`
    );
  }

  const noReceipts = purchaseOrderSummary
    .filter((purchaseOrder) => purchaseOrder.receivedQuantity === 0)
    .map((purchaseOrder) => purchaseOrder.poNumber);

  if (noReceipts.length > 0) {
    warnings.push(
      `No receipt entries were found in the selected date range for: ${noReceipts.join(", ")}.`
    );
  }

  if (parts.length === 0) {
    return {
      manufacturer,
      receivedFrom,
      receivedTo,
      purchaseOrders: purchaseOrderSummary,
      parts,
      groups: {
        warehouse: [],
        backordered: [],
        missingTracking: [],
        notSent: []
      },
      warnings
    };
  }

  const skus = parts.map((part) => part.sku);
  const [orders, backorders] = await Promise.all([
    fetchActiveOrders(skus),
    fetchBackorders(skus)
  ]);
  const orderDetails = await addFulfillmentsToOrders(
    await fetchOrderDetails(orders),
    orders
  );

  return {
    manufacturer,
    receivedFrom,
    receivedTo,
    purchaseOrders: purchaseOrderSummary,
    parts,
    groups: classifyOrders(orderDetails, parts, backorders),
    warnings
  };
}

module.exports = {
  createPackingListReport,
  _test: {
    buildPackingParts,
    classifyOrders,
    manufacturerMatches,
    parsePurchaseOrderInput,
    parseReceiptDate,
    parseReceiptEntries
  }
};
