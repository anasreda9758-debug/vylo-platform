import { relations } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// ── University Hierarchy ──

export const university = pgTable("university", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const faculty = pgTable("faculty", {
  id: text("id").primaryKey(),
  universityId: text("university_id")
    .notNull()
    .references(() => university.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const program = pgTable("program", {
  id: text("id").primaryKey(),
  facultyId: text("faculty_id")
    .notNull()
    .references(() => faculty.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  slug: text("slug").notNull().unique(),
  durationYears: integer("duration_years").notNull().default(5),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const academicYear = pgTable("academic_year", {
  id: text("id").primaryKey(),
  programId: text("program_id")
    .notNull()
    .references(() => program.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // "السنة الأولى", "السنة الثانية", etc.
  order: integer("order").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const academicPeriod = pgTable(
  "academic_period",
  {
    id: text("id").primaryKey(),
    academicYear: text("academic_year").notNull(),
    type: text("type").notNull(), // TERM_1 | TERM_2 | SUMMER
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("academic_period_year_type_idx").on(table.academicYear, table.type),
    index("academic_period_active_idx").on(table.active, table.startsAt, table.endsAt),
  ],
);

export const semester = pgTable("semester", {
  id: text("id").primaryKey(),
  academicYearId: text("academic_year_id")
    .notNull()
    .references(() => academicYear.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // "الترم الأول", "الترم الثاني"
  term: integer("term").notNull(), // 1 or 2
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const subject = pgTable("subject", {
  id: text("id").primaryKey(),
  semesterId: text("semester_id")
    .notNull()
    .references(() => semester.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  slug: text("slug").notNull().unique(),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Audit Log ──

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    userName: text("user_name"),
    action: text("action").notNull(), // create | update | delete | reorder
    entityType: text("entity_type").notNull(), // module | lecture | subject | etc.
    entityId: text("entity_id"),
    entityName: text("entity_name"),
    oldData: text("old_data"), // JSON string
    newData: text("new_data"), // JSON string
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_user_idx").on(table.userId),
    index("audit_log_entity_idx").on(table.entityType, table.entityId),
    index("audit_log_created_idx").on(table.createdAt),
  ],
);

// ── Relations ──

export const universityRelations = relations(university, ({ many }) => ({
  faculties: many(faculty),
}));

export const facultyRelations = relations(faculty, ({ one, many }) => ({
  university: one(university, {
    fields: [faculty.universityId],
    references: [university.id],
  }),
  programs: many(program),
}));

export const programRelations = relations(program, ({ one, many }) => ({
  faculty: one(faculty, {
    fields: [program.facultyId],
    references: [faculty.id],
  }),
  years: many(academicYear),
}));

export const academicYearRelations = relations(academicYear, ({ one, many }) => ({
  program: one(program, {
    fields: [academicYear.programId],
    references: [program.id],
  }),
  semesters: many(semester),
}));
export const semesterRelations = relations(semester, ({ one, many }) => ({
  academicYear: one(academicYear, {
    fields: [semester.academicYearId],
    references: [academicYear.id],
  }),
  subjects: many(subject),
}));

export const subjectRelations = relations(subject, ({ one }) => ({
  semester: one(semester, {
    fields: [subject.semesterId],
    references: [semester.id],
  }),
}));
