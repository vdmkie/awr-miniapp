
import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import ExcelJS from 'exceljs';
import crypto from 'crypto';

const BOT_TOKEN = process.env.BOT_TOKEN || 'REPLACE_WITH_BOT_TOKEN';
const PORT = process.env.PORT || 8080;

const app = express();
app.use(cors());
app.use(express.json({limit:'10mb'}));
app.use('/uploads', express.static('./uploads'));
app.use('/logo', express.static('../frontend/logo.png'));
app.use(express.static('../frontend'));

const db = new Database('./awr.db');

// --- Telegram WebApp initData verification ---
function tgCheck(initData) {
  // Based on Telegram docs: hash is HMAC-SHA256 of sorted data with secret key = sha256(BOT_TOKEN)
  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash');
  const dataCheckList = [];
  urlParams.sort();
  for (const [k,v] of urlParams.entries()) {
    if (k === 'hash') continue;
    dataCheckList.push(`${k}=${v}`);
  }
  const dataCheckString = dataCheckList.join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return hmac === hash;
}

function authMiddleware(req,res,next){
  const token = (req.headers.authorization||'').replace('Bearer ','');
  if (!token) return res.status(401).json({error:'No token'});
  try{
    const payload = jwt.verify(token, BOT_TOKEN);
    req.user = payload;
    next();
  }catch(e){
    res.status(401).json({error:'Invalid token'});
  }
}

app.post('/auth/validate', (req,res)=>{
  const { initDataUnsafe, phone } = req.body;
  if (!phone) return res.status(400).json({error:'phone required'});

  // Lookup user by phone
  const user = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if (!user) return res.status(403).json({error:'Пользователь не найден. Обратитесь к администратору.'});

  const token = jwt.sign({id:user.id, role:user.role, team_id:user.team_id, name:user.name}, BOT_TOKEN, {expiresIn:'7d'});
  res.json({ token, role:user.role, team_id:user.team_id, name:user.name });
});

// ---------------- TASKS (Admin + Brigade) ----------------

app.get('/tasks', authMiddleware, (req,res)=>{
  const { role, team_id } = req.user;
  const { status, address, team } = req.query;

  let sql = 'SELECT * FROM tasks WHERE 1=1';
  const params = [];
  if (role === 'brigade') {
    sql += ' AND team_id = ?';
    params.push(team_id);
  }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (address) { sql += ' AND address LIKE ?'; params.push('%'+address+'%'); }
  if (team) { sql += ' AND team_id = ?'; params.push(team); }
  sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

app.post('/tasks', authMiddleware, (req,res)=>{
  if (req.user.role !== 'admin') return res.status(403).json({error:'forbidden'});
  const { address, tz, access, note, team_id } = req.body;
  const stmt = db.prepare('INSERT INTO tasks (address,tz,access,note,team_id,status) VALUES (?,?,?,?,?,?)');
  const info = stmt.run(address, tz, access||'', note||'', team_id||null, 'Новая задача');
  db.prepare('INSERT OR IGNORE INTO task_reports (task_id) VALUES (?)').run(info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid });
});

app.put('/tasks/:id', authMiddleware, (req,res)=>{
  if (req.user.role !== 'admin') return res.status(403).json({error:'forbidden'});
  const { address, tz, access, note, team_id, status } = req.body;
  const stmt = db.prepare('UPDATE tasks SET address=?, tz=?, access=?, note=?, team_id=?, status=? WHERE id=?');
  stmt.run(address, tz, access, note, team_id, status, req.params.id);
  res.json({ok:true});
});

app.delete('/tasks/:id', authMiddleware, (req,res)=>{
  if (req.user.role !== 'admin') return res.status(403).json({error:'forbidden'});
  db.prepare('DELETE FROM tasks WHERE id=?').run(req.params.id);
  res.json({ok:true});
});

app.post('/tasks/:id/status', authMiddleware, (req,res)=>{
  const { status } = req.body;
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!task) return res.status(404).json({error:'not found'});

  if (req.user.role === 'brigade'){
    if (!['В работе'].includes(status)) return res.status(403).json({error:'brigade can set only В работе'});
  }
  db.prepare('UPDATE tasks SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ok:true});
});

// ---------------- Reports ----------------
const upload = multer({ dest: 'uploads/' });

app.get('/tasks/:id/report', authMiddleware, (req,res)=>{
  const row = db.prepare('SELECT * FROM task_reports WHERE task_id=?').get(req.params.id);
  res.json(row || {});
});

app.post('/tasks/:id/report/comment', authMiddleware, (req,res)=>{
  const { comment } = req.body;
  db.prepare('UPDATE task_reports SET comment=?, part_comment_done=1 WHERE task_id=?').run(comment || '', req.params.id);
  ensureInProgress(req.params.id);
  maybeComplete(req.params.id);
  res.json({ok:true});
});

app.post('/tasks/:id/report/materials', authMiddleware, (req,res)=>{
  const { items } = req.body; // [{material_id, qty}]
  if (!Array.isArray(items)) return res.status(400).json({error:'items required'});

  // Deduct from team stock
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!task) return res.status(404).json({error:'task not found'});
  const teamId = task.team_id;
  for (const it of items){
    const row = db.prepare('SELECT qty FROM material_stock WHERE location_type=? AND location_id=? AND material_id=?').get('team', teamId, it.material_id);
    const have = row ? row.qty : 0;
    if (have < it.qty) return res.status(400).json({error:`Недостаточно материала id=${it.material_id}`});
    db.prepare('UPDATE material_stock SET qty=? WHERE location_type=? AND location_id=? AND material_id=?')
      .run(have - it.qty, 'team', teamId, it.material_id);
    db.prepare('INSERT INTO task_materials_used (task_id, material_id, qty) VALUES (?,?,?)')
      .run(req.params.id, it.material_id, it.qty);
    db.prepare('INSERT INTO material_movements (material_id, from_type, from_id, to_type, to_id, qty, reason) VALUES (?,?,?,?,?,?,?)')
      .run(it.material_id, 'team', teamId, 'warehouse', null, it.qty, `Списание на задачу ${req.params.id}`);
  }

  db.prepare('UPDATE task_reports SET materials_json=?, part_materials_done=1 WHERE task_id=?')
    .run(JSON.stringify(items), req.params.id);
  ensureInProgress(req.params.id);
  maybeComplete(req.params.id);
  res.json({ok:true});
});

