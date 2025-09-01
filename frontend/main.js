const API = location.origin; // same host
let token = null;
let role = null;
let teamId = null;
let materialsCache = [];

const $ = (id)=>document.getElementById(id);
const fmt = (v)=>v==null?'—':v;

async function api(path, options={}){
  options.headers = Object.assign({'Content-Type':'application/json'}, options.headers || {});
  if (token) options.headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API+path, options);
  if (!res.ok){
    const t = await res.text();
    throw new Error(t);
  }
  if (res.headers.get('content-type')?.includes('application/json')) return res.json();
  return res;
}

function show(id){ $(id).classList.remove('hidden'); }
function hide(id){ $(id).classList.add('hidden'); }

async function auth(){
  const params = new URLSearchParams(location.search);
  const phone = params.get('phone');
  if (!phone){
    $('authStatus').textContent = 'Нет номера телефона в запуске. Откройте бот и нажмите «Открыть AWR».';
    return;
  }
  $('authStatus').textContent = 'Телефон: '+phone;
  const res = await api('/auth/validate', { method:'POST', body: JSON.stringify({ phone }) });
  token = res.token;
  role = res.role;
  teamId = res.team_id;
  $('auth').classList.add('hidden');
  show('rolePanels');
  if (role === 'admin') initAdmin();
  if (role === 'brigade') initBrigade();
  if (role === 'storekeeper') initStore();
}

async function loadMaterials(){
  if (materialsCache.length) return materialsCache;
  materialsCache = await api('/materials');
  return materialsCache;
}

async function initAdmin(){
  show('adminPanel');
  // fill teams filter/select
  const teamSel = $('filterTeam');
  teamSel.innerHTML = '<option value="">Бригада</option>' + Array.from({length:10}, (_,i)=>`<option value="${i+1}">Бригада ${i+1}</option>`).join('');
  $('m_team').innerHTML = '<option value="">Без назначения</option>' + Array.from({length:10}, (_,i)=>`<option value="${i+1}">Бригада ${i+1}</option>`).join('');

  $('applyFilters').onclick = renderAdminTasks;
  $('newTaskBtn').onclick = ()=>$('taskModal').showModal();
  $('createTask').onclick = async ()=>{
    const body = {
      address: $('m_address').value,
      tz: $('m_tz').value,
      access: $('m_access').value,
      note: $('m_note').value,
      team_id: $('m_team').value ? Number($('m_team').value) : null
    };
    await api('/tasks', { method:'POST', body: JSON.stringify(body) });
    $('taskModal').close();
    await renderAdminTasks();
  };

  await renderAdminTasks();
}

