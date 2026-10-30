import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const $ = id => document.getElementById(id);
const names = ["Complete HC 599","My Health 999","Cardiac HC","EHC 2500","EHC Advanced 3500","Healthy Women 699","Healthy Men","EHC PRO 8499","Hairfall","Vitamin Profile","PCOD Mini","Onam Camp","Other Packages"];
let db, user, profile, branches = [], reports = [], targets = [];
const now = new Date();
const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0,10);
$('date').value = today;
$('branchTargetMonth').value = today.slice(0,7);
$('packages').innerHTML = names.map((n,i) => `<div class="pkg"><label for="p${i}">${n}</label><input id="p${i}" type="number" min="0" step="1" value="0"></div>`).join('');
const ready = SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('PASTE_') && SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_') && !SUPABASE_PUBLISHABLE_KEY.includes('PASTE_');
function msg(id, s, ok=false) { $(id).textContent = s; $(id).style.color = ok ? '#16764a' : '#a21d37'; }
function show(id, v) { $(id).classList.toggle('hidden', !v); }
function money(n) { return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(n||0)); }
function esc(s) { return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function monthStart(dateString=today) { return `${dateString.slice(0,7)}-01`; }
function daysLeftInclusive(dateString=today) { const [y,m,d] = dateString.split('-').map(Number); return Math.max(1, new Date(y,m,0).getDate() - d); }
function workingDaysRemaining(dateString=today) { return daysLeftInclusive(dateString); }
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
  $('refresh').onclick = () => load(user);
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
  $('branchTargetNetwork').addEventListener('change', renderBranchTargetEditorRows);
  $('saveBranchTargets').onclick = saveBranchTargets;
  $('portalUserForm').onsubmit = createPortalUser;
  $('portalRole').addEventListener('change', updatePortalBranchVisibility);
```javascript
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
```
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
  profile=p;
  const {data:b,error:be} = await db.from('branches').select('id,branch_name,network,active').eq('active',true).order('branch_name');
  if(be) { msg('loginMsg',be.message); return; }
  branches=b||[];
  $('who').textContent=p.full_name+' · '+p.role;
  if (p.role === 'admin') {
    $('portalBranch').innerHTML = branches.map(b=>`<option value="${b.id}">${esc(b.network)} — ${esc(b.branch_name)}</option>`).join('');
    updatePortalBranchVisibility();
  }
  show('login',false); show('app',true); show('userTools',true); show('entry',p.role==='branch_staff');
  show('managementReportSection',p.role!=='branch_staff');
  show('complianceSection',p.role!=='branch_staff');
  // User & Branch Access Management is visible only to the Super Admin.
  show('userAccessSection',p.role==='admin');
  show('branchTargetAdminSection',p.role==='admin');
  if(p.role==='admin') await loadBranchTargetEditor();
  $('title').textContent=p.role==='branch_staff'?`${branches.find(x=>x.id===p.branch_id)?.branch_name||'Branch'} daily entry`:'Management consolidated report';
  $('subtitle').textContent=p.role==='branch_staff'?'Submit sales for your assigned branch':'Targets and sales totals from reports permitted for your account';
  await loadReports();
  if (p.role === 'admin') await loadPortalUsers();
  await loadEmployeeModule();
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
    headers: { Authorization: `Bearer ${token}` }
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
    msg('portalUserMsg',`Account created for ${result.user?.email || payload.email}.`,true);
    await loadPortalUsers();
  } catch (err) {
    msg('portalUserMsg',err.message || 'Could not create account.');
  }
}

async function setPortalUserActive(userId, active) {
  if (profile?.role !== 'admin') return;
  if (!confirm(`${active ? 'Reactivate' : 'Deactivate'} this portal account?`)) return;
  try {
    await callAdminUserFunction({action:'set_active', user_id:userId, active});
    await loadPortalUsers();
    msg('portalUserMsg',`Account ${active ? 'reactivated' : 'deactivated'}.`,true);
  } catch (err) {
    msg('portalUserMsg',err.message || 'Could not update account.');
  }
}

