import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const $ = id => document.getElementById(id);
// Capture the review action at document level so it still works if later
// dashboard initialization replaces or re-renders parts of the sales form.
function handleSalesReview(event) {
  event?.preventDefault?.();
  try {
    openSalesConfirmation(event);
  } catch (error) {
    const status = $('salesMsg');
    if (status) {
      status.textContent = error?.message || 'Could not open the report review. Please refresh and try again.';
      status.style.color = '#a21d37';
    }
    console.error('Daily sales review error:', error);
  }
}
// The module is loaded at the end of index.html, so bind directly to the real button.
// Keep form-submit handling as a separate keyboard/Enter fallback.
// Capture the review click at document level. This survives re-rendering and
// prevents another handler from swallowing the action before the modal opens.
document.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target.closest('#reviewSalesSubmit') : null;
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  handleSalesReview(event);
}, true);
$('salesForm')?.addEventListener('submit', handleSalesReview);
const salesModalElement = $('salesConfirmModal');
if (salesModalElement && salesModalElement.parentElement !== document.body) document.body.appendChild(salesModalElement);
if (salesModalElement) { salesModalElement.classList.add('hidden'); salesModalElement.setAttribute('aria-hidden','true'); }

const names = ["Complete HC 599","My Health 999","Cardiac HC","EHC 2500","EHC Advanced 3500","Healthy Women 699","Healthy Men","EHC PRO 8499","Hairfall","Vitamin Profile","PCOD Mini","Onam Camp","Other Packages"];
let db, user, profile, branches = [], reports = [], targets = [];
let complianceRowsCache = [], complianceNetworkFilter = 'ALL', complianceChecked = false;
let employeeTaskAlerts = [];
let editingReportId = null;
let overviewReports = [];
let overviewPeriod = '7';
let overviewNetwork = 'ALL';
const now = new Date();
const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0,10);
$('date').value = today;
$('branchTargetMonth').value = today.slice(0,7);
if ($('performanceMonth')) $('performanceMonth').value = today.slice(0,7);
function portalNavigate(targetId) {
  const button=document.querySelector(`.nav-button[data-target="${CSS.escape(targetId)}"]`);
  if(!button || button.classList.contains('hidden') || button.classList.contains('nav-hidden')) return false;
  setPortalView(targetId);
  return true;
}
function renderPortalSearch(query='') {
  const box=$('portalSearchResults');
  if(!box) return;
  const q=String(query||'').trim().toLowerCase();
  if(!q){box.classList.add('hidden');box.innerHTML='';return;}
  const matches=[...document.querySelectorAll('.nav-button[data-target]')]
    .filter(b=>!b.classList.contains('hidden')&&!b.classList.contains('nav-hidden'))
    .map(b=>({id:b.dataset.target,label:b.textContent.trim(),button:b}))
    .filter(x=>x.label.toLowerCase().includes(q));
  box.innerHTML=matches.length?matches.map(x=>`<button type="button" class="portal-search-result" role="option" data-search-target="${esc(x.id)}"><span>${esc(x.label)}</span><small>Open module ↗</small></button>`).join(''):'<p class="portal-empty-note">No matching modules. Try another keyword.</p>';
  box.classList.remove('hidden');
}
function renderPortalNotifications() {
  const list=$('portalNotificationsList'),badge=$('portalNotificationBadge');
  if(!list||!badge) return;
  const isManagement=profile&&profile.role!=='branch_staff';
  const alerts=isManagement?complianceRowsCache.filter(r=>r.status==='Missing'||r.status==='Needs review'):[];
  const taskAlerts=employeeTaskAlerts||[];
  const total=alerts.length+taskAlerts.length;
  badge.textContent=String(total);badge.classList.toggle('hidden',total===0);
  const branchHtml=alerts.slice(0,12).map(r=>`<button type="button" class="portal-notification-item" data-notification-target="complianceSection"><span class="portal-notification-dot ${r.status==='Missing'?'is-missing':'is-review'}"></span><span><strong>${esc(r.branch_name||'Branch')}</strong><small>${esc(r.network||'')} · ${esc(r.status)} · ${esc(r.action||'Follow up required')}</small></span><b>›</b></button>`).join('');
  const taskHtml=taskAlerts.slice(0,12).map(t=>`<button type="button" class="portal-notification-item" data-notification-target="employeeSection"><span class="portal-notification-dot is-missing"></span><span><strong>${esc(t.title)}</strong><small>${esc(t.employee_name||'Employee')} · ${t.due_date<today?'Overdue':'Due today'}</small></span><b>›</b></button>`).join('');
  if(!total){list.innerHTML=complianceChecked?'<div class="portal-notification-empty"><strong>All clear</strong><p>No branch follow-ups or overdue employee tasks are currently visible.</p></div>':'<div class="portal-notification-empty"><strong>No current alerts</strong><p>Alerts appear when compliance checks or employee task deadlines identify follow-ups.</p></div>';return;}
  list.innerHTML=(alerts.length?`<div class="portal-notification-summary">${alerts.length} branch compliance follow-up${alerts.length===1?'':'s'}</div>${branchHtml}`:'')+(taskAlerts.length?`<div class="portal-notification-summary">${taskAlerts.length} employee task deadline${taskAlerts.length===1?'':'s'}</div>${taskHtml}`:'');
}
function initPortalCommandBar(){
  $('portalGlobalSearch')?.addEventListener('input',e=>renderPortalSearch(e.target.value));
  $('portalGlobalSearch')?.addEventListener('keydown',e=>{
    if(e.key==='Escape'){$('portalSearchResults')?.classList.add('hidden');e.target.blur();}
    if(e.key==='Enter'){const first=$('portalSearchResults')?.querySelector('[data-search-target]');if(first){portalNavigate(first.dataset.searchTarget);$('portalSearchResults').classList.add('hidden');e.target.value='';}}
  });
  $('portalSearchResults')?.addEventListener('click',e=>{const b=e.target.closest('[data-search-target]');if(!b)return;portalNavigate(b.dataset.searchTarget);$('portalSearchResults').classList.add('hidden');$('portalGlobalSearch').value='';});
  $('portalNotificationsBtn')?.addEventListener('click',()=>{$('portalNotificationsPanel')?.classList.toggle('hidden');renderPortalNotifications();});
  $('portalNotificationsClose')?.addEventListener('click',()=>$('portalNotificationsPanel')?.classList.add('hidden'));
  $('portalNotificationsList')?.addEventListener('click',e=>{const b=e.target.closest('[data-notification-target]');if(b){portalNavigate(b.dataset.notificationTarget);$('portalNotificationsPanel').classList.add('hidden');}});
  $('portalQuickLinks')?.addEventListener('click',e=>{const b=e.target.closest('[data-quick-target]');if(!b)return;portalNavigate(b.dataset.quickTarget);});
  document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&!e.ctrlKey&&!e.metaKey){e.preventDefault();$('portalGlobalSearch')?.focus();}});
}

