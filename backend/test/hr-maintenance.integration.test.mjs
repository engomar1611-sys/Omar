import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../src/app.mjs';

const enabled = Boolean(process.env.DATABASE_URL && process.env.BOOTSTRAP_ADMIN_USERNAME && process.env.BOOTSTRAP_ADMIN_PASSWORD);

test('HR, payroll posting, maintenance lifecycle and company settings', { skip: !enabled }, async () => {
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
 const app=buildApp({logger:false,db:pool,jwtSecret:process.env.AUTH_JWT_SECRET});
 const suffix=Date.now().toString(),code=p=>(p+suffix).slice(0,40);
 try {
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:process.env.BOOTSTRAP_ADMIN_USERNAME,password:process.env.BOOTSTRAP_ADMIN_PASSWORD}});
  assert.equal(login.statusCode,200,login.body);
  const headers={authorization:'Bearer '+login.json().accessToken,'content-type':'application/json'};
  const company=(await pool.query('INSERT INTO companies(code,name_ar) VALUES($1,$2) RETURNING id',[code('HRC'), 'شركة الموارد والصيانة'])).rows[0];
  const plant=(await pool.query('INSERT INTO plants(company_id,code,name_ar) VALUES($1,$2,$3) RETURNING id',[company.id,code('HRP'),'مصنع الموارد'])).rows[0];

  const department=await app.inject({method:'POST',url:'/api/v1/hr/departments',headers,payload:{code:code('HRD'),nameAr:'الإدارة الفنية'}});
  assert.equal(department.statusCode,201,department.body);
  const employee=await app.inject({method:'POST',url:'/api/v1/hr/employees',headers,payload:{
   employeeNo:code('EMP'),fullNameAr:'موظف اختبار الرواتب',hireDate:'2026-01-01',basicSalary:1000,departmentId:department.json().id
  }});
  assert.equal(employee.statusCode,201,employee.body);
  const employeeUpdate=await app.inject({method:'PUT',url:'/api/v1/hr/employees/'+employee.json().id,headers,payload:{employeeNo:employee.json().employee_no,fullNameAr:'موظف اختبار الرواتب بعد التعديل',hireDate:'2026-01-01',basicSalary:1200,departmentId:department.json().id,employmentType:'FULL_TIME',phone:'01000000000',bankName:'بنك الاختبار',address:'عنوان الاختبار'}});
  assert.equal(employeeUpdate.statusCode,200,employeeUpdate.body);
  assert.equal(employeeUpdate.json().full_name_ar,'موظف اختبار الرواتب بعد التعديل');
  assert.equal(Number(employeeUpdate.json().basic_salary),1200);
  const employee2=await app.inject({method:'POST',url:'/api/v1/hr/employees',headers,payload:{
   employeeNo:code('EMP2'),fullNameAr:'موظف اختبار سلفة ثانٍ',hireDate:'2026-01-01',basicSalary:2000,departmentId:department.json().id
  }});
  assert.equal(employee2.statusCode,201,employee2.body);
  const leaveType=await app.inject({method:'POST',url:'/api/v1/hr/leave-types',headers,payload:{code:code('ANNUAL'),nameAr:'إجازة سنوية',annualQuota:21}});
  assert.equal(leaveType.statusCode,201,leaveType.body);
  const leave=await app.inject({method:'POST',url:'/api/v1/hr/leaves',headers,payload:{
   requestNo:code('LV'),employeeId:employee.json().id,leaveTypeId:leaveType.json().id,startDate:'2026-01-05',endDate:'2026-01-06',days:2
  }});
  assert.equal(leave.statusCode,201,leave.body);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/hr/leaves/'+leave.json().id+'/decision',headers,payload:{status:'APPROVED'}})).statusCode,200);
  const leaveBalances=await app.inject({method:'GET',url:'/api/v1/hr/leave-balances?year=2026',headers});
  assert.equal(leaveBalances.statusCode,200,leaveBalances.body);
  const employeeLeaveBalance=leaveBalances.json().find(x=>x.employee_id===employee.json().id&&x.leave_type_id===leaveType.json().id);
  assert.equal(Number(employeeLeaveBalance.used_days),2);
  assert.equal(Number(employeeLeaveBalance.remaining_days),19);
  const advance1=await app.inject({method:'POST',url:'/api/v1/hr/advances',headers,payload:{
   advanceNo:code('ADV1'),employeeId:employee.json().id,amount:300,installments:3
  }});
  assert.equal(advance1.statusCode,201,advance1.body);
  const advance2=await app.inject({method:'POST',url:'/api/v1/hr/advances',headers,payload:{
   advanceNo:code('ADV2'),employeeId:employee2.json().id,amount:600,installments:3
  }});
  assert.equal(advance2.statusCode,201,advance2.body);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/hr/advances/'+advance1.json().id+'/approve',headers,payload:{}})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/hr/advances/'+advance2.json().id+'/approve',headers,payload:{}})).statusCode,200);
  const shift=await app.inject({method:'POST',url:'/api/v1/hr/shifts',headers,payload:{code:code('SH'),nameAr:'وردية صباحية',startTime:'08:00',endTime:'16:00',graceMinutes:10}});
  assert.equal(shift.statusCode,201,shift.body);
  const assignment=await app.inject({method:'POST',url:'/api/v1/hr/shift-assignments',headers,payload:{employeeId:employee.json().id,shiftId:shift.json().id,effectiveFrom:'2026-01-01'}});
  assert.equal(assignment.statusCode,201,assignment.body);
  const assignments=await app.inject({method:'GET',url:'/api/v1/hr/shift-assignments',headers});
  assert.equal(assignments.statusCode,200,assignments.body);
  assert.ok(assignments.json().some(x=>x.id===assignment.json().id&&x.shift_code===shift.json().code));
  const attendance=await app.inject({method:'POST',url:'/api/v1/hr/attendance',headers,payload:{employeeId:employee.json().id,workDate:'2026-01-05',status:'PRESENT',overtimeMinutes:0}});
  assert.equal(attendance.statusCode,201,attendance.body);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/hr/attendance/'+attendance.json().id+'/approve',headers,payload:{}})).statusCode,200);

  const period=await app.inject({method:'POST',url:'/api/v1/hr/payroll-periods',headers,payload:{periodCode:code('PAY'),startDate:'2026-01-01',endDate:'2026-01-31'}});
  assert.equal(period.statusCode,201,period.body);
  const calc=await app.inject({method:'POST',url:'/api/v1/hr/payroll-periods/'+period.json().id+'/calculate',headers,payload:{}});
  assert.equal(calc.statusCode,200,calc.body);
  assert.equal(Number(calc.json().totalNet),2900);
  const approved=await app.inject({method:'POST',url:'/api/v1/hr/payroll-runs/'+calc.json().runId+'/approve',headers,payload:{}});
  assert.equal(approved.statusCode,200,approved.body);
  const posted=await app.inject({method:'POST',url:'/api/v1/hr/payroll-runs/'+calc.json().runId+'/post',headers,payload:{}});
  assert.equal(posted.statusCode,200,posted.body);
  const advanceBalances=await pool.query('SELECT employee_id,remaining_amount FROM employee_advances WHERE id=ANY($1::uuid[]) ORDER BY employee_id',[[advance1.json().id,advance2.json().id]]);
  const remainingByEmployee=new Map(advanceBalances.rows.map(x=>[x.employee_id,Number(x.remaining_amount)]));
  assert.equal(remainingByEmployee.get(employee.json().id),200);
  assert.equal(remainingByEmployee.get(employee2.json().id),400);
  const journal=await pool.query("SELECT total_debit,total_credit FROM journal_entries WHERE source_type='PAYROLL' AND source_id=$1",[calc.json().runId]);
  assert.equal(journal.rowCount,1);
  assert.equal(Number(journal.rows[0].total_debit),Number(journal.rows[0].total_credit));

  const asset=await app.inject({method:'POST',url:'/api/v1/maintenance/assets',headers,payload:{assetCode:code('AST'),nameAr:'ماكينة خلط اختبار',assetType:'MACHINE',plantId:plant.id,acquisitionCost:50000}});
  assert.equal(asset.statusCode,201,asset.body);
  const plan=await app.inject({method:'POST',url:'/api/v1/maintenance/plans',headers,payload:{
   planCode:code('PM'),assetId:asset.json().id,titleAr:'صيانة شهرية لماكينة الخلط',maintenanceType:'PREVENTIVE',intervalDays:30,nextDueDate:'2026-01-01',checklist:['فحص السيور','فحص التشحيم']
  }});
  assert.equal(plan.statusCode,201,plan.body);
  const generatedPm=await app.inject({method:'POST',url:'/api/v1/maintenance/plans/'+plan.json().id+'/generate-work-order',headers,payload:{}});
  assert.equal(generatedPm.statusCode,200,generatedPm.body);
  assert.equal(generatedPm.json().plan_id,plan.json().id);
  const duplicatePm=await app.inject({method:'POST',url:'/api/v1/maintenance/plans/'+plan.json().id+'/generate-work-order',headers,payload:{}});
  assert.equal(duplicatePm.statusCode,409);
  const wo=await app.inject({method:'POST',url:'/api/v1/maintenance/work-orders',headers,payload:{workOrderNo:code('WO'),assetId:asset.json().id,assignedTo:employee.json().id,maintenanceType:'CORRECTIVE',priority:'HIGH',problemDescription:'اهتزاز غير طبيعي'}});
  assert.equal(wo.statusCode,201,wo.body);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/maintenance/work-orders/'+wo.json().id+'/start',headers,payload:{}})).statusCode,200);
  const workOrders=await app.inject({method:'GET',url:'/api/v1/maintenance/work-orders',headers});
  assert.equal(workOrders.statusCode,200,workOrders.body);
  assert.equal(workOrders.json().find(x=>x.id===wo.json().id).assigned_employee,'موظف اختبار الرواتب بعد التعديل');
  const downtime=await app.inject({method:'POST',url:'/api/v1/maintenance/work-orders/'+wo.json().id+'/downtime',headers,payload:{startedAt:'2026-01-05T09:00:00Z',endedAt:'2026-01-05T10:30:00Z',reason:'انتظار قطعة غيار'}});
  assert.equal(downtime.statusCode,201,downtime.body);
  const downtimeList=await app.inject({method:'GET',url:'/api/v1/maintenance/downtime',headers});
  assert.equal(downtimeList.statusCode,200,downtimeList.body);
  assert.ok(downtimeList.json().some(x=>x.id===downtime.json().id&&x.reason==='انتظار قطعة غيار'));
  const assetDuringWork=await pool.query('SELECT status FROM fixed_assets WHERE id=$1',[asset.json().id]);
  assert.equal(assetDuringWork.rows[0].status,'UNDER_MAINTENANCE');
  const completed=await app.inject({method:'POST',url:'/api/v1/maintenance/work-orders/'+wo.json().id+'/complete',headers,payload:{workPerformed:'تم تغيير رولمان البلي',laborCost:300,otherCost:50,downtimeMinutes:90}});
  assert.equal(completed.statusCode,200,completed.body);
  const closed=await app.inject({method:'POST',url:'/api/v1/maintenance/work-orders/'+wo.json().id+'/approve',headers,payload:{}});
  assert.equal(closed.statusCode,200,closed.body);
  assert.equal(closed.json().status,'APPROVED');

  const setting=await app.inject({method:'PUT',url:'/api/v1/settings/company',headers,payload:{nameAr:'شركة الاختبار',currency:'EGP',timezone:'Africa/Cairo',taxNumber:'TEST-TAX',commercialRegister:'TEST-CR'}});
  assert.equal(setting.statusCode,200,setting.body);
  const sequence=await app.inject({method:'POST',url:'/api/v1/settings/sequences',headers,payload:{documentType:code('DOC'),prefix:'HR-',nextValue:1,padding:6}});
  assert.equal(sequence.statusCode,201,sequence.body);
  const param=await app.inject({method:'PUT',url:'/api/v1/settings/parameters/HR.ATTENDANCE.AUTO_CLOSE',headers,payload:{value:{enabled:false},descriptionAr:'إغلاق الحضور الآلي'}});
  assert.equal(param.statusCode,200,param.body);
 } finally { await app.close(); await pool.end(); }
});
