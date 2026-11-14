function auth(app, permission) { return { preHandler: [app.authenticate, app.requirePermission(permission)] }; }

async function nextBarcode(db, key, prefix) {
  const r = await db.query(`INSERT INTO barcode_counters(counter_key,next_value) VALUES($1,2)
    ON CONFLICT(counter_key) DO UPDATE SET next_value=barcode_counters.next_value+1
    RETURNING next_value-1 AS allocated`, [key]);
  return prefix + String(r.rows[0].allocated).padStart(10,'0');
}

export async function printingRoutes(app,{db}) {
  app.get('/api/v1/printing/assets',auth(app,'MAINTENANCE.READ'),async(_req,reply)=>{
    return (await db.query(`SELECT a.id,a.asset_code,a.name_ar,a.asset_type,a.barcode,a.location,a.serial_no,
      a.status,c.name_ar AS category_name,p.name_ar AS plant_name
      FROM fixed_assets a LEFT JOIN asset_categories c ON c.id=a.asset_category_id
      LEFT JOIN plants p ON p.id=a.plant_id ORDER BY a.asset_code`)).rows;
  });

  app.post('/api/v1/printing/items/:id/barcode',auth(app,'ITEM_BARCODES.MANAGE'),async(req,reply)=>{
    const client=await db.connect();
    try {
      await client.query('BEGIN');
      const item=await client.query('SELECT id FROM items WHERE id=$1 AND is_active=TRUE FOR UPDATE',[req.params.id]);
      if(!item.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'ITEM_NOT_FOUND'});}
      const existing=await client.query('SELECT barcode FROM item_barcodes WHERE item_id=$1 AND is_primary=TRUE LIMIT 1',[req.params.id]);
      if(existing.rowCount){await client.query('COMMIT');return {barcode:existing.rows[0].barcode,created:false};}
      const barcode=await nextBarcode(client,'ITEM','NFI');
      const inserted=await client.query('INSERT INTO item_barcodes(item_id,barcode,is_primary) VALUES($1,$2,TRUE) RETURNING barcode',[req.params.id,barcode]);
      await client.query('COMMIT');return {barcode:inserted.rows[0].barcode,created:true};
    } catch(e){await client.query('ROLLBACK');if(e.code==='23505')return reply.code(409).send({error:'BARCODE_CONFLICT'});throw e;}
    finally{client.release();}
  });

  app.post('/api/v1/printing/assets/:id/barcode',auth(app,'ASSETS.BARCODE.MANAGE'),async(req,reply)=>{
    const client=await db.connect();
    try {
      await client.query('BEGIN');
      const asset=await client.query('SELECT id,barcode FROM fixed_assets WHERE id=$1 FOR UPDATE',[req.params.id]);
      if(!asset.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'ASSET_NOT_FOUND'});}
      if(asset.rows[0].barcode){await client.query('COMMIT');return {barcode:asset.rows[0].barcode,created:false};}
      const barcode=await nextBarcode(client,'ASSET','NFA');
      await client.query('UPDATE fixed_assets SET barcode=$1 WHERE id=$2',[barcode,req.params.id]);
      await client.query('COMMIT');return {barcode,created:true};
    } catch(e){await client.query('ROLLBACK');if(e.code==='23505')return reply.code(409).send({error:'BARCODE_CONFLICT'});throw e;}
    finally{client.release();}
  });

  app.get('/api/v1/printing/sales-invoices/:id',auth(app,'SALES.READ'),async(req,reply)=>{
    const r=await db.query(`SELECT i.id,i.invoice_no,i.invoice_date,i.status,i.subtotal,i.discount_amount,i.total_amount,
      c.code customer_code,c.name_ar customer_name,c.phone customer_phone,c.address customer_address,
      w.name_ar warehouse_name,co.name_ar company_name,cs.phone company_phone,cs.address company_address,
      cs.tax_number,cs.commercial_register,
      COALESCE((SELECT SUM(ra.amount) FROM receipt_allocations ra JOIN cash_receipts cr ON cr.id=ra.receipt_id
        WHERE ra.sales_invoice_id=i.id AND cr.status='POSTED'),0) AS paid_amount,
      COALESCE((SELECT json_agg(json_build_object('method',cr.payment_method,'receiptNo',cr.receipt_no,'amount',ra.amount)
        ORDER BY cr.receipt_date,cr.receipt_no) FROM receipt_allocations ra JOIN cash_receipts cr ON cr.id=ra.receipt_id
        WHERE ra.sales_invoice_id=i.id AND cr.status='POSTED'),'[]'::json) AS payments,
      COALESCE((SELECT json_agg(json_build_object('itemCode',m.code,'itemName',m.name_ar,
        'quantity',l.quantity,'unitPrice',l.unit_price,'lineTotal',l.line_total,'lotNo',l.lot_no)
        ORDER BY l.id) FROM sales_invoice_lines l JOIN items m ON m.id=l.item_id WHERE l.sales_invoice_id=i.id),'[]'::json) AS lines
      FROM sales_invoices i JOIN customers c ON c.id=i.customer_id JOIN warehouses w ON w.id=i.warehouse_id
      LEFT JOIN plants p ON p.id=w.plant_id LEFT JOIN companies co ON co.id=p.company_id
      LEFT JOIN company_settings cs ON cs.company_id=co.id WHERE i.id=$1 GROUP BY i.id,c.id,w.id,co.id,cs.id`,[req.params.id]);
    if(!r.rowCount)return reply.code(404).send({error:'INVOICE_NOT_FOUND'});
    const x=r.rows[0];x.remaining_amount=Math.max(0,Number(x.total_amount)-Number(x.paid_amount));return x;
  });
}