function setPortalView(targetId) {
  const layout = document.querySelector('.app-layout');
  const content = document.querySelector('.app-content');
  if (!layout || !content) return;
  const overviewIds = new Set(['overviewTop']);
  const overviewSupport = new Set(['overviewTop']);
  const isOverview = overviewIds.has(targetId);
  const overviewElements = [
    $('portalCommandBar'),
    $('portalQuickLinks'),
    $('overviewTop'),
    content.querySelector('.heading'),
    content.querySelector('.heading + div'),
    $('overviewDashboard'),
    $('stats'),
    $('executiveSection')
  ].filter(Boolean);
  [...content.children].forEach(node => {
    const alwaysVisible = node.id === 'portalCommandBar' || node.id === 'portalQuickLinks';
    const keep = alwaysVisible || (isOverview ? overviewElements.includes(node) : node.id === targetId);
    node.classList.toggle('portal-view-hidden', !keep);
  });
  document.querySelectorAll('.nav-button[data-target]').forEach(button => {
    button.classList.toggle('active', button.dataset.target === targetId);
  });
  layout.dataset.activeView = targetId;
  content.scrollTop = 0;
  if (window.matchMedia('(max-width: 760px)').matches) layout.classList.remove('sidebar-open');
}
document.querySelectorAll('.nav-button[data-target]').forEach(button => {
  button.addEventListener('click', () => {
    const target = $(button.dataset.target);
    if (!target || button.classList.contains('nav-hidden')) return;
    setPortalView(button.dataset.target);
  });
});
$('sidebarToggle')?.addEventListener('click', () => {
  const layout = document.querySelector('.app-layout');
  if (window.matchMedia('(max-width: 760px)').matches) {
    layout.classList.toggle('sidebar-open');
  } else {
    layout.classList.toggle('sidebar-collapsed');
  }
});
initPortalCommandBar();
// Compact package selector. Hidden per-package inputs preserve the existing database write format.
$('packageSelect').innerHTML = '<option value="">Choose a package</option>' + names.map((n,i) => `<option value="${i}">${esc(n)}</option>`).join('');
$('packages').innerHTML = names.map((n,i) => `<input type="hidden" id="p${i}" value="0">`).join('') + '<p class="package-empty">No packages added yet. You can submit without package sales.</p>';
function renderSelectedPackages() {
  const selected = names.map((name,i)=>({name,qty:Number($('p'+i).value||0),i})).filter(x=>x.qty>0);
  $('packages').innerHTML = names.map((n,i)=>`<input type="hidden" id="p${i}" value="${Number($('p'+i)?.value||0)}">`).join('') + (selected.length ? selected.map(x=>`<div class="selected-package-row"><span>${esc(x.name)}</span><strong>Qty: ${x.qty}</strong><button type="button" class="remove-package" data-index="${x.i}" aria-label="Remove ${esc(x.name)}">Remove</button></div>`).join('') : '<p class="package-empty">No packages added yet. You can submit without package sales.</p>');
  $('packageCountBadge').textContent = `${selected.length} package${selected.length===1?'':'s'} added`;
}
function addSelectedPackage() {
  const index = $('packageSelect').value;
  const qty = Number($('packageQuantity').value);
  if(index==='') { msg('salesMsg','Please select a package first.'); return; }
  if(!Number.isInteger(qty) || qty<1) { msg('salesMsg','Enter a valid package quantity.'); return; }
  const field=$('p'+Number(index)); field.value=String(Number(field.value||0)+qty);
  $('packageSelect').value=''; $('packageQuantity').value='1'; msg('salesMsg','Package added.',true); renderSelectedPackages();
}
$('addPackage').addEventListener('click',addSelectedPackage);
$('packages').addEventListener('click',e=>{const b=e.target.closest('.remove-package');if(!b)return;$('p'+Number(b.dataset.index)).value='0';renderSelectedPackages();});
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
  $('applyPerformanceMonth').onclick = async () => { if(user){ await loadReports(); if(profile.role!=='branch_staff'){ await loadBranchAnalytics(); await loadTargetDashboard(); await loadManagementExecutiveDashboard(); } } };
  $('performanceMonth').addEventListener('change', () => { if(user) $('applyPerformanceMonth').click(); });
  $('overviewRefresh').onclick = () => { if (user) loadReports(); };
  $('overviewDashboard').addEventListener('click', event => {
    const period=event.target.closest('[data-overview-period]');
    const network=event.target.closest('[data-overview-network]');
    const action=event.target.closest('[data-overview-target]');
    if(period){overviewPeriod=period.dataset.overviewPeriod;$('overviewDashboard').querySelectorAll('[data-overview-period]').forEach(b=>b.classList.toggle('active',b===period));renderOverview();}
    if(network){overviewNetwork=network.dataset.overviewNetwork;$('overviewDashboard').querySelectorAll('[data-overview-network]').forEach(b=>b.classList.toggle('active',b===network));renderOverview();}
    if(action){const target=$(action.dataset.overviewTarget);if(target&&!target.classList.contains('hidden')){target.scrollIntoView({behavior:'smooth',block:'start'});}}
  });
  $('financialUploadBtn').onclick = uploadFinancialPdf;
  $('financialAnalysisRefresh').onclick = loadFinancialManagementAnalysis;
  $('financialAnalysisFrom').onchange = loadFinancialManagementAnalysis;
  $('financialAnalysisTo').onchange = loadFinancialManagementAnalysis;
  $('financialAnalysisNetwork').onchange = () => { $('financialAnalysisBranch').value='ALL'; loadFinancialManagementAnalysis(); };
  $('financialAnalysisBranch').onchange = renderFinancialManagementAnalysis;
  $('financialPlannedDistribution').oninput = renderFinancialManagementAnalysis;
  $('financialAnalysisCsv').onclick = exportFinancialAnalysisCsv;
  $('financialAnalysisPrint').onclick = () => window.print();
  $('financialRefresh').onclick = loadFinancialReports;
  $('financialStatusFilter').onchange = loadFinancialReports;
  $('financialCloseReview').onclick = () => $('financialReviewPanel').classList.add('hidden');
  $('financialSaveMapping').onclick = saveFinancialMappings;
  $('financialApprove').onclick = approveFinancialReport;
  $('financialReportRows').addEventListener('click', event => { const b=event.target.closest('[data-financial-review]'); if(b) openFinancialReview(b.dataset.financialReview); });
  $('financialLineRows').addEventListener('change', event => { const el=event.target; if(el.matches('[data-financial-category],[data-financial-behaviour],[data-financial-variable-share]')) updateFinancialLinePreview(); });
  // Review button and Enter-key handlers are attached before auth initialization.
  $('salesConfirmModal').setAttribute('aria-hidden','true');
  $('closeSalesConfirm').onclick = closeSalesConfirmation;
  $('editSalesReport').onclick = closeSalesConfirmation;
  $('confirmSalesSubmit').onclick = () => submitConfirmedSales();
  $('cancelCorrection').onclick = () => cancelReportCorrection();
  $('generateReport').onclick = generateManagementReport;
  $('copyReport').onclick = copyManagementReport;
  $('downloadReport').onclick = downloadManagementReport;
  $('complianceDate').value = today;
  $('complianceDate').addEventListener('change', () => renderCompliance(reports));
  $('copyCompliance').onclick = copyComplianceSummary;
  $('complianceSearch').addEventListener('input', renderComplianceTable);
  $('complianceSection').addEventListener('click', event => {
    const filter=event.target.closest('[data-compliance-network]');
    if(!filter) return;
    complianceNetworkFilter=filter.dataset.complianceNetwork;
    $('complianceSection').querySelectorAll('[data-compliance-network]').forEach(btn=>btn.classList.toggle('active',btn===filter));
    renderComplianceTable();
  });
  $('employeeRefresh').onclick = loadEmployeeModule;
  // Employee task controls are not rendered in every role-specific portal view.
  // Bind only when the corresponding element exists so one missing task control
  // cannot abort initialization of daily sales and other modules.
  if ($('employeeTasksRefresh')) $('employeeTasksRefresh').onclick = loadEmployeeTasks;
  if ($('employeeTaskForm')) $('employeeTaskForm').onsubmit = createEmployeeTask;
  if ($('taskStatusFilter')) $('taskStatusFilter').addEventListener('change', loadEmployeeTasks);
  if ($('employeeTaskRows')) $('employeeTaskRows').addEventListener('click', handleEmployeeTaskAction);
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
  const cancelCorrectionButton = $('cancelCorrection');
  if (cancelCorrectionButton) cancelCorrectionButton.onclick = cancelReportCorrection;
  $('analyticsRefresh').onclick = loadBranchAnalytics;
  $('targetDashboardMonth').value = today.slice(0,7);
  $('targetDashboardRefresh').onclick = loadTargetDashboard;
  $('targetDashboardMonth').addEventListener('change', loadTargetDashboard);
  $('targetDashboardNetwork').addEventListener('change', renderTargetDashboard);
  $('monthlyTargetNetwork').addEventListener('change', renderMonthlyTargetRows);
  $('monthlyTargetSort').addEventListener('change', renderMonthlyTargetRows);
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
  // Load exact group rank immediately; do not make it depend on the rest of loadReports().
  if (p.role === 'branch_staff') {
    const rankValue = $('branchRankValue');
    const rankGap = $('branchRankGap');
    if (rankValue) rankValue.textContent = '…';
    if (rankGap) rankGap.textContent = 'Checking group position…';
  }
  // Load the shared leaderboard for branch staff and management.
  void loadTop5BranchLeaderboard();
  if (p.role === 'admin') {
  $('portalBranch').innerHTML = branches.map(b => '<option value="' + b.id + '">' + esc(b.network) + ' - ' + esc(b.branch_name) + '</option>').join('');
    updatePortalBranchVisibility();
  }
  show('login',false); show('app',true); show('userTools',true); setPortalView('overviewTop'); show('entry',p.role==='branch_staff');
  show('correctionBranchWrap',p.role!=='branch_staff');
  if(p.role==='branch_staff') $('correctionBranch').innerHTML='';
  else $('correctionBranch').innerHTML='<option value=>All permitted branches</option>'+branches.map(b=>`<option value="${esc(b.id)}">${esc(b.network)} - ${esc(b.branch_name)}</option>`).join('');
  show('managementReportSection',p.role!=='branch_staff');
  show('branchAnalyticsSection',p.role!=='branch_staff');
  show('targetDashboardSection',p.role!=='branch_staff');
  show('managementExecutiveSection',p.role!=='branch_staff');
  const canViewFinancial = ['admin','management'].includes(String(p.role||'').toLowerCase());
  show('financialIntelligenceSection',canViewFinancial);
  document.querySelector('.financial-nav')?.classList.toggle('hidden',!canViewFinancial);
  document.querySelector('.quick-financial')?.classList.toggle('hidden',!canViewFinancial);
  document.querySelector('[data-quick-target="branchAnalyticsSection"]')?.classList.toggle('hidden',p.role==='branch_staff');
  renderPortalNotifications();
  if(canViewFinancial){ $('financialBranch').innerHTML='<option value="">Select branch</option>'+branches.map(b=>`<option value="${esc(b.id)}">${esc(b.network)} — ${esc(b.branch_name)}</option>`).join(''); $('financialPeriod').value=today.slice(0,7); $('financialAnalysisTo').value=today.slice(0,7); $('financialAnalysisFrom').value=`${today.slice(0,4)}-01`; await loadFinancialReports(); await loadFinancialManagementAnalysis(); }
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
  if(profile.role==='branch_staff') await loadStaffMonthComparison();
  overviewReports = monthReports || [];
  renderOverview();
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
  // Premium branch comparison visual (created dynamically to avoid changing the login/index shell).
  let visual=$('analyticsVisual');
  if(!visual) {
    visual=document.createElement('section');
    visual.id='analyticsVisual';
    visual.className='analytics-visual-panel';
    $('analyticsKpis').insertAdjacentElement('afterend',visual);
  }
  const chartMax=Math.max(1,...results.map(r=>r.current.sales));
  visual.innerHTML=`<div class="analytics-visual-head"><div><span class="analytics-visual-kicker">LIVE PERFORMANCE SNAPSHOT</span><h3>Branch sales comparison</h3><p>Current period sales by branch · ranked highest to lowest</p></div><div class="analytics-visual-total"><small>Network sales</small><strong>${money(totals.sales)}</strong></div></div><div class="analytics-bars">${results.map((r,i)=>{const pct=Math.max(r.current.sales?3:0,(r.current.sales/chartMax)*100);return `<div class="analytics-bar-row"><div class="analytics-bar-label"><span class="analytics-rank">${String(i+1).padStart(2,'0')}</span><strong>${esc(r.branch.branch_name)}</strong><small>${esc(r.branch.network)}</small></div><div class="analytics-bar-rail"><div class="analytics-bar-fill ${String(r.branch.network).toUpperCase()==='NEETHI'?'neethi':''}" style="width:${pct}%"></div></div><div class="analytics-bar-amount">${money(r.current.sales)}</div></div>`}).join('')}</div>`;
  // Additional management charts: patient volume, average bill and network split.
  let charts=$('analyticsExtraCharts');
  if(!charts) {
    charts=document.createElement('section');
    charts.id='analyticsExtraCharts';
    charts.className='analytics-extra-charts';
    charts.addEventListener('click',event=>{const button=event.target.closest('[data-analytics-branch]');if(button)renderBranchDrilldown(button.dataset.analyticsBranch);});
    visual.insertAdjacentElement('afterend',charts);
  }
  const chartCard=(title,subtitle,items,valueFn,formatFn,accent='')=>{
    const max=Math.max(1,...items.map(valueFn));
    return `<article class="analytics-mini-chart ${accent}"><div class="analytics-mini-head"><div><span class="analytics-visual-kicker">BRANCH COMPARISON</span><h3>${title}</h3><p>${subtitle}</p></div></div><div class="analytics-mini-list">${items.map((r,i)=>{const value=valueFn(r);const width=value>0?Math.max(3,value/max*100):0;return `<button type="button" class="analytics-mini-row analytics-mini-click" data-analytics-branch="${esc(String(r.branch.id))}" aria-label="Open ${esc(r.branch.branch_name)} daily details"><span class="analytics-mini-label"><span>${esc(r.branch.branch_name)}</span><strong>${formatFn(value)}</strong></span><span class="analytics-mini-track"><span class="analytics-mini-fill ${String(r.branch.network).toUpperCase()==='NEETHI'?'neethi':''}" style="width:${width}%"></span></span></button>`}).join('')}</div></article>`;
  };
  const byPatients=[...results].sort((a,b)=>b.current.patients-a.current.patients);
  const byAverage=[...results].sort((a,b)=>b.avg-a.avg);
  const networkTotals=['UNOMED','NEETHI'].map(name=>{
    const group=results.filter(r=>String(r.branch.network).toUpperCase()===name);
    const sales=group.reduce((n,r)=>n+r.current.sales,0);
    const patients=group.reduce((n,r)=>n+r.current.patients,0);
    return {name,sales,patients,average:patients?sales/patients:0};
  });
  const networkMax=Math.max(1,...networkTotals.map(n=>n.sales));
  charts.innerHTML=`<div class="analytics-extra-heading"><div><span class="analytics-visual-kicker">MANAGEMENT INSIGHTS</span><h3>Patient volume & average bill analysis</h3><p>These charts follow the selected comparison period and network filter.</p></div></div><div class="analytics-extra-grid">${chartCard('Patient volume by branch','Patients served · highest to lowest',byPatients,r=>r.current.patients,v=>v.toLocaleString('en-IN'))}${chartCard('Average bill by branch','Sales divided by patients',byAverage,r=>r.avg,v=>money(v),'average')}</div><article class="analytics-network-chart"><div><span class="analytics-visual-kicker">NETWORK COMPARISON</span><h3>UNOMED vs NEETHI</h3><p>Sales contribution and patient volume for the selected period</p></div><div class="analytics-network-grid">${networkTotals.map(n=>`<div class="analytics-network-item"><div class="analytics-network-title"><strong>${n.name}</strong><b>${money(n.sales)}</b></div><div class="analytics-mini-track"><div class="analytics-mini-fill ${n.name==='NEETHI'?'neethi':''}" style="width:${n.sales/networkMax*100}%"></div></div><small>${n.patients.toLocaleString('en-IN')} patients · Avg bill ${money(n.average)}</small></div>`).join('')}</div></article>`;
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

