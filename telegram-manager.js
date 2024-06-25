const TelegramClients = require('./services/clients');
const {Config, loadConfig} = require('./config');
const Path = require('path');
const FS = require('fs');
const {initDatabase} = require('./services/databases');
const Logger = require('./logger');

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
  } else {
    Log.log('exiting application');
    // close application if everything done
    process.exit(0);
  }

}


async function main() {
  await start();
}

main();