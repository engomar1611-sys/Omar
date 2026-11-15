import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../src/app.mjs';

const enabled = Boolean(process.env.DATABASE_URL && process.env.BOOTSTRAP_ADMIN_USERNAME && process.env.BOOTSTRAP_ADMIN_PASSWORD);

test('transport fleet trip dispatch, partial delivery re-trip, POD and cumulative cost allocation', { skip: !enabled }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const app = buildApp({ logger: false, db: pool, jwtSecret: process.env.AUTH_JWT_SECRET });
  const suffix = Date.now().toString();
  const code = prefix => (prefix + suffix).slice(0, 40);
  const future = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  try {
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { username: process.env.BOOTSTRAP_ADMIN_USERNAME, password: process.env.BOOTSTRAP_ADMIN_PASSWORD }
    });
    assert.equal(login.statusCode, 200, login.body);
    const headers = { authorization: 'Bearer ' + login.json().accessToken, 'content-type': 'application/json' };

    const company = (await pool.query('INSERT INTO companies(code,name_ar) VALUES($1,$2) RETURNING id', [code('TC'), 'شركة نقل اختبار'])).rows[0];
    const plant = (await pool.query('INSERT INTO plants(company_id,code,name_ar) VALUES($1,$2,$3) RETURNING id', [company.id, code('PL'), 'مصنع نقل اختبار'])).rows[0];
    const warehouse = (await pool.query('INSERT INTO warehouses(plant_id,code,name_ar) VALUES($1,$2,$3) RETURNING id', [plant.id, code('WH'), 'مخزن نقل اختبار'])).rows[0];
    const unit = (await pool.query('INSERT INTO units_of_measure(code,name_ar) VALUES($1,$2) RETURNING id', [code('KG'), 'كيلوجرام'])).rows[0];
    const category = (await pool.query("INSERT INTO item_categories(code,name_ar,category_kind) VALUES($1,$2,'FINISHED_GOOD') RETURNING id", [code('FG'), 'منتج نقل اختبار'])).rows[0];
    const item = (await pool.query('INSERT INTO items(code,name_ar,category_id,base_unit_id) VALUES($1,$2,$3,$4) RETURNING id', [code('FEED'), 'علف نقل اختبار', category.id, unit.id])).rows[0];
    const customer = (await pool.query('INSERT INTO customers(code,name_ar,credit_limit) VALUES($1,$2,0) RETURNING id', [code('CUS'), 'عميل نقل اختبار'])).rows[0];
    await pool.query(`INSERT INTO inventory_balances(warehouse_id,item_id,lot_no,expiry_date,quantity,average_unit_cost,quality_status)
      VALUES($1,$2,$3,'2027-12-31',20,5,'RELEASED')`, [warehouse.id,item.id,'TRIP-'+suffix]);

    const invoice = await app.inject({
      method: 'POST', url: '/api/v1/sales/invoices', headers,
      payload: { invoiceNo: code('INV'), customerId: customer.id, warehouseId: warehouse.id,
        lines: [{ itemId: item.id, lotNo: 'TRIP-'+suffix, quantity: 10, unitPrice: 12 }] }
    });
    assert.equal(invoice.statusCode, 201, invoice.body);
    const invoiceLine = (await pool.query('SELECT id FROM sales_invoice_lines WHERE sales_invoice_id=$1', [invoice.json().id])).rows[0];

    const delivery = await app.inject({
      method: 'POST', url: '/api/v1/sales/deliveries', headers,
      payload: { deliveryNo: code('DEL'), invoiceId: invoice.json().id, lines: [{ invoiceLineId: invoiceLine.id, quantity: 10 }] }
    });
    assert.equal(delivery.statusCode, 201, delivery.body);
    const deliveryId = delivery.json().id;
    const deliveryLine = (await pool.query('SELECT id FROM sales_delivery_lines WHERE sales_delivery_id=$1', [deliveryId])).rows[0];
    const ready = await app.inject({ method: 'POST', url: '/api/v1/sales/deliveries/' + deliveryId + '/ready', headers, payload: {} });
    assert.equal(ready.statusCode, 200, ready.body);

    const vehicle = await app.inject({
      method: 'POST', url: '/api/v1/transport/vehicles', headers,
      payload: { vehicleNo: code('VAN'), plateNo: code('PLATE'), vehicleType: 'Truck', capacityKg: 100,
        currentOdometer: 100, insuranceExpiry: future, licenseExpiry: future }
    });
    assert.equal(vehicle.statusCode, 201, vehicle.body);
    const driver = await app.inject({
      method: 'POST', url: '/api/v1/transport/drivers', headers,
      payload: { driverName: 'سائق اختبار', licenseNo: code('LIC'), licenseExpiry: future }
    });
    assert.equal(driver.statusCode, 201, driver.body);

    const overCapacity = await app.inject({
      method: 'POST', url: '/api/v1/transport/trips', headers,
      payload: { tripNo: code('TR-OVER'), vehicleId: vehicle.json().id, driverId: driver.json().id,
        origin: 'المصنع', destination: 'العميل', plannedDeparture: new Date().toISOString(), odometerStart: 100,
        deliveries: [{ salesDeliveryId: deliveryId, loadWeightKg: 101 }] }
    });
    assert.equal(overCapacity.statusCode, 409, overCapacity.body);

    const trip1 = await app.inject({
      method: 'POST', url: '/api/v1/transport/trips', headers,
      payload: { tripNo: code('TR1'), vehicleId: vehicle.json().id, driverId: driver.json().id,
        origin: 'المصنع', destination: 'العميل', plannedDeparture: new Date().toISOString(), odometerStart: 100,
        deliveries: [{ salesDeliveryId: deliveryId, loadWeightKg: 100 }] }
    });
    assert.equal(trip1.statusCode, 201, trip1.body);
    const trip1Id = trip1.json().trip.id;
    const dispatch1 = await app.inject({ method: 'POST', url: '/api/v1/transport/trips/' + trip1Id + '/dispatch', headers, payload: {} });
    assert.equal(dispatch1.statusCode, 200, dispatch1.body);
    const arrive1 = await app.inject({ method: 'POST', url: '/api/v1/transport/trips/' + trip1Id + '/arrive', headers, payload: { odometerEnd: 120 } });
    assert.equal(arrive1.statusCode, 200, arrive1.body);
    const cost1 = await app.inject({ method: 'POST', url: '/api/v1/transport/trips/' + trip1Id + '/costs', headers, payload: { costType: 'FUEL', amount: 200, liters: 20 } });
    assert.equal(cost1.statusCode, 201, cost1.body);

    const partial = await app.inject({
      method: 'POST', url: '/api/v1/sales/deliveries/' + deliveryId + '/confirm-delivery', headers,
      payload: { lines: [{ lineId: deliveryLine.id, deliveredQty: 4 }] }
    });
    assert.equal(partial.statusCode, 200, partial.body);
    const pod1 = await app.inject({ method: 'POST', url: '/api/v1/transport/trips/' + trip1Id + '/pod', headers, payload: { salesDeliveryId: deliveryId, receivedBy: 'مستلم العميل', notes: 'استلام جزئي' } });
    assert.equal(pod1.statusCode, 200, pod1.body);
    const allocate1 = await app.inject({ method: 'POST', url: '/api/v1/transport/trips/' + trip1Id + '/allocate-costs', headers, payload: { method: 'BY_WEIGHT' } });
    assert.equal(allocate1.statusCode, 200, allocate1.body);
    const complete1 = await app.inject({ method: 'POST', url: '/api/v1/transport/trips/' + trip1Id + '/complete', headers, payload: {} });
    assert.equal(complete1.statusCode, 200, complete1.body);

    const trip2 = await app.inject({
      method: 'POST', url: '/api/v1/transport/trips', headers,
      payload: { tripNo: code('TR2'), vehicleId: vehicle.json().id, driverId: driver.json().id,
        origin: 'المصنع', destination: 'العميل', plannedDeparture: new Date().toISOString(), odometerStart: 120,
        deliveries: [{ salesDeliveryId: deliveryId, loadWeightKg: 60 }] }
    });
    assert.equal(trip2.statusCode, 201, trip2.body);
    const trip2Id = trip2.json().trip.id;
    const dispatch2 = await app.inject({ method: 'POST', url: '/api/v1/transport/trips/' + trip2Id + '/dispatch', headers, payload: {} });
    assert.equal(dispatch2.statusCode, 200, dispatch2.body);
    const arrive2 = await app.inject({ method: 'POST', url: '/api/v1/transport/trips/' + trip2Id + '/arrive', headers, payload: { odometerEnd: 140 } });
    assert.equal(arrive2.statusCode, 200, arrive2.body);
    const cost2 = await app.inject({ method: 'POST', url: '/api/v1/transport/trips/' + trip2Id + '/costs', headers, payload: { costType: 'TOLL', amount: 60 } });
    assert.equal(cost2.statusCode, 201, cost2.body);
    const finalDelivery = await app.inject({
      method: 'POST', url: '/api/v1/sales/deliveries/' + deliveryId + '/confirm-delivery', headers,
      payload: { lines: [{ lineId: deliveryLine.id, deliveredQty: 6 }] }
    });
    assert.equal(finalDelivery.statusCode, 200, finalDelivery.body);
    const pod2 = await app.inject({ method: 'POST', url: '/api/v1/transport/trips/' + trip2Id + '/pod', headers, payload: { salesDeliveryId: deliveryId, receivedBy: 'مستلم العميل', notes: 'استلام نهائي' } });
    assert.equal(pod2.statusCode, 200, pod2.body);
    const allocate2 = await app.inject({ method: 'POST', url: '/api/v1/transport/trips/' + trip2Id + '/allocate-costs', headers, payload: { method: 'BY_WEIGHT' } });
    assert.equal(allocate2.statusCode, 200, allocate2.body);
    const complete2 = await app.inject({ method: 'POST', url: '/api/v1/transport/trips/' + trip2Id + '/complete', headers, payload: {} });
    assert.equal(complete2.statusCode, 200, complete2.body);

    const final = await pool.query('SELECT status,transport_cost FROM sales_deliveries WHERE id=$1', [deliveryId]);
    assert.equal(final.rows[0].status, 'DELIVERED');
    assert.equal(Number(final.rows[0].transport_cost), 260);
    const odometer = await pool.query('SELECT current_odometer FROM transport_vehicles WHERE id=$1', [vehicle.json().id]);
    assert.equal(Number(odometer.rows[0].current_odometer), 140);
    const tripStates = await pool.query('SELECT COUNT(*)::int count FROM transport_trips WHERE id=ANY($1::uuid[]) AND status=\'COMPLETED\'', [[trip1Id,trip2Id]]);
    assert.equal(tripStates.rows[0].count, 2);
  } finally {
    await app.close();
    await pool.end();
  }
});
