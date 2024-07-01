const DB = require('./databases');
const {Config} = require('../config');
const TelegramClients = require('./clients');
const Uploader = require('./uploader');
const Downloader = require('./downloader');
const Logger = require('../logger');
const Mime = require('mime-types');

const Log = new Logger('FSApi');

class FSApi {
  rootFolder = null;

  constructor(root) {
    this.rootFolder = root;
  }

  get Root() {
    return this.rootFolder;
  }


  async buildPath(item) {
    const paths = item.id == DB.ROOT_ID ? [] : [ item.filename ];
    let p = item;
    while ( p.parentfolder ) {
      p = await DB.getItem(p.parentfolder);
      if ( !p || p.id == DB.ROOT_ID ) break;
      paths.unshift( p.filename );
    }
    return paths.join('/');
  }

  splitPath(path) {
    let p = path;
    if (p.startsWith('/') ) {
      p = p.substring(1);
    }
    if (p.endsWith('/')) {
      p = p.substring(0, p.length - 1);
    }

    return p.split('/').filter(Boolean);
  }

  async getLastFolder(path, skipLast) {
    let paths = this.splitPath(path)
    if ( skipLast ) {
      paths.pop();
    }
    let folder = this.rootFolder;
    while(paths.length) {
      let childName = paths.shift();
      let parentId = folder.id;
      folder = await DB.getItemByFilename(childName, parentId);
      if ( !folder ) {
        return null;
      }
    }
    return folder;
  }

  async size(path) {
    const file = await this.getLastFolder(path);
    let size = 0;
    if ( !file ) {
      throw `'${path}' not found`;
    }
    if ( file.type !== 'folder' ) {
      size = file.sizes.reduce( (acc, value) => acc += value, size);
    }
    return size;
  }

  async create(path, isFolder) {
    const folder = await this.getLastFolder(path, true);

    if ( !folder ) {
      throw `'${path}' not found`;
    }
    let filename = this.splitPath(path).pop();
    
    if (isFolder) {

      const newFolder = await DB.createFolder(folder.id, filename);

      return newFolder;
    } else {

      let channelid = null, p = folder.id;
      while ( !channelid ) {
        const pf = await DB.getItem(p);
        channelid = pf.channel;
        if (pf.id === DB.ROOT_ID) break;
        p = pf.parentfolder;
      }

      if ( !channelid ) {
        Log.info('file will be created into default channel');
        channelid = Config.telegram.upload.channel;
      }

      const dbFile = await DB.saveFile({
        filename: filename,
        originalFilename: filename,
        type: Mime.lookup(filename),
        channel: channelid,
        // md5: 'string?',
        // fileids: 'string[]',
        // sizes: [0],
        // info: 'string{}',
        // content: 'data?',
        state: 'ACTIVE'
      }, folder.id);

      return dbFile;
    }
  }

  async listDir(path) {
    const folder = await this.getLastFolder(path);

    if ( !folder ) {
      throw `'${path}' not found`;
    }

    const children = await DB.getChildren(folder.id);
    return [ folder, ...children ];
  }

