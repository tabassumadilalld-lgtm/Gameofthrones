import { useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useClerk, useAuth, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  useCreateQuiz, useDeleteQuiz, useExportQuizResponses, useExploreQuizzes,
  useGetCurrentUser, useGetDashboard, useGetPublicQuiz, useGetQuiz,
  useGetQuizAnalytics, useListMyQuizzes, useListTemplates, useSubmitQuizAttempt,
  useUpdateQuiz, getGetCurrentUserQueryKey, getGetDashboardQueryKey,
  getListMyQuizzesQueryKey, getGetQuizQueryKey, getGetQuizAnalyticsQueryKey,
  getExportQuizResponsesQueryKey, getExploreQuizzesQueryKey,
  getListTemplatesQueryKey, getGetPublicQuizQueryKey,
} from '@workspace/api-client-react';
import type { AttemptInput, AttemptResult, PublicQuiz, Quiz, QuizInput, QuizQuestion, QuizTemplate } from '@workspace/api-client-react';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, BarChart3, Check, CheckCircle2,
  CircleHelp, Copy, Download, Eye,
  Heart, Link2, LoaderCircle, LockKeyhole, Menu, Plus, Search, Settings2,
  Sparkles, Trash2, Users, X,
} from 'lucide-react';
import { Link, Redirect, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1 } } });
let nextPublishedQuizId: number | null = null;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const stripBase = (path: string) => basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Try the selection-based fallback below for browsers that deny clipboard access.
  }
  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('Clipboard access is unavailable.');
}

const appearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#cb3e8b', colorForeground: '#3d2938', colorMutedForeground: '#887381',
    colorDanger: '#c64555', colorBackground: '#fffafd', colorInput: '#fffafd',
    colorInputForeground: '#3d2938', colorNeutral: '#eadbe4', fontFamily: "'DM Sans', sans-serif", borderRadius: '0.9rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-white rounded-3xl w-[440px] max-w-full overflow-hidden shadow-xl shadow-pink-100/60',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#402b3b] font-semibold', headerSubtitle: 'text-[#806d7a]',
    socialButtonsBlockButtonText: 'text-[#402b3b]', formFieldLabel: 'text-[#54404f]',
    footerActionLink: 'text-[#bd3980] font-semibold', footerActionText: 'text-[#806d7a]',
    dividerText: 'text-[#806d7a]', identityPreviewEditButton: 'text-[#bd3980]',
    formFieldSuccessText: 'text-[#497e64]', alertText: 'text-[#7f3045]',
    logoBox: 'mb-4', logoImage: 'rounded-xl', socialButtonsBlockButton: 'border-[#eadbe4] bg-white',
    formButtonPrimary: 'bg-[#c83e88] hover:bg-[#af3178] text-white',
    formFieldInput: 'border-[#eadbe4] bg-[#fffafd] text-[#402b3b]',
    footerAction: 'border-0', dividerLine: 'bg-[#eadbe4]', alert: 'bg-[#fff3f4]',
    otpCodeFieldInput: 'border-[#eadbe4]', formFieldRow: 'gap-2', main: 'gap-4',
  },
};

const wordmark = (small = false) => (
  <span className={`brand-mark ${small ? 'brand-mark-small' : ''}`} aria-label="LOVELOCK">
    <span className="brand-heart"><Heart size={small ? 15 : 17} strokeWidth={2.5} /></span>loveLock
  </span>
);

function Button({ children, className = '', variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'soft' | 'plain' | 'outline' }) {
  return <button className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}

function LogoLink({ dark = false }: { dark?: boolean }) {
  return <Link href="/" className={`logo-link ${dark ? 'logo-dark' : ''}`} data-testid="link-home">{wordmark()}</Link>;
}

function LoadingState({ label = 'Gathering your answers…' }: { label?: string }) {
  return <div className="loading-state" role="status"><span className="loading-pip" /><span>{label}</span></div>;
}

function ErrorState({ retry, label = 'We couldn’t load this just now.' }: { retry?: () => void; label?: string }) {
  return <div className="state-card state-error"><div className="state-icon"><CircleHelp size={21} /></div><strong>{label}</strong><p>Your answers are safe. Give it another try.</p>{retry && <Button variant="outline" onClick={retry}>Try again</Button>}</div>;
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <div className="state-card"><div className="empty-orbit"><Heart size={23} /></div><strong>{title}</strong><p>{body}</p>{action}</div>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener((event: { user?: { id?: string } | null }) => {
    const { user } = event;
    const currentId = user?.id ?? null;
    if (previous.current !== undefined && previous.current !== currentId) client.clear();
    previous.current = currentId;
  }), [addListener, client]);
  return null;
}

function HomePage() {
  const { isSignedIn } = useAuth();
  if (isSignedIn) return <Redirect to="/dashboard" />;
  return <Landing />;
}

