const YAML = require('yaml');
const FS = require('fs');

const Logger = require('./logger');

const Log = new Logger('Config');

let Config = {};

function loadConfig(args) {
  Log.log(`loading config file '${args.config}'`);
  
  const yaml = YAML.parse( FS.readFileSync(args.config, 'utf-8' ) );

  Config = Object.assign(Config, {
    telegram: {
      database: String(yaml.telegram.database) == 'true',
      users: yaml.telegram.users,
      upload: {
        min_size: Number(yaml.telegram.upload.min_size) || 0,
        channel: String(yaml.telegram.upload.channel)
      }
    },
    data: args.data,
    db: process.env.DB || yaml.db,
    logger: yaml.logger || 'info',
    httpPort: process.env.HTTP_PORT || yaml.httpPort,
    basic_auth: yaml.basic_auth || {}
  });

} 

module.exports = {
  Config,
  loadConfig
};