const TelegramClients = require('./services/clients');
const {Config} = require('./config');
const DB = require('./services/databases');
const Logger = require('./logger');
const Path = require('path');

const STRM = require('./services/strm');

const Log = new Logger('APP');


Logger.log(`----- STARTING UP [${process.pid}]------`);

// Initializing app
const Args = require('./initialize');

async function start() {

  Log.log('Starting application');
  await DB.initDatabase();

  for ( const user of Config.telegram.users){
    await TelegramClients.addClient( user );
  }

  if ( Args.http ) {
    require('./server');
  }
  if ( Args.webdav ) {
    require('./webdav');
  }
  if ( Args.strm ) {
    STRM.init( Path.resolve(Args.strm) );
  }

}


process.on('uncaughtException', (err, origin) => {
  Logger.log(
    `Caught exception: ${err}\n` +
    `Exception origin: ${origin}\n`,
  );
});

function handle(signal) {
  Logger.log(`---- Exit: ${signal} ----`);
  DB.close();
  process.exit(0);
}

process.on('SIGINT', handle);
process.on('SIGTERM', handle);

start();