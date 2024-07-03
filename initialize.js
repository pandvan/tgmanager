const Yargs = require('yargs');
const { hideBin } = require('yargs/helpers');
const {Config, loadConfig} = require('./config');
const Logger = require('./logger');
const Path = require('path');
const FS = require('fs');

const Log = new Logger('Init');

const Args = Yargs( hideBin(process.argv) )
  .option('config', {
    alias: 'f',
    describe: 'config file path',
    type: 'string',
    default: Path.resolve( Path.join(__dirname, 'config.yaml') ),
  })
  .option('data', {
    alias: 'd',
    describe: `data folder, default to: ${Path.resolve( Path.join(__dirname, 'data/') )}`,
    type: 'string',
  })
  .option('database', {
    alias: 'db',
    describe: 'dabase name saved in "data" folder',
    type: 'string',
    default: "tg-manager"
  })
  .option('log', {
    describe: 'set log level',
    choices: ['no', 'error', 'warn', 'info', 'debug'],
    default: 'info'
  })

  .option('http', {
    describe: 'start http server',
    type: 'boolean',
    default: false
  })
    .option('http-port', {
      describe: 'http server port'
    })
    .option('http-user', {
      describe: 'http server user used for Basic Auth'
    })
    .option('http-pass', {
      describe: 'http server pass used for Basic Auth'
    })
    .option('http-debug', {
      type: 'boolean',
      describe: 'enable debug log',
      default: false
    })

  .option('webdav', {
    describe: 'start webdav server',
    type: 'boolean',
    default: false
  })
    .option('webdav-user', {
      describe: 'webdav user used for Basic Auth',
    })
    .option('webdav-pass', {
      describe: 'webdav pass used for Basic Auth',
    })
    .option('webdav-port', {
      describe: 'webdav server port',
    })
    .option('webdav-debug', {
      type: 'boolean',
      describe: 'enable debug log',
      default: false
    })


  .option('strm', {
    describe: 'enable strm management',
    type: 'boolean',
    default: false
  })
    .option('strm-folder', {
      describe: 'folder used to generate strm files',
    })
    .option('strm-url', {
      describe: 'the url used for strm file (need {fileid} special placeholder)',
    })
  .argv;

if ( !FS.existsSync(Args.config) ) {
  throw `Config file '${Args.config}' is missing`;
}

loadConfig( Args );

Log.log('using', Config.data, 'as data folder');

if ( ! FS.existsSync( Config.data ) ) {
  FS.mkdirSync( Config.data , true);
}

Logger.setLevel( Config.logger );

module.exports = Args;