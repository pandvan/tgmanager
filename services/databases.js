const Realm = require('realm');
const {getUUID} = require('../utils');
const Path = require('path');
const {Config} = require('../config');
const Logger = require('../logger');

const Log = new Logger('DB');

const ROOT_ID = '0000000000';
const ENTRY_NAME = 'entries';
const TELEGRAM_DATA_NAME = 'telegramdata';

class Entry extends Realm.Object {
  static Name = ENTRY_NAME;

  static schema = {
    name: ENTRY_NAME,
    properties: {
      id: {type: 'string', indexed: true, default: getUUID},
      filename: {type: 'string', indexed: true},
      channel: 'string?',
      parts: 'double[]',
      parentfolder: 'string?',
      type: 'string',
      md5: 'string?',
      fileid: 'string?',
      sizes: 'double[]',
      info: 'string{}',
      content: 'string?',
      state: {type: 'string', default: () => 'ACTIVE'}
    },
    primaryKey: 'id'
  };
}

class TelegramData extends Realm.Object {
  static Name = TELEGRAM_DATA_NAME;

  static schema = {
    name: TELEGRAM_DATA_NAME,
    properties: {
      key: 'string',
      value: 'string?'
    },
    primaryKey: 'key'
  };
}


let DB = null;

async function initDatabase() {
  const DB_PATH = Path.resolve( Path.join(Config.data, Config.db) );
  Log.info('init database in', DB_PATH);

  DB = await Realm.open({
    path: DB_PATH,
    schema: [Entry, TelegramData],
    schemaVersion: 2
  });

  const rootFolder = await getItem(ROOT_ID);
  if ( !rootFolder ) {
    Log.warn('root folder not exists, create a new one');
    await createFolder(null, 'root', ROOT_ID)
  }
}

async function getItem(id) {
  const ret = DB.objectForPrimaryKey(Entry.Name, id);

  return Promise.resolve( ret ? JSON.parse( JSON.stringify( ret ) ) : ret );
}

async function getChildren(folderId) {
  return Promise.resolve( JSON.parse( JSON.stringify( DB.objects(Entry.Name).filtered(`parentfolder = $0`, folderId) || [] ) ) );
}

async function getItemByFilename(filename, parent) {
  let obj = DB.objects(Entry.Name);
  if ( parent ) {
    obj = obj.filtered(`parentfolder = $0`, parent);
  }
  obj = obj.filtered(`filename = $0`, filename);

  if (parent) {
    return Promise.resolve( obj[0] ? JSON.parse( JSON.stringify( obj[0] ) ) : obj[0]); // null
  } else {
    return Promise.resolve( JSON.parse( JSON.stringify(obj) ) );
  }
}

async function checkExist(filename, parent, type) {
  let obj = DB.objects(Entry.Name).filtered(`filename = $0 and parentfolder = $1`, filename, parent);
  if ( type ) {
    obj = obj.filtered(`type = $0`, type);
  }
  return obj.length > 0;
}

async function createFolder(parentId, foldername, {channel, id}) {

  // check existing
  if ( await checkExist(foldername, parentId, 'folder') ) {
    throw `Folder '${foldername}' already exists in '${parentId}'`;
  }

  return await write( () => {
    return DB.create( Entry.Name, {
      id,
      filename: foldername,
      channel,
      parts: [],
      parent: parentId,
      type: 'folder',
      sizes: []
    }, 'modified');
  });

}

async function saveFile(file, parent) {

  // check existing
  if ( await checkExist(file.filename, parent || file.parent, file.type) ) {
    throw `File '${file.filename}' already exists in '${parent}'`;
  }

  file.parent = parent || file.parent;

  return await write( () => {
    return DB.create( Entry.Name, file, 'modified');
  })
}


let WRITING = false;
async function write(fn) {

  const fnOpen = async () => {
    return DB.write( () => {
      WRITING = true;
      try {
        let ret = fn(DB);
        return ret;
      } catch(e) {
        Log.error(`cannot write in DB`, e);
        throw e;
      } finally {
        WRITING = false;
      }
    });
  }

  if ( WRITING ){
    return Promise.resolve( fn(DB) );
  } else {
    return Promise.resolve(fnOpen());
  }

}


async function getTelegramData(key) {
  return Promise.resolve( DB.objectForPrimaryKey(TelegramData.Name, key) );
}

async function setTelegramData(data) {

  return await write( () => {
    return DB.create( TelegramData.Name, data, 'modified');
  })

}


module.exports = {
  ROOT_ID,
  initDatabase,
  DB,
  getItem,
  getChildren,
  write,
  saveFile,
  getItemByFilename,
  checkExist,
  getTelegramData,
  setTelegramData
};