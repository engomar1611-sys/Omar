const auth = (app, permission) => ({ preHandler: [app.authenticate, app.requirePermission(permission)] });
const invalid = (reply, error = 'VALIDATION_ERROR') => reply.code(400).send({ error });
const conflict = (reply, error = 'BUSINESS_RULE') => reply.code(409).send({ error });
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0;
const textOk = (value, max = 40) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const validDate = value => {
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(text + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text;
};

async function transaction(db, callback) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function validateSupplierQuotePayload(body, requestLines) {
  if (!body || !textOk(body.quoteNo) || !body.supplierId || (body.currencyCode !== undefined && String(body.currencyCode).trim().toUpperCase() !== 'EGP') || (body.validUntil != null && body.validUntil !== '' && !validDate(body.validUntil)) || !Array.isArray(body.lines) ||
      body.lines.length !== requestLines.length) return false;
  const expected = new Map(requestLines.map(line => [line.id, line]));
  const seen = new Set();
  for (const line of body.lines) {
    const source = expected.get(line.requestLineId);
    if (!source || seen.has(line.requestLineId) || !positive(line.quantity) ||
        !positive(line.unitCost) || Number(line.quantity) !== Number(source.requested_qty)) return false;
    seen.add(line.requestLineId);
  }
  return seen.size === expected.size;
}

export async function supplierQuotationRoutes(app, { db }) {
  app.get('/api/v1/purchase-requests/:id/supplier-quotes', auth(app, 'PURCHASE_QUOTES.READ'), async (request, reply) => {
    try {
      const result = await db.query(`
        SELECT q.*, s.code supplier_code, s.name_ar supplier_name,
          COALESCE(json_agg(json_build_object(
            'id', l.id, 'requestLineId', l.purchase_request_line_id,
            'itemId', l.item_id, 'quantity', l.quoted_qty, 'unitCost', l.unit_cost,
            'lineTotal', l.quoted_qty * l.unit_cost, 'notes', l.notes
          )) FILTER (WHERE l.id IS NOT NULL), '[]'::json) AS lines
        FROM supplier_quotes q
        JOIN suppliers s ON s.id = q.supplier_id
        LEFT JOIN supplier_quote_lines l ON l.supplier_quote_id = q.id
        WHERE q.purchase_request_id = $1
        GROUP BY q.id, s.code, s.name_ar
        ORDER BY q.created_at, q.quote_no
      `, [request.params.id]);
      return result.rows;
    } catch (error) {
      if (error.code === '22P02') return invalid(reply);
      throw error;
    }
  });

  app.post('/api/v1/purchase-requests/:id/supplier-quotes', auth(app, 'PURCHASE_QUOTES.MANAGE'), async (request, reply) => {
    const body = request.body ?? {};
    try {
      const result = await transaction(db, async client => {
        const header = await client.query('SELECT * FROM purchase_requests WHERE id = $1 FOR UPDATE', [request.params.id]);
        if (!header.rowCount || header.rows[0].status !== 'APPROVED' || header.rows[0].purchase_order_id) {
          return { conflict: 'REQUEST_NOT_OPEN_FOR_QUOTES' };
        }
        const requestLines = await client.query(
          'SELECT id, item_id, requested_qty FROM purchase_request_lines WHERE purchase_request_id = $1 ORDER BY line_no',
          [request.params.id]
        );
        if (!validateSupplierQuotePayload(body, requestLines.rows)) return { invalid: true };
        const supplier = await client.query('SELECT id FROM suppliers WHERE id = $1 AND is_active = TRUE', [body.supplierId]);
        if (!supplier.rowCount) return { conflict: 'SUPPLIER_NOT_ACTIVE' };
        const quote = await client.query(`
          INSERT INTO supplier_quotes(
            purchase_request_id, supplier_id, quote_no, valid_until, currency_code,
            payment_terms, delivery_terms, notes, submitted_by
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
        `, [
          request.params.id, body.supplierId, body.quoteNo.trim(), body.validUntil || null,
          String(body.currencyCode ?? 'EGP').toUpperCase(), body.paymentTerms ?? null,
          body.deliveryTerms ?? null, body.notes ?? null, request.authUser.user_id
        ]);
        for (const line of body.lines) {
          const source = requestLines.rows.find(row => row.id === line.requestLineId);
          await client.query(`
            INSERT INTO supplier_quote_lines(
              supplier_quote_id, purchase_request_line_id, item_id, quoted_qty, unit_cost, notes
            ) VALUES ($1,$2,$3,$4,$5,$6)
          `, [quote.rows[0].id, source.id, source.item_id, line.quantity, line.unitCost, line.notes ?? null]);
        }
        return { quote: quote.rows[0] };
      });
      if (result.invalid) return invalid(reply, 'QUOTE_LINES_MUST_MATCH_REQUEST');
      if (result.conflict) return conflict(reply, result.conflict);
      return reply.code(201).send(result.quote);
    } catch (error) {
      if (error.code === '23505') return conflict(reply, 'DUPLICATE_SUPPLIER_QUOTE');
      if (error.code === '23503') return conflict(reply, 'INVALID_REFERENCE');
      if (error.code === '23514' || error.code === '22P02') return invalid(reply);
      throw error;
    }
  });

  app.get('/api/v1/purchase-requests/:id/quote-comparison', auth(app, 'PURCHASE_QUOTES.READ'), async (request, reply) => {
    try {
      const result = await db.query(`
        SELECT q.id quote_id, q.quote_no, q.status, q.currency_code, q.valid_until,
          s.id supplier_id, s.code supplier_code, s.name_ar supplier_name,
          l.purchase_request_line_id, i.code item_code, i.name_ar item_name,
          l.quoted_qty quantity, l.unit_cost,
          l.quoted_qty * l.unit_cost line_total
        FROM supplier_quotes q
        JOIN suppliers s ON s.id = q.supplier_id
        JOIN supplier_quote_lines l ON l.supplier_quote_id = q.id
        JOIN purchase_request_lines rql ON rql.id = l.purchase_request_line_id
        JOIN items i ON i.id = l.item_id
        WHERE q.purchase_request_id = $1
        ORDER BY rql.line_no, l.unit_cost, s.name_ar
      `, [request.params.id]);
      return result.rows;
    } catch (error) {
      if (error.code === '22P02') return invalid(reply);
      throw error;
    }
  });

  app.post('/api/v1/purchase-requests/:id/supplier-quotes/:quoteId/award', auth(app, 'PURCHASE_QUOTES.AWARD'), async (request, reply) => {
    try {
      const result = await transaction(db, async client => {
        const header = await client.query('SELECT * FROM purchase_requests WHERE id = $1 FOR UPDATE', [request.params.id]);
        if (!header.rowCount || header.rows[0].status !== 'APPROVED' || header.rows[0].purchase_order_id) {
          return { conflict: 'REQUEST_NOT_OPEN_FOR_AWARD' };
        }
        const quote = await client.query(
          'SELECT * FROM supplier_quotes WHERE id = $1 AND purchase_request_id = $2 AND (valid_until IS NULL OR valid_until >= CURRENT_DATE) FOR UPDATE',
          [request.params.quoteId, request.params.id]
        );
        if (!quote.rowCount || quote.rows[0].status !== 'SUBMITTED') return { conflict: 'QUOTE_NOT_AWARDABLE_OR_EXPIRED' };
        const completeness = await client.query(`
          SELECT COUNT(*)::int line_count,
            COUNT(*) FILTER (WHERE ql.purchase_request_line_id IS NOT NULL)::int quoted_count
          FROM purchase_request_lines prl
          LEFT JOIN supplier_quote_lines ql
            ON ql.purchase_request_line_id = prl.id AND ql.supplier_quote_id = $1
          WHERE prl.purchase_request_id = $2
        `, [request.params.quoteId, request.params.id]);
        if (!completeness.rows[0].line_count || completeness.rows[0].line_count !== completeness.rows[0].quoted_count) {
          return { conflict: 'QUOTE_INCOMPLETE' };
        }
        const updated = await client.query(`
          UPDATE supplier_quotes
             SET status = 'AWARDED', awarded_by = $1, awarded_at = NOW()
           WHERE id = $2 AND status = 'SUBMITTED'
           RETURNING *
        `, [request.authUser.user_id, request.params.quoteId]);
        await client.query(`
          UPDATE supplier_quotes SET status = 'NOT_SELECTED'
           WHERE purchase_request_id = $1 AND id <> $2 AND status = 'SUBMITTED'
        `, [request.params.id, request.params.quoteId]);
        return { quote: updated.rows[0] };
      });
      if (result.conflict) return conflict(reply, result.conflict);
      return result.quote;
    } catch (error) {
      if (error.code === '23505') return conflict(reply, 'REQUEST_ALREADY_AWARDED');
      if (error.code === '22P02') return invalid(reply);
      throw error;
    }
  });

  app.post('/api/v1/purchase-requests/:id/convert-awarded-quote', auth(app, 'PURCHASE_REQUESTS.CONVERT'), async (request, reply) => {
    const body = request.body ?? {};
    if (!textOk(body.orderNo) || (body.paymentDueDate != null && body.paymentDueDate !== '' && !validDate(body.paymentDueDate))) {
      return invalid(reply);
    }
    try {
      const result = await transaction(db, async client => {
        const requestHeader = await client.query('SELECT * FROM purchase_requests WHERE id = $1 FOR UPDATE', [request.params.id]);
        if (!requestHeader.rowCount || requestHeader.rows[0].status !== 'APPROVED' || requestHeader.rows[0].purchase_order_id) {
          return { conflict: 'REQUEST_NOT_CONVERTIBLE' };
        }
        const awarded = await client.query(`
          SELECT q.*, s.is_active,
            (q.valid_until IS NOT NULL AND q.valid_until < CURRENT_DATE) AS quote_expired
          FROM supplier_quotes q JOIN suppliers s ON s.id = q.supplier_id
          WHERE q.purchase_request_id = $1 AND q.status = 'AWARDED'
          FOR UPDATE OF q
        `, [request.params.id]);
        if (!awarded.rowCount || !awarded.rows[0].is_active) return { conflict: 'NO_ACTIVE_AWARDED_QUOTE' };
        const quote = awarded.rows[0];
        if (quote.quote_expired) return { conflict: 'AWARDED_QUOTE_EXPIRED' };
        const lines = await client.query(`
          SELECT ql.*, prl.line_no, prl.requested_qty
          FROM supplier_quote_lines ql
          JOIN purchase_request_lines prl ON prl.id = ql.purchase_request_line_id
          WHERE ql.supplier_quote_id = $1
          ORDER BY prl.line_no
        `, [quote.id]);
        const requestLineCount = await client.query(
          'SELECT COUNT(*)::int count FROM purchase_request_lines WHERE purchase_request_id = $1',
          [request.params.id]
        );
        if (lines.rowCount !== requestLineCount.rows[0].count) return { conflict: 'AWARDED_QUOTE_INCOMPLETE' };
        const order = await client.query(`
          INSERT INTO purchase_orders(order_no,supplier_id,warehouse_id,expected_date,payment_due_date,notes,created_by)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *
        `, [
          body.orderNo.trim(), quote.supplier_id, requestHeader.rows[0].warehouse_id,
          requestHeader.rows[0].needed_by, body.paymentDueDate || null,
          body.notes ?? quote.notes ?? requestHeader.rows[0].reason, request.authUser.user_id
        ]);
        for (const line of lines.rows) {
          await client.query(`
            INSERT INTO purchase_order_lines(purchase_order_id,line_no,item_id,ordered_qty,unit_cost)
            VALUES($1,$2,$3,$4,$5)
          `, [order.rows[0].id, line.line_no, line.item_id, line.requested_qty, line.unit_cost]);
        }
        await client.query(
          "UPDATE purchase_requests SET status = 'ORDERED', purchase_order_id = $1 WHERE id = $2",
          [order.rows[0].id, request.params.id]
        );
        return { purchaseOrder: order.rows[0], awardedQuoteId: quote.id, lineCount: lines.rowCount };
      });
      if (result.conflict) return conflict(reply, result.conflict);
      return reply.code(201).send(result);
    } catch (error) {
      if (error.code === '23505') return conflict(reply, 'DUPLICATE_ORDER_NUMBER');
      if (error.code === '23503') return conflict(reply, 'INVALID_REFERENCE');
      if (error.code === '23514' || error.code === '22P02') return invalid(reply);
      throw error;
    }
  });
}