  async delete(path, recursively) {

    const paths = this.splitPath(path);
    const folder = await this.getLastFolder(path, true);

    if ( !folder ) {
      throw `'${path}' not found`;
    }
    let filename = paths.pop();

    const item = await DB.getItemByFilename(filename, folder.id);
    if ( !item ) {
      throw `'${filename}' not found under ${folder.id}`;
    }

    Log.info(`trying to delete '${item.filename}' [${item.id}], type: ${item.type}`);

    if (item.type == 'folder') {
      // TODO: delete folder recursively

      if ( recursively ) {
        await DB.write(async () => {
          const itemPath = await this.buildPath( item );
          const children = await this.listDir( itemPath );
          children.shift();
          for ( const ch of children) {
            const childPath = `${itemPath}/${ch.filename}`;
            await this.delete(childPath, recursively)
          }
        });
      }

      const itemdata = DB.remap(item);
      await DB.removeItem(itemdata.id);
      Log.info(`folder ${itemdata.filename} has been deleted, recursively: ${recursively}`);

    } else {
      const content = item.content;
      const data = JSON.parse(JSON.stringify(item));
      data.content = content;

      if (content && content.byteLength) {
        // file is a local file in DB
        const itemdata = DB.remap(item);
        await DB.removeItem(itemdata.id);
        Log.info(`file ${itemdata.filename} has been deleted`);
      } else {
        // file is located on telegram
        const parts = data.parts;
        
        TelegramClients.nextClient();
        const client = TelegramClients.Client;

        const sourceChannel = await client.getChannel(data.channel);

        for ( const part of parts ) {
          const mess = await client.getMessage({id: sourceChannel.id, hash: sourceChannel.access_hash}, part);
          if ( mess ) {
            const {media} = mess;
            const {document} = media;
            if ( data.fileids.includes(document.id) ) {
              // ok, proceed to delete message
              const resp = await client.deleteMessage({id: sourceChannel.id, hash: sourceChannel.access_hash}, part);
              if (resp.pts_count !== 1) {
                // callback(v2.Errors.InvalidOperation);
                throw `Deleted more than 1 message`;
              }
            } else {
              Log.error('File mismatch: fileid', document.id, 'is different for message', mess.id);
              // callback(v2.Errors.InvalidOperation);
              throw `File mismatch: fileid '${document.id}' is different for message '${mess.id}'`;
            }
          } else {
            Log.error('cannot retrieve message from chat:', sourceChannel.id, 'part:', part);
            // callback(v2.Errors.InvalidOperation);
            throw `cannot retrieve message from chat: ${sourceChannel.id}, part: ${part}`;
          }
          
        }

        const itemdata = DB.remap(item);
        await DB.removeItem(itemdata.id);
        Log.info(`file ${itemdata.filename} has been deleted, even from telegram`);
      }

    }

  }

  async createFileWithContent(path, estimatedSize, stream, callback) {
    const paths = this.splitPath(path);
    const folder = await this.getLastFolder(path, true);

    if ( !folder ) {
      throw `'${path}' not found`;
    }
    let filename = paths.pop();

    if (estimatedSize <= 0) {
      Log.info('skip upload because file is 0 bytes');
      return null;
    }

    let channelid = null, p = folder.id;
    while ( !channelid ) {
      const pf = await DB.getItem(p);
      channelid = pf.channel;
      if (pf.id === DB.ROOT_ID) break;
      p = pf.parentfolder;
    }

    if ( !channelid ) {
      Log.info('file will be uploaded into default channel');
      channelid = Config.telegram.upload.channel;
    }

    let dbFile = await DB.getItemByFilename(filename, folder.id);
    if ( dbFile && dbFile.state == 'TEMP' ) {
      Log.warn('delete already existing TEMPORARY file', filename, 'in', folder.filename);
      await DB.removeItem(dbFile.id);
      dbFile = {}
    }

    dbFile = await DB.saveFile({
      filename: filename,
      channel: channelid,
      originalFilename: filename,
      type: Mime.lookup(filename),
      parentfolder: folder.id,
      // md5: 'string?',
      // fileids: 'string[]',
      // sizes: 'double[]',
      // info: 'string{}',
      // content: 'data?',
      state: 'TEMP',
      id: dbFile ? dbFile.id : undefined
    }, folder.id);

    TelegramClients.nextClient();
    const client = TelegramClients.Client;

    const uploader = new Uploader(client, channelid, filename);

    await uploader.prepare();

    uploader.onCompleteUpload = async (portions, chl) => {
      DB.writeSync( () => {
        dbFile.channel = chl;
        dbFile.fileids = portions.map( (item) => String(item.fileId) );
        dbFile.sizes = portions.map( (item) => item.size );

        if (portions[0].content) {
          // file will be stored in DB
          dbFile.content = portions[0].content;
          dbFile.parts = [];
        } else {
          dbFile.content = null;
          dbFile.parts = portions.map( (item) => item.msgid );
        }

        dbFile.channel = channelid;
        dbFile.state = 'ACTIVE';

        Log.info('file has been correctly uploaded, id: ', dbFile.id);

        callback && callback(dbFile);

      });
    };

    Log.info('file is being uploaded, id:', dbFile.id);
    
    // start upload and attach 'data' and 'finish' handler
    uploader.execute(stream);

    return uploader;
  }

