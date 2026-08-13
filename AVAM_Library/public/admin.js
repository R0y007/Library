// Assessment limits: Combat 15, Aesthetic 15, Technical 15, Administration 5 (total 50).
const MAX_COMBAT = 15, MAX_AESTHETIC = 15, MAX_TECHNICAL = 15, MAX_ADMIN = 5;
const $ = (s) => document.querySelector(s);
let csrfToken = null;
let editingId = null;

const loginView = $('#loginView');
const adminView = $('#adminView');
const loginMessage = $('#loginMessage');
const adminMessage = $('#adminMessage');

function alertBox(el,text,type='error'){
  el.textContent = text;
  el.className = `alert alert-${type}`;
}
function hide(el){el.classList.add('hidden')}
function show(el){el.classList.remove('hidden')}

async function api(url, options={}){
  const headers = {'Content-Type':'application/json', ...(options.headers||{})};
  if(csrfToken) headers['x-csrf-token'] = csrfToken;
  const r = await fetch(url,{...options,headers});
  const data = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

async function bootstrap(){
  try{
    // Initial session check must not require a CSRF token; the server returns it.
    const data = await api('/api/admin/me');
    csrfToken = data.csrfToken;
    hide(loginView); show(adminView);
    await loadRecords();
  }catch{
    show(loginView); hide(adminView);
  }
}

$('#loginForm').addEventListener('submit',async(e)=>{
  e.preventDefault(); hide(loginMessage);
  try{
    const data = await api('/api/admin/login',{method:'POST',body:JSON.stringify({password:$('#loginPassword').value})});
    csrfToken=data.csrfToken;
    $('#loginPassword').value='';
    hide(loginView); show(adminView); await loadRecords();
  }catch(err){alertBox(loginMessage,err.message)}
});

$('#logoutBtn').addEventListener('click',async()=>{
  try{await api('/api/admin/logout',{method:'POST'})}finally{location.reload()}
});

async function loadRecords(){
  try{
    const data=await api('/api/admin/certificates');
    const records=$('#records');
    const total=data.certificates.length; const active=data.certificates.filter(c=>c.status==='Active').length; const attention=data.certificates.filter(c=>c.status!=='Active').length;
    $('#recordCount').textContent=total; $('#activeCount').textContent=active; $('#attentionCount').textContent=attention;
    if(!data.certificates.length){records.innerHTML='<div class="empty">No certificate records on file.</div>';return}
    records.innerHTML=data.certificates.map(c=>`
      <div class="record">
        <div><div class="record-id">${esc(c.id)}</div><div class="record-name">${esc(c.mechName)} <span class="record-owner">— ${esc(c.owner)}</span></div></div>
        <div class="status-text status-${c.status.toLowerCase()}">${esc(c.status)}</div>
        <div class="record-actions"><button class="btn btn-secondary edit" data-id="${esc(c.id)}">Edit</button><button class="btn btn-danger delete" data-id="${esc(c.id)}">Delete</button></div>
      </div>`).join('');
    records.querySelectorAll('.edit').forEach(b=>b.addEventListener('click',()=>editRecord(b.dataset.id,data.certificates)));
    records.querySelectorAll('.delete').forEach(b=>b.addEventListener('click',()=>deleteRecord(b.dataset.id)));
  }catch(err){alertBox(adminMessage,err.message)}
}

function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}

function fillForm(c){
  editingId=c?.id||null;
  $('#formTitle').textContent=editingId?'Edit certificate':'New certificate';
  $('#saveLabel').textContent=editingId?'Save changes':'Create certificate';
  $('#cancelBtn').classList.toggle('hidden',!editingId);
  $('#f_id').value=c?.id||'Generated automatically';
  $('#f_id').disabled=true;
  $('#f_status').value=c?.status||'Active';
  $('#f_mechName').value=c?.mechName||'';
  $('#f_owner').value=c?.owner||'';
  $('#f_faction').value=c?.faction||'';
  $('#f_dateIssued').value=c?.dateIssued||new Date().toISOString().slice(0,10);
  $('#f_pvpTypes').value=c?.pvpTypes||'';
  $('#f_combat').value=c?.combat??0;
  $('#f_aesthetic').value=c?.aesthetic??0;
  $('#f_technical').value=c?.technical??0;
  $('#f_admin').value=c?.admin??0;
  $('#f_notes').value=c?.notes||'';
  window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});
}
function editRecord(id,records){fillForm(records.find(c=>c.id===id))}
$('#newBtn').addEventListener('click',()=>fillForm());
$('#cancelBtn').addEventListener('click',()=>fillForm());

$('#certForm').addEventListener('submit',async(e)=>{
  e.preventDefault(); hide(adminMessage);
  const payload={
    id:editingId ? $('#f_id').value : '',status:$('#f_status').value,mechName:$('#f_mechName').value,owner:$('#f_owner').value,
    faction:$('#f_faction').value,dateIssued:$('#f_dateIssued').value,pvpTypes:$('#f_pvpTypes').value,
    combat:Number($('#f_combat').value),aesthetic:Number($('#f_aesthetic').value),technical:Number($('#f_technical').value),
    admin:Number($('#f_admin').value),notes:$('#f_notes').value
  };
  try{
    if(editingId) await api(`/api/admin/certificates/${encodeURIComponent(editingId)}`,{method:'PUT',body:JSON.stringify(payload)});
    else await api('/api/admin/certificates',{method:'POST',body:JSON.stringify(payload)});
    alertBox(adminMessage,editingId?'Certificate updated successfully.':'Certificate created successfully.','success');
    fillForm(); await loadRecords();
  }catch(err){alertBox(adminMessage,err.message)}
});

async function deleteRecord(id){
  if(!confirm(`Permanently delete ${id}? This cannot be undone.`)) return;
  try{await api(`/api/admin/certificates/${encodeURIComponent(id)}`,{method:'DELETE'});alertBox(adminMessage,'Certificate deleted.','success');if(editingId===id)fillForm();await loadRecords()}
  catch(err){alertBox(adminMessage,err.message)}
}

$('#changePasswordBtn').addEventListener('click',()=>{$('#passwordForm').reset();hide($('#passwordMessage'));show($('#passwordModal'));});
$('#closePassword').addEventListener('click',()=>hide($('#passwordModal')));

$('#passwordForm').addEventListener('submit',async(e)=>{
  e.preventDefault(); hide($('#passwordMessage'));
  const next=$('#newPassword').value, confirmPass=$('#confirmPassword').value;
  if(next!==confirmPass){alertBox($('#passwordMessage'),'New passwords do not match.');return}
  try{
    await api('/api/admin/change-password',{method:'POST',body:JSON.stringify({currentPassword:$('#currentPassword').value,newPassword:next})});
    alertBox($('#passwordMessage'),'Password changed. Sign in again with the new password.','success');
    setTimeout(()=>location.reload(),900);
  }catch(err){alertBox($('#passwordMessage'),err.message)}
});

document.querySelectorAll('.toggle-pass').forEach(btn=>btn.addEventListener('click',()=>{
  const input=document.getElementById(btn.dataset.target);
  input.type=input.type==='password'?'text':'password';
  btn.textContent=input.type==='password'?'Show':'Hide';
}));
$('#year').textContent=new Date().getFullYear();
bootstrap();