async function loadPortalUsers() {
  if (profile?.role !== 'admin') return;
  $('portalUserRows').innerHTML='<tr><td colspan="6">Loading users…</td></tr>';
  try {
    const result = await callAdminUserFunction({action:'list'});
    const rows = result.users || [];
    $('portalUserRows').innerHTML = rows.map(u => {
      const branch = u.branch_name ? `${u.network} — ${u.branch_name}` : 'All permitted branches';
      const action = u.role === 'admin' ? '<span class="pill">Protected admin</span>' :
        (u.active
          ? `<button type="button" class="secondary" data-user-id="${esc(u.user_id)}" data-active="false">Deactivate</button>`
          : `<button type="button" data-user-id="${esc(u.user_id)}" data-active="true">Reactivate</button>`);
      return `<tr><td>${esc(u.full_name)}</td><td>${esc(u.email || '—')}</td><td>${esc(u.role)}</td><td>${esc(branch)}</td><td><span class="pill">${u.active?'Active':'Inactive'}</span></td><td>${action}</td></tr>`;
    }).join('') || '<tr><td colspan="6">No portal users found.</td></tr>';
    $('portalUserRows').querySelectorAll('button[data-user-id]').forEach(btn => {
      btn.addEventListener('click', () => setPortalUserActive(btn.dataset.userId, btn.dataset.active === 'true'));
    });
  } catch (err) {
    $('portalUserRows').innerHTML=`<tr><td colspan="6">${esc(err.message || 'Could not load users.')}</td></tr>`;
  }
}

// Load all reports for the current month in pages, so MTD calculations do not depend on the recent-report limit.
async function loadAllCurrentMonthReports() {
  const start=monthStart();
  const [year,month]=start.split('-').map(Number);
  const nextMonth = month===12 ? `${year+1}-01-01` : `${year}-${String(month+1).padStart(2,'0')}-01`;
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
  if(error) { $('rows').innerHTML=`<tr><td colspan="7">${esc(error.message)}</td></tr>`; return; }
  reports=recent||[];
  let monthReports;
  try { monthReports=await loadAllCurrentMonthReports(); }
  catch(err) { $('targetMsg').textContent='Could not load complete month-to-date reports: '+(err.message||err); monthReports=reports.filter(r=>r.report_date?.startsWith(today.slice(0,7))); }
  const bm=new Map(branches.map(b=>[b.id,b]));
  const monthSales=monthReports.reduce((s,r)=>s+Number(r.total_sales||0),0);
  const patients=monthReports.reduce((s,r)=>s+Number(r.patient_count||0),0);
  const ds=monthReports.filter(r=>r.report_date===today).reduce((s,r)=>s+Number(r.total_sales||0),0);
  $('stats').innerHTML=[['Today sales',money(ds),'Visible to this account'],['MTD sales',money(monthSales),'Current month'],['MTD patients',patients.toLocaleString('en-IN'),'Current month'],['Average bill',money(patients?monthSales/patients:0),'MTD sales / patients']].map(x=>`<div class="stat"><label>${x[0]}</label><strong>${x[1]}</strong><small>${x[2]}</small></div>`).join('');
  $('rows').innerHTML=reports.slice(0,100).map(r=>{const b=bm.get(r.branch_id)||{};return `<tr><td>${esc(r.report_date)}</td><td>${esc(b.branch_name||'Branch')}</td><td>${esc(b.network||'')}</td><td><b>${money(r.total_sales)}</b></td><td>${Number(r.patient_count||0)}</td><td>${money(r.patient_count?Number(r.total_sales)/Number(r.patient_count):0)}</td><td><span class="pill">${esc(r.status)}</span></td></tr>`;}).join('')||'<tr><td colspan="7">No reports submitted yet.</td></tr>';
  $('reportMsg').textContent=profile.role==='branch_staff'?'Only permitted reports are displayed.':'Showing up to 100 recent reports from the latest 500 loaded rows. MTD summary uses paginated current-month records.';
  await renderTargets(monthReports);
  await renderCompliance(reports);
  renderDailyTrend(monthReports);
  const ids=reports.slice(0,100).map(r=>r.id);
  if(!ids.length) { $('packageSummary').textContent='No package data yet.'; return; }
  const {data:ps,error:pe}=await db.from('package_sales').select('package_name,quantity').in('report_id',ids);
  if(pe) { $('packageSummary').textContent='Package summary unavailable: '+pe.message; return; }
  const totals={}; (ps||[]).forEach(x=>totals[x.package_name]=(totals[x.package_name]||0)+Number(x.quantity||0));
  $('packageSummary').innerHTML=Object.entries(totals).filter(x=>x[1]>0).map(x=>`<span class="pill">${esc(x[0])}: ${x[1]}</span> `).join('')||'No package counts recorded.';
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
    rowsEl.innerHTML = `<tr><td colspan="5">${esc(error.message)}</td></tr>`;
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

  rowsEl.innerHTML = branchRows.map(r => `
    <tr>
      <td>${esc(r.branch.branch_name)}</td>
      <td>${esc(r.branch.network || '')}</td>
      <td><strong>${money(r.sales)}</strong></td>
      <td>${r.patients.toLocaleString('en-IN')}</td>
      <td>${money(r.average)}</td>
    </tr>
  `).join('');

  summaryEl.innerHTML = [
    ['Total daily sales', money(totals.sales)],
    ['Total patients', totals.patients.toLocaleString('en-IN')],
    ['Branches reporting', `${branchRows.filter(r => r.submitted).length}/${visibleBranches.length}`]
  ].map(item => `
    <div class="stat">
      <label>${esc(item[0])}</label>
      <strong>${esc(item[1])}</strong>
    </div>
  `).join('');

  msgEl.textContent = `Daily sales for ${date}. Branches without a report are shown as zero; please verify missing submissions.`;
}