  async readFileContent(path, {start, end}, stream) {
    const paths = this.splitPath(path);
    const folder = await this.getLastFolder(path, true);

    if ( !folder ) {
      throw `'${path}' parentFolder not found`;
    }
    let filename = paths.pop();
    const file = await DB.getItemByFilename(filename, folder.id);

    if ( !file ) {
      throw `'${path}' not found`;
    }

    if (file.content) {
      stream.write( Buffer.from(file.content) );
      return null;
    }

    const dbData = [];
    for ( const [i, msgid] of file.parts.entries() ) {

      dbData.push({
        ch: String(file.channel).length > 10 ? String(file.channel).substring(3) : String(file.channel),
        msg: msgid,
        size: file.sizes[ i ]
      });

    }

    TelegramClients.nextClient();
    const client = TelegramClients.Client;

    let totalsize = file.sizes.reduce((acc, curr) => acc + curr, 0);
    if ( !totalsize ) {
      // TODO: calculate size
      // totalsize = await client.calculateSize(file.parts.slice(0));
    }

    if ( isNaN(start) ) {
      start = 0;
    }
  
    if ( isNaN(end) ) {
      end = totalsize - 1;
    }

    Log.info('serve file', filename, `, bytes: ${start}-${end}`, 'total:', totalsize);

    const reqId = String(Date.now());
    const service = new Downloader(reqId, dbData, start, end);

    service.execute(client, stream);

    return service;

  }

  async move(pathFrom, pathTo) {

    const pathsFrom = this.splitPath(pathFrom);
    const pathsTo = this.splitPath(pathTo);

    const oldFile = await this.getLastFolder(pathFrom);

    if ( !oldFile ) {
      throw `'${pathFrom}' not found`;
    }

    let parentFolder = await DB.getItem(DB.ROOT_ID);

    // TODO: move file from telegram channels
    
    await DB.write(async () => {
      // open transaction

      while(pathsTo.length - 1) {
        let foldeName = pathsTo.shift()
        let destPath = await DB.getItemByFilename( foldeName, parentFolder.id, 'folder');
        if ( !destPath ) {
          destPath = await DB.createFolder(parentFolder.id, foldeName);
        }
        parentFolder = destPath;
      }

      // get new name
      let filename = pathsTo.shift();

      const oldFileData = DB.remap(oldFile);
    
      oldFileData.filename = filename;
      oldFileData.parentfolder = parentFolder.id;

      //  v2.ResourceType.Directory : v2.ResourceType.File
      if ( oldFile.type == 'folder' ) {
        await DB.createFolder(parentFolder.id, filename, {id: oldFileData.id});
      } else {
        await DB.saveFile(oldFileData, parentFolder.id);
      }

    });

  }

  async copy(pathFrom, pathTo) {

    const pathsFrom = this.splitPath(pathFrom);
    const pathsTo = this.splitPath(pathTo);

    const oldFile = await this.getLastFolder(pathFrom);

    if ( !oldFile ) {
      throw `'${pathFrom}' not found`;
    }

    await DB.write(async () => {

      let parentFolder = await DB.getItem(DB.ROOT_ID);

      // let destChannel = null;

      while(pathsTo.length - 1) {
        let foldeName = pathsTo.shift();
        let destPath = await DB.getItemByFilename( foldeName, parentFolder.id, 'folder');
        if ( !destPath ) {
          destPath = await DB.createFolder(parentFolder.id, foldeName);
        }
        parentFolder = destPath;
        // destChannel = parentFolder.channel || destChannel;
      }

      // get new name
      let filename = pathsTo.shift();

      if ( oldFile.type == 'folder' ) {
        await DB.createFolder(parentFolder.id, filename);
      } else {

        const data = DB.remap(oldFile);
        delete data.id;

        if ( data.content && data.content.byteLength ) {
          // file is saved in db
          await DB.saveFile( { ...data, originalFilename: filename, filename, parentfolder: parentFolder.id });

        } else {
          // file is located on Telegram, need to be forwarded

          TelegramClients.nextClient();
          const client = TelegramClients.Client;

          const sourceChannel = await client.getChannel(oldFile.channel);
          let destinationChannel = sourceChannel;

          let newParts = [];
          for ( const part of oldFile.parts ) {
            const resp = await client.forwardMessage(part, 
              {id: sourceChannel.id, hash: sourceChannel.access_hash},
              {id: destinationChannel.id, hash: destinationChannel.access_hash},
            );
            const msg = resp.updates.find( u => !!u.message );
            newParts.push( msg.message.id );
          }

          await DB.saveFile( { ...data, channel: destinationChannel.id, filename, parentfolder: parentFolder.id, parts: newParts });

        }

      }

    });

  }

}


module.exports = FSApi;