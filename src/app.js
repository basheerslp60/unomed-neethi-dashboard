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
// Capture the review click before other handlers can swallow it.
// This also survives later UI re-renders of the sales-entry form.
document.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target.closest('#reviewSalesSubmit') : null;
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  handleSalesReview(event);
}, true);

// Keep keyboard/Enter submission routed through the same review step.
$('salesForm')?.addEventListener('submit', handleSalesReview);

// Keep the confirmation modal attached to body so parent containers cannot
// clip it or interfere with its visibility.
const salesModalElement = $('salesConfirmModal');
if (salesModalElement && salesModalElement.parentElement !== document.body) {
  document.body.appendChild(salesModalElement);
}
if (salesModalElement) {
  salesModalElement.classList.add('hidden');
  salesModalElement.setAttribute('aria-hidden', 'true');
}

const names = ["Complete HC 599","My Health 999","Cardiac HC","EHC 2500","EHC Advanced 3500","Healthy Women 699","Healthy Men","EHC PRO 8499","Hairfall","Vitamin Profile","PCOD Mini","Onam Camp","Other Packages"];
let db, user, profile, branches = [], reports = [], targets = [];
let complianceRowsCache = [], complianceNetworkFilter = 'ALL', complianceChecked = false;
let employeeTaskAlerts = [];
let editingReportId = null;
let overviewReports = [];
let overviewPreviousReports = [];
let overviewPeriod = '7';
let overviewChartVisible = { group:true, unomed:true, neethi:true };
let overviewNetwork = 'ALL';
let overviewBranchesExpanded = false;
let broadcastItemsCache = [], broadcastActiveIndex = 0, broadcastTimer = null, broadcastUploadBusy = false;
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
    $('broadcastOverview'),
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
  if (window.matchMedia('(max-width: 760px)').matches) { layout.classList.remove('sidebar-open'); $('mobileNavToggle')?.setAttribute('aria-expanded','false'); const icon=$('mobileNavToggle')?.querySelector('.mobile-nav-trigger-icon'); if(icon) icon.textContent='☰'; }
}
document.querySelectorAll('.nav-button[data-target]').forEach(button => {
  button.addEventListener('click', () => {
    const target = $(button.dataset.target);
    if (!target || button.classList.contains('nav-hidden')) return;
    setPortalView(button.dataset.target);
    if (button.dataset.target === 'inventorySection') void loadInventoryModule();
    if (button.dataset.target === 'b2bSection') void loadB2BModule();
    if (button.dataset.target === 'broadcastStudioSection') void loadBroadcastStudio();
    if (button.dataset.target === 'complaintSection') void loadComplaints();
  });
});
function setMobileNavigation(open) {
  const layout = document.querySelector('.app-layout');
  const trigger = $('mobileNavToggle');
  if (!layout) return;
  layout.classList.toggle('sidebar-open', Boolean(open));
  trigger?.setAttribute('aria-expanded', String(Boolean(open)));
  trigger?.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
  const icon = trigger?.querySelector('.mobile-nav-trigger-icon');
  if (icon) icon.textContent = open ? '✕' : '☰';
}
$('sidebarToggle')?.addEventListener('click', () => {
  const layout = document.querySelector('.app-layout');
  if (window.matchMedia('(max-width: 760px)').matches) {
    setMobileNavigation(!layout.classList.contains('sidebar-open'));
  } else {
    layout.classList.toggle('sidebar-collapsed');
  }
});
$('mobileNavToggle')?.addEventListener('click', () => {
  const layout = document.querySelector('.app-layout');
  setMobileNavigation(!layout?.classList.contains('sidebar-open'));
});
$('mobileNavBackdrop')?.addEventListener('click', () => setMobileNavigation(false));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') setMobileNavigation(false);
});
document.querySelector('.nav-button[data-target="overviewTop"]')?.addEventListener('click',()=>{setTimeout(()=>void loadBroadcastDisplay(),100);});
initPortalCommandBar();
initBroadcastModule();
window.setInterval(()=>{if(user)void loadBroadcastDisplay();},60000);
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
  $('inventoryRefresh')?.addEventListener('click', loadInventoryModule);
  $('inventorySubmitClosing')?.addEventListener('click', submitInventoryClosing);
  $('inventorySubmitTestCounts')?.addEventListener('click', submitInventoryTestCounts);
  $('inventoryAsOfDate')?.addEventListener('change',()=>loadInventoryModule());
  $('inventoryItemForm')?.addEventListener('submit', saveInventoryItem);
  $('inventoryItemRows')?.addEventListener('click', handleInventoryItemAction);
  $('inventoryAddItemToggle')?.addEventListener('click', () => { const form=$('inventoryItemForm'); if(!form)return; form.classList.toggle('hidden'); if(!form.classList.contains('hidden')) $('inventoryItemName')?.focus(); });
  $('inventoryItemSearch')?.addEventListener('input', () => { inventoryItemPage=0; renderInventoryItemMaster(); });
  $('inventoryItemCategoryFilter')?.addEventListener('change', () => { inventoryItemPage=0; renderInventoryItemMaster(); });
  $('inventoryItemPageSize')?.addEventListener('change', () => { inventoryItemPage=0; renderInventoryItemMaster(); });
  $('inventoryItemPrev')?.addEventListener('click', () => { inventoryItemPage=Math.max(0,inventoryItemPage-1); renderInventoryItemMaster(); });
  $('inventoryItemNext')?.addEventListener('click', () => { inventoryItemPage+=1; renderInventoryItemMaster(); });
  $('inventoryItemCancel')?.addEventListener('click', resetInventoryItemForm);
  $('inventoryAssignmentForm')?.addEventListener('submit', saveInventoryAssignment);
  $('inventoryPurchaseForm')?.addEventListener('submit', submitInventoryPurchase);
  $('inventoryMovementForm')?.addEventListener('submit', saveInventoryMovement);
  $('inventoryPurchaseRows')?.addEventListener('click', handleInventoryRequestAction);
  $('inventoryBranchFilter')?.addEventListener('change', () => { inventoryAssignmentPage=0; renderInventoryManagement(); });
  $('inventoryAssignmentSearch')?.addEventListener('input', () => { inventoryAssignmentPage=0; renderInventoryManagement(); });
  $('inventoryAssignmentPageSize')?.addEventListener('change', () => { inventoryAssignmentPage=0; renderInventoryManagement(); });
  $('inventoryAssignmentPrev')?.addEventListener('click', () => { inventoryAssignmentPage=Math.max(0,inventoryAssignmentPage-1); renderInventoryManagement(); });
  $('inventoryAssignmentNext')?.addEventListener('click', () => { inventoryAssignmentPage+=1; renderInventoryManagement(); });
  $('inventoryTestCountRows')?.addEventListener('input', event => { const input=event.target.closest('[data-inventory-test-count]'); if(!input)return; const test=inventoryTestsCache.find(t=>String(t.id)===String(input.dataset.testId)); const mappings=inventoryTestMappingsCache.filter(m=>String(m.branch_id)===String(profile?.branch_id)&&String(m.test_id)===String(input.dataset.testId)&&m.active); const used=mappings.map(m=>{const a=inventoryAssignmentsCache.find(x=>String(x.branch_id)===String(profile?.branch_id)&&String(x.item_id)===String(m.item_id));const latest=a?inventoryLatestByAssignment().get(String(a.id)):null;const stock=a?inventoryCurrentQty(a,latest):0;return Math.floor(Math.max(0,stock)/Number(m.quantity_per_test||1));}); const cap=used.length?Math.min(...used):null; const out=document.querySelector(`[data-test-capacity="${input.dataset.testId}"]`); if(out&&cap!==null){out.textContent=`Remaining capacity: ${cap.toLocaleString('en-IN')} tests`;out.className=`inventory-test-capacity ${cap<=5?'critical':cap<=20?'low':''}`;} });
  $('inventoryTestMappingForm')?.addEventListener('submit', saveInventoryTestMapping);
  $('inventoryTestMappingRows')?.addEventListener('click', handleInventoryTestMappingAction);
  $('inventoryMapAddReagent')?.addEventListener('click',()=>addInventoryMapReagentRow());
  $('inventoryMapReagentRows')?.addEventListener('click',event=>{const remove=event.target.closest('[data-map-reagent-remove]');if(remove){const rows=$('inventoryMapReagentRows');if(rows.children.length>1)remove.closest('.inventory-map-reagent-row').remove();else inventorySetMessage('At least one reagent row is required.');}});
  $('inventoryMapReagentRows')?.addEventListener('change',event=>{const select=event.target.closest('[data-map-reagent-item]');if(!select)return;const item=inventoryItemsCache.find(i=>String(i.id)===select.value);const unit=select.closest('.inventory-map-reagent-row')?.querySelector('[data-map-reagent-unit]');if(unit)unit.value=item?inventoryUnitLabel(item.unit):'';});
  $('inventoryRequestItem')?.addEventListener('change', () => { const a=inventoryAssignmentsCache.find(x=>String(x.item_id)===$('inventoryRequestItem').value); const unit=a?.inventory_items?.unit||inventoryItemsCache.find(i=>String(i.id)===$('inventoryRequestItem').value)?.unit; $('inventoryRequestQty').step=['nos','tests'].includes(String(unit).toLowerCase())?'1':'0.001'; });
  $('inventoryMovementItem')?.addEventListener('change', () => { const item=inventoryItemsCache.find(i=>String(i.id)===$('inventoryMovementItem').value); $('inventoryMovementQty').step=['nos','tests'].includes(String(item?.unit).toLowerCase())?'1':'0.001'; });
  $('inventoryAsOfDate') && ($('inventoryAsOfDate').value = today);
  $('inventoryMovementDate') && ($('inventoryMovementDate').value = today);

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
    const branchExpand=event.target.closest('[data-overview-branch-expand]');
    const action=event.target.closest('[data-overview-target]');
    const series=event.target.closest('[data-overview-series]');
    if(period){overviewPeriod=period.dataset.overviewPeriod;$('overviewDashboard').querySelectorAll('[data-overview-period]').forEach(b=>b.classList.toggle('active',b===period));renderOverview();}
    if(network){overviewNetwork=network.dataset.overviewNetwork;$('overviewDashboard').querySelectorAll('[data-overview-network]').forEach(b=>b.classList.toggle('active',b===network));renderOverview();}
    if(branchExpand){overviewBranchesExpanded=!overviewBranchesExpanded;renderOverview();}
    if(series){const key=series.dataset.overviewSeries;overviewChartVisible[key]=!overviewChartVisible[key];renderOverview();}
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
  $('complaintRefresh')?.addEventListener('click', loadComplaints);
  $('complaintCreateForm')?.addEventListener('submit', createComplaint);
  $('complaintStatusFilter')?.addEventListener('change', renderComplaints);
  $('complaintBranchFilter')?.addEventListener('change', renderComplaints);
  $('complaintRows')?.addEventListener('click', handleComplaintAction);
  $('complaintActionBody')?.addEventListener('click', handleComplaintAction);
  $('complaintActionBody')?.addEventListener('submit', handleComplaintAction);

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
document.querySelectorAll('.nav-button').forEach(button => {
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
    document.querySelectorAll('.nav-button').forEach(btn => {
      btn.classList.remove('active');
    });
    button.classList.add('active');

    // Return to the top of the page
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});
  $('employeeForm').onsubmit = addEmployee;
  $('employeeRows')?.addEventListener('click', handleEmployeeDirectoryAction);
  $('employeeCancelEdit')?.addEventListener('click',()=>{employeeEditingId=null;$('employeeForm').reset();$('employeeFormTitle').textContent='Add employee';$('employeeSubmitButton').textContent='Add employee';$('employeeCancelEdit').classList.add('hidden');});
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
  console.info('[Portal login] Checking profile for authenticated user:', u.id);
  const {data:p,error} = await db.from('profiles')
    .select('user_id,full_name,role,branch_id,active')
    .eq('user_id',u.id)
    .maybeSingle();

  if (error) {
    console.error('[Portal login] Profile query failed:', {
      authUserId: u.id,
      code: error.code || null,
      message: error.message || null,
      details: error.details || null,
      hint: error.hint || null
    });
    msg('loginMsg', `Unable to read your portal profile: ${error.message || 'Unknown Supabase error'}${error.code ? ` (code: ${error.code})` : ''}. Check browser console for details.`);
    return;
  }
  if (!p) {
    console.error('[Portal login] No profile row returned for authenticated user:', u.id);
    msg('loginMsg', `No profile row was returned for this login (auth UID: ${u.id}). Ask Admin to verify that profiles.user_id matches this Auth user.`);
    return;
  }
  if (p.active !== true) {
    console.warn('[Portal login] Profile exists but is inactive:', { authUserId: u.id, profile: p });
    msg('loginMsg', 'Your portal profile is inactive. Ask Admin to activate it.');
    return;
  }
  if (!p.role) {
    console.error('[Portal login] Active profile has no role:', { authUserId: u.id, profile: p });
    msg('loginMsg', 'Your portal profile has no role assigned. Ask Admin to update it.');
    return;
  }
  console.info('[Portal login] Profile loaded:', {
    authUserId: u.id,
    profileUserId: p.user_id,
    role: p.role,
    branchId: p.branch_id,
    active: p.active
  });
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
  // Load the same group Top 5 for management and branch-staff views.
  // The RPC returns only the permitted leaderboard fields plus the caller's rank metadata.
  void loadTop5BranchLeaderboard();
  if (p.role === 'admin') {
  $('portalBranch').innerHTML = branches.map(b => '<option value="' + b.id + '">' + esc(b.network) + ' - ' + esc(b.branch_name) + '</option>').join('');
    updatePortalBranchVisibility();
  }
  show('login',false); show('app',true); show('userTools',true); setPortalView('overviewTop'); show('entry',p.role==='branch_staff');
  if(p.role==='employee'){ document.querySelectorAll('.nav-button').forEach(btn=>{const target=btn.dataset.target;btn.classList.toggle('hidden',!['employeeSection','complaintSection'].includes(target));}); document.querySelectorAll('main > section.card').forEach(sec=>{if(!['employeeSection','complaintSection'].includes(sec.id))sec.classList.add('hidden');}); show('employeeSection',true); show('complaintSection',true); }
  show('correctionBranchWrap',p.role!=='branch_staff');
  if(p.role==='branch_staff') $('correctionBranch').innerHTML='';
  else $('correctionBranch').innerHTML='<option value=>All permitted branches</option>'+branches.map(b=>`<option value="${esc(b.id)}">${esc(b.network)} - ${esc(b.branch_name)}</option>`).join('');
  show('managementReportSection',p.role!=='branch_staff');
  show('branchAnalyticsSection',p.role!=='branch_staff');
  show('targetDashboardSection',p.role!=='branch_staff');
  show('managementExecutiveSection',p.role!=='branch_staff');
  const canManageBroadcast = ['admin','management'].includes(String(p.role||'').toLowerCase());
  document.querySelector('.broadcast-nav')?.classList.toggle('hidden',!canManageBroadcast);
  if (canManageBroadcast) populateBroadcastBranchOptions();
  void loadBroadcastDisplay();
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
  show('inventorySection', true);
  await loadInventoryModule();
  show('b2bSection', true);
  await loadB2BModule();
  $('title').textContent = p.role === 'branch_staff' ? (branches.find(x => x.id === p.branch_id)?.branch_name || 'Branch') + ' daily entry' : 'Management consolidated report';
  $('subtitle').textContent=p.role==='branch_staff'?'Submit sales for your assigned branch':'Targets and sales totals from reports permitted for your account';
  await loadReports();
  $('correctionDate').value='';
  await loadCorrectionReports();
  refreshSidebarVisibility();
  if (p.role === 'admin') await loadPortalUsers();
  await loadEmployeeModule();
  // Make the Complaints section visible for every authenticated portal role.
  // It was previously left hidden, which also hid its sidebar navigation item.
  show('complaintSection', true);
  refreshSidebarVisibility();
  void loadComplaints();
  if (p.role !== 'branch_staff') { await loadBranchAnalytics(); await loadTargetDashboard(); await loadManagementExecutiveDashboard(); }
}



