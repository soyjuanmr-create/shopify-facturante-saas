const logger = require('../utils/logger');

module.exports = (err, req, res, next) => {
  logger.error(err.message, { stack: err.stack, url: req.originalUrl });
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Error interno' : err.message,
  });
};
