// Development fixture data. Run with: `pnpm db:seed`.
//
// Idempotent — safe to re-run. Upsert for rows with natural unique keys
// (email, slug, composite org+user), delete+create for children that
// don't have one (stores, products, orders) so re-running stays clean.
//
// What you get:
//   - 2 users (berkin, demo) with fixed UUIDs — so re-seeding keeps the
//     same IDs, convenient for pointing a Supabase Auth user at them.
//   - 2 organizations (Akyıldız, Yıldırım) with intentionally mixed
//     memberships to exercise the tenant-isolation invariant:
//
//       Akyıldız  : Berkin=OWNER  Demo=MEMBER
//       Yıldırım  : Demo=OWNER    Berkin=VIEWER
//
//   - 1 store per org (Trendyol / Hepsiburada) with REAL AES-256-GCM
//     encrypted credentials — mirrors production shape, not a placeholder.
//   - Products and orders per store, spanning OrderStatus values so the
//     profit panel / status filters have meaningful sample data.
//
// What this seed does NOT do:
//   - Create `auth.users` rows. Supabase Auth manages that schema
//     separately. To log in as one of these users:
//       1. Sign up via Supabase Studio → Authentication → Add User.
//       2. Copy the new user's UUID.
//       3. Replace the matching `USERS.*.id` below and re-seed
//          (or update `user_profiles.id` directly once).
import path from 'node:path';
import { createCipheriv, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter });

