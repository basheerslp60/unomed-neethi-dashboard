import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const $ = id => document.getElementById(id);
const names = ["Complete HC 599","My Health 999","Cardiac HC","EHC 2500","EHC Advanced 3500","Healthy Women 699","Healthy Men","EHC PRO 8499","Hairfall","Vitamin Profile","PCOD Mini","Onam Camp","Other Packages"];
let db, user, profile, branches = [], reports = [], targets = [];
let editingReportId = null;
const now = new Date();
const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0,10);
$('date').value = today;
$('branchTargetMonth').value = today.slice(0,7);
document.querySelectorAll('.nav-button').forEach(button => {
  button.addEventListener('click', () => {
    const target = $(button.dataset.target);
    if (!target || target.classList.contains('hidden')) return;
    document.querySelectorAll('.nav-button').forEach(item => item.classList.toggle('active', item === button));
    target.scrollIntoView({behavior:'smooth',block:'start'});
  });
});
$('packages').innerHTML = names.map((n,i) => `<div class="pkg"><label for="p${i}">${n}</label><input id="p${i}" type="number" min="0" step="1" value="0"></div>`).join('');
const ready = SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('PASTE_') && SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_') && !SUPABASE_PUBLISHABLE_KEY.includes('PASTE_');
function msg(id, s, ok=false) { $(id).textContent = s; $(id).style.color = ok ? '#16764a' : '#a21d37'; }
function show(id, v) { $(id).classList.toggle('hidden', !v); }
function refreshSidebarVisibility() {
  document.querySelectorAll('.nav-button[data-target]').forEach(button => {
    const target = $(button.dataset.target);
    button.classList.toggle('nav-hidden', !target || target.classList.contains('hidden'));
  });
}
function money(n) { return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(n||0)); }
function esc(s) { return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function monthStart(dateString=today) { return `${dateString.slice(0,7)}-01`; }
function daysLeftInclusive(dateString=today) { const [y,m,d] = dateString.split('-').map(Number); return Math.max(1, new Date(y,m,0).getDate() - d); }
function countWorkingDays(startDate, endDate) {
  if (endDate < startDate) return 0;
  const [sy,sm,sd]=startDate.split('-').map(Number);
  const [ey,em,ed]=endDate.split('-').map(Number);
  const cursor=new Date(sy,sm-1,sd), end=new Date(ey,em-1,ed);
  let count=0;
  while(cursor<=end) { if(cursor.getDay()!==0) count++; cursor.setDate(cursor.getDate()+1); }
  return count;
}
function monthEnd(dateString=today) {
  const [y,m]=dateString.split('-').map(Number);
  return `${y}-${String(m).padStart(2,'0')}-${String(new Date(y,m,0).getDate()).padStart(2,'0')}`;
}
function workingDaysRemaining(dateString=today) { return countWorkingDays(dateString,monthEnd(dateString)); }
function workingDaysElapsed(dateString=today) { return countWorkingDays(monthStart(dateString),dateString); }
function branchPaceState(ratio, achieved) {
  if (achieved) return {cls:'pace-green',emoji:'🏆',badge:'🏆 Target achieved',message:'Outstanding work! Your monthly target is achieved. Maintain quality and consistency.'};
  if (ratio>=1) return {cls:'pace-green',emoji:'🟢',badge:'🟢 On track',message:'Great work! Your branch is on track with the expected monthly pace.'};
  if (ratio>=.85) return {cls:'pace-blue',emoji:'👍',badge:'🔵 Almost on track',message:'Good progress. A little extra effort will bring the branch back on track.'};
  if (ratio>=.70) return {cls:'pace-yellow',emoji:'⚡',badge:'🟡 Needs a push',message:'Your branch is behind the expected pace. Focus on patient follow-ups and daily conversions.'};
  return {cls:'pace-red',emoji:'🚨',badge:'🔴 Attention needed',message:"Immediate attention needed. Work together on patient follow-ups and today's sales target."};
}
function fmtPct(n) { return `${(Number(n)||0).toFixed(1)}%`; }

if (!ready) {
  show('setup', true); msg('loginMsg','Add your Project URL and publishable key to src/config.js.');
} else {
  db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  db.auth.onAuthStateChange((ev,s) => { if (s?.user) setTimeout(() => load(s.user),0); else loggedOut(); });
  db.auth.getSession().then(({data}) => { if (data.session?.user) load(data.session.user); });
  $('loginForm').onsubmit = async e => { e.preventDefault(); msg('loginMsg','Signing in…'); const {error} = await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value}); if (error) msg('loginMsg',error.message); };
  $('forgot').onclick = async () => { const email=$('email').value.trim(); if(!email){msg('loginMsg','Enter your email first.');return;} const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname}); msg('loginMsg',error?error.message:'If the account exists, password reset instructions will be sent.'); };
  $('logout').onclick = () => db.auth.signOut();
  $('refresh').onclick = () => { if (user) load(user); };
  $('salesForm').onsubmit = submit;
  $('generateReport').onclick = generateManagementReport;
  $('copyReport').onclick = copyManagementReport;
  $('downloadReport').onclick = downloadManagementReport;
  $('complianceDate').value = today;
  $('complianceDate').addEventListener('change', () => renderCompliance(reports));
  $('copyCompliance').onclick = copyComplianceSummary;
  $('employeeRefresh').onclick = loadEmployeeModule;
  $('userAccessRefresh').onclick = loadPortalUsers;
  $('branchTargetMonth').addEventListener('change', loadBranchTargetEditor);
  $('dailySalesRefresh').onclick = loadDailyBranchSales;
  $('correctionRefresh').onclick = loadCorrectionReports;
  $('correctionDate').addEventListener('change', loadCorrectionReports);
  $('correctionBranch').addEventListener('change', loadCorrectionReports);
  $('correctionRows').addEventListener('click', async event => {
    const editBtn=event.target.closest('[data-correction-edit]');
    const historyBtn=event.target.closest('[data-correction-history]');
    if(editBtn) await beginEditReport(editBtn.dataset.correctionEdit);
    if(historyBtn) await viewReportHistory(historyBtn.dataset.correctionHistory);
  });
  $('cancelCorrection').onclick = cancelReportCorrection;
  $('analyticsRefresh').onclick = loadBranchAnalytics;
  $('targetDashboardMonth').value = today.slice(0,7);
  $('targetDashboardRefresh').onclick = loadTargetDashboard;
  $('targetDashboardMonth').addEventListener('change', loadTargetDashboard);
  $('targetDashboardNetwork').addEventListener('change', renderTargetDashboard);
  $('execDashboardMonth').value = today.slice(0,7);
  $('execDashboardRefresh').onclick = loadManagementExecutiveDashboard;
  $('execDashboardMonth').addEventListener('change', loadManagementExecutiveDashboard);
  $('execDashboardNetwork').addEventListener('change', renderManagementExecutiveDashboard);
  $('execDashboardExport').onclick = exportManagementExecutiveCSV;
  $('analyticsPeriod').addEventListener('change', loadBranchAnalytics);
  $('analyticsNetwork').addEventListener('change', renderBranchAnalytics);
  $('analyticsRows').addEventListener('click', event => {
    const button = event.target.closest('[data-analytics-branch]');
    if (button) renderBranchDrilldown(button.dataset.analyticsBranch);
  });
  $('analyticsDetailClose').onclick = () => $('analyticsDrilldown').classList.add('hidden');
  $('branchTargetNetwork').addEventListener('change', renderBranchTargetEditorRows);
  $('saveBranchTargets').onclick = saveBranchTargets;
  $('portalUserForm').onsubmit = createPortalUser;
  $('portalRole').addEventListener('change', updatePortalBranchVisibility);
