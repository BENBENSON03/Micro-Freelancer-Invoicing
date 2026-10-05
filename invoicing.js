/* =====================================================================
   LEDGER — Micro-Freelancer Invoicing prototype
   Vanilla JS. All state persists to localStorage under STORAGE_KEY.
   ===================================================================== */

const STORAGE_KEY = 'ledger_state_v1';

/* ---------- State shape & persistence ---------- */
function loadState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(raw){
    try{ return JSON.parse(raw); }catch(e){ /* fall through to default */ }
  }
  return {
    timeEntries: [],   // {id, project, client, date, hours, notes, rate, billed}
    expenses: [],      // {id, client, project, description, amount, date, receipt, billed}
    invoices: [],      // {id, number, client, items, subtotal, tax, discount, total, dueDate, status, createdDate, remindersSent:[]}
    activeTimer: null, // {project, client, rate, startedAt}
    invoiceSeq: 1000
  };
}
let state = loadState();
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
const uid = () => Math.random().toString(36).slice(2,9);
const money = n => '$' + (Number(n)||0).toFixed(2);

/* ---------- Toast helper ---------- */
let toastTimer = null;
function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.add('hidden'), 2400);
}

/* =====================================================================
   NAVIGATION: sidebar links + tabs both drive the same tab-panel system
   ===================================================================== */
function setActiveTab(tabId){
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + tabId));
}
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=> setActiveTab(btn.dataset.tab));
});
document.querySelectorAll('.nav-item[data-view]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    if(view !== 'dashboard') setActiveTab(view);
    document.querySelector('.content').scrollIntoView({behavior:'smooth', block:'start'});
  });
});

/* =====================================================================
   MODALS: generic open/close
   ===================================================================== */
function openModal(id){ document.getElementById('overlay-' + id).classList.remove('hidden'); }
function closeModal(id){ document.getElementById('overlay-' + id).classList.add('hidden'); }

document.querySelectorAll('[data-open]').forEach(el=>{
  el.addEventListener('click', ()=>{
    const target = el.dataset.open;
    if(target === 'clientQuick'){ toast('Add a client by naming them on any Time Entry or Expense.'); return; }
    openModal(target);
    document.getElementById('addMenu').classList.remove('open');
  });
});
document.querySelectorAll('[data-close]').forEach(el=>{
  el.addEventListener('click', (e)=> e.target.closest('.modal-overlay').classList.add('hidden'));
});
document.querySelectorAll('.modal-overlay').forEach(ov=>{
  ov.addEventListener('click', (e)=>{ if(e.target === ov) ov.classList.add('hidden'); });
});

const addMenuBtn = document.getElementById('addMenuBtn');
const addMenu = document.getElementById('addMenu');
addMenuBtn.addEventListener('click', (e)=>{ e.stopPropagation(); addMenu.classList.toggle('open'); });
document.addEventListener('click', ()=> addMenu.classList.remove('open'));

/* =====================================================================
   LIVE PUNCH CLOCK — Start/Stop timer, tracked to the second
   ===================================================================== */
const timerClock = document.getElementById('timerClock');
const timerMeta  = document.getElementById('timerMeta');
const timerBtn   = document.getElementById('timerToggleBtn');
let timerInterval = null;