function renderMonthlyTargetRows() {
  const allRows=window.__monthlyTargetRows||[];
  const network=$('monthlyTargetNetwork')?.value||'ALL';
  const sort=$('monthlyTargetSort')?.value||'achievement';
  const rows=allRows.filter(r=>network==='ALL'||String(r.network).toUpperCase()===network);
  const sorters={achievement:(a,b)=>b.achievement-a.achievement||b.sales-a.sales,sales:(a,b)=>b.sales-a.sales,balance:(a,b)=>b.balance-a.balance,required:(a,b)=>b.required-a.required};
  rows.sort(sorters[sort]||sorters.achievement);
  $('targetRows').innerHTML=rows.map((r,i)=>{
    const pct=Math.max(0,Number(r.achievement)||0),width=Math.min(100,pct);
    const rankClass=i===0?'monthly-rank-first':i===1?'monthly-rank-second':i===2?'monthly-rank-third':'';
    const networkClass=String(r.network).toUpperCase()==='UNOMED'?'monthly-network-unomed':'monthly-network-neethi';
    return `<tr class="monthly-target-row ${r.alertClass}"><td><span class="monthly-rank ${rankClass}">${i+1}</span></td><td><strong class="monthly-branch-name">${esc(r.branch_name)}</strong>${r.missing?' <span class="pill">Target missing</span>':''}</td><td><span class="monthly-network-tag ${networkClass}">${esc(r.network)}</span></td><td class="monthly-sales-value">${money(r.sales)}</td><td>${Number(r.patients||0).toLocaleString('en-IN')}</td><td>${money(r.target)}</td><td><div class="monthly-achievement"><div class="monthly-achievement-top"><strong>${fmtPct(pct)}</strong><small>${r.target?'of monthly target':'Target not set'}</small></div><div class="monthly-progress-track"><i class="${r.alertClass}" style="width:${width}%"></i></div></div></td><td class="monthly-balance">${money(r.balance)}</td><td class="monthly-required">${money(r.required)}</td><td><span class="monthly-status ${r.alertClass}"><i></i>${esc(r.alert)}</span></td></tr>`;
  }).join('')||'<tr><td colspan="10" class="monthly-empty">No branches found for this network.</td></tr>';
  $('targetRows').dataset.visibleCount=String(rows.length);
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
  complianceRowsCache=rows;
  complianceChecked=true;
  renderPortalNotifications();
  const submitted=rows.filter(r=>r.submitted).length, missing=rows.filter(r=>r.status==='Missing').length, review=rows.filter(r=>r.status==='Needs review').length;
  $('complianceKpis').innerHTML = [
    ['total','Total branches',rows.length,'Active branches'],
    ['submitted','Submitted',submitted,'Reports received'],
    ['review','Needs review',review,'Check report status'],
    ['missing','Missing',missing,'Follow-up required']
  ].map(k=>'<article class="compliance-kpi '+k[0]+'"><span>'+k[1]+'</span><strong>'+k[2]+'</strong><small>'+k[3]+'</small></article>').join('');
  window.__complianceReportText = [
    'DAILY REPORTING COMPLIANCE - ' + date,
    'Submitted: ' + submitted + '/' + rows.length + ' | Missing: ' + missing + ' | Needs review: ' + review,
    ...rows.map(r => (r.branch_name || 'Branch') + ' (' + r.network + '): ' + r.status + ' | Reports: ' + r.matches + ' | Sales: ' + money(r.sales) + ' | Patients: ' + r.patients + ' | ' + r.action)
  ].join('\n');
  renderComplianceTable();
  $('complianceMsg').textContent = 'Compliance checked for ' + date + '. Status is based on records visible to your signed-in account.';
}

