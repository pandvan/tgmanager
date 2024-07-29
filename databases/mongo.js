const Mongoose = require('mongoose');
const { ROOT_ID, ROOT_NAME, ENTRY_NAME, TELEGRAM_DATA_NAME } = require('../constants');
const {Config} = require('../config');
const Process = require('process');
const Events = require('events');
const Logger = require('../logger');
const ShortUniqueID = require('short-unique-id');

const Event = new Events.EventEmitter();
const Log = new Logger('MongoDB');

const ShortUUID = new ShortUniqueID({length: 10});

const Schema = Mongoose.Schema;
const ObjectId = Schema.ObjectId;


const TIMESTAMPS = { timestamps: { createdAt: 'ctime', updatedAt: 'mtime' } };


const PartS = new Schema({
  messageid: {type: Number, required: true},
  originalfilename: String,
  hash: String,
  fileid: {type: String, required: true},
  size: Number,
  index: Number
}, TIMESTAMPS);

const EntryS = new Schema({
  id: {type: String, index: true, unique: true, required: true, default: () => ShortUUID.randomUUID()},
  filename: {type: String, index: true, required: true},
  channel: String,
  parts: [PartS],
  parentfolder: String,
  type: String,
  info: {type: Map, of: String},
  content: String,
  state: {type: String, default: () => 'ACTIVE'}
}, TIMESTAMPS);

const TelegramDataS = new Schema({
  key: {type: String, index: true, required: true},
  value: String
}, TIMESTAMPS);


EntryS.index({
  filename: 1,
  parentfolder: 1,
}, {unique: true});


EntryS.post('save', async (doc) => {
  // TODO
  const parentId = doc.parentfolder;
  if ( parentId ) {
    const parent = await EntryM.findOne({id: parentId});
    if ( parent ) {
      parent.mtime = Date.now();
    }
  }
});


const EntryM = Mongoose.model(ENTRY_NAME, EntryS);
const PartM = Mongoose.model('Part', PartS);
const TelegramDataM = Mongoose.model(TELEGRAM_DATA_NAME, TelegramDataS);

class MongoDB {
  connection = null;

  constructor() {

  }

