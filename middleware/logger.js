// middleware/logger.js
const logger = (req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
};

module.exports = logger;
