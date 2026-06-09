// Development fixture data. Run with: `pnpm db:seed`.
//
// Idempotent — safe to re-run. Upsert for rows with natural unique keys
// (email, slug, composite org+user), delete+create for children that
// don't have one (stores, products, orders) so re-running stays clean.
//
// What you get:
//   - 2 login-capable users (berkin, demo) with fixed UUIDs in BOTH
//     auth.users and user_profiles. Password: SEED_PASSWORD below.
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
// To sign in as a seed user from a Next.js frontend (or via curl):
//   POST {SUPABASE_URL}/auth/v1/token?grant_type=password
//     apikey: {NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}
//     body: { email, password: SEED_PASSWORD }
//   → response.access_token goes into `Authorization: Bearer …` for
//     backend calls. authMiddleware verifies via supabase.auth.getUser.
import path from 'node:path';
import { encrypt } from '@pazarsync/crypto-core';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

import { PrismaPg } from '@prisma/adapter-pg';
import { createClient } from '@supabase/supabase-js';

import { PrismaClient } from '../generated/prisma/client.js';

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter });

function supabaseAdmin() {
  const url = process.env['SUPABASE_URL'];
  const secret = process.env['SUPABASE_SECRET_KEY'];
  if (url === undefined || url.length === 0 || secret === undefined || secret.length === 0) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SECRET_KEY are required to seed auth.users. ' +
        'Check workspace-root .env or run `supabase status -o env`.',
    );
  }
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Encrypt seed store credentials with the shared AES-256-GCM envelope
// (@pazarsync/crypto-core) — the same one the marketplace adapter decrypts
// with, so the seed's wire format can never drift from the canonical helper.
function encryptCredentials(creds: Record<string, unknown>): string {
  const keyHex = process.env['ENCRYPTION_KEY'];
  if (keyHex === undefined || keyHex.length === 0) {
    throw new Error('ENCRYPTION_KEY is required to seed encrypted store credentials.');
  }
  return encrypt(JSON.stringify(creds), Buffer.from(keyHex, 'hex'));
}

// Fixed UUIDs so re-seeding stays stable and Supabase Studio keeps the
// same user rows. admin.createUser accepts an `id` parameter; if a row
// with that email already exists we reuse its id.
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

// Single seed-wide password for local dev convenience. NEVER use in prod.
const SEED_PASSWORD = 'pazarsync-dev-password';

const ORGS = {
  akyildiz: { slug: 'akyildiz-ticaret', name: 'Akyıldız Ticaret' },
  yildirim: { slug: 'yildirim-ev-urunleri', name: 'Yıldırım Ev Ürünleri' },
} as const;

/**
 * Ensure an auth.users row exists with the given email + id, then mirror
 * it into user_profiles. Idempotent — re-running uses the existing row.
 *
 * Resolves the mismatch noted in the original seed header: previously
 * USERS.*.id didn't match any auth.users UUID, so seed users couldn't
 * actually log in. Now they can (password = SEED_PASSWORD).
 */