function fmtElapsed(ms){
  const totalSec = Math.floor(ms/1000);
  const h = String(Math.floor(totalSec/3600)).padStart(2,'0');
  const m = String(Math.floor((totalSec%3600)/60)).padStart(2,'0');
  const s = String(totalSec%60).padStart(2,'0');
  return `${h}:${m}:${s}`;
}
function tickTimer(){
  if(!state.activeTimer) return;
  const elapsed = Date.now() - state.activeTimer.startedAt;
  timerClock.textContent = fmtElapsed(elapsed);
}
function renderTimerUI(){
  if(state.activeTimer){
    timerBtn.textContent = 'Stop';
    timerBtn.classList.remove('start'); timerBtn.classList.add('stop');
    timerMeta.textContent = `Tracking "${state.activeTimer.project}" for ${state.activeTimer.client}`;
    document.getElementById('timerProject').value = state.activeTimer.project;
    document.getElementById('timerClient').value = state.activeTimer.client;
    document.getElementById('timerRate').value = state.activeTimer.rate;
    document.getElementById('timerProject').disabled = true;
    document.getElementById('timerClient').disabled = true;
    document.getElementById('timerRate').disabled = true;
    if(!timerInterval) timerInterval = setInterval(tickTimer, 1000);
  } else {
    timerBtn.textContent = 'Start';
    timerBtn.classList.remove('stop'); timerBtn.classList.add('start');
    timerMeta.textContent = 'No active session';
    timerClock.textContent = '00:00:00';
    document.getElementById('timerProject').disabled = false;
    document.getElementById('timerClient').disabled = false;
    document.getElementById('timerRate').disabled = false;
    clearInterval(timerInterval); timerInterval = null;
  }
}
timerBtn.addEventListener('click', ()=>{
  if(state.activeTimer){
    // STOP: convert elapsed time into a time entry
    const elapsedHrs = (Date.now() - state.activeTimer.startedAt) / 3600000;
    state.timeEntries.push({
      id: uid(),
      project: state.activeTimer.project,
      client: state.activeTimer.client,
      date: new Date().toISOString().slice(0,10),
      hours: Math.round(elapsedHrs * 100) / 100,
      notes: 'Logged via live punch clock',
      rate: state.activeTimer.rate,
      billed: false
    });
    state.activeTimer = null;
    saveState(); renderAll();
    toast('Timer stopped — entry logged.');
  } else {
    const project = document.getElementById('timerProject').value.trim() || 'Untitled Project';
    const client  = document.getElementById('timerClient').value.trim() || 'Unassigned Client';
    const rate    = parseFloat(document.getElementById('timerRate').value) || 0;
    state.activeTimer = { project, client, rate, startedAt: Date.now() };
    saveState(); renderTimerUI();
    toast('Timer started.');
  }
});

/* =====================================================================
   MANUAL TIME-SHEET ENTRY FORM
   ===================================================================== */
document.getElementById('timeEntryForm').addEventListener('submit', (e)=>{
  e.preventDefault();
  const f = new FormData(e.target);
  state.timeEntries.push({
    id: uid(),
    project: f.get('project').trim(),
    client: f.get('client').trim(),
    date: f.get('date'),
    hours: parseFloat(f.get('hours')) || 0,
    notes: f.get('notes').trim(),
    rate: parseFloat(f.get('rate')) || 0,
    billed: false
  });
  saveState(); renderAll();
  e.target.reset();
  closeModal('timeEntryModal');
  toast('Time entry saved.');
});

/* =====================================================================
   RECEIPT EXPENSE SCANNER — image upload, stored as data URL
   ===================================================================== */
let pendingReceiptDataUrl = null;
document.getElementById('receiptInput').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  const preview = document.getElementById('receiptPreview');
  preview.innerHTML = '';
  if(!file) { pendingReceiptDataUrl = null; return; }
  const reader = new FileReader();
  reader.onload = () => {
    pendingReceiptDataUrl = reader.result;
    const img = document.createElement('img');
    img.src = pendingReceiptDataUrl;
    preview.appendChild(img);
    const span = document.createElement('span');
    span.textContent = file.name;
    span.style.fontSize = '12px'; span.style.color = 'var(--ink-soft)';
    preview.appendChild(span);
  };
  reader.readAsDataURL(file);
});
document.getElementById('expenseForm').addEventListener('submit', (e)=>{
  e.preventDefault();
  const f = new FormData(e.target);
  state.expenses.push({
    id: uid(),
    client: f.get('client').trim(),
    project: f.get('project').trim(),
    description: f.get('description').trim(),
    amount: parseFloat(f.get('amount')) || 0,
    date: f.get('date'),
    receipt: pendingReceiptDataUrl,
    billed: false
  });
  saveState(); renderAll();
  e.target.reset();
  document.getElementById('receiptPreview').innerHTML = '';
  pendingReceiptDataUrl = null;
  closeModal('expenseModal');
  toast('Expense logged.');
});

/* =====================================================================
   RENDER: Time Log & Expense lists
   ===================================================================== */