// ---------------- B2B Sample Processing & Billing ----------------
const b2bCentres=[1,2,3];
const b2bCentreName=id=>({1:'UNOMED Kannur',2:'UNOMED Payyanur',3:'UNOMED Cherupuzha'}[Number(id)]||'Processing centre');
const b2bMoney=v=>'₹'+Number(v||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
let b2bTestsCache=[],b2bRequestsCache=[],b2bRequestTestsCache=[],b2bInvoicesCache=[],b2bPriceCache=[],b2bSelectedTestIds=[],b2bStatusFilter='all',b2bSearchTerm='',b2bRegisterBranchFilter='all',b2bRegisterTestFilter='all',b2bRegisterDateFrom='',b2bRegisterDateTo='',b2bRequestPage=1,b2bRequestPageSize=10,b2bPriceSearchTerm='',b2bPriceCentreFilter='all',b2bPricePage=1,b2bPricePageSize=10;
function b2bMsg(id,text,ok=false){const el=$(id);if(el){el.textContent=text||'';el.style.color=ok?'#087b62':'#b4233d';}}
function b2bLocalDate(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
function b2bInitRequestDate(){const el=$('b2bRequestDate');if(el){const today=b2bLocalDate();el.max=today;if(!el.value)el.value=today;}}
function b2bFillTests(){const html='<option value="">Select test</option>'+b2bTestsCache.map(t=>`<option value="${t.id}">${esc(t.test_name)}</option>`).join('');['b2bTests','b2bPriceTest'].forEach(id=>{const el=$(id);if(el){const old=el.value;el.innerHTML=html;if(b2bTestsCache.some(t=>String(t.id)===old))el.value=old;}});b2bRenderSelectedTests();}
function b2bRenderSelectedTests(){const host=$('b2bSelectedTests');if(!host)return;const chosen=b2bSelectedTestIds.map(id=>b2bTestsCache.find(t=>Number(t.id)===Number(id))).filter(Boolean);host.innerHTML=chosen.length?chosen.map(t=>`<span class="b2b-test-chip">${esc(t.test_name)}<button type="button" data-b2b-remove-test="${t.id}" aria-label="Remove ${esc(t.test_name)}">×</button></span>`).join(''):'<span class="b2b-muted">No tests added yet.</span>';}
function b2bShowRegistrationReview(){const chosen=b2bSelectedTestIds.map(id=>b2bTestsCache.find(t=>Number(t.id)===Number(id))).filter(Boolean);const sender=profile.role==='branch_staff'?branches.find(b=>Number(b.id)===Number(profile.branch_id)):branches.find(b=>Number(b.id)===Number($('b2bSender').value));const details=[['Registration date',$('b2bRequestDate').value],['Sending branch',sender?.branch_name||''],['Processing centre',b2bCentreName($('b2bCentre').value)],['Patient',$('b2bPatient').value.trim()],['Age',$('b2bPatientAge').value+' years'],['Sex',$('b2bPatientSex').value],['Patient ID',$('b2bPatientRef').value.trim()||'Not provided'],['Sample details',$('b2bSampleDetails').value.trim()||'—']];$('b2bReviewDetails').innerHTML='<dl class="b2b-review-grid">'+details.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')+'</dl><h5>Selected tests ('+chosen.length+')</h5><ol class="b2b-review-test-list">'+chosen.map(t=>`<li>${esc(t.test_name)}</li>`).join('')+'</ol>';show('b2bRegistrationReview',true);$('b2bConfirmRequest').focus();} 
async function b2bSubmitRegistration(){const sender=profile.role==='branch_staff'?Number(profile.branch_id):Number($('b2bSender').value);const requestDate=$('b2bRequestDate')?.value||b2bLocalDate();b2bMsg('b2bRequestMsg','Submitting registration…',true);$('b2bConfirmRequest').disabled=true;const {error}=await db.rpc('b2b_create_sample_request_multi',{p_sender_branch_id:sender,p_processing_centre_id:Number($('b2bCentre').value),p_patient_name:$('b2bPatient').value.trim(),p_patient_ref:$('b2bPatientRef').value.trim()||null,p_test_ids:b2bSelectedTestIds.map(Number),p_sample_details:$('b2bSampleDetails').value.trim()||null,p_request_date:requestDate,p_patient_age:Number($('b2bPatientAge').value),p_patient_sex:$('b2bPatientSex').value});$('b2bConfirmRequest').disabled=false;if(error){b2bMsg('b2bRequestMsg',error.message);return;}const form=$('b2bRequestForm');form.reset();b2bSelectedTestIds=[];b2bRenderSelectedTests();show('b2bRegistrationReview',false);b2bInitRequestDate();if(profile.role==='branch_staff')$('b2bSender').value=String(profile.branch_id);b2bMsg('b2bRequestMsg','Sample registration submitted successfully.',true);await loadB2BModule();}
async function loadB2BModule(){
 if(!db||!profile)return;
 const role=String(profile.role||'').toLowerCase(),isAdmin=role==='admin',isFinance=['admin','management'].includes(role);
 b2bInitRequestDate();
 show('b2bAdminPanel',isAdmin);show('b2bFinancePanel',isFinance);show('b2bSenderWrap',role!=='branch_staff');
 const sender=$('b2bSender');if(sender){sender.innerHTML=branches.map(b=>`<option value="${b.id}">${esc(b.network)} — ${esc(b.branch_name)}</option>`).join('');if(role==='branch_staff')sender.value=String(profile.branch_id);}
 try{
  const {data:tests,error:te}=await db.from('b2b_tests').select('id,test_name,active').eq('active',true).order('test_name');
  if(te)throw te;
  b2bTestsCache=tests||[];
  // Load the complete request history in bounded pages; a fixed 250-row
  // limit hid older registrations from receiving centres.
  const allRequests=[];
  const requestPageSize=500;
  // Processing-centre branch staff see only their own processing queue.
  // Admin and Management retain the consolidated all-centre view.
  const scopedProcessingCentre = role==='branch_staff' && b2bCentres.includes(Number(profile.branch_id))
    ? Number(profile.branch_id) : null;
  for(let offset=0; ; offset+=requestPageSize){
    let requestQuery=db.from('b2b_sample_requests')
      .select('*').order('created_at',{ascending:false});
    if(scopedProcessingCentre!==null){
      requestQuery=requestQuery.eq('processing_centre_id',scopedProcessingCentre);
    }
    const {data:page,error:pageError}=await requestQuery
      .range(offset,offset+requestPageSize-1);
    if(pageError)throw pageError;
    allRequests.push(...(page||[]));
    if(!page||page.length<requestPageSize)break;
  }
  b2bRequestsCache=allRequests;
  // Fetch test lines in smaller batches to avoid oversized IN() requests.
  const requestIds=b2bRequestsCache.map(r=>r.id);
  b2bRequestTestsCache=[];
  for(let offset=0;offset<requestIds.length;offset+=150){
    const batchIds=requestIds.slice(offset,offset+150);
    const {data:requestTests,error:rte}=await db.from('b2b_sample_request_tests')
      .select('*').in('request_id',batchIds).order('id');
    if(rte)throw rte;
    b2bRequestTestsCache.push(...(requestTests||[]));
  }
  b2bFillTests();b2bPopulateRegisterFilters();renderB2BRequests();
  const counts={pending:0,accepted:0,rejected:0};b2bRequestsCache.forEach(r=>counts[r.status]=(counts[r.status]||0)+1);
  $('b2bKpis').innerHTML=[['Samples sent',b2bRequestsCache.length,'all'],['Pending',counts.pending,'pending'],['Accepted',counts.accepted,'accepted'],['Rejected',counts.rejected,'rejected']].map(([l,v,f])=>`<article role="button" tabindex="0" data-b2b-kpi-filter="${f}" aria-label="Filter register: ${l}"><small>${l} <span aria-hidden="true">↗</span></small><strong>${Number(v).toLocaleString('en-IN')}</strong></article>`).join('');
  if(isAdmin){const {data:prices,error:pe}=await db.from('b2b_test_prices').select('*').order('processing_centre_id');if(pe)throw pe;b2bPriceCache=prices||[];b2bPricePage=1;renderB2BPrices();}
  if(isFinance){const [{data:invoices,error:ie},{data:lines,error:le}]=await Promise.all([db.from('b2b_daily_invoices').select('*').order('invoice_date',{ascending:false}).limit(500),db.from('b2b_invoice_lines').select('*').order('created_at',{ascending:false}).limit(1000)]);if(ie)throw ie;if(le)throw le;b2bInvoicesCache=invoices||[];b2bInvoicePage=1;window.__b2bInvoiceLines=lines||[];renderB2BInvoices(b2bInvoicesCache,lines||[]);b2bInitExportFilters();}
 }catch(e){b2bMsg('b2bGlobalMsg',e.message||'Unable to load B2B module. Apply the B2B SQL migration first.');}
}
function b2bPopulateRegisterFilters(){
  const branchSelect=$('b2bRegisterBranch');
  if(branchSelect){const old=branchSelect.value||b2bRegisterBranchFilter;branchSelect.innerHTML='<option value="all">All sending branches</option>'+(branches||[]).filter(b=>b.active!==false).sort((a,b)=>a.branch_name.localeCompare(b.branch_name)).map(b=>`<option value="${b.id}">${esc(b.branch_name)}</option>`).join('');branchSelect.value=old||'all';}
  const testSelect=$('b2bRegisterTest');
  if(testSelect){const old=testSelect.value||b2bRegisterTestFilter;const names=new Map();b2bRequestTestsCache.forEach(t=>{if(t.test_id!=null&&t.test_name_snapshot)names.set(String(t.test_id),t.test_name_snapshot);});testSelect.innerHTML='<option value="all">All tests</option>'+[...names.entries()].sort((a,b)=>a[1].localeCompare(b[1])).map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join('');testSelect.value=old||'all';}
  if($('b2bRegisterDateFrom'))$('b2bRegisterDateFrom').value=b2bRegisterDateFrom;
  if($('b2bRegisterDateTo'))$('b2bRegisterDateTo').value=b2bRegisterDateTo;
}
function renderB2BRequests(){const host=$('b2bRequestRows');if(!host)return;const canReview=['admin','management'].includes(profile?.role)||b2bCentres.includes(Number(profile?.branch_id));const filtered=b2bRequestsCache.filter(r=>{const sender=branches.find(b=>Number(b.id)===Number(r.sender_branch_id));const tests=b2bRequestTestsCache.filter(t=>Number(t.request_id)===Number(r.id)).map(t=>t.test_name_snapshot).join(' ');const hay=[r.request_no,r.request_date,r.patient_name,r.patient_ref,r.patient_age,r.patient_sex,sender?.branch_name,b2bCentreName(r.processing_centre_id),tests,r.status,r.rejection_reason].filter(v=>v!==null&&v!==undefined).join(' ').toLowerCase();const requestDate=String(r.request_date||'').slice(0,10);
const matchesBranch=b2bRegisterBranchFilter==='all'||String(r.sender_branch_id)===b2bRegisterBranchFilter;
const requestTests=b2bRequestTestsCache.filter(t=>Number(t.request_id)===Number(r.id));
const matchesTest=b2bRegisterTestFilter==='all'||requestTests.some(t=>String(t.test_id)===b2bRegisterTestFilter);
const matchesFrom=!b2bRegisterDateFrom||requestDate>=b2bRegisterDateFrom;
const matchesTo=!b2bRegisterDateTo||requestDate<=b2bRegisterDateTo;
return (b2bStatusFilter==='all'||r.status===b2bStatusFilter)&&(!b2bSearchTerm||hay.includes(b2bSearchTerm))&&matchesBranch&&matchesTest&&matchesFrom&&matchesTo;});const total=filtered.length,pages=Math.max(1,Math.ceil(total/b2bRequestPageSize));b2bRequestPage=Math.min(Math.max(1,b2bRequestPage),pages);const start=(b2bRequestPage-1)*b2bRequestPageSize,visible=filtered.slice(start,start+b2bRequestPageSize);if(!total){host.innerHTML=`<tr><td colspan="8">${b2bRequestsCache.length?'No matching sample registrations.':'No sample transfers found.'}</td></tr>`;}else{host.innerHTML=visible.map(r=>{const sender=branches.find(b=>Number(b.id)===Number(r.sender_branch_id));const pending=r.status==='pending'&&canReview&&(profile.role!=='branch_staff'||Number(profile.branch_id)===Number(r.processing_centre_id));return `<tr><td>${esc(r.request_no||('#'+r.id))}</td><td>${esc(r.request_date)}</td><td>${esc(sender?.branch_name||'Branch')}</td><td>${esc(b2bCentreName(r.processing_centre_id))}</td><td>${esc(r.patient_name)}<small class="b2b-muted">${r.patient_age!=null?` · ${esc(r.patient_age)} yrs`:''}${r.patient_sex?` · ${esc(r.patient_sex)}`:''}${r.patient_ref?` · ${esc(r.patient_ref)}`:''}</small></td><td>${esc((b2bRequestTestsCache.filter(t=>Number(t.request_id)===Number(r.id)).map(t=>t.test_name_snapshot).join(', '))||r.test_name_snapshot)}</td><td><span class="b2b-pill ${esc(r.status)}">${esc(r.status)}</span>${r.rejection_reason?`<small class="b2b-muted">${esc(r.rejection_reason)}</small>`:''}</td><td>${pending?`<div class="b2b-actions"><button type="button" data-b2b-action="accept" data-id="${r.id}">Accept</button><button type="button" class="secondary" data-b2b-action="reject" data-id="${r.id}">Reject</button></div>`:'—'}</td></tr>`;}).join('');}const info=$('b2bRequestPageInfo');if(info)info.textContent=total?`Showing ${start+1}–${Math.min(start+b2bRequestPageSize,total)} of ${total} registrations`:'Showing 0 registrations';const quickInfo=$('b2bQuickSearchInfo');
if(quickInfo){
 const role=String(profile?.role||'').toLowerCase();
 const isCentreStaff=role==='branch_staff'&&b2bCentres.includes(Number(profile?.branch_id));
 const scopeLabel=isCentreStaff?`${b2bCentreName(profile.branch_id)} processing queue`:'permitted registrations · search across all branches';
 quickInfo.textContent=b2bSearchTerm?`${total.toLocaleString('en-IN')} matching registrations`:`${b2bRequestsCache.length.toLocaleString('en-IN')} ${scopeLabel}`;
}const historySummary=$('b2bHistorySummaryText');if(historySummary)historySummary.textContent=b2bSearchTerm?`${total.toLocaleString('en-IN')} matching records · showing ${Math.min(b2bRequestPageSize,total)} per page`:`${b2bRequestsCache.length.toLocaleString('en-IN')} permitted records · latest 10 shown when opened`;const page=$('b2bRequestPageNumber');if(page)page.textContent=`Page ${b2bRequestPage} of ${pages}`;const prev=$('b2bRequestPrev'),next=$('b2bRequestNext');if(prev)prev.disabled=b2bRequestPage<=1;if(next)next.disabled=b2bRequestPage>=pages;}
function renderB2BPrices(){const host=$('b2bPriceRows');if(!host)return;const rows=b2bPriceCache.filter(p=>{const t=b2bTestsCache.find(x=>Number(x.id)===Number(p.test_id));const name=(t?.test_name||('Test '+p.test_id)).toLowerCase();return (!b2bPriceSearchTerm||name.includes(b2bPriceSearchTerm))&&(b2bPriceCentreFilter==='all'||String(p.processing_centre_id)===b2bPriceCentreFilter);});const pages=Math.max(1,Math.ceil(rows.length/b2bPricePageSize));b2bPricePage=Math.min(Math.max(1,b2bPricePage),pages);const start=(b2bPricePage-1)*b2bPricePageSize;const visible=rows.slice(start,start+b2bPricePageSize);host.innerHTML=visible.length?visible.map(p=>{const t=b2bTestsCache.find(x=>Number(x.id)===Number(p.test_id));const active=p.active!==false;return `<tr class="${active?'':'b2b-inactive-row'}"><td>${esc(b2bCentreName(p.processing_centre_id))}</td><td>${esc(t?.test_name||('Test '+p.test_id))}${t?.active===false?'<small class="b2b-muted">Catalogue inactive</small>':''}</td><td>${b2bMoney(p.test_price)}</td><td>${b2bMoney(p.amenities_cost)}</td><td><strong>${b2bMoney(Number(p.test_price)+Number(p.amenities_cost))}</strong></td><td><span class="b2b-pill ${active?'accepted':'rejected'}">${active?'Active':'Inactive'}</span></td><td class="b2b-price-actions"><button type="button" class="secondary" data-b2b-price-edit="${p.id}">Edit rate</button><button type="button" class="secondary" data-b2b-test-rename="${p.test_id}">Rename test</button>${active?`<button type="button" class="secondary" data-b2b-price-deactivate="${p.id}">Deactivate rate</button>`:''}${t?.active!==false?`<button type="button" class="secondary danger" data-b2b-test-deactivate="${p.test_id}">Deactivate test</button>`:''}</td></tr>`;}).join(''):'<tr><td colspan="7">No matching price records.</td></tr>';const info=$('b2bPricePageInfo');if(info)info.textContent=rows.length?`Showing ${start+1}–${Math.min(start+b2bPricePageSize,rows.length)} of ${rows.length}`:'Showing 0 records';const prev=$('b2bPricePrev'),next=$('b2bPriceNext');if(prev)prev.disabled=b2bPricePage<=1;if(next)next.disabled=b2bPricePage>=pages;}
let b2bFilteredInvoices=[];
function b2bInvoiceRequests(inv){return b2bRequestsCache.filter(r=>Number(r.sender_branch_id)===Number(inv.sender_branch_id)&&Number(r.processing_centre_id)===Number(inv.processing_centre_id)&&String(r.request_date).slice(0,10)===String(inv.invoice_date).slice(0,10));}
function b2bInvoiceLines(inv){const ids=new Set(b2bInvoiceRequests(inv).map(r=>Number(r.id)));return b2bRequestTestsCache.length?[]:[];}
function b2bGetInvoiceLines(inv){const reqs=b2bInvoiceRequests(inv),ids=new Set(reqs.map(r=>Number(r.id)));return (window.__b2bInvoiceLines||[]).filter(l=>ids.has(Number(l.request_id)));}
function b2bCsvCell(value){let v=String(value??'');if(/^[=+@\-]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';}
function b2bDownloadBlob(content,type,filename){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
function b2bExportFilterInvoices(){const mode=$('b2bExportMode')?.value||'month';let from='',to='';if(mode==='month'){const m=$('b2bExportMonth')?.value;if(!m){b2bMsg('b2bGlobalMsg','Select a month first.');return null;}from=m+'-01';const [y,mo]=m.split('-').map(Number);to=`${m}-${String(new Date(y,mo,0).getDate()).padStart(2,'0')}`;}else{from=$('b2bExportFrom')?.value||'';to=$('b2bExportTo')?.value||'';if(!from||!to||from>to){b2bMsg('b2bGlobalMsg','Select a valid From and To date.');return null;}}
 const sender=$('b2bExportSender')?.value||'all',centre=$('b2bExportCentre')?.value||'all',status=$('b2bExportStatus')?.value||'all';
 return b2bInvoicesCache.filter(i=>{const d=String(i.invoice_date||'').slice(0,10);return d>=from&&d<=to&&(sender==='all'||String(i.sender_branch_id)===sender)&&(centre==='all'||String(i.processing_centre_id)===centre)&&(status==='all'||String(i.status||'').toLowerCase()===status);}).sort((a,b)=>String(a.invoice_date).localeCompare(String(b.invoice_date))||String(a.invoice_no).localeCompare(String(b.invoice_no)));}
function b2bInvoiceCsvRows(invoices){const rows=[['Invoice No','Invoice Date','Sending Branch','Processing Centre','Patient Name','Patient ID','Age','Sex','Test','Test Price (INR)','Amenities (INR)','Line Total (INR)','Invoice Total (INR)','Paid (INR)','Outstanding (INR)','Payment Status']];invoices.forEach(inv=>{const sender=branches.find(x=>Number(x.id)===Number(inv.sender_branch_id))?.branch_name||'';const centre=b2bCentreName(inv.processing_centre_id);const reqMap=new Map(b2bInvoiceRequests(inv).map(r=>[Number(r.id),r]));const lines=b2bGetInvoiceLines(inv);lines.forEach(l=>{const req=reqMap.get(Number(l.request_id))||{};rows.push([inv.invoice_no,inv.invoice_date,sender,centre,l.patient_name_snapshot||req.patient_name||'',l.patient_ref_snapshot||req.patient_ref||'',req.patient_age??'',req.patient_sex||'',l.test_name_snapshot||'',Number(l.test_price_snapshot||0).toFixed(2),Number(l.amenities_snapshot||0).toFixed(2),Number(l.line_total||0).toFixed(2),Number(inv.subtotal||0).toFixed(2),Number(inv.paid_amount||0).toFixed(2),(Number(inv.subtotal||0)-Number(inv.paid_amount||0)).toFixed(2),inv.status||'']);});});return rows;}
function b2bDownloadCsv(invoices,filename){if(!invoices.length){b2bMsg('b2bGlobalMsg','No invoices match the selected period and filters.');return;}const rows=b2bInvoiceCsvRows(invoices);const csv='\ufeff'+rows.map(row=>row.map(b2bCsvCell).join(',')).join('\r\n');b2bDownloadBlob(csv,'text/csv;charset=utf-8;',filename+'.csv');}
function b2bPrintInvoices(invoices){if(!invoices.length){b2bMsg('b2bGlobalMsg','No invoices match the selected period and filters.');return;}const money=v=>'₹'+Number(v||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});const escHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const pages=invoices.map(inv=>{const sender=branches.find(x=>Number(x.id)===Number(inv.sender_branch_id))?.branch_name||'Branch';const centre=b2bCentreName(inv.processing_centre_id);const reqs=b2bInvoiceRequests(inv),reqMap=new Map(reqs.map(r=>[Number(r.id),r]));const lines=b2bGetInvoiceLines(inv);const body=lines.map((l,i)=>{const r=reqMap.get(Number(l.request_id))||{};return `<tr><td>${i+1}</td><td>${escHtml(l.patient_name_snapshot||r.patient_name||'')}</td><td>${escHtml(l.patient_ref_snapshot||r.patient_ref||'')}</td><td>${escHtml(r.patient_age??'—')} / ${escHtml(r.patient_sex||'—')}</td><td>${escHtml(l.test_name_snapshot||'')}</td><td class="num">${money(l.test_price_snapshot)}</td><td class="num">${money(l.amenities_snapshot)}</td><td class="num">${money(l.line_total)}</td></tr>`;}).join('');const total=Number(inv.subtotal||0),paid=Number(inv.paid_amount||0);return `<section class="invoice-page"><header><div><h1>UNOMED</h1><p>Medical Enterprises Pvt. Ltd.<br>Processing &amp; Laboratory Services</p></div><div class="invoice-title"><h2>B2B INVOICE</h2><b>${escHtml(inv.invoice_no)}</b><br>Invoice date: ${escHtml(inv.invoice_date)}</div></header><div class="parties"><div><b>BILLED BY / PROCESSING CENTRE</b><p><strong>${escHtml(centre)}</strong><br>UNOMED Medical Enterprises Pvt. Ltd.<br>Address: __________________________<br>GSTIN (if applicable): ______________</p></div><div><b>BILLED TO / SENDING BRANCH</b><p><strong>${escHtml(sender)}</strong><br>Address: __________________________<br>GSTIN (if applicable): ______________</p></div></div><div class="meta"><span><small>BILLING DATE</small><b>${escHtml(inv.invoice_date)}</b></span><span><small>PAYMENT STATUS</small><b>${escHtml(inv.status||'')}</b></span></div><h3>PATIENT &amp; TEST DETAILS</h3><table><thead><tr><th>#</th><th>Patient</th><th>Patient ID</th><th>Age / Sex</th><th>Test</th><th>Test Price</th><th>Amenities</th><th>Total</th></tr></thead><tbody>${body||'<tr><td colspan="8">No line details found</td></tr>'}</tbody></table><div class="totals"><div>Subtotal (Test price + amenities) <b>${money(total)}</b></div><div>Amount paid <b>${money(paid)}</b></div><div class="grand">BALANCE DUE <b>${money(total-paid)}</b></div></div><div class="foot"><div><b>PAYMENT DETAILS</b><p>Payment mode: ____________________<br>Payment reference: ________________<br>Paid on: _________________________</p></div><div><b>REMARKS / TERMS</b><p>Please quote the invoice number when making payment.<br>This invoice covers accepted B2B tests listed above.<br>Contact the issuing processing centre for queries.</p></div></div><div class="sign">For UNOMED Medical Enterprises Pvt. Ltd.<br><br><br>______________________________<br>Authorised signatory / Seal</div></section>`;}).join('');const html=`<!doctype html><html><head><meta charset="utf-8"><title>B2B Invoice</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font:10px Arial,sans-serif;color:#1d2d40;margin:0}.invoice-page{page-break-after:always;min-height:265mm}.invoice-page:last-child{page-break-after:auto}header{display:flex;justify-content:space-between;border-bottom:2px solid #087e8b;padding-bottom:14px;margin-bottom:18px}h1{font-size:23px;color:#12345a;margin:0 0 5px}h2{font-size:20px;color:#12345a;margin:0 0 8px}.invoice-title{text-align:right}p{line-height:1.6;color:#61758b}.parties,.foot{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d7e2ed;margin:14px 0}.parties>div,.foot>div{padding:10px}.parties>div+div,.foot>div+div{border-left:1px solid #d7e2ed}.parties b,.foot b{display:block;background:#eef5fa;color:#12345a;padding:8px;margin:-10px -10px 8px}.meta{display:flex;gap:25px;background:#eef5fa;padding:12px;margin:14px 0}.meta span{display:flex;flex-direction:column;gap:5px}.meta small{color:#61758b}h3{color:#12345a;margin:18px 0 8px}table{width:100%;border-collapse:collapse;font-size:9px}th{background:#12345a;color:white;text-align:left}th,td{border:1px solid #d7e2ed;padding:8px 6px}.num{text-align:right}.totals{width:55%;margin:18px 0 18px auto}.totals div{display:flex;justify-content:space-between;padding:7px;border-bottom:1px solid #d7e2ed}.totals .grand{font-weight:bold;background:#eef5fa;color:#12345a;font-size:12px}.sign{margin-top:25px;font-weight:bold}.sign br{line-height:2}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>${pages}<script>window.onload=()=>setTimeout(()=>window.print(),350);</script></body></html>`;const w=window.open('','_blank');if(!w){b2bMsg('b2bGlobalMsg','Allow pop-ups to generate the PDF invoice.');return;}w.document.open();w.document.write(html);w.document.close();}
function b2bRefreshExportSummary(){const rows=b2bFilteredInvoices;const amount=rows.reduce((s,i)=>s+Number(i.subtotal||0),0);const paid=rows.reduce((s,i)=>s+Number(i.paid_amount||0),0);const due=amount-paid;const el=$('b2bExportSummary');if(el)el.textContent=`${rows.length} invoice(s) · Total invoice amount ${b2bMoney(amount)} · Paid ${b2bMoney(paid)} · Outstanding ${b2bMoney(due)}. Totals reflect the selected date period, sending branch, processing centre and payment status.`;}
let b2bInvoicePage=1,b2bInvoicePageSize=10,b2bInvoiceLinePage=1,b2bInvoiceLinePageSize=10;
function renderB2BInvoices(invoices,lines){
 b2bFilteredInvoices=Array.isArray(invoices)?invoices:[];
 const host=$('b2bInvoiceRows');
 const totalAmount=b2bFilteredInvoices.reduce((s,i)=>s+Number(i.subtotal||0),0);
 const totalPaid=b2bFilteredInvoices.reduce((s,i)=>s+Number(i.paid_amount||0),0);
 const totalDue=totalAmount-totalPaid;
 const pageCount=Math.max(1,Math.ceil(b2bFilteredInvoices.length/b2bInvoicePageSize));
 b2bInvoicePage=Math.min(Math.max(1,b2bInvoicePage),pageCount);
 const offset=(b2bInvoicePage-1)*b2bInvoicePageSize;
 const pageRows=b2bFilteredInvoices.slice(offset,offset+b2bInvoicePageSize);
 if(host)host.innerHTML=b2bFilteredInvoices.length?pageRows.map(i=>{
  const sender=branches.find(b=>Number(b.id)===Number(i.sender_branch_id));
  return `<tr><td>${esc(i.invoice_no)}</td><td>${esc(i.invoice_date)}</td><td>${esc(sender?.branch_name||'Branch')}</td><td>${esc(b2bCentreName(i.processing_centre_id))}</td><td>${b2bMoney(i.subtotal)}</td><td>${b2bMoney(i.paid_amount)}</td><td><strong>${b2bMoney(Number(i.subtotal)-Number(i.paid_amount))}</strong></td><td><span class="b2b-pill ${esc(i.status)}">${esc(i.status)}</span></td><td><button type="button" class="secondary" data-b2b-export="${i.id}">CSV</button></td><td><button type="button" class="secondary" data-b2b-payment="${i.id}">Update paid</button></td></tr>`;
 }).join('')+`<tr class="b2b-invoice-total-row"><td colspan="4"><strong>FILTERED TOTAL · ${b2bFilteredInvoices.length} invoice(s)</strong></td><td><strong>${b2bMoney(totalAmount)}</strong></td><td><strong>${b2bMoney(totalPaid)}</strong></td><td><strong>${b2bMoney(totalDue)}</strong></td><td colspan="3">All filtered invoices</td></tr>`:'<tr><td colspan="10">No accepted samples have generated invoices yet.</td></tr>';
 const pager=$('b2bInvoicePager');
 if(pager){
  pager.innerHTML=`<div class="b2b-pager-meta">Showing <strong>${b2bFilteredInvoices.length?offset+1:0}–${Math.min(offset+b2bInvoicePageSize,b2bFilteredInvoices.length)}</strong> of <strong>${b2bFilteredInvoices.length}</strong> invoices</div><div class="b2b-pager-controls"><label>Rows per page <select id="b2bInvoicePageSize"><option value="10" ${b2bInvoicePageSize===10?'selected':''}>10</option><option value="20" ${b2bInvoicePageSize===20?'selected':''}>20</option><option value="50" ${b2bInvoicePageSize===50?'selected':''}>50</option><option value="100" ${b2bInvoicePageSize===100?'selected':''}>100</option></select></label><span>Page ${b2bInvoicePage} of ${pageCount}</span><button type="button" class="secondary" data-invoice-page="prev" ${b2bInvoicePage<=1?'disabled':''}>Previous</button><button type="button" class="secondary" data-invoice-page="next" ${b2bInvoicePage>=pageCount?'disabled':''}>Next</button></div>`;
  if(!pager.dataset.bound){
   pager.dataset.bound='1';
   pager.addEventListener('change',e=>{
    if(e.target?.id==='b2bInvoicePageSize'){b2bInvoicePageSize=Math.max(1,Number(e.target.value)||10);b2bInvoicePage=1;renderB2BInvoices(b2bFilteredInvoices,window.__b2bInvoiceLines||[]);}
   });
   pager.addEventListener('click',e=>{
    const btn=e.target.closest('[data-invoice-page]');if(!btn||btn.disabled)return;
    const pages=Math.max(1,Math.ceil(b2bFilteredInvoices.length/b2bInvoicePageSize));
    b2bInvoicePage=btn.dataset.invoicePage==='next'?Math.min(pages,b2bInvoicePage+1):Math.max(1,b2bInvoicePage-1);
    renderB2BInvoices(b2bFilteredInvoices,window.__b2bInvoiceLines||[]);
   });
  }
 }
 const visibleRequestIds=new Set(invoices.flatMap(i=>b2bInvoiceRequests(i).map(r=>Number(r.id))));
 const visibleLines=(lines||[]).filter(l=>visibleRequestIds.has(Number(l.request_id)));
 const lineHost=$('b2bInvoiceLineRows');
 const lineCount=visibleLines.length;
 const linePages=Math.max(1,Math.ceil(lineCount/b2bInvoiceLinePageSize));
 b2bInvoiceLinePage=Math.min(Math.max(1,b2bInvoiceLinePage),linePages);
 const lineOffset=(b2bInvoiceLinePage-1)*b2bInvoiceLinePageSize;
 const pageLines=visibleLines.slice(lineOffset,lineOffset+b2bInvoiceLinePageSize);
 if(lineHost)lineHost.innerHTML=pageLines.length?pageLines.map(l=>{
  const req=b2bRequestsCache.find(r=>Number(r.id)===Number(l.request_id));
  return `<tr><td>${esc(req?.request_date||'')}</td><td>${esc(branches.find(b=>Number(b.id)===Number(req?.sender_branch_id))?.branch_name||'')}</td><td>${esc(b2bCentreName(req?.processing_centre_id))}</td><td>${esc(l.patient_name_snapshot)}</td><td>${esc(l.test_name_snapshot)}</td><td>${b2bMoney(l.test_price_snapshot)}</td><td>${b2bMoney(l.amenities_snapshot)}</td><td><strong>${b2bMoney(l.line_total)}</strong></td></tr>`;
 }).join(''):'<tr><td colspan="8">No invoice lines for the selected filters.</td></tr>';
 const lineSummary=$('b2bInvoiceLineSummary');
 if(lineSummary)lineSummary.textContent=`${lineCount.toLocaleString('en-IN')} patient-wise / test-wise invoice lines · showing ${Math.min(b2bInvoiceLinePageSize,lineCount)} per page`;
 const linePager=$('b2bInvoiceLinePager');
 if(linePager){
  linePager.innerHTML=`<div class="b2b-pager-meta">Showing <strong>${lineCount?lineOffset+1:0}–${Math.min(lineOffset+b2bInvoiceLinePageSize,lineCount)}</strong> of <strong>${lineCount.toLocaleString('en-IN')}</strong> invoice lines</div><div class="b2b-pager-controls"><label>Rows per page <select id="b2bInvoiceLinePageSize"><option value="10" ${b2bInvoiceLinePageSize===10?'selected':''}>10</option><option value="20" ${b2bInvoiceLinePageSize===20?'selected':''}>20</option><option value="50" ${b2bInvoiceLinePageSize===50?'selected':''}>50</option><option value="100" ${b2bInvoiceLinePageSize===100?'selected':''}>100</option></select></label><span>Page ${b2bInvoiceLinePage} of ${linePages}</span><button type="button" class="secondary" data-invoice-line-page="prev" ${b2bInvoiceLinePage<=1?'disabled':''}>Previous</button><button type="button" class="secondary" data-invoice-line-page="next" ${b2bInvoiceLinePage>=linePages?'disabled':''}>Next</button></div>`;
  if(!linePager.dataset.bound){
   linePager.dataset.bound='1';
   linePager.addEventListener('change',e=>{if(e.target?.id==='b2bInvoiceLinePageSize'){b2bInvoiceLinePageSize=Math.max(1,Number(e.target.value)||10);b2bInvoiceLinePage=1;renderB2BInvoices(b2bFilteredInvoices,window.__b2bInvoiceLines||[]);}});
   linePager.addEventListener('click',e=>{const btn=e.target.closest('[data-invoice-line-page]');if(!btn||btn.disabled)return;const max=Math.max(1,Math.ceil(visibleLines.length/b2bInvoiceLinePageSize));b2bInvoiceLinePage=btn.dataset.invoiceLinePage==='next'?Math.min(max,b2bInvoiceLinePage+1):Math.max(1,b2bInvoiceLinePage-1);renderB2BInvoices(b2bFilteredInvoices,window.__b2bInvoiceLines||[]);});
  }
 }
}
$('b2bPriceSearch')?.addEventListener('input',e=>{b2bPriceSearchTerm=String(e.target.value||'').trim().toLowerCase();b2bPricePage=1;renderB2BPrices();});
$('b2bPriceCentreFilter')?.addEventListener('change',e=>{b2bPriceCentreFilter=e.target.value||'all';b2bPricePage=1;renderB2BPrices();});
$('b2bPricePageSize')?.addEventListener('change',e=>{b2bPricePageSize=Math.max(1,Number(e.target.value)||10);b2bPricePage=1;renderB2BPrices();});
$('b2bPricePrev')?.addEventListener('click',()=>{b2bPricePage=Math.max(1,b2bPricePage-1);renderB2BPrices();});
$('b2bPriceNext')?.addEventListener('click',()=>{b2bPricePage+=1;renderB2BPrices();});
$('b2bRegisterSearch')?.addEventListener('input',e=>{b2bSearchTerm=String(e.target.value||'').trim().toLowerCase();b2bRequestPage=1;renderB2BRequests();});
$('b2bQuickSearch')?.addEventListener('input',e=>{b2bSearchTerm=String(e.target.value||'').trim().toLowerCase();if($('b2bRegisterSearch'))$('b2bRegisterSearch').value=e.target.value||'';b2bRequestPage=1;const history=$('b2bHistoryDetails');if(history&&b2bSearchTerm)history.open=true;renderB2BRequests();});
$('b2bQuickSearchClear')?.addEventListener('click',()=>{b2bSearchTerm='';if($('b2bQuickSearch'))$('b2bQuickSearch').value='';if($('b2bRegisterSearch'))$('b2bRegisterSearch').value='';b2bRequestPage=1;renderB2BRequests();const history=$('b2bHistoryDetails');if(history)history.open=false;$('b2bQuickSearch')?.focus();});
$('b2bQuickSearchView')?.addEventListener('click',()=>{const history=$('b2bHistoryDetails');if(history)history.open=true;requestAnimationFrame(()=>$('b2bRequestRows')?.closest('.b2b-table-wrap')?.scrollIntoView({behavior:'smooth',block:'start'}));});
$('b2bRegisterSearchClear')?.addEventListener('click',()=>{b2bSearchTerm='';if($('b2bRegisterSearch'))$('b2bRegisterSearch').value='';b2bRequestPage=1;renderB2BRequests();$('b2bRegisterSearch')?.focus();});
$('b2bRegisterBranch')?.addEventListener('change',e=>{b2bRegisterBranchFilter=e.target.value||'all';b2bRequestPage=1;renderB2BRequests();});
$('b2bRegisterTest')?.addEventListener('change',e=>{b2bRegisterTestFilter=e.target.value||'all';b2bRequestPage=1;renderB2BRequests();});
$('b2bRegisterDateFrom')?.addEventListener('change',e=>{b2bRegisterDateFrom=e.target.value||'';b2bRequestPage=1;renderB2BRequests();});
$('b2bRegisterDateTo')?.addEventListener('change',e=>{b2bRegisterDateTo=e.target.value||'';b2bRequestPage=1;renderB2BRequests();});
$('b2bRegisterClearFilters')?.addEventListener('click',()=>{b2bRegisterBranchFilter='all';b2bRegisterTestFilter='all';b2bRegisterDateFrom='';b2bRegisterDateTo='';b2bSearchTerm='';if($('b2bRegisterBranch'))$('b2bRegisterBranch').value='all';if($('b2bRegisterTest'))$('b2bRegisterTest').value='all';if($('b2bRegisterDateFrom'))$('b2bRegisterDateFrom').value='';if($('b2bRegisterDateTo'))$('b2bRegisterDateTo').value='';if($('b2bRegisterSearch'))$('b2bRegisterSearch').value='';if($('b2bQuickSearch'))$('b2bQuickSearch').value='';b2bRequestPage=1;renderB2BRequests();});

$('b2bRequestPageSize')?.addEventListener('change',e=>{b2bRequestPageSize=Math.max(1,Number(e.target.value)||10);b2bRequestPage=1;renderB2BRequests();});
$('b2bRequestPrev')?.addEventListener('click',()=>{b2bRequestPage=Math.max(1,b2bRequestPage-1);renderB2BRequests();});
$('b2bRequestNext')?.addEventListener('click',()=>{b2bRequestPage+=1;renderB2BRequests();});
$('b2bSection')?.addEventListener('click',e=>{const filter=e.target.closest('[data-b2b-filter]');const kpi=e.target.closest('[data-b2b-kpi-filter]');if(filter||kpi){b2bStatusFilter=(filter||kpi).dataset.b2bFilter||(kpi?.dataset.b2bKpiFilter)||'all';b2bRequestPage=1;document.querySelectorAll('#b2bSection [data-b2b-filter]').forEach(x=>x.classList.toggle('active',x.dataset.b2bFilter===b2bStatusFilter));const search=$('b2bRegisterSearch');if(search)search.scrollIntoView({behavior:'smooth',block:'nearest'});renderB2BRequests();}});
$('b2bKpis')?.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-b2b-kpi-filter]')){e.preventDefault();e.target.click();}});
$('b2bAddTest')?.addEventListener('click',()=>{const sel=$('b2bTests'),id=Number(sel?.value);if(!id){b2bMsg('b2bRequestMsg','Choose a test before adding it.');return;}if(b2bSelectedTestIds.includes(id)){b2bMsg('b2bRequestMsg','This test is already added.');return;}b2bSelectedTestIds.push(id);sel.value='';b2bRenderSelectedTests();b2bMsg('b2bRequestMsg','Test added.');});
$('b2bSelectedTests')?.addEventListener('click',e=>{const b=e.target.closest('[data-b2b-remove-test]');if(!b)return;b2bSelectedTestIds=b2bSelectedTestIds.filter(id=>Number(id)!==Number(b.dataset.b2bRemoveTest));b2bRenderSelectedTests();});
$('b2bRequestForm')?.addEventListener('submit',e=>{e.preventDefault();if(!e.target.reportValidity())return;const requestDate=$('b2bRequestDate')?.value||b2bLocalDate();if(!requestDate||requestDate>b2bLocalDate()){b2bMsg('b2bRequestMsg','Select a valid sample registration date (today or earlier).');return;}if(!b2bSelectedTestIds.length){b2bMsg('b2bRequestMsg','Add at least one test before reviewing.');return;}b2bShowRegistrationReview();});
$('b2bConfirmRequest')?.addEventListener('click',b2bSubmitRegistration);
$('b2bEditRequest')?.addEventListener('click',()=>show('b2bRegistrationReview',false));
$('b2bRequestRows')?.addEventListener('click',async e=>{const b=e.target.closest('[data-b2b-action]');if(!b)return;let reason=null;if(b.dataset.b2bAction==='reject'){reason=prompt('Enter the rejection reason (required):');if(!reason||!reason.trim())return;}if(b.dataset.b2bAction==='accept'&&!confirm('Accept this sample? Billing will be generated using the current Admin-approved rate.'))return;const {error}=await db.rpc('b2b_review_sample_request',{p_request_id:Number(b.dataset.id),p_action:b.dataset.b2bAction==='accept'?'accepted':'rejected',p_rejection_reason:reason});if(error){b2bMsg('b2bGlobalMsg',error.message);return;}b2bMsg('b2bGlobalMsg',b.dataset.b2bAction==='accept'?'Sample accepted and added to the daily B2B invoice.':'Sample rejected. No charge created.',true);await loadB2BModule();});
$('b2bTestForm')?.addEventListener('submit',async e=>{e.preventDefault();if(profile.role!=='admin')return;const name=$('b2bNewTest').value.trim();const {error}=await db.from('b2b_tests').insert({test_name:name,created_by:user.id});if(error){b2bMsg('b2bAdminMsg',error.message);return;}e.target.reset();b2bMsg('b2bAdminMsg','Test added to common catalogue.',true);await loadB2BModule();});
$('b2bPriceForm')?.addEventListener('submit',async e=>{e.preventDefault();if(profile.role!=='admin')return;const payload={processing_centre_id:Number($('b2bPriceCentre').value),test_id:Number($('b2bPriceTest').value),test_price:Number($('b2bTestPrice').value),amenities_cost:Number($('b2bAmenities').value),active:true,updated_by:user.id,updated_at:new Date().toISOString()};const {error}=await db.from('b2b_test_prices').upsert(payload,{onConflict:'processing_centre_id,test_id'});if(error){b2bMsg('b2bAdminMsg',error.message);return;}b2bMsg('b2bAdminMsg','Processing-centre pricing saved.',true);await loadB2BModule();});
$('b2bPriceRows')?.addEventListener('click',async e=>{const edit=e.target.closest('[data-b2b-price-edit]');if(edit){const p=b2bPriceCache.find(x=>String(x.id)===edit.dataset.b2bPriceEdit);if(!p)return;$('b2bPriceCentre').value=p.processing_centre_id;$('b2bPriceTest').value=p.test_id;$('b2bTestPrice').value=p.test_price;$('b2bAmenities').value=p.amenities_cost;$('b2bPriceForm').scrollIntoView({behavior:'smooth',block:'center'});return;}const rename=e.target.closest('[data-b2b-test-rename]');if(rename){const t=b2bTestsCache.find(x=>String(x.id)===rename.dataset.b2bTestRename);if(!t)return;const name=prompt('Edit common test name:',t.test_name);if(name===null||!name.trim())return;const {error}=await db.from('b2b_tests').update({test_name:name.trim()}).eq('id',t.id);if(error){b2bMsg('b2bAdminMsg',error.message);return;}b2bMsg('b2bAdminMsg','Test name updated. Existing invoice snapshots remain unchanged.',true);await loadB2BModule();return;}const dr=e.target.closest('[data-b2b-price-deactivate]');if(dr){const p=b2bPriceCache.find(x=>String(x.id)===dr.dataset.b2bPriceDeactivate);if(!p||!confirm('Deactivate this centre-specific rate? Historical invoices will remain unchanged.'))return;const {error}=await db.from('b2b_test_prices').update({active:false,updated_by:user.id,updated_at:new Date().toISOString()}).eq('id',p.id);if(error){b2bMsg('b2bAdminMsg',error.message);return;}b2bMsg('b2bAdminMsg','Processing-centre rate deactivated.',true);await loadB2BModule();return;}const dt=e.target.closest('[data-b2b-test-deactivate]');if(dt){const t=b2bTestsCache.find(x=>String(x.id)===dt.dataset.b2bTestDeactivate);if(!t||!confirm('Deactivate this test from the common catalogue? It will no longer be available for new registrations. Historical records remain.'))return;const {error}=await db.from('b2b_tests').update({active:false}).eq('id',t.id);if(error){b2bMsg('b2bAdminMsg',error.message);return;}b2bMsg('b2bAdminMsg','Test deactivated from the common catalogue.',true);await loadB2BModule();}});
$('b2bInvoiceRows')?.addEventListener('click',async e=>{const exportButton=e.target.closest('[data-b2b-export]');const pdfButton=e.target.closest('[data-b2b-pdf]');if(exportButton||pdfButton){const inv=b2bInvoicesCache.find(x=>String(x.id)===(exportButton||pdfButton).dataset[exportButton?'b2bExport':'b2bPdf']);if(!inv)return;if(exportButton)b2bDownloadCsv([inv],inv.invoice_no||'B2B-invoice');else b2bPrintInvoices([inv]);return;}const b=e.target.closest('[data-b2b-payment]');if(!b)return;const invoice=b2bInvoicesCache.find(x=>String(x.id)===b.dataset.b2bPayment);if(!invoice)return;const paid=prompt(`Enter total paid amount for ${invoice.invoice_no}`,String(invoice.paid_amount||0));if(paid===null)return;const amount=Number(paid);if(!Number.isFinite(amount)||amount<0){b2bMsg('b2bGlobalMsg','Enter a valid paid amount.');return;}const {error}=await db.rpc('b2b_update_invoice_payment',{p_invoice_id:Number(invoice.id),p_paid_amount:amount});if(error){b2bMsg('b2bGlobalMsg',error.message);return;}b2bMsg('b2bGlobalMsg','Invoice payment updated.',true);await loadB2BModule();});
function b2bInitExportFilters(){const sender=$('b2bExportSender');if(sender&&sender.options.length<=1)branches.forEach(b=>sender.add(new Option(b.branch_name,String(b.id))));const month=$('b2bExportMonth');if(month&&!month.value){const now=new Date();month.value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;}const mode=$('b2bExportMode');if(mode&&!mode.dataset.bound){mode.dataset.bound='1';mode.addEventListener('change',()=>{const monthly=mode.value==='month';show('b2bExportMonthWrap',monthly);show('b2bExportFromWrap',!monthly);show('b2bExportToWrap',!monthly);});}const apply=$('b2bApplyExportFilters');if(apply&&!apply.dataset.bound){apply.dataset.bound='1';apply.addEventListener('click',()=>{const rows=b2bExportFilterInvoices();if(!rows)return;b2bFilteredInvoices=rows;b2bInvoicePage=1;b2bInvoiceLinePage=1;b2bRefreshExportSummary();renderB2BInvoices(rows,window.__b2bInvoiceLines||[]);});}const csv=$('b2bExportCsv');if(csv&&!csv.dataset.bound){csv.dataset.bound='1';csv.addEventListener('click',()=>{if(!b2bFilteredInvoices.length){const rows=b2bExportFilterInvoices();if(!rows)return;b2bFilteredInvoices=rows;}const label=$('b2bExportMode').value==='month'?$('b2bExportMonth').value:`${$('b2bExportFrom').value}_to_${$('b2bExportTo').value}`;b2bDownloadCsv(b2bFilteredInvoices,`B2B_Invoices_${label}`);});}const pdf=$('b2bExportPdf');if(pdf&&!pdf.dataset.bound){pdf.dataset.bound='1';pdf.addEventListener('click',()=>{if(!b2bFilteredInvoices.length){const rows=b2bExportFilterInvoices();if(!rows)return;b2bFilteredInvoices=rows;}b2bPrintInvoices(b2bFilteredInvoices);});}if(!b2bFilteredInvoices.length)b2bFilteredInvoices=b2bInvoicesCache.slice();b2bRefreshExportSummary();}


// ---------------- Inventory & Procurement module ----------------
let inventoryItemsCache = [], inventoryAssignmentsCache = [], inventoryEntriesCache = [], inventoryRequestsCache = [], inventoryMovementsCache = [];
let inventoryTestsCache = [], inventoryTestMappingsCache = [], inventoryDailyCountCache = null;
let inventoryItemPage = 0;
let inventoryAssignmentPage = 0;
let inventoryEditingItemId = null;
const inventoryManager = () => ['admin','management'].includes(String(profile?.role||'').toLowerCase());
const inventoryUnitLabel = unit => ({ml:'ML',nos:'Nos',tests:'Tests'}[String(unit||'').toLowerCase()] || String(unit||''));
const inventoryDate = value => value ? String(value).slice(0,10) : '';
const inventoryFmtQty = value => Number(value||0).toLocaleString('en-IN',{maximumFractionDigits:3});
function inventorySetMessage(message, ok=false){const el=$('inventoryMessage');if(el){el.textContent=message||'';el.style.color=ok?'#087c68':'#b4233d';}}
function inventoryFillSelect(id, rows, labelFn, firstLabel){const el=$(id);if(!el)return;const previous=el.value;el.innerHTML=(firstLabel?`<option value="">${esc(firstLabel)}</option>`:'')+rows.map(r=>`<option value="${esc(r.id)}">${esc(labelFn(r))}</option>`).join('');if(rows.some(r=>String(r.id)===previous))el.value=previous;}
function inventoryBranchName(id){return branches.find(b=>String(b.id)===String(id))?.branch_name||`Branch ${id}`;}
function inventoryLatestByAssignment(){const map=new Map();for(const entry of inventoryEntriesCache){for(const line of entry.inventory_stock_entry_lines||[]){const key=String(line.assignment_id);if(!map.has(key))map.set(key,{...line,stock_date:entry.stock_date,submitted_at:entry.submitted_at});}}return map;}
function inventoryCurrentQty(assignment, latest){let qty=Number(latest?.quantity||0);const cutoff=latest?.stock_date||'0000-01-01';for(const movement of inventoryMovementsCache){if(String(movement.branch_id)!==String(assignment.branch_id)||String(movement.item_id)!==String(assignment.item_id)||inventoryDate(movement.movement_date)<=cutoff)continue;const amount=Number(movement.quantity||0);qty+=movement.movement_type==='consumption'?-amount:amount;}return qty;}
function inventoryStatus(assignment, latest){if(!latest)return {label:'Pending update',cls:'pending'};const qty=inventoryCurrentQty(assignment,latest),min=Number(assignment.min_stock||0);if(qty<=0)return {label:'Zero stock',cls:'critical'};if(min>0&&qty<=min)return {label:'Low stock',cls:'low'};return {label:'Normal',cls:'ok'};}
function inventoryDue(assignment, latest){if(!latest)return true;const d=new Date(`${latest.stock_date}T00:00:00`);d.setDate(d.getDate()+Number(assignment.reporting_frequency_days||1));const due=new Date(`${$('inventoryAsOfDate')?.value||today}T00:00:00`);return due>=d;}
function renderInventoryKpis(){const host=$('inventoryKpis');if(!host)return;const scoped=inventoryManager()?inventoryAssignmentsCache:inventoryAssignmentsCache.filter(a=>String(a.branch_id)===String(profile?.branch_id));const latest=inventoryLatestByAssignment();let low=0,pending=0;scoped.forEach(a=>{const s=inventoryStatus(a,latest.get(String(a.id)));if(s.cls==='low'||s.cls==='critical')low++;if(inventoryDue(a,latest.get(String(a.id))))pending++;});const reqPending=inventoryRequestsCache.filter(r=>r.status==='pending').length;const cards=[['Assigned items',scoped.length],['Low / critical',low],['Closing stock due',pending],['Pending procurement',reqPending]];host.innerHTML=cards.map(([l,v])=>`<article><small>${esc(l)}</small><strong>${Number(v).toLocaleString('en-IN')}</strong></article>`).join('');}
function renderInventoryStaff(){const host=$('inventoryClosingRows');if(!host)return;const assignments=inventoryAssignmentsCache.filter(a=>String(a.branch_id)===String(profile?.branch_id));const latest=inventoryLatestByAssignment();if(!assignments.length){host.innerHTML='<p class="inventory-empty">No inventory items have been assigned to this branch yet. Please contact Admin / Management.</p>';return;}host.innerHTML=assignments.map(a=>{const item=a.inventory_items||inventoryItemsCache.find(i=>String(i.id)===String(a.item_id))||{};const old=latest.get(String(a.id));const st=inventoryStatus(a,old);if(inventoryDue(a,old)&&st.cls==='ok'){st.label='Update due';st.cls='pending';}return `<div class="inventory-closing-row" data-inventory-assignment="${esc(a.id)}"><div><strong>${esc(item.item_name||'Inventory item')}</strong><small>${esc(item.category||'')} · ${esc(inventoryUnitLabel(item.unit))} · Min ${inventoryFmtQty(a.min_stock)} ${esc(inventoryUnitLabel(item.unit))} · Every ${Number(a.reporting_frequency_days||1)} day(s)</small></div><div><label>Physical qty</label><input type="number" min="0" step="${['nos','tests'].includes(String(item.unit).toLowerCase())?'1':'0.001'}" required data-inventory-qty="${esc(a.id)}" placeholder="Enter qty" aria-label="Closing quantity for ${esc(item.item_name||'item')}"></div><div><small>Last submitted</small><strong>${old?`${inventoryFmtQty(old.quantity)} ${esc(old.unit||item.unit)}`:'No entry yet'}</strong><small>${old?esc(old.stock_date):'Awaiting first count'}</small></div><span class="inventory-stock-status ${st.cls}">${esc(st.label)}</span></div>`;}).join('');
const countHost=$('inventoryTestCountRows');if(countHost){const existingLines=inventoryDailyCountCache?.inventory_daily_test_count_lines||[];const existingMap=new Map(existingLines.map(l=>[String(l.test_id),Number(l.tests_performed||0)]));const activeTests=inventoryTestsCache.filter(t=>t.active);countHost.innerHTML=activeTests.length?activeTests.map(test=>{const mappings=inventoryTestMappingsCache.filter(m=>String(m.branch_id)===String(profile?.branch_id)&&String(m.test_id)===String(test.id)&&m.active);const stockCaps=mappings.map(m=>{const a=assignments.find(x=>String(x.item_id)===String(m.item_id));const latestRow=a?latest.get(String(a.id)):null;const stock=a?inventoryCurrentQty(a,latestRow):0;return Math.floor(Math.max(0,stock)/Number(m.quantity_per_test||1));});const branchReady=mappings.length>0&&mappings.every(m=>assignments.some(a=>String(a.item_id)===String(m.item_id)));const cap=branchReady&&stockCaps.length?Math.min(...stockCaps):null;const capClass=cap===null?'':cap<=5?'critical':cap<=20?'low':'';const reagentText=mappings.length?mappings.map(m=>{const item=inventoryItemsCache.find(i=>String(i.id)===String(m.item_id));return `${item?.item_name||'Reagent'} · ${inventoryFmtQty(m.quantity_per_test)} ${inventoryUnitLabel(m.unit)}/test`;}).join(' + '):'Mapping required by Admin / Management';return `<div class="inventory-test-count-row"><div><strong>${esc(test.test_name)}</strong><small>${esc(reagentText)}</small></div><label>Tests performed today<input type="number" min="0" step="1" inputmode="numeric" data-inventory-test-count="1" data-test-id="${esc(test.id)}" value="${existingMap.has(String(test.id))?existingMap.get(String(test.id)):''}" placeholder="Enter count" ${branchReady?'':'disabled'}></label><div class="inventory-test-capacity ${capClass}" data-test-capacity="${esc(test.id)}">${!mappings.length?'Mapping required':!branchReady?'Reagent not assigned to this branch':`Remaining capacity: ${cap.toLocaleString('en-IN')} tests`}</div></div>`;}).join(''):'<p class="inventory-empty">No active tests found in the B2B test master.</p>';}
inventoryFillSelect('inventoryRequestItem',assignments.map(a=>({id:a.item_id,item_name:a.inventory_items?.item_name||inventoryItemsCache.find(i=>String(i.id)===String(a.item_id))?.item_name||'Item'})),r=>r.item_name,'Select item');}
function renderInventoryTestMappings(){const rows=$('inventoryTestMappingRows');if(rows){rows.innerHTML=inventoryTestMappingsCache.map(m=>`<tr><td>${esc(inventoryBranchName(m.branch_id))}</td><td>${esc(m.b2b_tests?.test_name||inventoryTestsCache.find(t=>String(t.id)===String(m.test_id))?.test_name||'Test')}</td><td>${esc(m.inventory_items?.item_name||inventoryItemsCache.find(i=>String(i.id)===String(m.item_id))?.item_name||'Item')}</td><td>${inventoryFmtQty(m.quantity_per_test)}</td><td>${esc(inventoryUnitLabel(m.unit))}</td><td>${m.active?'Active':'Inactive'}</td><td><button type="button" class="secondary" data-inventory-map-edit="${esc(m.id)}">Edit</button> <button type="button" class="secondary" data-inventory-map-toggle="${esc(m.id)}">${m.active?'Deactivate':'Activate'}</button></td></tr>`).join('')||'<tr><td colspan="7">No branch-specific test / reagent mappings configured.</td></tr>';}}
function addInventoryMapReagentRow(itemId='',qty='',unit=''){const host=$('inventoryMapReagentRows');if(!host)return;const options=inventoryItemsCache.map(i=>`<option value="${esc(i.id)}" ${String(i.id)===String(itemId)?'selected':''}>${esc(i.item_name)} · ${esc(inventoryUnitLabel(i.unit))}</option>`).join('');const selected=inventoryItemsCache.find(i=>String(i.id)===String(itemId));const row=document.createElement('div');row.className='inventory-map-reagent-row';row.innerHTML=`<select data-map-reagent-item required><option value="">Select reagent</option>${options}</select><input data-map-reagent-qty type="number" min="0.001" step="0.001" required placeholder="Quantity per test" value="${esc(qty)}"><input data-map-reagent-unit type="text" readonly placeholder="Stock unit" value="${esc(selected?inventoryUnitLabel(selected.unit):unit)}"><button type="button" class="secondary" data-map-reagent-remove aria-label="Remove reagent">Remove</button>`;host.appendChild(row);}
async function saveInventoryTestMapping(event){event.preventDefault();if(!inventoryManager())return;const branchId=Number($('inventoryMapBranch').value),testId=Number($('inventoryMapTest').value);const rows=[...$('inventoryMapReagentRows').querySelectorAll('.inventory-map-reagent-row')];if(!branchId||!testId||!rows.length){inventorySetMessage('Choose a branch and B2B test, then add at least one reagent.');return;}const seen=new Set(),payloads=[];for(const row of rows){const itemId=Number(row.querySelector('[data-map-reagent-item]').value),qty=Number(row.querySelector('[data-map-reagent-qty]').value),item=inventoryItemsCache.find(i=>Number(i.id)===itemId),assigned=inventoryAssignmentsCache.some(a=>String(a.branch_id)===String(branchId)&&String(a.item_id)===String(itemId));if(!itemId||!item||!assigned||!Number.isFinite(qty)||qty<=0){inventorySetMessage(!assigned?'Assign every selected reagent to this branch in Branch Item Assignment before mapping it.':'Choose a reagent and enter a positive quantity for every row.');return;}if(seen.has(String(itemId))){inventorySetMessage('The same reagent is selected more than once. Keep one row per reagent.');return;}seen.add(String(itemId));payloads.push({branch_id:branchId,test_id:testId,item_id:itemId,quantity_per_test:qty,unit:item.unit,active:true,created_by:user.id,updated_at:new Date().toISOString()});}const {error}=await db.from('inventory_test_item_mappings').upsert(payloads,{onConflict:'branch_id,test_id,item_id'});if(error){inventorySetMessage(error.message);return;}event.target.reset();$('inventoryMapReagentRows').innerHTML='';addInventoryMapReagentRow();await loadInventoryModule();inventorySetMessage(`${payloads.length} reagent mapping(s) saved for this test and branch.`,true);}
async function handleInventoryTestMappingAction(event){const edit=event.target.closest('[data-inventory-map-edit]');const toggle=event.target.closest('[data-inventory-map-toggle]');const id=(edit||toggle)?.dataset.inventoryMapEdit||(toggle?.dataset.inventoryMapToggle);const row=inventoryTestMappingsCache.find(m=>String(m.id)===String(id));if(!row)return;if(edit){$('inventoryMapBranch').value=String(row.branch_id);$('inventoryMapTest').value=String(row.test_id);$('inventoryMapReagentRows').innerHTML='';addInventoryMapReagentRow(row.item_id,row.quantity_per_test,row.unit);$('inventoryTestMappingForm').scrollIntoView({behavior:'smooth',block:'center'});return;}if(toggle){const {error}=await db.from('inventory_test_item_mappings').update({active:!row.active,updated_at:new Date().toISOString()}).eq('id',row.id);if(error){inventorySetMessage(error.message);return;}await loadInventoryModule();inventorySetMessage(`Mapping ${row.active?'deactivated':'activated'}.`,true);}}
function renderInventoryItemMaster(){const itemRows=$('inventoryItemRows');if(!itemRows)return;const query=String($('inventoryItemSearch')?.value||'').trim().toLowerCase();const category=$('inventoryItemCategoryFilter')?.value||'all';const filtered=inventoryItemsCache.filter(item=>(!query||String(item.item_name||'').toLowerCase().includes(query))&&(category==='all'||String(item.category||'').toLowerCase()===category));const size=Number($('inventoryItemPageSize')?.value||20);const pages=Math.max(1,Math.ceil(filtered.length/size));inventoryItemPage=Math.min(inventoryItemPage,pages-1);const start=inventoryItemPage*size;const shown=filtered.slice(start,start+size);itemRows.innerHTML=shown.map(item=>`<tr><td>${esc(item.item_name)}</td><td>${esc(item.category||'')}</td><td>${esc(inventoryUnitLabel(item.unit))}</td><td>${inventoryFmtQty(item.consumption_per_test||0)}</td><td><button type="button" class="secondary" data-inventory-item-action="edit" data-item-id="${esc(item.id)}">Edit</button></td></tr>`).join('')||'<tr><td colspan="5">No matching inventory items.</td></tr>';const count=$('inventoryItemCount');if(count)count.textContent=`${filtered.length} of ${inventoryItemsCache.length} active items`;const info=$('inventoryItemPageInfo');if(info)info.textContent=filtered.length?`Showing ${start+1}–${Math.min(start+size,filtered.length)} of ${filtered.length}`:'Showing 0 items';if($('inventoryItemPrev'))$('inventoryItemPrev').disabled=inventoryItemPage===0;if($('inventoryItemNext'))$('inventoryItemNext').disabled=inventoryItemPage>=pages-1;}
function renderInventoryManagement(){renderInventoryItemMaster();const latest=inventoryLatestByAssignment();const selectedBranch=$('inventoryBranchFilter')?.value||'';const scopedAssignments=inventoryAssignmentsCache.filter(a=>!selectedBranch||String(a.branch_id)===String(selectedBranch));const scopedRequests=inventoryRequestsCache.filter(r=>!selectedBranch||String(r.branch_id)===String(selectedBranch));const scopedMovements=inventoryMovementsCache.filter(m=>!selectedBranch||String(m.branch_id)===String(selectedBranch));const alerts=[];for(const a of scopedAssignments){const item=a.inventory_items||inventoryItemsCache.find(i=>String(i.id)===String(a.item_id))||{};const last=latest.get(String(a.id));const st=inventoryStatus(a,last);const due=inventoryDue(a,last);if(st.cls!=='ok'||due){alerts.push({a,item,last,st,due});}}
const alertHost=$('inventoryAlertList');if(alertHost){if(!alerts.length){alertHost.innerHTML='<p class="inventory-empty">All assigned inventory is within configured limits and closing stock is up to date.</p>';}else{const grouped=new Map();for(const x of alerts){const key=String(x.a.branch_id);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(x);}alertHost.classList.add('inventory-branch-alert-list');alertHost.innerHTML=[...grouped.entries()].map(([branchId,rows])=>{const critical=rows.filter(x=>x.st.cls==='critical').length,low=rows.filter(x=>x.st.cls==='low').length,due=rows.filter(x=>x.due).length;const details=rows.map(x=>{const qty=x.last?`${inventoryFmtQty(inventoryCurrentQty(x.a,x.last))} ${inventoryUnitLabel(x.item.unit)} (ledger)`:'No closing entry';const cls=x.st.cls==='critical'?'is-critical':x.st.cls==='low'?'is-low':x.due?'is-pending':'';const title=x.st.cls==='critical'?'Zero stock':x.st.cls==='low'?'Below minimum':x.due?'Closing stock overdue':'Stock alert';return `<article class="inventory-alert-card ${cls}"><strong>${esc(x.item.item_name||'Item')}</strong><small>${esc(title)} · Available: ${esc(qty)}</small><small>Minimum: ${inventoryFmtQty(x.a.min_stock)} ${esc(inventoryUnitLabel(x.item.unit))} · Frequency: ${Number(x.a.reporting_frequency_days||1)} day(s) · Last count: ${x.last?esc(x.last.stock_date):'Never submitted'}</small></article>`;}).join('');return `<details class="inventory-branch-alert"><summary><span><strong>${esc(inventoryBranchName(branchId))}</strong><small>${rows.length} item alert(s) · ${due} closing due · ${low+critical} low / critical</small></span><span class="inventory-branch-alert-count">${rows.length} alerts</span></summary><div class="inventory-branch-alert-items">${details}</div></details>`;}).join('');}}
const assignRows=$('inventoryAssignmentRows');if(assignRows){const q=String($('inventoryAssignmentSearch')?.value||'').trim().toLowerCase();const filteredAssignments=scopedAssignments.filter(a=>{const item=a.inventory_items||inventoryItemsCache.find(i=>String(i.id)===String(a.item_id))||{};return !q||String(item.item_name||'').toLowerCase().includes(q)||inventoryBranchName(a.branch_id).toLowerCase().includes(q);});const pageSize=Number($('inventoryAssignmentPageSize')?.value||10);const pageCount=Math.max(1,Math.ceil(filteredAssignments.length/pageSize));inventoryAssignmentPage=Math.min(inventoryAssignmentPage,pageCount-1);const start=inventoryAssignmentPage*pageSize;const pageRows=filteredAssignments.slice(start,start+pageSize);assignRows.innerHTML=pageRows.map(a=>{const item=a.inventory_items||inventoryItemsCache.find(i=>String(i.id)===String(a.item_id))||{};const last=latest.get(String(a.id));const qty=last?inventoryCurrentQty(a,last):null;const st=inventoryStatus(a,last);return `<tr><td>${esc(inventoryBranchName(a.branch_id))}</td><td><strong>${esc(item.item_name||'—')}</strong><small class="inventory-register-sub">${esc(item.category||'')} · ${esc(inventoryUnitLabel(item.unit))} · Last: ${last?esc(last.stock_date):'Never'}</small></td><td>${qty===null?'—':`${inventoryFmtQty(qty)} ${esc(inventoryUnitLabel(item.unit))}`}</td><td>${inventoryFmtQty(a.min_stock)} ${esc(inventoryUnitLabel(item.unit))}</td><td>${inventoryFmtQty(a.reorder_qty)} · ${Number(a.reporting_frequency_days||1)}d</td><td><span class="inventory-status-pill ${st.cls==='critical'||st.cls==='low'?'rejected':st.cls==='pending'?'pending':'approved'}">${esc(st.label)}</span></td></tr>`;}).join('')||'<tr><td colspan="6">No branch assignments match your search.</td></tr>';const info=$('inventoryAssignmentPageInfo');if(info)info.textContent=filteredAssignments.length?`Showing ${start+1}–${Math.min(start+pageSize,filteredAssignments.length)} of ${filteredAssignments.length} assignments`:'Showing 0 assignments';if($('inventoryAssignmentPrev'))$('inventoryAssignmentPrev').disabled=inventoryAssignmentPage===0;if($('inventoryAssignmentNext'))$('inventoryAssignmentNext').disabled=inventoryAssignmentPage>=pageCount-1;}
const requests=$('inventoryPurchaseRows');if(requests)requests.innerHTML=scopedRequests.map(r=>{const lines=r.inventory_purchase_request_lines||[];const itemText=lines.map(l=>`${l.inventory_items?.item_name||'Item'}: ${inventoryFmtQty(l.requested_qty)} ${inventoryUnitLabel(l.unit)}`).join('<br>');const actions=r.status==='pending'?`<button type="button" data-inventory-request-action="approved" data-request-id="${esc(r.id)}">Approve</button><button type="button" class="secondary" data-inventory-request-action="rejected" data-request-id="${esc(r.id)}">Reject</button>`:r.status==='approved'?`<button type="button" data-inventory-request-action="received" data-request-id="${esc(r.id)}">Mark received</button>`:'—';return `<tr><td>${esc(inventoryDate(r.created_at))}</td><td>${esc(inventoryBranchName(r.branch_id))}</td><td>${itemText||'—'}</td><td><span class="inventory-status-pill ${esc(r.status)}">${esc(r.status)}</span></td><td>${esc(r.notes||'')}</td><td><div class="inventory-action-group">${actions}</div></td></tr>`;}).join('')||'<tr><td colspan="6">No procurement requests found.</td></tr>';
const movements=$('inventoryMovementRows');if(movements)movements.innerHTML=scopedMovements.map(m=>`<tr><td>${esc(inventoryDate(m.movement_date))}</td><td>${esc(inventoryBranchName(m.branch_id))}</td><td>${esc(m.inventory_items?.item_name||'Item')}</td><td>${esc(m.movement_type)}</td><td>${inventoryFmtQty(m.quantity)} ${esc(inventoryUnitLabel(m.inventory_items?.unit))}</td><td>${esc(m.reference||m.remarks||'—')}</td></tr>`).join('')||'<tr><td colspan="6">No stock movements recorded yet.</td></tr>';
}
async function loadInventoryModule(){if(!db||!profile)return;inventorySetMessage('Loading inventory…',true);try{
const [itemsRes,assignRes,entryRes,requestRes,movementRes,testsRes,mappingsRes,countRes]=await Promise.all([
db.from('inventory_items').select('id,item_name,category,unit,active,consumption_per_test,purchase_unit,purchase_to_base_factor').eq('active',true).order('item_name'),
db.from('inventory_branch_assignments').select('id,branch_id,item_id,min_stock,reorder_qty,reporting_frequency_days,active,inventory_items(id,item_name,category,unit,consumption_per_test)').eq('active',true),
db.from('inventory_stock_entries').select('id,branch_id,stock_date,submitted_at,inventory_stock_entry_lines(assignment_id,quantity,unit)').order('stock_date',{ascending:false}).limit(250),
db.from('inventory_purchase_requests').select('id,branch_id,status,notes,created_at,inventory_purchase_request_lines(id,item_id,requested_qty,approved_qty,received_qty,unit,inventory_items(item_name))').order('created_at',{ascending:false}).limit(100),
db.from('inventory_movements').select('id,branch_id,item_id,movement_type,quantity,movement_date,reference,remarks,inventory_items(item_name,unit)').order('movement_date',{ascending:false}).limit(1000),
db.from('b2b_tests').select('id,test_name,active').eq('active',true).order('test_name'),
db.from('inventory_test_item_mappings').select('id,branch_id,test_id,item_id,quantity_per_test,unit,active,b2b_tests(test_name),inventory_items(item_name,unit)').not('branch_id','is',null).order('branch_id').order('test_id'),
(inventoryManager()?Promise.resolve({data:null,error:null}):db.from('inventory_daily_test_counts').select('id,branch_id,count_date,inventory_daily_test_count_lines(id,test_id,test_name_snapshot,tests_performed)').eq('branch_id',Number(profile?.branch_id||0)).eq('count_date',$('inventoryAsOfDate')?.value||today).maybeSingle())
]);
for(const [name,res] of [['items',itemsRes],['assignments',assignRes],['closing entries',entryRes],['purchase requests',requestRes],['movements',movementRes],['B2B tests',testsRes],['test mappings',mappingsRes],['daily test counts',countRes]])if(res.error)throw new Error(`${name}: ${res.error.message}`);
inventoryItemsCache=itemsRes.data||[];inventoryAssignmentsCache=assignRes.data||[];inventoryEntriesCache=entryRes.data||[];inventoryRequestsCache=requestRes.data||[];inventoryMovementsCache=movementRes.data||[];inventoryTestsCache=testsRes.data||[];inventoryTestMappingsCache=mappingsRes.data||[];inventoryDailyCountCache=countRes.data||null;
if(!inventoryManager()){inventoryAssignmentsCache=inventoryAssignmentsCache.filter(a=>String(a.branch_id)===String(profile.branch_id));inventoryEntriesCache=inventoryEntriesCache.filter(e=>String(e.branch_id)===String(profile.branch_id));inventoryRequestsCache=inventoryRequestsCache.filter(r=>String(r.branch_id)===String(profile.branch_id));inventoryMovementsCache=inventoryMovementsCache.filter(m=>String(m.branch_id)===String(profile.branch_id));}
renderInventoryKpis();renderInventoryTestMappings();renderInventoryStaff();if(inventoryManager())renderInventoryManagement();
const branchOpts=branches.map(b=>({id:b.id,branch_name:`${b.network} — ${b.branch_name}`}));inventoryFillSelect('inventoryAssignBranch',branchOpts,b=>b.branch_name,'Select branch');inventoryFillSelect('inventoryMovementBranch',branchOpts,b=>b.branch_name,'Select branch');inventoryFillSelect('inventoryBranchFilter',branchOpts,b=>b.branch_name,'All branches');inventoryFillSelect('inventoryAssignItem',inventoryItemsCache,i=>`${i.item_name} · ${i.category} · ${inventoryUnitLabel(i.unit)}`,'Select item');inventoryFillSelect('inventoryMapBranch',branchOpts,b=>b.branch_name,'Select branch');inventoryFillSelect('inventoryMapTest',inventoryTestsCache,t=>t.test_name,'Select B2B test');if($('inventoryMapReagentRows')&&!$('inventoryMapReagentRows').children.length)addInventoryMapReagentRow();inventoryFillSelect('inventoryMovementItem',inventoryItemsCache,i=>`${i.item_name} · ${inventoryUnitLabel(i.unit)}`,'Select item');
const staffPanel=$('inventoryStaffPanel'),managerPanel=$('inventoryManagementPanel');staffPanel?.classList.toggle('hidden',inventoryManager());managerPanel?.classList.toggle('hidden',!inventoryManager());$('inventoryBranchFilterWrap')?.classList.toggle('hidden',!inventoryManager());
if($('inventoryStaffHistory')){$('inventoryStaffHistory').innerHTML=inventoryEntriesCache.slice(0,8).map(e=>`<div class="inventory-history-row"><span><strong>${esc(e.stock_date)}</strong><br><small>${(e.inventory_stock_entry_lines||[]).length} item quantities submitted</small></span><span class="inventory-status-pill received">Submitted</span></div>`).join('')||'<p class="inventory-empty">No closing stock history yet.</p>';}
if($('inventoryStaffRequests')){$('inventoryStaffRequests').innerHTML=inventoryRequestsCache.slice(0,8).map(r=>`<div class="inventory-history-row"><span><strong>${esc(inventoryDate(r.created_at))} · ${esc(r.inventory_purchase_request_lines?.length||0)} item(s)</strong><br><small>${esc(r.notes||'Procurement request')}</small></span><span class="inventory-status-pill ${esc(r.status)}">${esc(r.status)}</span></div>`).join('')||'<p class="inventory-empty">No procurement requests yet.</p>'; }
inventorySetMessage('Inventory data loaded successfully.',true);
}catch(error){console.error('Inventory load error:',error);inventorySetMessage(`Could not load inventory: ${error.message||error}`);}}
function resetInventoryItemForm(){inventoryEditingItemId=null;$('inventoryItemForm')?.reset();$('inventoryItemForm')?.classList.add('hidden');if($('inventoryItemConsumption'))$('inventoryItemConsumption').value='0';if($('inventoryItemSubmitButton'))$('inventoryItemSubmitButton').textContent='Add item';$('inventoryItemCancel')?.classList.add('hidden');if($('inventoryItemUnit'))$('inventoryItemUnit').disabled=false;}
function handleInventoryItemAction(event){const button=event.target.closest('[data-inventory-item-action="edit"]');if(!button)return;const item=inventoryItemsCache.find(x=>String(x.id)===String(button.dataset.itemId));if(!item)return;inventoryEditingItemId=String(item.id);$('inventoryItemName').value=item.item_name||'';$('inventoryItemCategory').value=item.category||'reagent';$('inventoryItemUnit').value=item.unit||'ml';$('inventoryItemConsumption').value=Number(item.consumption_per_test||0);const hasAssignments=inventoryAssignmentsCache.some(a=>String(a.item_id)===String(item.id));$('inventoryItemUnit').disabled=hasAssignments;$('inventoryItemSubmitButton').textContent='Update item';$('inventoryItemCancel')?.classList.remove('hidden');$('inventoryItemForm')?.classList.remove('hidden');$('inventoryItemForm')?.scrollIntoView({behavior:'smooth',block:'center'});inventorySetMessage(hasAssignments?'Editing item. Base unit is locked because this item is already assigned to branches; change only if no stock history depends on it.':'Editing existing inventory item.');}
async function saveInventoryItem(event){event.preventDefault();if(!inventoryManager())return;const payload={item_name:$('inventoryItemName').value.trim(),category:$('inventoryItemCategory').value,consumption_per_test:Number($('inventoryItemConsumption').value||0)};if(!payload.item_name){inventorySetMessage('Enter an inventory item name.');return;}if(!Number.isFinite(payload.consumption_per_test)||payload.consumption_per_test<0){inventorySetMessage('Enter a valid non-negative consumption per test.');return;}const wasEditing=Boolean(inventoryEditingItemId);let result;if(inventoryEditingItemId){const hasAssignments=inventoryAssignmentsCache.some(a=>String(a.item_id)===String(inventoryEditingItemId));if(!hasAssignments)payload.unit=$('inventoryItemUnit').value;result=await db.from('inventory_items').update(payload).eq('id',inventoryEditingItemId);}else{payload.unit=$('inventoryItemUnit').value;payload.active=true;payload.created_by=user.id;result=await db.from('inventory_items').insert(payload);}if(result.error){inventorySetMessage(result.error.message);return;}resetInventoryItemForm();await loadInventoryModule();inventorySetMessage(wasEditing?'Inventory item updated successfully.':'Inventory item added.',true);}
async function saveInventoryAssignment(event){event.preventDefault();if(!inventoryManager())return;const payload={branch_id:Number($('inventoryAssignBranch').value),item_id:Number($('inventoryAssignItem').value),min_stock:Number($('inventoryMinStock').value),reorder_qty:Number($('inventoryReorderQty').value),reporting_frequency_days:Number($('inventoryFrequency').value),active:true};if(!payload.branch_id||!payload.item_id||payload.reporting_frequency_days<1){inventorySetMessage('Select a branch, item and valid reporting frequency.');return;}const {error}=await db.from('inventory_branch_assignments').upsert(payload,{onConflict:'branch_id,item_id'});if(error){inventorySetMessage(error.message);return;}await loadInventoryModule();inventorySetMessage('Branch inventory assignment saved.',true);}
async function submitInventoryClosing(){const branchId=inventoryManager()?Number($('inventoryBranchFilter').value):Number(profile?.branch_id);if(!branchId){inventorySetMessage('Select the branch for this closing stock entry.');return;}const lines=[...document.querySelectorAll('[data-inventory-qty]')].map(input=>({assignment_id:Number(input.dataset.inventoryQty),quantity:input.value===''?null:Number(input.value)}));if(!lines.length||lines.some(x=>x.quantity===null||!Number.isFinite(x.quantity)||x.quantity<0)){inventorySetMessage('Enter a valid physical quantity for every assigned item. Use 0 for zero stock.');return;}const {data,error}=await db.rpc('inventory_submit_closing_stock',{p_branch_id:branchId,p_stock_date:$('inventoryAsOfDate').value||today,p_remarks:$('inventoryClosingRemarks').value.trim(),p_lines:lines});if(error){inventorySetMessage(error.message);return;}$('inventoryClosingRemarks').value='';await loadInventoryModule();inventorySetMessage('Closing stock submitted and saved to history.',true);}
async function submitInventoryTestCounts(){
  const branchId=Number(profile?.branch_id);if(!branchId||inventoryManager()){inventorySetMessage('Daily test counts can be submitted by branch staff only.');return;}
  const date=$('inventoryAsOfDate')?.value||today;const inputs=[...document.querySelectorAll('[data-inventory-test-count]')];
  const counts=inputs.map(i=>({test_id:Number(i.dataset.testId),tests_performed:i.value.trim()===''?0:Number(i.value)}));
  if(counts.some(x=>!Number.isInteger(x.tests_performed)||x.tests_performed<0)){inventorySetMessage('Test counts must be whole numbers greater than or equal to zero.');return;}
  if(!counts.length){inventorySetMessage('No active B2B tests are available.');return;}
  const {error}=await db.rpc('inventory_save_daily_test_counts',{p_branch_id:branchId,p_count_date:date,p_counts:counts,p_remarks:''});
  if(error){inventorySetMessage(`Test-count submission failed: ${error.message}`);return;}
  await loadInventoryModule();inventorySetMessage('Daily test counts saved. Stock deductions or correction adjustments have been posted to the branch ledger.',true);
}
async function submitInventoryPurchase(event){event.preventDefault();const itemId=Number($('inventoryRequestItem').value),qty=Number($('inventoryRequestQty').value);if(!itemId||!Number.isFinite(qty)||qty<=0){inventorySetMessage('Select an item and enter a requested quantity.');return;}const {data,error}=await db.rpc('inventory_create_purchase_request',{p_branch_id:Number(profile.branch_id),p_notes:$('inventoryRequestNotes').value.trim(),p_lines:[{item_id:itemId,requested_qty:qty}]});if(error){inventorySetMessage(error.message);return;}event.target.reset();await loadInventoryModule();inventorySetMessage('Procurement request sent to Management for approval.',true);}
async function handleInventoryRequestAction(event){const button=event.target.closest('[data-inventory-request-action]');if(!button)return;const id=button.dataset.requestId,action=button.dataset.inventoryRequestAction;let result;if(action==='received'){const request=inventoryRequestsCache.find(r=>String(r.id)===String(id));const lines=(request?.inventory_purchase_request_lines||[]).map(l=>({line_id:l.id,received_qty:Number(l.approved_qty??l.requested_qty)}));result=await db.rpc('inventory_receive_purchase_request',{p_request_id:id,p_lines:lines,p_notes:'Received and entered through Inventory & Procurement module'});}else result=await db.rpc('inventory_review_purchase_request',{p_request_id:id,p_action:action,p_notes:''});if(result.error){inventorySetMessage(result.error.message);return;}await loadInventoryModule();inventorySetMessage(action==='approved'?'Purchase request approved.':action==='rejected'?'Purchase request rejected.':'Receipt recorded and added to stock ledger.',true);}
async function saveInventoryMovement(event){event.preventDefault();if(!inventoryManager())return;const payload={branch_id:Number($('inventoryMovementBranch').value),item_id:Number($('inventoryMovementItem').value),movement_type:$('inventoryMovementType').value,quantity:Number($('inventoryMovementQty').value),movement_date:$('inventoryMovementDate').value||today,remarks:$('inventoryMovementNotes').value.trim(),created_by:user.id};if(!payload.branch_id||!payload.item_id||!Number.isFinite(payload.quantity)||payload.quantity<=0){inventorySetMessage('Complete all stock movement fields with a positive quantity.');return;}const {error}=await db.from('inventory_movements').insert(payload);if(error){inventorySetMessage(error.message);return;}event.target.reset();$('inventoryMovementDate').value=today;await loadInventoryModule();inventorySetMessage('Stock movement recorded successfully.',true);}

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
  const nextMonth = month === 12 ? `${year+1}-01-01` : `${year}-${String(month+1).padStart(2,'0')}-01`;
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

// Previous-month comparison is best-effort and must never block login or dashboard loading.
async function loadOverviewPreviousPeriodReports() {
  const selectedMonth=$('performanceMonth')?.value || today.slice(0,7);
  const [year,month]=selectedMonth.split('-').map(Number);
  const prevYear=month===1?year-1:year;
  const prevMonth=month===1?12:month-1;
  const prevStart=`${prevYear}-${String(prevMonth).padStart(2,'0')}-01`;
  const elapsedDay=selectedMonth===today.slice(0,7)?Number(today.slice(8,10)):new Date(year,month,0).getDate();
  const prevEndDay=Math.min(elapsedDay,new Date(prevYear,prevMonth,0).getDate());
  const endDate=new Date(prevYear,prevMonth-1,prevEndDay+1);
  const endExclusive=`${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}`;
  let all=[],from=0,pageSize=500;
  while(true){
    const {data,error}=await db.from('daily_reports').select('id,branch_id,report_date,total_sales,patient_count,status')
      .gte('report_date',prevStart).lt('report_date',endExclusive).order('report_date',{ascending:false}).range(from,from+pageSize-1);
    if(error)throw error;
    all=all.concat(data||[]);
    if(!data||data.length<pageSize)break;
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
  try { overviewPreviousReports = await loadOverviewPreviousPeriodReports(); } catch (comparisonError) { overviewPreviousReports = []; }
  renderOverview();
  refreshSidebarVisibility();
  await renderCompliance(reports);
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
  $('complianceRows').innerHTML='<tr><td colspan="8">Checking submitted reports…</td></tr>';
  const [{data,error},{data:testCountData,error:testCountError}]=await Promise.all([
    db.from('daily_reports').select('id,branch_id,report_date,total_sales,patient_count,status').eq('report_date',date),
    db.from('inventory_daily_test_counts').select('id,branch_id,count_date').eq('count_date',date)
  ]);
  if(error || testCountError) {
    const issue=error||testCountError;
    $('complianceRows').innerHTML = '<tr><td colspan="8">' + esc(issue.message) + '</td></tr>';
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
    const testCountMatches=(testCountData||[]).filter(r=>String(r.branch_id)===String(b.id));
    const testCountSubmitted=testCountMatches.length>0;
    const testCountStatus=testCountSubmitted?'Submitted':'Missing';
    const testCountAction=testCountSubmitted?'Daily test counts received':'Request daily test-count submission';
    return {...b,matches:matches.length,submitted,sales,patients,status,cls,action,testCountMatches:testCountMatches.length,testCountSubmitted,testCountStatus,testCountAction};
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
    'Sales reports submitted: ' + submitted + '/' + rows.length + ' | Missing: ' + missing + ' | Needs review: ' + review,
    'Daily test consumption submitted: ' + rows.filter(r=>r.testCountSubmitted).length + '/' + rows.length + ' | Missing: ' + rows.filter(r=>!r.testCountSubmitted).length,
    ...rows.map(r => (r.branch_name || 'Branch') + ' (' + r.network + '): Sales ' + r.status + ' | Test consumption ' + r.testCountStatus + ' | Reports: ' + r.matches + ' | Sales: ' + money(r.sales) + ' | Patients: ' + r.patients + ' | ' + r.action + '; ' + r.testCountAction)
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
    '<td><strong>'+esc(r.branch_name||'Branch')+'</strong></td>'+ '<td><span class="compliance-network '+(String(r.network||'').toUpperCase()==='NEETHI'?'neethi':'unomed')+'">'+esc(r.network||'')+'</span></td>'+ '<td><span class="compliance-status '+(r.status==='Submitted'?'good':r.status==='Missing'?'bad':'warn')+'"><i></i>'+esc(r.status)+'</span></td>'+ '<td>'+r.matches+'</td>'+ '<td>'+money(r.sales)+'</td>'+ '<td>'+Number(r.patients||0).toLocaleString('en-IN')+'</td>'+ '<td><span class="compliance-status '+(r.testCountSubmitted?'good':'bad')+'"><i></i>'+esc(r.testCountStatus)+'</span></td>'+ '<td class="compliance-action">'+esc(r.action)+'<br><small>'+esc(r.testCountAction)+'</small></td></tr>').join('')||'<tr><td colspan="8" class="compliance-empty">No branches match these filters.</td></tr>';
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


function broadcastCanManage(){return ['admin','management'].includes(String(profile?.role||'').toLowerCase());}
function populateBroadcastBranchOptions(){
  const host=$('broadcastBranchOptions');if(!host)return;
  host.innerHTML=(branches||[]).filter(b=>b.active!==false).map(b=>`<label><input type="checkbox" value="${b.id}"> ${esc(b.network)} · ${esc(b.branch_name)}</label>`).join('');
}
function broadcastEscape(s){return esc(String(s||''));}
function broadcastCurrentAudience(item){
  const ids=Array.isArray(item.audience_branch_ids)?item.audience_branch_ids.map(String):[];
  return !ids.length || profile?.role!=='branch_staff' || ids.includes(String(profile?.branch_id));
}
function broadcastVisibleNow(item){
  const nowTs=Date.now(), start=item.starts_at?new Date(item.starts_at).getTime():0, end=item.ends_at?new Date(item.ends_at).getTime():Infinity;
  return item.published===true && start<=nowTs && end>=nowTs && broadcastCurrentAudience(item);
}
async function loadBroadcastDisplay(){
  if(!db)return;
  const panel=$('broadcastOverview'),stage=$('broadcastOverviewStage');
  if(!panel||!stage)return;
  try{
    // Avoid ordering by optional/generated columns: some live deployments may not yet have them.
    const {data,error}=await db.from('broadcast_announcements')
      .select('id,title,message,content_type,priority,media_url,media_type,audience_branch_ids,starts_at,ends_at,display_seconds,created_at,published')
      .eq('published',true)
      .order('created_at',{ascending:false})
      .limit(100);
    if(error)throw error;
    const now=Date.now();
    const branchId=profile?.branch_id==null?null:String(profile.branch_id);
    broadcastItemsCache=(data||[])
      .filter(item=>{
        const from=item.starts_at?new Date(item.starts_at).getTime():0;
        const until=item.ends_at?new Date(item.ends_at).getTime():Infinity;
        const audience=Array.isArray(item.audience_branch_ids)?item.audience_branch_ids.map(String):[];
        const audienceMatch=audience.length===0 || (branchId!==null && audience.includes(branchId));
        return item.published===true && from<=now && until>=now && audienceMatch;
      })
      .sort((a,b)=>{
        const rank={emergency:3,important:2,normal:1};
        return (rank[b.priority]||1)-(rank[a.priority]||1) ||
          new Date(b.created_at||0)-new Date(a.created_at||0);
      });
    broadcastActiveIndex=0;
    renderBroadcastDisplay();
  }catch(error){
    console.error('Broadcast display load failed:',error);
    // Show a useful diagnostic on the branch Overview instead of failing silently.
    panel.classList.remove('hidden');
    stage.innerHTML=`<div class="broadcast-empty"><strong>Announcements temporarily unavailable</strong><span>${broadcastEscape(error?.message||'Unable to load announcements. Please refresh or contact Admin.')}</span></div>`;
    const ticker=$('broadcastTickerText');if(ticker)ticker.textContent='Broadcast connection needs attention.';
  }
}
function renderBroadcastDisplay(){
  const panel=$('broadcastOverview'),stage=$('broadcastOverviewStage');if(!panel||!stage)return;
  const items=broadcastItemsCache;
  if(!items.length){panel.classList.add('hidden');if(broadcastTimer){clearTimeout(broadcastTimer);broadcastTimer=null;}return;}
  panel.classList.remove('hidden');
  if(broadcastActiveIndex>=items.length)broadcastActiveIndex=0;
  const item=items[broadcastActiveIndex];
  const media=item.media_url?(item.media_type?.startsWith('video')?`<video class="broadcast-media" src="${broadcastEscape(item.media_url)}" autoplay muted playsinline controls></video>`:`<img class="broadcast-media" src="${broadcastEscape(item.media_url)}" alt="${broadcastEscape(item.title)}">`):'';
  const kind=item.priority==='emergency'||item.content_type==='alert'?'EMERGENCY ALERT':item.content_type==='service'?'NEW SERVICE':String(item.content_type||'UPDATE').replaceAll('_',' ').toUpperCase();
  stage.innerHTML=`<div class="broadcast-slide ${item.priority==='emergency'?'is-emergency':''}"><div class="broadcast-slide-copy"><span class="broadcast-slide-tag">${broadcastEscape(kind)}</span><h2>${broadcastEscape(item.title)}</h2><p>${broadcastEscape(item.message).replace(/\n/g,'<br>')}</p><small>${item.priority==='emergency'?'PLEASE TAKE IMMEDIATE NOTE':'UNOMED + NEETHI · NETWORK COMMUNICATION'}</small></div>${media?`<div class="broadcast-slide-media">${media}</div>`:''}</div>`;
  $('broadcastOverviewCounter').textContent=`${broadcastActiveIndex+1} / ${items.length} · ${kind}`;
  const ticker=$('broadcastTickerText');if(ticker)ticker.textContent=`${item.title} — ${item.message}`;
  if(broadcastTimer)clearTimeout(broadcastTimer);
  const duration=Math.max(5,Math.min(60,Number(item.display_seconds)||12))*1000;
  broadcastTimer=setTimeout(()=>{broadcastActiveIndex=(broadcastActiveIndex+1)%broadcastItemsCache.length;renderBroadcastDisplay();},duration);
}
async function loadBroadcastStudio(){
  if(!broadcastCanManage())return;
  populateBroadcastBranchOptions();
  const host=$('broadcastLibraryRows');if(!host)return;
  host.innerHTML='<p>Loading announcements…</p>';
  const {data,error}=await db.from('broadcast_announcements').select('*').order('created_at',{ascending:false}).limit(200);
  if(error){host.innerHTML=`<p class="broadcast-error">${broadcastEscape(error.message)}</p>`;return;}
  host.innerHTML=(data||[]).map(x=>`<div class="broadcast-library-row"><div><strong>${broadcastEscape(x.title)}</strong><small>${broadcastEscape(x.content_type)} · ${broadcastEscape(x.priority)} · ${x.published?'Published':'Draft'} · ${new Date(x.starts_at).toLocaleString('en-IN')}</small></div><span class="broadcast-status ${x.published?'published':'draft'}">${x.published?'LIVE':'DRAFT'}</span><button type="button" class="secondary" data-broadcast-toggle="${x.id}" data-published="${x.published?'true':'false'}">${x.published?'Unpublish':'Publish'}</button><button type="button" class="secondary" data-broadcast-delete="${x.id}">Delete</button></div>`).join('')||'<p>No announcements yet. Create your first broadcast above.</p>';
}
function broadcastUpdatePreview(){
  const title=$('broadcastTitle')?.value.trim()||'Your headline will appear here',message=$('broadcastMessage')?.value.trim()||'Your announcement message will appear here.',type=$('broadcastType')?.value||'message',priority=$('broadcastPriority')?.value||'normal';
  const box=$('broadcastComposerPreview');if(!box)return;
  box.className=`broadcast-composer-preview ${priority==='emergency'?'is-emergency':''}`;
  box.innerHTML=`<span class="broadcast-preview-label">${broadcastEscape(priority==='emergency'?'EMERGENCY ALERT':type.toUpperCase())}</span><h3>${broadcastEscape(title)}</h3><p>${broadcastEscape(message)}</p>`;
}
function broadcastVisualBrief(){
  const title=$('broadcastTitle')?.value.trim(),message=$('broadcastMessage')?.value.trim();if(!title||!message){$('broadcastFormMsg').textContent='Enter a title and message first.';return;}
  const type=$('broadcastType').value;
  $('broadcastAiOutput').value=`Create a premium, high-resolution 16:9 digital signage visual for UNOMED + NEETHI healthcare network. Main headline: "${title}". Core information: "${message}". Content format: ${type}. Use a polished medical-corporate visual language, clear typography, strong contrast, elegant clinical imagery, navy/teal palette with restrained brand red accents, generous whitespace, and a clear visual hierarchy. Keep all wording accurate and do not invent medical claims, test availability, prices, dates or contact details. Ensure the message is readable on a large TV display.`;
  $('broadcastFormMsg').textContent='AI visual brief prepared. Use it with your approved image/video generator, then upload the result.';
}
async function submitBroadcast(event){
  event.preventDefault();if(!broadcastCanManage()||broadcastUploadBusy)return;
  const title=$('broadcastTitle').value.trim(),message=$('broadcastMessage').value.trim(),file=$('broadcastMedia').files?.[0]||null;
  const starts=new Date($('broadcastStarts').value),ends=new Date($('broadcastEnds').value);
  if(!title||!message){$('broadcastFormMsg').textContent='Enter a title and message.';return;}
  if(!Number.isFinite(starts.getTime())||!Number.isFinite(ends.getTime())||ends<=starts){$('broadcastFormMsg').textContent='Choose a valid display period.';return;}
  const audience=$('broadcastAudience').value;const selected=[...document.querySelectorAll('#broadcastBranchOptions input:checked')].map(x=>Number(x.value));
  if(audience==='selected'&&!selected.length){$('broadcastFormMsg').textContent='Select at least one branch.';return;}
  if(file&&file.size>100*1024*1024){$('broadcastFormMsg').textContent='Media file must be 100 MB or smaller.';return;}
  broadcastUploadBusy=true;$('broadcastPublishBtn').disabled=true;$('broadcastFormMsg').textContent='Publishing…';
  try{
    let mediaUrl=null,mediaType=null;
    if(file){
      const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_'),path=`${user.id}/${Date.now()}-${safe}`;
      const {data:up,error:upErr}=await db.storage.from('broadcast-media').upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type});
      if(upErr)throw upErr;
      const {data:pub}=db.storage.from('broadcast-media').getPublicUrl(up.path);mediaUrl=pub.publicUrl;mediaType=file.type;
    }
    const payload={title,message,content_type:$('broadcastType').value,priority:$('broadcastPriority').value,media_url:mediaUrl,media_type:mediaType,audience_branch_ids:audience==='all'?[]:selected,starts_at:starts.toISOString(),ends_at:ends.toISOString(),display_seconds:Number($('broadcastDuration').value)||12,published:true,created_by:user.id};
    const {error}=await db.from('broadcast_announcements').insert(payload);if(error)throw error;
    $('broadcastForm').reset();$('broadcastAiOutput').value='';$('broadcastBranchTargets').classList.add('hidden');broadcastUpdatePreview();
    $('broadcastFormMsg').textContent='Announcement published successfully.';await loadBroadcastStudio();await loadBroadcastDisplay();
  }catch(err){$('broadcastFormMsg').textContent=err.message||'Unable to publish announcement.';}
  finally{broadcastUploadBusy=false;$('broadcastPublishBtn').disabled=false;}
}
function initBroadcastModule(){
  $('broadcastForm')?.addEventListener('submit',submitBroadcast);
  ['broadcastTitle','broadcastMessage','broadcastType','broadcastPriority'].forEach(id=>$(id)?.addEventListener('input',broadcastUpdatePreview));
  $('broadcastAiBrief')?.addEventListener('click',broadcastVisualBrief);
  $('broadcastAudience')?.addEventListener('change',e=>$('broadcastBranchTargets').classList.toggle('hidden',e.target.value!=='selected'));
  $('broadcastRefresh')?.addEventListener('click',()=>loadBroadcastStudio());
  $('broadcastLibraryRows')?.addEventListener('click',async e=>{
    const t=e.target.closest('[data-broadcast-toggle]');const d=e.target.closest('[data-broadcast-delete]');
    if(t){const next=t.dataset.published!=='true';const {error}=await db.from('broadcast_announcements').update({published:next}).eq('id',t.dataset.broadcastToggle);if(error){$('broadcastFormMsg').textContent=error.message;return;}await loadBroadcastStudio();await loadBroadcastDisplay();}
    if(d&&confirm('Delete this announcement?')){const {error}=await db.from('broadcast_announcements').delete().eq('id',d.dataset.broadcastDelete);if(error){$('broadcastFormMsg').textContent=error.message;return;}await loadBroadcastStudio();await loadBroadcastDisplay();}
  });
  $('broadcastStarts').value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  $('broadcastEnds').value=new Date(Date.now()+7*86400000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  broadcastUpdatePreview();
}

function renderOverviewSalesChart(rows, staff=false){
  const host=$('overviewTrend');if(!host)return;
  const width=920,height=270,left=66,right=22,top=22,bottom=42,plotW=width-left-right,plotH=height-top-bottom;
  const series=staff?[{key:'group',name:'Your branch',color:'#16a085'}]:[
    {key:'group',name:'Group total',color:'#163b67'},
    {key:'unomed',name:'UNOMED',color:'#2877c7'},
    {key:'neethi',name:'NEETHI',color:'#d12c59'}
  ];
  const maxValue=Math.max(0,...rows.flatMap(r=>staff?[r.total]:[r.total,r.unomed,r.neethi]));
  const ceiling=maxValue>0?Math.ceil(maxValue/10000)*10000:10000;
  const x=i=>left+(rows.length<=1?plotW/2:i*plotW/(rows.length-1));
  const y=v=>top+plotH-(Math.max(0,v)/ceiling)*plotH;
  const compact=v=>v>=100000?`₹${(v/100000).toFixed(v>=1000000?0:1)}L`:v>=1000?`₹${(v/1000).toFixed(0)}k`:`₹${Math.round(v)}`;
  const grid=[0,.25,.5,.75,1].map(f=>{const val=ceiling*f,yy=top+plotH-f*plotH;return `<g class="ov-chart-grid"><line x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}"/><text x="${left-10}" y="${yy+4}" text-anchor="end">${compact(val)}</text></g>`;}).join('');
  const xLabels=rows.map((r,i)=>{const showLabel=rows.length<=14||i===0||i===rows.length-1||i%Math.ceil(rows.length/7)===0;return showLabel?`<text class="ov-chart-xlabel" x="${x(i)}" y="${height-13}" text-anchor="middle">${r.key.slice(8)}</text>`:'';}).join('');
  const lines=series.map(s=>{
    const visible=overviewChartVisible[s.key]!==false;
    if(!visible)return '';
    const vals=rows.map(r=>s.key==='group'?(staff?r.total:r.total):r[s.key]);
    const path=vals.map((v,i)=>`${i?'L':'M'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
    const area=`${path} L ${x(rows.length-1)} ${top+plotH} L ${x(0)} ${top+plotH} Z`;
    const dots=vals.map((v,i)=>`<circle class="ov-chart-point" cx="${x(i)}" cy="${y(v)}" r="4" fill="${s.color}"><title>${rows[i].key} · ${s.name}: ${money(v)}</title></circle>`).join('');
    return `<g class="ov-chart-series ov-${s.key}"><path class="ov-chart-area" d="${area}" fill="${s.color}"/><path class="ov-chart-line" d="${path}" stroke="${s.color}"/>${dots}</g>`;
  }).join('');
  const legend=series.map(s=>{const active=overviewChartVisible[s.key]!==false;return `<button type="button" class="ov-chart-legend ${active?'is-active':'is-muted'}" data-overview-series="${s.key}" aria-pressed="${active}"><i style="--series-color:${s.color}"></i>${s.name}</button>`;}).join('');
  const noData=maxValue===0?'<div class="ov-chart-empty">No sales recorded in this period yet</div>':'';
  host.innerHTML=`<div class="ov-chart-shell"><div class="ov-chart-topline"><div class="ov-chart-legend-wrap">${legend}</div><span class="ov-chart-hint">INTERACTIVE · HOVER FOR DETAILS</span></div><div class="ov-chart-canvas"><svg class="ov-sales-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily sales trend chart">${grid}${lines}${xLabels}</svg>${noData}</div></div>`;
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
  // Build network totals before rendering the Overview network cards.
  // The previous chart update referenced `nets` without defining it, which
  // stopped renderOverview before the sales chart could be drawn.
  const networkTotals=new Map();
  branchRows.forEach(b=>{
    const name=String(b.network||'Other').trim().toUpperCase();
    if(!networkTotals.has(name))networkTotals.set(name,{name,count:0,sales:0,target:0,patients:0});
    const n=networkTotals.get(name);
    n.count+=1;
    n.sales+=Number(b.sales||0);
    n.target+=Number(b.target||0);
    n.patients+=Number(b.patients||0);
  });
  const nets=Array.from(networkTotals.values()).sort((a,b)=>a.name.localeCompare(b.name));
  const todaySales=(overviewReports||[]).filter(r=>r.report_date===today && (staff?String(r.branch_id)===String(profile.branch_id):true)).reduce((a,r)=>a+Number(r.total_sales||0),0);
  const avgBill=totalPatients?totalSales/totalPatients:0;
  const branchLabel=staff?(branchRows[0]?.branch_name||'Your branch'):'UNOMED + NEETHI Group';
  $('overviewGreeting').textContent=staff?'YOUR BRANCH COMMAND CENTRE':'MANAGEMENT COMMAND CENTRE';
  $('overviewHeroTitle').textContent=staff?`Welcome, ${profile.full_name?.split(' ')[0]||'Team'}!`:'Business performance at a glance';
  $('overviewHeroSub').textContent=`${branchLabel} · ${monthKey} · Data visible to your signed-in account`;
  $('overviewRolePill').textContent=String(profile?.role||'portal').replaceAll('_',' ').toUpperCase();
  const prevVisible=(overviewPreviousReports||[]).filter(r=>!staff||String(r.branch_id)===String(profile.branch_id));
  const prevSales=prevVisible.reduce((a,r)=>a+Number(r.total_sales||0),0);
  const prevPatients=prevVisible.reduce((a,r)=>a+Number(r.patient_count||0),0);
  const prevAvg=prevPatients?prevSales/prevPatients:0;
  const prevMonthLabel=(()=>{const [y,m]=monthKey.split('-').map(Number);const d=new Date(y,m-2,1);return d.toLocaleDateString('en-IN',{month:'short',year:'numeric'});})();
  const deltaPct=(current,previous)=>previous>0?((current-previous)/previous)*100:null;
  const deltaMarkup=(current,previous,label,unit='%')=>{
    const d=deltaPct(current,previous);
    if(d===null)return `<span class="overview-kpi-delta neutral" title="Previous period has no recorded data">— No prior data</span>`;
    const up=d>=0,sign=up?'+':'';
    return `<span class="overview-kpi-delta ${up?'positive':'negative'}" title="${esc(label)}: ${money(previous)}">${up?'▲':'▼'} ${sign}${d.toFixed(1)}${unit}</span>`;
  };
  const todayPrevious=(overviewReports||[]).filter(r=>r.report_date===(()=>{const d=new Date(`${today}T12:00:00`);d.setDate(d.getDate()-1);return d.toISOString().slice(0,10);})()&&(staff?String(r.branch_id)===String(profile.branch_id):true)).reduce((a,r)=>a+Number(r.total_sales||0),0);
  const [monthYear,monthNumber]=monthKey.split('-').map(Number);
  const daysInMonth=new Date(monthYear,monthNumber,0).getDate();
  const elapsedDays=monthKey===today.slice(0,7)?Number(today.slice(8,10)):daysInMonth;
  const expectedPace=elapsedDays/daysInMonth*100;
  const paceGap=achievement-expectedPace;
  const kpis=[
    {label:"TODAY'S SALES",value:money(todaySales),meta:'Compared with yesterday',delta:deltaMarkup(todaySales,todayPrevious,'Yesterday'),tone:'blue',icon:'₹'},
    {label:'MONTH SALES',value:money(totalSales),meta:`vs ${prevMonthLabel} · same elapsed days`,delta:deltaMarkup(totalSales,prevSales,prevMonthLabel),tone:'red',icon:'↗'},
    {label:'PATIENTS SERVED',value:totalPatients.toLocaleString('en-IN'),meta:`vs ${prevMonthLabel} · same elapsed days`,delta:deltaMarkup(totalPatients,prevPatients,prevMonthLabel),tone:'teal',icon:'♙'},
    {label:'TARGET ACHIEVEMENT',value:fmtPct(achievement),meta:totalTarget?`${money(Math.max(totalTarget-totalSales,0))} balance`:'Monthly target not set',delta:`<span class="overview-kpi-delta ${paceGap>=0?'positive':'negative'}" title="Compared with expected month-to-date target pace">${paceGap>=0?'▲ Ahead':'▼ Behind'} ${Math.abs(paceGap).toFixed(1)} pp vs pace</span>`,tone:'gold',icon:'◎'},
    {label:'AVERAGE BILL',value:money(avgBill),meta:`vs ${prevMonthLabel} · same elapsed days`,delta:deltaMarkup(avgBill,prevAvg,prevMonthLabel),tone:'violet',icon:'⌁'}
  ];
  $('overviewKpis').innerHTML=kpis.map(k=>`<article class="overview-kpi ${k.tone}" tabindex="0" title="${esc(k.label)} · ${esc(k.meta)}"><span class="overview-kpi-icon">${k.icon}</span><span class="overview-kpi-label">${k.label}</span><strong>${k.value}</strong><small>${k.meta}</small>${k.delta}</article>`).join('');
  $('overviewNetworkGrid').innerHTML=staff?`<article class="overview-network-card own"><span class="overview-label">YOUR BRANCH</span><strong>${esc(branchLabel)}</strong><div class="overview-network-numbers"><b>${money(totalSales)}</b><span>${fmtPct(achievement)} achieved</span></div><div class="overview-progress"><i style="width:${Math.min(100,achievement)}%"></i></div><small>${money(totalTarget)} monthly target · ${totalPatients.toLocaleString('en-IN')} patients</small></article>`:nets.map(n=>`<article class="overview-network-card ${n.name.toLowerCase()}"><div class="overview-network-head"><span class="overview-label">${n.name} NETWORK</span><span>${n.count} branches</span></div><strong>${money(n.sales)}</strong><div class="overview-progress"><i style="width:${Math.min(100,n.target?n.sales/n.target*100:0)}%"></i></div><div class="overview-network-numbers"><span>${fmtPct(n.target?n.sales/n.target*100:0)} achieved</span><span>Target ${money(n.target)}</span></div><small>${n.patients.toLocaleString('en-IN')} patients</small></article>`).join('');
  const dates=[];const nowDate=new Date();const [yy,mm]=monthKey.split('-').map(Number);const lastDay=new Date(yy,mm,0).getDate();
  let count=overviewPeriod==='month'?lastDay:Number(overviewPeriod);let startDay=overviewPeriod==='month'?1:Math.max(1,nowDate.getDate()-count+1);if(monthKey!==today.slice(0,7)&&overviewPeriod!=='month')startDay=Math.max(1,lastDay-count+1);const endDay=overviewPeriod==='month'?lastDay:Math.min(lastDay,startDay+count-1);
  for(let d=startDay;d<=endDay;d++){const key=`${monthKey}-${String(d).padStart(2,'0')}`;dates.push({key,sales:source.filter(r=>r.report_date===key).filter(r=>!staff||String(r.branch_id)===String(profile.branch_id)).reduce((a,r)=>a+Number(r.total_sales||0),0)});}
  $('overviewChartTitle').textContent=overviewPeriod==='month'?'Daily sales · full month':`Daily sales · last ${overviewPeriod} days`;
  const chartRows=dates.map(d=>{const dayRows=source.filter(r=>r.report_date===d.key).filter(r=>!staff||String(r.branch_id)===String(profile.branch_id));const unomed=dayRows.filter(r=>[1,2,3,4,5].includes(Number(r.branch_id))).reduce((a,r)=>a+Number(r.total_sales||0),0);const neethi=dayRows.filter(r=>[6,7,8,9,10,11,12,13].includes(Number(r.branch_id))).reduce((a,r)=>a+Number(r.total_sales||0),0);const total=dayRows.reduce((a,r)=>a+Number(r.total_sales||0),0);return {...d,unomed,neethi,total};});
  renderOverviewSalesChart(chartRows,staff);
  const periodTotal=chartRows.reduce((a,x)=>a+x.total,0);$('overviewTrendFoot').textContent=`Period sales: ${money(periodTotal)} · ${chartRows.filter(x=>x.total>0).length} reporting days · Hover a point for exact sales`;
  show('overviewBranchPanel',!staff);
  const filtered=branchRows.filter(r=>overviewNetwork==='ALL'||String(r.network).toUpperCase()===overviewNetwork);
  const branchRowsToShow=overviewBranchesExpanded?filtered:filtered.slice(0,5);
  $('overviewBranchRows').innerHTML=branchRowsToShow.map((r,i)=>`<div class="overview-branch-row"><span class="overview-rank">${i+1}</span><div class="overview-branch-name"><strong>${esc(r.branch_name)}</strong><small>${esc(r.network)} · ${r.patients.toLocaleString('en-IN')} patients</small></div><div class="overview-branch-progress"><div><i style="width:${Math.min(100,r.achievement)}%"></i></div><small>${fmtPct(r.achievement)} of ${money(r.target)}</small></div><strong class="overview-branch-sales">${money(r.sales)}</strong></div>`).join('')||'<p>No branch results for this filter.</p>';
  const branchExpandButton=$('overviewDashboard').querySelector('[data-overview-branch-expand]');
  if(branchExpandButton){branchExpandButton.hidden=filtered.length<=5;branchExpandButton.textContent=overviewBranchesExpanded?'Show top 5 ↑':`View all ${filtered.length} branches ↓`;branchExpandButton.setAttribute('aria-expanded',String(overviewBranchesExpanded));}
  const branchFoot=$('overviewBranchFoot');
  if(branchFoot)branchFoot.textContent=filtered.length?(overviewBranchesExpanded?`Showing all ${filtered.length} branches`:`Showing top ${Math.min(5,filtered.length)} of ${filtered.length} branches`):'';
  const reportToday=(overviewReports||[]).filter(r=>r.report_date===today);const reported=new Set(reportToday.map(r=>String(r.branch_id)));const compliant=visibleBranches.filter(b=>reported.has(String(b.id))).length;
  $('overviewCompliance').innerHTML=`<div class="overview-compliance-count"><strong>${compliant}/${visibleBranches.length}</strong><span>branches submitted today</span></div><div class="overview-progress"><i style="width:${visibleBranches.length?compliant/visibleBranches.length*100:0}%"></i></div><small>${visibleBranches.length-compliant} branch(es) without a visible report today</small>`;
  const recent=(reports||[]).filter(r=>staff?String(r.branch_id)===String(profile.branch_id):true).slice(0,5);
  $('overviewRecent').innerHTML=recent.map(r=>{const b=branchMap.get(String(r.branch_id));return `<div class="overview-recent-row"><span><strong>${esc(b?.branch_name||'Branch')}</strong><small>${esc(r.report_date)}</small></span><b>${money(r.total_sales)}</b></div>`;}).join('')||'<p>No recent reports available.</p>';
}

async function loadTop5BranchLeaderboard() {
  const hosts = [
    { host: $('top5BranchRows'), note: $('top5BranchMsg'), period: $('top5PeriodLabel') },
    { host: $('staffTop5BranchRows'), note: $('staffTop5BranchMsg'), period: $('staffTop5PeriodLabel') }
  ].filter(item => item.host);
  if (!hosts.length || !db || !profile) return;

  const loading = '<p class="overview-empty top5-loading">Loading group leaderboard…</p>';
  hosts.forEach(item => {
    item.host.innerHTML = loading;
    if (item.period) item.period.textContent = `As of ${today}`;
  });

  const render = (rows) => {
    const ranked = rows
      .filter(row => Number(row.rank_no) >= 1 && Number(row.rank_no) <= 5)
      .sort((a, b) => Number(a.rank_no) - Number(b.rank_no));

    if (!ranked.length) {
      return '<p class="overview-empty">No monthly branch targets are configured for this month.</p>';
    }

    const makeCard = (row, index) => {
      const rank = Number(row.rank_no) || index + 1;
      const pct = Number(row.achievement_pct) || 0;
      const safePct = Math.min(100, Math.max(0, pct));
      const branch = esc(row.branch_name || 'Branch');
      const network = esc(row.network || '');
      const rankLabel = String(rank).padStart(2, '0');
      const tier = rank <= 3 ? `top5-podium-${rank}` : 'top5-list-card';
      return `<button type="button" class="top5-selectable ${tier}" data-top5-rank="${rank}" aria-pressed="false" aria-label="Rank ${rank}, ${branch}, ${network}, ${pct.toFixed(1)} percent achievement">
        <span class="top5-rank-mark" aria-hidden="true">${rank === 1 ? '♛' : rankLabel}</span>
        <span class="top5-branch-info"><strong>${branch}</strong><small>${network}</small>
          <span class="top5-progress-track" aria-hidden="true"><span class="top5-progress-fill" style="--top5-progress:${safePct}%"></span></span>
        </span>
        <strong class="top5-percent">${pct.toFixed(1)}<span>%</span></strong>
      </button>`;
    };

    const podium = ranked.filter(row => Number(row.rank_no) <= 3);
    const remaining = ranked.filter(row => Number(row.rank_no) > 3);
    return `<div class="top5-premium-layout">
      <div class="top5-podium-grid">${podium.map(makeCard).join('')}</div>
      ${remaining.length ? `<div class="top5-runners-up">${remaining.map(makeCard).join('')}</div>` : ''}
    </div>`;
  };

  const bindSelection = (host) => {
    if (host.dataset.top5Interactive === 'true') return;
    host.dataset.top5Interactive = 'true';
    host.addEventListener('click', event => {
      const card = event.target.closest('.top5-selectable');
      if (!card || !host.contains(card)) return;
      const wasSelected = card.getAttribute('aria-pressed') === 'true';
      host.querySelectorAll('.top5-selectable').forEach(item => {
        item.classList.remove('is-selected');
        item.setAttribute('aria-pressed', 'false');
      });
      if (!wasSelected) {
        card.classList.add('is-selected');
        card.setAttribute('aria-pressed', 'true');
      }
    });
  };

  try {
    const { data, error } = await db.rpc('get_top_group_branches', { p_as_of_date: today });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    window.__top5BranchRows = rows;
    hosts.forEach(item => {
      item.host.innerHTML = render(rows);
      bindSelection(item.host);
      if (item.note) item.note.textContent = 'Select a branch to highlight its position. Showing rank, branch, network and achievement percentage only.';
    });

    const rankValueEl = $('branchRankValue');
    const rankGapEl = $('branchRankGap');
    const rankNextPositionEl = $('branchRankNextPosition');
    const rankNextBranchEl = $('branchRankNextBranch');
    const ownAchievementEl = $('branchRankOwnAchievement');
    const competitorAchievementEl = $('branchRankCompetitorAchievement');
    const rankDetailsToggle = $('branchRankDetailsToggle');
    const own = rows.find(row => row.is_current_branch === true);

    if (profile.role === 'branch_staff' && rankValueEl && rankGapEl) {
      if (!own) {
        rankValueEl.textContent = '—';
        rankGapEl.textContent = 'Rank unavailable for this month.';
        if (rankNextBranchEl) rankNextBranchEl.textContent = 'No ranking data';
        if (rankNextPositionEl) rankNextPositionEl.textContent = '—';
      } else {
        const ownRank = Number(own.rank_no) || 0;
        const nextRank = ownRank - 1;
        // The RPC may return the adjacent ranked row, or include its details
        // on the current-branch row. Use either source without exposing other
        // branch sales or target values.
        const nextBranch = rows.find(row => Number(row.rank_no) === nextRank)
          || (own.next_branch_name ? {
            branch_name: own.next_branch_name,
            network: own.next_branch_network,
            achievement_pct: own.next_branch_achievement_pct
          } : null);
        const ownPct = Number(own.achievement_pct);
        const competitorPct = nextBranch ? Number(nextBranch.achievement_pct) : NaN;
        const calculatedGap = Number.isFinite(competitorPct) && Number.isFinite(ownPct)
          ? Math.max(0, competitorPct - ownPct)
          : Number(own.gap_to_next_pct || 0);

        rankValueEl.textContent = ownRank ? `#${ownRank}` : '—';
        if (rankNextPositionEl) rankNextPositionEl.textContent = ownRank > 1 ? `#${nextRank}` : 'LEADER';
        if (rankNextBranchEl) {
          rankNextBranchEl.textContent = ownRank === 1
            ? 'You are the group leader'
            : (nextBranch?.branch_name || 'Branch name unavailable');
          rankNextBranchEl.title = nextBranch?.network ? `${nextBranch.network} branch` : '';
        }
        rankGapEl.textContent = ownRank === 1
          ? 'You are currently #1 in the group.'
          : `Need +${calculatedGap.toFixed(1)} percentage points to overtake #${nextRank}.`;
        if (ownAchievementEl) ownAchievementEl.textContent =
          `Your achievement: ${Number.isFinite(ownPct) ? ownPct.toFixed(1) + '%' : '—'}`;
        if (competitorAchievementEl) competitorAchievementEl.textContent =
          `#${nextRank} achievement: ${Number.isFinite(competitorPct) ? competitorPct.toFixed(1) + '%' : 'Not supplied'}`;
      }
    }

    if (rankDetailsToggle && rankDetailsToggle.dataset.bound !== 'true') {
      rankDetailsToggle.dataset.bound = 'true';
      rankDetailsToggle.addEventListener('click', () => {
        const panel = $('branchRankDetails');
        if (!panel) return;
        const opening = panel.hidden;
        panel.hidden = !opening;
        rankDetailsToggle.setAttribute('aria-expanded', String(opening));
        rankDetailsToggle.textContent = opening ? 'Less' : 'Details';
      });
    }
  } catch (err) {
    window.__top5BranchRows = [];
    hosts.forEach(item => {
      item.host.innerHTML = '<p class="overview-empty">Leaderboard unavailable. Check the database setup.</p>';
      if (item.note) item.note.textContent = `Top 5 query failed: ${err.message || 'Unknown Supabase error'}.`;
    });
    const rankValueEl = $('branchRankValue');
    const rankGapEl = $('branchRankGap');
    const rankNextBranchEl = $('branchRankNextBranch');
    if (profile?.role === 'branch_staff') {
      if (rankValueEl) rankValueEl.textContent = 'Unavailable';
      if (rankNextBranchEl) rankNextBranchEl.textContent = 'Ranking unavailable';
      if (rankGapEl) rankGapEl.textContent = `Ranking query failed: ${err.message || 'Check Supabase SQL setup.'}`;
    }
    console.error('Top 5 branch leaderboard unavailable:', err);
  }
}
async function loadStaffMonthComparison() {
  const host=$('staffMonthComparisonCards'), note=$('staffMonthComparisonMsg');
  const periodEl=$('staffMonthComparisonPeriod');
  if(!host || !db || profile?.role!=='branch_staff' || !profile.branch_id) return;

  const [year,month,day]=today.split('-').map(Number);
  const currentStart=`${year}-${String(month).padStart(2,'0')}-01`;
  const prevMonthDate=new Date(year,month-2,1);
  const prevStart=`${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth()+1).padStart(2,'0')}-01`;
  const prevLast=new Date(prevMonthDate.getFullYear(),prevMonthDate.getMonth()+1,0).getDate();
  const compareDay=Math.min(day,prevLast);
  const currentEnd=today;
  const prevEnd=`${prevStart.slice(0,7)}-${String(compareDay).padStart(2,'0')}`;
  const monthLabel=(dateString)=>new Date(Number(dateString.slice(0,4)),Number(dateString.slice(5,7))-1,1)
    .toLocaleDateString('en-IN',{month:'long',year:'numeric'});
  const shortDate=(dateString)=>`${Number(dateString.slice(8,10))} ${new Date(Number(dateString.slice(0,4)),Number(dateString.slice(5,7))-1,1).toLocaleDateString('en-IN',{month:'short'})}`;
  const currentMonthName=monthLabel(currentStart), previousMonthName=monthLabel(prevStart);

  host.innerHTML='<p class="chart-loading">Loading your branch performance…</p>';
  if(periodEl) periodEl.textContent=`${currentMonthName} · ${shortDate(currentStart)}–${shortDate(currentEnd)}  vs  ${previousMonthName} · ${shortDate(prevStart)}–${shortDate(prevEnd)}`;

  try {
    const fetchPeriod=async(start,end)=>{
      const {data,error}=await db.from('daily_reports').select('report_date,total_sales,patient_count')
        .eq('branch_id',profile.branch_id).gte('report_date',start).lte('report_date',end);
      if(error) throw error;
      return data||[];
    };
    const [current,previous]=await Promise.all([
      fetchPeriod(currentStart,currentEnd),
      fetchPeriod(prevStart,prevEnd)
    ]);
    const sum=rows=>rows.reduce((a,r)=>({
      sales:a.sales+Number(r.total_sales||0),
      patients:a.patients+Number(r.patient_count||0),
      days:a.days+1
    }),{sales:0,patients:0,days:0});
    const c=sum(current),p=sum(previous);
    const currentAvg=c.patients?c.sales/c.patients:0;
    const previousAvg=p.patients?p.sales/p.patients:0;
    const change=(now,before)=>before>0?((now-before)/before)*100:null;
    const metrics=[
      {key:'sales',label:'Sales',icon:'₹',current:money(c.sales),previous:money(p.sales),raw:c.sales,prior:p.sales,delta:change(c.sales,p.sales),difference:Math.abs(c.sales-p.sales),formatDiff:v=>money(v),insight:(delta,diff)=>delta===null?'No previous-period sales available for comparison.':delta<0?`Sales decreased by ${money(diff)} compared with ${previousMonthName}.`:`Sales increased by ${money(diff)} compared with ${previousMonthName}.`,action:'Review daily sales momentum, pending follow-ups and package conversions.'},
      {key:'patients',label:'Patients',icon:'♙',current:c.patients.toLocaleString('en-IN'),previous:p.patients.toLocaleString('en-IN'),raw:c.patients,prior:p.patients,delta:change(c.patients,p.patients),difference:Math.abs(c.patients-p.patients),formatDiff:v=>`${v.toLocaleString('en-IN')} patients`,insight:(delta,diff)=>delta===null?'No previous-period patient count available for comparison.':delta<0?`${diff.toLocaleString('en-IN')} fewer patients than ${previousMonthName}.`:`${diff.toLocaleString('en-IN')} more patients than ${previousMonthName}.`,action:'Focus on patient retention, doctor referrals and follow-up conversion.'},
      {key:'average',label:'Average bill',icon:'↗',current:money(currentAvg),previous:money(previousAvg),raw:currentAvg,prior:previousAvg,delta:change(currentAvg,previousAvg),difference:Math.abs(currentAvg-previousAvg),formatDiff:v=>money(v),insight:(delta,diff)=>delta===null?'No previous-period average bill available for comparison.':delta<0?`Average bill decreased by ${money(diff)} per patient.`:`Average bill increased by ${money(diff)} per patient.`,action:'Review package mix and suitable test-profile recommendations.'}
    ];
    const fmtDelta=v=>v===null?'—':`${v>=0?'↑':'↓'} ${Math.abs(v).toFixed(1)}%`;
    const safePct=v=>v===null?0:Math.max(0,Math.min(100,v));
    const renderCards=selectedKey=>{
      host.innerHTML=`
        <div class="staff-m2m-month-strip">
          <span class="staff-m2m-period-chip is-current"><i></i> ${esc(currentMonthName)}</span>
          <span class="staff-m2m-vs">VS</span>
          <span class="staff-m2m-period-chip"><i></i> ${esc(previousMonthName)}</span>
          <span class="staff-m2m-same-period">Same elapsed days</span>
        </div>
        <div class="staff-m2m-grid">
          ${metrics.map(m=>`
            <button type="button" class="staff-m2m-card ${m.key===selectedKey?'is-selected':''} ${m.delta!==null&&m.delta<0?'is-negative':'is-positive'}" data-m2m-key="${m.key}" aria-pressed="${m.key===selectedKey?'true':'false'}">
              <span class="staff-m2m-card-top"><span class="staff-m2m-icon">${m.icon}</span><span class="staff-m2m-label">${m.label}</span><span class="staff-m2m-delta ${m.delta!==null&&m.delta<0?'is-down':'is-up'}">${fmtDelta(m.delta)}</span></span>
              <strong class="staff-m2m-current">${m.current}</strong>
              <span class="staff-m2m-previous">${esc(previousMonthName)}: ${m.previous}</span>
              <span class="staff-m2m-track"><i style="width:${m.prior>0?safePct((m.raw/m.prior)*100):0}%"></i></span>
            </button>`).join('')}
        </div>
        <div class="staff-m2m-insight" aria-live="polite">
          <div class="staff-m2m-insight-copy"><span class="staff-m2m-insight-kicker">SELECTED METRIC · ${esc(selectedKey.toUpperCase())}</span><strong>${metrics.find(m=>m.key===selectedKey).insight(metrics.find(m=>m.key===selectedKey).delta,metrics.find(m=>m.key===selectedKey).difference)}</strong><small>${metrics.find(m=>m.key===selectedKey).action}</small></div>
          <span class="staff-m2m-insight-mark">${metrics.find(m=>m.key===selectedKey).delta!==null&&metrics.find(m=>m.key===selectedKey).delta<0?'!':'✓'}</span>
        </div>`;
    };
    renderCards('sales');
    host.onclick=(event)=>{
      const button=event.target.closest('[data-m2m-key]');
      if(!button || !host.contains(button)) return;
      renderCards(button.dataset.m2mKey);
    };
    if(note) note.textContent=`Your assigned branch only · ${shortDate(currentStart)}–${shortDate(currentEnd)} compared with ${shortDate(prevStart)}–${shortDate(prevEnd)}. Select a metric to view its performance insight.`;
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
    msg('salesMsg', 'Review window could not be loaded. Please refresh the page.');
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
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('sales-confirm-open');
  $('confirmSalesSubmit')?.focus();
}
function closeSalesConfirmation() { const modal=$('salesConfirmModal'); if(modal){ modal.classList.add('hidden'); modal.setAttribute('aria-hidden','true'); } document.body.classList.remove('sales-confirm-open'); }
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
let employeeEditingId = null;
function canManageEmployees() { return ['admin','management','branch_manager'].includes(String(profile?.role||'').toLowerCase()); }
function employeeMessage(id,text,ok=false) { const el=$(id); if(el){el.textContent=text;el.style.color=ok?'#16764a':'#a21d37';} }
async function loadEmployeeModule() {
  if(!profile || !db) return;
  show('employeeSection', true);
  // The first sidebar visibility pass runs before employee data loads. Refresh
  // it now that the employee section has been made visible, otherwise the
  // Employee module link remains marked nav-hidden for Admin/Management.
  refreshSidebarVisibility();
  show('employeeAdminPanel', ['admin','management'].includes(String(profile?.role||'').toLowerCase()));
  show('employeeTargetPanel', canManageEmployees());
  $('employeeBranch').innerHTML = branches.map(b => '<option value="' + b.id + '">' + esc(b.branch_name) + '</option>').join('');
  try {
    let query=db.from('employee_directory').select('id,employee_code,full_name,branch_id,designation,department,mobile,login_email,active,auth_user_id').order('full_name');
    // Branch staff are scoped by RLS; management/branch managers can see their authorized records.
    const {data,error}=await query;
    if(error) throw error;
    employeeRecords=data||[];
    const branchMap=new Map(branches.map(b=>[String(b.id),b]));
    $('employeeRows').innerHTML=employeeRecords.map(e=>`<tr><td>${esc(e.full_name)}</td><td>${esc(e.employee_code||'—')}</td><td>${esc(branchMap.get(String(e.branch_id))?.branch_name||'—')}</td><td>${esc(e.designation||'—')}</td><td><span class="pill">${e.active?'Active':'Inactive'}</span></td><td>${e.auth_user_id?'Login active':'No login'}</td><td>${['admin','management'].includes(String(profile?.role||'').toLowerCase())?`<button type="button" class="secondary" data-employee-action="edit" data-id="${e.id}">Edit</button> <button type="button" class="secondary" data-employee-action="login" data-id="${e.id}">${e.auth_user_id?'Reset login':'Create login'}</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="7">No employees yet. Management can add employees above.</td></tr>';
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
  if(!['admin','management'].includes(String(profile?.role||'').toLowerCase())){employeeMessage('employeeMsg','Only Admin or Management can manage employee records.');return;}
  const wasEditing=Boolean(employeeEditingId);
  const payload={full_name:$('employeeName').value.trim(),employee_code:$('employeeCode').value.trim()||null,branch_id:Number($('employeeBranch').value),designation:$('employeeDesignation').value.trim(),department:$('employeeDepartment')?.value||null,mobile:$('employeeMobile')?.value.trim()||null,login_email:$('employeeEmail').value.trim().toLowerCase()||null,active:true};
  try {
    let result;
    if(employeeEditingId) result=await db.from('employee_directory').update(payload).eq('id',employeeEditingId);
    else {payload.created_by=user.id;result=await db.from('employee_directory').insert(payload);}
    if(result.error) throw result.error;
    employeeEditingId=null;$('employeeForm').reset();$('employeeFormTitle').textContent='Add employee';$('employeeSubmitButton').textContent='Add employee';$('employeeCancelEdit').classList.add('hidden');$('employeeBranch').value=String(profile.branch_id||branches[0]?.id||'');
    employeeMessage('employeeMsg', wasEditing?'Employee updated successfully.':'Employee added successfully.',true); await loadEmployeeModule();
  } catch(err){employeeMessage('employeeMsg',err.message||'Could not save employee.');}
}
function handleEmployeeDirectoryAction(event){
 const btn=event.target.closest('[data-employee-action]');if(!btn)return;
 const emp=employeeRecords.find(x=>String(x.id)===String(btn.dataset.id));if(!emp)return;
 if(btn.dataset.employeeAction==='edit'){
  employeeEditingId=String(emp.id);$('employeeFormTitle').textContent='Edit employee';$('employeeSubmitButton').textContent='Save changes';$('employeeCancelEdit').classList.remove('hidden');
  $('employeeName').value=emp.full_name||'';$('employeeCode').value=emp.employee_code||'';$('employeeBranch').value=String(emp.branch_id);$('employeeDesignation').value=emp.designation||'';$('employeeEmail').value=emp.login_email||'';$('employeeDepartment').value=emp.department||'Non-Technical';$('employeeMobile').value=emp.mobile||'';$('employeeForm').scrollIntoView({behavior:'smooth',block:'center'});return;
 }
 if(btn.dataset.employeeAction==='login') createEmployeeLogin(emp);
}
async function createEmployeeLogin(emp){
 if(!['admin','management'].includes(String(profile?.role||'').toLowerCase()))return;
 const email=(emp.login_email||prompt('Enter employee login email:', '')||'').trim().toLowerCase();if(!email)return;
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){alert('Enter a valid email address.');return;}
 const password=prompt(emp.auth_user_id?'Enter a new temporary password (minimum 8 characters):':'Set a temporary password for '+emp.full_name+' (minimum 8 characters):','');if(password===null)return;
 if(password.length<8){alert('Password must contain at least 8 characters.');return;}
 try{
  const result=await callAdminUserFunction({action:'employee_create',employee_id:emp.id,email,password});
  alert(`Login created for ${emp.full_name}.\nEmail: ${email}\nTemporary password: ${password}\nAsk the employee to sign in and change the password.`);
  await loadEmployeeModule();
 }catch(err){alert(err.message||'Could not create employee login.');}
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


// Employee complaint desk. Database permissions and workflow are enforced by the migration RPCs/RLS.
let complaintCache=[];
const complaintManager=()=>['admin','management'].includes(String(profile?.role||'').toLowerCase());
const complaintEmployee=()=>String(profile?.role||'').toLowerCase()==='employee';
function complaintAge(createdAt){const mins=Math.max(0,Math.floor((Date.now()-new Date(createdAt).getTime())/60000));const d=Math.floor(mins/1440),h=Math.floor((mins%1440)/60);return d?`${d}d ${h}h`:h?`${h}h ${mins%60}m`:`${mins}m`;}
async function loadComplaints(){
 if(!user||!db)return;
 const branchSel=$('complaintBranch'),filter=$('complaintBranchFilter');
 const myBranchId=Number(profile?.branch_id||0);
 const allowedBranches=(branches||[]).filter(b=>complaintManager()||Number(b.id)===myBranchId);
 // Rebuild the branch select so stale/empty options cannot block branch-staff submission.
 if(branchSel){
  if(complaintManager()){
   branchSel.innerHTML='<option value="">Select branch</option>'+allowedBranches.map(b=>`<option value="${b.id}">${esc(b.branch_name||b.name)}</option>`).join('');
   branchSel.disabled=false;
  }else{
   const ownBranch=(branches||[]).find(b=>Number(b.id)===myBranchId);
   const ownBranchLabel=ownBranch?.name||profile?.branch_name||`Your assigned branch (ID ${myBranchId})`;
   branchSel.innerHTML=myBranchId?`<option value="${myBranchId}">${esc(ownBranchLabel)}</option>`:'<option value="">Branch not assigned to this login</option>';
   branchSel.value=myBranchId?String(myBranchId):'';
   branchSel.disabled=true;
  }
 }
 if(filter&&filter.options.length<=1)filter.innerHTML='<option value="all">All permitted branches</option>'+allowedBranches.map(b=>`<option value="${b.id}">${esc(b.branch_name||b.name)}</option>`).join('');
 show('complaintRegisterPanel',!complaintEmployee());
 try{
  let q=db.from('complaint_tickets').select('id,ticket_no,branch_id,registered_by,category,department,subject,description,priority,status,assigned_employee_id,assigned_to_user_id,assigned_at,started_at,submitted_for_review_at,resolution_note,created_at,updated_at') .order('created_at',{ascending:false}).limit(500);
  const {data,error}=await q;if(error)throw error;complaintCache=data||[];
  // Branch names are resolved locally to avoid relying on optional FK relationship metadata.
  renderComplaints();
 }catch(err){$('complaintRows').innerHTML=`<tr><td colspan="9">Complaints could not load: ${esc(err.message||err)}. Apply the complaint database migration first.</td></tr>`;}
}
function renderComplaints(){
 const sf=$('complaintStatusFilter')?.value||'all',bf=$('complaintBranchFilter')?.value||'all';
 const rows=complaintCache.filter(t=>(sf==='all'||t.status===sf)&&(bf==='all'||String(t.branch_id)===bf));
 const counts={pending:0,in_progress:0,verification:0,resolved:0};complaintCache.forEach(t=>counts[t.status]=(counts[t.status]||0)+1);
 if($('complaintSummary'))$('complaintSummary').innerHTML=Object.entries(counts).map(([k,v])=>`<div class="stat"><span>${k.replace('_',' ')}</span><strong>${v}</strong></div>`).join('');
 const bmap=new Map((branches||[]).map(b=>[String(b.id),b.branch_name||b.name]));
 $('complaintRows').innerHTML=rows.map(t=>{const employee=(employeeRecords||[]).find(e=>Number(e.id)===Number(t.assigned_employee_id));return `<tr><td><strong>${esc(t.ticket_no||`#${t.id}`)}</strong></td><td>${new Date(t.created_at).toLocaleString('en-IN')}</td><td>${esc(bmap.get(String(t.branch_id))||'Branch')}</td><td><strong>${esc(t.subject)}</strong><small>${esc(t.category)} · ${esc(t.department)}</small></td><td><span class="complaint-priority ${esc(t.priority)}">${esc(t.priority)}</span></td><td>${esc(employee?.full_name|| (t.assigned_to_user_id?'Admin / Management':'Unassigned'))}</td><td>${esc(t.status.replace('_',' '))}</td><td>${complaintAge(t.created_at)}</td><td><button type="button" class="secondary" data-complaint-open="${t.id}">Open</button></td></tr>`}).join('')||'<tr><td colspan="9">No complaints found for this filter.</td></tr>';
}
const COMPLAINT_BUCKET='complaint-evidence';
const COMPLAINT_MAX_FILES=5;
const COMPLAINT_MAX_FILE_SIZE=10*1024*1024;
const COMPLAINT_ALLOWED_TYPES=new Set(['image/jpeg','image/png','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
const COMPLAINT_EXTENSION_TYPES={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
function complaintFilesFrom(inputId){return Array.from($(inputId)?.files||[]);}
function validateComplaintFiles(files){
 if(files.length>COMPLAINT_MAX_FILES)throw new Error(`Attach up to ${COMPLAINT_MAX_FILES} files per submission.`);
 for(const f of files){
  const ext=(f.name.split('.').pop()||'').toLowerCase();
  if(f.size>COMPLAINT_MAX_FILE_SIZE)throw new Error(`${f.name}: maximum file size is 10 MB.`);
  if(!COMPLAINT_EXTENSION_TYPES[ext]||(f.type&&f.type!==COMPLAINT_EXTENSION_TYPES[ext]))throw new Error(`${f.name}: only JPG, PNG, PDF, DOC and DOCX files are allowed.`);
 }
}
async function uploadComplaintFiles(ticketId,files,attachmentType){
 if(!files.length)return 0;
 validateComplaintFiles(files);
 let uploaded=0;
 for(const file of files){
  const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-120)||'attachment';
  const path=`${ticketId}/${user.id}/${crypto.randomUUID()}-${safeName}`;
  const contentType=file.type||COMPLAINT_EXTENSION_TYPES[(file.name.split('.').pop()||'').toLowerCase()];
  const {error:uploadError}=await db.storage.from(COMPLAINT_BUCKET).upload(path,file,{contentType,upsert:false});
  if(uploadError)throw uploadError;
  const {error:metaError}=await db.from('complaint_attachments').insert({ticket_id:ticketId,uploaded_by:user.id,storage_path:path,file_name:file.name,mime_type:contentType,attachment_type:attachmentType});
  if(metaError){await db.storage.from(COMPLAINT_BUCKET).remove([path]);throw metaError;}
  uploaded++;
 }
 return uploaded;
}
async function renderComplaintAttachments(ticketId){
 const {data,error}=await db.from('complaint_attachments').select('id,storage_path,file_name,mime_type,attachment_type,uploaded_by,created_at').eq('ticket_id',ticketId).order('created_at',{ascending:true});
 if(error)throw error;
 const rows=[];
 for(const a of (data||[])){
  const {data:signed,error:signedError}=await db.storage.from(COMPLAINT_BUCKET).createSignedUrl(a.storage_path,300);
  if(signedError){rows.push(`<li>${esc(a.file_name)} <small>(preview unavailable)</small></li>`);continue;}
  rows.push(`<li><a href="${esc(signed.signedUrl)}" target="_blank" rel="noopener noreferrer">${esc(a.file_name)}</a> <small>${esc(a.attachment_type)} · ${new Date(a.created_at).toLocaleString('en-IN')}</small></li>`);
 }
 return `<h4>Attachments (${rows.length})</h4><ul class="complaint-attachments">${rows.join('')||'<li>No files attached.</li>'}</ul>`;
}
async function createComplaint(e){
 e.preventDefault();
 const submit=$('complaintCreateForm')?.querySelector('[type="submit"]');
 if(submit)submit.disabled=true;
 try{
  if(!user?.id)throw new Error('Your session has expired. Please sign in again.');
  const files=complaintFilesFrom('complaintInitialFiles');validateComplaintFiles(files);
  const {data:currentProfile,error:profileError}=await db.from('profiles').select('user_id,role,branch_id,active').eq('user_id',user.id).maybeSingle();
  if(profileError)throw profileError;
  if(!currentProfile||currentProfile.active!==true)throw new Error('Your active portal profile could not be verified. Please sign in again.');
  const role=String(currentProfile.role||'').trim().toLowerCase();
  const isManager=['admin','management'].includes(role);
  const assignedBranchId=Number(currentProfile.branch_id||0);
  const selectedBranchId=Number($('complaintBranch')?.value||0);
  const branchId=isManager?selectedBranchId:assignedBranchId;
  if(!branchId)throw new Error(isManager?'Please select a branch.':'Your login has no assigned branch. Please ask Management to check your profile.');
  if(!isManager&&selectedBranchId&&selectedBranchId!==assignedBranchId)throw new Error('You can submit complaints only for your assigned branch.');
  const payload={branch_id:branchId,registered_by:user.id,category:$('complaintCategory').value,department:$('complaintDepartment').value,subject:$('complaintSubject').value.trim(),description:$('complaintDescription').value.trim(),priority:$('complaintPriority').value};
  const {data,error}=await db.from('complaint_tickets').insert(payload).select('id,ticket_no').single();
  if(error)throw error;
  let attachmentMessage='';
  if(files.length){try{const n=await uploadComplaintFiles(data.id,files,'initial');attachmentMessage=` · ${n} attachment${n===1?'':'s'} uploaded`;}catch(uploadError){attachmentMessage=` · complaint saved, but attachment upload failed: ${uploadError.message||uploadError}`;}}
  $('complaintCreateForm').reset();
  if(!isManager){const ownBranch=(branches||[]).find(b=>Number(b.id)===assignedBranchId);const label=ownBranch?.branch_name||ownBranch?.name||`Assigned branch (ID ${assignedBranchId})`;$('complaintBranch').innerHTML=`<option value="${assignedBranchId}">${esc(label)}</option>`;$('complaintBranch').value=String(assignedBranchId);$('complaintBranch').disabled=true;}
  msg('complaintCreateMsg',`Complaint submitted${data?.ticket_no?' · '+data.ticket_no:''}${attachmentMessage}.`,true);
  await loadComplaints();
 }catch(err){msg('complaintCreateMsg',err.message||'Could not submit complaint.');}
 finally{if(submit)submit.disabled=false;}
}
async function handleComplaintAction(e){
 const open=e.target.closest('[data-complaint-open]');if(open){openComplaint(Number(open.dataset.complaintOpen));return;}
 const btn=e.target.closest('[data-complaint-action]');if(!btn)return;
 const id=Number(btn.dataset.ticket),action=btn.dataset.complaintAction;
 try{
  if(action==='start'){const {error}=await db.rpc('complaint_start',{p_ticket_id:id});if(error)throw error;}
  if(action==='verify'||action==='return'){const note=$('complaintVerifyNote')?.value||'';const {error}=await db.rpc('complaint_verify',{p_ticket_id:id,p_approve:action==='verify',p_note:note});if(error)throw error;}
  if(action==='assign'){const emp=Number($('complaintAssignEmployee')?.value||0);const {error}=await db.rpc('complaint_assign',{p_ticket_id:id,p_employee_id:emp||null,p_user_id:null,p_note:$('complaintAssignNote')?.value||null});if(error)throw error;}
  if(action==='resolution'){
   const note=$('complaintResolutionNote')?.value||'',files=complaintFilesFrom('complaintResolutionFiles');validateComplaintFiles(files);
   const {error}=await db.rpc('complaint_submit_resolution',{p_ticket_id:id,p_resolution:note});if(error)throw error;
   if(files.length)await uploadComplaintFiles(id,files,'resolution');
  }
  if(action==='note'){
   const note=$('complaintProgressNote')?.value||'',files=complaintFilesFrom('complaintProgressFiles');validateComplaintFiles(files);
   const {error}=await db.rpc('complaint_add_note',{p_ticket_id:id,p_note:note});if(error)throw error;
   if(files.length)await uploadComplaintFiles(id,files,'progress');
  }
  if(action==='reassign'){const emp=Number($('complaintReassignEmployee')?.value||0),reason=$('complaintReassignReason')?.value||'';const {error}=await db.rpc('complaint_reassign',{p_ticket_id:id,p_to_employee_id:emp||null,p_to_user_id:null,p_reason:reason});if(error)throw error;}
  $('complaintActionPanel')?.classList.add('hidden');msg('complaintActionMsg','Complaint updated.',true);await loadComplaints();
 }catch(err){msg('complaintActionMsg',err.message||'Action failed.');}
}
async function openComplaint(id){
 const t=complaintCache.find(x=>x.id===id);if(!t)return;
 const {data:events,error}=await db.from('complaint_events').select('event_type,note,reason,created_at,actor_user_id,actor_name,actor_role,from_employee_name,to_employee_name,from_user_name,to_user_name').eq('ticket_id',id).order('created_at');
 if(error){msg('complaintActionMsg',error.message);return;}
 const {data:emps}=await db.from('employee_directory').select('id,full_name,branch_id').eq('active',true).order('full_name');
 let html=`<p><strong>${esc(t.ticket_no)}</strong> · ${esc(t.status)} · ${esc(t.priority)}</p><p>${esc(t.description)}</p><h4>Activity history</h4><ol class="complaint-history">${(events||[]).map(x=>{const actor=[x.actor_name||'User',x.actor_role].filter(Boolean).join(' · ');const assignment=[x.from_employee_name&&`From: ${x.from_employee_name}`,x.to_employee_name&&`To: ${x.to_employee_name}`,x.from_user_name&&`From: ${x.from_user_name}`,x.to_user_name&&`To: ${x.to_user_name}`].filter(Boolean).join(' → ');return `<li><strong>${esc(x.event_type.replaceAll('_',' '))}</strong><small>${new Date(x.created_at).toLocaleString('en-IN')}</small><p class="complaint-history-actor">By: <b>${esc(actor)}</b></p>${assignment?`<p class="complaint-history-assignment">${esc(assignment)}</p>`:''}${(x.note||x.reason)?`<p>${esc(x.note||x.reason)}</p>`:''}</li>`;}).join('')||'<li>No activity yet.</li>'}</ol>`;
 try{html+=await renderComplaintAttachments(id);}catch(err){html+='<p class="msg">Attachments could not be loaded. Check the complaint storage setup.</p>';}
 const mgr=complaintManager(),isAssignee=complaintEmployee()||t.assigned_employee_id!=null;
 if(mgr){html+=`<h4>Assign complaint</h4><select id="complaintAssignEmployee"><option value="">Choose employee</option>${(emps||[]).map(x=>`<option value="${x.id}">${esc(x.full_name)} · ${esc((branches||[]).find(b=>Number(b.id)===Number(x.branch_id))?.name||'')}</option>`).join('')}</select><input id="complaintAssignNote" placeholder="Assignment note (optional)"><button type="button" data-complaint-action="assign" data-ticket="${id}">Assign</button>`;if(t.status==='verification')html+=`<h4>Verify resolution</h4><textarea id="complaintVerifyNote" placeholder="Verification note / reason if returned"></textarea><button type="button" data-complaint-action="verify" data-ticket="${id}">Approve &amp; close</button><button type="button" class="secondary" data-complaint-action="return" data-ticket="${id}">Return for further work</button>`;}
 if(!mgr&&isAssignee&&t.status!=='resolved'){
  if(t.status==='pending')html+=`<button type="button" data-complaint-action="start" data-ticket="${id}">Start work</button>`;
  if(t.status==='in_progress')html+=`<label for="complaintProgressNote">Progress update</label><textarea id="complaintProgressNote" placeholder="Progress update"></textarea><label for="complaintProgressFiles">Attach progress files</label><input id="complaintProgressFiles" type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.doc,.docx,image/jpeg,image/png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"><small>Up to 5 files, 10 MB each. JPG, PNG, PDF, DOC or DOCX.</small><button type="button" data-complaint-action="note" data-ticket="${id}">Add progress update</button><label for="complaintResolutionNote">Resolution details</label><textarea id="complaintResolutionNote" placeholder="Resolution details and completion proof reference"></textarea><label for="complaintResolutionFiles">Attach completion proof</label><input id="complaintResolutionFiles" type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.doc,.docx,image/jpeg,image/png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"><small>Up to 5 files, 10 MB each.</small><button type="button" data-complaint-action="resolution" data-ticket="${id}">Submit for verification</button>`;
  html+=`<h4>Reassign with reason</h4><select id="complaintReassignEmployee"><option value="">Choose another employee</option>${(emps||[]).filter(x=>x.id!==t.assigned_employee_id).map(x=>`<option value="${x.id}">${esc(x.full_name)}</option>`).join('')}</select><textarea id="complaintReassignReason" placeholder="Mandatory reason"></textarea><button type="button" class="secondary" data-complaint-action="reassign" data-ticket="${id}">Reassign</button>`;
 }
 $('complaintActionTitle').textContent=`${t.ticket_no} · ${t.subject}`;$('complaintActionBody').innerHTML=html;$('complaintActionPanel').classList.remove('hidden');
}
