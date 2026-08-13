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
  try{
    const r = await fetch(`/api/verify/${encodeURIComponent(id)}`, {headers:{Accept:'application/json'}});
    const data = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error(data.error || 'Certificate could not be verified.');
    render(data.certificate);
  }catch(err){
    showMessage(err.message);
  }
});
$('#year').textContent = new Date().getFullYear();


const savePdf = $('#savePdf');
if (savePdf) {
  savePdf.addEventListener('click', () => {
    if (!result || result.classList.contains('hidden')) return;
    window.print();
  });
}