app.post('/tasks/:id/report/photos', authMiddleware, upload.array('photos', 10), (req,res)=>{
  const files = req.files || [];
  const paths = files.map(f=>`/uploads/${f.filename}`);
  const prev = db.prepare('SELECT photos_json FROM task_reports WHERE task_id=?').get(req.params.id);
  const existing = prev && prev.photos_json ? JSON.parse(prev.photos_json) : [];
  const all = existing.concat(paths);
  db.prepare('UPDATE task_reports SET photos_json=?, part_photos_done=1 WHERE task_id=?')
    .run(JSON.stringify(all), req.params.id);
  ensureInProgress(req.params.id);
  maybeComplete(req.params.id);
  res.json({ok:true, files: paths});
});

function ensureInProgress(taskId){
  const t = db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId);
  if (t && t.status === 'Новая задача'){
    db.prepare('UPDATE tasks SET status=? WHERE id=?').run('В работе', taskId);
  }
}
function maybeComplete(taskId){
  const r = db.prepare('SELECT part_comment_done, part_photos_done, part_materials_done FROM task_reports WHERE task_id=?').get(taskId);
  if (r && r.part_comment_done && r.part_photos_done && r.part_materials_done){
    db.prepare('UPDATE tasks SET status=? WHERE id=?').run('Выполнено', taskId);
  }
}

// ---------------- Materials & Instruments ----------------
app.get('/materials', authMiddleware, (req,res)=>{
  const rows = db.prepare('SELECT * FROM materials').all();
  res.json(rows);
});

app.get('/stock/teams', authMiddleware, (req,res)=>{
  if (req.user.role !== 'storekeeper' && req.user.role !== 'admin') return res.status(403).json({error:'forbidden'});
  const teams = db.prepare('SELECT * FROM teams').all();
  const materials = db.prepare('SELECT * FROM materials').all();
  const result = teams.map(team=>{
    const items = db.prepare('SELECT material_id, qty FROM material_stock WHERE location_type=? AND location_id=?').all('team', team.id);
    return { team, items };
  });
  const warehouse = db.prepare('SELECT material_id, qty FROM material_stock WHERE location_type=?').all('warehouse');
  res.json({ teams: result, warehouse, materials });
});

