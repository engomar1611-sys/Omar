function auth(app, permission) { return { preHandler: [app.authenticate, app.requirePermission(permission)] }; }
function bad(reply, message = 'البيانات المدخلة غير صحيحة') { return reply.code(400).send({ error: 'VALIDATION_ERROR', message }); }
function fail(reply, error) {
  if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE' });
  if (error.code === '23503') return reply.code(409).send({ error: 'REFERENCED' });
  if (error.code === '23514' || error.code === '22P02') return reply.code(400).send({ error: 'INVALID_DATA' });
  if (error.code === 'P0001') return reply.code(409).send({ error: 'BUSINESS_RULE', message: error.message });
  throw error;
}
async function tx(db, work) {
  const client = await db.connect();
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0;

export async function salesDeliveryRoutes(app, { db }) {
  app.get('/api/v1/sales/deliveries', auth(app, 'SALES_DELIVERIES.READ'), async (_req, reply) => {
    try {
      return (await db.query(`SELECT d.*,i.invoice_no,c.name_ar customer_name,
        COALESCE(json_agg(json_build_object('id',l.id,'invoiceLineId',l.invoice_line_id,'itemId',l.item_id,
          'lotNo',l.lot_no,'plannedQty',l.planned_qty,'shippedQty',l.shipped_qty,'deliveredQty',l.delivered_qty))
          FILTER (WHERE l.id IS NOT NULL),'[]'::json) lines
        FROM sales_deliveries d JOIN sales_invoices i ON i.id=d.sales_invoice_id
        JOIN customers c ON c.id=i.customer_id LEFT JOIN sales_delivery_lines l ON l.sales_delivery_id=d.id
        GROUP BY d.id,i.invoice_no,c.name_ar ORDER BY d.created_at DESC`)).rows;
    } catch (error) { return fail(reply, error); }
  });
  app.post('/api/v1/sales/deliveries', auth(app, 'SALES_DELIVERIES.MANAGE'), async (req, reply) => {
    const b=req.body??{};
    if(!text(b.deliveryNo,40)||!b.invoiceId||!Array.isArray(b.lines)||!b.lines.length||
      b.lines.some(l=>!l.invoiceLineId||!positive(l.quantity))||
      (b.driverName!=null&&!text(b.driverName,160))||(b.vehicleNo!=null&&!text(b.vehicleNo,40))) return bad(reply);
    try {
      const result=await tx(db,async c=>{
        const inv=await c.query('SELECT id,status FROM sales_invoices WHERE id=$1 FOR UPDATE',[b.invoiceId]);
        if(!inv.rowCount||!['POSTED','PARTIALLY_PAID','PAID'].includes(inv.rows[0].status))
          throw Object.assign(new Error('يجب أن تكون فاتورة البيع مرحلة وغير ملغاة'),{code:'P0001'});
        const h=await c.query(`INSERT INTO sales_deliveries(delivery_no,sales_invoice_id,delivery_date,shipping_address,driver_name,vehicle_no,notes,prepared_by)
          VALUES($1,$2,COALESCE($3::date,CURRENT_DATE),$4,$5,$6,$7,$8) RETURNING *`,
          [b.deliveryNo.trim(),b.invoiceId,b.deliveryDate??null,b.shippingAddress??null,b.driverName??null,b.vehicleNo??null,b.notes??null,req.authUser.user_id]);
        for(const l of b.lines){
          const src=await c.query('SELECT id,item_id,lot_no,quantity FROM sales_invoice_lines WHERE id=$1 AND sales_invoice_id=$2 FOR UPDATE',[l.invoiceLineId,b.invoiceId]);
          if(!src.rowCount)throw Object.assign(new Error('بند الفاتورة غير موجود'),{code:'P0001'});
          const reserved=await c.query(`SELECT COALESCE(SUM(dl.planned_qty),0) qty FROM sales_delivery_lines dl
            JOIN sales_deliveries d ON d.id=dl.sales_delivery_id WHERE dl.invoice_line_id=$1 AND d.status<>'CANCELLED'`,[l.invoiceLineId]);
          if(Number(reserved.rows[0].qty)+Number(l.quantity)>Number(src.rows[0].quantity)+0.000001)
            throw Object.assign(new Error('كمية التجهيز تتجاوز الكمية المتبقية في الفاتورة'),{code:'P0001'});
          await c.query('INSERT INTO sales_delivery_lines(sales_delivery_id,invoice_line_id,item_id,lot_no,planned_qty) VALUES($1,$2,$3,$4,$5)',
            [h.rows[0].id,src.rows[0].id,src.rows[0].item_id,src.rows[0].lot_no,l.quantity]);
        }
        return {...h.rows[0],lineCount:b.lines.length};
      });
      return reply.code(201).send(result);
    } catch(error){return fail(reply,error);}
  });
  app.post('/api/v1/sales/deliveries/:id/ready',auth(app,'SALES_DELIVERIES.MANAGE'),async(req,reply)=>{
    try{
      const r=await db.query(`UPDATE sales_deliveries d SET status='READY' WHERE d.id=$1 AND d.status='PREPARING'
        AND EXISTS(SELECT 1 FROM sales_delivery_lines l WHERE l.sales_delivery_id=d.id) RETURNING d.*`,[req.params.id]);
      if(!r.rowCount)return reply.code(409).send({error:'INVALID_STATUS_OR_EMPTY'});
      return r.rows[0];
    }catch(e){return fail(reply,e);}
  });
  app.post('/api/v1/sales/deliveries/:id/dispatch',auth(app,'SALES_DELIVERIES.DISPATCH'),async(req,reply)=>{
    try{
      const result=await tx(db,async c=>{
        const h=await c.query('SELECT * FROM sales_deliveries WHERE id=$1 FOR UPDATE',[req.params.id]);
        if(!h.rowCount||h.rows[0].status!=='READY')throw Object.assign(new Error('أمر التسليم غير جاهز للشحن'),{code:'P0001'});
        const lines=await c.query('SELECT id,planned_qty FROM sales_delivery_lines WHERE sales_delivery_id=$1 FOR UPDATE',[req.params.id]);
        if(!lines.rowCount)throw Object.assign(new Error('أمر التسليم بلا بنود'),{code:'P0001'});
        for(const l of lines.rows)await c.query('UPDATE sales_delivery_lines SET shipped_qty=planned_qty WHERE id=$1',[l.id]);
        const updated=await c.query(`UPDATE sales_deliveries SET status='SHIPPED',shipped_by=$1,shipped_at=NOW() WHERE id=$2 RETURNING *`,[req.authUser.user_id,req.params.id]);
        return {...updated.rows[0],shippedLines:lines.rowCount};
      });
      return result;
    }catch(e){return fail(reply,e);}
  });
  app.post('/api/v1/sales/deliveries/:id/confirm-delivery',auth(app,'SALES_DELIVERIES.CONFIRM'),async(req,reply)=>{
    const lines=req.body?.lines;
    if(!Array.isArray(lines)||!lines.length||lines.some(l=>!l.lineId||!Number.isFinite(Number(l.deliveredQty))||Number(l.deliveredQty)<0))
      return bad(reply,'أدخل الكمية المستلمة لكل بند');
    try{
      const result=await tx(db,async c=>{
        const h=await c.query('SELECT * FROM sales_deliveries WHERE id=$1 FOR UPDATE',[req.params.id]);
        if(!h.rowCount||!['SHIPPED','PARTIALLY_DELIVERED'].includes(h.rows[0].status))
          throw Object.assign(new Error('أمر التسليم غير مشحون أو مغلق'),{code:'P0001'});
        const seen=new Set();
        for(const l of lines){
          if(seen.has(l.lineId))throw Object.assign(new Error('تكرار بند في تأكيد التسليم'),{code:'P0001'});
          seen.add(l.lineId);
          const src=await c.query('SELECT id,shipped_qty,delivered_qty FROM sales_delivery_lines WHERE id=$1 AND sales_delivery_id=$2 FOR UPDATE',[l.lineId,req.params.id]);
          if(!src.rowCount)throw Object.assign(new Error('بند أمر التسليم غير موجود'),{code:'P0001'});
          const remaining=Number(src.rows[0].shipped_qty)-Number(src.rows[0].delivered_qty),q=Number(l.deliveredQty);
          if(q>remaining+0.000001)throw Object.assign(new Error('الكمية المستلمة تتجاوز الكمية المشحونة المتبقية'),{code:'P0001'});
          await c.query('UPDATE sales_delivery_lines SET delivered_qty=delivered_qty+$1 WHERE id=$2',[q,l.lineId]);
        }
        const totals=await c.query('SELECT COALESCE(SUM(shipped_qty),0) shipped,COALESCE(SUM(delivered_qty),0) delivered FROM sales_delivery_lines WHERE sales_delivery_id=$1',[req.params.id]);
        const delivered=Number(totals.rows[0].delivered),shipped=Number(totals.rows[0].shipped);
        const status=shipped>0&&Math.abs(shipped-delivered)<=0.000001?'DELIVERED':'PARTIALLY_DELIVERED';
        const updated=await c.query('UPDATE sales_deliveries SET status=$1,delivered_by=$2,delivered_at=NOW() WHERE id=$3 RETURNING *',[status,req.authUser.user_id,req.params.id]);
        return {...updated.rows[0],deliveredQty:delivered,remainingQty:shipped-delivered};
      });
      return result;
    }catch(e){return fail(reply,e);}
  });
  app.post('/api/v1/sales/deliveries/:id/cancel',auth(app,'SALES_DELIVERIES.MANAGE'),async(req,reply)=>{
    try{
      const r=await db.query(`UPDATE sales_deliveries SET status='CANCELLED' WHERE id=$1 AND status IN ('PREPARING','READY') RETURNING *`,[req.params.id]);
      if(!r.rowCount)return reply.code(409).send({error:'INVALID_STATUS'});
      return r.rows[0];
    }catch(e){return fail(reply,e);}
  });
}
