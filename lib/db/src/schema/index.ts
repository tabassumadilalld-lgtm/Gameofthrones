// Export your models here. Add one export per file
// export * from "./posts";
//
// Each model/table should ideally be split into different files.
// Each model/table should define a Drizzle table, insert schema, and types:
//
//   import { pgTable, text, serial } from "drizzle-orm/pg-core";
//   import { createInsertSchema } from "drizzle-zod";
//   import { z } from "zod/v4";
//
//   export const postsTable = pgTable("posts", {
//     id: serial("id").primaryKey(),
//     title: text("title").notNull(),
//   });
//
//   export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true });
//   export type InsertPost = z.infer<typeof insertPostSchema>;
//   export type Post = typeof postsTable.$inferSelect;

import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export type QuizOption = {
  id: string;
  text: string;
  scoreValue?: number;
  isCorrect?: boolean;
};

export type QuizQuestion = {
  id: string;
  text: string;
  type:
    | "single-choice"
    | "multiple-choice"
    | "yes-no"
    | "short-answer"
    | "personality"
    | "score-based";
  position: number;
  noButtonMode?: "normal" | "playful" | "escape" | "disabled";
  options: QuizOption[];
};

export type SubmittedAnswer = {
  questionId: string;
  selectedOptionIds: string[];
  shortAnswer?: string;
};

export const quizVisibility = pgEnum("quiz_visibility", [
  "public",
  "unlisted",
  "private",
]);
export const quizStatus = pgEnum("quiz_status", ["draft", "published"]);

export const quizzesTable = pgTable(
  "quizzes",
  {
    id: serial("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").notNull().default("Fun"),
    visibility: quizVisibility("visibility").notNull().default("unlisted"),
    status: quizStatus("status").notNull().default("draft"),
    resultVisibility: boolean("result_visibility").notNull().default(true),
    allowRetake: boolean("allow_retake").notNull().default(true),
    questions: jsonb("questions").$type<QuizQuestion[]>().notNull().default([]),
    views: integer("views").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("quizzes_owner_created_idx").on(table.ownerId, table.createdAt),
    index("quizzes_public_status_idx").on(table.visibility, table.status),
  ],
);

export const quizAttemptsTable = pgTable(
  "quiz_attempts",
  {
    id: serial("id").primaryKey(),
    quizId: integer("quiz_id")
      .notNull()
      .references(() => quizzesTable.id, { onDelete: "cascade" }),
    participantNickname: text("participant_nickname"),
    participantToken: text("participant_token"),
    answers: jsonb("answers").$type<SubmittedAnswer[]>().notNull(),
    scorePercent: doublePrecision("score_percent"),
    correctCount: integer("correct_count").notNull().default(0),
    scoredCount: integer("scored_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("quiz_attempts_quiz_submitted_idx").on(
      table.quizId,
      table.submittedAt,
    ),
    index("quiz_attempts_quiz_participant_idx").on(
      table.quizId,
      table.participantToken,
    ),
  ],
);