import jwt from 'jsonwebtoken';

const SECRET = process.env.WS_JWT_SECRET || '';

export type JwtVerifyResult =
  | {
      ok: true;
      payload: any;
    }
  | {
      ok: false;
      error: string;
      details?: string;
    };

export function verifyWsToken(token: string): JwtVerifyResult {
  if (!SECRET) {
    console.error('JWT Error: No secret configured');
    return { ok: false, error: 'no_secret_configured' };
  }

  if (!token) {
    console.error('JWT Error: No token provided');
    return { ok: false, error: 'no_token_provided' };
  }

  try {
    // First verify the token
    const verified = jwt.verify(token, SECRET, { complete: false, ignoreExpiration: false });

    // If we get here, the token is valid
    const decoded = typeof verified === 'string' ? JSON.parse(verified) : verified;

    if (!decoded) {
      console.error('JWT Error: Invalid token format - cannot decode');
      return { ok: false, error: 'invalid_token_format' };
    }

    // Handle both 'sub' and 'userId' as user identifier
    const userId = decoded.sub || decoded.userId;

    if (!userId) {
      console.error('JWT Error: Missing required fields (sub or userId)');
      console.error('Token payload:', JSON.stringify(decoded, null, 2));
      return { ok: false, error: 'missing_user_identifier' };
    }

    // Map to expected format
    const payload = {
      ...decoded,
      // Map both userId and uid for backward compatibility
      sub: userId,
      userId: userId,
      uid: userId,
      // Include roomId if present
      ...(decoded.roomId && { roomId: decoded.roomId }),
      // Include name if present
      ...(decoded.name && { name: decoded.name }),
      // Include role if present
      ...(decoded.role && { role: decoded.role }),
    };

    console.log('JWT verified successfully:', {
      userId,
      roomId: decoded.roomId,
      role: decoded.role,
    });

    return { ok: true, payload };
  } catch (err: any) {
    console.error('JWT verification failed:', {
      name: err.name,
      message: err.message,
      expiredAt: (err as any).expiredAt,
      date: new Date().toISOString(),
    });

    return {
      ok: false,
      error: err.name === 'TokenExpiredError' ? 'token_expired' : 'invalid_token',
      details: err.message,
    };
  }
}

interface SignTokenOptions {
  expiresIn?: string | number;
}

export function signWsToken(payload: Record<string, any>, opts?: SignTokenOptions): string {
  if (!SECRET) {
    throw new Error('WS_JWT_SECRET is not configured on the server');
  }
  // Ensure we don't accidentally sign dangerous fields here — sanitize payload in real world.
  const signOptions: jwt.SignOptions = {
    algorithm: 'HS256',
  };

  if (opts?.expiresIn !== undefined) {
    signOptions.expiresIn = opts.expiresIn as any;
  } else {
    signOptions.expiresIn = '5m';
  }

  return jwt.sign(payload, SECRET, signOptions);
}

export function verifyWsTokenStrict(token: string): JwtVerifyResult {
  if (!SECRET) {
    console.error('JWT Error: No secret configured');
    return { ok: false, error: 'no_secret_configured' };
  }

  if (!token) {
    return { ok: false, error: 'no_token_provided' };
  }

  try {
    // Verify and force algorithm expectations
    const decoded = jwt.verify(token, SECRET, { algorithms: ['HS256'] }) as any;

    if (!decoded || typeof decoded !== 'object') {
      return { ok: false, error: 'invalid_token_format' };
    }

    const userId = decoded.sub ?? decoded.userId ?? decoded.uid;
    if (!userId) {
      return { ok: false, error: 'missing_user_identifier' };
    }

    // Build normalized payload
    const payload = {
      ...decoded,
      sub: userId,
      userId,
      uid: userId,
      roomId: decoded.roomId ?? null,
      role: decoded.role ?? null,
      name: decoded.name ?? null,
    };

    return { ok: true, payload };
  } catch (err: any) {
    const name = err?.name ?? 'UnknownError';
    const message = err?.message ?? String(err);
    console.warn('JWT verification failed (strict):', { name, message });

    const error =
      name === 'TokenExpiredError'
        ? 'token_expired'
        : name === 'JsonWebTokenError'
          ? 'invalid_token'
          : 'token_verification_failed';

    return { ok: false, error, details: message };
  }
}