async function renderAdminTasks(){
  const params = new URLSearchParams();
  if ($('filterStatus').value) params.set('status', $('filterStatus').value);
  if ($('filterAddress').value) params.set('address', $('filterAddress').value);
  if ($('filterTeam').value) params.set('team', $('filterTeam').value);
  const tasks = await api('/tasks?'+params.toString());
  const root = $('tasksAdmin');
  root.innerHTML = '';
  for (const t of tasks){
    const el = document.createElement('div');
    el.className='p-3 rounded-xl border bg-slate-50';
    el.innerHTML = `
      <div class='flex justify-between'>
        <div class='font-semibold'>#${t.id} — ${t.address}</div>
        <div class='text-sm'>${t.status}</div>
      </div>
      <div class='text-sm mt-1'>ТЗ: ${t.tz}</div>
      <div class='text-sm'>Доступ: ${fmt(t.access)} | Пометка: ${fmt(t.note)}</div>
      <div class='text-sm'>Бригада: ${t.team_id ? 'Бригада '+t.team_id : '—'}</div>
      <div class='flex gap-2 mt-2'>
        <select class='border rounded px-2 py-1 teamAssign'>
          <option value=''>Без назначения</option>
          ${Array.from({length:10},(_,i)=>`<option value='${i+1}' ${t.team_id==i+1?'selected':''}>Бригада ${i+1}</option>`).join('')}
        </select>
        <select class='border rounded px-2 py-1 statusSel'>
          ${['Новая задача','В работе','Выполнено','Отложено','Проблемный дом'].map(s=>`<option ${t.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
        <button class='px-3 py-1 rounded-xl bg-blue-600 text-white saveBtn'>Сохранить</button>
        <button class='px-3 py-1 rounded-xl bg-rose-600 text-white delBtn'>Удалить</button>
      </div>
    `;
    el.querySelector('.saveBtn').onclick = async ()=>{
      const teamVal = el.querySelector('.teamAssign').value;
      const statusVal = el.querySelector('.statusSel').value;
      await api('/tasks/'+t.id, { method:'PUT', body: JSON.stringify({...t, team_id: teamVal?Number(teamVal):null, status: statusVal}) });
      await renderAdminTasks();
    };
    el.querySelector('.delBtn').onclick = async ()=>{
      await api('/tasks/'+t.id, { method:'DELETE' });
      await renderAdminTasks();
    };
    root.appendChild(el);
  }
}

async function initBrigade(){
  show('brigadePanel');
  await renderBrigadeTasks();
  await renderBrigadeStock();
}

async function renderBrigadeTasks(){
  const tasks = await api('/tasks');
  const root = $('tasksBrigade');
  root.innerHTML = '';
  for (const t of tasks){
    const el = document.createElement('div');
    el.className='p-3 rounded-xl border bg-white';
    el.innerHTML = `
      <div class='flex justify-between items-center'>
        <div class='font-semibold'>#${t.id} — ${t.address}</div>
        <div class='text-sm'>${t.status}</div>
      </div>
      <div class='text-sm mt-1'>ТЗ: ${t.tz}</div>
      <div class='text-sm'>Доступ: ${fmt(t.access)} | Пометка: ${fmt(t.note)}</div>
      <div class='mt-2 grid grid-cols-1 md:grid-cols-3 gap-2'>
        <textarea class='border rounded px-2 py-1 w-full comment' placeholder='Комментарий к отчёту'></textarea>
        <div>
          <input type='file' class='photos' multiple accept='image/*'>
          <button class='mt-1 px-3 py-1 rounded-xl bg-slate-700 text-white uploadPhotos'>Загрузить фото</button>
        </div>
        <div class='grid grid-cols-3 gap-1 items-center'>
          <select class='matSel border rounded px-2 py-1 col-span-2'></select>
          <input class='matQty border rounded px-2 py-1' placeholder='Кол-во'>
          <button class='px-2 py-1 rounded bg-slate-200 addMat'>Добавить</button>
          <div class='col-span-3 text-sm text-slate-600 matsList'></div>
        </div>
      </div>
      <div class='flex gap-2 mt-2'>
        <button class='px-3 py-1 rounded-xl bg-blue-600 text-white saveComment'>Сохранить комментарий</button>
        <button class='px-3 py-1 rounded-xl bg-emerald-600 text-white sendMaterials'>Списать материалы</button>
      </div>
    `;
    // fill materials
    const matSel = el.querySelector('.matSel');
    const mats = await loadMaterials();
    matSel.innerHTML = mats.map(m=>`<option value='${m.id}'>${m.name} (${m.unit})</option>`).join('');
    const list = [];
    el.querySelector('.addMat').onclick = ()=>{
      const id = Number(matSel.value);
      const qty = Number(el.querySelector('.matQty').value);
      if (!qty) return;
      const m = mats.find(x=>x.id===id);
      list.push({material_id:id, qty, name:m.name, unit:m.unit});
      el.querySelector('.matsList').textContent = list.map(x=>`${x.name}: ${x.qty} ${x.unit}`).join('; ');
      el.querySelector('.matQty').value='';
    };
    el.querySelector('.saveComment').onclick = async ()=>{
      const comment = el.querySelector('.comment').value;
      await api(`/tasks/${t.id}/report/comment`, { method:'POST', body: JSON.stringify({ comment }) });
      await renderBrigadeTasks();
    };
    el.querySelector('.uploadPhotos').onclick = async ()=>{
      const files = el.querySelector('.photos').files;
      if (!files.length) return;
      const fd = new FormData();
      for (const f of files) fd.append('photos', f);
      const res = await fetch(API+`/tasks/${t.id}/report/photos`, { method:'POST', headers: { Authorization: 'Bearer '+token }, body: fd });
      if (!res.ok) alert('Ошибка загрузки фото');
      await renderBrigadeTasks();
    };
    el.querySelector('.sendMaterials').onclick = async ()=>{
      if (!list.length) return;
      await api(`/tasks/${t.id}/report/materials`, { method:'POST', body: JSON.stringify({ items: list.map(({material_id, qty})=>({material_id, qty})) }) });
      await renderBrigadeTasks();
    };
    root.appendChild(el);
  }
}

async function renderBrigadeStock(){
  const data = await api('/stock/teams');
  const team = data.teams.find(x=>x.team.id===teamId);
  const mats = team.items.map(it=>{
    const m = data.materials.find(mm=>mm.id===it.material_id);
    return `${m.name}: ${it.qty} ${m.unit}`;
  });
  const div = document.createElement('div');
  div.className='p-2 rounded-xl bg-slate-50';
  div.textContent = mats.length ? mats.join(' | ') : 'Материалов нет';
  $('brigadeStock').appendChild(div);

  // instruments
  const instRes = await api('/holdings').catch(()=>({}));
  const myInst = Array.isArray(instRes) ? instRes.filter(i=>i.location_type==='team' && i.location_id===teamId) : [];
  const div2 = document.createElement('div');
  div2.className='p-2 rounded-xl bg-slate-50';
  div2.textContent = myInst.length ? myInst.map(i=>`${i.name} #${i.serial}`).join(' | ') : 'Инструмента нет';
  $('brigadeStock').appendChild(div2);
}

async function initStore(){
  show('storePanel');
  // fill materials select
  const mats = await loadMaterials();
  $('moveMaterial').innerHTML = mats.map(m=>`<option value='${m.id}'>${m.name} (${m.unit})</option>`).join('');
  $('doMove').onclick = async ()=>{
    const body = {
      material_id: Number($('moveMaterial').value),
      from_type: $('fromType').value,
      from_id: $('fromId').value ? Number($('fromId').value) : null,
      to_type: $('toType').value,
      to_id: $('toId').value ? Number($('toId').value) : null,
      qty: Number($('moveQty').value),
      reason: $('moveReason').value
    };
    await api('/stock/move/material', { method:'POST', body: JSON.stringify(body) });
    await renderStoreTables();
  };
  $('addInst').onclick = async ()=>{
    await api('/instruments/add', { method:'POST', body: JSON.stringify({ name: $('instName').value, serial: $('instSerial').value }) });
    $('instName').value=''; $('instSerial').value='';
    await renderStoreTables();
  };
  $('moveInst').onclick = async ()=>{
    await api('/instruments/move', { method:'POST', body: JSON.stringify({ instrument_id: Number($('instIdMove').value), to_type: $('instToType').value, to_id: $('instToId').value?Number($('instToId').value):null }) });
    await renderStoreTables();
  };
  $('exportExcel').onclick = ()=>{
    window.open(API+'/export/excel','_blank');
  };
  await renderStoreTables();
}

async function renderStoreTables(){
  const data = await api('/stock/teams');
  const root = $('stockTables');
  root.innerHTML = '';

  const wh = document.createElement('div');
  wh.className='p-3 rounded-xl bg-white border';
  wh.innerHTML = '<div class="font-semibold mb-2">Остатки на складе</div>';
  const ul = document.createElement('ul');
  for (const m of data.materials){
    const row = data.warehouse.find(x=>x.material_id===m.id);
    ul.innerHTML += `<li>${m.name} (${m.unit}): <b>${row?row.qty:0}</b></li>`;
  }
  wh.appendChild(ul);
  root.appendChild(wh);

  const tbl = document.createElement('div');
  tbl.className='p-3 rounded-xl bg-white border mt-3';
  tbl.innerHTML = '<div class="font-semibold mb-2">Материалы по бригадам</div>';
  for (const t of data.teams){
    const ul2 = document.createElement('ul');
    ul2.className='mb-2';
    ul2.innerHTML = `<div class='font-medium'>${t.team.name}</div>`;
    for (const it of t.items){
      const m = data.materials.find(mm=>mm.id===it.material_id);
      ul2.innerHTML += `<li>${m.name}: <b>${it.qty}</b> ${m.unit}</li>`;
    }
    tbl.appendChild(ul2);
  }
  root.appendChild(tbl);

  // instruments table
  const instDiv = $('instTable');
  const inst = await api('/holdings');
  const blocks = [];
  for (const item of inst){
    const location = item.location_type === 'warehouse' ? 'Склад' : 'Бригада '+item.location_id;
    blocks.push(`<div class='p-2 rounded border'>${item.name} #${item.serial} — ${location} (id:${item.id})</div>`);
  }
  instDiv.innerHTML = blocks.join('');
}

auth().catch(err=>{ $('authStatus').textContent = 'Ошибка авторизации: '+err.message; });
