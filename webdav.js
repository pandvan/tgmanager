const Webdav = require('webdav-server').v2;
const Logger = require('./logger');
const DB = require('./services/databases');
const {ROOT_ID} = require('./constants');
const TGFileSystem = require('./services/tg-filesystem');
const FSApi = require('./services/fs-api');
const {Config} = require('./config');
const ShortUniqueID = require('short-unique-id');

const ShortUUID = new ShortUniqueID({length: 5});

const Log = new Logger('Webdav');


class Authentication extends Webdav.HTTPBasicAuthentication {
  getUser(ctx, callback) {
    const cb = (error, user) => {
      if (error) {
        callback(Webdav.Errors.BadAuthentication, null);
      } else {
        callback(null, user);
      }
    };
    super.getUser(ctx, cb);
  }
}


let httpAuthentication = null;

if ( Config.webdav.user && Config.webdav.pass ) {
  const userManager = new Webdav.SimpleUserManager();
  userManager.addUser(Config.webdav.user, Config.webdav.pass, true);
  httpAuthentication = new Authentication(userManager);
}

const WebDavServer = new Webdav.WebDAVServer({
  port: Config.webdav.port,
  httpAuthentication
});


WebDavServer.beforeRequest((ctx, next) => {
  ctx.req_id = ShortUUID.randomUUID();
  if ( String(Config.webdav.debug) == 'true' ) {
    Log.info(`[${ctx.req_id}]`, 'request:', ctx.request.method, ctx.requested.uri, 'range:', ctx.request.headers.range);
  }
  next();
});
if ( String(Config.webdav.debug) == 'true' ) {
  WebDavServer.afterRequest((ctx, next) => {
    Log.debug(`[${ctx.req_id}]`, 'response headers:', ctx.response._headers);
    Log.debug(`[${ctx.req_id}]`, 'body:', ctx.responseBody);
    Logger.debug('');
    next();
  });
}


async function start() {
  const rootFolder = await DB.getItem(ROOT_ID);
  const fsApi = new FSApi(rootFolder);
  WebDavServer.setFileSystemSync('/', new TGFileSystem(fsApi));
  WebDavServer.start(() => Log.info('up and running on port', Config.webdav.port));
  WebDavServer.server.requestTimeout = 0;
  WebDavServer.server.headersTimeout = 0;
}

start();