app.post('/stock/move/material', authMiddleware, (req,res)=>{
  if (req.user.role !== 'storekeeper') return res.status(403).json({error:'forbidden'});
  const { material_id, from_type, from_id, to_type, to_id, qty, reason } = req.body;
  function getQty(t, id){
    const r = db.prepare('SELECT qty FROM material_stock WHERE location_type=? AND location_id IS ? AND material_id=?')
      .get(t, id || null, material_id);
    return r ? r.qty : 0;
  }
  function setQty(t, id, q){
    db.prepare('INSERT INTO material_stock (location_type, location_id, material_id, qty) VALUES (?,?,?,?) ON CONFLICT(location_type, location_id, material_id) DO UPDATE SET qty=excluded.qty')
      .run(t, id || null, material_id, q);
  }
  const fromQty = getQty(from_type, from_id);
  if (fromQty < qty) return res.status(400).json({error:'Недостаточно на исходной локации'});
  setQty(from_type, from_id, fromQty - qty);
  const toQty = getQty(to_type, to_id);
  setQty(to_type, to_id, toQty + qty);
  db.prepare('INSERT INTO material_movements (material_id, from_type, from_id, to_type, to_id, qty, reason) VALUES (?,?,?,?,?,?,?)')
    .run(material_id, from_type, from_id, to_type, to_id, qty, reason||'');
  res.json({ok:true});
});

// Instruments by serial number
app.post('/instruments/add', authMiddleware, (req,res)=>{
  if (req.user.role !== 'storekeeper') return res.status(403).json({error:'forbidden'});
  const { name, serial } = req.body;
  const info = db.prepare('INSERT INTO instruments (name, serial) VALUES (?,?)').run(name, serial);
  // by default place to warehouse
  const id = info.lastInsertRowid;
  db.prepare('INSERT INTO instrument_holdings (location_type, location_id, instrument_id) VALUES (?,?,?)')
    .run('warehouse', null, id);
  res.json({id});
});

app.post('/instruments/move', authMiddleware, (req,res)=>{
  if (req.user.role !== 'storekeeper') return res.status(403).json({error:'forbidden'});
  const { instrument_id, to_type, to_id, reason } = req.body;
  // find current holding
  const current = db.prepare('SELECT * FROM instrument_holdings WHERE instrument_id=?').get(instrument_id);
  if (!current) return res.status(404).json({error:'instrument not found'});
  db.prepare('UPDATE instrument_holdings SET location_type=?, location_id=? WHERE instrument_id=?')
    .run(to_type, to_id || null, instrument_id);
  db.prepare('INSERT INTO instrument_movements (instrument_id, from_type, from_id, to_type, to_id, reason) VALUES (?,?,?,?,?,?)')
    .run(instrument_id, current.location_type, current.location_id, to_type, to_id || null, reason||'');
  res.json({ok:true});
});

app.get('/holdings', authMiddleware, (req,res)=>{
  if (req.user.role !== 'storekeeper' && req.user.role !== 'admin') return res.status(403).json({error:'forbidden'});
  const rows = db.prepare(`
    SELECT i.id, i.name, i.serial, h.location_type, h.location_id
    FROM instruments i
    JOIN instrument_holdings h ON h.instrument_id = i.id
  `).all();
  res.json(rows);
});

// Excel export
app.get('/export/excel', authMiddleware, async (req,res)=>{
  if (req.user.role !== 'storekeeper' && req.user.role !== 'admin') return res.status(403).json({error:'forbidden'});
  const workbook = new ExcelJS.Workbook();
  const ws1 = workbook.addWorksheet('Склад материалы');
  ws1.addRow(['material_id','name','unit','qty']);
  const warehouse = db.prepare(`
    SELECT m.id, m.name, m.unit, COALESCE(s.qty,0) qty
    FROM materials m
    LEFT JOIN material_stock s ON s.material_id=m.id AND s.location_type='warehouse'
    ORDER BY m.id
  `).all();
  for (const r of warehouse){ ws1.addRow([r.id, r.name, r.unit, r.qty]); }

  const ws2 = workbook.addWorksheet('Материалы по бригадам');
  ws2.addRow(['team','material','qty']);
  const rows = db.prepare(`
    SELECT t.name team, m.name material, s.qty qty
    FROM material_stock s
    JOIN teams t ON t.id = s.location_id
    JOIN materials m ON m.id = s.material_id
    WHERE s.location_type='team'
    ORDER BY t.id, m.id
  `).all();
  for (const r of rows){ ws2.addRow([r.team, r.material, r.qty]); }

  const ws3 = workbook.addWorksheet('Инструмент');
  ws3.addRow(['name','serial','location']);
  const inst = db.prepare(`
    SELECT i.name, i.serial,
    CASE h.location_type WHEN 'warehouse' THEN 'Склад' ELSE (SELECT name FROM teams WHERE id=h.location_id) END as location
    FROM instruments i
    JOIN instrument_holdings h ON h.instrument_id=i.id
  `).all();
  for (const r of inst){ ws3.addRow([r.name, r.serial, r.location]); }

  const filePath = './exports.xlsx';
  await workbook.xlsx.writeFile(filePath);
  res.download(filePath, 'awr-export.xlsx');
});

app.listen(PORT, ()=>{
  console.log('AWR backend on port', PORT);
});
