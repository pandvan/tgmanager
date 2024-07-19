const Realm = require('realm');
const {Config} = require('../config');
const Path = require('path');
const Logger = require('../logger');
const ShortUniqueID = require('short-unique-id');
const Process = require('process');
const Events = require('events');

const Event = new Events.EventEmitter();

const { ROOT_ID, ROOT_NAME, ENTRY_NAME, TELEGRAM_DATA_NAME } = require('../constants');

const Log = new Logger('RealmDB');

const ShortUUID = new ShortUniqueID({length: 10});

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
      ctime: {type: 'int', default: Date.now},
      mtime: {type: 'int', default: Date.now},
      atime: {type: 'int', default: Date.now}
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
      size: 'double',
      index: 'int'
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


class RealmDB {
  
  DB = null;

  constructor() {
    
  }

  async init() {
    const DB_PATH = Path.resolve( Path.join(Config.data, Config.db) );
    Log.info('init database in', DB_PATH);

    this.DB = await Realm.open({
      path: DB_PATH,
      schema: [Entry, Part, TelegramData],
      schemaVersion: 3
    });

    const entryTable = this.DB.objects(Entry.Name);
    this.onChangeListener = this.onChangeListener.bind(this);
    entryTable.addListener(this.onChangeListener);

    const rootFolder = await this.getItem(ROOT_ID);
    if ( !rootFolder ) {
      Log.warn('root folder not exists, create a new one');
      await this.createFolder(
        {
          id: ROOT_ID, 
          channel: Config.telegram.upload.channel,
          filename: ROOT_NAME,
          type: 'folder'
        }
        , null );
    }
  }

  onChangeListener(entries, changes) {
    // Use `changes.deletions` for deleted object
    
    const manageEntries = (index) => {
      const entry = entries[index];
      this.writeSync( () => {
        // Log.log('saved', entry.filename, 'in', entry.parentfolder);
        // if ( !entry.ctime ) entry.ctime = Date.now();
        // if ( !entry.mtime ) entry.mtime = Date.now();
        // if ( !entry.atime ) entry.atime = Date.now();
        const parentId = entry.parentfolder;
        if ( parentId ) {
          const parent = this.DB.objectForPrimaryKey(Entry.Name, parentId);
          if ( parent ) {
            // Log.debug('update', parent.filename);
            parent.mtime = Date.now();
            // await createFolder(parent.parentfolder, parent.filename, parent);
          }
        }
      });
    };
  
    (changes.insertions || []).forEach( manageEntries );
    (changes.modifications || []).forEach(manageEntries);
  }

  async getItem(id) {
    const ret = this.DB.objectForPrimaryKey(Entry.Name, id);
  
    return Promise.resolve( ret );
  }
  
  async getChildren(folderId, type) {
    let obj = this.DB.objects(Entry.Name).filtered(`parentfolder == $0`, folderId);
    if ( type ) {
      obj = obj.filtered('type == $0', type);
    }
    return Promise.resolve( obj || [] );
  }
  
  async removeItem(itemId) {
    if ( itemId === ROOT_ID) {
      throw 'Cannot remote root folder';
    }
    const item = this.DB.objectForPrimaryKey(Entry.Name, itemId);
    await this.write(() => {
  
      const itemData = this.remap(item);
  
      const ret = this.DB.delete( item );
  
      Process.nextTick( () => Event.emit('deleted', itemData) );
  
      return ret;
    });
  }
  
