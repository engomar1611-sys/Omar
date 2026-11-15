const auth = (app, permission) => ({ preHandler: [app.authenticate, app.requirePermission(permission)] });
const invalid = (reply, error = 'VALIDATION_ERROR') => reply.code(400).send({ error });
const conflict = (reply, error = 'BUSINESS_RULE') => reply.code(409).send({ error });
const textOk = (value, max = 40) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0;
const nonNegative = value => Number.isFinite(Number(value)) && Number(value) >= 0;
const validDate = value => {
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(text + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text;
};
async function tx(db, callback) {
  const client = await db.connect();
  try { await client.query('BEGIN'); const result = await callback(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
function fail(reply, error) {
  if (error.code === '23505') return conflict(reply, 'DUPLICATE');
  if (error.code === '23503') return conflict(reply, 'INVALID_REFERENCE');
  if (error.code === '23514' || error.code === '22P02' || error.code === '22007') return invalid(reply);
  if (error.code === 'P0001') return conflict(reply, error.message);
  throw error;
}

export async function salesQuotesOrdersRoutes(app, { db }) {
  app.get('/api/v1/sales/quotations', auth(app, 'SALES_QUOTES.READ'), async (_request, reply) => {
    try {
      return (await db.query(`
        SELECT q.*, c.code customer_code, c.name_ar customer_name, w.code warehouse_code,
          COALESCE(json_agg(json_build_object(
            'id', l.id, 'itemId', l.item_id, 'itemCode', i.code, 'itemName', i.name_ar,
            'quantity', l.quantity, 'unitPrice', l.unit_price, 'lineTotal', l.quantity*l.unit_price, 'notes', l.notes
          )) FILTER (WHERE l.id IS NOT NULL), '[]'::json) lines
        FROM customer_quotations q
        JOIN customers c ON c.id=q.customer_id JOIN warehouses w ON w.id=q.warehouse_id
        LEFT JOIN customer_quotation_lines l ON l.quotation_id=q.id
        LEFT JOIN items i ON i.id=l.item_id
        GROUP BY q.id,c.code,c.name_ar,w.code
        ORDER BY q.quote_date DESC,q.quote_no DESC
      `)).rows;
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/v1/sales/quotations', auth(app, 'SALES_QUOTES.MANAGE'), async (request, reply) => {
    const body = request.body ?? {};
    if (!textOk(body.quoteNo) || !body.customerId || !body.warehouseId || !Array.isArray(body.lines) || !body.lines.length ||
        body.lines.some(line => !line || !line.itemId || !positive(line.quantity) || !nonNegative(line.unitPrice)) ||
        (body.validUntil != null && body.validUntil !== '' && !validDate(body.validUntil)) ||
        !nonNegative(body.discountAmount ?? 0)) return invalid(reply);
    try {
      const result = await tx(db, async client => {
        const customer = await client.query('SELECT id FROM customers WHERE id=$1 AND is_active=TRUE', [body.customerId]);
        const warehouse = await client.query('SELECT id FROM warehouses WHERE id=$1 AND is_active=TRUE', [body.warehouseId]);
        if (!customer.rowCount || !warehouse.rowCount) return { conflict: 'CUSTOMER_OR_WAREHOUSE_INACTIVE' };
        const header = await client.query(`
          INSERT INTO customer_quotations(quote_no,customer_id,warehouse_id,valid_until,discount_amount,notes,created_by)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *
        `, [body.quoteNo.trim(),body.customerId,body.warehouseId,body.validUntil||null,body.discountAmount??0,body.notes??null,request.authUser.user_id]);
        let subtotal=0;
        for(let index=0;index<body.lines.length;index++){
          const line=body.lines[index];
          const item=await client.query('SELECT id FROM items WHERE id=$1 AND is_active=TRUE',[line.itemId]);
          if(!item.rowCount)throw Object.assign(new Error('صنف غير موجود أو غير نشط'),{code:'P0001'});
          subtotal+=Number(line.quantity)*Number(line.unitPrice);
          await client.query(`
            INSERT INTO customer_quotation_lines(quotation_id,line_no,item_id,quantity,unit_price,notes)
            VALUES($1,$2,$3,$4,$5,$6)
          `,[header.rows[0].id,index+1,line.itemId,line.quantity,line.unitPrice,line.notes??null]);
        }
        if(Number(body.discountAmount??0)>subtotal)throw Object.assign(new Error('الخصم أكبر من إجمالي العرض'),{code:'P0001'});
        return {quotation:header.rows[0],subtotal,totalAmount:subtotal-Number(body.discountAmount??0),lineCount:body.lines.length};
      });
      if(result.conflict)return conflict(reply,result.conflict);
      return reply.code(201).send(result);
    } catch(error){return fail(reply,error);}
  });

  app.post('/api/v1/sales/quotations/:id/submit', auth(app, 'SALES_QUOTES.MANAGE'), async (request, reply) => {
    try {
      const result=await db.query(`
        UPDATE customer_quotations q SET status='PENDING_APPROVAL'
        WHERE q.id=$1 AND q.status='DRAFT'
          AND EXISTS(SELECT 1 FROM customer_quotation_lines l WHERE l.quotation_id=q.id)
        RETURNING q.*
      `,[request.params.id]);
      if(!result.rowCount)return conflict(reply,'INVALID_STATUS_OR_EMPTY_QUOTATION');
      return result.rows[0];
    }catch(error){return fail(reply,error);}
  });

  app.post('/api/v1/sales/quotations/:id/approve', auth(app, 'SALES_QUOTES.APPROVE'), async (request, reply) => {
    try {
      const result=await db.query(`
        UPDATE customer_quotations SET status='APPROVED',approved_by=$1,approved_at=NOW()
        WHERE id=$2 AND status='PENDING_APPROVAL'
          AND (valid_until IS NULL OR valid_until>=CURRENT_DATE)
        RETURNING *
      `,[request.authUser.user_id,request.params.id]);
      if(!result.rowCount)return conflict(reply,'INVALID_STATUS_OR_EXPIRED_QUOTATION');
      return result.rows[0];
    }catch(error){return fail(reply,error);}
  });

  app.post('/api/v1/sales/quotations/:id/reject', auth(app, 'SALES_QUOTES.APPROVE'), async (request, reply) => {
    try {
      const result=await db.query(`
        UPDATE customer_quotations SET status='REJECTED'
        WHERE id=$1 AND status='PENDING_APPROVAL' RETURNING *
      `,[request.params.id]);
      if(!result.rowCount)return conflict(reply,'INVALID_STATUS');
      return result.rows[0];
    }catch(error){return fail(reply,error);}
  });

  app.post('/api/v1/sales/quotations/:id/convert-to-order', auth(app, 'SALES_ORDERS.MANAGE'), async (request, reply) => {
    const body=request.body??{};
    if(!textOk(body.orderNo))return invalid(reply);
    try {
      const result=await tx(db,async client=>{
        const quote=await client.query('SELECT * FROM customer_quotations WHERE id=$1 FOR UPDATE',[request.params.id]);
        if(!quote.rowCount||quote.rows[0].status!=='APPROVED')return {conflict:'QUOTATION_NOT_APPROVED'};
        if(quote.rows[0].valid_until&&quote.rows[0].valid_until.toISOString?.().slice(0,10)<new Date().toISOString().slice(0,10))return {conflict:'QUOTATION_EXPIRED'};
        const lines=await client.query('SELECT * FROM customer_quotation_lines WHERE quotation_id=$1 ORDER BY line_no',[request.params.id]);
        if(!lines.rowCount)return {conflict:'EMPTY_QUOTATION'};
        const order=await client.query(`
          INSERT INTO sales_orders(order_no,source_quotation_id,customer_id,warehouse_id,discount_amount,created_by)
          VALUES($1,$2,$3,$4,$5,$6) RETURNING *
        `,[body.orderNo.trim(),quote.rows[0].id,quote.rows[0].customer_id,quote.rows[0].warehouse_id,quote.rows[0].discount_amount,request.authUser.user_id]);
        const reservations=[];
        for(let index=0;index<lines.rows.length;index++){
          const source=lines.rows[index];
          const orderLine=await client.query(`
            INSERT INTO sales_order_lines(sales_order_id,line_no,item_id,ordered_qty,unit_price)
            VALUES($1,$2,$3,$4,$5) RETURNING *
          `,[order.rows[0].id,index+1,source.item_id,source.quantity,source.unit_price]);
          const lots=await client.query(`
            SELECT b.lot_no,b.quantity,b.expiry_date
            FROM inventory_balances b
            WHERE b.warehouse_id=$1 AND b.item_id=$2 AND b.quantity>0 AND b.quality_status='RELEASED'
            ORDER BY b.expiry_date ASC NULLS LAST,b.lot_no
            FOR UPDATE OF b
          `,[quote.rows[0].warehouse_id,source.item_id]);
          const held=await client.query(`
            SELECT lot_no,COALESCE(SUM(held_qty),0) held_qty
            FROM inventory_quality_holds
            WHERE warehouse_id=$1 AND item_id=$2 AND status IN ('PENDING_QC','QUARANTINED')
            GROUP BY lot_no
          `,[quote.rows[0].warehouse_id,source.item_id]);
          const reserved=await client.query(`
            SELECT lot_no,COALESCE(SUM(reserved_qty),0) reserved_qty
            FROM sales_order_reservations
            WHERE warehouse_id=$1 AND item_id=$2 AND status='RESERVED'
            GROUP BY lot_no
          `,[quote.rows[0].warehouse_id,source.item_id]);
          const heldByLot=new Map(held.rows.map(row=>[row.lot_no,Number(row.held_qty)]));
          const reservedByLot=new Map(reserved.rows.map(row=>[row.lot_no,Number(row.reserved_qty)]));
          let remaining=Number(source.quantity);
          for(const lot of lots.rows){
            const available=Math.max(0,Number(lot.quantity)-(heldByLot.get(lot.lot_no)??0)-(reservedByLot.get(lot.lot_no)??0));
            if(available<=0.000001)continue;
            const quantity=Math.min(remaining,available);
            await client.query(`
              INSERT INTO sales_order_reservations(sales_order_id,sales_order_line_id,warehouse_id,item_id,lot_no,reserved_qty)
              VALUES($1,$2,$3,$4,$5,$6)
            `,[order.rows[0].id,orderLine.rows[0].id,quote.rows[0].warehouse_id,source.item_id,lot.lot_no,quantity]);
            reservations.push({salesOrderLineId:orderLine.rows[0].id,itemId:source.item_id,lotNo:lot.lot_no,quantity});
            remaining-=quantity;
            if(remaining<=0.000001)break;
          }
          if(remaining>0.000001)throw Object.assign(new Error('المخزون المتاح غير كافٍ لحجز الصنف '+source.item_id),{code:'P0001'});
        }
        await client.query("UPDATE customer_quotations SET status='CONVERTED' WHERE id=$1",[request.params.id]);
        return {salesOrder:order.rows[0],lineCount:lines.rowCount,reservations};
      });
      if(result.conflict)return conflict(reply,result.conflict);
      return reply.code(201).send(result);
    }catch(error){return fail(reply,error);}
  });

  app.get('/api/v1/sales/orders', auth(app, 'SALES_ORDERS.READ'), async (_request, reply) => {
    try {
      return (await db.query(`
        SELECT o.*,c.code customer_code,c.name_ar customer_name,w.code warehouse_code,
          q.quote_no source_quote_no,
          COALESCE(json_agg(json_build_object(
            'id',l.id,'itemId',l.item_id,'itemCode',i.code,'itemName',i.name_ar,
            'orderedQty',l.ordered_qty,'invoicedQty',l.invoiced_qty,'deliveredQty',l.delivered_qty,
            'unitPrice',l.unit_price,
            'reservations',COALESCE((SELECT json_agg(json_build_object('lotNo',r.lot_no,'quantity',r.reserved_qty,'status',r.status))
              FROM sales_order_reservations r WHERE r.sales_order_line_id=l.id),'[]'::json)
          )) FILTER(WHERE l.id IS NOT NULL),'[]'::json) lines
        FROM sales_orders o JOIN customers c ON c.id=o.customer_id
        JOIN warehouses w ON w.id=o.warehouse_id JOIN customer_quotations q ON q.id=o.source_quotation_id
        LEFT JOIN sales_order_lines l ON l.sales_order_id=o.id
        LEFT JOIN items i ON i.id=l.item_id
        GROUP BY o.id,c.code,c.name_ar,w.code,q.quote_no
        ORDER BY o.order_date DESC,o.order_no DESC
      `)).rows;
    }catch(error){return fail(reply,error);}
  });

  app.post('/api/v1/sales/orders/:id/cancel', auth(app, 'SALES_ORDERS.CANCEL'), async (request, reply) => {
    try{
      const result=await tx(db,async client=>{
        const order=await client.query('SELECT * FROM sales_orders WHERE id=$1 FOR UPDATE',[request.params.id]);
        if(!order.rowCount||order.rows[0].status!=='OPEN')return {conflict:'ORDER_NOT_CANCELLABLE'};
        const invoice=await client.query('SELECT id FROM sales_invoices WHERE sales_order_id=$1',[request.params.id]);
        if(invoice.rowCount)return {conflict:'ORDER_ALREADY_INVOICED'};
        await client.query("UPDATE sales_order_reservations SET status='RELEASED' WHERE sales_order_id=$1 AND status='RESERVED'",[request.params.id]);
        const updated=await client.query("UPDATE sales_orders SET status='CANCELLED' WHERE id=$1 RETURNING *",[request.params.id]);
        return {salesOrder:updated.rows[0],released:true};
      });
      if(result.conflict)return conflict(reply,result.conflict);
      return result;
    }catch(error){return fail(reply,error);}
  });
}
