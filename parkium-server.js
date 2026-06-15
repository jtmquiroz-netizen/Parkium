/**
 * Parkium – Backend API con PostgreSQL
 * =====================================
 * Instalación:
 *   npm install express pg cors dotenv
 *
 * Variables de entorno (.env):
 *   DB_HOST=localhost
 *   DB_PORT=5432
 *   DB_NAME=parkium
 *   DB_USER=postgres
 *   DB_PASS=tu_contraseña
 *   PORT=3001
 *
 * Ejecución:
 *   node parkium-server.js
 *
 * El prototipo HTML se conecta automáticamente a http://localhost:3001/api
 */

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ──────────────────────────────────────────
// CONEXIÓN A POSTGRESQL
// ──────────────────────────────────────────
const pool = new Pool({
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'parkium',
  user:     process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || '',
});

pool.connect()
  .then(() => console.log('✅ Conectado a PostgreSQL'))
  .catch(err => console.error('❌ Error conectando a DB:', err.message));

// ──────────────────────────────────────────
// ESQUEMA SQL (ejecutar una vez)
// ──────────────────────────────────────────
/*
CREATE TABLE malls (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  address     TEXT,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  total_spots INT DEFAULT 0,
  avail_spots INT DEFAULT 0,
  price_per_hr INT DEFAULT 0,
  rating      NUMERIC(3,1),
  covered     BOOLEAN DEFAULT FALSE,
  icon        TEXT,
  tags        TEXT[],
  closes      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users (
  id       SERIAL PRIMARY KEY,
  name     TEXT NOT NULL,
  email    TEXT UNIQUE NOT NULL,
  phone    TEXT,
  plate    TEXT,
  vehicle  TEXT DEFAULT 'Auto',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reservations (
  id         TEXT PRIMARY KEY,
  user_id    INT REFERENCES users(id),
  mall_id    TEXT REFERENCES malls(id),
  spot       TEXT,
  status     TEXT DEFAULT 'upcoming',  -- upcoming | active | used
  date       DATE,
  time_entry TIME,
  price_hr   INT,
  closes     TEXT,
  started_at TIMESTAMPTZ,
  ended_at   TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE payment_cards (
  id         SERIAL PRIMARY KEY,
  user_id    INT REFERENCES users(id),
  masked_num TEXT,
  holder     TEXT,
  expiry     TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notification_prefs (
  user_id        INT PRIMARY KEY REFERENCES users(id),
  reservas       BOOLEAN DEFAULT TRUE,
  disponibilidad BOOLEAN DEFAULT TRUE,
  demanda        BOOLEAN DEFAULT FALSE,
  recordatorios  BOOLEAN DEFAULT TRUE,
  ofertas        BOOLEAN DEFAULT FALSE
);

-- Insertar malls de Talca
INSERT INTO malls VALUES
  ('m1','Arauco Maule','Av. Lircay 2249',-35.4340,-71.6508,350,78,800,4.3,TRUE,'🏬','{"disponible","techado","cercano"}','22:00'),
  ('m2','Falabella Talca','1 Sur 898',-35.4279,-71.6561,120,14,600,4.0,TRUE,'🛍️','{"disponible","techado","economico"}','21:00'),
  ('m3','Ripley Talca','1 Sur / 5 Oriente',-35.4272,-71.6539,100,0,600,3.9,FALSE,'🏪','{"economico"}','21:00'),
  ('m4','Portal Centro Talca','2 Sur 770',-35.4295,-71.6572,80,22,500,4.1,FALSE,'🏙️','{"disponible","economico","cercano"}','20:00'),
  ('m5','Mall Plaza Maule','Av. Carlos Schorr 130',-35.4388,-71.6434,600,185,700,4.6,TRUE,'🏬','{"disponible","techado"}','22:30'),
  ('m6','Paseo Centro Comercial','1 Norte / 7 Oriente',-35.4251,-71.6527,60,9,400,3.7,FALSE,'🏢','{"disponible","economico"}','21:30');
*/

// ──────────────────────────────────────────
// ENDPOINTS API
// ──────────────────────────────────────────

// Health check
app.get('/api/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ── Malls ──
app.get('/api/malls', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM malls ORDER BY rating DESC'
  );
  res.json(rows);
});

