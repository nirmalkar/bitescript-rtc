import jwt from 'jsonwebtoken';

const SECRET = process.env.WS_JWT_SECRET || '';

export type JwtVerifyResult = { ok: true; payload: any } | { ok: false; error: string };

export function verifyWsToken(token: string): JwtVerifyResult {
  if (!SECRET) return { ok: false, error: 'no_secret_configured' };
  try {
    const decoded = jwt.verify(token, SECRET) as any;
    return { ok: true, payload: decoded };
  } catch (err: any) {
    return { ok: false, error: err.message || 'invalid_token' };
  }
}
