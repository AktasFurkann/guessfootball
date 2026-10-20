import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { users, sessions } from '../db.js';

/**
 * Hesaplar ve oturumlar.
 *
 * - Sifreler `scrypt` ile tuzlanip hash'lenir; duz metin hicbir yerde tutulmaz.
 * - Giris yapan tarayiciya uzun omurlu rastgele bir oturum anahtari verilir
 *   ("beni hatirla"). Veritabaninda anahtarin kendisi degil SHA-256 ozeti
 *   saklanir; veritabani sizsa bile oturumlar calinamaz.
 * - Oturum her kullanildiginda suresi uzar (kayan sure): duzenli oynayan biri
 *   bir daha sifre girmez.
 */

const scrypt = promisify(scryptCb);

/** Yeni hesabin baslangic parasi. */
export const STARTING_COINS = 1000;
/** Oturum, son kullanimdan bu kadar sonra gecersiz olur. */
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
/** Oturum suresini en fazla bu siklikla yazariz (her istekte DB yazmasin). */
const SESSION_TOUCH_MS = 24 * 60 * 60 * 1000;

const USERNAME_RE = /^[A-Za-z0-9ÇĞİÖŞÜçğıöşü_]{3,12}$/;
const MIN_PASSWORD = 6;
const MAX_PASSWORD = 128;

/** Hata mesaji kullaniciya gosterilebilir; status HTTP kodudur. */
export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Kullanici adinin karsilastirma anahtari (FURKAN = furkan = Furkan). */
export const usernameKey = (name) => String(name ?? '').trim().toLocaleLowerCase('tr');

function validate(username, password) {
  const name = String(username ?? '').trim();
  if (!USERNAME_RE.test(name)) {
    throw new AuthError('Kullanıcı adı 3-12 karakter olmalı; harf, rakam ve _ kullanılabilir.');
  }
  const pass = String(password ?? '');
  if (pass.length < MIN_PASSWORD) throw new AuthError(`Şifre en az ${MIN_PASSWORD} karakter olmalı.`);
  if (pass.length > MAX_PASSWORD) throw new AuthError('Şifre çok uzun.');
  return { name, pass };
}

async function hashPassword(password, salt = randomBytes(16)) {
  const hash = await scrypt(password, salt, 64);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

async function verifyPassword(password, { salt, hash }) {
  const candidate = await scrypt(password, Buffer.from(salt, 'hex'), 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

/** Istemciye donulen hesap ozeti (sifre bilgisi icermez). */
export function publicUser(user) {
  return { id: String(user._id), username: user.username, coins: user.coins ?? 0, createdAt: user.createdAt };
}

async function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  await sessions().insertOne({
    _id: tokenHash(token),
    userId,
    createdAt: now,
    touchedAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  });
  return token;
}

export async function register(username, password) {
  const { name, pass } = validate(username, password);
  const key = usernameKey(name);
  if (await users().findOne({ usernameKey: key }, { projection: { _id: 1 } })) {
    throw new AuthError('Bu kullanıcı adı alınmış.', 409);
  }
  const doc = {
    username: name,
    usernameKey: key,
    password: await hashPassword(pass),
    coins: STARTING_COINS,
    createdAt: new Date(),
  };
  try {
    const { insertedId } = await users().insertOne(doc);
    doc._id = insertedId;
  } catch (error) {
    // Ayni anda iki kayit: benzersiz indeks yakalar.
    if (error?.code === 11000) throw new AuthError('Bu kullanıcı adı alınmış.', 409);
    throw error;
  }
  return { token: await createSession(doc._id), user: publicUser(doc) };
}

// Kaba kuvvet denemelerine karsi: kullanici adi basina kisa sureli kilit.
const failures = new Map(); // key -> { count, until }
const MAX_FAILURES = 8;
const LOCK_MS = 10 * 60 * 1000;

export async function login(username, password) {
  const key = usernameKey(username);
  const state = failures.get(key);
  if (state && state.until > Date.now()) {
    throw new AuthError('Çok fazla hatalı deneme. Birkaç dakika sonra tekrar dene.', 429);
  }
  const user = await users().findOne({ usernameKey: key });
  const ok = user && (await verifyPassword(String(password ?? ''), user.password));
  if (!ok) {
    const next = { count: (state?.count ?? 0) + 1, until: 0 };
    if (next.count >= MAX_FAILURES) next.until = Date.now() + LOCK_MS;
    failures.set(key, next);
    throw new AuthError('Kullanıcı adı veya şifre hatalı.', 401);
  }
  failures.delete(key);
  return { token: await createSession(user._id), user: publicUser(user) };
}

export async function logout(token) {
  if (token) await sessions().deleteOne({ _id: tokenHash(token) });
}

/** Oturum anahtarindan kullaniciyi bulur (gecersiz/suresi dolmus: null). */
export async function userFromToken(token) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 128) return null;
  const id = tokenHash(token);
  const session = await sessions().findOne({ _id: id });
  if (!session || session.expiresAt < new Date()) return null;
  const user = await users().findOne({ _id: session.userId }, { projection: { password: 0 } });
  if (!user) return null;

  // Kayan sure: aktif kullanicinin oturumu uzar.
  if (Date.now() - new Date(session.touchedAt).getTime() > SESSION_TOUCH_MS) {
    const now = new Date();
    sessions()
      .updateOne({ _id: id }, { $set: { touchedAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) } })
      .catch(() => {});
  }
  return user;
}

/** `Authorization: Bearer <anahtar>` basligindan anahtari okur. */
export function tokenFromRequest(req) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

/** Varsa giris yapan kullaniciyi `req.user`a koyar; yoksa devam eder. */
export async function optionalAuth(req, _res, next) {
  try {
    req.user = await userFromToken(tokenFromRequest(req));
    next();
  } catch (error) {
    next(error);
  }
}

/** Giris zorunlu uclar icin. */
export async function requireAuth(req, res, next) {
  try {
    req.user = await userFromToken(tokenFromRequest(req));
    if (!req.user) return res.status(401).json({ error: 'Bu işlem için giriş yapmalısın.' });
    next();
  } catch (error) {
    next(error);
  }
}
