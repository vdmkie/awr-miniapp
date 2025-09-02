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

// ---------------- AUTH WITH PHONE ----------------
app.post('/auth/validate', (req,res)=>{
  let { initDataUnsafe, phone } = req.body;
  if (!phone) return res.status(400).json({error:'phone required'});

  // --- Нормализация номера ---
  let digits = phone.replace(/\D/g,''); // оставляем только цифры
  if(digits.length === 12 && digits.startsWith('380')) phone = '+' + digits;
  else if(digits.length === 10) phone = '+380' + digits.slice(-9);
  console.log('Normalized phone:', phone); // для отладки

  // Lookup user by normalized phone
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
  if (role === 'brigade') { sql += ' AND team_id = ?'; params.push(team_id); }
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
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({error:'items required'});

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
// ... остальной код без изменений ...

app.listen(PORT, ()=>{ console.log('AWR backend on port', PORT); });
