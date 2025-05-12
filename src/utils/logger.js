import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.uncolorize(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      stderrLevels: ['error', 'warn', 'info', 'debug', 'silly'],
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.uncolorize(),
        winston.format.simple()
      )
    })
  ]
});

export default logger; 