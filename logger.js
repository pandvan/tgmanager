const DayJs = require('dayjs');


function now() {
  return DayJs().format('YYYY-MM-DD HH:mm:ss.SSS')
}

const LEVEL_NAMES = ['no', 'error', 'warn', 'info', 'debug'];
const Levels = {
  no: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4
};

class Logger extends console.Console {
  _name = '';

  static level = 'info';

  constructor(name) {
    super(process.stdout);
    this._name = name;
  }

  error() {
    if ( Levels[ Logger.level ] >= Levels.error ){
      super.error(...[now(), `[${this._name}]`, ...arguments]);
    }
  }
  warn() {
    if ( Levels[ Logger.level ] >= Levels.warn ) {
      super.warn(...[now(), `[${this._name}]`, ...arguments]);
    }
  }
  info() {
    if ( Levels[ Logger.level ] >= Levels.info ) {
      super.info(...[now(), `[${this._name}]`, ...arguments]);
    }
  }
  debug() {
    if ( Levels[ Logger.level ] >= Levels.debug ) {
      super.debug(...[now(), `[${this._name}]`, ...arguments]);
    }
  }
  log() {
    super.log(...[now(), `[${this._name}]`, ...arguments]);
  }


  static setLevel(level) {
    if ( !LEVEL_NAMES.includes(level) ) {
      throw `Invalid log level ${level}`;
    }
    Logger.level = level;
  }

  static error() {
    if ( Levels[ Logger.level ] >= Levels.error ){
      console.error(...arguments);
    }
  }
  static warn() {
    if ( Levels[ Logger.level ] >= Levels.warn ){
      console.warn(...arguments);
    }
  }
  static info() {
    if ( Levels[ Logger.level ] >= Levels.info ){
      console.info(...arguments);
    }
  }
  static debug() {
    if ( Levels[ Logger.level ] >= Levels.debug ){
      console.debug(...arguments);
    }
  }
  static log() {
    super.log(...arguments);
  }

}


module.exports = Logger;