async function seedUsers(): Promise<void> {
  const admin = supabaseAdmin();

  for (const u of Object.values(USERS)) {
    // Idempotent create: if email already registered, we reuse the row.
    const { error } = await admin.auth.admin.createUser({
      id: u.id,
      email: u.email,
      password: SEED_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: u.fullName },
    });
    if (error !== null && !/already (been )?registered|already exists/i.test(error.message)) {
      throw new Error(`auth.admin.createUser failed for ${u.email}: ${error.message}`);
    }

    await prisma.userProfile.upsert({
      where: { email: u.email },
      create: { id: u.id, email: u.email, fullName: u.fullName },
      update: { fullName: u.fullName },
    });
  }
  console.log(
    `\u2713 auth.users + user_profiles: ${Object.keys(USERS).length.toString()} rows each`,
  );
  console.log(`  login password for seed users: ${SEED_PASSWORD}`);
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
}): Promise<{ akyildizTrendyol: string; akyildizTrendyolSandbox: string }> {
  // Children with no natural unique key: delete and re-create for idempotency.
  // Cascade takes care of products/orders/order_items/sync_logs via FK.
  await prisma.store.deleteMany({
    where: { organizationId: { in: [orgs.akyildiz.id, orgs.yildirim.id] } },
  });

  // The PROD-environment Trendyol store. externalAccountId maps to the
  // supplierId in tmp/trendyol/reference/prod-*.json captures (Berkin's real
  // Trendyol panel session) so the seed-reference loader can attach the
  // ~135 K captured prod commission rows under the same platform=TRENDYOL
  // scope. The encrypted credentials here are still placeholders; replace
  // via the real connect-store flow when hitting Trendyol's marketplace API
  // rather than the panel BFF.
  const akyildizStore = await prisma.store.create({
    data: {
      organizationId: orgs.akyildiz.id,
      name: 'Akyıldız Trendyol',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: '1125805',
      credentials: encryptCredentials({
        apiKey: 'seed-trendyol-api-key',
        apiSecret: 'seed-trendyol-api-secret',
        sellerId: '1125805',
      }),
    },
  });

  // The SANDBOX Trendyol store mapped to Trendyol's shared test supplier
  // (mpentegrasyon@entegrasyon.com, supplierId=2738) used in stage-*.json
  // captures. Two stores under one org is intentional: lets us load both
  // prod and stage tarife snapshots without inventing a second organization
  // (which would complicate org-isolation tests).
  const akyildizSandboxStore = await prisma.store.create({
    data: {
      organizationId: orgs.akyildiz.id,
      name: 'Akyıldız Trendyol (Sandbox)',
      platform: 'TRENDYOL',
      environment: 'SANDBOX',
      externalAccountId: '2738',
      credentials: encryptCredentials({
        apiKey: 'seed-trendyol-sandbox-api-key',
        apiSecret: 'seed-trendyol-sandbox-api-secret',
        sellerId: '2738',
      }),
    },
  });

  const yildirimStore = await prisma.store.create({
    data: {
      organizationId: orgs.yildirim.id,
      name: 'Yıldırım Hepsiburada',
      platform: 'HEPSIBURADA',
      externalAccountId: 'seed-merchant-1',
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
    const product = await prisma.product.create({
      data: {
        organizationId: p.orgId,
        storeId: p.storeId,
        platformContentId: BigInt(900000 + i + 1),
        productMainId: `seed-product-${(i + 1).toString()}`,
        title: p.title,
      },
    });
    // Each seed product gets one default variant carrying the barcode and
    // cost. Multi-variant fixtures live in test factories, not the seed.
    await prisma.productVariant.create({
      data: {
        organizationId: p.orgId,
        storeId: p.storeId,
        productId: product.id,
        platformVariantId: BigInt(910000 + i + 1),
        barcode: p.barcode,
        stockCode: `seed-sku-${(i + 1).toString()}`,
        salePrice: p.cost,
        listPrice: p.cost,
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
  // PR-5c (2026-05-19): Eski Order ücret kolonları silindi (totalAmount,
  // commissionAmount, shippingCost, platformFee, vatAmount, netProfit). Seed
  // siparişleri minimal — yeni convention kolonları (saleSubtotalNet, etc.)
  // PR-6 sync handler doldurur; seed sadece fixture varlığı sağlar. Numeric
  // değerler (o.total/commission/shipping) artık kullanılmıyor.
  for (const [i, o] of orders.entries()) {
    await prisma.order.create({
      data: {
        organizationId: o.orgId,
        storeId: o.storeId,
        platformOrderId: `seed-order-${(i + 1).toString()}`,
        orderDate: o.date,
        status: o.status,
      },
    });
  }

  console.log(
    `\u2713 stores: 2 rows, products: ${products.length.toString()} rows, orders: ${orders.length.toString()} rows`,
  );

  return {
    akyildizTrendyol: akyildizStore.id,
    akyildizTrendyolSandbox: akyildizSandboxStore.id,
  };
}

async function seedMemberStoreAccess(
  orgs: { akyildiz: { id: string } },
  storeIds: { akyildizTrendyol: string },
): Promise<void> {
  // Demo is MEMBER of Akyıldız; grant only the PROD store (not the sandbox) so
  // the dev UI shows partial store access (1 of 2 stores). Yıldırım gets no
  // grants on purpose — Berkin is VIEWER there with zero access, exercising the
  // "no store access yet" panel gate. OWNERs (Berkin@Akyıldız, Demo@Yıldırım)
  // need no rows; they see every store in their org by role.
  const demoMembership = await prisma.organizationMember.findUniqueOrThrow({
    where: {
      organizationId_userId: { organizationId: orgs.akyildiz.id, userId: USERS.demo.id },
    },
    select: { id: true },
  });
  // Idempotent: clear this member's grants, then re-create the canonical one.
  await prisma.memberStoreAccess.deleteMany({ where: { memberId: demoMembership.id } });
  await prisma.memberStoreAccess.create({
    data: {
      organizationId: orgs.akyildiz.id,
      memberId: demoMembership.id,
      storeId: storeIds.akyildizTrendyol,
    },
  });
  console.log('✓ member_store_access: 1 grant (demo → Akyıldız Trendyol PROD)');
}

async function main(): Promise<void> {
  // Clean-by-default: `db:seed` is a no-op unless `--with-sample` is passed.
  // Tests never depend on seed data — every integration test wipes the tenant
  // tables (truncateAll) and builds its own fixtures via factories, and
  // reference data (shipping/fees/commission) comes from the integration
  // globalSetup / per-test helpers, not this seed. So the seed exists purely to
  // hydrate the dev UI; opt in only when you actually want demo data.
  if (!process.argv.includes('--with-sample')) {
    console.log('✓ Seed skipped — clean baseline. Pass --with-sample to seed demo data.');
    return;
  }

  await seedUsers();
  const orgs = await seedOrgsAndMemberships();
  const storeIds = await seedStoresProductsOrders(orgs);
  await seedMemberStoreAccess(orgs, storeIds);
  // Reference data (commission rates etc.) lives in scripts/seed-reference.ts —
  // run `pnpm db:seed-reference` once after a fresh DB. Splitting it out keeps
  // this seed about dev fixtures and lets reference re-loads run without
  // touching users / orgs / stores.

  // Surface the RLS policy count as a quick "did db:apply-policies run?"
  // sanity check. Zero would mean the policy file never landed — seed
  // otherwise succeeds silently on a wide-open DB.
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM pg_policies WHERE schemaname = 'public'
  `;
  console.log(`\u2713 rls policies applied: ${rows[0]?.count.toString() ?? '0'}`);

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
