import { relations } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "../auth/schema";
import { curriculumModule } from "../curriculum/schema";
import { academicPeriod } from "../hierarchy/schema";

export const plan = pgTable(
  "plan",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    priceEg: integer("price_eg").notNull(),
    durationDays: integer("duration_days").notNull(),
    // scope: "module" | "term" | "year"
    scope: text("scope").notNull().default("year"),
    // module scope → module slug; term scope → "1" | "2"; year scope → null
    scopeRef: text("scope_ref"),
    // hidden from purchase UI / admin but kept so old subscriptions still resolve
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("plan_scope_idx").on(table.scope, table.scopeRef)],
);

export const subscription = pgTable(
  "subscription",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plan.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("active"), // active | expired | grace | cancelled
    startsAt: timestamp("starts_at").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    graceExpiresAt: timestamp("grace_expires_at"), // 3-day grace period after expiry
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("subscription_user_idx").on(table.userId, table.status),
    index("subscription_user_plan_active_idx").on(table.userId, table.planId, table.status),
  ],
);

export const payment = pgTable(
  "payment",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plan.id, { onDelete: "restrict" }),
    amountEg: integer("amount_eg").notNull(),
    // Paymob fields
    paymobOrderId: text("paymob_order_id"),
    paymobPaymentKey: text("paymob_payment_key"),
    paymobTransactionId: text("paymob_transaction_id"),
    status: text("status").notNull().default("pending"), // pending | paid | failed | refunded
    paymentMethod: text("payment_method"), // card | wallet | fawry
    paidAt: timestamp("paid_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("payment_user_idx").on(table.userId),
    index("payment_status_idx").on(table.status),
  ],
);

export const promoCode = pgTable(
  "promo_code",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    internalLabel: text("internal_label"),
    rewardType: text("reward_type").notNull().default("PERCENTAGE_DISCOUNT"),
    description: text("description"),
    discountType: text("discount_type").notNull(), // PERCENTAGE | FIXED_EGP
    discountValue: integer("discount_value").notNull(),
    appliesTo: text("applies_to").notNull().default("ANY"), // ANY | MODULE | FULL_TERM
    moduleId: text("module_id").references(() => curriculumModule.id, { onDelete: "set null" }),
    academicPeriodId: text("academic_period_id").references(() => academicPeriod.id, { onDelete: "set null" }),
    active: boolean("active").notNull().default(true),
    startsAt: timestamp("starts_at"),
    expiresAt: timestamp("expires_at"),
    maxUses: integer("max_uses"),
    usedCount: integer("used_count").notNull().default(0),
    maxUsesPerUser: integer("max_uses_per_user").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("promo_code_code_idx").on(table.code),
    index("promo_code_active_idx").on(table.active, table.startsAt, table.expiresAt),
  ],
);

export const promoRedemption = pgTable(
  "promo_redemption",
  {
    id: text("id").primaryKey(),
    promoCodeId: text("promo_code_id")
      .notNull()
      .references(() => promoCode.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    paymentId: text("payment_id").references(() => payment.id, { onDelete: "set null" }),
    discountAmountCents: integer("discount_amount_cents").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("promo_redemption_code_idx").on(table.promoCodeId),
    index("promo_redemption_user_idx").on(table.userId, table.promoCodeId),
    uniqueIndex("promo_redemption_code_user_unique").on(table.promoCodeId, table.userId),
  ],
);

export const summerAccess = pgTable(
  "summer_access",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    moduleId: text("module_id").notNull().references(() => curriculumModule.id, { onDelete: "restrict" }),
    summerSessionId: text("summer_session_id").notNull().references(() => academicPeriod.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("summer_access_user_module_session_idx").on(table.userId, table.moduleId, table.summerSessionId),
    index("summer_access_user_expiry_idx").on(table.userId, table.expiresAt),
  ],
);

export const planRelations = relations(plan, ({ many }) => ({
  subscriptions: many(subscription),
}));

export const promoCodeRelations = relations(promoCode, ({ one, many }) => ({
  module: one(curriculumModule, {
    fields: [promoCode.moduleId],
    references: [curriculumModule.id],
  }),
  academicPeriod: one(academicPeriod, {
    fields: [promoCode.academicPeriodId],
    references: [academicPeriod.id],
  }),
  redemptions: many(promoRedemption),
}));

export const promoRedemptionRelations = relations(promoRedemption, ({ one }) => ({
  promoCode: one(promoCode, {
    fields: [promoRedemption.promoCodeId],
    references: [promoCode.id],
  }),
  user: one(user, {
    fields: [promoRedemption.userId],
    references: [user.id],
  }),
  payment: one(payment, {
    fields: [promoRedemption.paymentId],
    references: [payment.id],
  }),
}));

export const summerAccessRelations = relations(summerAccess, ({ one }) => ({
  user: one(user, { fields: [summerAccess.userId], references: [user.id] }),
  module: one(curriculumModule, { fields: [summerAccess.moduleId], references: [curriculumModule.id] }),
  summerSession: one(academicPeriod, { fields: [summerAccess.summerSessionId], references: [academicPeriod.id] }),
}));

export const subscriptionRelations = relations(subscription, ({ one }) => ({
  user: one(user, {
    fields: [subscription.userId],
    references: [user.id],
  }),
  plan: one(plan, {
    fields: [subscription.planId],
    references: [plan.id],
  }),
}));