function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  return <main className="landing">
    <header className="landing-nav page-width">
      <LogoLink />
      <nav className={`landing-links ${menuOpen ? 'nav-open' : ''}`} aria-label="Main navigation">
        <Link href="/explore" onClick={() => setMenuOpen(false)}>Explore quizzes</Link>
        <Link href="/templates" onClick={() => setMenuOpen(false)}>Templates</Link>
        <Link href="/sign-in" className="nav-sign-in" onClick={() => setMenuOpen(false)}>Sign in</Link>
        <Link href="/sign-up" className="button button-primary nav-cta" onClick={() => setMenuOpen(false)}>Make a quiz <ArrowRight size={16} /></Link>
      </nav>
      <button className="mobile-menu" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)} data-testid="button-menu">
        {menuOpen ? <X size={21} /> : <Menu size={21} />}
      </button>
    </header>
    <section className="hero page-width">
      <div className="hero-copy reveal-in">
        <div className="eyebrow"><span className="eyebrow-dot" /> A little closer, one question at a time</div>
        <h1>Every answer<br />tells <em>a story.</em></h1>
        <p className="hero-intro">How well do your people really know you? Make a quiz about the little things, send your link, and see what they say.</p>
        <div className="hero-actions">
          <Link href="/sign-up" className="button button-primary button-large">Make your first quiz <ArrowRight size={17} /></Link>
          <Link href="/explore" className="text-link">Take a quiz <ArrowUpRight size={16} /></Link>
        </div>
        <div className="hero-social-proof"><div className="avatar-stack"><span>J</span><span>M</span><span>A</span><span>+</span></div><span>Made for the people who know you best</span></div>
      </div>
      <div className="hero-art" aria-label="A sample quiz card with answers from friends">
        <div className="art-halo" />
        <div className="art-spark art-spark-one">✳</div><div className="art-spark art-spark-two">✳</div>
        <div className="quiz-preview-card">
          <div className="preview-topline"><span>THE PEOPLE'S EDITION</span><span className="preview-lock"><LockKeyhole size={12} /> just for you</span></div>
          <div className="preview-title">How well do<br />you know <i>me?</i></div>
          <div className="preview-rule" />
          <div className="preview-question">My ideal Sunday looks like…</div>
          <div className="preview-answer"><span className="answer-avatar avatar-lilac">J</span><span><b>Jules</b><small>Slow morning, faster coffee.</small></span><CheckCircle2 size={17} /></div>
          <div className="preview-answer"><span className="answer-avatar avatar-peach">M</span><span><b>Mina</b><small>You, a book, and zero plans.</small></span><CheckCircle2 size={17} /></div>
        <div className="preview-bottom"><span><span className="tiny-heart">♥</span> Answers from your people</span><ArrowRight size={15} /></div>
        </div>
        <div className="floating-note note-top"><span className="note-dot" /> A fresh answer is in</div>
        <div className="floating-note note-bottom"><Heart size={15} fill="currentColor" /> the fun kind of honest</div>
      </div>
    </section>
    <div className="marquee-band"><div className="marquee-inner"><span>the things only your friends know</span><i>✳</i><span>the things only your friends know</span><i>✳</i><span>the things only your friends know</span><i>✳</i></div></div>
    <section className="how-section page-width">
      <div className="section-kicker">A tiny ritual for your group chat</div>
      <div className="how-heading"><h2>Make it about <em>you.</em></h2><p>No right answers. No big production.<br />Just the good stuff.</p></div>
      <div className="story-steps">
        <article className="story-step"><span className="step-number">01</span><div className="step-icon icon-pink"><Sparkles size={22} /></div><h3>Ask your kind of questions</h3><p>Dream dinners, oddly specific habits, the song you always skip. Make a quiz that sounds like you.</p><div className="step-decoration">your world, your rules</div></article>
        <article className="story-step step-offset"><span className="step-number">02</span><div className="step-icon icon-violet"><Link2 size={22} /></div><h3>Send one little link</h3><p>Drop it in the chat, send it to your sister, or let the internet have a go. Your call, always.</p><div className="step-decoration">no download needed</div></article>
        <article className="story-step"><span className="step-number">03</span><div className="step-icon icon-peach"><Heart size={22} /></div><h3>Find out who gets you</h3><p>See real answers roll in. The surprisingly accurate ones. The lovingly chaotic ones. All of them.</p><div className="step-decoration">little stories, shared</div></article>
      </div>
    </section>
    <section className="quote-section">
      <div className="quote-inner page-width">
        <div className="quote-seal"><Heart size={20} fill="currentColor" /></div>
        <p>The answer that explains everything: “You’d survive a zombie apocalypse because you hoard snacks.”</p>
        <span>A LITTLE PREVIEW OF THE GOOD STUFF</span>
      </div>
    </section>
    <section className="closing-section page-width">
      <div className="closing-ornament"><span /><Heart fill="currentColor" size={19} /><span /></div>
      <div className="section-kicker">Your people are waiting</div>
      <h2>Let them tell<br />you <em>something.</em></h2>
      <Link href="/sign-up" className="button button-primary button-large">Start with a question <ArrowRight size={17} /></Link>
      <span className="closing-caption">Free to make. Better with your people.</span>
    </section>
    <footer className="landing-footer page-width"><LogoLink /><span>Made for knowing each other a little more.</span><div><Link href="/explore">Explore</Link><Link href="/templates">Templates</Link><Link href="/sign-in">Sign in</Link></div></footer>
  </main>;
}

function AppHeader() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const initials = user?.firstName?.[0] || user?.primaryEmailAddress?.emailAddress?.[0] || 'L';
  return <header className="app-header">
    <LogoLink />
    <nav className="app-nav" aria-label="Workspace navigation">
      <Link href="/dashboard" className="app-nav-link">My quizzes</Link><Link href="/templates" className="app-nav-link">Templates</Link><Link href="/explore" className="app-nav-link">Explore</Link>
    </nav>
    <div className="header-user">
      <Link href="/quizzes/new" className="button button-primary header-create"><Plus size={16} /> New quiz</Link>
      <button className="user-avatar" aria-label="Open account menu" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="button-account-menu">{initials.toUpperCase()}</button>
      {open && <div className="account-menu"><div className="account-identity">{user?.fullName || user?.primaryEmailAddress?.emailAddress}</div><Link href="/settings" onClick={() => setOpen(false)}><Settings2 size={15} /> Settings</Link><button onClick={() => signOut({ redirectUrl: basePath || '/' })}>Sign out</button></div>}
    </div>
  </header>;
}

function AppFrame({ children }: { children: React.ReactNode }) {
  return <div className="app-frame"><AppHeader /><nav className="mobile-app-nav" aria-label="Workspace navigation"><Link href="/dashboard"><Heart size={17} /><span>Quizzes</span></Link><Link href="/templates"><Sparkles size={17} /><span>Templates</span></Link><Link href="/explore"><Search size={17} /><span>Explore</span></Link></nav><main className="app-main">{children}</main><footer className="app-footer"><span>{wordmark(true)}</span><span>Every answer tells a story.</span><Link href="/settings">Account settings</Link></footer></div>;
}

function PrivateGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const currentUser = useGetCurrentUser({ query: { enabled: isLoaded && !!isSignedIn, queryKey: getGetCurrentUserQueryKey() } });
  if (!isLoaded) return <LoadingState label="Opening your space…" />;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  if (currentUser.isLoading) return <LoadingState label="Getting your space ready…" />;
  if (currentUser.isError) return <ErrorState label="We couldn’t open your account." retry={() => currentUser.refetch()} />;
  return <>{children}</>;
}

