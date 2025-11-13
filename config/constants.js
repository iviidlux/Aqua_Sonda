// config/constants.js
require('dotenv').config();

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  JWT_SECRET: process.env.JWT_SECRET || 'secreto_local_super_seguro',
};