function renderTimeList(){
  const wrap = document.getElementById('timeEntryList');
  const unbilled = state.timeEntries.filter(t=>!t.billed).sort((a,b)=> b.date.localeCompare(a.date));
  if(unbilled.length === 0){ wrap.innerHTML = '<div class="empty-state">No unbilled hours logged yet.</div>'; return; }
  wrap.innerHTML = unbilled.map(t => `
    <div class="row-item">
      <div class="ri-main">
        <strong>${escapeHtml(t.project)} — ${escapeHtml(t.client)}</strong>
        <span>${t.date} · ${t.hours}h · ${escapeHtml(t.notes || 'No notes')}</span>
      </div>
      <div class="ri-amount num">${money(t.hours * t.rate)}</div>
    </div>
  `).join('');
}
function renderExpenseList(){
  const wrap = document.getElementById('expenseList');
  const unbilled = state.expenses.filter(x=>!x.billed).sort((a,b)=> b.date.localeCompare(a.date));
  if(unbilled.length === 0){ wrap.innerHTML = '<div class="empty-state">No unbilled expenses yet.</div>'; return; }
  wrap.innerHTML = unbilled.map(x => `
    <div class="row-item">
      <div class="ri-main">
        <strong>${escapeHtml(x.description)}</strong>
        <span>${x.date} · ${escapeHtml(x.client)}${x.receipt ? ' · 📎 receipt attached' : ''}</span>
      </div>
      <div class="ri-amount num">${money(x.amount)}</div>
    </div>
  `).join('');
}
function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* =====================================================================
   BILLABLE RATE CONVERTER — always computed inline, not a separate step:
   any hours * rate above already produces a live billing amount.
   ===================================================================== */

/* =====================================================================
   AUTOMATED LINE-ITEM COMPILER + TAX/DISCOUNT + FINALIZE
   ===================================================================== */
function refreshClientDropdown(){
  const sel = document.getElementById('compileClientSelect');
  const clients = new Set();
  state.timeEntries.filter(t=>!t.billed).forEach(t=> clients.add(t.client));
  state.expenses.filter(x=>!x.billed).forEach(x=> clients.add(x.client));
  const prev = sel.value;
  sel.innerHTML = clients.size
    ? [...clients].map(c=>`<option>${escapeHtml(c)}</option>`).join('')
    : '<option disabled selected>No unbilled clients</option>';
  if([...clients].includes(prev)) sel.value = prev;
}

let compiledDraft = null; // {client, items:[{label, amount}], sourceEntryIds, sourceExpenseIds}

function compileForClient(client){
  const timeItems = state.timeEntries.filter(t=>!t.billed && t.client === client);
  const expenseItems = state.expenses.filter(x=>!x.billed && x.client === client);
  const items = [];
  timeItems.forEach(t=> items.push({
    label: `${t.project} — ${t.hours}h @ ${money(t.rate)}/hr`,
    amount: t.hours * t.rate,
    type:'time', id:t.id
  }));
  expenseItems.forEach(x=> items.push({
    label: `Expense — ${x.description}`,
    amount: x.amount,
    type:'expense', id:x.id
  }));
  return { client, items };
}

function renderCompilerPreview(){
  const preview = document.getElementById('compilerPreview');
  if(!compiledDraft || compiledDraft.items.length === 0){ preview.style.display='none'; return; }
  preview.style.display='flex';
  document.getElementById('compilerLines').innerHTML = compiledDraft.items.map(i=>
    `<div class="cp-line"><span>${escapeHtml(i.label)}</span><span class="num">${money(i.amount)}</span></div>`
  ).join('');
  recalcCompilerTotals();
}
function recalcCompilerTotals(){
  if(!compiledDraft) return;
  const subtotal = compiledDraft.items.reduce((s,i)=> s + i.amount, 0);
  const taxOn = document.getElementById('taxToggle').checked;
  const discOn = document.getElementById('discountToggle').checked;
  const taxRate = parseFloat(document.getElementById('taxRate').value) || 0;
  const discAmt = parseFloat(document.getElementById('discountAmt').value) || 0;
  const tax = taxOn ? subtotal * (taxRate/100) : 0;
  const discount = discOn ? discAmt : 0;
  const total = Math.max(subtotal + tax - discount, 0);
  document.getElementById('cpSubtotal').textContent = money(subtotal);
  document.getElementById('cpTax').textContent = money(tax);
  document.getElementById('cpDiscount').textContent = '−' + money(discount);
  document.getElementById('cpTotal').textContent = money(total);
}
['taxToggle','taxRate','discountToggle','discountAmt'].forEach(id=>{
  document.getElementById(id).addEventListener('input', recalcCompilerTotals);
});