function DashboardPage() {
  const dashboard = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey() } });
  const quizzes = useListMyQuizzes({ query: { queryKey: getListMyQuizzesQueryKey() } });
  const data = dashboard.data;
  return <AppFrame>
    <div className="welcome-row"><div><div className="section-kicker">Your little corner of the internet</div><h1 className="page-title">The answers are <em>in.</em></h1><p className="page-subtitle">A snapshot of the stories your people have shared.</p></div><Link href="/quizzes/new" className="button button-primary"><Plus size={17} /> Create a quiz</Link></div>
    {(dashboard.isLoading || quizzes.isLoading) ? <div className="dashboard-skeleton"><div /><div /><div /></div> : (dashboard.isError || quizzes.isError) ? <ErrorState retry={() => { dashboard.refetch(); quizzes.refetch(); }} /> : <>
      <section className="metric-strip" aria-label="Quiz summary">
        <Metric label="Quizzes made" value={data?.totalQuizzes ?? 0} icon={<Sparkles size={19} />} />
        <Metric label="Answers shared" value={data?.completedResponses ?? 0} icon={<Heart size={19} />} />
        <Metric label="Quiz visits" value={data?.totalAttempts ?? 0} icon={<Users size={19} />} />
        <Metric label="Average score" value={data?.averageScore == null ? '—' : `${data.averageScore}%`} icon={<BarChart3 size={19} />} />
      </section>
      <div className="section-row"><div><div className="section-kicker">Back to your stories</div><h2 className="section-title">Your quizzes</h2></div><Link href="/templates" className="text-link">Browse templates <ArrowRight size={15} /></Link></div>
      {!quizzes.data?.length ? <EmptyState title="Your first quiz starts here" body="Pick a template or dream up a question that only your friends can answer." action={<Link href="/templates" className="button button-primary">Find a starting point <ArrowRight size={16} /></Link>} /> :
        <div className="quiz-list">{quizzes.data.map((quiz) => <QuizRow key={quiz.id} quiz={quiz} />)}</div>}
    </>}
  </AppFrame>;
}

function Metric({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return <div className="metric-card"><div className="metric-icon">{icon}</div><span className="metric-value" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}>{value}</span><span className="metric-label">{label}</span></div>;
}

function QuizRow({ quiz }: { quiz: Quiz }) {
  const client = useQueryClient();
  const remove = useDeleteQuiz();
  const [shareFeedback, setShareFeedback] = useState('');
  const copyLink = async () => {
    if (quiz.status !== 'published') return;
    try {
      await copyText(`${window.location.origin}${basePath}/q/${quiz.publicId}`);
      setShareFeedback('Quiz link copied — send it to your people.');
    } catch {
      setShareFeedback('Couldn’t copy the link. Open the quiz and copy it there.');
    }
  };
  return <article className="quiz-row">
    <div className="quiz-monogram"><Heart size={19} /></div><div className="quiz-row-main"><Link href={`/quizzes/${quiz.id}`} className="quiz-row-title">{quiz.title || 'Untitled quiz'}</Link><div className="quiz-row-meta"><span>{quiz.category || 'Uncategorized'}</span><span className="meta-dot" />{quiz.questions.length} questions<span className="meta-dot" /><span className={`status-tag ${quiz.status}`}>{quiz.status}</span>{remove.isError && <span className="delete-error" role="alert">Couldn’t delete — try again</span>}</div></div>
    <div className="quiz-row-stats"><strong>{quiz.attempts}</strong><span>answers</span></div>
    <div className="quiz-row-actions">{quiz.status === 'published' ? <button className="quiz-share-button" aria-label="Copy participant quiz link" onClick={copyLink} data-testid={`button-copy-quiz-${quiz.id}`}><Link2 size={15} /><span>Share</span></button> : <span className="share-placeholder" title="Publish this quiz before sharing">Publish to share</span>}<Link className="icon-button" href={`/quizzes/${quiz.id}/analytics`} aria-label="Open analytics"><BarChart3 size={17} /></Link><button className="icon-button danger-icon" aria-label={`Delete ${quiz.title}`} onClick={() => { if (window.confirm(`Delete “${quiz.title || 'Untitled quiz'}” and its answers?`)) remove.mutate({ quizId: quiz.id }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListMyQuizzesQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); } }); }} disabled={remove.isPending} data-testid={`button-delete-quiz-${quiz.id}`}><Trash2 size={17} /></button><Link className="icon-button row-go" href={`/quizzes/${quiz.id}`} aria-label={`Edit ${quiz.title}`}><ArrowRight size={18} /></Link></div>
    {shareFeedback && <span className="share-feedback" role="status" data-testid={`status-share-quiz-${quiz.id}`}>{shareFeedback}</span>}
  </article>;
}

const blankQuestion = (position: number): QuizQuestion => ({ id: crypto.randomUUID(), text: '', type: 'single-choice', position, noButtonMode: 'normal', options: [{ id: crypto.randomUUID(), text: '' }, { id: crypto.randomUUID(), text: '' }] });
const initialQuiz = (): QuizInput => ({ title: '', description: '', category: 'Just for fun', visibility: 'unlisted', status: 'draft', resultVisibility: true, allowRetake: true, questions: [blankQuestion(0)] });

