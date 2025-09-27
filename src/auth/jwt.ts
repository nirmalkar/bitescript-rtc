import jwt from 'jsonwebtoken';

const SECRET = process.env.WS_JWT_SECRET || '';

export type JwtVerifyResult = { 
  ok: true; 
  payload: any; 
} | { 
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
      ...(decoded.role && { role: decoded.role })
    };
    
    console.log('JWT verified successfully:', {
      userId,
      roomId: decoded.roomId,
      role: decoded.role
    });
    
    return { ok: true, payload };
    
  } catch (err: any) {
    console.error('JWT verification failed:', {
      name: err.name,
      message: err.message,
      expiredAt: (err as any).expiredAt,
      date: new Date().toISOString()
    });
    
    return { 
      ok: false, 
      error: err.name === 'TokenExpiredError' ? 'token_expired' : 'invalid_token',
      details: err.message
    };
  }
}
