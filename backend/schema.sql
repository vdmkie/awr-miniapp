
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT CHECK(role IN ('admin','brigade','storekeeper')) NOT NULL,
  team_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,
  tz TEXT NOT NULL, -- ТЗ
  access TEXT, -- Доступ
  note TEXT, -- пометка
  team_id INTEGER, -- назначенная бригада
  status TEXT CHECK(status IN ('Новая задача','В работе','Выполнено','Отложено','Проблемный дом')) DEFAULT 'Новая задача',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS tasks_updated_at AFTER UPDATE ON tasks
BEGIN
  UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS task_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  comment TEXT,
  photos_json TEXT, -- JSON array of file paths
  materials_json TEXT, -- JSON array of {material_id, qty}
  part_comment_done INTEGER DEFAULT 0,
  part_photos_done INTEGER DEFAULT 0,
  part_materials_done INTEGER DEFAULT 0,
  UNIQUE(task_id)
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit TEXT CHECK(unit IN ('м','шт','кг')) NOT NULL
);

CREATE TABLE IF NOT EXISTS material_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_type TEXT CHECK(location_type IN ('warehouse','team')) NOT NULL,
  location_id INTEGER, -- NULL for warehouse
  material_id INTEGER NOT NULL,
  qty REAL NOT NULL DEFAULT 0,
  UNIQUE(location_type, location_id, material_id)
);

CREATE TABLE IF NOT EXISTS material_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL,
  from_type TEXT CHECK(from_type IN ('warehouse','team')),
  from_id INTEGER,
  to_type TEXT CHECK(to_type IN ('warehouse','team')),
  to_id INTEGER,
  qty REAL NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS instruments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  serial TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS instrument_holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_type TEXT CHECK(location_type IN ('warehouse','team')) NOT NULL,
  location_id INTEGER,
  instrument_id INTEGER NOT NULL,
  UNIQUE(location_type, location_id, instrument_id)
);

CREATE TABLE IF NOT EXISTS instrument_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument_id INTEGER NOT NULL,
  from_type TEXT CHECK(from_type IN ('warehouse','team')),
  from_id INTEGER,
  to_type TEXT CHECK(to_type IN ('warehouse','team')),
  to_id INTEGER,
  reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_materials_used (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  material_id INTEGER NOT NULL,
  qty REAL NOT NULL
);