// Mirror of apps/api/src/lib/crypto.ts encryptCredentials. Kept inline
// because packages/db must not depend on apps/api (dependency direction
// is apps → packages). If this ever drifts from the canonical helper,
// the marketplace adapter will fail to decrypt.
function encryptCredentials(creds: Record<string, unknown>): string {
  const keyHex = process.env['ENCRYPTION_KEY'];
  if (keyHex === undefined || keyHex.length === 0) {
    throw new Error('ENCRYPTION_KEY is required to seed encrypted store credentials.');
  }
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be 32 bytes (64 hex chars). Got ${key.length.toString()}.`,
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(creds), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

const USERS = {
  berkin: {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'berkinoktayai@gmail.com',
    fullName: 'Berkin Oktay',
  },
  demo: {
    id: '00000000-0000-0000-0000-000000000002',
    email: 'demo@pazarsync.local',
    fullName: 'Demo User',
  },
} as const;

const ORGS = {
  akyildiz: { slug: 'akyildiz-ticaret', name: 'Akyıldız Ticaret' },
  yildirim: { slug: 'yildirim-ev-urunleri', name: 'Yıldırım Ev Ürünleri' },
} as const;

async function seedUsers(): Promise<void> {
  for (const u of Object.values(USERS)) {
    await prisma.userProfile.upsert({
      where: { email: u.email },
      create: { id: u.id, email: u.email, fullName: u.fullName },
      update: { fullName: u.fullName },
    });
  }
  console.log(`\u2713 user_profiles: ${Object.keys(USERS).length.toString()} rows`);
}

async function seedOrgsAndMemberships(): Promise<{
  akyildiz: { id: string };
  yildirim: { id: string };
}> {
  const akyildiz = await prisma.organization.upsert({
    where: { slug: ORGS.akyildiz.slug },
    create: ORGS.akyildiz,
    update: { name: ORGS.akyildiz.name },
  });
  const yildirim = await prisma.organization.upsert({
    where: { slug: ORGS.yildirim.slug },
    create: ORGS.yildirim,
    update: { name: ORGS.yildirim.name },
  });

  const memberships = [
    { organizationId: akyildiz.id, userId: USERS.berkin.id, role: 'OWNER' as const },
    { organizationId: akyildiz.id, userId: USERS.demo.id, role: 'MEMBER' as const },
    { organizationId: yildirim.id, userId: USERS.demo.id, role: 'OWNER' as const },
    { organizationId: yildirim.id, userId: USERS.berkin.id, role: 'VIEWER' as const },
  ];
  for (const m of memberships) {
    await prisma.organizationMember.upsert({
      where: {
        organizationId_userId: { organizationId: m.organizationId, userId: m.userId },
      },
      create: m,
      update: { role: m.role },
    });
  }
  console.log(
    `\u2713 organizations: 2 rows, organization_members: ${memberships.length.toString()} rows`,
  );
  return { akyildiz, yildirim };
}

async function seedStoresProductsOrders(orgs: {
  akyildiz: { id: string };
  yildirim: { id: string };
}): Promise<void> {
  // Children with no natural unique key: delete and re-create for idempotency.
  // Cascade takes care of products/orders/order_items/sync_logs via FK.
  await prisma.store.deleteMany({
    where: { organizationId: { in: [orgs.akyildiz.id, orgs.yildirim.id] } },
  });

  const akyildizStore = await prisma.store.create({
    data: {
      organizationId: orgs.akyildiz.id,
      name: 'Akyıldız Trendyol',
      platform: 'TRENDYOL',
      credentials: encryptCredentials({
        apiKey: 'seed-trendyol-api-key',
        apiSecret: 'seed-trendyol-api-secret',
        sellerId: '99999',
      }),
    },
  });

  const yildirimStore = await prisma.store.create({
    data: {
      organizationId: orgs.yildirim.id,
      name: 'Yıldırım Hepsiburada',
      platform: 'HEPSIBURADA',
      credentials: encryptCredentials({
        username: 'seed-hb-username',
        password: 'seed-hb-password',
        merchantId: 'seed-merchant-1',
      }),
    },
  });

  const products = [
    {
      storeId: akyildizStore.id,
      orgId: orgs.akyildiz.id,
      title: 'Seramik Tencere Seti 7 Parça',
      barcode: '8690000000001',
      cost: '185.00',
    },
    {
      storeId: akyildizStore.id,
      orgId: orgs.akyildiz.id,
      title: 'Granit Tava 28cm',
      barcode: '8690000000002',
      cost: '95.50',
    },
    {
      storeId: akyildizStore.id,
      orgId: orgs.akyildiz.id,
      title: 'Paslanmaz Kaşık Seti 12li',
      barcode: '8690000000003',
      cost: '42.00',
    },
    {
      storeId: yildirimStore.id,
      orgId: orgs.yildirim.id,
      title: 'Bambu Kesme Tahtası Büyük',
      barcode: '8690000000101',
      cost: '60.00',
    },
    {
      storeId: yildirimStore.id,
      orgId: orgs.yildirim.id,
      title: 'Cam Saklama Kabı 3lü Set',
      barcode: '8690000000102',
      cost: '75.00',
    },
  ];
  for (const [i, p] of products.entries()) {
    await prisma.product.create({
      data: {
        organizationId: p.orgId,
        storeId: p.storeId,
        platformProductId: `seed-product-${(i + 1).toString()}`,
        barcode: p.barcode,
        title: p.title,
        costPrice: p.cost,
      },
    });
  }

  const now = new Date();
  const daysAgo = (n: number): Date => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  const orders = [
    {
      storeId: akyildizStore.id,
      orgId: orgs.akyildiz.id,
      status: 'DELIVERED' as const,
      total: '429.90',
      commission: '76.79',
      shipping: '29.99',
      date: daysAgo(1),
    },
    {
      storeId: akyildizStore.id,
      orgId: orgs.akyildiz.id,
      status: 'SHIPPED' as const,
      total: '189.50',
      commission: '33.85',
      shipping: '29.99',
      date: daysAgo(3),
    },
    {
      storeId: akyildizStore.id,
      orgId: orgs.akyildiz.id,
      status: 'RETURNED' as const,
      total: '320.00',
      commission: '57.16',
      shipping: '29.99',
      date: daysAgo(12),
    },
    {
      storeId: akyildizStore.id,
      orgId: orgs.akyildiz.id,
      status: 'PROCESSING' as const,
      total: '95.50',
      commission: '17.06',
      shipping: '29.99',
      date: daysAgo(0),
    },
    {
      storeId: yildirimStore.id,
      orgId: orgs.yildirim.id,
      status: 'DELIVERED' as const,
      total: '210.00',
      commission: '37.51',
      shipping: '24.99',
      date: daysAgo(2),
    },
    {
      storeId: yildirimStore.id,
      orgId: orgs.yildirim.id,
      status: 'DELIVERED' as const,
      total: '148.00',
      commission: '26.43',
      shipping: '24.99',
      date: daysAgo(5),
    },
  ];
  for (const [i, o] of orders.entries()) {
    await prisma.order.create({
      data: {
        organizationId: o.orgId,
        storeId: o.storeId,
        platformOrderId: `seed-order-${(i + 1).toString()}`,
        orderDate: o.date,
        status: o.status,
        totalAmount: o.total,
        commissionAmount: o.commission,
        shippingCost: o.shipping,
      },
    });
  }

  console.log(
    `\u2713 stores: 2 rows, products: ${products.length.toString()} rows, orders: ${orders.length.toString()} rows`,
  );
}

async function main(): Promise<void> {
  await seedUsers();
  const orgs = await seedOrgsAndMemberships();
  await seedStoresProductsOrders(orgs);
  console.log('\n\u2713 Seed complete. Open http://127.0.0.1:54323 to browse.');
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
