// db/client.js
// Simple, fast SQLite wrapper using better-sqlite3 (sync, great for bots)
// npm i better-sqlite3
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'materialbot.db');
const db = new Database(DB_PATH);

// Load schema on first run
const fs = require('fs');
const schemaPath = path.join(__dirname, 'schema.sql');
const schemaSQL = fs.readFileSync(schemaPath, 'utf8');
db.exec(schemaSQL);

// Helpers
const now = () => new Date();
const addHours = (d, h) => new Date(d.getTime() + h * 3600 * 1000);
const iso = d => new Date(d).toISOString().replace('T', ' ').replace('Z', '');

module.exports = {
  // THREADS
  upsertThread({ threadId, projectTitle, locationText, city, state, lat, lng }) {
    const get = db.prepare('SELECT thread_id FROM threads WHERE thread_id = ?');
    const existing = get.get(threadId);
    if (existing) {
      db.prepare(`
        UPDATE threads SET project_title=?, location_text=?, city=?, state=?, lat=?, lng=?, updated_at=CURRENT_TIMESTAMP
        WHERE thread_id=?
      `).run(projectTitle, locationText, city, state, lat, lng, threadId);
    } else {
      db.prepare(`
        INSERT INTO threads(thread_id, project_title, location_text, city, state, lat, lng)
        VALUES(?,?,?,?,?,?,?)
      `).run(threadId, projectTitle, locationText, city, state, lat, lng);
    }
  },
  getThread(threadId) {
    return db.prepare('SELECT * FROM threads WHERE thread_id=?').get(threadId);
  },

  // CARTS
  upsertCart({ threadId, requesterId, needBy = null, notes = null, data }) {
    const json = JSON.stringify(data);
    const row = db.prepare('SELECT id FROM carts WHERE thread_id=? AND requester_id=?').get(threadId, requesterId);
    if (row) {
      db.prepare('UPDATE carts SET need_by=?, notes=?, data_json=? WHERE id=?')
        .run(needBy, notes, json, row.id);
      return row.id;
    } else {
      const info = db.prepare('INSERT INTO carts(thread_id, requester_id, need_by, notes, data_json) VALUES(?,?,?,?,?)')
        .run(threadId, requesterId, needBy, notes, json);
      return info.lastInsertRowid;
    }
  },
  getCart(threadId, requesterId) {
    const row = db.prepare('SELECT * FROM carts WHERE thread_id=? AND requester_id=?').get(threadId, requesterId);
    if (!row) return null;
    return { ...row, data: JSON.parse(row.data_json) };
  },
  clearCart(threadId, requesterId) {
    db.prepare('DELETE FROM carts WHERE thread_id=? AND requester_id=?').run(threadId, requesterId);
  },

  // ORDERS + ITEMS (transaction)
  createOrderWithItems({ threadId, requesterId, needBy, notes, items }) {
    const tx = db.transaction(() => {
      const orderId = db.prepare(`
        INSERT INTO orders(thread_id, requester_id, need_by, notes, status)
        VALUES(?,?,?,?, 'pending')
      `).run(threadId, requesterId, needBy, notes).lastInsertRowid;

      const ins = db.prepare(`
        INSERT INTO order_items(order_id, description, quantity_value, quantity_unit, notes)
        VALUES(?,?,?,?,?)
      `);
      for (const it of items) {
        ins.run(orderId, it.description, it.quantity_value ?? null, it.quantity_unit ?? null, it.notes ?? null);
      }

      // schedule first reminder in 10 hours by default
      const nextAt = iso(addHours(now(), 10));
      db.prepare(`
        INSERT INTO reminders(order_id, frequency_hours, next_run_at, active)
        VALUES(?, 10, ?, 1)
      `).run(orderId, nextAt);

      return orderId;
    });
    return tx();
  },
  getOrder(orderId) {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(orderId);
    return { order, items };
  },
  updateOrderStatus(orderId, status) {
    db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, orderId);
  },

  // FORUM POSTS
  linkForumPost({ orderId, forumChannelId, forumThreadId, projectThreadId, pinned = 0 }) {
    db.prepare(`
      INSERT OR REPLACE INTO forum_posts(order_id, forum_channel_id, forum_thread_id, project_thread_id, pinned)
      VALUES(?,?,?,?,?)
    `).run(orderId, forumChannelId, forumThreadId, projectThreadId, pinned ? 1 : 0);
  },
  getForumPost(orderId) {
    return db.prepare('SELECT * FROM forum_posts WHERE order_id=?').get(orderId);
  },
  setForumPinned(orderId, pinned) {
    db.prepare('UPDATE forum_posts SET pinned=? WHERE order_id=?').run(pinned ? 1 : 0, orderId);
  },

  // MESSAGE MIRRORING
  recordMessageLink({ orderId = null, sourceChannelId, sourceMessageId, destChannelId, destMessageId }) {
    db.prepare(`
      INSERT INTO message_links(order_id, source_channel_id, source_message_id, dest_channel_id, dest_message_id)
      VALUES(?,?,?,?,?)
    `).run(orderId, sourceChannelId, sourceMessageId, destChannelId, destMessageId);
  },
  getMirrorBySource(sourceChannelId, sourceMessageId) {
    return db.prepare(`
      SELECT * FROM message_links WHERE source_channel_id=? AND source_message_id=?
    `).get(sourceChannelId, sourceMessageId);
  },

  // SUPPLIER CACHE
  cacheSupplier({ source, place_id = null, brand = null, type = null, name, address = null, phone = null, city = null, state = null, lat = null, lng = null, distance_mi = null, ttlDays = 30 }) {
    const expiresAt = iso(addHours(now(), ttlDays * 24));
    const info = db.prepare(`
      INSERT INTO supplier_cache(source, place_id, brand, type, name, address, phone, city, state, lat, lng, distance_mi, cached_at, expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP, ?)
    `).run(source, place_id, brand, type, name, address, phone, city, state, lat, lng, distance_mi, expiresAt);
    return info.lastInsertRowid;
  },
  getCachedSuppliers({ city, state, brand = null, type = null }) {
    let sql = `SELECT * FROM supplier_cache WHERE (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) AND city=? AND state=?`;
    const params = [city, state];
    if (brand) { sql += ' AND brand=?'; params.push(brand); }
    if (type)  { sql += ' AND type=?';  params.push(type);  }
    sql += ' ORDER BY distance_mi ASC NULLS LAST, cached_at DESC';
    return db.prepare(sql).all(...params);
  },
  pruneExpiredSupplierCache() {
    db.prepare('DELETE FROM supplier_cache WHERE expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP').run();
  },
  linkOrderSuppliers(orderId, supplierCacheIds = []) {
    const ins = db.prepare('INSERT INTO order_suppliers(order_id, supplier_cache_id) VALUES(?,?)');
    const tx = db.transaction(() => {
      for (const id of supplierCacheIds) ins.run(orderId, id);
    });
    tx();
  },

  // REMINDERS
  listDueReminders(limit = 50) {
    return db.prepare(`
      SELECT r.*, o.status, o.need_by
      FROM reminders r
      JOIN orders o ON o.id = r.order_id
      WHERE r.active=1 AND r.next_run_at <= CURRENT_TIMESTAMP AND o.status IN ('pending','in_progress','overdue')
      ORDER BY r.next_run_at ASC
      LIMIT ?
    `).all(limit);
  },
  bumpReminder(reminderId, hours = 10) {
    const next = iso(addHours(now(), hours));
    db.prepare('UPDATE reminders SET last_run_at=CURRENT_TIMESTAMP, next_run_at=? WHERE id=?').run(next, reminderId);
  },
  stopReminders(orderId) {
    db.prepare('UPDATE reminders SET active=0 WHERE order_id=?').run(orderId);
  },

  // UTIL
  _db: db
};
