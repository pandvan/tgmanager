const YAML = require('yaml');
const FS = require('fs');

const Logger = require('./logger');

const Log = new Logger('Config');

let Config = {};

const UPLOAD_CHUNK = 512 * 1024;

function loadConfig(args) {
  Log.log(`loading config file '${args.config}'`);
  
  const yaml = YAML.parse( FS.readFileSync(args.config, 'utf-8' ) );

  const uploadMinSize = Number(yaml.telegram.upload.min_size) || 0;
  if ( uploadMinSize % UPLOAD_CHUNK !== 0 ) {
    throw `Upload Min Size must be: ( UploadMinSize % ${UPLOAD_CHUNK} == 0 )`
  }

  Config = Object.assign(Config, {
    telegram: {
      database: String(yaml.telegram.database) == 'true',
      users: yaml.telegram.users,
      upload: {
        min_size: uploadMinSize,
        channel: String(yaml.telegram.upload.channel)
      }
    },
    data: args.data,
    db: process.env.DB || yaml.db,
    logger: yaml.logger || 'info',
    httpPort: process.env.HTTP_PORT || yaml.httpPort,
    basic_auth: yaml.basic_auth,
    webdav: yaml.webdav,
    strm: {
      enabled: yaml.strm ? String(yaml.strm.enable) == 'true' : false,
      url: yaml.strm ? yaml.strm.url : ''
    }
  });

} 

module.exports = {
  Config,
  loadConfig,
  UPLOAD_CHUNK
};