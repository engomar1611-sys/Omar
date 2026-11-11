import bcrypt from 'bcryptjs';

function auth(app, permission) { return { preHandler: [app.authenticate, app.requirePermission(permission)] }; }
function bad(reply, message='البيانات المدخلة غير صحيحة') { return reply.code(400).send({error:'VALIDATION_ERROR',message}); }
function fail(reply,error) {
  if(error.code==='23505')return reply.code(409).send({error:'DUPLICATE'});
  if(error.code==='23503')return reply.code(409).send({error:'REFERENCED'});
  if(error.code==='P0001')return reply.code(409).send({error:'BUSINESS_RULE',message:error.message});
  throw error;
}
async function tx(db,work){const c=await db.connect();try{await c.query('BEGIN');const v=await work(c);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
const validUser=v=>typeof v==='string'&&/^[a-z0-9._-]{3,80}$/.test(v.trim().toLowerCase());
const validCode=v=>typeof v==='string'&&/^[A-Z][A-Z0-9_.-]{1,39}$/.test(v.trim());
const validName=v=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=160;

export async function adminRoutes(app,{db}){
  app.get('/api/v1/admin/users',auth(app,'USERS.READ'),async(_req,reply)=>{
    try{return (await db.query(`SELECT u.id,u.username,u.display_name,u.is_active,u.created_at,
      COALESCE(json_agg(json_build_object('id',r.id,'code',r.code,'nameAr',r.name_ar)) FILTER(WHERE r.id IS NOT NULL),'[]'::json) roles
      FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id
      GROUP BY u.id ORDER BY u.created_at DESC`)).rows;}catch(e){return fail(reply,e);}
  });
  app.get('/api/v1/admin/roles',auth(app,'ROLES.MANAGE'),async(_req,reply)=>{
    try{return (await db.query(`SELECT r.id,r.code,r.name_ar,r.is_active,
      COALESCE(json_agg(json_build_object('id',p.id,'code',p.code,'nameAr',p.name_ar,'moduleCode',p.module_code)) FILTER(WHERE p.id IS NOT NULL),'[]'::json) permissions
      FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN permissions p ON p.id=rp.permission_id
      GROUP BY r.id ORDER BY r.code`)).rows;}catch(e){return fail(reply,e);}
  });
  app.get('/api/v1/admin/permissions',auth(app,'ROLES.MANAGE'),async(_req,reply)=>{
    try{return (await db.query('SELECT id,code,name_ar,module_code,description FROM permissions WHERE is_active=TRUE ORDER BY module_code,code')).rows;}catch(e){return fail(reply,e);}
  });
  app.post('/api/v1/admin/users',auth(app,'USERS.MANAGE'),async(req,reply)=>{
    const b=req.body??{};
    if(!validUser(b.username)||!validName(b.displayName)||typeof b.password!=='string'||b.password.length<14||b.password.length>200||!Array.isArray(b.roleIds)||!b.roleIds.length||b.roleIds.length>50)return bad(reply,'اسم المستخدم أو الاسم أو كلمة المرور أو الأدوار غير صحيحة؛ كلمة المرور 14 حرفاً على الأقل');
    try{
      const hash=await bcrypt.hash(b.password,12);
      const result=await tx(db,async c=>{
        const roles=await c.query('SELECT id FROM roles WHERE id=ANY($1::uuid[]) AND is_active=TRUE',[b.roleIds]);
        if(roles.rowCount!==new Set(b.roleIds).size)throw Object.assign(new Error('يوجد دور غير موجود أو غير نشط'),{code:'P0001'});
        const user=await c.query('INSERT INTO users(username,password_hash,display_name,is_active) VALUES($1,$2,$3,TRUE) RETURNING id,username,display_name,is_active,created_at',
          [b.username.trim().toLowerCase(),hash,b.displayName.trim()]);
        for(const roleId of b.roleIds)await c.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)',[user.rows[0].id,roleId]);
        await c.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details) VALUES($1,'USER_CREATED','USER',$2,$3::jsonb)",
          [req.authUser.user_id,user.rows[0].id,JSON.stringify({username:user.rows[0].username,roleIds:b.roleIds})]);
        return user.rows[0];
      });
      return reply.code(201).send(result);
    }catch(e){return fail(reply,e);}
  });
  app.put('/api/v1/admin/users/:id/status',auth(app,'USERS.MANAGE'),async(req,reply)=>{
    if(typeof req.body?.active!=='boolean')return bad(reply);
    try{
      const result=await tx(db,async c=>{
        const target=await c.query('SELECT id,is_active FROM users WHERE id=$1 FOR UPDATE',[req.params.id]);
        if(!target.rowCount)throw Object.assign(new Error('المستخدم غير موجود'),{code:'P0001'});
        if(req.body.active===false&&req.params.id===req.authUser.user_id)throw Object.assign(new Error('لا يمكنك إيقاف حسابك الحالي'),{code:'P0001'});
        if(req.body.active===false&&target.rows[0].is_active){
          const admin=await c.query(`SELECT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.code='SYSTEM_ADMIN') is_admin`,[req.params.id]);
          if(admin.rows[0].is_admin){
            const count=await c.query(`SELECT COUNT(DISTINCT u.id)::int count FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.is_active=TRUE AND r.code='SYSTEM_ADMIN'`);
            if(count.rows[0].count<=1)throw Object.assign(new Error('لا يمكن إيقاف آخر مدير نظام نشط'),{code:'P0001'});
          }
        }
        const updated=await c.query('UPDATE users SET is_active=$1 WHERE id=$2 RETURNING id,username,display_name,is_active',[req.body.active,req.params.id]);
        if(!req.body.active)await c.query('UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL',[req.params.id]);
        await c.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details) VALUES($1,'USER_STATUS_CHANGED','USER',$2,$3::jsonb)",
          [req.authUser.user_id,req.params.id,JSON.stringify({active:req.body.active})]);
        return updated.rows[0];
      });
      return result;
    }catch(e){return fail(reply,e);}
  });
  app.post('/api/v1/admin/users/:id/roles',auth(app,'USERS.MANAGE'),async(req,reply)=>{
    const roleIds=req.body?.roleIds;
    if(!Array.isArray(roleIds)||!roleIds.length||roleIds.length>50)return bad(reply,'يجب اختيار دور واحد على الأقل');
    try{
      const result=await tx(db,async c=>{
        const target=await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[req.params.id]);
        if(!target.rowCount)throw Object.assign(new Error('المستخدم غير موجود'),{code:'P0001'});
        const roles=await c.query('SELECT id,code FROM roles WHERE id=ANY($1::uuid[]) AND is_active=TRUE',[roleIds]);
        if(roles.rowCount!==new Set(roleIds).size)throw Object.assign(new Error('يوجد دور غير موجود أو غير نشط'),{code:'P0001'});
        const currentAdmin=await c.query(`SELECT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.code='SYSTEM_ADMIN') is_admin`,[req.params.id]);
        const keepsAdmin=roles.rows.some(x=>x.code==='SYSTEM_ADMIN');
        if(currentAdmin.rows[0].is_admin&&!keepsAdmin){
          const count=await c.query(`SELECT COUNT(DISTINCT u.id)::int count FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.is_active=TRUE AND r.code='SYSTEM_ADMIN'`);
          const active=await c.query('SELECT is_active FROM users WHERE id=$1',[req.params.id]);
          if(active.rows[0].is_active&&count.rows[0].count<=1)throw Object.assign(new Error('لا يمكن إزالة دور آخر مدير نظام نشط'),{code:'P0001'});
        }
        await c.query('DELETE FROM user_roles WHERE user_id=$1',[req.params.id]);
        for(const roleId of roleIds)await c.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)',[req.params.id,roleId]);
        await c.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details) VALUES($1,'USER_ROLES_CHANGED','USER',$2,$3::jsonb)",
          [req.authUser.user_id,req.params.id,JSON.stringify({roleIds})]);
        return {userId:req.params.id,roleIds};
      });
      return result;
    }catch(e){return fail(reply,e);}
  });
  app.post('/api/v1/admin/users/:id/reset-password',auth(app,'USERS.MANAGE'),async(req,reply)=>{
    const password=req.body?.password;
    if(typeof password!=='string'||password.length<14||password.length>200)return bad(reply,'كلمة المرور يجب ألا تقل عن 14 حرفاً');
    try{
      const hash=await bcrypt.hash(password,12);
      const result=await tx(db,async c=>{
        const u=await c.query('UPDATE users SET password_hash=$1 WHERE id=$2 RETURNING id,username',[hash,req.params.id]);
        if(!u.rowCount)throw Object.assign(new Error('المستخدم غير موجود'),{code:'P0001'});
        await c.query('UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL',[req.params.id]);
        await c.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details) VALUES($1,'USER_PASSWORD_RESET','USER',$2,'{}'::jsonb)",[req.authUser.user_id,req.params.id]);
        return {userId:req.params.id,username:u.rows[0].username,sessionsRevoked:true};
      });
      return result;
    }catch(e){return fail(reply,e);}
  });
  app.post('/api/v1/admin/roles',auth(app,'ROLES.MANAGE'),async(req,reply)=>{
    const b=req.body??{};
    if(!validCode(b.code)||!validName(b.nameAr)||!Array.isArray(b.permissionCodes)||b.permissionCodes.length>300)return bad(reply);
    if(b.code.trim()==='SYSTEM_ADMIN')return bad(reply,'دور مدير النظام محمي');
    try{
      const result=await tx(db,async c=>{
        const perms=await c.query('SELECT id,code FROM permissions WHERE code=ANY($1::text[]) AND is_active=TRUE',[b.permissionCodes]);
        if(perms.rowCount!==new Set(b.permissionCodes).size)throw Object.assign(new Error('يوجد كود صلاحية غير معروف'),{code:'P0001'});
        const role=await c.query('INSERT INTO roles(code,name_ar,is_active) VALUES($1,$2,TRUE) RETURNING id,code,name_ar,is_active',[b.code.trim(),b.nameAr.trim()]);
        for(const p of perms.rows)await c.query('INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2)',[role.rows[0].id,p.id]);
        await c.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details) VALUES($1,'ROLE_CREATED','ROLE',$2,$3::jsonb)",
          [req.authUser.user_id,role.rows[0].id,JSON.stringify({code:b.code,permissionCodes:b.permissionCodes})]);
        return role.rows[0];
      });
      return reply.code(201).send(result);
    }catch(e){return fail(reply,e);}
  });
  app.put('/api/v1/admin/roles/:id/permissions',auth(app,'ROLES.MANAGE'),async(req,reply)=>{
    const codes=req.body?.permissionCodes;
    if(!Array.isArray(codes)||codes.length>300)return bad(reply);
    try{
      const result=await tx(db,async c=>{
        const role=await c.query('SELECT id,code FROM roles WHERE id=$1 FOR UPDATE',[req.params.id]);
        if(!role.rowCount)throw Object.assign(new Error('الدور غير موجود'),{code:'P0001'});
        if(role.rows[0].code==='SYSTEM_ADMIN')throw Object.assign(new Error('لا يمكن تعديل صلاحيات مدير النظام الرئيسي'),{code:'P0001'});
        const perms=await c.query('SELECT id,code FROM permissions WHERE code=ANY($1::text[]) AND is_active=TRUE',[codes]);
        if(perms.rowCount!==new Set(codes).size)throw Object.assign(new Error('يوجد كود صلاحية غير معروف'),{code:'P0001'});
        await c.query('DELETE FROM role_permissions WHERE role_id=$1',[req.params.id]);
        for(const p of perms.rows)await c.query('INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2)',[req.params.id,p.id]);
        await c.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details) VALUES($1,'ROLE_PERMISSIONS_CHANGED','ROLE',$2,$3::jsonb)",
          [req.authUser.user_id,req.params.id,JSON.stringify({permissionCodes:codes})]);
        return {roleId:req.params.id,permissionCodes:codes};
      });
      return result;
    }catch(e){return fail(reply,e);}
  });
}
