const ADMIN_KEY = process.env.ADMIN_KEY || '';

function adminAuth(req, res, next) {
  const authHeader = (req.headers.authorization || '').toString();
  const adminHeader = req.headers['x-admin-key'];
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : adminHeader;
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const when = new Date().toISOString();

  if (!provided || provided !== ADMIN_KEY) {
    console.warn(`[ADMIN_AUTH] FAILED ${when} ip=${ip} provided=${!!provided}`);
    return res.status(401).json({ message: 'Unauthorized' });
  }

  console.info(`[ADMIN_AUTH] SUCCESS ${when} ip=${ip}`);
  return next();
}

module.exports = adminAuth;
