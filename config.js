const YAML = require('yaml');
const FS = require('fs');
const Path = require('path');

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

  Object.assign(Config, {
    telegram: {
      database: String(yaml.telegram.database) == 'true',
      users: yaml.telegram.users,
      upload: {
        min_size: uploadMinSize,
        channel: String(yaml.telegram.upload.channel)
      },
      bot_token: yaml.telegram.bot_token
    },
    data: Path.resolve(args.data || yaml.data || Path.join(__dirname, 'data/') ),
    
    db: process.env.DB || yaml.db,
    
    logger: args.log || yaml.logger || 'info',

    http: args.http && {
      host: process.env.HTTP_HOST || args.httpHost || (yaml.http && yaml.http.host),
      port: process.env.HTTP_PORT || args.httpPort || (yaml.http && yaml.http.port),
      user: args.httpUser || (yaml.http && yaml.http.user),
      pass: args.httpPass || (yaml.http && yaml.http.pass),
      debug: args.httpDebug || (yaml.http && yaml.http.debug)
    },
    webdav: args.webdav && {
      port: process.env.WEBDAV_PORT || args.webdavPort || (yaml.webdav && yaml.webdav.port),
      user: args.webdavUser || (yaml.webdav && yaml.webdav.user),
      pass: args.webdavPass || (yaml.webdav && yaml.webdav.pass),
      debug: args.webdavDebug || (yaml.webdav && yaml.webdav.debug)
    },

    strm: args.strm && {
      clearFolder: String(args.strmClearFolder || (yaml.strm && yaml.strm.clear_folder)) == 'true',
      url: args.strmUrl || (yaml.strm && yaml.strm.url),
      folder: args.strmFolder || (yaml.strm && yaml.strm.folder),
      debug: args.strmDebug || (yaml.strm && yaml.strm.debug)
    }
  });

} 

module.exports = {
  Config,
  loadConfig,
  UPLOAD_CHUNK
};