async function renderCompliance(fallbackReports=[]) {
  if (!profile || profile.role==='branch_staff' || !db) return;
  const date=$('complianceDate')?.value || today;
  $('complianceRows').innerHTML='<tr><td colspan="7">Checking submitted reports…</td></tr>';
  const {data,error}=await db.from('daily_reports').select('id,branch_id,report_date,total_sales,patient_count,status').eq('report_date',date);
  if(error) {
    $('complianceRows').innerHTML=`<tr><td colspan="7">${esc(error.message)}</td></tr>`;
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
  $('complianceSummary').innerHTML=`<div class="alert-chip alert-green">🟢 Submitted: ${submitted}/${rows.length}</div><div class="alert-chip alert-red">🔴 Missing: ${missing}</div><div class="alert-chip alert-yellow">🟡 Needs review: ${review}</div>`;
  $('complianceRows').innerHTML=rows.map(r=>`<tr><td>${esc(r.branch_name)}</td><td>${esc(r.network)}</td><td><span class="alert-chip ${r.cls}">${esc(r.status)}</span></td><td>${r.matches}</td><td>${money(r.sales)}</td><td>${r.patients.toLocaleString('en-IN')}</td><td>${esc(r.action)}</td></tr>`).join('')||'<tr><td colspan="7">No active branches found.</td></tr>';
  $('complianceMsg').textContent=`Date: ${date}. Found ${dayReports.length} report record(s) across ${rows.length} active branches. A branch is marked Submitted only if at least one visible record has status “submitted”. Multiple reports are flagged for review, not automatically treated as invalid.`;
  window.__complianceReportText=`DAILY REPORTING COMPLIANCE — ${date}\nSubmitted: ${submitted}/${rows.length} | Missing: ${missing} | Needs review: ${review}\n\n`+rows.map(r=>`${r.status==='Submitted'?'✓':r.status==='Missing'?'!':'?'} ${r.branch_name} (${r.network}) — ${r.status}; reports ${r.matches}; sales ${money(r.sales)}; patients ${r.patients}. ${r.action}`).join('\n');
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
    $('branchTargetAdminRows').innerHTML = `<tr><td colspan="3">${esc(err.message||'Could not load targets')}</td></tr>`;
    msg('branchTargetAdminMsg', err.message || 'Could not load targets.');
  }
}
function renderBranchTargetEditorRows() {
  if (profile?.role !== 'admin') return;
  const network = $('branchTargetNetwork').value;
  const vals = window.__branchTargetEditorValues || new Map();
  const list = branches.filter(b => network === 'ALL' || b.network === network).sort((a,b)=>String(a.network).localeCompare(String(b.network))||String(a.branch_name).localeCompare(String(b.branch_name)));
  $('branchTargetAdminRows').innerHTML = list.map(b => `<tr><td>${esc(b.network)}</td><td>${esc(b.branch_name)}</td><td><input class="branch-target-value" data-branch-id="${esc(b.id)}" type="number" min="0" step="1" value="${Number(vals.get(String(b.id))||0)}" aria-label="${esc(b.branch_name)} monthly target"></td></tr>`).join('');
  updateBranchTargetTotal();
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
  if(error) {
    if(isStaff) { ['branchMonthlyTarget','branchMtdSales','branchBalanceTarget','branchRequiredDaily'].forEach(id=>$(id).textContent='—'); $('branchDailyTargetNote').textContent='Could not load target: '+error.message; }
    else { $('targetRows').innerHTML=`<tr><td colspan="10">${esc(error.message)}</td></tr>`; $('targetMeta').textContent='Could not load monthly targets.'; }
    return;
  }
  targets=targetData||[];
  const salesByBranch=new Map(),patientsByBranch=new Map();
  monthReports.forEach(r=>{salesByBranch.set(r.branch_id,(salesByBranch.get(r.branch_id)||0)+Number(r.total_sales||0));patientsByBranch.set(r.branch_id,(patientsByBranch.get(r.branch_id)||0)+Number(r.patient_count||0));});
  if(isStaff) {
    const own=targets.find(t=>String(t.branch_id)===String(profile.branch_id));
    const target=Number(own?.target_amount||0), sales=Number(salesByBranch.get(profile.branch_id)||0), balance=Math.max(target-sales,0), days=workingDaysRemaining();
    $('branchMonthlyTarget').textContent=own?money(target):'Not set'; $('branchMtdSales').textContent=money(sales); $('branchBalanceTarget').textContent=own?money(balance):'—'; $('branchRequiredDaily').textContent=own?money(balance/days):'—';
    $('branchDailyTargetDate').textContent=`${targetMonth.slice(0,7)} · ${days} calendar day(s) remaining, Sundays included`;
    $('branchDailyTargetNote').textContent=!own?'Your monthly target has not been set. Please contact management.':balance===0?'Monthly target achieved. Maintain your sales performance.':`To reach your target, aim for ${money(balance/days)} per calendar day for the remaining ${days} calendar day(s).`;
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
  $('unomedExecSales').textContent=money(un.sales); $('unomedExecMeta').textContent=`${money(un.target)} target · ${un.target?fmtPct(un.sales/un.target*100):'0.0%'} achieved · ${money(Math.max(un.target-un.sales,0))} remaining · ${money(Math.max(un.target-un.sales,0)/workingDaysRemaining())}/calendar day`;
  $('neethiExecSales').textContent=money(ne.sales); $('neethiExecMeta').textContent=`${money(ne.target)} target · ${ne.target?fmtPct(ne.sales/ne.target*100):'0.0%'} achieved · ${money(Math.max(ne.target-ne.sales,0))} remaining · ${money(Math.max(ne.target-ne.sales,0)/workingDaysRemaining())}/calendar day`;
  $('unomedExecBar').style.width=Math.min(100,un.target?un.sales/un.target*100:0)+'%';
  $('neethiExecBar').style.width=Math.min(100,ne.target?ne.sales/ne.target*100:0)+'%';
  const alertCounts={green:rows.filter(r=>r.alertClass==='alert-green').length,yellow:rows.filter(r=>r.alertClass==='alert-yellow').length,red:rows.filter(r=>r.alertClass==='alert-red').length,none:rows.filter(r=>r.alertClass==='alert-none').length};
  $('targetMeta').textContent=`${targetMonth.slice(0,7)} · ${rows.filter(r=>!r.missing).length}/${branches.length} branch targets loaded · Pace is measured against calendar days elapsed (${elapsedDays}/${daysInMonth}).`;
  $('alertSummary').innerHTML=`<div class="alert-chip alert-green">🟢 On track / achieved: ${alertCounts.green}</div><div class="alert-chip alert-yellow">🟡 Needs attention: ${alertCounts.yellow}</div><div class="alert-chip alert-red">🔴 Critical: ${alertCounts.red}</div><div class="alert-chip alert-none">⚪ Missing target: ${alertCounts.none}</div>`;
$('targetRows').innerHTML=rows.map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.branch_name)}${r.missing?' <span class="pill">Target missing</span>':''}</td><td>${esc(r.network)}</td><td><strong>${money(r.sales)}</strong></td><td>${r.patients}</td><td>${money(r.target)}</td><td>${fmtPct(r.achievement)}</td><td>${money(r.balance)}</td><td>${money(r.required)}</td><td><span class="pill ${r.alertClass}">${esc(r.alert)}</span><div>${esc(r.advice)}</div></td></tr>`).join('');
  const summary=totalsByNetwork.map(n=>`${n.network}: sales ${money(n.sales)} / target ${money(n.target)} (${n.target?fmtPct(n.sales/n.target*100):'0.0%'} achievement)${n.missing?`; ${n.missing} target(s) missing`:''}`).join(' · ');
  $('targetMsg').textContent=`${summary} · GROUP: ${money(groupSales)} / ${money(groupTarget)} (${groupTarget?fmtPct(groupSales/groupTarget*100):'0.0%'} achievement), balance ${money(Math.max(groupTarget-groupSales,0))}, required/day ${money(Math.max(groupTarget-groupSales,0)/workingDaysRemaining())}. MTD patients: ${groupPatients.toLocaleString('en-IN')}.`;
}

function renderDailyTrend(monthReports) {
  const byDate=new Map();
  monthReports.forEach(r=>{const d=r.report_date; if(!d)return; byDate.set(d,(byDate.get(d)||0)+Number(r.total_sales||0));});
  const dates=[...byDate.keys()].sort();
  if(!dates.length){$('dailyTrend').innerHTML='<p>No sales reports available for this month yet.</p>';return;}
  const max=Math.max(...dates.map(d=>byDate.get(d)),1);
  $('dailyTrend').innerHTML=dates.map(d=>{const v=byDate.get(d),height=Math.max(2,v/max*100);return `<div class="trend-day" title="${esc(d)} · ${money(v)}"><small>${esc(d.slice(-2))}</small><div class="trend-bar-wrap"><div class="trend-bar" style="height:${height}%"></div></div><span class="trend-value">${money(v)}</span></div>`;}).join('');
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
  const pct=n=>`${n.toFixed(1)}%`;
  const lines=[`📊 UNOMED + NEETHI — MANAGEMENT REPORT`,`📅 As on ${dateLabel}`,``,`🏢 GROUP PERFORMANCE`,`Sales: ${money(groupSales)} / ${money(groupTarget)}`,`Achievement: ${pct(groupTarget?groupSales/groupTarget*100:0)}`,`Balance to target: ${money(groupBalance)}`,`Patients MTD: ${Number(data.groupPatients||0).toLocaleString('en-IN')}`,`Today sales: ${money(dailyToday)}${dailyPrev?` | Previous day: ${money(dailyPrev)}`:''}`,``,`🔵 UNOMED`,`Sales: ${money(un.sales)} | Target: ${money(un.target)} | Achievement: ${pct(un.pct)} | Balance: ${money(un.balance)}`,``,`🔴 NEETHI`,`Sales: ${money(ne.sales)} | Target: ${money(ne.target)} | Achievement: ${pct(ne.pct)} | Balance: ${money(ne.balance)}`,``,`🏆 BRANCH RANKING — ACHIEVEMENT`];
  rows.forEach((r,i)=>lines.push(`${i+1}. ${r.branch_name} (${r.network}) — ${money(r.sales)} / ${r.target?money(r.target):'Target not set'} — ${r.target?pct(r.achievement):'N/A'} — ${r.alert}`));
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
  const blob=new Blob([textValue+'\n'],{type:'text/plain;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`unomed-neethi-management-report-${today}.txt`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); $('managementReportMsg').textContent='Text report downloaded.'; $('managementReportMsg').style.color='#16764a';
}

async function submit(e) {
  e.preventDefault();
  if(profile.role!=='branch_staff') { msg('salesMsg','Only branch staff can submit.'); return; }
  const branch=branches.find(b=>b.id===profile.branch_id);
  if(!branch) { msg('salesMsg','No valid active branch assigned.'); return; }
  const btn=$('salesForm').querySelector('button'); btn.disabled=true; msg('salesMsg','Submitting…');
  try {
    const {data:r,error}=await db.from('daily_reports').insert({branch_id:branch.id,report_date:$('date').value,total_sales:Number($('sales').value),patient_count:Number($('patients').value),home_collections:Number($('home').value||0),google_reviews:Number($('reviews').value||0),submitted_by:user.id,status:'submitted'}).select('id').single();
    if(error) throw error;
    const rows=names.map((name,i)=>({report_id:r.id,package_name:name,quantity:Number($('p'+i).value||0)})).filter(x=>x.quantity>0);
    if(rows.length) { const {error:pe}=await db.from('package_sales').insert(rows); if(pe) throw new Error('Report saved but package counts failed. Check the database before retrying: '+pe.message); }
    msg('salesMsg','Report submitted.',true); $('salesForm').reset(); $('date').value=today; names.forEach((_,i)=>$('p'+i).value=0); await loadReports();
  } catch(err) { msg('salesMsg',err.message||'Submission failed'); }
  finally { btn.disabled=false; }
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
  $('employeeBranch').innerHTML = branches.map(b=>`<option value="${b.id}">${esc(b.branch_name)} — ${esc(b.network)}</option>`).join('');
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
