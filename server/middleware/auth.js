import { validateSession, COOKIE_NAME } from '../security/sessions.js';
import { getClientIp } from '../security/clientIp.js';

export async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const clientIp = getClientIp(req);

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const session = await validateSession(token, clientIp);
  if (!session) {
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/'
    });
    return res.status(401).json({ error: 'Session expired or invalid' });
  }

  req.session = session;
  req.user = {
    id: session.userId,
    username: session.username,
    role: session.role
  };

  next();
}

export default requireAuth;
