/**
 * Single source of truth for the transaction adapters PortQueue ships from
 * `@portqueue/core/tx`. Every docs page that shows a transactional-enqueue
 * example renders its tabs from this constant (via `<TxTabs />`) — never
 * hardcode the list in an individual page, so adding an adapter here surfaces
 * it everywhere at once.
 */

export interface TxAdapterInfo {
  /** Stable tab value. */
  value: string;
  /** Human label shown on the tab. */
  label: string;
  /** The adapter factory exported from `@portqueue/core/tx`. */
  fn: string;
  /** Grouping used in prose: query builder, ORM, or raw client. */
  kind: 'builder' | 'orm' | 'raw';
  /** A minimal transactional-enqueue snippet for this adapter. */
  snippet: string;
  /** Marks the tab selected by default. */
  default?: boolean;
}

export const TX_ADAPTERS: TxAdapterInfo[] = [
  {
    value: 'knex',
    label: 'Knex',
    fn: 'fromKnex',
    kind: 'builder',
    default: true,
    snippet: `import { fromKnex } from '@portqueue/core/tx';

await knex.transaction(async (trx) => {
  await trx('order').insert(order);
  const fulfillmentQueue = pq.createQueue('fulfillment');
  await fulfillmentQueue.addJob({ data: { orderId }, tx: fromKnex(trx) });
}); // the developer's trx owns commit/rollback`,
  },
  {
    value: 'prisma',
    label: 'Prisma',
    fn: 'fromPrisma',
    kind: 'orm',
    snippet: `import { fromPrisma } from '@portqueue/core/tx';

await prisma.$transaction(async (px) => {
  await px.order.create({ data: order });
  const fulfillmentQueue = pq.createQueue('fulfillment');
  await fulfillmentQueue.addJob({ data: { orderId }, tx: fromPrisma(px) });
});`,
  },
  {
    value: 'drizzle',
    label: 'Drizzle',
    fn: 'fromDrizzle',
    kind: 'builder',
    snippet: `import { fromDrizzle } from '@portqueue/core/tx';

await db.transaction(async (tx) => {
  await tx.insert(orders).values(order);
  const fulfillmentQueue = pq.createQueue('fulfillment');
  await fulfillmentQueue.addJob({ data: { orderId }, tx: fromDrizzle(tx) });
});`,
  },
  {
    value: 'typeorm',
    label: 'TypeORM',
    fn: 'fromTypeorm',
    kind: 'orm',
    snippet: `import { fromTypeorm } from '@portqueue/core/tx';

await dataSource.transaction(async (em) => {
  await em.save(Order, order);
  const fulfillmentQueue = pq.createQueue('fulfillment');
  await fulfillmentQueue.addJob({ data: { orderId }, tx: fromTypeorm(em) });
}); // works with an EntityManager or a QueryRunner's manager`,
  },
  {
    value: 'kysely',
    label: 'Kysely',
    fn: 'fromKysely',
    kind: 'builder',
    snippet: `import { fromKysely } from '@portqueue/core/tx';

await db.transaction().execute(async (trx) => {
  await trx.insertInto('order').values(order).execute();
  const fulfillmentQueue = pq.createQueue('fulfillment');
  // fromKysely wraps the transaction's raw executor (executeQuery(sql, params)).
  await fulfillmentQueue.addJob({ data: { orderId }, tx: fromKysely(trx) });
});`,
  },
  {
    value: 'sequelize',
    label: 'Sequelize',
    fn: 'fromSequelize',
    kind: 'orm',
    snippet: `import { fromSequelize } from '@portqueue/core/tx';

await sequelize.transaction(async (t) => {
  await Order.create(order, { transaction: t });
  const fulfillmentQueue = pq.createQueue('fulfillment');
  await fulfillmentQueue.addJob({ data: { orderId }, tx: fromSequelize(sequelize, t) });
});`,
  },
  {
    value: 'mikroorm',
    label: 'MikroORM',
    fn: 'fromMikroOrm',
    kind: 'orm',
    snippet: `import { fromMikroOrm } from '@portqueue/core/tx';

await orm.em.transactional(async (em) => {
  em.persist(new Order(order));
  const fulfillmentQueue = pq.createQueue('fulfillment');
  await fulfillmentQueue.addJob({ data: { orderId }, tx: fromMikroOrm(em) });
});`,
  },
  {
    value: 'pg',
    label: 'Raw pg',
    fn: 'fromPg',
    kind: 'raw',
    snippet: `import { fromPg } from '@portqueue/core/tx';

await client.query('BEGIN');
await client.query('INSERT INTO "order" (...) VALUES (...)');
const fulfillmentQueue = pq.createQueue('fulfillment');
await fulfillmentQueue.addJob({ data, tx: fromPg(client) });
await client.query('COMMIT'); // the app owns commit/rollback`,
  },
  {
    value: 'oracle',
    label: 'Raw oracledb',
    fn: 'fromOracle',
    kind: 'raw',
    snippet: `import { fromOracle } from '@portqueue/core/tx';

const connection = await oracledb.getConnection();
try {
  await connection.execute('INSERT INTO "order" (...) VALUES (...)');
  const fulfillmentQueue = pq.createQueue('fulfillment');
  await fulfillmentQueue.addJob({ data, tx: fromOracle(connection) });
  await connection.commit(); // the app owns commit/rollback
} finally {
  await connection.close();
}`,
  },
  {
    value: 'better-sqlite3',
    label: 'better-sqlite3',
    fn: 'fromBetterSqlite3',
    kind: 'raw',
    snippet: `import { fromBetterSqlite3 } from '@portqueue/core/tx';

// better-sqlite3 is synchronous; wrap the add in its transaction().
const tx = db.transaction((order) => {
  db.prepare('INSERT INTO "order" (id) VALUES (?)').run(order.id);
  const fulfillmentQueue = pq.createQueue('fulfillment');
  void fulfillmentQueue.addJob({ data: { orderId: order.id }, tx: fromBetterSqlite3(db) });
});
tx(order);`,
  },
  {
    value: 'node-sqlite',
    label: 'node:sqlite',
    fn: 'fromNodeSqlite',
    kind: 'raw',
    snippet: `import { fromNodeSqlite } from '@portqueue/core/tx';

db.exec('BEGIN');
db.prepare('INSERT INTO "order" (id) VALUES (?)').run(order.id);
const fulfillmentQueue = pq.createQueue('fulfillment');
await fulfillmentQueue.addJob({ data: { orderId: order.id }, tx: fromNodeSqlite(db) });
db.exec('COMMIT'); // the app owns commit/rollback`,
  },
];
