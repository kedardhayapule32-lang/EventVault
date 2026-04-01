const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'eventvault_secret_2024';

module.exports = (req, res, next) => {
  const auth = req.headers.authorization;
  const queryToken = req.query.token;
  const token = (auth && auth.startsWith('Bearer ')) ? auth.split(' ')[1] : queryToken;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};