document.getElementById('compileBtn').addEventListener('click', ()=>{
  const client = document.getElementById('compileClientSelect').value;
  if(!client || client === 'No unbilled clients'){ toast('No unbilled work for any client yet.'); return; }
  compiledDraft = compileForClient(client);
  if(compiledDraft.items.length === 0){ toast('Nothing unbilled for ' + client); return; }
  document.getElementById('dueDateInput').valueAsDate = new Date(Date.now() + 14*86400000); // default net-14
  renderCompilerPreview();
});

document.getElementById('finalizeInvoiceBtn').addEventListener('click', ()=>{
  if(!compiledDraft || compiledDraft.items.length === 0) return;
  const subtotal = compiledDraft.items.reduce((s,i)=> s + i.amount, 0);
  const taxOn = document.getElementById('taxToggle').checked;
  const discOn = document.getElementById('discountToggle').checked;
  const taxRate = parseFloat(document.getElementById('taxRate').value) || 0;
  const discAmt = discOn ? (parseFloat(document.getElementById('discountAmt').value) || 0) : 0;
  const tax = taxOn ? subtotal * (taxRate/100) : 0;
  const total = Math.max(subtotal + tax - discAmt, 0);
  const dueDate = document.getElementById('dueDateInput').value || new Date(Date.now()+14*86400000).toISOString().slice(0,10);

  const invoice = {
    id: uid(),
    number: 'INV-' + (state.invoiceSeq++),
    client: compiledDraft.client,
    items: compiledDraft.items,
    subtotal, tax, discount: discAmt, total,
    dueDate,
    status: 'unpaid',
    createdDate: new Date().toISOString().slice(0,10),
    remindersSent: []
  };
  state.invoices.push(invoice);

  // Mark source hours/expenses as billed so the compiler and metrics stay accurate.
  compiledDraft.items.forEach(i=>{
    if(i.type === 'time'){ const t = state.timeEntries.find(x=>x.id===i.id); if(t) t.billed = true; }
    if(i.type === 'expense'){ const x = state.expenses.find(x=>x.id===i.id); if(x) x.billed = true; }
  });

  compiledDraft = null;
  document.getElementById('compilerPreview').style.display = 'none';
  saveState(); renderAll();
  toast('Invoice ' + invoice.number + ' created.');
  setActiveTab('invoicetab');
});

/* =====================================================================
   INVOICE AGING TRACKER
   ===================================================================== */
function agingInfo(invoice){
  if(invoice.status === 'paid') return { text:'Paid', cls:'completed' };
  const today = new Date(); today.setHours(0,0,0,0);
  const due = new Date(invoice.dueDate); due.setHours(0,0,0,0);
  const diffDays = Math.round((due - today) / 86400000);
  if(diffDays > 0) return { text:`Due in ${diffDays} day${diffDays===1?'':'s'}`, cls:'pending' };
  if(diffDays === 0) return { text:'Due Today', cls:'warning' };
  return { text:`${Math.abs(diffDays)} Day${Math.abs(diffDays)===1?'':'s'} Overdue`, cls:'overdue' };
}

/* =====================================================================
   SMART NOTIFICATION MATRIX — templated reminders by day milestone
   ===================================================================== */
