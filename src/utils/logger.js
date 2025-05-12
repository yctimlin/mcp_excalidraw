import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',

  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.uncolorize(),
    winston.format.printf(info =>
      `${info.timestamp} [${info.level}] ${info.message}`
    )
  ),

  transports: [
    new winston.transports.Console({
      level: 'warn',                 // only warn+error to stderr
      stderrLevels: ['warn','error']
    }),

    new winston.transports.File({
      filename: 'excalidraw.log',    // all levels to file
      level: 'debug'
    })
  ]
});

export default logger;
