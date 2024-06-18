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
      users: yaml.telegram.users
    },
    data: args.data,
    db: yaml.db,
    logger: yaml.logger || 'info',
    httpPort: yaml.httpPort
  });

} 

module.exports = {
  Config,
  loadConfig
};