function reminderTemplates(invoice){
  const today = new Date(); today.setHours(0,0,0,0);
  const due = new Date(invoice.dueDate); due.setHours(0,0,0,0);
  const diffDays = Math.round((due - today) / 86400000);
  return [
    {
      key:'friendly', label:'Friendly Check-in', window:'3 days before due',
      eligible: diffDays === 3,
      body:`Hi there — just a friendly note that invoice ${invoice.number} for ${money(invoice.total)} is due on ${invoice.dueDate}. Let me know if you have any questions!`
    },
    {
      key:'urgent', label:'Urgent Notice', window:'morning it becomes overdue',
      eligible: diffDays === 0,
      body:`Hi — invoice ${invoice.number} for ${money(invoice.total)} is due today. Please arrange payment as soon as you're able. Thanks for your prompt attention.`
    },
    {
      key:'formal', label:'Formal Demand', window:'7 days past due',
      eligible: diffDays <= -7,
      body:`This is a formal notice that invoice ${invoice.number} for ${money(invoice.total)} is now ${Math.abs(diffDays)} days overdue. Per the payment terms, a late fee may apply if payment is not received within 5 business days.`
    }
  ];
}
function openNoticeModal(invoiceId){
  const invoice = state.invoices.find(i=>i.id===invoiceId);
  if(!invoice) return;
  const templates = reminderTemplates(invoice);
  document.getElementById('noticeBody').innerHTML = `
    <p style="font-size:13px;color:var(--ink-soft);margin:0 0 4px;">${invoice.number} · ${escapeHtml(invoice.client)}</p>
    <div class="notice-list">
      ${templates.map(t => `
        <div class="notice-item">
          <div class="ni-head">
            <strong>${t.label}</strong>
            <span class="tag ${t.eligible ? 'warning' : 'pending'}">${t.eligible ? 'Ready to send' : 'Window: ' + t.window}</span>
          </div>
          <pre>${escapeHtml(t.body)}</pre>
          <button class="btn btn-sm ${t.eligible ? 'btn-primary' : ''}" data-send="${t.key}" data-invoice="${invoice.id}">
            ${invoice.remindersSent.includes(t.key) ? 'Sent ✓' : 'Send Now'}
          </button>
        </div>
      `).join('')}
    </div>
  `;
  document.getElementById('noticeBody').querySelectorAll('[data-send]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const inv = state.invoices.find(i=>i.id===btn.dataset.invoice);
      if(!inv.remindersSent.includes(btn.dataset.send)) inv.remindersSent.push(btn.dataset.send);
      saveState(); renderAll();
      toast('Reminder sent to ' + inv.client + '.');
      openNoticeModal(invoiceId); // refresh
    });
  });
  openModal('noticeModal');
}

/* =====================================================================
   PDF EXPORTER — jsPDF, styled invoice with branding + payment links
   ===================================================================== */
function exportInvoicePDF(invoiceId){
  const invoice = state.invoices.find(i=>i.id===invoiceId);
  if(!invoice) return;
  if(!window.jspdf){
    toast('PDF library failed to load from the CDN — check your connection and reload.');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'pt', format:'a4' });
  const teal = [14,124,123];
  const ink = [22,33,58];
  const softGrey = [110,120,140];

  // Header band
  doc.setFillColor(...ink); doc.rect(0,0,595,90,'F');
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(22);
  doc.text('LEDGER', 40, 45);
  doc.setFont('helvetica','normal'); doc.setFontSize(10);
  doc.text('Independent Consulting · hello@ledger.example', 40, 63);

  doc.setTextColor(...teal); doc.setFont('helvetica','bold'); doc.setFontSize(16);
  doc.text('INVOICE', 555, 45, { align:'right' });
  doc.setTextColor(255,255,255); doc.setFontSize(10); doc.setFont('helvetica','normal');
  doc.text(invoice.number, 555, 63, { align:'right' });

  // Bill-to / meta
  doc.setTextColor(...ink); doc.setFontSize(11); doc.setFont('helvetica','bold');
  doc.text('Bill To', 40, 125);
  doc.setFont('helvetica','normal'); doc.text(invoice.client, 40, 141);

  doc.setFont('helvetica','bold'); doc.text('Invoice Date', 350, 125);
  doc.setFont('helvetica','normal'); doc.text(invoice.createdDate, 350, 141);
  doc.setFont('helvetica','bold'); doc.text('Due Date', 460, 125);
  doc.setFont('helvetica','normal'); doc.text(invoice.dueDate, 460, 141);

  // Line items table header
  let y = 180;
  doc.setFillColor(245,246,249); doc.rect(40, y-16, 515, 22, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(...softGrey);
  doc.text('DESCRIPTION', 48, y);
  doc.text('AMOUNT', 540, y, { align:'right' });
  y += 24;

  doc.setTextColor(...ink); doc.setFont('helvetica','normal'); doc.setFontSize(10.5);
  invoice.items.forEach(item=>{
    doc.text(item.label, 48, y, { maxWidth: 400 });
    doc.text(money(item.amount), 540, y, { align:'right' });
    y += 20;
  });

  y += 10;
  doc.setDrawColor(228,231,238); doc.line(40, y, 555, y); y += 20;

  const totalsLine = (label, val, bold)=>{
    doc.setFont('helvetica', bold ? 'bold':'normal');
    doc.setFontSize(bold ? 13 : 10.5);
    doc.text(label, 420, y);
    doc.text(val, 540, y, { align:'right' });
    y += bold ? 24 : 18;
  };
  totalsLine('Subtotal', money(invoice.subtotal), false);
  totalsLine('Tax', money(invoice.tax), false);
  totalsLine('Discount', '−' + money(invoice.discount), false);
  doc.setDrawColor(...teal); doc.line(420, y-6, 555, y-6);
  totalsLine('Total Due', money(invoice.total), true);

  // Payment links
  y += 20;
  doc.setFont('helvetica','bold'); doc.setFontSize(10.5); doc.setTextColor(...ink);
  doc.text('Payment Options', 40, y); y += 16;
  doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(...softGrey);
  const links = getPaymentLinks();
  ['stripe','paypal','wise'].forEach(k=>{
    if(links[k]) { doc.text(`${k[0].toUpperCase()+k.slice(1)}: ${links[k]}`, 40, y); y += 15; }
  });
  if(!links.stripe && !links.paypal && !links.wise){
    doc.text('Payment terms: Net 14 from invoice date.', 40, y); y += 15;
  }

  doc.setFontSize(9); doc.setTextColor(...softGrey);
  doc.text('Thank you for your business.', 40, 800);

  doc.save(invoice.number + '.pdf');
  toast('PDF generated: ' + invoice.number + '.pdf');
}

