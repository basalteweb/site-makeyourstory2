import pg from 'pg';
import { readFile } from 'node:fs/promises';

export async function openDatabase(config) {
  let query;
  let transaction;
  let close;
  if (config.databaseUrl) {
    pg.types.setTypeParser(1082, (isoDate) => isoDate);
    const pool = new pg.Pool({ connectionString: config.databaseUrl, options: '-c search_path=makeyourstory,pg_catalog', max: 8, statement_timeout: 10000, connectionTimeoutMillis: 5000 });
    pool.on('error', () => console.error('postgres_connection_error'));
    query = pool.query.bind(pool);
    transaction = async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const value = await fn(client);
        await client.query('commit');
        return value;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    };
    close = () => pool.end();
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = await PGlite.create(config.databasePath);
    query = db.query.bind(db);
    transaction = db.transaction.bind(db);
    close = () => db.close();
  }
  if (config.migrate) {
    const [schema, deliveryMigration, studioMigration, guestMigration, intakeMigration, guidedStudioMigration] = await Promise.all([
      readFile(new URL('../db/001-initial.sql', import.meta.url), 'utf8'),
      readFile(new URL('../db/002-delivery-hours.sql', import.meta.url), 'utf8'),
      readFile(new URL('../db/003-studio.sql', import.meta.url), 'utf8'),
      readFile(new URL('../db/004-guest-experience.sql', import.meta.url), 'utf8'),
      readFile(new URL('../db/005-guided-preparation.sql', import.meta.url), 'utf8'),
      readFile(new URL('../db/006-guided-studio.sql', import.meta.url), 'utf8')
    ]);
    await transaction(async (tx) => {
      await tx.query('select pg_advisory_xact_lock(1637992218)');
      const { rows: [row] } = await tx.query("select to_regclass('makeyourstory.products') as installed");
      if (!row.installed) {
        if (tx.exec) await tx.exec(schema);
        else await tx.query(schema);
      }
      await tx.query(deliveryMigration);
      if(tx.exec) await tx.exec(studioMigration);
      else await tx.query(studioMigration);
      if(tx.exec) await tx.exec(guestMigration);
      else await tx.query(guestMigration);
      if(tx.exec) await tx.exec(intakeMigration);
      else await tx.query(intakeMigration);
      if(tx.exec) await tx.exec(guidedStudioMigration);
      else await tx.query(guidedStudioMigration);
    });
  }
  if (!config.databaseUrl) await query('set search_path to makeyourstory, pg_catalog');
  const db = { query, transaction, close };
  await query('select 1 from products limit 1');
  return db;
}

export async function one(db, text, values = []) {
  return (await db.query(text, values)).rows[0];
}

export async function many(db, text, values = []) {
  return (await db.query(text, values)).rows;
}

export async function customerByEmail(db, email) {
  return one(db, `insert into customers (email) values ($1)
    on conflict (email) do update set email=excluded.email returning *`, [email]);
}

export async function addHistory(db, orderId, kind, summary, actor = null, internal = false) {
  await db.query('insert into timeline (order_id, kind, summary, actor_id, internal) values ($1,$2,$3,$4,$5)',
    [orderId, kind, summary, actor, internal]);
}

export async function ensureProject(db, orderId) {
  const project = await one(db, `insert into projects (order_id) values ($1)
    on conflict (order_id) do update set order_id=excluded.order_id returning *`, [orderId]);
  await db.query(`insert into events (project_id,notify) values ($1,coalesce((select value='true' from settings where key='rsvp_default'),false)) on conflict (project_id) do nothing`, [project.id]);
  return project;
}