app.get('/api/malls/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM malls WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Mall no encontrado' });
  res.json(rows[0]);
});

// Actualizar disponibilidad en tiempo real
app.patch('/api/malls/:id/availability', async (req, res) => {
  const { avail_spots } = req.body;
  await pool.query('UPDATE malls SET avail_spots=$1 WHERE id=$2', [avail_spots, req.params.id]);
  res.json({ ok: true });
});

// ── Reservations ──
app.get('/api/reservations', async (req, res) => {
  const { user_id } = req.query;
  const { rows } = await pool.query(
    `SELECT r.*, m.name AS mall_name, m.icon, m.closes
     FROM reservations r
     JOIN malls m ON m.id = r.mall_id
     WHERE r.user_id = $1
     ORDER BY r.created_at DESC`,
    [user_id || 1]
  );
  res.json(rows);
});

app.post('/api/reservations', async (req, res) => {
  const { id, user_id, mall_id, spot, status, date, time_entry, price_hr, closes } = req.body;
  await pool.query(
    `INSERT INTO reservations (id, user_id, mall_id, spot, status, date, time_entry, price_hr, closes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status`,
    [id, user_id || 1, mall_id, spot, status, date, time_entry, price_hr, closes]
  );
  // Decrease availability
  await pool.query('UPDATE malls SET avail_spots = avail_spots - 1 WHERE id=$1 AND avail_spots > 0', [mall_id]);
  res.json({ ok: true });
});

app.patch('/api/reservations/:id/cancel', async (req, res) => {
  await pool.query("UPDATE reservations SET status='used', ended_at=NOW() WHERE id=$1", [req.params.id]);
  // Restore availability
  const { rows } = await pool.query('SELECT mall_id FROM reservations WHERE id=$1', [req.params.id]);
  if (rows.length) {
    await pool.query('UPDATE malls SET avail_spots = avail_spots + 1 WHERE id=$1', [rows[0].mall_id]);
  }
  res.json({ ok: true });
});

// ── Users / Profile ──
app.get('/api/profile/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(rows[0]);
});

app.put('/api/profile/:id', async (req, res) => {
  const { name, email, phone, plate, vehicle } = req.body;
  await pool.query(
    'UPDATE users SET name=$1, email=$2, phone=$3, plate=$4, vehicle=$5 WHERE id=$6',
    [name, email, phone, plate, vehicle, req.params.id]
  );
  res.json({ ok: true });
});

// ── Payment cards ──
app.get('/api/cards/:user_id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM payment_cards WHERE user_id=$1', [req.params.user_id]);
  res.json(rows);
});

app.post('/api/cards', async (req, res) => {
  const { user_id, masked_num, holder, expiry } = req.body;
  await pool.query(
    'INSERT INTO payment_cards (user_id, masked_num, holder, expiry) VALUES ($1,$2,$3,$4)',
    [user_id, masked_num, holder, expiry]
  );
  res.json({ ok: true });
});

// ── Notification preferences ──
app.get('/api/notifs/:user_id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM notification_prefs WHERE user_id=$1', [req.params.user_id]);
  res.json(rows[0] || {});
});

app.put('/api/notifs/:user_id', async (req, res) => {
  const { reservas, disponibilidad, demanda, recordatorios, ofertas } = req.body;
  await pool.query(
    `INSERT INTO notification_prefs (user_id, reservas, disponibilidad, demanda, recordatorios, ofertas)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id) DO UPDATE SET
       reservas=EXCLUDED.reservas, disponibilidad=EXCLUDED.disponibilidad,
       demanda=EXCLUDED.demanda, recordatorios=EXCLUDED.recordatorios, ofertas=EXCLUDED.ofertas`,
    [req.params.user_id, reservas, disponibilidad, demanda, recordatorios, ofertas]
  );
  res.json({ ok: true });
});

// Bulk save (prototipo usa esto para sync local → DB)
app.post('/api/reservations', async (req, res) => {
  // Handled above
});

// ──────────────────────────────────────────
// ARRANQUE
// ──────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🅿️  Parkium API corriendo en http://localhost:${PORT}`);
  console.log(`   → GET  /api/malls`);
  console.log(`   → GET  /api/reservations?user_id=1`);
  console.log(`   → POST /api/reservations`);
  console.log(`   → PUT  /api/profile/1`);
});
