import { createHash, randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { getAuth } from "@clerk/express";
import { and, avg, count, desc, eq, ilike, sql } from "drizzle-orm";
import {
  CreateQuizBody,
  CreateQuizResponse,
  DeleteQuizParams,
  ExploreQuizzesQueryParams,
  ExploreQuizzesResponse,
  ExportQuizResponsesParams,
  GetCurrentUserResponse,
  GetDashboardResponse,
  GetPublicQuizParams,
  GetPublicQuizResponse,
  GetQuizAnalyticsParams,
  GetQuizAnalyticsResponse,
  GetQuizParams,
  GetQuizResponse,
  ListMyQuizzesResponse,
  ListTemplatesResponse,
  SubmitQuizAttemptBody,
  SubmitQuizAttemptParams,
  SubmitQuizAttemptResponse,
  UpdateQuizBody,
  UpdateQuizParams,
  UpdateQuizResponse,
} from "@workspace/api-zod";
import {
  db,
  quizAttemptsTable,
  quizzesTable,
  type QuizQuestion,
  type SubmittedAnswer,
} from "@workspace/db";

const router: IRouter = Router();

const submissionLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Please wait a moment before submitting another response." },
});

function requireUser(req: Request, res: Response): string | null {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to continue." });
    return null;
  }
  return userId;
}

async function ownedQuiz(id: number, ownerId: string) {
  const [quiz] = await db
    .select()
    .from(quizzesTable)
    .where(and(eq(quizzesTable.id, id), eq(quizzesTable.ownerId, ownerId)))
    .limit(1);
  return quiz;
}

async function attemptsForQuiz(quizId: number): Promise<number> {
  const [result] = await db
    .select({ total: count() })
    .from(quizAttemptsTable)
    .where(eq(quizAttemptsTable.quizId, quizId));
  return Number(result?.total ?? 0);
}

async function asQuiz(quiz: typeof quizzesTable.$inferSelect) {
  return GetQuizResponse.parse({
    ...quiz,
    attempts: await attemptsForQuiz(quiz.id),
  });
}

function randomPublicId(): string {
  return randomBytes(18).toString("base64url");
}

