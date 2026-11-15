const auth=(app,p)=>({preHandler:[app.authenticate,app.requirePermission(p)]});
const invalid=(reply,error='VALIDATION_ERROR')=>reply.code(400).send({error});
const conflict=(reply,error='BUSINESS_RULE')=>reply.code(409).send({error});
const textOk=(v,n=160)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=n;
const positive=v=>Number.isFinite(Number(v))&&Number(v)>0;
const validDate=v=>v==null||v===''||/^\d{4}-\d{2}-\d{2}$/.test(String(v));
async function tx(db,fn){
 const c=await db.connect();
 try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out;}
 catch(e){await c.query('ROLLBACK');throw e;}
 finally{c.release();}
}
const fail=(reply,e)=>{
 if(e.code==='23505')return conflict(reply,'DUPLICATE');
 if(e.code==='23503')return conflict(reply,'INVALID_REFERENCE');
 if(['23514','22P02','22007'].includes(e.code))return invalid(reply,'INVALID_DATA');
 if(e.code==='P0001')return conflict(reply,e.message);
 throw e;
};

export async function transportRoutes(app,{db}){
 app.get('/api/v1/transport/vehicles',auth(app,'TRANSPORT.VEHICLES.READ'),async(_req,reply)=>{
  try{return (await db.query('SELECT * FROM transport_vehicles ORDER BY vehicle_no')).rows;}catch(e){return fail(reply,e);}
 });
 app.post('/api/v1/transport/vehicles',auth(app,'TRANSPORT.VEHICLES.MANAGE'),async(req,reply)=>{
  const b=req.body??{};
  if(!textOk(b.vehicleNo,40)||!textOk(b.plateNo,30)||!textOk(b.vehicleType,40)||!positive(b.capacityKg)||
    (b.currentOdometer!=null&&(!Number.isFinite(Number(b.currentOdometer))||Number(b.currentOdometer)<0))||
    !validDate(b.insuranceExpiry)||!validDate(b.licenseExpiry))return invalid(reply);
  try{
   const r=await db.query(`
    INSERT INTO transport_vehicles(vehicle_no,plate_no,vehicle_type,capacity_kg,current_odometer,insurance_expiry,license_expiry,maintenance_asset_id,notes,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
   `,[b.vehicleNo.trim(),b.plateNo.trim(),b.vehicleType.trim(),b.capacityKg,b.currentOdometer??0,b.insuranceExpiry||null,b.licenseExpiry||null,b.maintenanceAssetId??null,b.notes??null,req.authUser.user_id]);
   return reply.code(201).send(r.rows[0]);
  }catch(e){return fail(reply,e);}
 });

 app.get('/api/v1/transport/drivers',auth(app,'TRANSPORT.DRIVERS.READ'),async(_req,reply)=>{
  try{return (await db.query('SELECT * FROM transport_drivers ORDER BY driver_name')).rows;}catch(e){return fail(reply,e);}
 });
 app.post('/api/v1/transport/drivers',auth(app,'TRANSPORT.DRIVERS.MANAGE'),async(req,reply)=>{
  const b=req.body??{};
  if(!textOk(b.driverName,160)||!textOk(b.licenseNo,60)||!validDate(b.licenseExpiry)||!b.licenseExpiry)return invalid(reply);
  try{
   const r=await db.query(`
    INSERT INTO transport_drivers(employee_id,driver_name,phone,license_no,license_expiry,notes,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *
   `,[b.employeeId??null,b.driverName.trim(),b.phone??null,b.licenseNo.trim(),b.licenseExpiry,b.notes??null,req.authUser.user_id]);
   return reply.code(201).send(r.rows[0]);
  }catch(e){return fail(reply,e);}
 });

 app.get('/api/v1/transport/trips',auth(app,'TRANSPORT.TRIPS.READ'),async(_req,reply)=>{
  try{
   return (await db.query(`
    SELECT t.*,v.vehicle_no,v.plate_no,d.driver_name,d.license_no,
      COALESCE((SELECT SUM(c.amount) FROM transport_trip_costs c WHERE c.trip_id=t.id),0) total_cost,
      COALESCE((SELECT json_agg(json_build_object('salesDeliveryId',td.sales_delivery_id,'deliveryNo',sd.delivery_no,
        'status',sd.status,'loadWeightKg',td.load_weight_kg,'podReceivedBy',td.pod_received_by,'podReceivedAt',td.pod_received_at,
        'podNotes',td.pod_notes,'transportCost',a.amount)) FROM transport_trip_deliveries td
        JOIN sales_deliveries sd ON sd.id=td.sales_delivery_id
        LEFT JOIN transport_cost_allocations a ON a.trip_id=td.trip_id AND a.sales_delivery_id=td.sales_delivery_id
        WHERE td.trip_id=t.id),'[]'::json) deliveries
    FROM transport_trips t JOIN transport_vehicles v ON v.id=t.vehicle_id
    JOIN transport_drivers d ON d.id=t.driver_id
    ORDER BY t.planned_departure DESC,t.trip_no
   `)).rows;
  }catch(e){return fail(reply,e);}
 });

 app.post('/api/v1/transport/trips',auth(app,'TRANSPORT.TRIPS.MANAGE'),async(req,reply)=>{
  const b=req.body??{};
  if(!textOk(b.tripNo,50)||!b.vehicleId||!b.driverId||!textOk(b.origin,200)||!textOk(b.destination,200)||
    !b.plannedDeparture||Number.isNaN(Date.parse(b.plannedDeparture))||
    !Number.isFinite(Number(b.odometerStart))||Number(b.odometerStart)<0||
    !Array.isArray(b.deliveries)||!b.deliveries.length||
    b.deliveries.some(x=>!x||!x.salesDeliveryId||!positive(x.loadWeightKg))||
    new Set((b.deliveries||[]).map(x=>x.salesDeliveryId)).size!==(b.deliveries||[]).length)return invalid(reply);
  try{
   const result=await tx(db,async c=>{
    const vehicle=await c.query('SELECT * FROM transport_vehicles WHERE id=$1 FOR UPDATE',[b.vehicleId]);
    const driver=await c.query('SELECT * FROM transport_drivers WHERE id=$1 FOR UPDATE',[b.driverId]);
    if(!vehicle.rowCount||vehicle.rows[0].status!=='ACTIVE')return {conflict:'VEHICLE_NOT_ACTIVE'};
    if(!driver.rowCount||!driver.rows[0].is_active)return {conflict:'DRIVER_NOT_ACTIVE'};
    const today=await c.query('SELECT CURRENT_DATE today');
    if((vehicle.rows[0].insurance_expiry&&vehicle.rows[0].insurance_expiry<today.rows[0].today)||
      (vehicle.rows[0].license_expiry&&vehicle.rows[0].license_expiry<today.rows[0].today)||
      driver.rows[0].license_expiry<today.rows[0].today)return {conflict:'VEHICLE_OR_DRIVER_DOCUMENT_EXPIRED'};
    if(Number(b.odometerStart)<Number(vehicle.rows[0].current_odometer))return {conflict:'ODOMETER_BELOW_LAST_READING'};
    const busy=await c.query("SELECT id FROM transport_trips WHERE status IN ('LOADED','DISPATCHED','ARRIVED') AND (vehicle_id=$1 OR driver_id=$2) LIMIT 1",[b.vehicleId,b.driverId]);
    if(busy.rowCount)return {conflict:'VEHICLE_OR_DRIVER_ALREADY_ASSIGNED'};
    const totalWeight=b.deliveries.reduce((sum,x)=>sum+Number(x.loadWeightKg),0);
    if(totalWeight>Number(vehicle.rows[0].capacity_kg)+0.000001)return {conflict:'VEHICLE_CAPACITY_EXCEEDED'};
    const trip=await c.query(`
     INSERT INTO transport_trips(trip_no,vehicle_id,driver_id,origin,destination,planned_departure,odometer_start,notes,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `,[b.tripNo.trim(),b.vehicleId,b.driverId,b.origin.trim(),b.destination.trim(),b.plannedDeparture,b.odometerStart,b.notes??null,req.authUser.user_id]);
    let sequence=0;
    for(const item of b.deliveries){
     const delivery=await c.query("SELECT * FROM sales_deliveries WHERE id=$1 FOR UPDATE",[item.salesDeliveryId]);
     if(!delivery.rowCount||!['READY','PARTIALLY_DELIVERED'].includes(delivery.rows[0].status))throw Object.assign(new Error('أوامر التسليم يجب أن تكون جاهزة أو متبقي بها كميات للتسليم'),{code:'P0001'});
     const active=await c.query("SELECT id FROM transport_trip_deliveries WHERE sales_delivery_id=$1 AND active_trip=TRUE",[item.salesDeliveryId]);
     if(active.rowCount)throw Object.assign(new Error('أمر التسليم مرتبط برحلة نشطة بالفعل'),{code:'P0001'});
     await c.query(`
      INSERT INTO transport_trip_deliveries(trip_id,sales_delivery_id,load_weight_kg,sequence_no)
      VALUES($1,$2,$3,$4)
     `,[trip.rows[0].id,item.salesDeliveryId,item.loadWeightKg,++sequence]);
     await c.query('UPDATE sales_deliveries SET vehicle_no=$1,driver_name=$2 WHERE id=$3',[vehicle.rows[0].plate_no,driver.rows[0].driver_name,item.salesDeliveryId]);
    }
    return {trip:trip.rows[0],deliveryCount:sequence,totalLoadWeightKg:totalWeight};
   });
   if(result.conflict)return conflict(reply,result.conflict);
   return reply.code(201).send(result);
  }catch(e){return fail(reply,e);}
 });

 app.post('/api/v1/transport/trips/:id/dispatch',auth(app,'TRANSPORT.TRIPS.DISPATCH'),async(req,reply)=>{
  try{
   const result=await tx(db,async c=>{
    const trip=await c.query('SELECT * FROM transport_trips WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!trip.rowCount||trip.rows[0].status!=='LOADED')return {conflict:'TRIP_NOT_LOADED'};
    const vehicle=await c.query('SELECT * FROM transport_vehicles WHERE id=$1 FOR UPDATE',[trip.rows[0].vehicle_id]);
    const driver=await c.query('SELECT * FROM transport_drivers WHERE id=$1 FOR UPDATE',[trip.rows[0].driver_id]);
    const valid=await c.query('SELECT CURRENT_DATE today');
    if(!vehicle.rowCount||vehicle.rows[0].status!=='ACTIVE'||!driver.rowCount||!driver.rows[0].is_active||
      (vehicle.rows[0].insurance_expiry&&vehicle.rows[0].insurance_expiry<valid.rows[0].today)||
      (vehicle.rows[0].license_expiry&&vehicle.rows[0].license_expiry<valid.rows[0].today)||
      driver.rows[0].license_expiry<valid.rows[0].today)return {conflict:'VEHICLE_OR_DRIVER_NOT_LEGAL_TO_DISPATCH'};
    const rows=await c.query('SELECT td.sales_delivery_id,sd.status FROM transport_trip_deliveries td JOIN sales_deliveries sd ON sd.id=td.sales_delivery_id WHERE td.trip_id=$1 AND td.active_trip=TRUE FOR UPDATE OF td,sd',[req.params.id]);
    if(!rows.rowCount||rows.rows.some(x=>!['READY','PARTIALLY_DELIVERED'].includes(x.status)))return {conflict:'TRIP_DELIVERIES_NOT_READY'};
    for(const row of rows.rows){
     const lines=await c.query('SELECT id,planned_qty FROM sales_delivery_lines WHERE sales_delivery_id=$1 FOR UPDATE',[row.sales_delivery_id]);
     if(!lines.rowCount)throw Object.assign(new Error('أمر التسليم بلا بنود'),{code:'P0001'});
     if(row.status==='READY')for(const line of lines.rows)await c.query('UPDATE sales_delivery_lines SET shipped_qty=planned_qty WHERE id=$1',[line.id]);
     await c.query("UPDATE sales_deliveries SET status='SHIPPED',shipped_by=$1,shipped_at=NOW() WHERE id=$2",[req.authUser.user_id,row.sales_delivery_id]);
    }
    const updated=await c.query("UPDATE transport_trips SET status='DISPATCHED',dispatched_at=NOW() WHERE id=$1 RETURNING *",[req.params.id]);
    return {trip:updated.rows[0],dispatchedDeliveries:rows.rowCount};
   });
   if(result.conflict)return conflict(reply,result.conflict);
   return result;
  }catch(e){return fail(reply,e);}
 });

 app.post('/api/v1/transport/trips/:id/arrive',auth(app,'TRANSPORT.TRIPS.COMPLETE'),async(req,reply)=>{
  const odometer=Number(req.body?.odometerEnd);
  if(!Number.isFinite(odometer)||odometer<0)return invalid(reply);
  try{
   const result=await tx(db,async c=>{
    const trip=await c.query('SELECT * FROM transport_trips WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!trip.rowCount||trip.rows[0].status!=='DISPATCHED')return {conflict:'TRIP_NOT_DISPATCHED'};
    if(odometer<Number(trip.rows[0].odometer_start))return {conflict:'INVALID_ODOMETER'};
    const vehicle=await c.query('SELECT current_odometer FROM transport_vehicles WHERE id=$1 FOR UPDATE',[trip.rows[0].vehicle_id]);
    if(odometer<Number(vehicle.rows[0].current_odometer))return {conflict:'ODOMETER_BELOW_LAST_READING'};
    const updated=await c.query("UPDATE transport_trips SET status='ARRIVED',arrived_at=NOW(),odometer_end=$1 WHERE id=$2 RETURNING *",[odometer,req.params.id]);
    return updated.rows[0];
   });
   if(result.conflict)return conflict(reply,result.conflict);
   return result;
  }catch(e){return fail(reply,e);}
 });

 app.post('/api/v1/transport/trips/:id/pod',auth(app,'TRANSPORT.TRIPS.COMPLETE'),async(req,reply)=>{
  const b=req.body??{};
  if(!b.salesDeliveryId||!textOk(b.receivedBy,160)||
    (b.notes!=null&&!textOk(b.notes,2000))||(b.signatureRef!=null&&!textOk(b.signatureRef,500))||
    (b.photoRef!=null&&!textOk(b.photoRef,500)))return invalid(reply);
  try{
   const result=await db.query(`
    UPDATE transport_trip_deliveries td SET pod_received_by=$1,pod_received_at=NOW(),pod_notes=$2,
      pod_signature_ref=$3,pod_photo_ref=$4
    FROM transport_trips t WHERE td.trip_id=t.id AND td.trip_id=$5 AND td.sales_delivery_id=$6
      AND t.status IN ('DISPATCHED','ARRIVED') AND td.active_trip=TRUE
    RETURNING td.*
   `,[b.receivedBy.trim(),b.notes??null,b.signatureRef??null,b.photoRef??null,req.params.id,b.salesDeliveryId]);
   if(!result.rowCount)return conflict(reply,'TRIP_DELIVERY_NOT_ACTIVE');
   return result.rows[0];
  }catch(e){return fail(reply,e);}
 });

 app.post('/api/v1/transport/trips/:id/costs',auth(app,'TRANSPORT.COSTS.MANAGE'),async(req,reply)=>{
  const b=req.body??{};
  if(!['FUEL','TOLL','LOADING','UNLOADING','MAINTENANCE','OTHER'].includes(b.costType)||
    !Number.isFinite(Number(b.amount))||Number(b.amount)<0||
    (b.liters!=null&&(!Number.isFinite(Number(b.liters))||Number(b.liters)<0)))return invalid(reply);
  try{
   const result=await tx(db,async c=>{
    const trip=await c.query('SELECT status FROM transport_trips WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!trip.rowCount||!['LOADED','DISPATCHED','ARRIVED'].includes(trip.rows[0].status))return {conflict:'TRIP_NOT_OPEN'};
    const cost=await c.query(`
     INSERT INTO transport_trip_costs(trip_id,cost_type,amount,liters,reference_no,description,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `,[req.params.id,b.costType,b.amount,b.liters??null,b.referenceNo??null,b.description??null,req.authUser.user_id]);
    return cost.rows[0];
   });
   if(result.conflict)return conflict(reply,result.conflict);
   return reply.code(201).send(result);
  }catch(e){return fail(reply,e);}
 });

 app.post('/api/v1/transport/trips/:id/allocate-costs',auth(app,'TRANSPORT.COSTS.MANAGE'),async(req,reply)=>{
  const method=req.body?.method??'BY_WEIGHT';
  if(!['BY_WEIGHT','EQUAL'].includes(method))return invalid(reply);
  try{
   const result=await tx(db,async c=>{
    const trip=await c.query('SELECT status FROM transport_trips WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!trip.rowCount||!['ARRIVED','COMPLETED'].includes(trip.rows[0].status))return {conflict:'TRIP_NOT_ARRIVED'};
    const costs=await c.query('SELECT COALESCE(SUM(amount),0) total FROM transport_trip_costs WHERE trip_id=$1',[req.params.id]);
    const deliveries=await c.query('SELECT sales_delivery_id,load_weight_kg FROM transport_trip_deliveries WHERE trip_id=$1',[req.params.id]);
    if(!deliveries.rowCount)return {conflict:'TRIP_HAS_NO_DELIVERIES'};
    const total=Number(costs.rows[0].total),weight=deliveries.rows.reduce((n,x)=>n+Number(x.load_weight_kg),0);
    let allocated=0;
    for(let i=0;i<deliveries.rows.length;i++){
     const d=deliveries.rows[i];
     const amount=i===deliveries.rows.length-1?Number((total-allocated).toFixed(6)):
       Number((method==='EQUAL'?total/deliveries.rows.length:total*Number(d.load_weight_kg)/weight).toFixed(6));
     allocated+=amount;
     await c.query(`
      INSERT INTO transport_cost_allocations(trip_id,sales_delivery_id,amount,allocation_method)
      VALUES($1,$2,$3,$4)
      ON CONFLICT(trip_id,sales_delivery_id) DO UPDATE SET amount=EXCLUDED.amount,allocation_method=EXCLUDED.allocation_method,created_at=NOW()
     `,[req.params.id,d.sales_delivery_id,amount,method]);
     await c.query('UPDATE sales_deliveries SET transport_cost=(SELECT COALESCE(SUM(amount),0) FROM transport_cost_allocations WHERE sales_delivery_id=$1) WHERE id=$1',[d.sales_delivery_id]);
    }
    return {tripId:req.params.id,totalCost:total,allocationMethod:method,allocatedAmount:allocated};
   });
   if(result.conflict)return conflict(reply,result.conflict);
   return result;
  }catch(e){return fail(reply,e);}
 });

 app.post('/api/v1/transport/trips/:id/complete',auth(app,'TRANSPORT.TRIPS.COMPLETE'),async(req,reply)=>{
  try{
   const result=await tx(db,async c=>{
    const trip=await c.query('SELECT * FROM transport_trips WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!trip.rowCount||trip.rows[0].status!=='ARRIVED')return {conflict:'TRIP_NOT_ARRIVED'};
    const deliveries=await c.query(`
     SELECT td.sales_delivery_id,td.pod_received_at,sd.status
     FROM transport_trip_deliveries td JOIN sales_deliveries sd ON sd.id=td.sales_delivery_id
     WHERE td.trip_id=$1 AND td.active_trip=TRUE FOR UPDATE OF td,sd
    `,[req.params.id]);
    if(!deliveries.rowCount||deliveries.rows.some(x=>!x.pod_received_at||x.status!=='DELIVERED'))
      return {conflict:'ALL_DELIVERIES_REQUIRE_POD_AND_DELIVERY_CONFIRMATION'};
    await c.query("UPDATE transport_trips SET status='COMPLETED' WHERE id=$1",[req.params.id]);
    await c.query('UPDATE transport_vehicles SET current_odometer=$1 WHERE id=$2',[trip.rows[0].odometer_end,trip.rows[0].vehicle_id]);
    await c.query('UPDATE transport_trip_deliveries SET active_trip=FALSE WHERE trip_id=$1',[req.params.id]);
    return {tripId:req.params.id,status:'COMPLETED',deliveryCount:deliveries.rowCount};
   });
   if(result.conflict)return conflict(reply,result.conflict);
   return result;
  }catch(e){return fail(reply,e);}
 });

 app.post('/api/v1/transport/trips/:id/cancel',auth(app,'TRANSPORT.TRIPS.MANAGE'),async(req,reply)=>{
  try{
   const result=await tx(db,async c=>{
    const trip=await c.query('SELECT status FROM transport_trips WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!trip.rowCount||!['LOADED'].includes(trip.rows[0].status))return {conflict:'ONLY_LOADED_TRIPS_CAN_BE_CANCELLED'};
    await c.query("UPDATE transport_trips SET status='CANCELLED' WHERE id=$1",[req.params.id]);
    await c.query('UPDATE transport_trip_deliveries SET active_trip=FALSE WHERE trip_id=$1',[req.params.id]);
    return {tripId:req.params.id,status:'CANCELLED'};
   });
   if(result.conflict)return conflict(reply,result.conflict);
   return result;
  }catch(e){return fail(reply,e);}
 });
}
