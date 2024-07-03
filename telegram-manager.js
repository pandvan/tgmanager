const TelegramClients = require('./services/clients');
const {Config} = require('./config');
const {initDatabase} = require('./services/databases');
const Logger = require('./logger');
const Path = require('path');

const STRM = require('./services/strm');

const Log = new Logger('APP');

// Initializing app
const Args = require('./initialize');

async function start() {

  Log.log('Starting application');
  await initDatabase();

  for ( const user of Config.telegram.users){
    await TelegramClients.addClient( user );
  }

  if ( Args.serve ) {
    require('./server');
  }
  if ( Args.webdav ) {
    require('./webdav');
  }
  if ( Args.strm ) {
    STRM.init( Path.resolve(Args.strm) );
  }

}

async function main() {
  
  await start();

}

main();