  async getItemByFilename(filename, parent, type) {
    let obj = this.DB.objects(Entry.Name);
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
  
  async checkExist(filename, parent, type, id) {
    let obj = this.DB.objects(Entry.Name).filtered(`filename ==[c] $0 and parentfolder == $1`, filename.replace(/\//gi, '-'), parent);
    if ( id ) {
      // suppose 'modify' action
      obj = obj.filtered('id <> $0', id);
    }
    if ( type ) {
      obj = obj.filtered(`type == $0`, type);
    }
    return obj.length > 0;
  }
  
  async createFolder(folder, parent) {
  
    // check existing
    if ( await this.checkExist(folder.filename, parent || folder.parentfolder, 'folder') ) {
      throw `Folder '${folder.filename}' already exists in '${parent}'`;
    }
  
    return await this.write( () => {
      // force create a new folder
      // delete folder.id
      folder.type = 'folder',
      folder.filename = folder.filename.replace(/\//gi, '-');
      folder.parentfolder = parent || folder.parentfolder;
      folder.state = folder.state || 'ACTIVE';
      folder.parts = [];
      folder.content = null;
  
      let newFold = this.DB.create( Entry.Name, folder );
  
      newFold = this.remap(newFold);
  
      Process.nextTick(() => Event.emit('created', newFold));
  
      return newFold;
    })
  }
  
  async updateFolder(folder, data, parent) {
    // check existing
    if ( await this.checkExist(data.filename, parent || data.parentfolder, 'folder', data.id || folder.id) ) {
      throw `Folder '${data.filename}' already exists in '${parent}'`;
    }
  
    if ( !folder.id ) {
      throw `Cannot update folder without id`;
    }
  
    return await this.write( () => {
  
      const oldFold = this.remap(folder);
  
      // force create a new folder
      folder.type = 'folder',
      folder.filename = data.filename.replace(/\//gi, '-');
      folder.parentfolder = parent || data.parentfolder || folder.parentfolder;
      folder.state = 'ACTIVE';
      folder.channel = 'channel' in data ? data.channel : folder.channel;
      
      let newFold = this.DB.create( Entry.Name, folder, 'modified' );
  
      newFold = this.remap(newFold);
  
      Process.nextTick(() => Event.emit('changed', newFold, oldFold));
  
      return newFold;
    })
  
  }
  
  async createFile(file, parent) {
  
    // check existing
    if ( await this.checkExist(file.filename, parent || file.parentfolder, file.type) ) {
      throw `File '${file.filename}' already exists in '${parent}'`;
    }
  
    if ( (!file.content || file.content.byteLength <= 0) && !file.channel) {
      throw `File ${file.filename} has no channel`;
    }
  
    return await this.write( () => {
  
      file.filename = file.filename.replace(/\//gi, '-');
      file.parentfolder = parent || file.parentfolder;
      file.type = file.type || 'application/octet-stream';
      file.state = file.state || 'ACTIVE';
      
      let newFile = this.DB.create( Entry.Name, file);
  
      Process.nextTick(() => Event.emit('created', this.remap(newFile) ));
  
      return newFile;
  
    });
  }
  
  async updateFile(file, data, parent) {
    // check existing
    if ( await this.checkExist(file.filename, parent || file.parentfolder, file.type, file.id) ) {
      throw `File '${file.filename}' already exists in '${parent}'`;
    }
  
    if ( !file.id ) {
      throw `Cannot update file without id`;
    }
  
    return await this.write(() => {
  
      const oldFile = this.remap(file);
  
      const insert = {
        ...file,
        type: data.type || file.type,
        filename: (data.filename || file.filename).replace(/\//gi, '-'),
        parentfolder: parent || data.parentfolder || file.parentfolder,
        state: data.state || file.state || 'ACTIVE',
        channel: 'channel' in data ? data.channel : file.channel,
        parts: data.parts || file.parts,
        content: data.content
      };
  
  
      let newFile = this.DB.create( Entry.Name, insert, 'modified' );
  
      newFile = this.remap(newFile);
  
      Process.nextTick(() => Event.emit('changed', newFile, oldFile));
  
      return newFile;
    });
  
  }

  async getFilesByMessageIdAndChannel(msgId, channel) {
    return await this.DB.objects(Entry.Name).filtered('type != $0 && parts.@count > 0 && parts.messageid == $1 && channel == $2 && state != $3', 'folder', msgId, channel, 'TEMP');
  }

  async getFolderByChannel(channelId) {
    return await this.DB.objects(Entry.Name).filtered('type == $0 && channel == $1', 'folder', channelId);
  }

  async write(fn) {
  
    const fnOpen = async () => {
      return this.DB.write( () => {
        try {
          let ret = fn(this.DB);
          return ret;
        } catch(e) {
          Log.error(`cannot write in DB`, e);
          throw e;
        } finally {
        }
      });
    }
  
    if ( this.DB.isInTransaction ){
      return Promise.resolve( fn(this.DB) );
    } else {
      return Promise.resolve(fnOpen());
    }
  
  }
  
  writeSync(fn) {
  
    const fnOpen = () => {
      return this.DB.write( () => {
        try {
          let ret = fn(this.DB);
          return ret;
        } catch(e) {
          Log.error(`cannot write in DB`, e);
          throw e;
        } finally {
        }
      });
    }
  
    if ( this.DB.isInTransaction ){
      return fn(this.DB);
    } else {
      return fnOpen();
    }
  
  }
  
  remap(item) {
    const content = item.content;
    const data = JSON.parse(JSON.stringify(item));
    data.content = content;
    return data;
  }
  
  
  async getTelegramData(key) {
    return Promise.resolve( this.DB.objectForPrimaryKey(TelegramData.Name, key) );
  }
  
  async setTelegramData(data) {
  
    return await this.write( () => {
      return this.DB.create( TelegramData.Name, data, 'modified');
    })
  
  }
  
  async close() {
    this.DB.objects(Entry.Name).removeListener(this.onChangeListener);
    return await this.DB.close();
  }
  
  
  isUUID(value) {
    return RealmDB.isUUID(value);
  }

  static isUUID(value) {
    return ShortUUID.validate(value);
  }

}


module.exports = RealmDB;