function participantKeyFor(
  req: Request,
  res: Response,
  quizId: number,
): string {
  const existing = req.cookies?.lovelock_participant;
  const token =
    typeof existing === "string" && existing.length >= 20
      ? existing
      : randomPublicId();
  if (!existing || existing.length < 20) {
    res.cookie("lovelock_participant", token, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/api/public/quizzes",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return createHash("sha256")
    .update(`${token}:${quizId}`)
    .digest("hex");
}

function validateQuizContent(
  title: string,
  questions: QuizQuestion[],
  status: "draft" | "published",
): string | null {
  if (questions.length > 100) return "A quiz can have at most 100 questions.";
  if (status === "published" && questions.length === 0) {
    return "Add at least one question before publishing.";
  }
  for (const question of questions) {
    if (!question.text.trim()) return "Every question needs text.";
    if (question.options.length > 30) {
      return "A question can have at most 30 answer options.";
    }
    if (question.type !== "short-answer" && question.options.length < 2) {
      return "Choice questions need at least two answer options.";
    }
    if (question.type === "yes-no" && question.options.length !== 2) {
      return "Yes/No questions need exactly two answer options.";
    }
    if (new Set(question.options.map((option) => option.id)).size !== question.options.length) {
      return "Answer option IDs must be unique within each question.";
    }
  }
  if (!title.trim()) return "A quiz needs a title.";
  return null;
}

function orderedQuestions(questions: QuizQuestion[]): QuizQuestion[] {
  return questions
    .map((question, index) => ({ ...question, position: index }))
    .sort((a, b) => a.position - b.position);
}

function publicQuizData(quiz: typeof quizzesTable.$inferSelect) {
  return GetPublicQuizResponse.parse({
    publicId: quiz.publicId,
    title: quiz.title,
    description: quiz.description,
    category: quiz.category,
    questions: quiz.questions.map((question) => ({
      id: question.id,
      text: question.text,
      type: question.type,
      position: question.position,
      noButtonMode: question.noButtonMode,
      options: question.options.map(({ id, text }) => ({ id, text })),
    })),
    allowRetake: quiz.allowRetake,
    resultVisibility: quiz.resultVisibility,
  });
}

const girlfriendQuestions: QuizQuestion[] = [
  {
    id: "g1",
    text: "Do you like me?",
    type: "yes-no",
    position: 0,
    noButtonMode: "playful",
    options: [
      { id: "g1-no", text: "No" },
      { id: "g1-yes", text: "Yes" },
    ],
  },
  {
    id: "g2",
    text: "Are you sure about your previous answer?",
    type: "single-choice",
    position: 1,
    noButtonMode: "playful",
    options: [
      { id: "g2-no", text: "No" },
      { id: "g2-yes", text: "YES" },
      { id: "g2-sure", text: "YES, I'M SURE" },
    ],
  },
  {
    id: "g3",
    text: "How much do you like me?",
    type: "single-choice",
    position: 2,
    noButtonMode: "playful",
    options: [
      { id: "g3-no", text: "No" },
      { id: "g3-little", text: "A little" },
      { id: "g3-lot", text: "A lot" },
      { id: "g3-words", text: "More than words can explain" },
      { id: "g3-classified", text: "Classified information" },
    ],
  },
  {
    id: "g4",
    text: "What's your favourite thing about me?",
    type: "single-choice",
    position: 3,
    noButtonMode: "playful",
    options: [
      { id: "g4-no", text: "No" },
      { id: "g4-personality", text: "Personality" },
      { id: "g4-humour", text: "Humour" },
      { id: "g4-kind", text: "How I treat people" },
      { id: "g4-everything", text: "Everything" },
    ],
  },
  {
    id: "g5",
    text: "If we could spend a day together, what would you choose?",
    type: "single-choice",
    position: 4,
    noButtonMode: "playful",
    options: [
      { id: "g5-no", text: "No" },
      { id: "g5-movie", text: "Watch a movie" },
      { id: "g5-food", text: "Go on a food adventure" },
      { id: "g5-games", text: "Play games" },
      { id: "g5-talk", text: "Talk for hours" },
    ],
  },
  {
    id: "g6",
    text: "What's our ideal vibe?",
    type: "single-choice",
    position: 5,
    noButtonMode: "playful",
    options: [
      { id: "g6-no", text: "No" },
      { id: "g6-chaos", text: "Chaotic besties" },
      { id: "g6-cute", text: "Cute and wholesome" },
      { id: "g6-mischief", text: "Harmless mischief" },
      { id: "g6-duo", text: "Unstoppable duo" },
    ],
  },
  {
    id: "g7",
    text: "Would you make more memories with me?",
    type: "single-choice",
    position: 6,
    noButtonMode: "playful",
    options: [
      { id: "g7-no", text: "No" },
      { id: "g7-obvious", text: "Obviously" },
      { id: "g7-course", text: "Of course" },
      { id: "g7-question", text: "Is that even a question?" },
    ],
  },
];

router.get("/me", (req, res): void => {
  const userId = requireUser(req, res);
  if (!userId) return;
  res.json(GetCurrentUserResponse.parse({ id: userId }));
});

router.get("/quizzes", async (req, res): Promise<void> => {
  const ownerId = requireUser(req, res);
  if (!ownerId) return;
  const rows = await db
    .select()
    .from(quizzesTable)
    .where(eq(quizzesTable.ownerId, ownerId))
    .orderBy(desc(quizzesTable.updatedAt));
  const quizzes = await Promise.all(rows.map(asQuiz));
  res.json(ListMyQuizzesResponse.parse(quizzes));
});

router.get("/dashboard", async (req, res): Promise<void> => {
  const ownerId = requireUser(req, res);
  if (!ownerId) return;
  const [quizTotals] = await db
    .select({ total: count() })
    .from(quizzesTable)
    .where(eq(quizzesTable.ownerId, ownerId));
  const [attemptTotals] = await db
    .select({
      total: count(),
      average: avg(quizAttemptsTable.scorePercent),
    })
    .from(quizAttemptsTable)
    .innerJoin(quizzesTable, eq(quizAttemptsTable.quizId, quizzesTable.id))
    .where(eq(quizzesTable.ownerId, ownerId));
  const recent = await db
    .select()
    .from(quizzesTable)
    .where(eq(quizzesTable.ownerId, ownerId))
    .orderBy(desc(quizzesTable.updatedAt))
    .limit(5);
  const recentQuizzes = await Promise.all(recent.map(asQuiz));
  const average = attemptTotals?.average;
  res.json(
    GetDashboardResponse.parse({
      totalQuizzes: Number(quizTotals?.total ?? 0),
      totalAttempts: Number(attemptTotals?.total ?? 0),
      completedResponses: Number(attemptTotals?.total ?? 0),
      averageScore: average == null ? null : Number(Number(average).toFixed(1)),
      recentQuizzes,
    }),
  );
});

router.post("/quizzes", async (req, res): Promise<void> => {
  const ownerId = requireUser(req, res);
  if (!ownerId) return;
  const parsed = CreateQuizBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const questions = orderedQuestions(data.questions);
  const validationError = validateQuizContent(data.title, questions, data.status);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }
  const [created] = await db
    .insert(quizzesTable)
    .values({
      publicId: randomPublicId(),
      ownerId,
      title: data.title.trim(),
      description: data.description.trim(),
      category: data.category.trim(),
      visibility: data.visibility,
      status: data.status,
      resultVisibility: data.resultVisibility,
      allowRetake: data.allowRetake,
      questions,
    })
    .returning();
  res.status(201).json(
    CreateQuizResponse.parse({
      ...created,
      attempts: 0,
    }),
  );
});

router.get("/quizzes/:quizId", async (req, res): Promise<void> => {
  const ownerId = requireUser(req, res);
  if (!ownerId) return;
  const params = GetQuizParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const quiz = await ownedQuiz(params.data.quizId, ownerId);
  if (!quiz) {
    res.status(404).json({ error: "Quiz not found." });
    return;
  }
  res.json(GetQuizResponse.parse(await asQuiz(quiz)));
});

router.patch("/quizzes/:quizId", async (req, res): Promise<void> => {
  const ownerId = requireUser(req, res);
  if (!ownerId) return;
  const params = UpdateQuizParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateQuizBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const questions = orderedQuestions(parsed.data.questions);
  const validationError = validateQuizContent(
    parsed.data.title,
    questions,
    parsed.data.status,
  );
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }
  const [updated] = await db
    .update(quizzesTable)
    .set({
      title: parsed.data.title.trim(),
      description: parsed.data.description.trim(),
      category: parsed.data.category.trim(),
      visibility: parsed.data.visibility,
      status: parsed.data.status,
      resultVisibility: parsed.data.resultVisibility,
      allowRetake: parsed.data.allowRetake,
      questions,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(quizzesTable.id, params.data.quizId),
        eq(quizzesTable.ownerId, ownerId),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Quiz not found." });
    return;
  }
  res.json(
    UpdateQuizResponse.parse({
      ...updated,
      attempts: await attemptsForQuiz(updated.id),
    }),
  );
});

router.delete("/quizzes/:quizId", async (req, res): Promise<void> => {
  const ownerId = requireUser(req, res);
  if (!ownerId) return;
  const params = DeleteQuizParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(quizzesTable)
    .where(
      and(
        eq(quizzesTable.id, params.data.quizId),
        eq(quizzesTable.ownerId, ownerId),
      ),
    )
    .returning({ id: quizzesTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Quiz not found." });
    return;
  }
  res.sendStatus(204);
});

router.get("/quizzes/:quizId/analytics", async (req, res): Promise<void> => {
  const ownerId = requireUser(req, res);
  if (!ownerId) return;
  const params = GetQuizAnalyticsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const quiz = await ownedQuiz(params.data.quizId, ownerId);
  if (!quiz) {
    res.status(404).json({ error: "Quiz not found." });
    return;
  }
  const attempts = await db
    .select()
    .from(quizAttemptsTable)
    .where(eq(quizAttemptsTable.quizId, quiz.id))
    .orderBy(desc(quizAttemptsTable.submittedAt));
  const questionAnalytics = quiz.questions.map((question) => {
    const counts = new Map<string, number>();
    for (const option of question.options) counts.set(option.id, 0);
    const writtenAnswers = new Map<string, number>();
    for (const attempt of attempts) {
      const answer = attempt.answers.find(
        (item) => item.questionId === question.id,
      );
      for (const optionId of answer?.selectedOptionIds ?? []) {
        if (counts.has(optionId)) {
          counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
        }
      }
      const written = answer?.shortAnswer?.trim();
      if (written) {
        writtenAnswers.set(written, (writtenAnswers.get(written) ?? 0) + 1);
      }
    }
    return {
      questionText: question.text,
      answers: [
        ...question.options.map((option) => ({
          optionText: option.text,
          count: counts.get(option.id) ?? 0,
        })),
        ...Array.from(writtenAnswers, ([optionText, total]) => ({
          optionText,
          count: total,
        })),
      ],
    };
  });
  const scoreValues = attempts
    .map((attempt) => attempt.scorePercent)
    .filter((value): value is number => value !== null);
  const totalViews = quiz.views;
  res.json(
    GetQuizAnalyticsResponse.parse({
      views: totalViews,
      attempts: attempts.length,
      completed: attempts.length,
      completionRate:
        totalViews === 0
          ? 0
          : Number(((attempts.length / totalViews) * 100).toFixed(1)),
      averageScore:
        scoreValues.length === 0
          ? null
          : Number(
              (
                scoreValues.reduce((sum, score) => sum + score, 0) /
                scoreValues.length
              ).toFixed(1),
            ),
      questions: questionAnalytics,
      submissions: attempts.map((attempt) => ({
        id: attempt.id,
        participantName: attempt.participantNickname,
        scorePercent: attempt.scorePercent,
        correctCount: attempt.correctCount,
        scoredCount: attempt.scoredCount,
        submittedAt: attempt.submittedAt.toISOString(),
      })),
    }),
  );
});

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

router.get("/quizzes/:quizId/export", async (req, res): Promise<void> => {
  const ownerId = requireUser(req, res);
  if (!ownerId) return;
  const params = ExportQuizResponsesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const quiz = await ownedQuiz(params.data.quizId, ownerId);
  if (!quiz) {
    res.status(404).json({ error: "Quiz not found." });
    return;
  }
  const attempts = await db
    .select()
    .from(quizAttemptsTable)
    .where(eq(quizAttemptsTable.quizId, quiz.id))
    .orderBy(desc(quizAttemptsTable.submittedAt));
  const headers = [
    "submittedAt",
    "nickname",
    ...quiz.questions.map((question) => question.text),
  ];
  const rows = attempts.map((attempt) => {
    const answers = quiz.questions.map((question) => {
      const answer = attempt.answers.find(
        (item) => item.questionId === question.id,
      );
      const optionNames = question.options
        .filter((option) => answer?.selectedOptionIds.includes(option.id))
        .map((option) => option.text);
      return [...optionNames, answer?.shortAnswer ?? ""].filter(Boolean).join("; ");
    });
    return [
      attempt.submittedAt.toISOString(),
      attempt.participantNickname ?? "Anonymous",
      ...answers,
    ];
  });
  const csv = [headers, ...rows]
    .map((row) => row.map((value) => csvCell(String(value))).join(","))
    .join("\r\n");
  res
    .type("text/csv")
    .attachment(`${quiz.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "quiz"}-responses.csv`)
    .send(csv);
});

router.get("/explore", async (req, res): Promise<void> => {
  const parsed = ExploreQuizzesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const filters = [
    eq(quizzesTable.visibility, "public"),
    eq(quizzesTable.status, "published"),
  ];
  if (parsed.data.category) {
    filters.push(eq(quizzesTable.category, parsed.data.category));
  }
  if (parsed.data.search) {
    filters.push(ilike(quizzesTable.title, `%${parsed.data.search}%`));
  }
  const order =
    parsed.data.sort === "popular"
      ? desc(count(quizAttemptsTable.id))
      : desc(quizzesTable.createdAt);
  const rows = await db
    .select({
      quiz: quizzesTable,
      attempts: count(quizAttemptsTable.id),
    })
    .from(quizzesTable)
    .leftJoin(quizAttemptsTable, eq(quizAttemptsTable.quizId, quizzesTable.id))
    .where(and(...filters))
    .groupBy(quizzesTable.id)
    .orderBy(order, desc(quizzesTable.createdAt))
    .limit(60);
  res.json(
    ExploreQuizzesResponse.parse(
      rows.map(({ quiz, attempts }) => ({
        publicId: quiz.publicId,
        title: quiz.title,
        description: quiz.description,
        category: quiz.category,
        attempts: Number(attempts),
      })),
    ),
  );
});

router.get("/templates", (_req, res): void => {
  const question = (
    id: string,
    text: string,
    options: string[],
  ): QuizQuestion => ({
    id,
    text,
    type: "single-choice",
    position: 0,
    options: options.map((option, index) => ({
      id: `${id}-${index + 1}`,
      text: option,
    })),
  });
  const templates = [
    {
      slug: "girlfriend-challenge",
      title: "Girlfriend Challenge 💗",
      description: "Let's see how well you know me!",
      category: "Couples",
      questions: girlfriendQuestions,
    },
    {
      slug: "boyfriend-challenge",
      title: "Boyfriend Challenge",
      description: "How well do you know your favorite person?",
      category: "Couples",
      questions: [
        question("b1", "What's my perfect weekend?", [
          "A quiet day at home",
          "A spontaneous adventure",
          "Dinner with friends",
        ]),
        question("b2", "What always makes me smile?", [
          "A thoughtful message",
          "A terrible joke",
          "My favorite snack",
        ]),
      ],
    },
    {
      slug: "best-friend-quiz",
      title: "Best Friend Quiz",
      description: "Find out who remembers all the little things.",
      category: "Friendship",
      questions: [
        question("f1", "What's my go-to comfort food?", [
          "Pizza",
          "Noodles",
          "Something sweet",
        ]),
        question("f2", "How do I recharge after a long week?", [
          "A cozy night in",
          "A day out",
          "A long catch-up call",
        ]),
      ],
    },
    {
      slug: "who-knows-me-best",
      title: "Who Knows Me Best?",
      description: "Send it to your group chat and compare answers.",
      category: "Friends",
      questions: [
        question("k1", "What would I pick for a free afternoon?", [
          "Watch a favorite show",
          "Explore somewhere new",
          "Make something creative",
        ]),
        question("k2", "Which tiny thing improves my day?", [
          "Good coffee",
          "A kind message",
          "A song I love",
        ]),
      ],
    },
  ];
  res.json(ListTemplatesResponse.parse(templates));
});

router.get("/public/quizzes/:publicId", async (req, res): Promise<void> => {
  const params = GetPublicQuizParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Quiz not found." });
    return;
  }
  const [quiz] = await db
    .select()
    .from(quizzesTable)
    .where(
      and(
        eq(quizzesTable.publicId, params.data.publicId),
        eq(quizzesTable.status, "published"),
      ),
    )
    .limit(1);
  if (!quiz || quiz.visibility === "private") {
    res.status(404).json({ error: "Quiz not found." });
    return;
  }
  participantKeyFor(req, res, quiz.id);
  await db
    .update(quizzesTable)
    .set({ views: sql`${quizzesTable.views} + 1` })
    .where(eq(quizzesTable.id, quiz.id));
  res.json(publicQuizData(quiz));
});

router.post(
  "/public/quizzes/:publicId/attempts",
  submissionLimiter,
  async (req, res): Promise<void> => {
    const params = SubmitQuizAttemptParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = SubmitQuizAttemptBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const participantName = parsed.data.nickname.trim();
    if (!participantName) {
      res.status(400).json({ error: "Enter your name so it can appear next to your score." });
      return;
    }
    const [quiz] = await db
      .select()
      .from(quizzesTable)
      .where(
        and(
          eq(quizzesTable.publicId, params.data.publicId),
          eq(quizzesTable.status, "published"),
        ),
      )
      .limit(1);
    if (!quiz || quiz.visibility === "private") {
      res.status(404).json({ error: "Quiz not found." });
      return;
    }
    const participantToken = participantKeyFor(req, res, quiz.id);
    if (!quiz.allowRetake) {
      const [existingAttempt] = await db
        .select({ id: quizAttemptsTable.id })
        .from(quizAttemptsTable)
        .where(
          and(
            eq(quizAttemptsTable.quizId, quiz.id),
            eq(quizAttemptsTable.participantToken, participantToken),
          ),
        )
        .limit(1);
      if (existingAttempt) {
        res.status(409).json({ error: "You have already answered this quiz." });
        return;
      }
    }
    const { answers } = parsed.data;
    const questionMap = new Map(quiz.questions.map((question) => [question.id, question]));
    if (
      answers.length !== quiz.questions.length ||
      new Set(answers.map((answer) => answer.questionId)).size !== answers.length
    ) {
      res.status(400).json({ error: "Answer every question before submitting." });
      return;
    }
    const validAnswers: SubmittedAnswer[] = [];
    for (const answer of answers) {
      const question = questionMap.get(answer.questionId);
      if (!question) {
        res.status(400).json({ error: "One or more answers do not match this quiz." });
        return;
      }
      if (answer.shortAnswer && answer.shortAnswer.length > 500) {
        res.status(400).json({ error: "A written answer is too long." });
        return;
      }
      const selected = answer.selectedOptionIds;
      if (new Set(selected).size !== selected.length) {
        res.status(400).json({ error: "An answer contains duplicate options." });
        return;
      }
      if (
        selected.some(
          (optionId) => !question.options.some((option) => option.id === optionId),
        )
      ) {
        res.status(400).json({ error: "An answer option does not belong to this quiz." });
        return;
      }
      if (
        question.type !== "short-answer" &&
        (selected.length === 0 ||
          (question.type !== "multiple-choice" && selected.length > 1))
      ) {
        res.status(400).json({ error: "Choose a valid answer for every question." });
        return;
      }
      if (
        question.type === "short-answer" &&
        !answer.shortAnswer?.trim() &&
        selected.length === 0
      ) {
        res.status(400).json({ error: "Answer every question before submitting." });
        return;
      }
      validAnswers.push({
        questionId: question.id,
        selectedOptionIds: selected,
        ...(answer.shortAnswer ? { shortAnswer: answer.shortAnswer.trim() } : {}),
      });
    }

    let correctCount = 0;
    let scoredCount = 0;
    let earnedPoints = 0;
    let totalPoints = 0;
    for (const question of quiz.questions) {
      const answer = validAnswers.find((item) => item.questionId === question.id);
      if (!answer) continue;
      const marked = question.options.filter((option) => option.isCorrect);
      const hasPoints = question.options.some(
        (option) => typeof option.scoreValue === "number",
      );
      if (marked.length > 0) {
        const expected = new Set(marked.map((option) => option.id));
        const selected = new Set(answer.selectedOptionIds);
        scoredCount += 1;
        totalPoints += 1;
        if (
          expected.size === selected.size &&
          [...expected].every((optionId) => selected.has(optionId))
        ) {
          correctCount += 1;
          earnedPoints += 1;
        }
      } else if (hasPoints) {
        const maxPoints = Math.max(
          0,
          ...question.options.map((option) => option.scoreValue ?? 0),
        );
        if (maxPoints > 0) {
          scoredCount += 1;
          totalPoints += maxPoints;
          const selectedPoints = answer.selectedOptionIds.reduce(
            (sum, optionId) =>
              sum +
              (question.options.find((option) => option.id === optionId)
                ?.scoreValue ?? 0),
            0,
          );
          earnedPoints += selectedPoints;
          if (selectedPoints >= maxPoints) correctCount += 1;
        }
      }
    }
    const scorePercent =
      totalPoints > 0
        ? Number(Math.min(100, (earnedPoints / totalPoints) * 100).toFixed(1))
        : null;
    const [attempt] = await db
      .insert(quizAttemptsTable)
      .values({
        quizId: quiz.id,
        participantNickname: participantName,
        participantToken,
        answers: validAnswers,
        scorePercent,
        correctCount,
        scoredCount,
      })
      .returning({ id: quizAttemptsTable.id });
    const resultVisible = quiz.resultVisibility;
    res.status(201).json(
      SubmitQuizAttemptResponse.parse({
        id: attempt.id,
        scorePercent: resultVisible ? scorePercent : null,
        correctCount: resultVisible ? correctCount : 0,
        scoredCount: resultVisible ? scoredCount : 0,
        resultVisible,
        message: resultVisible && scorePercent !== null
          ? `You got ${correctCount} of ${scoredCount} scored answers right.`
          : "Thanks for sharing your answers!",
      }),
    );
  },
);

export default router;
