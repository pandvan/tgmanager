const TelegramClients = require('./services/clients');
const {Config, loadConfig} = require('./config');
const Path = require('path');
const FS = require('fs');
const {initDatabase} = require('./services/databases');
const Logger = require('./logger');

const Log = new Logger('APP');

const Yargs = require('yargs');
const { hideBin } = require('yargs/helpers');


const Args = Yargs( hideBin(process.argv) )
  .option('config', {
    alias: 'f',
    describe: 'config file path',
    type: 'string',
    default: Path.resolve( Path.join(__dirname, 'config.yaml') ),
  })
  .option('data', {
    alias: 'd',
    describe: 'data folder',
    type: 'string',
    default: Path.resolve( Path.join(__dirname, 'data/') )
  })
  .option('serve', {
    alias: 's',
    describe: 'start http server',
    type: 'boolean',
    default: false
  })
  .argv;


Log.log('using', Args.data, 'as data folder');

if ( ! FS.existsSync( Args.data ) ) {
  FS.mkdirSync( Args.data , true);
}

if ( !FS.existsSync(Args.config) ) {
  throw `Config file '${Args.config}' is missing`;
}

loadConfig( Args );

Logger.setLevel( Config.logger );

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