  async init() {
    this.DB = await Mongoose.connect( Config.db );
    Log.info('Connection established with DB');

    // await EntryM.init();
    // await PartM.init();
    // await TelegramDataM.init();

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

  async getItem(id) {
    const ret = await EntryM.findOne({id});
    return this.remap(ret);
  }

  async getChildren(folderId, type) {
    const filter = {
      parentfolder: folderId
    };
    if ( type ) {
      filter.type = type;
    }
    const resp = await EntryM.find(filter);
    return (resp || []).map( i => this.remap(i));
  }

  async removeItem(itemId) {
    if ( itemId === ROOT_ID) {
      throw 'Cannot remote root folder';
    }

    const ret = await EntryM.deleteOne({id: itemId});
    return this.remap(ret);

    // const item = this.DB.objectForPrimaryKey(Entry.Name, itemId);
    // await this.write(() => {
  
    //   const itemData = this.remap(item);
  
    //   const ret = this.DB.delete( item );
  
    //   Process.nextTick( () => Event.emit('deleted', itemData) );
  
    //   return ret;
    // });
  }

  async getItemByFilename(filename, parent, type) {
    const filter = {};
    if ( parent ) {
      filter.parentfolder = parent;
    }

    let fn = filename.replace(/\//gi, '-');
    filter.filename = fn;
  
    if ( type ) {
      filter.type = type;
    }
  
    if (parent) {
      const ret = await EntryM.find(filter).collation( { locale: 'en', strength: 1 } );
      return ret && ret[0] ? this.remap(ret[0]) : null;
    } else {
      const resp = await EntryM.find(filter);
      return (resp || []).map( i => this.remap(i));
    }
  }

  async createFolder(folder, parent) {
  
    // check existing
    if ( await this.checkExist(folder.filename, parent || folder.parentfolder, 'folder') ) {
      throw `Folder '${folder.filename}' already exists in '${parent}'`;
    }
  
    return await this.write( async () => {

      folder.type = 'folder';
      folder.filename = folder.filename.replace(/\//gi, '-');
      folder.parentfolder = parent || folder.parentfolder;
      folder.state = folder.state || 'ACTIVE';
      folder.parts = [];
      folder.content = null;
  
      let newFold = await EntryM.create( folder );
  
      newFold = this.remap(newFold);
  
      // Process.nextTick(() => Event.emit('created', newFold));
  
      return newFold;
    });

  }

  async updateFolder(folder, data, parent) {
    // check existing
    if ( await this.checkExist(data.filename || folder.filename, parent || data.parentfolder, 'folder', data.id || folder.id) ) {
      throw `Folder '${data.filename}' already exists in '${parent}'`;
    }
  
    if ( !folder.id ) {
      throw `Cannot update folder without id`;
    }
  
    return await this.write( async () => {
  
      const oldFold = this.remap(folder);
  
      // force create a new folder
      folder.type = 'folder';
      folder.filename = (data.filename || folder.filename).replace(/\//gi, '-');
      folder.parentfolder = parent || data.parentfolder || folder.parentfolder;
      folder.state = 'ACTIVE';
      folder.channel = 'channel' in data ? data.channel : folder.channel;
      
      let newFold = await EntryM.updateOne({id: folder.id}, folder);

      newFold = this.remap(newFold);
  
      // Process.nextTick(() => Event.emit('changed', newFold, oldFold));
  
      return newFold;
    })
  
  }

  async createFile(file, parent) {
  
    // check existing
    if ( await this.checkExist(file.filename, parent || file.parentfolder, file.type) ) {
      throw `File '${file.filename}' already exists in '${parent}'`;
    }
  
    if ( (!file.content || (file.content.byteLength <= 0 || file.content.length <=0)) && !file.channel) {
      throw `File ${file.filename} has no channel`;
    }
  
    return await this.write( async () => {
  
      file.filename = file.filename.replace(/\//gi, '-');
      file.parentfolder = parent || file.parentfolder;
      file.type = file.type || 'application/octet-stream';
      file.state = file.state || 'ACTIVE';

      if (file.content) {
        if ( typeof file.content === 'object' ) {
          file.content = Buffer.from(file.content).toString('base64');
        }
      }
      
      let newFile = await EntryM.create( file );

      newFile = this.remap(newFile);
  
      // Process.nextTick(() => Event.emit('created', this.remap(newFile) ));
  
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
  
    return await this.write( async () => {
  
      const oldFile = this.remap(file);
  
      const insert = {
        ...oldFile,
        type: data.type || file.type,
        filename: (data.filename || file.filename).replace(/\//gi, '-'),
        parentfolder: parent || data.parentfolder || file.parentfolder,
        state: data.state || file.state || 'ACTIVE',
        channel: 'channel' in data ? data.channel : file.channel,
        parts: data.parts || file.parts
      };

      if ( data.content ) {
        if ( typeof data.content == 'object' ) {
          insert.content = Buffer.from(data.content).toString('base64');
        }
      }
  
      let newFile = await EntryM.updateOne( {id: file.id}, insert );
      newFile = this.remap(newFile);
  
      // Process.nextTick(() => Event.emit('changed', newFile, oldFile));
  
      return insert;
    });
  
  }

  async checkExist(filename, parent, type, id) {
    const filter = {
      filename: new RegExp(`^${filename.replace(/\//gi, '-')}$`, 'i'),
      parentfolder: parent
    };

    if ( id ) {
      // suppose 'modify' action
      filter.id = {$not: { $eq: id}};
    }

    if ( type ) {
      filter.type = type
    }

    let obj = await EntryM.find(filter);
    return obj.length > 0;
  }

  
  async getFilesByMessageIdAndChannel(msgId, channel) {
    const filter = {
      type: { '$not': { $eq: 'folder' } },
      channel: channel,
      state: { '$not': { $eq: 'TEMP' } },
      'parts.0': { $exists: true },
      'parts.messageid': msgId
    }

    return await EntryM.find(filter);
  }

  async getFolderByChannel(channelId) {
    const filter = {
      type: 'folder',
      channel: channelId
    };
    return await EntryM.find(filter);
  }



  async write(fn) {
    return await fn();
  }

  writeSync(fn) {
    return fn();
  }

  remap(item) {
    let content = item.content;

    if ( content ) {
      if ( typeof content === 'string' ) {
        content = Buffer.from(content, 'base64');
      }
    }

    return {
      id: item.id,
      filename: item.filename,
      channel: item.channel,
      parts: (item.parts || []).map( p => {
        return {
          messageid: p.messageid,
          originalfilename: p.originalfilename,
          hash: p.hash,
          fileid: p.fileid,
          size: p.size,
          index: p.index
        }
      }),
      parentfolder: item.parentfolder,
      type: item.type,
      info: item.info,
      content: content,
      state: item.state
    };
  }

  async getTelegramData(key) {
    return await TelegramDataM.findOne({key});
  }
  
  async setTelegramData(data) {
  
    return await this.write( async () => {
      const existing = await this.getTelegramData(data.key);
      if ( existing ) {
        await TelegramDataM.updateOne({key: data.key}, data);
      } else {
        await TelegramDataM.create( data );
      }
    })
  
  }
  
  async close() {
    await this.DB.connection.close();
  }

  isUUID(value) {
    return MongoDB.isUUID(value);
  }

  static isUUID(value) {
    return ShortUUID.validate(value);
  }

}

module.exports = MongoDB;