function QuizEditorPage({ editing }: { editing: boolean }) {
  const params = useParams<{ quizId: string }>();
  const quizId = Number(params.quizId);
  const [, setLocation] = useLocation();
  const existing = useGetQuiz(quizId, { query: { enabled: editing && Number.isFinite(quizId), queryKey: getGetQuizQueryKey(quizId) } });
  const create = useCreateQuiz();
  const update = useUpdateQuiz();
  const client = useQueryClient();
  const [form, setForm] = useState<QuizInput>(initialQuiz);
  const [initialized, setInitialized] = useState(false);
  const [notice, setNotice] = useState('');
  const [shareFeedback, setShareFeedback] = useState('');
  const [publishSuccess, setPublishSuccess] = useState(false);
  useEffect(() => {
    if (editing && existing.data && !initialized) {
      const { title, description, category, visibility, status, resultVisibility, allowRetake, questions } = existing.data;
      setForm({ title, description, category, visibility, status, resultVisibility, allowRetake, questions: questions.map((q) => ({ ...q, options: q.options.map((o) => ({ ...o })) })) });
      setInitialized(true);
    }
  }, [editing, existing.data, initialized]);
  useEffect(() => {
    if (editing && existing.data && nextPublishedQuizId === existing.data.id) {
      setPublishSuccess(true);
      nextPublishedQuizId = null;
    }
  }, [editing, existing.data]);

  const updateField = <K extends keyof QuizInput>(key: K, value: QuizInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const updateQuestion = (index: number, patch: Partial<QuizQuestion>) => setForm((f) => ({ ...f, questions: f.questions.map((q, i) => i === index ? { ...q, ...patch } : q) }));
  const save = (publish: boolean) => {
    const prepared: QuizInput = { ...form, title: form.title.trim(), description: form.description.trim(), status: publish ? 'published' : 'draft', questions: form.questions.map((q, i) => ({ ...q, position: i, text: q.text.trim(), options: q.options.map((o) => ({ ...o, text: o.text.trim() })) })) };
    if (!prepared.title) { setNotice('Give your quiz a title before saving.'); return; }
    if (prepared.questions.some((q) => !q.text || (q.type !== 'short-answer' && q.options.some((o) => !o.text)))) { setNotice('Finish each question and its answers before saving.'); return; }
    const done = (quiz: Quiz) => { if (prepared.status === 'published') { if (editing) setPublishSuccess(true); else nextPublishedQuizId = quiz.id; } client.invalidateQueries({ queryKey: getListMyQuizzesQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); if (editing) { client.invalidateQueries({ queryKey: getGetQuizQueryKey(quiz.id) }); client.invalidateQueries({ queryKey: getGetQuizAnalyticsQueryKey(quiz.id) }); } setLocation(`/quizzes/${quiz.id}`); };
    if (editing) update.mutate({ quizId, data: prepared }, { onSuccess: done, onError: () => setNotice('That change didn’t save. Please try again.') });
    else create.mutate({ data: prepared }, { onSuccess: done, onError: () => setNotice('That quiz didn’t save. Please try again.') });
  };
  const pending = create.isPending || update.isPending;
  const publishedQuiz = editing && existing.data?.status === 'published' ? existing.data : null;
  const shareUrl = publishedQuiz ? `${window.location.origin}${basePath}/q/${publishedQuiz.publicId}` : '';
  const hasScoredQuestions = form.questions.some((question) => question.options.some((option) => option.isCorrect || (typeof option.scoreValue === 'number' && option.scoreValue > 0)));
  const copyPublishedLink = async () => {
    if (!shareUrl) return;
    try {
      await copyText(shareUrl);
      setShareFeedback('Link copied — people can take the quiz and see their own result after submitting.');
    } catch {
      setShareFeedback('Couldn’t copy automatically. Select the link and copy it manually.');
    }
  };
  if (editing && existing.isLoading) return <AppFrame><LoadingState label="Finding your quiz…" /></AppFrame>;
  if (editing && existing.isError) return <AppFrame><ErrorState label="We couldn’t open this quiz." retry={() => existing.refetch()} /></AppFrame>;
  return <AppFrame><div className="editor-wrap">
    <Link href={editing ? '/dashboard' : '/templates'} className="back-link"><ArrowLeft size={15} /> {editing ? 'All quizzes' : 'Browse templates'}</Link>
    <div className="editor-heading"><div><div className="section-kicker">{editing ? 'Make it yours' : 'A story in the making'}</div><h1 className="page-title">{editing ? 'Edit your quiz' : 'Start with a question.'}</h1><p className="page-subtitle">The best ones sound like you. The rest can come later.</p></div><span className="draft-pill"><span /> {form.status}</span></div>
    {editing && (publishedQuiz ? <section className="share-panel" aria-labelledby="share-panel-title">
      {publishSuccess && <div className="publish-success" role="status" data-testid={`status-publish-success-${publishedQuiz.id}`}><CheckCircle2 size={20} /><strong>Your quiz has been published! Let’s see what scores your friends get.</strong><span>Share the link below.</span></div>}
      <div className="share-panel-copy"><span className="section-kicker">Ready for your people</span><h2 id="share-panel-title">Share your quiz link</h2><p>Send this link to friends. They answer here and see their own score after they submit.</p></div>
      <div className="share-link-row"><input aria-label="Participant quiz link" data-testid={`input-share-url-${publishedQuiz.id}`} value={shareUrl} readOnly onFocus={(event) => event.currentTarget.select()} /><Button variant="outline" onClick={copyPublishedLink} data-testid={`button-share-quiz-${publishedQuiz.id}`}><Copy size={15} /> Copy link</Button><a className="button button-primary share-open-button" href={`${basePath}/q/${publishedQuiz.publicId}`} target="_blank" rel="noreferrer" data-testid={`link-preview-quiz-${publishedQuiz.id}`}>Open link <ArrowUpRight size={15} /></a></div>
      <p className={`share-score-note ${!form.resultVisibility || !hasScoredQuestions ? 'share-score-warning' : ''}`} role="status" data-testid={`status-score-sharing-${publishedQuiz.id}`}>{!form.resultVisibility ? 'Scores are hidden right now. Turn on “Show results after answering” below to let people see their score.' : !hasScoredQuestions ? 'A numeric score is not set up yet. Mark a correct answer or add positive point values in your questions.' : 'Scores are enabled. Each person sees their own score immediately after submitting.'}</p>
      {shareFeedback && <p className="share-feedback-inline" role="status" data-testid={`status-share-link-${publishedQuiz.id}`}>{shareFeedback}</p>}
    </section> : <section className="share-panel share-panel-draft" aria-labelledby="share-panel-title"><div className="share-panel-copy"><span className="section-kicker">One more step</span><h2 id="share-panel-title">Publish to get a share link</h2><p>Once this quiz is published, you can copy a participant link here. People use it to answer the quiz and see their own score.</p></div></section>)}
    <div className="editor-layout"><section className="editor-main">
      <div className="form-panel"><div className="panel-heading"><span className="panel-index">01</span><div><h2>The introduction</h2><p>Give your quiz a name your people will remember.</p></div></div>
        <label className="field-label">Quiz title<input value={form.title} maxLength={120} placeholder="How well do you know me?" onChange={(e) => updateField('title', e.target.value)} data-testid="input-quiz-title" /></label>
        <label className="field-label">A little context <span className="optional-label">optional</span><textarea value={form.description} maxLength={1000} placeholder="A few questions about the things that make me, me." onChange={(e) => updateField('description', e.target.value)} rows={3} data-testid="input-quiz-description" /></label>
        <label className="field-label">Category<select value={form.category} onChange={(e) => updateField('category', e.target.value)} data-testid="select-quiz-category">{['Just for fun','Friendship','Family','Dating','Pop culture','Getting to know me','Other'].map((x) => <option key={x}>{x}</option>)}</select></label>
      </div>
      <div className="question-builder"><div className="panel-heading"><span className="panel-index">02</span><div><h2>The questions</h2><p>Think specific, wonderfully you. Keep scoring private.</p></div></div>
        {form.questions.map((q, i) => <QuestionEditor key={q.id} question={q} index={i} onChange={(patch) => updateQuestion(i, patch)} onRemove={() => updateField('questions', form.questions.filter((_, j) => j !== i).map((item, j) => ({ ...item, position: j })))} canRemove={form.questions.length > 1} />)}
        <button className="add-question" onClick={() => updateField('questions', [...form.questions, blankQuestion(form.questions.length)])}><Plus size={17} /> Add another question <span>{form.questions.length} so far</span></button>
      </div>
      <div className="form-panel settings-panel"><div className="panel-heading"><span className="panel-index">03</span><div><h2>Your boundaries</h2><p>Choose what feels right for this one.</p></div></div>
        <label className="field-label">Who can find it?<select value={form.visibility} onChange={(e) => updateField('visibility', e.target.value as QuizInput['visibility'])}><option value="public">Public — show in Explore</option><option value="unlisted">Unlisted — link only</option><option value="private">Private — only me</option></select></label>
        <ToggleRow title="Show results after answering" description="Let people see their own result when they finish." checked={form.resultVisibility} onChange={(v) => updateField('resultVisibility', v)} />
        <ToggleRow title="Allow another go" description="People can retake your quiz with a fresh answer set." checked={form.allowRetake} onChange={(v) => updateField('allowRetake', v)} />
      </div>
      {notice && <div className="inline-notice" role="alert">{notice}</div>}
      <div className="editor-actions"><Button variant="outline" onClick={() => save(false)} disabled={pending}>{pending ? 'Saving…' : 'Save as draft'}</Button><Button onClick={() => save(true)} disabled={pending}>{pending ? 'Saving…' : 'Publish quiz'} <ArrowRight size={16} /></Button></div>
    </section><aside className="editor-aside"><div className="aside-card"><div className="aside-bloom"><Heart size={19} /></div><span className="section-kicker">A good question</span><p>“What’s my comfort rewatch when everything feels a bit much?”</p><small>Specific questions make the best stories.</small></div><div className="aside-note"><LockKeyhole size={16} /><span>Answer keys stay private. Friends only see their own results.</span></div></aside></div>
  </div></AppFrame>;
}

function QuestionEditor({ question, index, onChange, onRemove, canRemove }: { question: QuizQuestion; index: number; onChange: (patch: Partial<QuizQuestion>) => void; onRemove: () => void; canRemove: boolean }) {
  const replaceOption = (optionIndex: number, patch: Partial<QuizQuestion['options'][number]>) => onChange({ options: question.options.map((o, i) => i === optionIndex ? { ...o, ...patch } : o) });
  return <article className="question-card"><div className="question-card-head"><span className="question-count">Q{String(index + 1).padStart(2, '0')}</span><select aria-label={`Question ${index + 1} type`} value={question.type} onChange={(e) => { const type = e.target.value as QuizQuestion['type']; onChange({ type, options: type === 'short-answer' ? [] : question.options.length ? question.options : [{ id: crypto.randomUUID(), text: '' }, { id: crypto.randomUUID(), text: '' }] }); }}>{['single-choice','multiple-choice','yes-no','short-answer','personality','score-based'].map((t) => <option key={t} value={t}>{t.replaceAll('-', ' ')}</option>)}</select>{canRemove && <button className="icon-button danger-icon" aria-label={`Remove question ${index + 1}`} onClick={onRemove}><Trash2 size={16} /></button>}</div>
    <label className="field-label">Question<input value={question.text} placeholder="What’s my ideal way to spend a day off?" onChange={(e) => onChange({ text: e.target.value })} data-testid={`input-question-${index}`} /></label>
    {question.type !== 'short-answer' && <div className="option-list"><span className="option-label">ANSWER OPTIONS</span>{question.options.map((option, oi) => <div className="option-input-row" key={option.id}><span className="option-marker">{String.fromCharCode(65 + oi)}</span><input aria-label={`Question ${index + 1}, answer ${oi + 1}`} value={option.text} placeholder={oi === 0 ? 'Coffee and a long walk' : 'A quiet day at home'} onChange={(e) => replaceOption(oi, { text: e.target.value })} /><label className="correct-option" title="Mark as a correct answer"><input type="checkbox" checked={!!option.isCorrect} onChange={(e) => replaceOption(oi, { isCorrect: e.target.checked })} aria-label={`Mark answer ${oi + 1} correct`} /><span>Key</span></label><input className="score-input" type="number" aria-label={`Score value for answer ${oi + 1}`} value={option.scoreValue ?? ''} placeholder="Score" onChange={(e) => replaceOption(oi, { scoreValue: e.target.value === '' ? undefined : Number(e.target.value) })} />{question.options.length > 2 && <button className="remove-option" aria-label="Remove answer option" onClick={() => onChange({ options: question.options.filter((_, j) => j !== oi) })}><X size={14} /></button>}</div>)}<button className="add-option" onClick={() => onChange({ options: [...question.options, { id: crypto.randomUUID(), text: '' }] })}><Plus size={14} /> Add an option</button></div>}
    {(question.type === 'yes-no') && <label className="tiny-select">No button style<select value={question.noButtonMode || 'normal'} onChange={(e) => onChange({ noButtonMode: e.target.value as QuizQuestion['noButtonMode'] })}><option value="normal">Normal</option><option value="playful">Playful</option><option value="escape">A little slippery</option><option value="disabled">Disabled</option></select></label>}
  </article>;
}

function ToggleRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle-row"><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /></label>;
}

function AnalyticsPage() {
  const params = useParams<{ quizId: string }>();
  const quizId = Number(params.quizId);
  const analytics = useGetQuizAnalytics(quizId, { query: { enabled: Number.isFinite(quizId), queryKey: getGetQuizAnalyticsQueryKey(quizId) } });
  const exportResponses = useExportQuizResponses(quizId, { query: { enabled: false, queryKey: getExportQuizResponsesQueryKey(quizId) } });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const download = async () => {
    setExporting(true);
    setExportError('');
    try {
      const response = await exportResponses.refetch();
      if (response.isError || !response.data) throw new Error('Export unavailable');
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `lovelock-quiz-${quizId}-responses.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setExportError('We couldn’t export those answers. Please try again.'); }
    finally { setExporting(false); }
  };
  return <AppFrame><div className="analytics-wrap"><Link href={`/quizzes/${quizId}`} className="back-link"><ArrowLeft size={15} /> Back to quiz</Link><div className="welcome-row"><div><div className="section-kicker">A closer look</div><h1 className="page-title">Your quiz, <em>in stories.</em></h1><p className="page-subtitle">Real responses, just as they came in.</p></div><Button variant="outline" onClick={download} disabled={exporting || analytics.isLoading}>{exporting ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />} Export answers</Button></div>
    {exportError && <div className="inline-notice" role="alert">{exportError}</div>}
    {analytics.isLoading ? <LoadingState label="Gathering the answers…" /> : analytics.isError ? <ErrorState label="We couldn’t load your analytics." retry={() => analytics.refetch()} /> : analytics.data && <>
      <section className="analytics-summary"><Metric label="Quiz views" value={analytics.data.views} icon={<Eye size={19} />} /><Metric label="Answers shared" value={analytics.data.attempts} icon={<Users size={19} />} /><Metric label="Finished" value={analytics.data.completed} icon={<CheckCircle2 size={19} />} /><Metric label="Completion rate" value={`${analytics.data.completionRate}%`} icon={<BarChart3 size={19} />} /></section>
      <div className="analytics-score"><div><span className="section-kicker">The score, when there is one</span><p>{analytics.data.averageScore == null ? 'This quiz doesn’t have a scored average yet.' : <><strong>{analytics.data.averageScore}%</strong> average score</>}</p></div><div className="score-flower"><Heart size={20} fill="currentColor" /></div></div>
      <div className="section-row"><div><span className="section-kicker">What people picked</span><h2 className="section-title">Question by question</h2></div><span className="response-private"><LockKeyhole size={14} /> Owner view</span></div>
      {analytics.data.questions.length ? <div className="answer-breakdown">{analytics.data.questions.map((question, i) => {
        const total = question.answers.reduce((sum, item) => sum + item.count, 0);
        return <article className="breakdown-card" key={`${question.questionText}-${i}`}><div className="breakdown-question"><span>Q{String(i + 1).padStart(2,'0')}</span><h3>{question.questionText}</h3><b>{total} answers</b></div>{question.answers.map((answer, j) => <div className="answer-bar-row" key={`${answer.optionText}-${j}`}><span>{answer.optionText}</span><div className="answer-track"><i style={{ width: `${total ? (answer.count / total) * 100 : 0}%` }} /></div><strong>{answer.count}</strong></div>)}</article>;
      })}</div> : <EmptyState title="The first answer will show up here" body="Share your quiz link when you’re ready. Your question breakdown will grow with every response." />}
    </>}</div></AppFrame>;
}

function TemplatesPage() {
  const templates = useListTemplates({ query: { queryKey: getListTemplatesQueryKey() } });
  const create = useCreateQuiz();
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const { isLoaded, isSignedIn } = useAuth();
  const [useSlug, setUseSlug] = useState('');
  const [templateError, setTemplateError] = useState('');
  const useTemplate = (template: QuizTemplate) => {
    if (!isLoaded) return;
    if (!isSignedIn) { setLocation('/sign-up'); return; }
    setUseSlug(template.slug); setTemplateError('');
    const data: QuizInput = { title: template.title, description: template.description, category: template.category, visibility: 'unlisted', status: 'draft', resultVisibility: true, allowRetake: true, questions: template.questions.map((q, i) => ({ ...q, id: crypto.randomUUID(), position: i, options: q.options.map((o) => ({ ...o, id: crypto.randomUUID() })) })) };
    create.mutate({ data }, { onSuccess: (quiz) => { client.invalidateQueries({ queryKey: getListMyQuizzesQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); setLocation(`/quizzes/${quiz.id}`); }, onError: () => { setUseSlug(''); setTemplateError('That template didn’t open. Please try again.'); } });
  };
  return <AppFrame><div className="library-wrap"><div className="welcome-row"><div><div className="section-kicker">A few good places to begin</div><h1 className="page-title">Borrow a <em>question.</em></h1><p className="page-subtitle">A starting point, not a script. Make every template your own.</p></div><Link className="button button-outline" href="/quizzes/new">Start from scratch <Plus size={16} /></Link></div>
    {templates.isLoading ? <LoadingState label="Finding a little inspiration…" /> : templates.isError ? <ErrorState label="We couldn’t load the templates." retry={() => templates.refetch()} /> : !templates.data?.length ? <EmptyState title="No templates just yet" body="Start a quiz from scratch and make it feel like yours." action={<Link className="button button-primary" href="/quizzes/new">Create a quiz <ArrowRight size={16} /></Link>} /> : <>{templateError && <div className="inline-notice" role="alert">{templateError}</div>}<div className="template-grid">{templates.data.map((t, i) => <article className={`template-card template-tone-${i % 4}`} key={t.slug}><div className="template-swoosh"><span>{String(i + 1).padStart(2,'0')}</span><Sparkles size={20} /></div><div className="template-card-body"><span className="template-category">{t.category}</span><h2>{t.title}</h2><p>{t.description}</p><div className="template-meta"><span>{t.questions.length} questions</span><span><span className="meta-dot" /> Ready to personalize</span></div><Button variant="outline" className="template-use" onClick={() => useTemplate(t)} disabled={create.isPending}>{useSlug === t.slug && create.isPending ? 'Making it yours…' : 'Use this template'}<ArrowRight size={15} /></Button></div></article>)}</div></>}
  </div></AppFrame>;
}

function ExplorePage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<'newest' | 'popular'>('popular');
  const params = useMemo(() => ({ ...(search.trim() ? { search: search.trim() } : {}), ...(category ? { category } : {}), sort }), [search, category, sort]);
  const quizzes = useExploreQuizzes(params, { query: { queryKey: getExploreQuizzesQueryKey(params) } });
  const [copied, setCopied] = useState('');
  return <AppFrame><div className="explore-wrap"><div className="explore-head"><div><div className="section-kicker">Open invitations</div><h1 className="page-title">Meet a few <em>people.</em></h1><p className="page-subtitle">Public quizzes, made by actual humans. Take one and say hello.</p></div><div className="explore-doodle"><Heart size={25} /></div></div>
    <div className="discovery-tools"><label className="search-box"><Search size={18} /><input type="search" value={search} placeholder="Search quizzes or people…" onChange={(e) => setSearch(e.target.value)} aria-label="Search quizzes" data-testid="input-explore-search" />{search && <button aria-label="Clear search" onClick={() => setSearch('')}><X size={15} /></button>}</label><select className="filter-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category" data-testid="select-explore-category"><option value="">Every category</option>{['Just for fun','Friendship','Family','Dating','Pop culture','Getting to know me','Other'].map((x) => <option key={x}>{x}</option>)}</select><div className="sort-pills"><button onClick={() => setSort('popular')} className={sort === 'popular' ? 'active' : ''}>Most loved</button><button onClick={() => setSort('newest')} className={sort === 'newest' ? 'active' : ''}>Just made</button></div></div>
    {quizzes.isLoading ? <LoadingState label="Finding quizzes worth knowing…" /> : quizzes.isError ? <ErrorState label="Explore is taking a moment." retry={() => quizzes.refetch()} /> : !quizzes.data?.length ? <EmptyState title="No quizzes in this little corner" body="Try another search or category. Good stories have a way of finding their way here." /> : <div className="explore-grid">{quizzes.data.map((quiz, i) => <article className={`explore-card explore-card-${i % 4}`} key={quiz.publicId}><div className="explore-card-top"><span className="explore-card-num">NO. {String(i + 1).padStart(2,'0')}</span><button className="explore-share" aria-label="Copy share link" onClick={async () => { try { await navigator.clipboard.writeText(`${window.location.origin}${basePath}/q/${quiz.publicId}`); setCopied(quiz.publicId); setTimeout(() => setCopied(''), 1800); } catch { setCopied(''); } }}>{copied === quiz.publicId ? <Check size={15} /> : <Copy size={15} />}</button></div><span className="template-category">{quiz.category || 'Just for fun'}</span><h2>{quiz.title}</h2><p>{quiz.description || 'A little quiz to see who really knows.'}</p><div className="explore-card-foot"><span><Users size={14} /> {quiz.attempts} answered</span><Link href={`/q/${quiz.publicId}`} className="button button-primary">Take this quiz <ArrowRight size={15} /></Link></div></article>)}</div>}</div></AppFrame>;
}

function ParticipantPage() {
  const params = useParams<{ publicId: string }>();
  const quizQuery = useGetPublicQuiz(params.publicId || '', { query: { enabled: !!params.publicId, queryKey: getGetPublicQuizQueryKey(params.publicId || '') } });
  const submit = useSubmitQuizAttempt();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [shortAnswers, setShortAnswers] = useState<Record<string, string>>({});
  const [nickname, setNickname] = useState('');
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [error, setError] = useState('');
  if (quizQuery.isLoading) return <ParticipantShell><LoadingState label="Opening your quiz…" /></ParticipantShell>;
  if (quizQuery.isError || !quizQuery.data) return <ParticipantShell><ErrorState label="This quiz link may have moved." retry={() => quizQuery.refetch()} /></ParticipantShell>;
  const quiz: PublicQuiz = quizQuery.data;
  const setSelected = (questionId: string, optionId: string, multiple: boolean) => setAnswers((prev) => {
    const current = prev[questionId] || [];
    return { ...prev, [questionId]: multiple ? current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId] : [optionId] };
  });
  const send = () => {
    if (quiz.questions.some((q) => q.type === 'short-answer' ? !shortAnswers[q.id]?.trim() : !(answers[q.id]?.length))) { setError('Answer each question before sending.'); return; }
    const attempt: AttemptInput = { nickname: nickname.trim() || undefined, answers: quiz.questions.map((q) => ({ questionId: q.id, selectedOptionIds: answers[q.id] || [], ...(shortAnswers[q.id]?.trim() ? { shortAnswer: shortAnswers[q.id].trim() } : {}) })) };
    setError('');
    submit.mutate({ publicId: quiz.publicId, data: attempt }, { onSuccess: (value) => setResult(value), onError: () => setError('Your answers didn’t get through. Please try once more.') });
  };
  return <ParticipantShell>{result ? <section className="participant-result"><div className="result-stamp"><Heart size={25} fill="currentColor" /></div><span className="section-kicker">Answers, honestly shared</span><h1>{result.resultVisible ? result.message || 'Your answers are part of the story.' : 'Thank you for answering.'}</h1>{result.resultVisible && result.scorePercent !== null && <div className="result-score"><strong>{result.scorePercent}%</strong><span>{result.correctCount} of {result.scoredCount} right</span></div>}<p>Thanks for taking <b>{quiz.title}</b>. Your answers are with the person who made it.</p>{quiz.allowRetake && <Button variant="outline" onClick={() => { setResult(null); setAnswers({}); setShortAnswers({}); }}>Take it again <ArrowRight size={15} /></Button>}<Link href="/explore" className="text-link">Find another quiz <ArrowUpRight size={15} /></Link></section> :
    <div className="participant-wrap"><header className="participant-top"><LogoLink /><span className="participant-note"><LockKeyhole size={13} /> Just between you and them</span></header><div className="participant-hero"><div className="section-kicker">{quiz.category || 'A quiz for you'}</div><h1>{quiz.title}</h1><p>{quiz.description}</p><span className="quiz-question-total">{quiz.questions.length} questions <span className="meta-dot" /> a few minutes</span></div>
    <section className="participant-questions">{quiz.questions.map((question, i) => <ParticipantQuestion key={question.id} question={question} index={i} selected={answers[question.id] || []} shortAnswer={shortAnswers[question.id] || ''} onSelect={(id) => setSelected(question.id, id, question.type === 'multiple-choice')} onShort={(value) => setShortAnswers((prev) => ({ ...prev, [question.id]: value }))} />)}</section>
    <section className="submit-panel"><label className="field-label">What should they call you? <span className="optional-label">optional</span><input value={nickname} maxLength={40} placeholder="Your name or a nickname" onChange={(e) => setNickname(e.target.value)} data-testid="input-nickname" /></label>{error && <div className="inline-notice" role="alert">{error}</div>}<Button className="submit-answer" onClick={send} disabled={submit.isPending}>{submit.isPending ? 'Sending your answers…' : 'Send my answers'}{submit.isPending ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}</Button><small>Your answers are only shared with the person who made this quiz.</small></section>
    <footer className="participant-footer">{wordmark(true)} <span>Every answer tells a story.</span></footer></div>}
  </ParticipantShell>;
}

function ParticipantQuestion({ question, index, selected, shortAnswer, onSelect, onShort }: { question: PublicQuiz['questions'][number]; index: number; selected: string[]; shortAnswer: string; onSelect: (id: string) => void; onShort: (value: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const noButtonRef = useRef<HTMLButtonElement>(null);
  const suppressTouchClick = useRef(false);
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const playful = question.noButtonMode === 'playful' || question.noButtonMode === 'escape';
  const moveNo = (event?: React.PointerEvent<HTMLButtonElement>) => {
    if (event?.pointerType === 'touch') return;
    if (!playful || document.activeElement?.getAttribute('data-no-button') === question.id) return;
    const bounds = containerRef.current?.getBoundingClientRect();
    const button = noButtonRef.current?.getBoundingClientRect();
    if (!bounds || !button) return;
    const baseLeft = button.left - bounds.left - shift.x;
    const baseTop = button.top - bounds.top - shift.y;
    const minX = -baseLeft;
    const maxX = Math.max(minX, bounds.width - button.width - baseLeft);
    const minY = -baseTop;
    const maxY = Math.max(minY, bounds.height - button.height - baseTop);
    setShift({ x: minX + Math.random() * (maxX - minX), y: minY + Math.random() * (maxY - minY) });
  };
  return <article className="participant-question"><div className="participant-q-number">QUESTION {String(index + 1).padStart(2,'0')}</div><h2>{question.text}</h2>
    {playful && <span className="sr-only" id={`no-instructions-${question.id}`}>The No answer moves when touched. Keyboard users can focus it and press Enter or Space to select it.</span>}
    {question.type === 'short-answer' ? <textarea className="short-answer" rows={3} value={shortAnswer} placeholder="Write what comes to mind…" onChange={(e) => onShort(e.target.value)} aria-label={`Answer: ${question.text}`} /> :
      <div className={`participant-options ${playful ? 'playful' : ''}`} ref={containerRef}>{question.options.map((option) => {
        const isNo = /^(no|nope|nah)$/i.test(option.text);
        const isSelected = selected.includes(option.id);
        return <button ref={playful && isNo ? noButtonRef : undefined} type="button" key={option.id} disabled={question.noButtonMode === 'disabled' && isNo} className={`participant-option ${isSelected ? 'selected' : ''} ${playful && isNo ? 'playful-no' : ''}`} style={playful && isNo ? { transform: `translate(${shift.x}px, ${shift.y}px)` } : undefined} onPointerEnter={playful && isNo ? moveNo : undefined} onPointerMove={playful && isNo ? moveNo : undefined} onPointerDown={playful && isNo ? (event) => { if (event.pointerType === 'touch') { suppressTouchClick.current = true; event.preventDefault(); moveNo(); } } : undefined} onPointerUp={playful && isNo ? (event) => { if (event.pointerType === 'touch') setTimeout(() => { suppressTouchClick.current = false; }, 0); } : undefined} onClick={() => { if (playful && isNo && suppressTouchClick.current) { suppressTouchClick.current = false; return; } onSelect(option.id); }} aria-describedby={playful && isNo ? `no-instructions-${question.id}` : undefined} aria-pressed={isSelected} data-no-button={playful && isNo ? question.id : undefined} data-testid={`answer-${question.id}-${option.id}`}><span className="participant-radio">{isSelected && <i />}</span>{option.text}<span className="option-check"><Check size={15} /></span></button>;
      })}</div>}
    {playful && <p className="honest-note">The “no” can be a little playful. Your answer is always yours to choose.</p>}
  </article>;
}

function ParticipantShell({ children }: { children: React.ReactNode }) {
  return <main className="participant-shell"><div className="participant-canvas">{children}</div></main>;
}

function SettingsPage() {
  const { user } = useUser();
  const [name, setName] = useState(user?.fullName || '');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  useEffect(() => setName(user?.fullName || ''), [user?.fullName]);
  const save = async () => {
    if (!user) return;
    const [firstName, ...rest] = name.trim().split(/\s+/);
    setSaving(true); setSaveError('');
    try { await user.update({ firstName: firstName || '', lastName: rest.join(' ') }); setSaved(true); setTimeout(() => setSaved(false), 2200); }
    catch { setSaveError('We couldn’t update your name. Please try again.'); }
    finally { setSaving(false); }
  };
  return <AppFrame><div className="settings-wrap"><Link href="/dashboard" className="back-link"><ArrowLeft size={15} /> Back to your quizzes</Link><div className="section-kicker">The basics</div><h1 className="page-title">Your <em>account.</em></h1><p className="page-subtitle">A few details to make your little corner feel like yours.</p>
    <div className="settings-panel"><div className="settings-profile"><div className="settings-avatar">{(user?.firstName?.[0] || user?.primaryEmailAddress?.emailAddress?.[0] || 'L').toUpperCase()}</div><div><strong>{user?.fullName || 'Your name'}</strong><span>{user?.primaryEmailAddress?.emailAddress}</span></div></div><label className="field-label">Name<input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-testid="input-account-name" /></label><label className="field-label">Email address<input value={user?.primaryEmailAddress?.emailAddress || ''} readOnly aria-readonly="true" /><small>Your sign-in email is managed by your LOVELOCK account.</small></label>{saveError && <div className="inline-notice" role="alert">{saveError}</div>}<div className="settings-actions"><Button onClick={save} disabled={saving || name.trim() === (user?.fullName || '')}>{saving ? 'Saving…' : saved ? <><Check size={16} /> Saved</> : 'Save changes'}</Button></div></div>
    <div className="settings-privacy"><LockKeyhole size={18} /><div><strong>Your answers stay yours.</strong><p>We only share a quiz result with the person taking it when the quiz creator has chosen to show results.</p></div></div></div></AppFrame>;
}

function SignInPage() {
  return <div className="auth-page"><div className="auth-brand-panel"><LogoLink /><div className="auth-note"><span className="section-kicker">Good to have you back</span><h1>Your people<br />are <em>right here.</em></h1><p>Pick up where the stories left off.</p><div className="auth-mini-card"><Heart size={16} fill="currentColor" /><span>Someone answered your quiz.</span><ArrowRight size={15} /></div></div><span className="auth-footer-tag">Every answer tells a story.</span></div><div className="auth-form-panel"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div></div>;
}

function SignUpPage() {
  return <div className="auth-page"><div className="auth-brand-panel auth-brand-signup"><LogoLink /><div className="auth-note"><span className="section-kicker">A small beginning</span><h1>There’s a lot<br />to <em>know about you.</em></h1><p>Start with one question. See where it takes you.</p><div className="auth-mini-card"><Sparkles size={16} /><span>Your first quiz is just around the corner.</span><ArrowRight size={15} /></div></div><span className="auth-footer-tag">Every answer tells a story.</span></div><div className="auth-form-panel"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div></div>;
}

function HomeShell() {
  return <Switch>
    <Route path="/" component={HomePage} />
    <Route path="/sign-in/*?" component={SignInPage} />
    <Route path="/sign-up/*?" component={SignUpPage} />
    <Route path="/dashboard"><PrivateGate><DashboardPage /></PrivateGate></Route>
    <Route path="/quizzes/new"><PrivateGate><QuizEditorPage editing={false} /></PrivateGate></Route>
    <Route path="/quizzes/:quizId/analytics"><PrivateGate><AnalyticsPage /></PrivateGate></Route>
    <Route path="/quizzes/:quizId"><PrivateGate><QuizEditorPage editing /></PrivateGate></Route>
    <Route path="/templates"><TemplatesPage /></Route>
    <Route path="/explore"><ExplorePage /></Route>
    <Route path="/q/:publicId"><ParticipantPage /></Route>
    <Route path="/settings"><PrivateGate><SettingsPage /></PrivateGate></Route>
    <Route><NotFound /></Route>
  </Switch>;
}

function NotFound() {
  return <AppFrame><div className="not-found"><span className="section-kicker">Wrong turn, lovely human</span><h1 className="page-title">That story isn’t <em>here.</em></h1><p className="page-subtitle">The link may be old, or the page may have moved.</p><Link href="/" className="button button-primary">Back to the beginning <ArrowRight size={16} /></Link></div></AppFrame>;
}

function RoutedErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to find your stories.' } }, signUp: { start: { title: 'Make a little space for stories', subtitle: 'Create your LOVELOCK account.' } } }}
    routerPush={(to: string) => setLocation(stripBase(to))} routerReplace={(to: string) => setLocation(stripBase(to), { replace: true })}>
    <QueryClientProvider client={queryClient}><TooltipProvider><ClerkQueryClientCacheInvalidator /><RoutedErrorBoundary><HomeShell /></RoutedErrorBoundary><Toaster /></TooltipProvider></QueryClientProvider>
  </ClerkProvider>;
}

function App() {
  return <WouterRouter base={basePath}><ClerkRoutes /></WouterRouter>;
}

export default App;
