const codePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,49}$/;

function dbFailure(reply, error) {
  if (error.code === '23505') {
    return reply.code(409).send({ error: 'DUPLICATE', message: 'الكود أو القيمة مسجلة بالفعل' });
  }
  if (error.code === '23503') {
    return reply.code(409).send({ error: 'REFERENCED', message: 'لا يمكن تنفيذ العملية لوجود ارتباطات أو حركات مرتبطة بالسجل' });
  }
  if (error.code === '23514' || error.code === '22P02') {
    return reply.code(400).send({ error: 'INVALID_DATA', message: 'البيانات المدخلة غير صحيحة' });
  }
  throw error;
}

function validText(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

function routeOptions(app, permission) {
  return { preHandler: [app.authenticate, app.requirePermission(permission)] };
}

export async function masterDataRoutes(app, { db }) {
  const get = async (reply, sql, params = []) => {
    try {
      const result = await db.query(sql, params);
      return result.rows;
    } catch (error) { return dbFailure(reply, error); }
  };
  const post = async (reply, sql, params) => {
    try {
      const result = await db.query(sql, params);
      return reply.code(201).send(result.rows[0]);
    } catch (error) { return dbFailure(reply, error); }
  };

  app.get('/api/v1/master/units', routeOptions(app, 'ITEMS.READ'), async (_req, reply) =>
    get(reply, 'SELECT id, code, name_ar, decimal_places FROM units_of_measure ORDER BY code'));
  app.post('/api/v1/master/units', routeOptions(app, 'UNITS.MANAGE'), async (req, reply) => {
    const { code, nameAr, decimalPlaces = 3 } = req.body ?? {};
    if (!validText(code, 20) || !validText(nameAr, 80) || !Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 6)
      return reply.code(400).send({ error: 'VALIDATION_ERROR' });
    return post(reply, 'INSERT INTO units_of_measure(code,name_ar,decimal_places) VALUES($1,$2,$3) RETURNING id,code,name_ar,decimal_places',
      [code.trim(), nameAr.trim(), decimalPlaces]);
  });

  app.get('/api/v1/master/unit-conversions', routeOptions(app, 'ITEMS.READ'), async (_req, reply) =>
    get(reply, `SELECT c.id,c.from_unit_id,c.to_unit_id,c.factor,
                       f.code AS from_unit_code,f.name_ar AS from_unit_name,
                       t.code AS to_unit_code,t.name_ar AS to_unit_name
                  FROM unit_conversions c
                  JOIN units_of_measure f ON f.id=c.from_unit_id
                  JOIN units_of_measure t ON t.id=c.to_unit_id
                 ORDER BY f.code,t.code`));

  app.post('/api/v1/master/unit-conversions', routeOptions(app, 'UNITS.MANAGE'), async (req, reply) => {
    const { fromUnitId, toUnitId, factor } = req.body ?? {};
    if (!fromUnitId || !toUnitId || fromUnitId === toUnitId || !Number.isFinite(Number(factor)) || Number(factor) <= 0)
      return reply.code(400).send({ error: 'VALIDATION_ERROR' });
    return post(reply, 'INSERT INTO unit_conversions(from_unit_id,to_unit_id,factor) VALUES($1,$2,$3) RETURNING *',
      [fromUnitId, toUnitId, factor]);
  });

  app.get('/api/v1/master/categories', routeOptions(app, 'ITEMS.READ'), async (_req, reply) =>
    get(reply, 'SELECT id,code,name_ar,category_kind,is_active FROM item_categories ORDER BY code'));
  app.post('/api/v1/master/categories', routeOptions(app, 'CATEGORIES.MANAGE'), async (req, reply) => {
    const { code, nameAr, categoryKind } = req.body ?? {};
    const kinds = ['RAW_MATERIAL','PACKAGING','SEMI_FINISHED','FINISHED_GOOD','SPARE_PART','OTHER'];
    if (!validText(code, 30) || !validText(nameAr, 120) || !kinds.includes(categoryKind))
      return reply.code(400).send({ error: 'VALIDATION_ERROR' });
    return post(reply, 'INSERT INTO item_categories(code,name_ar,category_kind) VALUES($1,$2,$3) RETURNING *',
      [code.trim(), nameAr.trim(), categoryKind]);
  });

  app.get('/api/v1/master/items', routeOptions(app, 'ITEMS.READ'), async (req, reply) => {
    const q = typeof req.query?.q === 'string' ? req.query.q.trim() : '';
    return get(reply, `SELECT i.id,i.code,i.name_ar,i.category_id,i.base_unit_id,i.tracks_lot,i.tracks_expiry,i.is_active,
      COALESCE(json_agg(json_build_object('barcode',b.barcode,'unitId',b.unit_id,'isPrimary',b.is_primary))
        FILTER (WHERE b.id IS NOT NULL),'[]'::json) AS barcodes
      FROM items i LEFT JOIN item_barcodes b ON b.item_id=i.id
      WHERE ($1='' OR i.code ILIKE '%'||$1||'%' OR i.name_ar ILIKE '%'||$1||'%')
      GROUP BY i.id ORDER BY i.code LIMIT 200`, [q]);
  });
  app.post('/api/v1/master/items', routeOptions(app, 'ITEMS.MANAGE'), async (req, reply) => {
    const b = req.body ?? {};
    if (!validText(b.code,50) || !validText(b.nameAr,200) || !b.categoryId || !b.baseUnitId)
      return reply.code(400).send({ error: 'VALIDATION_ERROR' });
    try {
      const result = await db.query(
        'INSERT INTO items(code,name_ar,category_id,base_unit_id,tracks_lot,tracks_expiry) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [b.code.trim(),b.nameAr.trim(),b.categoryId,b.baseUnitId,b.tracksLot !== false,b.tracksExpiry === true]);
      return reply.code(201).send(result.rows[0]);
    } catch (error) { return dbFailure(reply,error); }
  });
  app.get('/api/v1/master/barcodes/:barcode', routeOptions(app, 'ITEMS.READ'), async (req, reply) => {
    const rows = await get(reply,
      `SELECT b.barcode,b.unit_id AS unit_id,b.is_primary,
              i.id AS item_id,i.code AS item_code,i.name_ar AS item_name,
              i.category_id,i.base_unit_id,i.tracks_lot,i.tracks_expiry
         FROM item_barcodes b JOIN items i ON i.id=b.item_id
        WHERE b.barcode=$1 AND i.is_active=TRUE`,
      [req.params.barcode]);
    if (!rows || rows.length === 0) return reply.code(404).send({ error:'BARCODE_NOT_FOUND' });
    return rows[0];
  });

  app.post('/api/v1/master/items/:itemId/barcodes', routeOptions(app, 'ITEM_BARCODES.MANAGE'), async (req, reply) => {
    const { barcode, unitId = null, isPrimary = false } = req.body ?? {};
    if (!validText(barcode,100)) return reply.code(400).send({ error: 'VALIDATION_ERROR' });
    try {
      const result = await db.query(
        'INSERT INTO item_barcodes(item_id,barcode,unit_id,is_primary) VALUES($1,$2,$3,$4) RETURNING *',
        [req.params.itemId,barcode.trim(),unitId,isPrimary === true]);
      return reply.code(201).send(result.rows[0]);
    } catch (error) { return dbFailure(reply,error); }
  });

  app.get('/api/v1/master/warehouses', routeOptions(app, 'WAREHOUSES.READ'), async (_req, reply) =>
    get(reply, 'SELECT id,plant_id,code,name_ar,is_active FROM warehouses ORDER BY code'));
  app.post('/api/v1/master/warehouses', routeOptions(app, 'WAREHOUSES.MANAGE'), async (req, reply) => {
    const { plantId, code, nameAr } = req.body ?? {};
    if (!plantId || !validText(code,30) || !validText(nameAr,200))
      return reply.code(400).send({ error: 'VALIDATION_ERROR' });
    return post(reply,'INSERT INTO warehouses(plant_id,code,name_ar) VALUES($1,$2,$3) RETURNING *',
      [plantId,code.trim(),nameAr.trim()]);
  });
  app.get('/api/v1/master/warehouses/:warehouseId/locations', routeOptions(app, 'WAREHOUSES.READ'), async (req, reply) =>
    get(reply,'SELECT id,warehouse_id,code,name_ar,is_active FROM warehouse_locations WHERE warehouse_id=$1 ORDER BY code',[req.params.warehouseId]));
  app.post('/api/v1/master/warehouses/:warehouseId/locations', routeOptions(app, 'WAREHOUSE_LOCATIONS.MANAGE'), async (req, reply) => {
    const { code,nameAr } = req.body ?? {};
    if (!validText(code,40) || !validText(nameAr,120)) return reply.code(400).send({ error:'VALIDATION_ERROR' });
    return post(reply,'INSERT INTO warehouse_locations(warehouse_id,code,name_ar) VALUES($1,$2,$3) RETURNING *',
      [req.params.warehouseId,code.trim(),nameAr.trim()]);
  });

  app.get('/api/v1/master/feed-types', routeOptions(app, 'FEED_TYPES.READ'), async (_req, reply) =>
    get(reply,'SELECT id,code,name_ar,name_en,description,is_active FROM feed_types ORDER BY code'));
  app.post('/api/v1/master/feed-types', routeOptions(app, 'FEED_TYPES.MANAGE'), async (req, reply) => {
    const { code,nameAr,nameEn=null,description=null } = req.body ?? {};
    if (!validText(code,40) || !validText(nameAr,120) || (nameEn !== null && !validText(nameEn,120)))
      return reply.code(400).send({ error:'VALIDATION_ERROR' });
    return post(reply,'INSERT INTO feed_types(code,name_ar,name_en,description) VALUES($1,$2,$3,$4) RETURNING *',
      [code.trim(),nameAr.trim(),nameEn,description]);
  });
  app.get('/api/v1/master/feed-products', routeOptions(app, 'FEED_PRODUCTS.READ'), async (_req, reply) =>
    get(reply,`SELECT fp.id,fp.code,fp.name_ar,fp.feed_type_id,fp.item_id,fp.target_species,fp.product_stage,fp.is_active,
      ft.name_ar AS feed_type_name FROM feed_products fp JOIN feed_types ft ON ft.id=fp.feed_type_id ORDER BY fp.code`));
  app.post('/api/v1/master/feed-products', routeOptions(app, 'FEED_PRODUCTS.MANAGE'), async (req, reply) => {
    const b = req.body ?? {};
    if (!validText(b.code,50) || !validText(b.nameAr,200) || !b.feedTypeId || !b.itemId)
      return reply.code(400).send({ error:'VALIDATION_ERROR' });
    return post(reply,'INSERT INTO feed_products(code,name_ar,feed_type_id,item_id,target_species,product_stage) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [b.code.trim(),b.nameAr.trim(),b.feedTypeId,b.itemId,b.targetSpecies ?? null,b.productStage ?? null]);
  });
}
