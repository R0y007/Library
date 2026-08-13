// Assessment limits: Combat 15, Aesthetic 15, Technical 15, Administration 5 (total 50).
const MAX_COMBAT = 15, MAX_AESTHETIC = 15, MAX_TECHNICAL = 15, MAX_ADMIN = 5;
const $ = (s) => document.querySelector(s);
const form = $('#verifyForm');
const input = $('#certificateId');
const result = $('#result');
const message = $('#message');

function showMessage(text, type='error'){
  message.textContent = text;
  message.className = `alert alert-${type}`;
}
function hideMessage(){ message.className = 'alert hidden'; }
function setButtonBusy(btn,busy,label='Verifying…'){ if(!btn)return; btn.disabled=busy; if(busy){btn.dataset.originalLabel=btn.innerHTML;btn.innerHTML=`<span class="spinner" aria-hidden="true"></span>${label}`;} else if(btn.dataset.originalLabel){btn.innerHTML=btn.dataset.originalLabel;delete btn.dataset.originalLabel;} }

function render(c){
  $('#mechName').textContent = c.mechName;
  $('#certId').textContent = c.id;
  $('#owner').textContent = c.owner || '—';
  $('#faction').textContent = c.faction || '—';
  $('#date').textContent = new Date(`${c.dateIssued}T00:00:00`).toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'});
  $('#pvp').textContent = c.pvpTypes || '—';
  $('#total').textContent = c.combat + c.aesthetic + c.technical + c.admin;

  const metrics = [
    ['Combat Efficiency',c.combat,15],
    ['Aesthetic Style',c.aesthetic,15],
    ['Technical Design & Engineering',c.technical,15],
    ['Administration',c.admin,5]
  ];
  $('#metrics').innerHTML = metrics.map(([name,val,max]) =>
    `<div class="metric"><div class="metric-top"><span>${name}</span><span class="metric-score">${val} / ${max}</span></div><div class="track"><div class="fill" data-score="${val}" data-max="${max}"></div></div></div>`
  ).join('');
  document.querySelectorAll('#metrics .fill').forEach(el => {
    const value = Number(el.dataset.score) || 0;
    const max = Number(el.dataset.max) || 1;
    el.classList.add(`fill-${Math.round((value / max) * 20)}`);
  });

  const status = $('#status');
  status.textContent = c.status;
  status.className = `badge badge-${c.status.toLowerCase()}`;

  if(c.revokedMessage){
    $('#revokedNotice').textContent = c.revokedMessage;
    $('#revokedNotice').classList.remove('hidden');
  }else{
    $('#revokedNotice').classList.add('hidden');
  }
  result.classList.remove('hidden');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessage();
  result.classList.add('hidden');
  const id = input.value.trim().toUpperCase();
  if(!/^AVAM-[A-Z0-9]{12}$/.test(id)){
    showMessage('Enter a valid certificate ID in the format AVAM-XXXXXXXXXXXX.');
    return;
  }
  const btn=form.querySelector('button[type=submit]');
  setButtonBusy(btn,true);
  try{
    const r = await fetch(`/api/verify/${encodeURIComponent(id)}`, {headers:{Accept:'application/json'}});
    const data = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error(data.error || 'Certificate could not be verified.');
    render(data.certificate);
  }catch(err){
    showMessage(err.message);
  }finally{
    setButtonBusy(btn,false);
  }
});
$('#year').textContent = new Date().getFullYear();


const savePdf = $('#savePdf');
if (savePdf) {
  savePdf.addEventListener('click', () => {
    if (!result || result.classList.contains('hidden')) return;
    const previousTitle = document.title;
    const certId = ($('#certId')?.textContent || 'certificate').trim();
    document.title = `A.V.A.M. Certificate - ${certId}`;
    const restore = () => {
      document.title = previousTitle;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
    // Some mobile browsers do not fire afterprint.
    setTimeout(restore, 5000);
  });
}

// Instant-feel navigation: prefetch same-origin HTML and show a tiny progress cue.
document.querySelectorAll('.nav a, .brand').forEach(link => {
  if (link.origin !== location.origin) return;
  const warm = () => { if (!link.dataset.prefetched) { link.dataset.prefetched='1'; const p=document.createElement('link'); p.rel='prefetch'; p.href=link.href; document.head.appendChild(p); } };
  link.addEventListener('pointerenter', warm, {passive:true});
  link.addEventListener('focus', warm, {passive:true});
  link.addEventListener('click', e => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || link.target) return;
    document.documentElement.classList.add('is-navigating');
  });
});
window.addEventListener('pageshow', () => document.documentElement.classList.remove('is-navigating'));