function renderComplianceTable() {
  const query=String($('complianceSearch')?.value||'').trim().toLowerCase();
  const rows=complianceRowsCache.filter(r=>{
    const network=String(r.network||'').toUpperCase();
    const networkMatch=complianceNetworkFilter==='ALL'||network===complianceNetworkFilter;
    const nameMatch=String(r.branch_name||'').toLowerCase().includes(query);
    return networkMatch&&nameMatch;
  });
  $('complianceVisibleCount').textContent='Showing '+rows.length+' of '+complianceRowsCache.length+' branches';
  $('complianceRows').innerHTML=rows.map(r=>'<tr class="compliance-row '+(r.status==='Submitted'?'is-submitted':r.status==='Missing'?'is-missing':'is-review')+'">'+
    '<td><strong>'+esc(r.branch_name||'Branch')+'</strong></td>'+ '<td><span class="compliance-network '+(String(r.network||'').toUpperCase()==='NEETHI'?'neethi':'unomed')+'">'+esc(r.network||'')+'</span></td>'+ '<td><span class="compliance-status '+(r.status==='Submitted'?'good':r.status==='Missing'?'bad':'warn')+'"><i></i>'+esc(r.status)+'</span></td>'+ '<td>'+r.matches+'</td>'+ '<td>'+money(r.sales)+'</td>'+ '<td>'+Number(r.patients||0).toLocaleString('en-IN')+'</td>'+ '<td class="compliance-action">'+esc(r.action)+'</td></tr>').join('')||'<tr><td colspan="7" class="compliance-empty">No branches match these filters.</td></tr>';
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
    window.__monthlyTargetRows = rows;
    $('monthlyTargetNetwork').value = 'ALL';
    $('monthlyTargetSort').value = 'achievement';
    $('alertSummary').innerHTML =
      '<div class="monthly-alert-card monthly-alert-green"><span class="monthly-alert-icon">✓</span><div><strong>' + alertCounts.green + '</strong><span>On track / achieved</span></div></div>' +
      '<div class="monthly-alert-card monthly-alert-yellow"><span class="monthly-alert-icon">!</span><div><strong>' + alertCounts.yellow + '</strong><span>Needs attention</span></div></div>' +
      '<div class="monthly-alert-card monthly-alert-red"><span class="monthly-alert-icon">⚠</span><div><strong>' + alertCounts.red + '</strong><span>Critical branches</span></div></div>' +
      '<div class="monthly-alert-card monthly-alert-neutral"><span class="monthly-alert-icon">◎</span><div><strong>' + alertCounts.none + '</strong><span>Targets missing</span></div></div>';
    renderMonthlyTargetRows();

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

function renderOverview() {
  const staff=profile?.role==='branch_staff';
  const monthKey=$('performanceMonth')?.value || today.slice(0,7);
  const branchMap=new Map(branches.map(b=>[String(b.id),b]));
  const source=(overviewReports||[]).filter(r=>r.report_date && r.report_date.startsWith(monthKey));
  const visibleBranches=staff?branches.filter(b=>String(b.id)===String(profile.branch_id)):branches;
  const branchRows=visibleBranches.map(b=>{
    const rows=source.filter(r=>String(r.branch_id)===String(b.id));
    const sales=rows.reduce((a,r)=>a+Number(r.total_sales||0),0);
    const patients=rows.reduce((a,r)=>a+Number(r.patient_count||0),0);
    const targetRow=(targets||[]).find(t=>String(t.branch_id)===String(b.id));
    const target=Number(targetRow?.target_amount||0);
    return {...b,sales,patients,target,achievement:target?sales/target*100:0,reports:rows.length};
  }).sort((a,b)=>b.sales-a.sales);
  const totalSales=branchRows.reduce((a,r)=>a+r.sales,0);
  const totalPatients=branchRows.reduce((a,r)=>a+r.patients,0);
  const totalTarget=branchRows.reduce((a,r)=>a+r.target,0);
  const achievement=totalTarget?totalSales/totalTarget*100:0;
  const todaySales=(overviewReports||[]).filter(r=>r.report_date===today && (staff?String(r.branch_id)===String(profile.branch_id):true)).reduce((a,r)=>a+Number(r.total_sales||0),0);
  const avgBill=totalPatients?totalSales/totalPatients:0;
  const branchLabel=staff?(branchRows[0]?.branch_name||'Your branch'):'UNOMED + NEETHI Group';
  $('overviewGreeting').textContent=staff?'YOUR BRANCH COMMAND CENTRE':'MANAGEMENT COMMAND CENTRE';
  $('overviewHeroTitle').textContent=staff?`Welcome, ${profile.full_name?.split(' ')[0]||'Team'}!`:'Business performance at a glance';
  $('overviewHeroSub').textContent=`${branchLabel} · ${monthKey} · Data visible to your signed-in account`;
  $('overviewRolePill').textContent=String(profile?.role||'portal').replaceAll('_',' ').toUpperCase();
  const kpis=[
    {label:'TODAY\'S SALES',value:money(todaySales),meta:'Sales recorded today',tone:'blue',icon:'₹'},
    {label:'MONTH SALES',value:money(totalSales),meta:`${monthKey} month-to-date`,tone:'red',icon:'↗'},
    {label:'PATIENTS SERVED',value:totalPatients.toLocaleString('en-IN'),meta:'Patients in selected month',tone:'teal',icon:'♙'},
    {label:'TARGET ACHIEVEMENT',value:fmtPct(achievement),meta:totalTarget?`${money(Math.max(totalTarget-totalSales,0))} balance`:'Monthly target not set',tone:'gold',icon:'◎'},
    {label:'AVERAGE BILL',value:money(avgBill),meta:'Sales divided by patients',tone:'violet',icon:'⌁'}
  ];
  $('overviewKpis').innerHTML=kpis.map(k=>`<article class="overview-kpi ${k.tone}"><span class="overview-kpi-icon">${k.icon}</span><span class="overview-kpi-label">${k.label}</span><strong>${k.value}</strong><small>${k.meta}</small></article>`).join('');
  const nets=['UNOMED','NEETHI'].map(n=>{const arr=branchRows.filter(b=>String(b.network).toUpperCase()===n);return {name:n,sales:arr.reduce((a,b)=>a+b.sales,0),target:arr.reduce((a,b)=>a+b.target,0),patients:arr.reduce((a,b)=>a+b.patients,0),count:arr.length};});
  $('overviewNetworkGrid').innerHTML=staff?`<article class="overview-network-card own"><span class="overview-label">YOUR BRANCH</span><strong>${esc(branchLabel)}</strong><div class="overview-network-numbers"><b>${money(totalSales)}</b><span>${fmtPct(achievement)} achieved</span></div><div class="overview-progress"><i style="width:${Math.min(100,achievement)}%"></i></div><small>${money(totalTarget)} monthly target · ${totalPatients.toLocaleString('en-IN')} patients</small></article>`:nets.map(n=>`<article class="overview-network-card ${n.name.toLowerCase()}"><div class="overview-network-head"><span class="overview-label">${n.name} NETWORK</span><span>${n.count} branches</span></div><strong>${money(n.sales)}</strong><div class="overview-progress"><i style="width:${Math.min(100,n.target?n.sales/n.target*100:0)}%"></i></div><div class="overview-network-numbers"><span>${fmtPct(n.target?n.sales/n.target*100:0)} achieved</span><span>Target ${money(n.target)}</span></div><small>${n.patients.toLocaleString('en-IN')} patients</small></article>`).join('');
  const dates=[];const nowDate=new Date();const [yy,mm]=monthKey.split('-').map(Number);const lastDay=new Date(yy,mm,0).getDate();
  let count=overviewPeriod==='month'?lastDay:Number(overviewPeriod);let startDay=overviewPeriod==='month'?1:Math.max(1,nowDate.getDate()-count+1);if(monthKey!==today.slice(0,7)&&overviewPeriod!=='month')startDay=Math.max(1,lastDay-count+1);const endDay=overviewPeriod==='month'?lastDay:Math.min(lastDay,startDay+count-1);
  for(let d=startDay;d<=endDay;d++){const key=`${monthKey}-${String(d).padStart(2,'0')}`;dates.push({key,sales:source.filter(r=>r.report_date===key).filter(r=>!staff||String(r.branch_id)===String(profile.branch_id)).reduce((a,r)=>a+Number(r.total_sales||0),0)});}
  const max=Math.max(1,...dates.map(x=>x.sales));
  $('overviewChartTitle').textContent=overviewPeriod==='month'?'Daily sales · full month':`Daily sales · last ${overviewPeriod} days`;
  $('overviewTrend').innerHTML=dates.map(x=>`<div class="overview-trend-day" title="${x.key}: ${money(x.sales)}"><div class="overview-trend-bar-wrap"><i style="height:${x.sales?Math.max(3,x.sales/max*100):1}%"></i></div><small>${x.key.slice(8)}</small></div>`).join('');
  const periodTotal=dates.reduce((a,x)=>a+x.sales,0);$('overviewTrendFoot').textContent=`Period sales: ${money(periodTotal)} · ${dates.filter(x=>x.sales>0).length} reporting days`;
  const quick=staff?[['✍','Submit daily sales','entry'],['🎯','My branch target','branchDailyTargetSection'],['📅','View daily reports','dailySalesSection'],['🛠','Correct a submitted report','dailySalesSection']]:[['📊','Branch performance','targetSection'],['🎯','Target vs actual','targetDashboardSection'],['✅','Daily compliance','complianceSection'],['📄','Management report','managementReportSection'],['📅','Daily sales & corrections','dailySalesSection']];
  $('overviewQuickActions').innerHTML=quick.filter(q=>$(q[2])&&!$(q[2]).classList.contains('hidden')).map(q=>`<button type="button" class="overview-action" data-overview-target="${q[2]}"><span>${q[0]}</span>${q[1]}<b>→</b></button>`).join('');
  const pace=totalTarget?achievement:0;const best=branchRows[0];const weakest=[...branchRows].filter(r=>r.target>0).sort((a,b)=>a.achievement-b.achievement)[0];
  $('overviewInsight').innerHTML=staff?`<strong>${pace>=100?'🏆 Target achieved':pace>=85?'👍 Good progress':'⚡ Keep building momentum'}</strong><br>${pace>=100?'Your branch has achieved its monthly target.':`You have achieved ${fmtPct(pace)} of your monthly target. Focus on consistent daily sales and patient follow-up.`}`:`<strong>${best?'🏆 Leading branch: '+esc(best.branch_name):'📊 Branch insights'}</strong><br>${weakest?`Needs attention: ${esc(weakest.branch_name)} at ${fmtPct(weakest.achievement)} achievement.`:'Set branch targets to unlock pace insights.'}`;
  show('overviewBranchPanel',!staff);
  const filtered=branchRows.filter(r=>overviewNetwork==='ALL'||String(r.network).toUpperCase()===overviewNetwork);
  $('overviewBranchRows').innerHTML=filtered.map((r,i)=>`<div class="overview-branch-row"><span class="overview-rank">${i+1}</span><div class="overview-branch-name"><strong>${esc(r.branch_name)}</strong><small>${esc(r.network)} · ${r.patients.toLocaleString('en-IN')} patients</small></div><div class="overview-branch-progress"><div><i style="width:${Math.min(100,r.achievement)}%"></i></div><small>${fmtPct(r.achievement)} of ${money(r.target)}</small></div><strong class="overview-branch-sales">${money(r.sales)}</strong></div>`).join('')||'<p>No branch results for this filter.</p>';
  const reportToday=(overviewReports||[]).filter(r=>r.report_date===today);const reported=new Set(reportToday.map(r=>String(r.branch_id)));const compliant=visibleBranches.filter(b=>reported.has(String(b.id))).length;
  $('overviewCompliance').innerHTML=`<div class="overview-compliance-count"><strong>${compliant}/${visibleBranches.length}</strong><span>branches submitted today</span></div><div class="overview-progress"><i style="width:${visibleBranches.length?compliant/visibleBranches.length*100:0}%"></i></div><small>${visibleBranches.length-compliant} branch(es) without a visible report today</small>`;
  const recent=(reports||[]).filter(r=>staff?String(r.branch_id)===String(profile.branch_id):true).slice(0,5);
  $('overviewRecent').innerHTML=recent.map(r=>{const b=branchMap.get(String(r.branch_id));return `<div class="overview-recent-row"><span><strong>${esc(b?.branch_name||'Branch')}</strong><small>${esc(r.report_date)}</small></span><b>${money(r.total_sales)}</b></div>`;}).join('')||'<p>No recent reports available.</p>';
}

async function loadTop5BranchLeaderboard() {
  const hosts = [$('top5BranchRows'), $('staffTop5BranchRows')].filter(Boolean);
  const notes = [$('top5BranchMsg'), $('staffTop5BranchMsg')].filter(Boolean);
  if (!hosts.length || !db || !profile) return;
  hosts.forEach(host => host.innerHTML = '<p class="overview-empty">Loading branch leaderboard…</p>');
  const periodLabels = [$('top5PeriodLabel'), $('staffTop5PeriodLabel')].filter(Boolean);
  periodLabels.forEach(el => el.textContent = `As of ${today}`);
  try {
    const {data,error}=await db.rpc('get_top_group_branches',{p_as_of_date:today});
    if(error) throw error;
    const rows=Array.isArray(data)?data:[];
    window.__top5BranchRows=rows;
    const topFive=rows.filter(r=>Number(r.rank_no)<=5).sort((a,b)=>Number(a.rank_no)-Number(b.rank_no));
    const markup=topFive.length?topFive.map(r=>`<div class="overview-top5-row"><span class="overview-top5-rank">${Number(r.rank_no)}</span><div class="overview-top5-branch"><strong>${esc(r.branch_name||'Branch')}</strong><small>${esc(r.network||'')}</small></div><strong class="overview-top5-achievement">${Number(r.achievement_pct||0).toFixed(1)}%</strong></div>`).join(''):'<p class="overview-empty">No monthly branch targets are configured for this month.</p>';
    hosts.forEach(host => host.innerHTML=markup);
    notes.forEach(note => note.textContent='Showing rank, branch, network and achievement percentage only.');
    const rankValueEl=$('branchRankValue'), rankGapEl=$('branchRankGap');
    if(profile.role==='branch_staff' && rankValueEl && rankGapEl){
      const own=rows.find(r=>r.is_current_branch===true);
      rankValueEl.textContent=own?`#${own.rank_no}`:'Not ranked';
      rankGapEl.textContent=own?(Number(own.rank_no)===1?'You are the group leader.':`Need +${Math.max(0,Number(own.gap_to_next_pct||0)).toFixed(1)} percentage points to reach position #${Number(own.rank_no)-1}.`):'Rank unavailable: check that this branch has a target for the selected month.';
    }
  } catch(err) {
    window.__top5BranchRows=[];
    hosts.forEach(host => host.innerHTML='<p class="overview-empty">Leaderboard unavailable. Check the database setup.</p>');
    notes.forEach(note => note.textContent=`Top 5 query failed: ${err.message||'Unknown Supabase error'}.`);
    const rankValueEl=$('branchRankValue'), rankGapEl=$('branchRankGap');
    if(profile?.role==='branch_staff') {
      if(rankValueEl) rankValueEl.textContent='Unavailable';
      if(rankGapEl) rankGapEl.textContent=`Ranking query failed: ${err.message||'Check Supabase SQL setup.'}`;
    }
    console.error('Top 5 branch leaderboard unavailable:',err);
  }
}

async function loadStaffMonthComparison() {
  const host=$('staffMonthComparisonCards'), note=$('staffMonthComparisonMsg');
  if(!host || !db || profile?.role!=='branch_staff' || !profile.branch_id) return;
  const [year,month,day]=today.split('-').map(Number);
  const currentStart=`${year}-${String(month).padStart(2,'0')}-01`;
  const prevMonthDate=new Date(year,month-2,1);
  const prevStart=`${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth()+1).padStart(2,'0')}-01`;
  const prevLast=new Date(prevMonthDate.getFullYear(),prevMonthDate.getMonth()+1,0).getDate();
  const compareDay=Math.min(day,prevLast);
  const currentEnd=today;
  const prevEnd=`${prevStart.slice(0,7)}-${String(compareDay).padStart(2,'0')}`;
  host.innerHTML='<p class="chart-loading">Loading your branch comparison…</p>';
  try {
    const fetchPeriod=async(start,end)=>{
      const {data,error}=await db.from('daily_reports').select('report_date,total_sales,patient_count')
        .eq('branch_id',profile.branch_id).gte('report_date',start).lte('report_date',end);
      if(error) throw error;
      return data||[];
    };
    const [current,previous]=await Promise.all([fetchPeriod(currentStart,currentEnd),fetchPeriod(prevStart,prevEnd)]);
    const sum=rows=>rows.reduce((a,r)=>({sales:a.sales+Number(r.total_sales||0),patients:a.patients+Number(r.patient_count||0),days:a.days+1}),{sales:0,patients:0,days:0});
    const c=sum(current),p=sum(previous);
    const change=(now,before)=>before>0?((now-before)/before)*100:null;
    const salesChange=change(c.sales,p.sales),patientChange=change(c.patients,p.patients);
    const averageChange=change(c.patients?c.sales/c.patients:0,p.patients?p.sales/p.patients:0);
    const changeLabel=v=>v===null?'—':`${v>=0?'+':''}${v.toFixed(1)}%`;
    const metric=(label,now,before,delta)=>`<article class="staff-month-comparison-card"><span>${label}</span><strong>${now}</strong><small>Previous: ${before}</small><b class="${delta!==null&&delta<0?'is-down':'is-up'}">${changeLabel(delta)}</b></article>`;
    host.innerHTML=metric('Sales',money(c.sales),money(p.sales),salesChange)+metric('Patients',c.patients.toLocaleString('en-IN'),p.patients.toLocaleString('en-IN'),patientChange)+metric('Average bill',money(c.patients?c.sales/c.patients:0),money(p.patients?p.sales/p.patients:0),averageChange);
    $('staffMonthComparisonPeriod').textContent=`${currentStart}–${currentEnd} compared with ${prevStart}–${prevEnd} · same elapsed day count`;
    if(note) note.textContent='Figures are limited to your assigned branch. Percentage change compares this month with the same elapsed period last month.';
  } catch(err) {
    host.innerHTML='<p class="overview-empty">Could not load the monthly comparison.</p>';
    if(note) note.textContent=`${err.message||'Monthly comparison query failed.'} Check daily_reports read access for your assigned branch.`;
  }
}

function renderDailyTrend(monthReports) {
  const monthKey = $('performanceMonth')?.value || today.slice(0,7);
  const byDate = new Map();

  monthReports.forEach(r => {
    const d = r.report_date;
    if (!d) return;

    // Ignore future-dated reports in the current month's graph.
    if (monthKey === today.slice(0,7) && d > today) return;

    byDate.set(d, (byDate.get(d) || 0) + Number(r.total_sales || 0));
  });

  const dates = [...byDate.keys()].sort();

  if (!dates.length) {
    $('dailyTrend').innerHTML =
      '<p>No sales reports available for this month yet.</p>';
    return;
  }

  const max = Math.max(...dates.map(d => byDate.get(d)), 1);

  $('dailyTrend').innerHTML = dates.map(d => {
    const v = byDate.get(d);
    const height = Math.max(2, v / max * 100);

    return `
      <div class="trend-day" title="${esc(d)} · ${money(v)}">
        <strong style="font-size:11px;color:#142b49;white-space:nowrap;margin-bottom:5px;">
          ${money(v)}
        </strong>
        <div class="trend-bar-wrap">
          <span class="trend-bar" style="height:${height}%"></span>
        </div>
        <small>${esc(d.slice(8))}</small>
      </div>
    `;
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

function openSalesConfirmation(e) {
  e?.preventDefault?.();
  const form = $('salesForm');
  const modal = $('salesConfirmModal');
  const content = $('salesConfirmContent');
  if (!form || !modal || !content) {
    msg('salesMsg', 'Review window could not be loaded. Missing sales form or confirmation modal.');
    console.error('Sales review setup incomplete:', {form:!!form, modal:!!modal, content:!!content});
    return;
  }
  if (!form.reportValidity()) {
    const invalid = form.querySelector(':invalid');
    if (invalid) {
      invalid.focus();
      msg('salesMsg', `${invalid.labels?.[0]?.textContent || invalid.id || 'A required field'} needs a valid value.`);
    } else {
      msg('salesMsg', 'Please complete the required sales entry fields before reviewing.');
    }
    return;
  }

  const branch = branches.find(b => String(b.id) === String(profile?.branch_id));
  const selected = names.map((name, i) => ({
    name,
    qty: Number($('p' + i)?.value || 0)
  })).filter(x => x.qty > 0);
  const rows = selected.length
    ? selected.map(x => `<div class="confirm-package-row"><span>${esc(x.name)}</span><strong>${x.qty}</strong></div>`).join('')
    : '<p class="confirm-no-packages">No package sales entered</p>';

  content.innerHTML = `<div class="confirm-summary-grid">
    <div><span>Branch</span><strong>${esc(branch?.branch_name || 'Assigned branch')}</strong></div>
    <div><span>Report date</span><strong>${esc($('date')?.value || '')}</strong></div>
    <div><span>Total sales</span><strong>${money($('sales')?.value || 0)}</strong></div>
    <div><span>Patients</span><strong>${Number($('patients')?.value || 0)}</strong></div>
    <div><span>Home collections</span><strong>${Number($('home')?.value || 0)}</strong></div>
    <div><span>Google reviews</span><strong>${Number($('reviews')?.value || 0)}</strong></div>
  </div><div class="confirm-package-list">
    <div class="confirm-package-heading"><strong>Package counts</strong><span>${selected.length} selected</span></div>${rows}
  </div>`;

  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('sales-confirm-open');
  $('confirmSalesSubmit')?.focus();
}
function closeSalesConfirmation() { const modal=$('salesConfirmModal'); if(modal){ modal.classList.add('hidden'); modal.style.display='none'; modal.setAttribute('aria-hidden','true'); } document.body.classList.remove('sales-confirm-open'); }
async function submitConfirmedSales() {
  const btn=$('confirmSalesSubmit');
  if(!btn || btn.disabled) return;
  btn.disabled=true; btn.textContent='Submitting…';
  try {
    const saved = await submit({preventDefault(){}});
    if(saved === true) closeSalesConfirmation();
  } catch(err) {
    msg('salesMsg', err?.message || 'Submission failed. Please try again.');
  } finally {
    btn.disabled=false; btn.textContent='Confirm & submit';
  }
}

async function submit(e) {
  e.preventDefault();
  if(!editingReportId && profile?.role!=='branch_staff') { msg('salesMsg','Only branch staff can submit new reports.'); return false; }
  const branch=branches.find(b=>String(b.id)===String(profile.branch_id));
  if(!editingReportId && !branch) { msg('salesMsg','No valid active branch assigned.'); return false; }
  const btn=$('reviewSalesSubmit') || $('salesForm')?.querySelector('button[type="submit"],button:not([type])');
  if(btn) btn.disabled=true; msg('salesMsg',editingReportId?'Saving corrections…':'Submitting…');
  try {
    const packages=names.map((name,i)=>({package_name:name,quantity:Number($('p'+i).value||0)})).filter(x=>x.quantity>0);
    if(editingReportId) {
      const {error}=await db.rpc('correct_daily_report',{p_report_id:String(editingReportId),p_report_date:$('date').value,p_total_sales:Number($('sales').value),p_patient_count:Number($('patients').value),p_home_collections:Number($('home').value||0),p_google_reviews:Number($('reviews').value||0),p_packages:packages});
      if(error) throw error;
      msg('salesMsg','Report corrections saved successfully. The original report was updated.',true);
      cancelReportCorrection(false);
      await loadReports(); await loadCorrectionReports();
      return true;
    } else {
      const {data:r,error}=await db.from('daily_reports').insert({branch_id:branch.id,report_date:$('date').value,total_sales:Number($('sales').value),patient_count:Number($('patients').value),home_collections:Number($('home').value||0),google_reviews:Number($('reviews').value||0),submitted_by:user.id,status:'submitted'}).select('id').single();
      if(error) throw error;
      const rows=packages.map(x=>({...x,report_id:r.id}));
      if(rows.length) { const {error:pe}=await db.from('package_sales').insert(rows); if(pe) throw new Error('Report saved but package counts failed. Check the database before retrying: '+pe.message); }
      msg('salesMsg','Report submitted.',true); $('salesForm').reset(); $('date').value=today; names.forEach((_,i)=>$('p'+i).value=0); renderSelectedPackages(); await loadReports(); await loadCorrectionReports();
      return true;
    }
  } catch(err) { msg('salesMsg',err.message||'Submission failed'); return false; }
  finally { if(btn) btn.disabled=false; }
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
  renderSelectedPackages(); $('cancelCorrection').classList.remove('hidden');
  const submitBtn=$('reviewSalesSubmit'); if(submitBtn) submitBtn.textContent='Review corrections';
  $('correctionMsg').textContent=`Editing report ${r.report_date}. Update the fields in Daily Sales Entry and save.`;
  $('salesMsg').textContent='Correction mode: changes will update this existing report.';
  $('entry').classList.remove('hidden'); $('entry').scrollIntoView({behavior:'smooth',block:'start'});
}

function cancelReportCorrection(clearMessage=true) {
  editingReportId=null;
  $('cancelCorrection').classList.add('hidden');
  $('salesForm').reset(); $('date').value=today; names.forEach((_,i)=>$('p'+i).value=0); renderSelectedPackages();
  const submitBtn=$('reviewSalesSubmit'); if(submitBtn) submitBtn.textContent='Review & submit report →';
  if(clearMessage) $('salesMsg').textContent='Correction cancelled.';
}

async function viewReportHistory(id) {
  const panel=$('correctionHistory'), target=$('correctionHistoryRows');
  panel.classList.remove('hidden'); target.textContent='Loading history…';
  panel.scrollIntoView({behavior:'smooth',block:'nearest'});
  const {data,error}=await db.rpc('get_daily_report_history',{p_report_id:String(id)});
  if(error) { target.textContent='History unavailable: '+error.message; return; }
  if(!data?.length) { target.textContent='No corrections have been recorded for this report.'; return; }
  const branchMap=new Map(branches.map(b=>[String(b.id),b.branch_name]));
  target.innerHTML=data.map(x=>{
    const branchName=branchMap.get(String(x.branch_id))||'Branch';
    const changedBy=x.changed_by_name||'Unknown staff member';
    const before=x.old_values||{}, after=x.new_values||{};
    const fields=[['Report date','report_date'],['Sales','total_sales'],['Patients','patient_count'],['Home collections','home_collections'],['Google reviews','google_reviews']];
    const changes=fields.filter(([,key])=>String(before[key]??'')!==String(after[key]??''));
    const changesHtml=changes.length?`<div style="margin:8px 0"><strong>Changed fields</strong><ul>${changes.map(([label,key])=>`<li>${esc(label)}: ${esc(String(before[key]??'—'))} → ${esc(String(after[key]??'—'))}</li>`).join('')}</ul></div>`:'<p>No main report fields changed (package counts may have changed).</p>';
    return `<article style="padding:14px 0;border-top:1px solid #e3e9f1"><strong>${esc(new Date(x.changed_at).toLocaleString('en-IN'))}</strong><p style="margin:6px 0;color:#526b88">Changed by: <strong>${esc(changedBy)}</strong></p><p style="margin:4px 0;color:#526b88">Branch: <strong>${esc(branchName)}</strong></p>${changesHtml}<details><summary>View complete before and after values</summary><p><strong>Before</strong></p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(before,null,2))}</pre><p><strong>After</strong></p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(after,null,2))}</pre></details></article>`;
  }).join('');
}


// Employee task assignment workflow. RLS policies in employee_tasks_scope.sql are authoritative.
let employeeTaskRecords=[];
async function loadEmployeeTasks(){
  const body=$('employeeTaskRows'); if(!body||!db||!profile)return;
  try{
    const {data,error}=await db.from('employee_tasks').select('id,employee_id,branch_id,title,description,due_date,priority,status,created_at').order('due_date',{ascending:true}).limit(500);
    if(error)throw error;
    employeeTaskRecords=data||[];
    const names=new Map(employeeRecords.map(e=>[String(e.id),e.full_name]));
    const todayLocal=today;
    const open=employeeTaskRecords.filter(t=>t.status!=='completed');
    const overdue=open.filter(t=>t.due_date<todayLocal).length;
    const dueToday=open.filter(t=>t.due_date===todayLocal).length;
    $('employeeTaskSummary').innerHTML=`<article class="stat"><span>Open tasks</span><strong>${open.length}</strong></article><article class="stat"><span>Overdue</span><strong>${overdue}</strong></article><article class="stat"><span>Due today</span><strong>${dueToday}</strong></article><article class="stat"><span>Completed</span><strong>${employeeTaskRecords.filter(t=>t.status==='completed').length}</strong></article>`;
    const filter=$('taskStatusFilter').value;
    const rows=employeeTaskRecords.filter(t=>filter==='all'||(filter==='open'?t.status!=='completed':t.status===filter));
    $('employeeTaskRows').innerHTML=rows.map(t=>{
      const overdueFlag=t.status!=='completed'&&t.due_date<todayLocal;
      const canUpdate=String(employeeRecords.find(e=>String(e.id)===String(t.employee_id))?.auth_user_id||'')===String(user.id)||canManageEmployees();
      const options=['pending','in_progress','completed'].map(v=>`<option value="${v}" ${t.status===v?'selected':''}>${v.replace('_',' ')}</option>`).join('');
      return `<tr><td><strong>${esc(t.title)}</strong>${t.description?`<br><small>${esc(t.description)}</small>`:''}</td><td>${esc(names.get(String(t.employee_id))||'Employee')}</td><td>${esc(t.due_date)}${overdueFlag?' <span class="pill" style="background:#fee2e2;color:#991b1b">Overdue</span>':''}</td><td>${esc(t.priority)}</td><td>${esc(t.status.replace('_',' '))}</td><td>${canUpdate?`<select data-task-status="${t.id}" aria-label="Update task status">${options}</select><button type="button" class="secondary" data-task-save="${t.id}">Update</button>`:'—'}</td></tr>`;
    }).join('')||'<tr><td colspan="6">No tasks match this filter.</td></tr>';
    // Only deadlines relevant to the signed-in user are surfaced for staff; managers see permitted tasks.
    employeeTaskAlerts=employeeTaskRecords.filter(t=>t.status!=='completed'&&(t.due_date<todayLocal||t.due_date===todayLocal)).map(t=>({...t,employee_name:names.get(String(t.employee_id))||'Employee'}));
    if(String(profile.role).toLowerCase()==='branch_staff') employeeTaskAlerts=employeeTaskAlerts.filter(t=>String(employeeRecords.find(e=>String(e.id)===String(t.employee_id))?.auth_user_id||'')===String(user.id));
    else employeeTaskAlerts=employeeTaskAlerts.filter(t=>t.due_date<=todayLocal);
    renderPortalNotifications();
  }catch(err){$('employeeTaskRows').innerHTML=`<tr><td colspan="6">Task workflow setup required: ${esc(err.message||err)}. Run employee_tasks_scope.sql in Supabase, then refresh.</td></tr>`;employeeMessage('employeeTaskMsg','Task database setup required. Run employee_tasks_scope.sql in Supabase.');}
}
async function createEmployeeTask(e){
  e.preventDefault(); if(!canManageEmployees()){employeeMessage('employeeTaskMsg','Only management or branch managers can assign tasks.');return;}
  const emp=employeeRecords.find(x=>String(x.id)===$('taskEmployee').value);if(!emp){employeeMessage('employeeTaskMsg','Select an active employee.');return;}
  const payload={employee_id:emp.id,branch_id:emp.branch_id,title:$('taskTitle').value.trim(),description:$('taskDescription').value.trim()||null,due_date:$('taskDueDate').value,priority:$('taskPriority').value,status:'pending',created_by:user.id};
  try{const {error}=await db.from('employee_tasks').insert(payload);if(error)throw error;$('employeeTaskForm').reset();$('taskDueDate').value=today;employeeMessage('employeeTaskMsg','Task assigned successfully.',true);await loadEmployeeTasks();}
  catch(err){employeeMessage('employeeTaskMsg',err.message||'Could not assign task. Check task-table RLS policies.');}
}
async function handleEmployeeTaskAction(e){
  const btn=e.target.closest('[data-task-save]');if(!btn)return;
  const id=btn.dataset.taskSave;const status=$(`task-status-${id}`)?.value||document.querySelector(`[data-task-status="${CSS.escape(id)}"]`)?.value;
  if(!status)return;
  const payload={status,completed_at:status==='completed'?new Date().toISOString():null,updated_at:new Date().toISOString()};
  try{const {error}=await db.from('employee_tasks').update(payload).eq('id',id);if(error)throw error;employeeMessage('employeeTaskMsg','Task status updated.',true);await loadEmployeeTasks();}
  catch(err){employeeMessage('employeeTaskMsg',err.message||'Could not update task.');}
}

// Employee performance module. Database security is enforced by the SQL RLS policies,
// not by these UI visibility checks alone.
let employeeRecords = [];
function canManageEmployees() { return ['admin','management','branch_manager'].includes(String(profile?.role||'').toLowerCase()); }
function employeeMessage(id,text,ok=false) { const el=$(id); if(el){el.textContent=text;el.style.color=ok?'#16764a':'#a21d37';} }
async function loadEmployeeModule() {
  if(!profile || !db) return;
  show('employeeSection', true);
  // The first sidebar visibility pass runs before employee data loads. Refresh
  // it now that the employee section has been made visible, otherwise the
  // Employee module link remains marked nav-hidden for Admin/Management.
  refreshSidebarVisibility();
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
    $('taskEmployee').innerHTML=employeeRecords.filter(e=>e.active).map(e=>`<option value="${e.id}">${esc(e.full_name)} — ${esc(branchMap.get(String(e.branch_id))?.branch_name||'Branch')}</option>`).join('');
    show('employeeTaskAdminPanel',canManageEmployees());
    $('taskDueDate').value=today;
    await loadEmployeeTargets();
    const active=employeeRecords.filter(e=>e.active).length;
    $('employeeSummary').innerHTML=`<article class="stat"><span>Employees visible</span><strong>${employeeRecords.length}</strong></article><article class="stat"><span>Active employees</span><strong>${active}</strong></article><article class="stat"><span>Branches represented</span><strong>${new Set(employeeRecords.map(e=>e.branch_id)).size}</strong></article>`;
    await loadEmployeeActivities();
    await loadEmployeeTasks();
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


// ================= FINANCIAL INTELLIGENCE (Admin + Management only) =================
const FINANCIAL_CATEGORIES = [
  'Operating income','Discounts and adjustments','Direct laboratory costs','Outsourced tests / B2B','Subcontractor costs',
  'Employee costs','Rent and premises','Head-office / shared overhead','Doctor / professional fees','Marketing and advertising',
  'Office and administration','Travel and conveyance','Utilities and housekeeping','Repairs and maintenance','Other operating expenses',
  'Non-operating income','Finance costs','Depreciation','Tax','Profit distribution / share','Other non-operating expense','Unmapped / review required'
];
const FINANCIAL_BEHAVIOURS=['Not applicable','Fixed','Variable','Semi-variable','Shared overhead','Profit distribution'];
let activeFinancialReport=null, activeFinancialLines=[];
let financialAnalysisRows=[], financialAnalysisLines=[];
async function loadFinancialManagementAnalysis(){
  if(!financialAllowed()||!db)return;
  $('financialManagementNote').textContent='Loading approved financial statements…';
  try{
    const from=$('financialAnalysisFrom').value,to=$('financialAnalysisTo').value;
    let q=db.from('financial_reports').select('*').eq('status','approved').order('period_start',{ascending:true}).limit(2000);
    if(from)q=q.gte('period_start',`${from}-01`);if(to){const [y,m]=to.split('-').map(Number);const lastDay=new Date(y,m,0).getDate();const end=`${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;q=q.lte('period_end',end);}
    const {data:reports,error}=await q;if(error)throw error;
    financialAnalysisRows=reports||[];
    const ids=financialAnalysisRows.map(r=>r.id);
    financialAnalysisLines=[];
    if(ids.length){const {data:lines,error:le}=await db.from('financial_report_lines').select('report_id,account_name,amount,mapped_category,expense_behaviour,variable_component_pct,section').in('report_id',ids);if(le)throw le;financialAnalysisLines=lines||[];}
    renderFinancialManagementAnalysis();
  }catch(err){$('financialManagementNote').textContent='Could not load management analysis: '+(err.message||err);}
}
function financialTotals(r){const t=r.extracted_totals||{};const income=Number(t['Total for Operating Income']||0),cogs=Number(t['Total for Cost of Goods Sold']||0),gross=Number(t['Gross Profit']??income-cogs),opex=Number(t['Total for Operating Expense']||0),op=Number(t['Operating Profit']??gross-opex),nonInc=Number(t['Total for Non Operating Income']||0),nonExp=Number(t['Total for Non Operating Expense']||0);return {income,cogs,gross,opex,op,nonInc,nonExp};}
function renderFinancialManagementAnalysis(){
  if(!financialAllowed())return;
  const network=$('financialAnalysisNetwork').value||'ALL';
  const branchSelect=$('financialAnalysisBranch');
  const availableBranches=(branches||[]).filter(b=>network==='ALL'||String(b.network||'').toUpperCase()===network).sort((a,b)=>String(a.branch_name).localeCompare(String(b.branch_name)));
  const previousBranch=branchSelect.value||'ALL';
  branchSelect.innerHTML='<option value="ALL">All branches</option>'+availableBranches.map(b=>`<option value="${esc(b.id)}">${esc(b.branch_name)} · ${esc(b.network||'')}</option>`).join('');
  branchSelect.value=availableBranches.some(b=>String(b.id)===String(previousBranch))?previousBranch:'ALL';
  const chosenBranch=branchSelect.value;
  const selected=financialAnalysisRows.filter(r=>{const b=branches.find(x=>String(x.id)===String(r.branch_id));return (network==='ALL'||String(b?.network||'').toUpperCase()===network)&&(chosenBranch==='ALL'||String(r.branch_id)===String(chosenBranch));});
  const ids=new Set(selected.map(r=>r.id));const lines=financialAnalysisLines.filter(l=>ids.has(l.report_id));
  const records=selected.map(r=>{const b=branches.find(x=>String(x.id)===String(r.branch_id));const t=financialTotals(r);const ll=lines.filter(l=>l.report_id===r.id);const shares=ll.filter(l=>l.mapped_category==='Profit distribution / share'||l.expense_behaviour==='Profit distribution').reduce((a,l)=>a+Number(l.amount||0),0);const nonOpOther=Math.max(0,t.nonExp-shares);const available=t.op+t.nonInc-nonOpOther;const retained=available-shares;let fixed=0,variable=0;ll.filter(l=>['Cost of Goods Sold','Operating Expense'].includes(l.section||'')&&!['Profit distribution','Not applicable'].includes(l.expense_behaviour)).forEach(l=>{const amount=Number(l.amount||0),v=Number(l.variable_component_pct??(l.expense_behaviour==='Variable'?100:l.expense_behaviour==='Fixed'?0:50));variable+=amount*v/100;fixed+=amount*(1-v/100);});const cmr=t.income?(t.income-variable)/t.income:0;return {...t,report:r,branch:b,shares,available,retained,fixed,variable,cmr,be:cmr>0?fixed/cmr:null};});
  const sum=k=>records.reduce((a,r)=>a+Number(r[k]||0),0);const income=sum('income'),gross=sum('gross'),opex=sum('opex'),op=sum('op'),shares=sum('shares'),available=sum('available'),retained=sum('retained'),fixed=sum('fixed'),variable=sum('variable');const cmr=income?records.reduce((a,r)=>a+(r.income-r.variable),0)/income:0;const be=cmr>0?fixed/cmr:null;const planned=Math.max(0,Number($('financialPlannedDistribution').value||0));const adjusted=cmr>0?(fixed+planned)/cmr:null;
  $('financialManagementKpis').innerHTML=[['Approved statements',records.length],['Operating income',money(income)],['Gross profit',money(gross)],['Operating profit',money(op)],['Profit distributed',money(shares)],['Retained after distribution',money(retained)]].map(([k,v])=>`<article><span>${k}</span><strong>${v}</strong></article>`).join('');
  const distributionLines=lines.filter(l=>l.mapped_category==='Profit distribution / share'||l.expense_behaviour==='Profit distribution');const distributionTotal=distributionLines.reduce((a,l)=>a+Number(l.amount||0),0);$('financialDistributionTotal').textContent=money(distributionTotal);const recipientTotals=new Map();distributionLines.forEach(l=>{const recipient=String(l.account_name||'Unspecified recipient');recipientTotals.set(recipient,(recipientTotals.get(recipient)||0)+Number(l.amount||0));});$('financialDistributionSummary').innerHTML=[...recipientTotals.entries()].sort((a,b)=>b[1]-a[1]).map(([recipient,amount])=>`<tr><td><strong>${esc(recipient)}</strong></td><td>${money(amount)}</td><td>${distributionTotal?(amount/distributionTotal*100).toFixed(2)+'%':'—'}</td></tr>`).join('')||'<tr><td colspan="3">No profit-share entries found in the selected approved reports. Check account mappings in the report review.</td></tr>';$('financialDistributionRows').innerHTML=distributionLines.map(l=>{const rr=records.find(r=>String(r.report.id)===String(l.report_id));const recipient=String(l.account_name||'Unspecified recipient');const month=String(rr?.report?.period_start||'').slice(0,7)||'Month not set';return `<tr><td>${esc(month)}</td><td><strong>${esc(recipient)}</strong></td><td>${esc(rr?.branch?.branch_name||rr?.report.location_label||'—')}</td><td>${esc(rr?.branch?.network||'—')}</td><td>${money(l.amount)}</td><td>${distributionTotal?(Number(l.amount||0)/distributionTotal*100).toFixed(2)+'%':'—'}</td></tr>`;}).join('')||'<tr><td colspan="6">No profit-share entries found in the selected approved reports. Check account mappings in the report review.</td></tr>';
  $('financialBreakEvenCards').innerHTML=[['Operating break-even',be===null?'—':money(be)],['Management-adjusted break-even',adjusted===null?'—':money(adjusted)],['Margin of safety',be===null?'—':money(income-be)],['Margin of safety %',be===null||!income?'—':`${((income-be)/income*100).toFixed(2)}%`],['Fixed expense portion',money(fixed)],['Variable expense portion',money(variable)],['Fixed expense ratio',income?`${(fixed/income*100).toFixed(2)}%`:'—'],['Variable expense ratio',income?`${(variable/income*100).toFixed(2)}%`:'—']].map(([k,v])=>`<div><span>${k}</span><strong>${v}</strong></div>`).join('');
  const nets=['UNOMED','NEETHI'].map(n=>{const a=records.filter(r=>String(r.branch?.network||'').toUpperCase()===n);return {n,income:a.reduce((s,r)=>s+r.income,0),gross:a.reduce((s,r)=>s+r.gross,0),op:a.reduce((s,r)=>s+r.op,0),shares:a.reduce((s,r)=>s+s.shares,0),count:a.length};});
  $('financialNetworkComparison').innerHTML=nets.map(n=>`<div class="financial-network-card"><h5>${n.n}</h5><strong>${money(n.income)}</strong><span>Operating income · ${n.count} approved statements</span><div>Gross profit <b>${money(n.gross)}</b></div><div>Operating profit <b>${money(n.op)}</b></div><div>Profit distributed <b>${money(n.shares)}</b></div></div>`).join('');
  const byBranch=new Map();records.forEach(r=>{const key=String(r.report.branch_id);if(!byBranch.has(key))byBranch.set(key,{branch:r.branch?.branch_name||r.report.location_label||'Branch',network:r.branch?.network||'—',income:0,gross:0,opex:0,op:0,shares:0,retained:0,count:0});const a=byBranch.get(key);['income','gross','opex','op','shares','retained'].forEach(k=>a[k]+=r[k]);a.count++;});
  const ranked=[...byBranch.values()].sort((a,b)=>b.op-a.op);$('financialProfitabilityRows').innerHTML=ranked.map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.branch)}</td><td>${esc(r.network)}</td><td>${money(r.income)}</td><td>${money(r.gross)}</td><td>${money(r.opex)}</td><td>${money(r.op)}</td><td>${r.income?(r.op/r.income*100).toFixed(2)+'%':'—'}</td><td>${money(r.shares)}</td><td>${money(r.retained)}</td></tr>`).join('')||'<tr><td colspan="10">No approved reports in this period.</td></tr>';
  const months=new Map();records.forEach(r=>{const m=String(r.report.period_start||'').slice(0,7);if(!months.has(m))months.set(m,{income:0,gross:0,opex:0,op:0,shares:0,retained:0});const a=months.get(m);['income','gross','opex','op','shares','retained'].forEach(k=>a[k]+=r[k]);});
  $('financialMonthlyRows').innerHTML=[...months.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([m,r])=>`<tr><td>${esc(m)}</td><td>${money(r.income)}</td><td>${money(r.gross)}</td><td>${money(r.opex)}</td><td>${money(r.op)}</td><td>${money(r.shares)}</td><td>${money(r.retained)}</td></tr>`).join('')||'<tr><td colspan="7">No approved monthly reports loaded.</td></tr>';
  $('financialManagementNote').textContent=`Showing ${records.length} approved branch-month statement(s). ${selected.length<financialAnalysisRows.length?'Branch/network filters applied. ':''}Profit share is excluded from operating expenses. Management-adjusted break-even includes only the optional planned distribution entered above. Multiple months are aggregated; use the monthly table for month-by-month and YTD review.`;
}
function exportFinancialAnalysisCsv(){
 const headers=['Branch','Network','Month','Operating income','Gross profit','Operating expenses','Operating profit','Operating margin %','Profit distributed','Profit available before distribution','Retained after distribution'];const rows=financialAnalysisRows.filter(r=>{const b=branches.find(x=>String(x.id)===String(r.branch_id));const network=$('financialAnalysisNetwork').value||'ALL',branch=$('financialAnalysisBranch').value||'ALL';return (network==='ALL'||String(b?.network||'').toUpperCase()===network)&&(branch==='ALL'||String(r.branch_id)===branch);}).map(r=>{const t=financialTotals(r),b=branches.find(x=>String(x.id)===String(r.branch_id)),ll=financialAnalysisLines.filter(l=>l.report_id===r.id),sh=ll.filter(l=>l.mapped_category==='Profit distribution / share'||l.expense_behaviour==='Profit distribution').reduce((a,l)=>a+Number(l.amount||0),0),available=t.op+t.nonInc-Math.max(0,t.nonExp-sh);return [b?.branch_name||r.location_label,b?.network,String(r.period_start||'').slice(0,7),t.income,t.gross,t.opex,t.op,t.income?t.op/t.income*100:0,sh,available,available-sh];});const csv=[headers,...rows].map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='UNOMED_NEETHI_Financial_Analysis.csv';a.click();URL.revokeObjectURL(url);
}
function financialAllowed(){return ['admin','management'].includes(String(profile?.role||'').toLowerCase());}
function normaliseAccount(s){return String(s||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function guessFinancialMapping(name,section){
  const n=normaliseAccount(name);
  if(/profit share|share distribution|partner share/.test(n)) return {category:'Profit distribution / share',behaviour:'Profit distribution',variablePct:0};
  if(/test out source|outsourc/.test(n)) return {category:'Outsourced tests / B2B',behaviour:'Variable',variablePct:100};
  if(/subcontract/.test(n)) return {category:'Subcontractor costs',behaviour:'Variable',variablePct:100};
  if(/cost of goods|reagent|consumable|testing material/.test(n)) return {category:'Direct laboratory costs',behaviour:'Variable',variablePct:100};
  if(/salary|salaries|wage|staff/.test(n)) return {category:'Employee costs',behaviour:'Semi-variable',variablePct:50};
  if(/rent/.test(n)) return {category:'Rent and premises',behaviour:'Fixed',variablePct:0};
  if(/ho expense|head office|corporate/.test(n)) return {category:'Head-office / shared overhead',behaviour:'Shared overhead',variablePct:50};
  if(/dr fee|doctor fee|professional fee/.test(n)) return {category:'Doctor / professional fees',behaviour:'Semi-variable',variablePct:50};
  if(/advertis|marketing|promotion/.test(n)) return {category:'Marketing and advertising',behaviour:'Semi-variable',variablePct:50};
  if(/office supplies|printing|stationery|admin/.test(n)) return {category:'Office and administration',behaviour:'Semi-variable',variablePct:50};
  if(/travel|conveyance/.test(n)) return {category:'Travel and conveyance',behaviour:'Variable',variablePct:100};
  if(/clean|haritha|electric|water|utility/.test(n)) return {category:'Utilities and housekeeping',behaviour:'Semi-variable',variablePct:50};
  if(section==='Operating Income') return {category:/discount/.test(n)?'Discounts and adjustments':'Operating income',behaviour:'Not applicable',variablePct:0};
  if(section==='Non Operating Income') return {category:'Non-operating income',behaviour:'Not applicable',variablePct:0};
  if(section==='Non Operating Expense') return {category:'Other non-operating expense',behaviour:'Not applicable',variablePct:0};
  return {category:'Unmapped / review required',behaviour:'Semi-variable',variablePct:50};
}
function financialMessage(text,ok=false){const el=$('financialUploadMsg');if(el){el.textContent=text;el.style.color=ok?'#16764a':'#a21d37';}}
async function extractZohoPdf(file){
  const pdfjs=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  const bytes=new Uint8Array(await file.arrayBuffer()); const pdf=await pdfjs.getDocument({data:bytes}).promise;
  const lines=[];
  for(let pageNo=1;pageNo<=pdf.numPages;pageNo++){
    const page=await pdf.getPage(pageNo); const content=await page.getTextContent(); const grouped=new Map();
    for(const item of content.items){if(!item.str?.trim())continue;const y=Math.round(item.transform?.[5]||0);let key=[...grouped.keys()].find(k=>Math.abs(k-y)<=2);if(key===undefined){key=y;grouped.set(key,[]);}grouped.get(key).push({x:item.transform?.[4]||0,text:item.str.trim()});}
    [...grouped.entries()].sort((a,b)=>b[0]-a[0]).forEach(([y,items])=>lines.push({page:pageNo,text:items.sort((a,b)=>a.x-b.x).map(x=>x.text).join(' ').replace(/\s+/g,' ').trim()}));
  }
  const all=lines.map(x=>x.text); const periodText=all.find(x=>/From\s+\d{2}\/\d{2}\/\d{4}\s+To\s+\d{2}\/\d{2}\/\d{4}/i.test(x))||'';
  const periodMatch=periodText.match(/From\s+(\d{2})\/(\d{2})\/(\d{4})\s+To\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  const locationLine=all.find(x=>/^Location\s*:/i.test(x))||'';
  const amountRe=/\(?-?\s*\d[\d,]*\.\d{2}\)?\s*$/;
  let section='', accounts=[]; const totals={};
  const sectionNames=['Operating Income','Cost of Goods Sold','Operating Expense','Non Operating Income','Non Operating Expense','Other Comprehensive Income'];
  for(const raw of all){
    const line=raw.replace(/\s+/g,' ').trim(); if(!line)continue;
    const sec=sectionNames.find(s=>line.toLowerCase()===s.toLowerCase()); if(sec){section=sec;continue;}
    const totalMatch=line.match(/^(Total for (Operating Income|Cost of Goods Sold|Operating Expense|Non Operating Income|Non Operating Expense|Other Comprehensive Income)|Gross Profit|Operating Profit|Net Profit\/Loss)\s+([\d,.-]+\.\d{2})$/i);
    if(totalMatch){const label=totalMatch[1];totals[label]=parseFinancialAmount(totalMatch[3]);continue;}
    if(!amountRe.test(line))continue;
    const match=line.match(/(\(?-?\s*\d[\d,]*\.\d{2}\)?)\s*$/); if(!match)continue;
    let account=line.slice(0,match.index).trim(); account=account.replace(/^\d+\s+/,'').trim();
    if(!account || /^(account|sales|discount|total|gross profit|operating profit|net profit|amount|date|location)$/i.test(account))continue;
    if(/^(UNOMED MEDICAL|Profit and Loss|Basis:|From |Location:|Account Code)/i.test(account))continue;
    const amount=parseFinancialAmount(match[1]);
    if(section && !/^Other Comprehensive Income$/.test(section)) accounts.push({account_name:account,amount,section});
  }
  // Remove repeated PDF text-layer entries while preserving separate accounts with different values.
  const unique=new Map();accounts.forEach(a=>unique.set([normaliseAccount(a.account_name),a.amount,a.section].join('|'),a));
  return {accounts:[...unique.values()],totals,periodStart:periodMatch?`${periodMatch[3]}-${periodMatch[2]}-${periodMatch[1]}`:null,periodEnd:periodMatch?`${periodMatch[6]}-${periodMatch[5]}-${periodMatch[4]}`:null,location:locationLine.replace(/^Location\s*:\s*/i,''),pageCount:pdf.numPages};
}
function parseFinancialAmount(v){let s=String(v||'').replace(/[₹,\s()]/g,'');let n=Number(s);if(String(v).includes('('))n=-Math.abs(n);return Number.isFinite(n)?n:0;}
async function uploadFinancialPdf(){
  if(!financialAllowed()){financialMessage('Only Admin and Management users can upload financial statements.');return;}
  const branchId=$('financialBranch').value, month=$('financialPeriod').value, file=$('financialPdf').files?.[0];
  if(!branchId||!month||!file){financialMessage('Select a branch, financial month and PDF file.');return;}
  if(file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf')){financialMessage('Please upload a PDF file.');return;}
  if(file.size>15*1024*1024){financialMessage('PDF size must be 15 MB or less.');return;}
  $('financialUploadBtn').disabled=true;financialMessage('Reading PDF and extracting Zoho account lines…');
  try{
    const extracted=await extractZohoPdf(file);if(!extracted.accounts.length)throw new Error('No account rows were detected. Please verify that this is a text-readable Zoho Books P&L PDF.');
    const [yy,mm]=month.split('-').map(Number);const start=`${yy}-${String(mm).padStart(2,'0')}-01`;const end=`${yy}-${String(mm).padStart(2,'0')}-${String(new Date(yy,mm,0).getDate()).padStart(2,'0')}`;
    if(extracted.periodStart&&extracted.periodStart!==start)throw new Error(`PDF period starts ${extracted.periodStart}, but selected month is ${month}. Please select the matching month.`);
    const branch=branches.find(b=>String(b.id)===String(branchId));const path=`${branchId}/${month}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
    const {error:uploadError}=await db.storage.from('financial-pnl').upload(path,file,{contentType:'application/pdf',upsert:false});if(uploadError)throw uploadError;
    const reportPayload={branch_id:branchId,period_start:extracted.periodStart||start,period_end:extracted.periodEnd||end,source_filename:file.name,storage_path:path,status:'review',uploaded_by:user.id,location_label:extracted.location||branch?.branch_name||'',extracted_totals:extracted.totals,extracted_page_count:extracted.pageCount};
    const {data:report,error:reportError}=await db.from('financial_reports').insert(reportPayload).select('*').single();if(reportError)throw reportError;
    const {data:savedMappings,error:mappingError}=await db.from('financial_account_mappings').select('account_name_normalized,category,expense_behaviour').eq('is_active',true);if(mappingError)throw mappingError;
    const mappingMap=new Map((savedMappings||[]).map(m=>[m.account_name_normalized,m]));
    const rows=extracted.accounts.map(a=>{const saved=mappingMap.get(normaliseAccount(a.account_name));const guess=saved?{category:saved.category,behaviour:saved.expense_behaviour,variablePct:Number(saved.variable_component_pct??50)}:guessFinancialMapping(a.account_name,a.section);return {report_id:report.id,account_name:a.account_name,amount:a.amount,section:a.section,mapped_category:guess.category,expense_behaviour:guess.behaviour,variable_component_pct:guess.variablePct??50,mapping_status:saved?'reviewed':guess.category==='Unmapped / review required'?'needs_review':'suggested'};});
    const {error:lineError}=await db.from('financial_report_lines').insert(rows);if(lineError)throw lineError;
    $('financialPdf').value='';financialMessage(`Extracted ${rows.length} account lines from ${extracted.pageCount} PDF page(s) for ${branch?.branch_name||'selected branch'}. Please review the mappings and totals.`,true);await loadFinancialReports();await openFinancialReview(report.id);
  }catch(err){financialMessage(`Upload/extraction failed: ${err.message||err}. If the PDF was uploaded before the error, check the report register before retrying.`);}
  finally{$('financialUploadBtn').disabled=false;}
}
async function loadFinancialReports(){
  if(!financialAllowed()||!db)return;
  $('financialReportRows').innerHTML='<tr><td colspan="9">Loading financial reports…</td></tr>';
  try{
    let q=db.from('financial_reports').select('*').order('period_start',{ascending:false}).order('created_at',{ascending:false}).limit(250);
    const status=$('financialStatusFilter').value;if(status!=='ALL')q=q.eq('status',status);
    const {data,error}=await q;if(error)throw error;const rows=data||[];const branchMap=new Map(branches.map(b=>[String(b.id),b]));
    $('financialReportRows').innerHTML=rows.map(r=>{const b=branchMap.get(String(r.branch_id));const t=r.extracted_totals||{};return `<tr><td>${esc(String(r.period_start||'').slice(0,7))}</td><td>${esc(b?.branch_name||r.location_label||'Branch')}</td><td>${esc(b?.network||'—')}</td><td>${money(t['Total for Operating Income']||0)}</td><td>${money(t['Gross Profit']||0)}</td><td>${money(t['Operating Profit']||0)}</td><td>${money(t['Net Profit/Loss']||0)}</td><td><span class="financial-status ${esc(r.status)}">${esc(r.status)}</span></td><td><button type="button" class="secondary" data-financial-review="${esc(r.id)}">${r.status==='approved'?'View':'Review'}</button></td></tr>`;}).join('')||'<tr><td colspan="9">No financial statements uploaded yet.</td></tr>';
    const approved=rows.filter(r=>r.status==='approved').length;const pending=rows.filter(r=>r.status==='review').length;
    $('financialKpis').innerHTML=`<article><span>Reports loaded</span><strong>${rows.length}</strong></article><article><span>Awaiting review</span><strong>${pending}</strong></article><article><span>Approved</span><strong>${approved}</strong></article><article><span>Branches covered</span><strong>${new Set(rows.map(r=>r.branch_id)).size}</strong></article>`;
  }catch(err){$('financialReportRows').innerHTML=`<tr><td colspan="9">Could not load reports: ${esc(err.message||err)}. Run the Financial Intelligence SQL setup first.</td></tr>`;}
}
async function openFinancialReview(reportId){
  if(!financialAllowed())return;
  try{
    const {data:report,error}=await db.from('financial_reports').select('*').eq('id',reportId).single();if(error)throw error;
    const {data:lines,error:lineError}=await db.from('financial_report_lines').select('*').eq('report_id',reportId).order('created_at');if(lineError)throw lineError;
    activeFinancialReport=report;activeFinancialLines=lines||[];const branch=branches.find(b=>String(b.id)===String(report.branch_id));
    $('financialReviewTitle').textContent=`${branch?.branch_name||'Branch'} — ${String(report.period_start).slice(0,7)} P&L`;$('financialReviewMeta').textContent=`${report.source_filename} · ${report.status.toUpperCase()} · ${activeFinancialLines.length} account lines`;
    $('financialLineRows').innerHTML=activeFinancialLines.map((l,i)=>`<tr data-financial-line="${esc(l.id)}"><td><strong>${esc(l.account_name)}</strong></td><td>${money(l.amount)}</td><td>${esc(l.section||'—')}</td><td><select data-financial-category>${FINANCIAL_CATEGORIES.map(c=>`<option ${c===l.mapped_category?'selected':''}>${esc(c)}</option>`).join('')}</select></td><td><select data-financial-behaviour>${FINANCIAL_BEHAVIOURS.map(c=>`<option ${c===l.expense_behaviour?'selected':''}>${esc(c)}</option>`).join('')}</select></td><td><input type="number" min="0" max="100" step="1" data-financial-variable-share value="${Number(l.variable_component_pct??50)}" style="width:90px"></td></tr>`).join('');
    renderFinancialReviewSummary(report,activeFinancialLines);$('financialReviewPanel').classList.remove('hidden');$('financialReviewMsg').textContent=report.status==='approved'?'This report is approved. Changes require a new review version.':'Review the suggested mappings and expense behaviour before approval.';
    $('financialApprove').disabled=report.status==='approved';$('financialSaveMapping').disabled=report.status==='approved';
  }catch(err){financialMessage('Could not open financial report: '+(err.message||err));}
}
function renderFinancialReviewSummary(report,lines){
  const t=report.extracted_totals||{};const income=Number(t['Total for Operating Income']||0),cogs=Number(t['Total for Cost of Goods Sold']||0),gross=Number(t['Gross Profit']??income-cogs),opex=Number(t['Total for Operating Expense']||0),op=Number(t['Operating Profit']??gross-opex),nonInc=Number(t['Total for Non Operating Income']||0),nonExp=Number(t['Total for Non Operating Expense']||0),net=Number(t['Net Profit/Loss']??op+nonInc-nonExp);
  const pct=n=>income?`${(n/income*100).toFixed(2)}%`:'—';
  $('financialSummaryCards').innerHTML=[['Operating income',income],['Gross profit',gross],['Operating expenses',opex],['Operating profit',op],['Net profit / loss',net]].map(([k,v])=>`<article><span>${k}</span><strong>${money(v)}</strong><small>${pct(v)} of operating income</small></article>`).join('');
  const costLines=lines.filter(l=>['Cost of Goods Sold','Operating Expense'].includes(l.section||'')&&!['Profit distribution','Not applicable'].includes(l.expense_behaviour));
  const variable=costLines.reduce((s,l)=>s+Number(l.amount||0)*Number(l.variable_component_pct??50)/100,0);
  const fixed=costLines.reduce((s,l)=>s+Number(l.amount||0)*(1-Number(l.variable_component_pct??50)/100),0);
  const contribution=income-variable,cmr=income?contribution/income:0,breakeven=cmr>0?fixed/cmr:null;
  const unclassified=lines.filter(l=>l.mapped_category==='Unmapped / review required').length;
  const shareLines=lines.filter(l=>l.mapped_category==='Profit distribution / share'||l.expense_behaviour==='Profit distribution');
  const shareTotal=shareLines.reduce((sum,l)=>sum+Number(l.amount||0),0);
  const otherNonOperatingExpenses=Math.max(0,nonExp-shareTotal);
  const profitAvailable=op+nonInc-otherNonOperatingExpenses;
  const retainedAfterShares=profitAvailable-shareTotal;
  const shareRows=shareLines.length?shareLines.map(l=>`<div class="financial-share-row"><span>${esc(l.account_name)}</span><strong>${money(l.amount)}</strong><small>${shareTotal?((Number(l.amount||0)/shareTotal)*100).toFixed(2):'0.00'}% of total distribution</small></div>`).join(''):'<p class="financial-share-empty">No profit-share accounts have been mapped yet. Map the relevant Zoho account lines as “Profit distribution / share” to highlight them here.</p>';
  $('financialAnalysis').innerHTML=`<h3>Preliminary management analysis</h3><div class="financial-analysis-grid"><div><span>Gross margin</span><strong>${pct(gross)}</strong></div><div><span>Operating margin</span><strong>${pct(op)}</strong></div><div><span>Net margin</span><strong>${pct(net)}</strong></div><div><span>Classified fixed-cost portion</span><strong>${money(fixed)}</strong></div><div><span>Classified variable-cost portion</span><strong>${money(variable)}</strong></div><div><span>Contribution margin ratio</span><strong>${(cmr*100).toFixed(2)}%</strong></div><div><span>Indicative break-even sales</span><strong>${breakeven===null?'Awaiting classification':money(breakeven)}</strong></div><div><span>Margin of safety</span><strong>${breakeven===null?'—':money(income-breakeven)}</strong></div></div><section class="financial-share-highlight"><div class="financial-share-heading"><div><span class="financial-share-eyebrow">MANAGEMENT ATTENTION</span><h4>Profit share &amp; distribution</h4><p>Shown separately after operating profit — not treated as operating expenses.</p></div><strong class="financial-share-total">${money(shareTotal)}</strong></div><div class="financial-share-grid">${shareRows}</div><div class="financial-share-footer"><div><span>Profit available before distribution</span><strong>${money(profitAvailable)}</strong></div><div><span>Retained after distribution</span><strong>${money(retainedAfterShares)}</strong></div></div></section><p class="financial-caution">Semi-variable and shared-overhead accounts use the editable variable-share percentage (default 50%) to split costs. Validate these percentages and HO allocations with management before relying on break-even. ${unclassified?unclassified+' account(s) remain unmapped. ':''}Profit distributions are shown separately and excluded from operating costs.</p>`;
}
function updateFinancialLinePreview(){if(activeFinancialReport){const lines=[...document.querySelectorAll('#financialLineRows tr')].map((tr,i)=>({...activeFinancialLines[i],mapped_category:tr.querySelector('[data-financial-category]')?.value,expense_behaviour:tr.querySelector('[data-financial-behaviour]')?.value,variable_component_pct:Math.min(100,Math.max(0,Number(tr.querySelector('[data-financial-variable-share]')?.value||0)))}));renderFinancialReviewSummary(activeFinancialReport,lines);}}
async function saveFinancialMappings(){
  if(!activeFinancialReport||activeFinancialReport.status==='approved')return;
  try{
    const rows=[...document.querySelectorAll('#financialLineRows tr')].map(tr=>({id:tr.dataset.financialLine,category:tr.querySelector('[data-financial-category]').value,behaviour:tr.querySelector('[data-financial-behaviour]').value}));
    for(const r of rows){const line=activeFinancialLines.find(x=>x.id===r.id);const {error}=await db.from('financial_report_lines').update({mapped_category:r.category,expense_behaviour:r.behaviour,variable_component_pct:r.variable_component_pct,mapping_status:r.category==='Unmapped / review required'?'needs_review':'reviewed',reviewed_by:user.id}).eq('id',r.id);if(error)throw error;
      const normalized=normaliseAccount(line.account_name);const existing=await db.from('financial_account_mappings').select('id').eq('account_name_normalized',normalized).maybeSingle();if(existing.error)throw existing.error;
      const mapping={account_name:line.account_name,account_name_normalized:normalized,category:r.category,expense_behaviour:r.behaviour,variable_component_pct:r.variable_component_pct,updated_by:user.id};const saved=existing.data?await db.from('financial_account_mappings').update(mapping).eq('id',existing.data.id):await db.from('financial_account_mappings').insert({...mapping,created_by:user.id});if(saved.error)throw saved.error;
    }
    const {data:lines,error}=await db.from('financial_report_lines').select('*').eq('report_id',activeFinancialReport.id);if(error)throw error;activeFinancialLines=lines||[];renderFinancialReviewSummary(activeFinancialReport,activeFinancialLines);$('financialReviewMsg').textContent='Mappings saved. These account-name rules can be reused for future branch uploads.';
  }catch(err){$('financialReviewMsg').textContent='Could not save mappings: '+(err.message||err);}
}
async function approveFinancialReport(){
  if(!activeFinancialReport||!financialAllowed()||activeFinancialReport.status==='approved')return;
  if(!confirm('Approve this branch financial statement? Approved reports will be locked for editing.'))return;
  try{
    const {data:lines,error:lineError}=await db.from('financial_report_lines').select('mapped_category,expense_behaviour').eq('report_id',activeFinancialReport.id);if(lineError)throw lineError;
    if((lines||[]).some(l=>l.mapped_category==='Unmapped / review required'))throw new Error('Please map all accounts before approval.');
    const {error}=await db.from('financial_reports').update({status:'approved',approved_by:user.id,approved_at:new Date().toISOString()}).eq('id',activeFinancialReport.id).eq('status','review');if(error)throw error;
    $('financialReviewMsg').textContent='Financial report approved.';await loadFinancialReports();await openFinancialReview(activeFinancialReport.id);
  }catch(err){$('financialReviewMsg').textContent='Approval failed: '+(err.message||err);}
}