// Sidebar navigation
document.querySelectorAll('.nav-btn').forEach(button => {
  button.addEventListener('click', () => {
    const targetId = button.dataset.target;
    const target = document.getElementById(targetId);

    if (!target) {
      alert('Section not found: ' + targetId);
      return;
    }

    // Hide all main content panels
    document.querySelectorAll(
      '#app > .card, #app > section, #app > .heading, #app > .stats, #app > .executive-grid'
    ).forEach(section => section.classList.add('hidden'));

    // Show the selected panel
    target.classList.remove('hidden');

    // Highlight the selected sidebar button
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    button.classList.add('active');

    // Return to the top of the page
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});
  $('employeeForm').onsubmit = addEmployee;
  $('activityForm').onsubmit = submitEmployeeActivity;
  $('employeeTargetForm').onsubmit = saveEmployeeTarget;
  $('targetEmployee').addEventListener('change', loadSelectedEmployeeTarget);
  $('targetMonth').addEventListener('change', loadSelectedEmployeeTarget);
  $('targetMonth').value = new Date().toISOString().slice(0,7);
  $('activityDate').value = today;
}

function loggedOut() { user=null; profile=null; show('login',true); show('app',false); show('userTools',false); show('userAccessSection',false); }

async function load(u) {
  if (!db || !u) return;
  user=u;
  const {data:p,error} = await db.from('profiles').select('user_id,full_name,role,branch_id,active').eq('user_id',u.id).maybeSingle();
  if(error || !p || !p.active) { await db.auth.signOut(); msg('loginMsg','No active portal profile. Ask admin to verify your role.'); return; }
  profile=p; $('app').dataset.role = p.role;
  const {data:b,error:be} = await db.from('branches').select('id,branch_name,network,active').eq('active',true).order('branch_name');
  if(be) { msg('loginMsg',be.message); return; }
  branches=b||[];
  $('who').textContent=p.full_name+' · '+p.role;
  if (p.role === 'admin') {
  $('portalBranch').innerHTML = branches.map(b => '<option value="' + b.id + '">' + esc(b.network) + ' - ' + esc(b.branch_name) + '</option>').join('');
    updatePortalBranchVisibility();
  }
  show('login',false); show('app',true); show('userTools',true); show('entry',p.role==='branch_staff');
  show('correctionBranchWrap',p.role!=='branch_staff');
  if(p.role==='branch_staff') $('correctionBranch').innerHTML='';
  else $('correctionBranch').innerHTML='<option value=>All permitted branches</option>'+branches.map(b=>`<option value="${esc(b.id)}">${esc(b.network)} - ${esc(b.branch_name)}</option>`).join('');
  show('managementReportSection',p.role!=='branch_staff');
  show('branchAnalyticsSection',p.role!=='branch_staff');
  show('targetDashboardSection',p.role!=='branch_staff');
  show('managementExecutiveSection',p.role!=='branch_staff');
  show('complianceSection',p.role!=='branch_staff');
  // User & Branch Access Management is visible only to the Super Admin.
  show('userAccessSection',p.role==='admin');
  show('branchTargetAdminSection',p.role==='admin');
  if(p.role==='admin') await loadBranchTargetEditor();
  $('title').textContent = p.role === 'branch_staff' ? (branches.find(x => x.id === p.branch_id)?.branch_name || 'Branch') + ' daily entry' : 'Management consolidated report';
  $('subtitle').textContent=p.role==='branch_staff'?'Submit sales for your assigned branch':'Targets and sales totals from reports permitted for your account';
  await loadReports();
  $('correctionDate').value='';
  await loadCorrectionReports();
  refreshSidebarVisibility();
  if (p.role === 'admin') await loadPortalUsers();
  await loadEmployeeModule();
  if (p.role !== 'branch_staff') { await loadBranchAnalytics(); await loadTargetDashboard(); await loadManagementExecutiveDashboard(); }
}


function updatePortalBranchVisibility() {
  const isStaff = $('portalRole')?.value === 'branch_staff';
  show('portalBranchWrap', isStaff);
  $('portalBranch').required = isStaff;
}

async function callAdminUserFunction(payload) {
  const { data: sessionData } = await db.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Your session has expired. Sign in again.');
  const { data, error } = await db.functions.invoke('admin-manage-user', {
    body: payload,
    headers: { Authorization: 'Bearer ' + token }
  });
  if (error) {
    let detail = error.message || 'Request failed.';
    try {
      const ctx = error.context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json();
        if (body?.error) detail = body.error;
      }
    } catch (_) {}
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function createPortalUser(e) {
  e.preventDefault();
  if (profile?.role !== 'admin') {
    msg('portalUserMsg','Only the Super Admin can create accounts.');
    return;
  }
  const role = $('portalRole').value;
  const payload = {
    action: 'create',
    full_name: $('portalFullName').value.trim(),
    email: $('portalEmail').value.trim().toLowerCase(),
    password: $('portalPassword').value,
    role,
    branch_id: role === 'branch_staff' ? Number($('portalBranch').value) : null
  };
  msg('portalUserMsg','Creating account…');
  try {
    const result = await callAdminUserFunction(payload);
    $('portalUserForm').reset();
    updatePortalBranchVisibility();
    msg('portalUserMsg', 'Account created for ' + (result.user?.email || payload.email) + '.', true);
    await loadPortalUsers();
  } catch (err) {
    msg('portalUserMsg',err.message || 'Could not create account.');
  }
}

async function setPortalUserActive(userId, active) {
  if (profile?.role !== 'admin') return;
  try {
    await callAdminUserFunction({action:'set_active', user_id:userId, active});
    await loadPortalUsers();
    msg('portalUserMsg', 'Account status updated.', true);
  } catch (err) {
    msg('portalUserMsg',err.message || 'Could not update account.');
  }
}

async function changePortalPassword(userId, userName) {
  if (profile?.role !== 'admin') {
    msg('portalUserMsg', 'Only the Super Admin can change passwords.');
    return;
  }
  const password = prompt('Enter a new password for ' + userName + ' (minimum 8 characters):');
  if (password === null) return;
  if (password.length < 8) {
    msg('portalUserMsg', 'Password must contain at least 8 characters.');
    return;
  }
  const confirmPassword = prompt('Re-enter the new password:');
  if (confirmPassword === null) return;
  if (password !== confirmPassword) {
    msg('portalUserMsg', 'The passwords do not match.');
    return;
  }
  if (!confirm('Change the password for ' + userName + '?')) return;
  msg('portalUserMsg', 'Updating password…');
  try {
    await callAdminUserFunction({ action: 'reset_password', user_id: userId, password: password });
    msg('portalUserMsg', 'Password changed successfully.', true);
  } catch (err) {
    msg('portalUserMsg', err.message || 'Could not change password.');
  }
}

async function loadPortalUsers() {
  if (profile?.role !== 'admin') return;
  $('portalUserRows').innerHTML = '<tr><td colspan="6">Loading users...</td></tr>';
  try {
    const result = await callAdminUserFunction({ action: 'list' });
    const rows = result.users || [];
    $('portalUserRows').innerHTML = rows.map(u => {
      const branch = u.branch_name ? ((u.network || '') + ' - ' + u.branch_name) : 'All permitted branches';
      const action = u.role === 'admin'
        ? '<span class="pill">Protected admin</span>'
        : (u.active
          ? '<button type="button" class="secondary" data-user-id="' + esc(u.user_id) + '" data-active="false">Deactivate</button>'
          : '<button type="button" data-user-id="' + esc(u.user_id) + '" data-active="true">Reactivate</button>');
      const passwordButton = '<button type="button" class="secondary" data-reset-user="' + esc(u.user_id) + '" data-user-name="' + esc(u.full_name || u.email || 'user') + '">Change password</button>';
      return '<tr>' +
        '<td>' + esc(u.full_name || '-') + '</td>' +
        '<td>' + esc(u.email || '-') + '</td>' +
        '<td>' + esc(u.role || '-') + '</td>' +
        '<td>' + esc(branch) + '</td>' +
        '<td><span class="pill">' + (u.active ? 'Active' : 'Inactive') + '</span></td>' +
        '<td>' + action + ' ' + passwordButton + '</td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="6">No portal users found.</td></tr>';

    $('portalUserRows').querySelectorAll('button[data-user-id]').forEach(btn => {
      btn.addEventListener('click', () => setPortalUserActive(btn.dataset.userId, btn.dataset.active === 'true'));
    });
    $('portalUserRows').querySelectorAll('button[data-reset-user]').forEach(btn => {
      btn.addEventListener('click', () => changePortalPassword(btn.dataset.resetUser, btn.dataset.userName));
    });
  } catch (err) {
    $('portalUserRows').innerHTML = '<tr><td colspan="6">' + esc(err.message || 'Could not load users.') + '</td></tr>';
  }
}

// Load all reports for the current month in pages, so MTD calculations do not depend on the recent-report limit.
async function loadAllCurrentMonthReports() {
  const start=monthStart($('performanceMonth')?.value || today);
  const [year,month]=start.split('-').map(Number);
  const nextMonth = new Date(year, month, 1).toISOString().slice(0, 10);
  let all=[], from=0, pageSize=500;
  while(true) {
    const {data,error}=await db.from('daily_reports').select('id,branch_id,report_date,total_sales,patient_count,status')
      .gte('report_date',start).lt('report_date',nextMonth).order('report_date',{ascending:false}).range(from,from+pageSize-1);
    if(error) throw error;
    all=all.concat(data||[]);
    if(!data || data.length<pageSize) break;
    from+=pageSize;
  }
  return all;
}

async function loadReports() {
  const {data:recent,error}=await db.from('daily_reports').select('id,branch_id,report_date,total_sales,patient_count,status').order('report_date',{ascending:false}).limit(500);
  if (error) { $('rows').innerHTML = '<tr><td colspan="7">' + esc(error.message) + '</td></tr>'; return; }
  reports=recent||[];
  let monthReports;
  try { monthReports=await loadAllCurrentMonthReports(); }
  catch(err) { $('targetMsg').textContent='Could not load complete month-to-date reports: '+(err.message||err); monthReports=reports.filter(r=>r.report_date?.startsWith(today.slice(0,7))); }
  const bm=new Map(branches.map(b=>[b.id,b]));
  const monthSales=monthReports.reduce((s,r)=>s+Number(r.total_sales||0),0);
  const patients=monthReports.reduce((s,r)=>s+Number(r.patient_count||0),0);
  const ds=monthReports.filter(r=>r.report_date===today).reduce((s,r)=>s+Number(r.total_sales||0),0);
  $('stats').innerHTML =
  '<div class="stat-card"><span>Today sales</span><strong>' + money(ds) + '</strong><small>Visible to this account</small></div>' +
  '<div class="stat-card"><span>MTD sales</span><strong>' + money(monthSales) + '</strong><small>Current month</small></div>' +
  '<div class="stat-card"><span>MTD patients</span><strong>' + patients.toLocaleString() + '</strong><small>Current month</small></div>';
  $('rows').innerHTML = reports.slice(0, 100).map(r => {
  const b = bm.get(r.branch_id) || {};
  return '<tr><td>' + esc(r.report_date) +
    '</td><td>' + esc(b.branch_name || 'Branch') +
    '</td><td>' + money(r.total_sales) +
    '</td><td>' + esc(r.patient_count) +
    '</td><td>' + esc(r.status || '') +
    '</td></tr>';
}).join('');
  $('reportMsg').textContent=profile.role==='branch_staff'?'Only permitted reports are displayed.':'Showing up to 100 recent reports from the latest 500 loaded rows. MTD summary uses paginated current-month records.';
  await renderTargets(monthReports);
  refreshSidebarVisibility();
  await renderCompliance(reports);
  renderDailyTrend(monthReports);
  const ids=reports.slice(0,100).map(r=>r.id);
  if(!ids.length) { $('packageSummary').textContent='No package data yet.'; return; }
  const {data:ps,error:pe}=await db.from('package_sales').select('package_name,quantity').in('report_id',ids);
  if(pe) { $('packageSummary').textContent='Package summary unavailable: '+pe.message; return; }
  const totals={}; (ps||[]).forEach(x=>totals[x.package_name]=(totals[x.package_name]||0)+Number(x.quantity||0));
  $('packageSummary').innerHTML = Object.entries(totals)
  .filter(x => x[1] > 0)
  .map(x => '<span class="pill">' + esc(x[0]) + ': ' + x[1] + '</span>')
  .join('') || 'No package counts recorded.';
}
function analyticsDateString(date) {
  const y=date.getFullYear(), m=String(date.getMonth()+1).padStart(2,'0'), d=String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function analyticsShiftDate(dateString, days) {
  const [y,m,d]=dateString.split('-').map(Number);
  const date=new Date(y,m-1,d); date.setDate(date.getDate()+days);
  return analyticsDateString(date);
}
function analyticsPeriodRanges() {
  const end=today;
  if ($('analyticsPeriod').value==='7d') {
    const currentStart=analyticsShiftDate(end,-6);
    return {currentStart,currentEnd:end,previousStart:analyticsShiftDate(currentStart,-7),previousEnd:analyticsShiftDate(currentStart,-1),label:`${currentStart} to ${end} compared with ${analyticsShiftDate(currentStart,-7)} to ${analyticsShiftDate(currentStart,-1)}`};
  }
  const [year,month,day]=end.split('-').map(Number);
  const prevMonthLast=new Date(year,month-1,0).getDate();
  const prevDay=Math.min(day,prevMonthLast);
  const previousStart=`${String(month===1?year-1:year).padStart(4,'0')}-${String(month===1?12:month-1).padStart(2,'0')}-01`;
  const previousEnd=`${previousStart.slice(0,7)}-${String(prevDay).padStart(2,'0')}`;
  return {currentStart:`${end.slice(0,7)}-01`,currentEnd:end,previousStart,previousEnd,label:`${end.slice(0,7)} month-to-date (${day} days) compared with ${previousStart.slice(0,7)} (${prevDay} days)`};
}
async function fetchAnalyticsReports(start,end) {
  let all=[],from=0,pageSize=500;
  while(true) {
    const {data,error}=await db.from('daily_reports').select('branch_id,report_date,total_sales,patient_count')
      .gte('report_date',start).lte('report_date',end).order('report_date',{ascending:true}).range(from,from+pageSize-1);
    if(error) throw error;
    all=all.concat(data||[]);
    if(!data || data.length<pageSize) break;
    from+=pageSize;
  }
  return all;
}
async function loadBranchAnalytics() {
  if(!profile || profile.role==='branch_staff' || !db) return;
  const rows=$('analyticsRows');
  rows.innerHTML='<tr><td colspan="8">Loading branch comparison…</td></tr>';
  $('analyticsMsg').textContent='Loading report records permitted for this account…';
  try {
    const range=analyticsPeriodRanges();
    const [current,previous]=await Promise.all([
      fetchAnalyticsReports(range.currentStart,range.currentEnd),
      fetchAnalyticsReports(range.previousStart,range.previousEnd)
    ]);
    window.__branchAnalyticsData={current,previous,range};
    renderBranchAnalytics();
  } catch(err) {
    rows.innerHTML='<tr><td colspan="8">Could not load analytics.</td></tr>';
    $('analyticsKpis').innerHTML='';
    $('analyticsMsg').textContent=(err.message||'Analytics query failed.')+' Check daily_reports access and Row Level Security.';
  }
}
function renderBranchAnalytics() {
  const data=window.__branchAnalyticsData;
  if(!data || !profile || profile.role==='branch_staff') return;
  const network=$('analyticsNetwork').value;
  const visible=branches.filter(b=>network==='ALL' || String(b.network).toUpperCase()===network);
  const sumFor=(rows,branchId)=>rows.filter(r=>String(r.branch_id)===String(branchId)).reduce((a,r)=>({sales:a.sales+Number(r.total_sales||0),patients:a.patients+Number(r.patient_count||0)}),{sales:0,patients:0});
  const results=visible.map(b=>{
    const c=sumFor(data.current,b.id), p=sumFor(data.previous,b.id);
    const salesChange=p.sales===0?(c.sales>0?null:0):((c.sales-p.sales)/p.sales)*100;
    const patientChange=p.patients===0?(c.patients>0?null:0):((c.patients-p.patients)/p.patients)*100;
    return {branch:b,current:c,previous:p,salesChange,patientChange,avg:c.patients?c.sales/c.patients:0};
  }).sort((a,b)=>b.current.sales-a.current.sales);
  const totals=results.reduce((a,r)=>({sales:a.sales+r.current.sales,patients:a.patients+r.current.patients,previousSales:a.previousSales+r.previous.sales,previousPatients:a.previousPatients+r.previous.patients}),{sales:0,patients:0,previousSales:0,previousPatients:0});
  const growth=(now,before)=>before===0?(now>0?null:0):((now-before)/before)*100;
  const salesGrowth=growth(totals.sales,totals.previousSales);
  const patientGrowth=growth(totals.patients,totals.previousPatients);
  const topSales=results[0];
  const topPatients=[...results].sort((a,b)=>b.current.patients-a.current.patients)[0];
  const bestGrowth=[...results].filter(r=>r.salesChange!==null && r.previous.sales>0).sort((a,b)=>b.salesChange-a.salesChange)[0];
  const growthText=v=>v===null?'New':`${v>=0?'+':''}${v.toFixed(1)}%`;
  $('analyticsPeriodLabel').textContent=data.range.label;
  $('analyticsKpis').innerHTML=
    `<div class="stat-card"><span>Total sales</span><strong>${money(totals.sales)}</strong><small>${growthText(salesGrowth)} vs previous period</small></div>`+
    `<div class="stat-card"><span>Total patients</span><strong>${totals.patients.toLocaleString('en-IN')}</strong><small>${growthText(patientGrowth)} vs previous period</small></div>`+
    `<div class="stat-card"><span>Network average bill</span><strong>${money(totals.patients?totals.sales/totals.patients:0)}</strong><small>Sales divided by patients</small></div>`+
    `<div class="stat-card"><span>Top sales branch</span><strong>${topSales?esc(topSales.branch.branch_name):'—'}</strong><small>${topSales?money(topSales.current.sales):'No sales recorded'}</small></div>`+
    `<div class="stat-card"><span>Top patient volume</span><strong>${topPatients?esc(topPatients.branch.branch_name):'—'}</strong><small>${topPatients?topPatients.current.patients.toLocaleString('en-IN')+' patients':'No patients recorded'}</small></div>`+
    `<div class="stat-card"><span>Best sales growth</span><strong>${bestGrowth?esc(bestGrowth.branch.branch_name):'—'}</strong><small>${bestGrowth?growthText(bestGrowth.salesChange):'No prior-period base'}</small></div>`;
  $('analyticsRows').innerHTML=results.map((r,i)=>`<tr><td>${i+1}</td><td><button type="button" class="analytics-branch-link" data-analytics-branch="${esc(String(r.branch.id))}" aria-label="View ${esc(r.branch.branch_name)} daily details">${esc(r.branch.branch_name)} <span>↗</span></button></td><td>${esc(r.branch.network)}</td><td>${money(r.current.sales)}</td><td class="${r.salesChange===null?'':r.salesChange>=0?'analytics-positive':'analytics-negative'}">${growthText(r.salesChange)}</td><td>${r.current.patients.toLocaleString('en-IN')}</td><td class="${r.patientChange===null?'':r.patientChange>=0?'analytics-positive':'analytics-negative'}">${growthText(r.patientChange)}</td><td>${money(r.avg)}</td></tr>`).join('') || '<tr><td colspan="8">No active branches found.</td></tr>';
  $('analyticsDrilldown').classList.add('hidden');
  $('analyticsMsg').textContent=`${results.length} branches · ${data.current.length} current-period reports and ${data.previous.length} previous-period reports visible to this account. Select a branch name to open its day-wise sales and patient details. A “New” change means the previous period had zero sales or patients.`;
}
function renderBranchDrilldown(branchId) {
  const data=window.__branchAnalyticsData;
  if(!data || !profile || profile.role==='branch_staff') return;
  const branch=branches.find(b=>String(b.id)===String(branchId));
  if(!branch) return;
  const daily=new Map();
  data.current.filter(r=>String(r.branch_id)===String(branchId)).forEach(r=>{
    const key=r.report_date;
    const item=daily.get(key)||{date:key,sales:0,patients:0};
    item.sales+=Number(r.total_sales||0);
    item.patients+=Number(r.patient_count||0);
    daily.set(key,item);
  });
  const days=[];
  let cursor=data.range.currentStart;
  while(cursor<=data.range.currentEnd) {
    days.push(daily.get(cursor)||{date:cursor,sales:0,patients:0});
    cursor=analyticsShiftDate(cursor,1);
  }
  const totals=days.reduce((a,d)=>({sales:a.sales+d.sales,patients:a.patients+d.patients}),{sales:0,patients:0});
  const maxSales=Math.max(1,...days.map(d=>d.sales));
  $('analyticsDetailTitle').textContent=branch.branch_name+' — '+branch.network;
  $('analyticsDetailPeriod').textContent='Daily breakdown for '+data.range.currentStart+' to '+data.range.currentEnd;
  $('analyticsDetailKpis').innerHTML=
    `<div class="stat-card"><span>Period sales</span><strong>${money(totals.sales)}</strong></div>`+
    `<div class="stat-card"><span>Patients served</span><strong>${totals.patients.toLocaleString('en-IN')}</strong></div>`+
    `<div class="stat-card"><span>Average bill</span><strong>${money(totals.patients?totals.sales/totals.patients:0)}</strong></div>`+
    `<div class="stat-card"><span>Reporting days</span><strong>${days.filter(d=>d.sales>0||d.patients>0).length} / ${days.length}</strong></div>`;
  $('analyticsDailyChart').innerHTML=days.map(d=>{
    const height=d.sales?Math.max(3,(d.sales/maxSales)*100):0;
    const label=d.date.slice(8,10)+'/'+d.date.slice(5,7);
    return `<div class="analytics-day"><div class="analytics-day-value">${d.sales?money(d.sales):'—'}</div><div class="analytics-day-track"><div class="analytics-day-bar" style="height:${height}%"></div></div><strong>${label}</strong><small>${d.patients} patients</small></div>`;
  }).join('');
  $('analyticsDailyRows').innerHTML=[...days].reverse().map(d=>`<tr><td>${d.date}</td><td>${money(d.sales)}</td><td>${d.patients.toLocaleString('en-IN')}</td><td>${money(d.patients?d.sales/d.patients:0)}</td></tr>`).join('');
  $('analyticsDrilldown').classList.remove('hidden');
  $('analyticsDrilldown').scrollIntoView({behavior:'smooth',block:'start'});
}

async function fetchTargetDashboardReports(start,end) {
  let all=[],from=0,pageSize=500;
  while(true) {
    const {data,error}=await db.from('daily_reports').select('branch_id,report_date,total_sales,patient_count')
      .gte('report_date',start).lte('report_date',end).order('report_date',{ascending:true}).range(from,from+pageSize-1);
    if(error) throw error;
    all=all.concat(data||[]);
    if(!data || data.length<pageSize) break;
    from+=pageSize;
  }
  return all;
}
async function loadTargetDashboard() {
  if(!profile || profile.role==='branch_staff' || !db) return;
  const month=$('targetDashboardMonth').value;
  if(!month) return;
  $('targetDashboardRows').innerHTML='<tr><td colspan="11">Loading target and sales data…</td></tr>';
  $('targetDashboardMsg').textContent='Loading records permitted for this account…';
  try {
    const start=month+'-01';
    const [year,mon]=month.split('-').map(Number);
    const lastDay=new Date(year,mon,0).getDate();
    const currentMonth=month===today.slice(0,7);
    const end=currentMonth?today:`${month}-${String(lastDay).padStart(2,'0')}`;
    const [{data:targetData,error:targetError},monthReports]=await Promise.all([
      db.from('branch_monthly_targets').select('branch_id,target_amount,target_month').eq('target_month',start),
      fetchTargetDashboardReports(start,end)
    ]);
    if(targetError) throw targetError;
    window.__targetDashboardData={month,start,end,lastDay,currentMonth,targets:targetData||[],reports:monthReports||[]};
    renderTargetDashboard();
  } catch(err) {
    $('targetDashboardRows').innerHTML='<tr><td colspan="11">Could not load target dashboard.</td></tr>';
    $('targetDashboardKpis').innerHTML='';
    $('targetDashboardMsg').textContent=(err.message||'Dashboard query failed.')+' Check branch_monthly_targets and daily_reports permissions.';
  }
}
function renderTargetDashboard() {
  const data=window.__targetDashboardData;
  if(!data || !profile || profile.role==='branch_staff') return;
  const network=$('targetDashboardNetwork').value;
  const visible=branches.filter(b=>network==='ALL'||String(b.network).toUpperCase()===network);
  const targetMap=new Map(data.targets.map(t=>[String(t.branch_id),Number(t.target_amount||0)]));
  const salesMap=new Map(),patientMap=new Map();
  data.reports.forEach(r=>{
    const id=String(r.branch_id);
    salesMap.set(id,(salesMap.get(id)||0)+Number(r.total_sales||0));
    patientMap.set(id,(patientMap.get(id)||0)+Number(r.patient_count||0));
  });
  const elapsedWorking=countWorkingDays(data.start,data.end);
  const totalWorking=countWorkingDays(data.start,`${data.month}-${String(data.lastDay).padStart(2,'0')}`);
  const remainingWorking=Math.max(0,totalWorking-elapsedWorking);
  const rows=visible.map(branch=>{
    const target=targetMap.get(String(branch.id))||0;
    const sales=salesMap.get(String(branch.id))||0;
    const patients=patientMap.get(String(branch.id))||0;
    const achievement=target?sales/target*100:0;
    const balance=Math.max(0,target-sales);
    const required=remainingWorking>0?Math.ceil(balance/remainingWorking):balance;
    const projected=elapsedWorking>0?(sales/elapsedWorking)*totalWorking:0;
    const expected=target&&totalWorking?target*elapsedWorking/totalWorking:0;
    const pace=expected>0?sales/expected:0;
    let status='Target missing',cls='target-status-none';
    if(target>0&&sales>=target){status='Target achieved';cls='target-status-good';}
    else if(target>0&&pace>=1){status='On track';cls='target-status-good';}
    else if(target>0&&pace>=.85){status='Needs attention';cls='target-status-warn';}
    else if(target>0){status='Critical';cls='target-status-bad';}
    return {branch,target,sales,patients,achievement,balance,required,projected,status,cls,missing:!target};
  }).sort((a,b)=>b.achievement-a.achievement||b.sales-a.sales);
  const totals=rows.reduce((a,r)=>({target:a.target+r.target,sales:a.sales+r.sales,patients:a.patients+r.patients,balance:a.balance+r.balance,projected:a.projected+r.projected}),{target:0,sales:0,patients:0,balance:0,projected:0});
  const achievement=totals.target?totals.sales/totals.target*100:0;
  const targetCount=rows.filter(r=>r.target>0).length;
  const achieved=rows.filter(r=>r.target>0&&r.sales>=r.target).length;
  const critical=rows.filter(r=>r.cls==='target-status-bad').length;
  const best=[...rows].filter(r=>r.target>0).sort((a,b)=>b.achievement-a.achievement)[0];
  const fmt=n=>`${(Number(n)||0).toFixed(1)}%`;
  $('targetDashboardPeriod').textContent=`${data.month} · ${data.start} to ${data.end} · ${elapsedWorking} of ${totalWorking} working days elapsed (Sundays excluded)`;
  $('targetDashboardKpis').innerHTML=
    `<div class="stat-card"><span>Total target</span><strong>${money(totals.target)}</strong><small>${targetCount} branches with targets</small></div>`+
    `<div class="stat-card"><span>Actual sales</span><strong>${money(totals.sales)}</strong><small>${fmt(achievement)} achieved</small></div>`+
    `<div class="stat-card"><span>Target balance</span><strong>${money(totals.balance)}</strong><small>Across selected branches</small></div>`+
    `<div class="stat-card"><span>Projected month-end</span><strong>${money(totals.projected)}</strong><small>Based on elapsed working-day average</small></div>`+
    `<div class="stat-card"><span>Patients</span><strong>${totals.patients.toLocaleString('en-IN')}</strong><small>Month-to-date / selected month</small></div>`+
    `<div class="stat-card"><span>Branches achieved</span><strong>${achieved} / ${targetCount}</strong><small>${critical} branches critical</small></div>`;
  $('targetDashboardAlerts').innerHTML=`<span class="target-alert-pill target-status-good">On track / achieved: ${rows.filter(r=>r.cls==='target-status-good').length}</span><span class="target-alert-pill target-status-warn">Needs attention: ${rows.filter(r=>r.cls==='target-status-warn').length}</span><span class="target-alert-pill target-status-bad">Critical: ${critical}</span><span class="target-alert-pill target-status-none">Target missing: ${rows.filter(r=>r.missing).length}</span>`;
  $('targetDashboardRows').innerHTML=rows.map((r,i)=>`<tr><td>${i+1}</td><td><strong>${esc(r.branch.branch_name)}</strong></td><td>${esc(r.branch.network)}</td><td>${r.target?money(r.target):'—'}</td><td>${money(r.sales)}</td><td class="${r.achievement>=100?'analytics-positive':r.target?'analytics-negative':''}">${r.target?fmt(r.achievement):'—'}</td><td><div class="target-progress-cell"><div class="target-progress-track"><span style="width:${Math.min(100,Math.max(0,r.achievement))}%"></span></div><small>${r.target?fmt(r.achievement):'No target'}</small></div></td><td>${r.target?money(r.balance):'—'}</td><td>${r.target?money(r.required):'—'}</td><td>${r.target?money(r.projected):'—'}</td><td><span class="target-alert-pill ${r.cls}">${r.status}</span></td></tr>`).join('')||'<tr><td colspan="11">No active branches found.</td></tr>';
  $('targetDashboardMsg').textContent=`${rows.length} active branches · Best achievement: ${best?best.branch.branch_name+' ('+fmt(best.achievement)+')':'No targets configured'} · Projected sales are estimates, not guaranteed results. For a future month, projection uses reported sales through the selected month end.`;
}

async function loadManagementExecutiveDashboard() {
  if (!profile || profile.role==='branch_staff' || !db) return;
  const month=$('execDashboardMonth').value || today.slice(0,7);
  const start=month+'-01';
  const [year,mon]=month.split('-').map(Number);
  const end=`${month}-${String(new Date(year,mon,0).getDate()).padStart(2,'0')}`;
  $('execDashboardMsg').textContent='Loading monthly sales and target records permitted for this account…';
  $('execDashboardBranches').innerHTML='<tr><td colspan="8">Loading branch performance…</td></tr>';
  try {
    let monthReports=[],from=0,pageSize=500;
    while(true) {
      const {data,error}=await db.from('daily_reports').select('branch_id,report_date,total_sales,patient_count,status')
        .gte('report_date',start).lte('report_date',end).order('report_date',{ascending:true}).range(from,from+pageSize-1);
      if(error) throw error;
      monthReports=monthReports.concat(data||[]);
      if(!data || data.length<pageSize) break;
      from+=pageSize;
    }
    const {data:targetData,error:targetError}=await db.from('branch_monthly_targets').select('branch_id,target_month,target_amount').eq('target_month',start);
    if(targetError) throw targetError;
    window.__managementExecutiveData={month,start,end,reports:monthReports,targets:targetData||[]};
    renderManagementExecutiveDashboard();
  } catch(err) {
    $('execDashboardBranches').innerHTML='<tr><td colspan="8">Could not load management dashboard.</td></tr>';
    $('execDashboardMsg').textContent=(err.message||'Dashboard query failed.')+' Check daily_reports and branch_monthly_targets access.';
  }
}
function renderManagementExecutiveDashboard() {
  const data=window.__managementExecutiveData;
  if(!data) return;
  const network=$('execDashboardNetwork').value;
  const allowed=branches.filter(b=>network==='ALL'||b.network===network);
  const ids=new Set(allowed.map(b=>String(b.id)));
  const reports=data.reports.filter(r=>ids.has(String(r.branch_id)));
  const targetMap=new Map(data.targets.map(t=>[String(t.branch_id),Number(t.target_amount||0)]));
  const sales=reports.reduce((s,r)=>s+Number(r.total_sales||0),0);
  const patients=reports.reduce((s,r)=>s+Number(r.patient_count||0),0);
  const targets=allowed.reduce((s,b)=>s+(targetMap.get(String(b.id))||0),0);
  const todayDate=data.month===today.slice(0,7)?today:data.end;
  const dailySales=reports.filter(r=>r.report_date===todayDate).reduce((s,r)=>s+Number(r.total_sales||0),0);
  const dailyPatients=reports.filter(r=>r.report_date===todayDate).reduce((s,r)=>s+Number(r.patient_count||0),0);
  const rows=allowed.map(branch=>{
    const br=reports.filter(r=>String(r.branch_id)===String(branch.id));
    const branchSales=br.reduce((s,r)=>s+Number(r.total_sales||0),0);
    const branchPatients=br.reduce((s,r)=>s+Number(r.patient_count||0),0);
    const target=targetMap.get(String(branch.id))||0;
    return {branch,sales:branchSales,patients:branchPatients,average:branchPatients?branchSales/branchPatients:0,target,achievement:target?branchSales/target*100:0};
  }).sort((a,b)=>b.sales-a.sales);
  const networkRows=['UNOMED','NEETHI'].map(name=>{
    const list=rows.filter(r=>r.branch.network===name);
    const ns=list.reduce((s,r)=>s+r.sales,0), np=list.reduce((s,r)=>s+r.patients,0), nt=list.reduce((s,r)=>s+r.target,0);
    return {name,sales:ns,patients:np,target:nt,average:np?ns/np:0,achievement:nt?ns/nt*100:0};
  }).filter(n=>network==='ALL'||n.name===network);
  $('execDashboardPeriod').textContent=`${data.month} · ${data.start} to ${data.end} · ${reports.length.toLocaleString('en-IN')} daily report records`;
  const kpis=[['Daily sales',money(dailySales),`${todayDate} · ${dailyPatients.toLocaleString('en-IN')} patients`],['Monthly sales',money(sales),`${data.month} selected period`],['Monthly patients',patients.toLocaleString('en-IN'),'Patients served'],['Average bill',money(patients?sales/patients:0),'Sales divided by patients'],['Monthly target',money(targets),`${allowed.filter(b=>targetMap.has(String(b.id))).length} branches with targets`],['Target achievement',targets?fmtPct(sales/targets*100):'—','Actual sales ÷ target']];
  $('execDashboardKpis').innerHTML=kpis.map((k,i)=>`<article class="exec-kpi exec-kpi-${i+1}"><span>${k[0]}</span><strong>${k[1]}</strong><small>${k[2]}</small></article>`).join('');
  $('execDashboardNetworks').innerHTML=networkRows.map(n=>`<article class="exec-network-card ${n.name==='NEETHI'?'exec-neethi':''}"><div><p class="eyebrow">${n.name} NETWORK</p><strong>${money(n.sales)}</strong><small>${n.patients.toLocaleString('en-IN')} patients · Average bill ${money(n.average)}</small></div><div class="exec-network-meta"><b>${n.target?fmtPct(n.achievement):'No target'}</b><small>${n.target?money(n.target)+' target':'Target not configured'}</small></div><div class="exec-network-track"><span style="width:${Math.min(100,Math.max(0,n.achievement))}%"></span></div></article>`).join('');
  const byDate=new Map(); reports.forEach(r=>byDate.set(r.report_date,(byDate.get(r.report_date)||0)+Number(r.total_sales||0)));
  const days=Array.from(byDate.entries()).sort((a,b)=>a[0].localeCompare(b[0]));
  const maxDay=Math.max(1,...days.map(x=>x[1]));
  $('execDashboardDaily').innerHTML=days.length?days.map(([date,value])=>`<div class="exec-day"><small>${date.slice(8,10)}</small><div class="exec-day-track" title="${date}: ${money(value)}"><span style="height:${Math.max(2,value/maxDay*100)}%"></span></div><b>${money(value)}</b></div>`).join(''):'<p>No daily sales records for this month.</p>';
  const best=rows[0], highestPatients=[...rows].sort((a,b)=>b.patients-a.patients)[0], lowest=[...rows].filter(r=>r.sales>0).sort((a,b)=>a.sales-b.sales)[0];
  $('execDashboardHighlights').innerHTML=[['Top sales branch',best?`${best.branch.branch_name} · ${money(best.sales)}`:'No sales data'],['Highest patient volume',highestPatients?`${highestPatients.branch.branch_name} · ${highestPatients.patients} patients`:'No patient data'],['Lowest sales among active branches',lowest?`${lowest.branch.branch_name} · ${money(lowest.sales)}`:'No sales data'],['Daily group sales',money(dailySales),`${dailyPatients.toLocaleString('en-IN')} patients on ${todayDate}`]].map(x=>`<div class="exec-highlight"><span>${x[0]}</span><strong>${x[1]}</strong>${x[2]?`<small>${x[2]}</small>`:''}</div>`).join('');
  $('execDashboardBranches').innerHTML=rows.map((r,i)=>`<tr><td>${i+1}</td><td><strong>${esc(r.branch.branch_name)}</strong></td><td>${esc(r.branch.network)}</td><td>${money(r.sales)}</td><td>${r.patients.toLocaleString('en-IN')}</td><td>${money(r.average)}</td><td>${r.target?money(r.target):'—'}</td><td>${r.target?fmtPct(r.achievement):'—'}</td></tr>`).join('')||'<tr><td colspan="8">No active branches found.</td></tr>';
  $('execDashboardMsg').textContent=`${rows.length} active branches · Best sales: ${best?best.branch.branch_name:'—'} · All figures are based on records and targets visible to the signed-in account.`;
}
function exportManagementExecutiveCSV() {
  const data=window.__managementExecutiveData;
  if(!data) { $('execDashboardMsg').textContent='Refresh the dashboard before exporting.'; return; }
  const network=$('execDashboardNetwork').value;
  const reports=data.reports;
  const rows=branches.filter(b=>network==='ALL'||b.network===network).map(b=>{
    const br=reports.filter(r=>String(r.branch_id)===String(b.id));
    const sales=br.reduce((s,r)=>s+Number(r.total_sales||0),0), patients=br.reduce((s,r)=>s+Number(r.patient_count||0),0);
    const target=Number(data.targets.find(t=>String(t.branch_id)===String(b.id))?.target_amount||0);
    return [b.branch_name,b.network,sales,patients,patients?sales/patients:0,target,target?sales/target*100:0];
  });
  const csv=[['Branch','Network','Sales','Patients','Average bill','Target','Achievement %'],...rows].map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`UNOMED_NEETHI_Management_${data.month}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}

async function loadDailyBranchSales() {
  const date = $('dailySalesDate').value;
  const rowsEl = $('dailySalesRows');
  const summaryEl = $('dailySalesSummary');
  const msgEl = $('dailySalesMsg');

  if (!date) {
    msgEl.textContent = 'Please select a date.';
    return;
  }

  rowsEl.innerHTML = '<tr><td colspan="5">Loading daily sales...</td></tr>';
  msgEl.textContent = '';

  const { data, error } = await db
    .from('daily_reports')
    .select('branch_id,report_date,total_sales,patient_count,status')
    .eq('report_date', date);

  if (error) {
          rowsEl.innerHTML = '<tr><td colspan="5">' + esc(error.message) + '</td></tr>';
    summaryEl.innerHTML = '';
    msgEl.textContent = 'Could not load daily sales. Check database permissions.';
    return;
  }

  const reportRows = data || [];
  const branchMap = new Map(branches.map(b => [String(b.id), b]));
  const totals = { sales: 0, patients: 0 };

  const visibleBranches = profile?.role === 'branch_staff'
  ? branches.filter(branch => String(branch.id) === String(profile.branch_id))
  : branches;

const branchRows = visibleBranches.map(branch => {
    const matches = reportRows.filter(
      r => String(r.branch_id) === String(branch.id)
    );

    const sales = matches.reduce(
      (sum, r) => sum + Number(r.total_sales || 0), 0
    );

    const patients = matches.reduce(
      (sum, r) => sum + Number(r.patient_count || 0), 0
    );

    totals.sales += sales;
    totals.patients += patients;

    return {
      branch,
      sales,
      patients,
      average: patients ? sales / patients : 0,
      submitted: matches.length > 0
    };
  });

rowsEl.innerHTML = branchRows.map(r => {
  return [
    '<tr>',
    '<td>' + esc(r.branch.branch_name) + '</td>',
    '<td>' + esc(r.branch.network || '') + '</td>',
    '<td><strong>' + money(r.sales) + '</strong></td>',
    '<td>' + r.patients.toLocaleString('en-IN') + '</td>',
    '<td>' + money(r.average) + '</td>',
    '</tr>'
  ].join('');
}).join('');

summaryEl.innerHTML = [
  ['Total daily sales', money(totals.sales)],
  ['Total patients', totals.patients.toLocaleString('en-IN')],
  [
    'Branches reporting',
    branchRows.filter(r => r.submitted).length + '/' + visibleBranches.length
  ]
].map(item => {
  return '<div class="stat">' +
    '<label>' + esc(item[0]) + '</label>' +
    '<strong>' + esc(item[1]) + '</strong>' +
    '</div>';
}).join('');

msgEl.textContent = 'Daily sales for ' + date + '. Branches without a report are shown as zero; please verify missing submissions.';
}


async function renderCompliance(fallbackReports=[]) {
  if (!profile || profile.role==='branch_staff' || !db) return;
  const date=$('complianceDate')?.value || today;
  $('complianceRows').innerHTML='<tr><td colspan="7">Checking submitted reports…</td></tr>';
  const {data,error}=await db.from('daily_reports').select('id,branch_id,report_date,total_sales,patient_count,status').eq('report_date',date);
  if(error) {
  $('complianceRows').innerHTML = '<tr><td colspan="7">' + esc(error.message) + '</td></tr>';
    $('complianceMsg').textContent='Compliance could not be verified. Check account permissions and try Refresh data.';
    return;
  }
  const dayReports=data||[];
  const rows=branches.map(b=>{
    const matches=dayReports.filter(r=>r.branch_id===b.id);
    const submitted=matches.some(r=>String(r.status||'').toLowerCase()==='submitted');
    const sales=matches.reduce((sum,r)=>sum+Number(r.total_sales||0),0);
    const patients=matches.reduce((sum,r)=>sum+Number(r.patient_count||0),0);
    const status=submitted?'Submitted':matches.length?'Needs review':'Missing';
    const cls=submitted?'alert-green':matches.length?'alert-yellow':'alert-red';
    const action=submitted?(matches.length>1?'Check multiple reports for duplicates':'No follow-up required'):matches.length?'Verify report status and correct it if needed':'Contact branch and request report submission';
    return {...b,matches:matches.length,submitted,sales,patients,status,cls,action};
  });
  const submitted=rows.filter(r=>r.submitted).length, missing=rows.filter(r=>r.status==='Missing').length, review=rows.filter(r=>r.status==='Needs review').length;
  $('complianceSummary').innerHTML =
    '<div class="alert-chip alert-green">Submitted: ' + submitted + '/' + rows.length + '</div>' +
    '<div class="alert-chip alert-red">Missing: ' + missing + '</div>' +
    '<div class="alert-chip alert-yellow">Needs review: ' + review + '</div>';

  // Render the branch-level compliance details into the table.
  $('complianceRows').innerHTML = rows.map(r =>
    '<tr>' +
      '<td>' + esc(r.branch_name || 'Branch') + '</td>' +
      '<td>' + esc(r.network || '') + '</td>' +
      '<td><span class="alert-chip ' + r.cls + '">' + esc(r.status) + '</span></td>' +
      '<td>' + r.matches + '</td>' +
      '<td>' + money(r.sales) + '</td>' +
      '<td>' + Number(r.patients || 0).toLocaleString('en-IN') + '</td>' +
      '<td>' + esc(r.action) + '</td>' +
    '</tr>'
  ).join('') || '<tr><td colspan="7">No active branches found.</td></tr>';

  window.__complianceReportText = [
    'DAILY REPORTING COMPLIANCE - ' + date,
    'Submitted: ' + submitted + '/' + rows.length + ' | Missing: ' + missing + ' | Needs review: ' + review,
    ...rows.map(r => r.branch_name + ' (' + r.network + '): ' + r.status + ' | Reports: ' + r.matches + ' | Sales: ' + money(r.sales) + ' | Patients: ' + r.patients + ' | ' + r.action)
  ].join('\n');
  $('complianceMsg').textContent = 'Compliance checked for ' + date + '. Review the branch details below.';
}
function copyComplianceSummary() {
  const text=window.__complianceReportText||'';
  if(!text){$('complianceMsg').textContent='Generate the compliance view first.';return;}
  navigator.clipboard.writeText(text).then(()=>{$('complianceMsg').textContent='Compliance summary copied. Paste it into your management group.';}).catch(()=>{$('complianceMsg').textContent='Clipboard access was blocked. Select and copy the summary manually.';});
}

async function loadBranchTargetEditor() {
  if (profile?.role !== 'admin') return;
  const month = $('branchTargetMonth').value;
  if (!month) return;
  $('branchTargetAdminRows').innerHTML = '<tr><td colspan="3">Loading targets…</td></tr>';
  try {
    const {data, error} = await db.from('branch_monthly_targets').select('branch_id,target_amount,target_month').eq('target_month', month + '-01');
    if (error) throw error;
    window.__branchTargetEditorValues = new Map((data||[]).map(x => [String(x.branch_id), Number(x.target_amount||0)]));
    renderBranchTargetEditorRows();
  } catch (err) {
      $('branchTargetAdminRows').innerHTML = '<tr><td colspan="3">' + esc(err.message || 'Could not load targets') + '</td></tr>';
    msg('branchTargetAdminMsg', err.message || 'Could not load targets.');
  }
}
function renderBranchTargetEditorRows() {
  if (profile?.role !== 'admin') return;
  const network = $('branchTargetNetwork').value;
  const vals = window.__branchTargetEditorValues || new Map();
  const list = branches.filter(b => network === 'ALL' || b.network === network).sort((a,b)=>String(a.network).localeCompare(String(b.network))||String(a.branch_name).localeCompare(String(b.branch_name)));
   $('branchTargetAdminRows').innerHTML = list.map(b => '<tr><td>' + esc(b.network) + '</td><td>' + esc(b.branch_name) + '</td><td><input class="branch-target-value" data-branch-id="' + esc(b.id) + '" type="number" min="0" step="1" value="' + (vals.get(String(b.id)) || 0) + '"></td></tr>').join('');  updateBranchTargetTotal();
  $('branchTargetAdminRows').querySelectorAll('.branch-target-value').forEach(el => el.addEventListener('input', updateBranchTargetTotal));
}
function updateBranchTargetTotal() {
  const total = [...document.querySelectorAll('.branch-target-value')].reduce((s,e)=>s+Math.max(0,Number(e.value)||0),0);
  $('branchTargetAdminTotal').textContent = 'Visible branches total: ' + money(total);
}
async function saveBranchTargets() {
  if (profile?.role !== 'admin') { msg('branchTargetAdminMsg','Only Super Admin can edit branch targets.'); return; }
  const month = $('branchTargetMonth').value;
  if (!month) { msg('branchTargetAdminMsg','Select a month first.'); return; }
  const rows = [...document.querySelectorAll('.branch-target-value')];
  if (rows.some(e => !Number.isFinite(Number(e.value)) || Number(e.value)<0)) { msg('branchTargetAdminMsg','Enter valid non-negative target amounts.'); return; }
  const payload = rows.map(e=>({branch_id:Number(e.dataset.branchId),target_month:month+'-01',target_amount:Number(e.value),updated_by:user.id,updated_at:new Date().toISOString()}));
  if (!payload.length) { msg('branchTargetAdminMsg','No branches to save.'); return; }
  $('saveBranchTargets').disabled = true;
  try {
    const {error} = await db.from('branch_monthly_targets').upsert(payload,{onConflict:'branch_id,target_month'});
    if (error) throw error;
    msg('branchTargetAdminMsg','Monthly targets saved successfully.',true);
    await loadBranchTargetEditor();
    await generateManagementReport();
  } catch(err) { msg('branchTargetAdminMsg',err.message||'Could not save targets. Check table permissions.'); }
  finally { $('saveBranchTargets').disabled = false; }
}

async function renderTargets(monthReports) {
  const isStaff=profile.role==='branch_staff';
  show('targetSection',!isStaff);
  show('branchDailyTargetSection',isStaff);
  const targetMonth=monthStart();
  let targetQuery=db.from('branch_monthly_targets').select('branch_id,target_month,target_amount').eq('target_month',targetMonth);
  if(isStaff) targetQuery=targetQuery.eq('branch_id',profile.branch_id);
  const {data:targetData,error}=await targetQuery;
  if (error) {
    if (isStaff) {
      ['branchMonthlyTarget','branchMtdSales','branchBalanceTarget','branchRequiredDaily'].forEach(id => $(id).textContent = '—');
      $('branchDailyTargetNote').textContent = 'Could not load target: ' + error.message;
    } else {
      $('targetRows').innerHTML = '<tr><td colspan="10">' + esc(error.message) + '</td></tr>';
      $('targetMeta').textContent = 'Could not load monthly targets.';
    }
    return;
  }
  targets=targetData||[];
  const salesByBranch=new Map(),patientsByBranch=new Map();
  monthReports.forEach(r=>{salesByBranch.set(r.branch_id,(salesByBranch.get(r.branch_id)||0)+Number(r.total_sales||0));patientsByBranch.set(r.branch_id,(patientsByBranch.get(r.branch_id)||0)+Number(r.patient_count||0));});
  if(isStaff) {
    const own=targets.find(t=>String(t.branch_id)===String(profile.branch_id));
    const target=Number(own?.target_amount||0);
    const branchReports=(monthReports||[]).filter(r=>String(r.branch_id)===String(profile.branch_id));
    const sales=branchReports.reduce((sum,r)=>sum+Number(r.total_sales||0),0);
    const patients=branchReports.reduce((sum,r)=>sum+Number(r.patient_count||0),0);
    const todaySales=branchReports.filter(r=>r.report_date===today).reduce((sum,r)=>sum+Number(r.total_sales||0),0);
    const balance=Math.max(target-sales,0), days=workingDaysRemaining(), elapsed=workingDaysElapsed();
    const required=days>0?Math.ceil(balance/days):balance;
    const achievement=target>0?sales/target*100:0;
    const expected=target>0&&elapsed>0?target*elapsed/Math.max(countWorkingDays(monthStart(),monthEnd()),1):0;
    const paceRatio=expected>0?sales/expected:0;
    const state=branchPaceState(paceRatio,target>0&&sales>=target);
    const todayPct=required>0?Math.min(100,todaySales/required*100):(todaySales>0?100:0);
    const todayGap=Math.max(required-todaySales,0);
    $('branchMonthlyTarget').textContent=own?money(target):'Not set';
    $('branchMtdSales').textContent=money(sales);
    $('branchBalanceTarget').textContent=own?money(balance):'—';
    $('branchRequiredDaily').textContent=own?money(required):'—';
    $('branchTodaySales').textContent=money(todaySales);
    const patientsEl = $('branchPatients');
if (patientsEl) {
    patientsEl.textContent = patients.toLocaleString('en-IN');
}
    $('branchAchievement').textContent=own?fmtPct(achievement):'—';
    const requiredHeroEl = $('branchRequiredDailyHero');
if (requiredHeroEl) {
    requiredHeroEl.textContent = own ? money(required) : 'Target not set';
}
    const workingDaysEl = $('branchWorkingDays');
if (workingDaysEl) {
    workingDaysEl.textContent = days + ' working days left';
}

const workingDaysValueEl = $('branchWorkingDaysValue');
if (workingDaysValueEl) {
    workingDaysValueEl.textContent = String(days);
}
    const performanceBadgeEl = $('branchPerformanceBadge');
if (performanceBadgeEl) {
    performanceBadgeEl.textContent = own ? state.badge : '⚠️ Target missing';
}
    const targetEmojiEl = $('branchTargetEmoji');
if (targetEmojiEl) targetEmojiEl.textContent = own ? state.emoji : '⚠️';

const targetHeroEl = $('branchTargetHero');
if (targetHeroEl) targetHeroEl.className = 'target-hero ' + (own ? state.cls : 'pace-red');

const progressPctEl = $('branchTodayProgressLabel');
if (progressPctEl) {
    progressPctEl.textContent = own ? fmtPct(todayPct) : '—';
}

const gaugePctEl = $('branchTodayProgress');
if (gaugePctEl) {
    gaugePctEl.textContent = own ? fmtPct(todayPct) : '—';
}

const progressBarEl = $('branchTodayProgressBar');
if (progressBarEl) progressBarEl.style.width = (own ? todayPct : 0) + '%';

const gapEl = $('branchTodayGap');
if (gapEl) gapEl.textContent = !own
  ? 'Please contact management to set your monthly target.'
  : todayGap > 0
    ? `⚡ ${money(todayGap)} more needed today`
    : 'Daily target achieved!';

const noteEl = $('branchDailyTargetNote');
if (noteEl) noteEl.textContent = !own
  ? 'Your monthly target has not been set. Please contact management.'
  : state.message;

const dateEl = $('branchDailyTargetDate');
if (dateEl) dateEl.textContent = targetMonth.slice(0,7) + ' · ' + days + ' working day(s) remaining, Sundays excluded';
    
const trend = document.getElementById('branchDailyTrend');

const [yy, mm, dd] = today.split('-').map(Number);
const end = new Date(yy, mm - 1, dd);
const start = new Date(yy, mm - 1, dd - 6);
const trendRows = [];

for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

    const value = branchReports
        .filter(r => String(r.report_date).slice(0, 10) === key)
        .reduce((sum, r) => sum + Number(r.total_sales || 0), 0);

    trendRows.push({ key, value });
}

const maxValue = Math.max(1, ...trendRows.map(x => x.value));

if (trend) {
    trend.innerHTML = `
        <div class="branch-week-trend">
            ${trendRows.map(({key, value}) => `
                <div class="branch-week-day">
                    <strong>${money(value)}</strong>
                    <div class="branch-week-bar-area">
                        <div class="branch-week-bar"
                            style="height:${value > 0 ? Math.max(3, value / maxValue * 100) : 0}%">
                        </div>
                    </div>
                    <span>${key.slice(8,10)}/${key.slice(5,7)}</span>
                </div>
            `).join('')}
        </div>
    `;
}

 
    return;
  }
  targets=targetData||[];
  const now=new Date();
  const daysInMonth=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
  const elapsedDays=Math.max(1,now.getDate());
const remainingCalendarDays=Math.max(1,daysInMonth-now.getDate()+1);
  const rows=branches.map(b=>{
    const targetRow=targets.find(t=>t.branch_id===b.id); const target=Number(targetRow?.target_amount||0); const sales=Number(salesByBranch.get(b.id)||0); const pat=Number(patientsByBranch.get(b.id)||0);
    const achievement=target?sales/target*100:0;
    const expectedSales=target*elapsedDays/daysInMonth;
    const paceRatio=expectedSales?sales/expectedSales:0;
    let alert = 'No target';
let alertClass = 'alert-none';
let advice = 'Set a monthly target';

if (target > 0 && sales >= target) {
  alert = 'Target achieved';
  alertClass = 'alert-green';
  advice = 'Maintain service and sales quality';
} else if (target > 0 && paceRatio >= 1) {
  alert = 'On track';
  alertClass = 'alert-green';
  advice = 'Maintain current pace';
} else if (target > 0 && paceRatio >= 0.85) {
  alert = 'Needs attention';
  alertClass = 'alert-yellow';
  advice = 'Review daily follow-up';
} else if (target > 0) {
  alert = 'Critical';
  alertClass = 'alert-red';
  advice = 'Prepare a recovery plan';
}

if(target > 0 && sales >= target){
  alert='Target achieved';
  alertClass='alert-green';
  advice='Maintain service and sales quality';
}
else if(target > 0 && paceRatio >= 1){
  alert='On track';
  alertClass='alert-green';
  advice='Maintain current pace';
}
else if(target > 0 && paceRatio >= 0.85){
  alert='Needs attention';
  alertClass='alert-yellow';
  advice='Review daily follow-up';
}
else if(target > 0){
  alert='Critical';
  alertClass='alert-red';
  advice='Prepare a recovery plan';
}
return {...b,target,sales,patients:pat,achievement,balance:Math.max(target-sales,0),required:Math.ceil(Math.max(target-sales,0)/remainingCalendarDays),missing:!targetRow,alert,alertClass,advice};
  }).sort((a,b)=>b.achievement-a.achievement || b.sales-a.sales);
  const networks=['UNOMED','NEETHI'];
  const totalsByNetwork=networks.map(network=>{const arr=rows.filter(r=>r.network===network);return {network,target:arr.reduce((s,r)=>s+r.target,0),sales:arr.reduce((s,r)=>s+r.sales,0),patients:arr.reduce((s,r)=>s+r.patients,0),missing:arr.filter(r=>r.missing).length};});
  const groupTarget=rows.reduce((s,r)=>s+r.target,0),groupSales=rows.reduce((s,r)=>s+r.sales,0),groupPatients=rows.reduce((s,r)=>s+r.patients,0);
  window.__managementReportData={rows,groupTarget,groupSales,groupPatients,unomed:networks.find(n=>n==='UNOMED'),neethi:networks.find(n=>n==='NEETHI'),targetMonth};
  show('executiveSection', !isStaff);
  const net=(name)=>totalsByNetwork.find(n=>n.network===name)||{sales:0,target:0,patients:0};
  const un=net('UNOMED'), ne=net('NEETHI');
$('unomedExecSales').textContent = money(un.sales);
$('unomedExecMeta').textContent = money(un.target) + ' target · ' + (un.target ? fmtPct(un.sales / un.target * 100) : '0.0%');
$('neethiExecSales').textContent = money(ne.sales);
$('neethiExecMeta').textContent = money(ne.target) + ' target · ' + (ne.target ? fmtPct(ne.sales / ne.target * 100) : '0.0%');
$('unomedExecBar').style.width = Math.min(100, un.target ? un.sales / un.target * 100 : 0) + '%';
$('neethiExecBar').style.width = Math.min(100, ne.target ? ne.sales / ne.target * 100 : 0) + '%';
const alertCounts={green:rows.filter(r=>r.alertClass==='alert-green').length,yellow:rows.filter(r=>r.alertClass==='alert-yellow').length,red:rows.filter(r=>r.alertClass==='alert-red').length,none:rows.filter(r=>r.alertClass==='alert-none').length};
$('targetMeta').textContent = targetMonth.slice(0, 7) + ' · ' + rows.filter(r => !r.missing).length + '/' + branches.length + ' branch targets loaded.';
    $('alertSummary').innerHTML =
      '<div class="alert-chip alert-green">🟢 On track / achieved: ' + alertCounts.green + '</div>' +
      '<div class="alert-chip alert-yellow">🟡 Needs attention: ' + alertCounts.yellow + '</div>' +
      '<div class="alert-chip alert-red">🔴 Critical: ' + alertCounts.red + '</div>';

    $('targetRows').innerHTML = rows.map((r, i) =>
      '<tr><td>' + (i + 1) + '</td><td>' + esc(r.branch_name) +
      (r.missing ? ' <span class="pill">Target missing</span>' : '') +
      '</td><td>' + esc(r.network) + '</td><td>' + money(r.sales) +
      '</td><td>' + Number(r.patients || 0).toLocaleString('en-IN') + '</td><td>' + money(r.target) +
      '</td><td>' + fmtPct(r.achievement) + '</td><td>' + money(r.balance) +
      '</td><td>' + money(r.required) +
      '</td><td><span class="alert-chip ' + r.alertClass + '">' + esc(r.alert) +
      '</span></td></tr>'
    ).join('');

    const summary = totalsByNetwork.map(n =>
      n.network + ': sales ' + money(n.sales) + ' / target ' + money(n.target) +
      ' (' + (n.target ? fmtPct(n.sales / n.target * 100) : '0.0%') + ' achievement)'
    ).join(' · ');

  $('targetMsg').textContent =
    summary + ' · GROUP: ' + money(groupSales) +
    ' / ' + money(groupTarget) + ' (' +
    (groupTarget ? fmtPct(groupSales / groupTarget * 100) : '0.0%') +
    ' achievement)';

}

function renderDailyTrend(monthReports) {
  const byDate = new Map();

  monthReports.forEach(r => {
    const d = r.report_date;
    if (!d) return;
    byDate.set(d, (byDate.get(d) || 0) + Number(r.total_sales || 0));
  });

  const dates = [...byDate.keys()].sort();

  if (!dates.length) {
    $('dailyTrend').innerHTML = '<p>No sales reports available for this month yet.</p>';
    return;
  }

  const max = Math.max(...dates.map(d => byDate.get(d)), 1);

  $('dailyTrend').innerHTML = dates.map(d => {
    const v = byDate.get(d);
    const height = Math.max(2, v / max * 100);
    return '<div class="trend-day" title="' + esc(d) + ' · ' + money(v) + '">' +
      '<div class="trend-bar-wrap"><span class="trend-bar" style="height:' + height + '%"></span></div>' +
      '<small>' + esc(d.slice(8)) + '</small>' +
      '</div>';
  }).join('');
}
function generateManagementReport() {
  const box=$('managementReportText');
  const data=window.__managementReportData;
  if(!data) { $('managementReportMsg').textContent='Target data is not ready yet. Press Refresh data and try again.'; return; }
  const dateLabel=new Date(today+'T12:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
  const rows=data.rows||[];
  const networkSummary=(network)=>{const arr=rows.filter(r=>r.network===network);const target=arr.reduce((s,r)=>s+r.target,0);const sales=arr.reduce((s,r)=>s+r.sales,0);const balance=Math.max(target-sales,0);return {target,sales,balance,pct:target?sales/target*100:0,arr};};
  const un=networkSummary('UNOMED'),ne=networkSummary('NEETHI');
  const groupTarget=un.target+ne.target,groupSales=un.sales+ne.sales,groupBalance=Math.max(groupTarget-groupSales,0);
  const dailyToday=reports.filter(r=>r.report_date===today).reduce((s,r)=>s+Number(r.total_sales||0),0);
  const prevDate=new Date(new Date(today+'T12:00:00').getTime()-86400000).toISOString().slice(0,10);
  const dailyPrev=reports.filter(r=>r.report_date===prevDate).reduce((s,r)=>s+Number(r.total_sales||0),0);
  const pct = n => n.toFixed(1) + '%';
  const lines = ['📊 UNOMED + NEETHI — MANAGEMENT REPORT', '📅 As on ' + dateLabel, '', '📈 GROUP PERFORMANCE', 'Sales: ' + money(groupSales) + ' / ' + money(groupTarget)];
  const critical=rows.filter(r=>r.alertClass==='alert-red'); const missing=rows.filter(r=>r.missing);
  lines.push('', '🚦 MANAGEMENT FOLLOW-UP');
  if(critical.length) lines.push('Critical pace: '+critical.map(r=>r.branch_name).join(', ')+'.'); else lines.push('No branches currently flagged critical by the calendar-day pace rule.');
  if(missing.length) lines.push('Missing monthly target: '+missing.map(r=>r.branch_name).join(', ')+'.');
  lines.push('', 'Note: pace alerts compare MTD sales with expected calendar-day progress. Confirm records before official circulation.');
  box.value=lines.join('\n'); $('managementReportMsg').textContent='Report generated. Review the figures, then copy or download it.'; $('managementReportMsg').style.color='#16764a';
}
async function copyManagementReport() {
  const textValue=$('managementReportText').value;
  if(!textValue.trim()) { $('managementReportMsg').textContent='Generate the report first.'; return; }
  try { await navigator.clipboard.writeText(textValue); $('managementReportMsg').textContent='Copied. You can paste it into your management WhatsApp group.'; $('managementReportMsg').style.color='#16764a'; }
  catch { $('managementReportText').focus(); $('managementReportText').select(); $('managementReportMsg').textContent='Clipboard access was blocked. The report is selected; press Ctrl+C to copy.'; }
}
function downloadManagementReport() {
  const textValue=$('managementReportText').value;
  if(!textValue.trim()) { $('managementReportMsg').textContent='Generate the report first.'; return; }
  const blob = new Blob([textValue + '\n'], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'unomed-neethi-management-report.txt'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

async function submit(e) {
  e.preventDefault();
  if(!editingReportId && profile.role!=='branch_staff') { msg('salesMsg','Only branch staff can submit new reports.'); return; }
  const branch=branches.find(b=>b.id===profile.branch_id);
  if(!editingReportId && !branch) { msg('salesMsg','No valid active branch assigned.'); return; }
  const btn=$('salesForm').querySelector('button[type="submit"],button:not([type])');
  btn.disabled=true; msg('salesMsg',editingReportId?'Saving corrections…':'Submitting…');
  try {
    const packages=names.map((name,i)=>({package_name:name,quantity:Number($('p'+i).value||0)})).filter(x=>x.quantity>0);
    if(editingReportId) {
      const {error}=await db.rpc('correct_daily_report',{p_report_id:String(editingReportId),p_report_date:$('date').value,p_total_sales:Number($('sales').value),p_patient_count:Number($('patients').value),p_home_collections:Number($('home').value||0),p_google_reviews:Number($('reviews').value||0),p_packages:packages});
      if(error) throw error;
      msg('salesMsg','Report corrections saved successfully. The original report was updated.',true);
      cancelReportCorrection(false);
      await loadReports(); await loadCorrectionReports();
    } else {
      const {data:r,error}=await db.from('daily_reports').insert({branch_id:branch.id,report_date:$('date').value,total_sales:Number($('sales').value),patient_count:Number($('patients').value),home_collections:Number($('home').value||0),google_reviews:Number($('reviews').value||0),submitted_by:user.id,status:'submitted'}).select('id').single();
      if(error) throw error;
      const rows=packages.map(x=>({...x,report_id:r.id}));
      if(rows.length) { const {error:pe}=await db.from('package_sales').insert(rows); if(pe) throw new Error('Report saved but package counts failed. Check the database before retrying: '+pe.message); }
      msg('salesMsg','Report submitted.',true); $('salesForm').reset(); $('date').value=today; names.forEach((_,i)=>$('p'+i).value=0); await loadReports(); await loadCorrectionReports();
    }
  } catch(err) { msg('salesMsg',err.message||'Submission failed'); }
  finally { btn.disabled=false; }
}

async function loadCorrectionReports() {
  if(!db || !profile) return;
  const body=$('correctionRows');
  body.innerHTML='<tr><td colspan="5">Loading reports…</td></tr>';
  let query=db.from('daily_reports').select('id,branch_id,report_date,total_sales,patient_count,home_collections,google_reviews,status').order('report_date',{ascending:false}).limit(200);
  const date=$('correctionDate').value, branchId=$('correctionBranch').value;
  if(date) query=query.eq('report_date',date);
  if(profile.role==='branch_staff') query=query.eq('branch_id',profile.branch_id);
  else if(branchId) query=query.eq('branch_id',branchId);
  const {data,error}=await query;
  if(error) { body.innerHTML=`<tr><td colspan="5">${esc(error.message)}</td></tr>`; $('correctionMsg').textContent='Could not load reports. Check report read permissions.'; return; }
  const list=data||[], branchMap=new Map(branches.map(b=>[String(b.id),b]));
  if(!list.length) { body.innerHTML='<tr><td colspan="5">No submitted reports found for this filter.</td></tr>'; $('correctionMsg').textContent=''; return; }
  body.innerHTML=list.map(r=>{const b=branchMap.get(String(r.branch_id))||{};return `<tr><td>${esc(r.report_date)}</td><td>${esc(b.branch_name||'Branch')}</td><td>${money(r.total_sales)}</td><td>${Number(r.patient_count||0).toLocaleString('en-IN')}</td><td><button type="button" class="secondary" data-correction-edit="${esc(r.id)}">Edit</button> <button type="button" class="secondary" data-correction-history="${esc(r.id)}">History</button></td></tr>`;}).join('');
  $('correctionMsg').textContent=`Showing ${list.length} recent permitted report(s), maximum 200.`;
}

async function beginEditReport(id) {
  $('correctionMsg').textContent='Loading report details…';
  const {data:r,error}=await db.from('daily_reports').select('id,branch_id,report_date,total_sales,patient_count,home_collections,google_reviews').eq('id',id).maybeSingle();
  if(error || !r) { $('correctionMsg').textContent=error?.message||'Report not found or access denied.'; return; }
  const {data:ps,error:pe}=await db.from('package_sales').select('package_name,quantity').eq('report_id',r.id);
  if(pe) { $('correctionMsg').textContent='Could not load package counts: '+pe.message; return; }
  editingReportId=r.id;
  $('date').value=r.report_date||today; $('sales').value=Number(r.total_sales||0); $('patients').value=Number(r.patient_count||0); $('home').value=Number(r.home_collections||0); $('reviews').value=Number(r.google_reviews||0);
  names.forEach((name,i)=>{const row=(ps||[]).find(x=>x.package_name===name);$('p'+i).value=Number(row?.quantity||0);});
  const submitBtn=$('salesForm').querySelector('button[type="submit"],button:not([type])'); submitBtn.textContent='Save corrections';
  $('correctionMsg').textContent=`Editing report ${r.report_date}. Update the fields in Daily Sales Entry and save.`;
  $('salesMsg').textContent='Correction mode: changes will update this existing report.';
  $('entry').classList.remove('hidden'); $('entry').scrollIntoView({behavior:'smooth',block:'start'});
}

function cancelReportCorrection(clearMessage=true) {
  editingReportId=null;
  $('salesForm').reset(); $('date').value=today; names.forEach((_,i)=>$('p'+i).value=0);
  const submitBtn=$('salesForm').querySelector('button[type="submit"],button:not([type])'); submitBtn.textContent='Submit daily report';
  if(clearMessage) $('salesMsg').textContent='Correction cancelled.';
}

async function viewReportHistory(id) {
  const panel=$('correctionHistory'), target=$('correctionHistoryRows');
  panel.classList.remove('hidden'); target.textContent='Loading history…';
  const {data,error}=await db.from('daily_report_change_log').select('changed_at,changed_by,old_values,new_values').eq('report_id',String(id)).order('changed_at',{ascending:false}).limit(20);
  if(error) { target.textContent='History unavailable: '+error.message; return; }
  if(!data?.length) { target.textContent='No corrections have been recorded for this report.'; return; }
  target.innerHTML=data.map(x=>`<article style="padding:10px 0;border-top:1px solid #e3e9f1"><strong>${esc(new Date(x.changed_at).toLocaleString('en-IN'))}</strong><p>Changed by: ${esc(x.changed_by||'Unknown user')}</p><details><summary>View before and after values</summary><p><strong>Before</strong></p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(x.old_values,null,2))}</pre><p><strong>After</strong></p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(x.new_values,null,2))}</pre></details></article>`).join('');
}


// Employee performance module. Database security is enforced by the SQL RLS policies,
// not by these UI visibility checks alone.
let employeeRecords = [];
function canManageEmployees() { return ['admin','management','branch_manager'].includes(String(profile?.role||'').toLowerCase()); }
function employeeMessage(id,text,ok=false) { const el=$(id); if(el){el.textContent=text;el.style.color=ok?'#16764a':'#a21d37';} }
async function loadEmployeeModule() {
  if(!profile || !db) return;
  show('employeeSection', true);
  show('employeeAdminPanel', canManageEmployees());
  show('employeeTargetPanel', canManageEmployees());
  $('employeeBranch').innerHTML = branches.map(b => '<option value="' + b.id + '">' + esc(b.branch_name) + '</option>').join('');
  try {
    let query=db.from('employee_directory').select('id,employee_code,full_name,branch_id,designation,login_email,active,auth_user_id').order('full_name');
    // Branch staff are scoped by RLS; management/branch managers can see their authorized records.
    const {data,error}=await query;
    if(error) throw error;
    employeeRecords=data||[];
    const branchMap=new Map(branches.map(b=>[String(b.id),b]));
    $('employeeRows').innerHTML=employeeRecords.map(e=>`<tr><td>${esc(e.full_name)}</td><td>${esc(e.employee_code||'—')}</td><td>${esc(branchMap.get(String(e.branch_id))?.branch_name||'—')}</td><td>${esc(e.designation||'—')}</td><td><span class="pill">${e.active?'Active':'Inactive'}</span></td></tr>`).join('')||'<tr><td colspan="5">No employees yet. Management can add employees above.</td></tr>';
    $('activityEmployee').innerHTML=employeeRecords.filter(e=>e.active).map(e=>`<option value="${e.id}">${esc(e.full_name)} — ${esc(branchMap.get(String(e.branch_id))?.branch_name||'Branch')}</option>`).join('');
    $('targetEmployee').innerHTML=employeeRecords.filter(e=>e.active).map(e=>`<option value="${e.id}">${esc(e.full_name)} — ${esc(branchMap.get(String(e.branch_id))?.branch_name||'Branch')} (${esc(e.designation||'')})</option>`).join('');
    await loadEmployeeTargets();
    const active=employeeRecords.filter(e=>e.active).length;
    $('employeeSummary').innerHTML=`<article class="stat"><span>Employees visible</span><strong>${employeeRecords.length}</strong></article><article class="stat"><span>Active employees</span><strong>${active}</strong></article><article class="stat"><span>Branches represented</span><strong>${new Set(employeeRecords.map(e=>e.branch_id)).size}</strong></article>`;
    await loadEmployeeActivities();
  } catch(err) {
    $('employeeRows').innerHTML=`<tr><td colspan="5">Employee module not ready: ${esc(err.message||err)}</td></tr>`;
    $('activityRows').innerHTML='<tr><td colspan="9">Run employee_module_schema.sql in Supabase SQL Editor, then refresh.</td></tr>';
    employeeMessage('employeeMsg','Database setup required. Run employee_module_schema.sql in Supabase, then refresh.');
  }
}
async function addEmployee(e) {
  e.preventDefault();
  if(!canManageEmployees()){employeeMessage('employeeMsg','Only authorized management or branch managers can add employees.');return;}
  const payload={full_name:$('employeeName').value.trim(),employee_code:$('employeeCode').value.trim()||null,branch_id:Number($('employeeBranch').value),designation:$('employeeDesignation').value.trim(),login_email:$('employeeEmail').value.trim()||null,active:true,created_by:user.id};
  try { const {error}=await db.from('employee_directory').insert(payload); if(error) throw error; $('employeeForm').reset(); $('employeeBranch').value=String(profile.branch_id||branches[0]?.id||''); employeeMessage('employeeMsg','Employee added successfully.',true); await loadEmployeeModule(); }
  catch(err){employeeMessage('employeeMsg',err.message||'Could not add employee.');}
}
async function submitEmployeeActivity(e) {
  e.preventDefault();
  const employee=employeeRecords.find(x=>String(x.id)===$('activityEmployee').value);
  if(!employee){employeeMessage('activityMsg','Select an active employee first.');return;}
  const isOwn=employee.auth_user_id===user.id;
  const sameBranch=Number(employee.branch_id)===Number(profile.branch_id);
  if(!canManageEmployees() && !isOwn && !(String(profile.role).toLowerCase()==='branch_manager' && sameBranch)){employeeMessage('activityMsg','You are not permitted to submit activity for this employee.');return;}
  const payload={employee_id:employee.id,branch_id:employee.branch_id,activity_date:$('activityDate').value,sales_contribution:Number($('activitySales').value||0),patients_handled:Number($('activityPatients').value||0),doctor_calls:Number($('activityDoctorCalls').value||0),followups_completed:Number($('activityFollowups').value||0),home_collections:Number($('activityHomeCollections').value||0),tasks_completed:Number($('activityTasks').value||0),remarks:$('activityRemarks').value.trim()||null,submitted_by:user.id};
  try {const {error}=await db.from('employee_activity_reports').insert(payload);if(error)throw error;$('activityForm').reset();$('activityDate').value=today;employeeMessage('activityMsg','Activity report submitted.',true);await loadEmployeeActivities();}
  catch(err){employeeMessage('activityMsg',err.message||'Could not submit activity report.');}
}
async function loadEmployeeActivities() {
  try {
    const {data,error}=await db.from('employee_activity_reports').select('id,employee_id,activity_date,sales_contribution,patients_handled,doctor_calls,followups_completed,home_collections,tasks_completed,remarks').order('activity_date',{ascending:false}).limit(100);
    if(error) throw error;
    const map=new Map(employeeRecords.map(e=>[String(e.id),e]));
    $('activityRows').innerHTML=(data||[]).map(r=>`<tr><td>${esc(r.activity_date)}</td><td>${esc(map.get(String(r.employee_id))?.full_name||'Employee')}</td><td>${money(r.sales_contribution)}</td><td>${Number(r.patients_handled||0)}</td><td>${Number(r.doctor_calls||0)}</td><td>${Number(r.followups_completed||0)}</td><td>${Number(r.home_collections||0)}</td><td>${Number(r.tasks_completed||0)}</td><td>${esc(r.remarks||'—')}</td></tr>`).join('')||'<tr><td colspan="9">No activity reports submitted yet.</td></tr>';
  } catch(err) { $('activityRows').innerHTML=`<tr><td colspan="9">Activity reports unavailable: ${esc(err.message||err)}. Check that the employee schema was installed.</td></tr>`; }
}


async function loadEmployeeTargets() {
  const body=$('employeeTargetRows'); if(!body) return;
  try {
    const {data,error}=await db.from('employee_targets').select('id,employee_id,target_month,sales_target,doctor_calls_target,followups_target,home_collections_target,tasks_target').order('target_month',{ascending:false}).limit(300);
    if(error) throw error;
    const names=new Map(employeeRecords.map(e=>[String(e.id),e.full_name]));
    body.innerHTML=(data||[]).map(t=>`<tr><td>${esc(t.target_month)}</td><td>${esc(names.get(String(t.employee_id))||'Employee')}</td><td>${money(t.sales_target)}</td><td>${Number(t.doctor_calls_target||0)}</td><td>${Number(t.followups_target||0)}</td><td>${Number(t.home_collections_target||0)}</td><td>${Number(t.tasks_target||0)}</td></tr>`).join('')||'<tr><td colspan="7">No monthly targets saved yet.</td></tr>';
    await loadSelectedEmployeeTarget();
  } catch(err) { body.innerHTML=`<tr><td colspan="7">Could not load targets: ${esc(err.message||err)}</td></tr>`; }
}

async function loadSelectedEmployeeTarget() {
  if(!$('targetEmployee')?.value || !$('targetMonth')?.value) return;
  const month=$('targetMonth').value+'-01';
  try {
    const {data,error}=await db.from('employee_targets').select('sales_target,doctor_calls_target,followups_target,home_collections_target,tasks_target').eq('employee_id',Number($('targetEmployee').value)).eq('target_month',month).maybeSingle();
    if(error) throw error;
    $('targetSales').value=data?.sales_target??0; $('targetDoctorCalls').value=data?.doctor_calls_target??0; $('targetFollowups').value=data?.followups_target??0; $('targetHomeCollections').value=data?.home_collections_target??0; $('targetTasks').value=data?.tasks_target??0;
  } catch(err) { employeeMessage('employeeTargetMsg','Could not load existing target: '+(err.message||err)); }
}

async function saveEmployeeTarget(e) {
  e.preventDefault();
  if(!canManageEmployees()) { employeeMessage('employeeTargetMsg','Only authorised management or admin users can set targets.'); return; }
  const employeeId=Number($('targetEmployee').value); const month=$('targetMonth').value+'-01';
  if(!employeeId || !$('targetMonth').value) { employeeMessage('employeeTargetMsg','Select an employee and month.'); return; }
  const payload={employee_id:employeeId,target_month:month,sales_target:Number($('targetSales').value||0),doctor_calls_target:Number($('targetDoctorCalls').value||0),followups_target:Number($('targetFollowups').value||0),home_collections_target:Number($('targetHomeCollections').value||0),tasks_target:Number($('targetTasks').value||0),set_by:user.id};
  try {
    const {data:existing,error:findError}=await db.from('employee_targets').select('id').eq('employee_id',employeeId).eq('target_month',month).maybeSingle();
    if(findError) throw findError;
    const result=existing ? await db.from('employee_targets').update(payload).eq('id',existing.id) : await db.from('employee_targets').insert(payload);
    if(result.error) throw result.error;
    employeeMessage('employeeTargetMsg','Monthly target saved successfully.',true);
    await loadEmployeeTargets();
  } catch(err) { employeeMessage('employeeTargetMsg',err.message||'Could not save target. Check target-table permissions and RLS policies.'); }
}
