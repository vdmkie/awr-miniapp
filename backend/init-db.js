
import Database from 'better-sqlite3';
import fs from 'fs';

const db = new Database('./awr.db');

const schema = fs.readFileSync('./schema.sql', 'utf8');
db.exec(schema);

// Seed teams
const teamCount = 10;
for (let i=1;i<=teamCount;i++){
  db.prepare('INSERT OR IGNORE INTO teams (id,name) VALUES (?,?)').run(i, `Бригада ${i}`);
}

// Seed materials
const materials = [
  ['Кабель ВОК 4', 'м'],
  ['Кабель ВОК 8', 'м'],
  ['Кабель ВОК 12', 'м'],
  ['БО/16', 'шт'],
  ['БО/24', 'шт'],
  ['БО/32', 'шт'],
  ['Муфта (квадрат)', 'шт'],
  ['Муфта (колба)', 'шт'],
  ['делитель 1/2', 'шт'],
  ['делитель 1/4', 'шт'],
  ['дюбель 6х40', 'шт'],
  ['дюбель 8х60', 'шт'],
  ['перфолента', 'шт'],
  ['изолента', 'шт'],
  ['анкер', 'шт'],
  ['крепления для гофры', 'шт'],
  ['крепления для труб', 'шт'],
  ['гофра', 'м'],
  ['трубы', 'м'],
  ['шпаклёвка', 'кг'],
  ['патчкодр', 'шт'],
  ['натяжитель-Н3', 'шт'],
  ['натяжитель-H26', 'шт'],
];
for (const [name,unit] of materials){
  db.prepare('INSERT INTO materials (name, unit) VALUES (?,?)').run(name, unit);
}

// Create admin/storekeeper/brigade users placeholder by phone
const seedUsers = JSON.parse(fs.readFileSync('./seed-users.json','utf8'));

for (const u of seedUsers){
  db.prepare('INSERT OR IGNORE INTO users (phone,name,role,team_id) VALUES (?,?,?,?)')
    .run(u.phone, u.name, u.role, u.team_id || null);
}

console.log('DB initialized');
db.close();
