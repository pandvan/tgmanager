const Yargs = require('yargs');
const { hideBin } = require('yargs/helpers');
const {Config, loadConfig} = require('./config');
const Log = require('./logger');
const Path = require('path');
const FS = require('fs');


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
  .option('webdav', {
    alias: 'wd',
    describe: 'start webdav server',
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

Log.setLevel( Config.logger );

module.exports = Args;