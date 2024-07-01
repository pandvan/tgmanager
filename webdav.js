const Webdav = require('webdav-server').v2;
const Logger = require('./logger');
const { getItem, ROOT_ID } = require('./services/databases');
const TGFileSystem = require('./services/tg-filesystem');
const FSApi = require('./services/fs-api');
const {Config} = require('./config');

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

if ( Config.webdav.user ) {
  const userManager = new Webdav.SimpleUserManager();
  userManager.addUser(Config.webdav.user, Config.webdav.pass, true);
  httpAuthentication = new Authentication(userManager);
}

const WebDavServer = new Webdav.WebDAVServer({
  port: Config.webdav.port,
  httpAuthentication
});

WebDavServer.beforeRequest((ctx, next) => {
  Log.info('BEF:', ctx.request.method, ctx.requested.uri);
  next();
});
WebDavServer.afterRequest((ctx, next) => {
  Log.info('AFT:', ctx.request.method, ctx.response.statusCode);
  Log.debug('REQ:', ctx.request.headers);
  Log.debug('RES:', ctx.response._headers);
  Log.debug(ctx.responseBody);
  Logger.debug('');
  next();
});

async function start() {
  const rootFolder = await getItem(ROOT_ID);
  const fsApi = new FSApi(rootFolder);
  WebDavServer.setFileSystemSync('/', new TGFileSystem(fsApi));
  WebDavServer.start(() => Log.log('is running'));
}

start();