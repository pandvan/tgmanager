const Realm = require('realm');
const Path = require('path');
const {Config} = require('../config');
const Logger = require('../logger');
const ShortUniqueID = require('short-unique-id');

const ShortUUID = new ShortUniqueID({length: 10});

const Log = new Logger('DB');

const ROOT_ID = '0000000000';
const ROOT_NAME = 'root';
const ENTRY_NAME = 'entries';
const TELEGRAM_DATA_NAME = 'telegramdata';

class Entry extends Realm.Object {
  static Name = ENTRY_NAME;

  static schema = {
    name: ENTRY_NAME,
    properties: {
      id: {type: 'string', indexed: true, default: () => ShortUUID.randomUUID() },
      filename: {type: 'string', indexed: true},
      channel: 'string?',
      parts: 'Part[]',
      parentfolder: 'string?',
      type: 'string',
      info: 'string{}',
      content: 'data?',
      state: {type: 'string', default: () => 'ACTIVE'},
      ctime: 'int?',
      mtime: 'int?',
      atime: 'int?'
    },
    primaryKey: 'id'
  };
}

class Part extends Realm.Object {
  static schema = {
    name: "Part",
    embedded: true,
    properties: {
      messageid: 'double',
      originalfilename: 'string?',
      hash: 'string?',
      fileid: 'string',
      size: 'double'
    },
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
    schema: [Entry, Part, TelegramData],
    schemaVersion: 1
  });

  const entryTable = DB.objects(Entry.Name);
  entryTable.addListener(onChangeListener);

  const rootFolder = await getItem(ROOT_ID);
  if ( !rootFolder ) {
    Log.warn('root folder not exists, create a new one');
    await createFolder(
      {
        id: ROOT_ID, 
        channel: Config.telegram.upload.channel,
        filename: ROOT_NAME,
        type: 'folder'
      }
      , null );
  }
}


function onChangeListener(entries, changes) {
  // Use `changes.deletions` for deleted object

  function manageEntries(index) {
    const entry = entries[index];
    writeSync( () => {
      // Log.log('saved', entry.filename, 'in', entry.parentfolder);
      if ( !entry.ctime ) entry.ctime = Date.now();
      if ( !entry.mtime ) entry.mtime = Date.now();
      if ( !entry.atime ) entry.atime = Date.now();
      const parentId = entry.parentfolder;
      if ( parentId ) {
        const parent = DB.objectForPrimaryKey(Entry.Name, parentId);
        if ( parent ) {
          // Log.debug('update', parent.filename);
          parent.mtime = Date.now();
          // await createFolder(parent.parentfolder, parent.filename, parent);
        }
      }
    });
  }

  (changes.insertions || []).forEach( manageEntries );
  (changes.modifications || []).forEach(manageEntries);
}

async function getItem(id) {
  const ret = DB.objectForPrimaryKey(Entry.Name, id);

  return Promise.resolve( ret );
}

async function getChildren(folderId, type) {
  let obj = DB.objects(Entry.Name).filtered(`parentfolder == $0`, folderId);
  if ( type ) {
    obj = obj.filtered('type == $0', type);
  }
  return Promise.resolve( obj || [] );
}

async function removeItem(itemId) {
  if ( itemId === ROOT_ID) {
    throw 'Cannot remote root folder';
  }
  const item = DB.objectForPrimaryKey(Entry.Name, itemId);
  await write(() => DB.delete( item ) );
}

async function getItemByFilename(filename, parent, type) {
  let obj = DB.objects(Entry.Name);
  if ( parent ) {
    obj = obj.filtered(`parentfolder == $0`, parent);
  }
  obj = obj.filtered(`filename ==[c] $0`, filename.replace(/\//gi, '-'));

  if ( type ) {
    obj = obj.filtered('type == $0', type);
  }

  if (parent) {
    return Promise.resolve( obj[0] );
  } else {
    return Promise.resolve( obj );
  }
}

async function checkExist(filename, parent, type, id) {
  let obj = DB.objects(Entry.Name).filtered(`filename ==[c] $0 and parentfolder == $1`, filename.replace(/\//gi, '-'), parent);
  if ( id ) {
    // suppose 'modify' action
    obj = obj.filtered('id <> $0', id);
  }
  if ( type ) {
    obj = obj.filtered(`type == $0`, type);
  }
  return obj.length > 0;
}

async function createFolder(folder, parent) {

  // check existing
  if ( await checkExist(folder.filename, parent || folder.parentfolder, 'folder', folder.id) ) {
    throw `Folder '${folder.filename}' already exists in '${parent}'`;
  }

  return await write( () => {
    folder.type = 'folder',
    folder.filename = folder.filename.replace(/\//gi, '-');
    folder.parentfolder = parent || folder.parentfolder;
    folder.originalFilename = folder.originalFilename || folder.filename;
    return DB.create( Entry.Name, folder, !!folder.id ? 'modified' : undefined);
  })
}

async function createFolder_(parentId, foldername, data) {

  const {channel, id} = data || {};

  // check existing
  if ( await checkExist(foldername, parentId, 'folder', id) ) {
    throw `Folder '${foldername}' already exists in '${parentId}'`;
  }

  return await write( () => {
    return DB.create( Entry.Name, Object.assign({
      id,
      filename: foldername.replace(/\//gi,'-'),
      originalFilename: foldername,
      channel,
      parts: [],
      parentfolder: parentId,
      type: 'folder',
      sizes: [],
      ctime: Date.now(),

    }, data), !!id ? 'modified' : undefined);
  });

}

async function saveFile(file, parent) {

  // check existing
  if ( await checkExist(file.filename, parent || file.parentfolder, file.type, file.id) ) {
    throw `File '${file.filename}' already exists in '${parent}'`;
  }

  return await write( () => {
    file.filename = file.filename.replace(/\//gi, '-');
    file.parentfolder = parent || file.parentfolder;
    file.originalFilename = file.originalFilename || file.filename;
    return DB.create( Entry.Name, file, !!file.id ? 'modified' : undefined);
  })
}


async function write(fn) {

  const fnOpen = async () => {
    return DB.write( () => {
      try {
        let ret = fn(DB);
        return ret;
      } catch(e) {
        Log.error(`cannot write in DB`, e);
        throw e;
      } finally {
      }
    });
  }

  if ( DB.isInTransaction ){
    return Promise.resolve( fn(DB) );
  } else {
    return Promise.resolve(fnOpen());
  }

}

function writeSync(fn) {

  const fnOpen = () => {
    return DB.write( () => {
      try {
        let ret = fn(DB);
        return ret;
      } catch(e) {
        Log.error(`cannot write in DB`, e);
        throw e;
      } finally {
      }
    });
  }

  if ( DB.isInTransaction ){
    return fn(DB);
  } else {
    return fnOpen();
  }

}

function remap(item) {
  const content = item.content;
  const data = JSON.parse(JSON.stringify(item));
  data.content = content;
  return data;
}


async function getTelegramData(key) {
  return Promise.resolve( DB.objectForPrimaryKey(TelegramData.Name, key) );
}

async function setTelegramData(data) {

  return await write( () => {
    return DB.create( TelegramData.Name, data, 'modified');
  })

}

async function close() {
  return await DB.close();
}


function isUUID(value) {
  return ShortUUID.validate(value);
}


module.exports = {
  ROOT_ID,
  initDatabase,
  DB,
  getItem,
  getChildren,
  write,
  writeSync,
  saveFile,
  getItemByFilename,
  checkExist,
  createFolder,
  getTelegramData,
  setTelegramData,
  removeItem,
  close,
  remap,
  isUUID
};
