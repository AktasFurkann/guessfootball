import { Router } from 'express';
import {
  register,
  login,
  logout,
  publicUser,
  optionalAuth,
  requireAuth,
  tokenFromRequest,
  AuthError,
} from '../auth/accounts.js';
import { getProfile, searchUsers, leaderboard, recordSoloGame } from '../stats/profile.js';
import {
  dateTR,
  isValidDate,
  ensureDay,
  listDay,
  isOpen,
  savePrediction,
  predictionsFor,
  PredictionError,
  PICK_COINS,
  EXACT_COINS,
} from '../matches/service.js';
import { getMatchDetail } from '../matches/detail.js';

/** Hesap, profil ve mac tahmini uclari. */
export const accountRouter = Router();

/** Bilinen hata turlerini (AuthError/PredictionError) kullaniciya mesajla dondurur. */
const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error instanceof AuthError || error instanceof PredictionError || error.status) {
      return res.status(error.status || 400).json({ error: error.message });
    }
    next(error);
  }
};

// ---------------- hesap ----------------
accountRouter.post(
  '/auth/register',
  handle(async (req, res) => {
    res.status(201).json(await register(req.body?.username, req.body?.password));
  }),
);

accountRouter.post(
  '/auth/login',
  handle(async (req, res) => {
    res.json(await login(req.body?.username, req.body?.password));
  }),
);

accountRouter.post(
  '/auth/logout',
  handle(async (req, res) => {
    await logout(tokenFromRequest(req));
    res.json({ ok: true });
  }),
);

accountRouter.get(
  '/auth/me',
  requireAuth,
  handle(async (req, res) => {
    res.json({ user: publicUser(req.user) });
  }),
);

// ---------------- profil ----------------
accountRouter.get(
  '/users/search',
  handle(async (req, res) => {
    res.json({ results: await searchUsers(String(req.query.q ?? '')) });
  }),
);

accountRouter.get(
  '/users/leaderboard',
  handle(async (_req, res) => {
    res.json({ results: await leaderboard() });
  }),
);

accountRouter.get(
  '/users/:username',
  optionalAuth,
  handle(async (req, res) => {
    const profile = await getProfile(req.params.username, req.user);
    if (!profile) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    res.json(profile);
  }),
);

/** Tek kisilik kadro oyunu bitti (istemci bildirir). */
accountRouter.post(
  '/games/solo',
  requireAuth,
  handle(async (req, res) => {
    await recordSoloGame(req.user, req.body ?? {});
    res.status(201).json({ ok: true });
  }),
);

// ---------------- maclar + tahmin ----------------
/** Bugun ±3 gun disi istenmesin (gereksiz Transfermarkt istegi). */
function allowedDate(raw) {
  const date = isValidDate(raw) ? raw : dateTR(0);
  const allowed = new Set([-3, -2, -1, 0, 1, 2, 3].map((d) => dateTR(d)));
  return allowed.has(date) ? date : null;
}

accountRouter.get(
  '/matches',
  optionalAuth,
  handle(async (req, res) => {
    const date = allowedDate(req.query.date);
    if (!date) return res.status(400).json({ error: 'Yalnızca son/önümüzdeki 3 günün maçları gösterilir.' });
    await ensureDay(date);
    const list = await listDay(date);
    const mine = req.user ? await predictionsFor(req.user._id, list.map((m) => m._id)) : {};
    res.json({
      date,
      today: dateTR(0),
      rewards: { pick: PICK_COINS, exact: EXACT_COINS },
      user: req.user ? publicUser(req.user) : null,
      matches: list.map((m) => ({
        id: m._id,
        kickoff: m.kickoff,
        timeDefined: m.timeDefined,
        competition: m.competition,
        home: m.home,
        away: m.away,
        status: m.status,
        minute: m.minute,
        score: m.score,
        addition: m.addition,
        open: isOpen(m),
        prediction: mine[m._id] ?? null,
      })),
    });
  }),
);

/** Mac detayi: olaylar, istatistikler, kadrolar, anlatim (+ giris yaptiysa kendi tahmini). */
accountRouter.get(
  '/matches/:id/detail',
  optionalAuth,
  handle(async (req, res) => {
    const detail = await getMatchDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Maç bulunamadı.' });
    const mine = req.user ? (await predictionsFor(req.user._id, [detail.id]))[detail.id] ?? null : null;
    res.json({ ...detail, prediction: mine });
  }),
);

accountRouter.put(
  '/matches/:id/prediction',
  requireAuth,
  handle(async (req, res) => {
    res.json(await savePrediction(req.user, req.params.id, req.body ?? {}));
  }),
);