/* Simple payment-link fields, stored globally for all invoices in this prototype */
function getPaymentLinks(){
  return {
    stripe: document.getElementById('linkStripe')?.value.trim() || '',
    paypal: document.getElementById('linkPaypal')?.value.trim() || '',
    wise:   document.getElementById('linkWise')?.value.trim()   || ''
  };
}
// Inject a small payment-links field group into the compiler card, once.
(function injectPaymentLinks(){
  const container = document.getElementById('compilerPreview');
  const div = document.createElement('div');
  div.innerHTML = `
    <div class="field" style="margin-top:6px;"><label>Stripe payment link</label><input id="linkStripe" placeholder="https://buy.stripe.com/..."></div>
    <div class="field"><label>PayPal.me link</label><input id="linkPaypal" placeholder="https://paypal.me/..."></div>
    <div class="field"><label>Wise link</label><input id="linkWise" placeholder="https://wise.com/pay/..."></div>
  `;
  container.insertBefore(div, container.querySelector('.field')); // above due date
})();

/* =====================================================================
   RENDER: Invoice table + status classes toggled dynamically
   ===================================================================== */
function renderInvoiceTable(){
  const body = document.getElementById('invoiceTableBody');
  const empty = document.getElementById('invoiceEmptyState');
  if(state.invoices.length === 0){ body.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display = 'none';
  body.innerHTML = state.invoices.slice().reverse().map(inv=>{
    const aging = agingInfo(inv);
    return `
    <tr>
      <td><strong>${inv.number}</strong></td>
      <td>${escapeHtml(inv.client)}</td>
      <td class="num">${money(inv.total)}</td>
      <td><span class="tag ${aging.cls}">${aging.text}</span></td>
      <td>
        <button class="btn btn-sm" data-notice="${inv.id}">Remind…</button>
      </td>
      <td class="cell-actions">
        <button class="btn btn-sm" data-pdf="${inv.id}">PDF</button>
        ${inv.status !== 'paid' ? `<button class="btn btn-sm" data-paid="${inv.id}">Mark Paid</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  body.querySelectorAll('[data-notice]').forEach(b=> b.addEventListener('click', ()=> openNoticeModal(b.dataset.notice)));
  body.querySelectorAll('[data-pdf]').forEach(b=> b.addEventListener('click', ()=> exportInvoicePDF(b.dataset.pdf)));
  body.querySelectorAll('[data-paid]').forEach(b=> b.addEventListener('click', ()=>{
    const inv = state.invoices.find(i=>i.id===b.dataset.paid);
    inv.status = 'paid';
    saveState(); renderAll();
    toast(inv.number + ' marked as paid.');
  }));
}

/* =====================================================================
   DYNAMIC ANALYTICS ENGINE — recompute metric cards + chart on any change
   ===================================================================== */
let analyticsChart = null;
function renderMetrics(){
  const unbilledHours = state.timeEntries.filter(t=>!t.billed).reduce((s,t)=> s+t.hours, 0);
  const unbilledValue = state.timeEntries.filter(t=>!t.billed).reduce((s,t)=> s+t.hours*t.rate, 0)
                       + state.expenses.filter(x=>!x.billed).reduce((s,x)=> s+x.amount, 0);

  const thisMonth = new Date().toISOString().slice(0,7);
  const invoicesThisMonth = state.invoices.filter(i=> i.createdDate.slice(0,7) === thisMonth);
  const billedMonth = invoicesThisMonth.reduce((s,i)=> s+i.total, 0);

  const outstanding = state.invoices.filter(i=>i.status!=='paid').reduce((s,i)=> s+i.total, 0);
  const overdue = state.invoices.filter(i=> agingInfo(i).cls === 'overdue');

  document.getElementById('metricUnbilledHours').textContent = unbilledHours.toFixed(1) + 'h';
  document.getElementById('metricUnbilledValue').textContent = money(unbilledValue) + ' not yet invoiced';
  document.getElementById('metricBilledMonth').textContent = money(billedMonth);
  document.getElementById('metricInvoiceCount').textContent = invoicesThisMonth.length + ' invoice' + (invoicesThisMonth.length===1?'':'s') + ' sent';
  document.getElementById('metricOutstanding').textContent = money(outstanding);
  document.getElementById('metricOverdue').textContent = overdue.length;
  document.getElementById('metricOverdueSub').textContent = overdue.length ? overdue.length + ' need attention' : 'Everything on time';
}

function renderChart(){
  // Chart.js loads from a CDN <script> tag in <head>; if that request was
  // blocked (offline, firewall, ad-blocker) `Chart` won't exist yet. Fail
  // soft here instead of throwing, so the rest of the dashboard still works.
  if(typeof Chart === 'undefined'){
    const wrap = document.querySelector('.chart-wrap');
    if(wrap && !wrap.dataset.fallback){
      wrap.dataset.fallback = '1';
      wrap.innerHTML = '<div class="empty-state">Chart library failed to load from the CDN — check your internet connection and reload.</div>';
    }
    return;
  }

  const byProject = {};
  state.timeEntries.forEach(t=>{ byProject[t.project] = (byProject[t.project]||0) + t.hours; });
  const labels = Object.keys(byProject);
  const data = Object.values(byProject);

  const canvas = document.getElementById('analyticsChart');
  if(!canvas) return; // canvas was replaced by the fallback message above, on a prior failed attempt
  const ctx = canvas.getContext('2d');
  const palette = ['#0E7C7B','#C08A2E','#4B5875','#2E8B57','#C6423D','#7C6FD9'];

  if(analyticsChart){
    analyticsChart.data.labels = labels;
    analyticsChart.data.datasets[0].data = data;
    analyticsChart.update();
    return;
  }
  analyticsChart = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{ label:'Hours', data, backgroundColor: labels.map((_,i)=>palette[i%palette.length]), borderRadius:6 }] },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:false } },
      scales:{ y:{ beginAtZero:true, grid:{ color:'#EEF0F5' } }, x:{ grid:{ display:false } } }
    }
  });
}

/* =====================================================================
   MASTER RENDER
   ===================================================================== */
function renderAll(){
  renderTimeList();
  renderExpenseList();
  refreshClientDropdown();
  renderInvoiceTable();
  renderMetrics();
  renderChart();
  renderTimerUI();
}

/* ---------- Boot ---------- */
document.getElementById('timeEntryForm').querySelector('[name=date]').valueAsDate = new Date();
document.getElementById('expenseForm').querySelector('[name=date]').valueAsDate = new Date();
renderAll();