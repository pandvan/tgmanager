const { parseRange } = require('../utils');
const Stream = require('stream');
const Path = require('path');
const {Config} = require('../config');
const {v2} = require('webdav-server');
const DB = require('./databases');
const TelegramClients = require('./clients');
const Mime = require('mime-types');
const Downloader = require('./downloader');
const Uploader = require('./uploader');
const Logger = require('../logger');

const Log = new Logger('WebDavFS');

class TGSerializer {
  fsApi = null;

  constructor(fsApi) {
    this.fsApi = fsApi;
  }

  uid() {
    return 'TGSerializer-1';
  }

  serialize(fileSystem, callback) {
    callback(null, {});
  }

  unserialize(serializedData, callback) {
    const fileSystem = new TGFileSystem(this.fsApi);
    callback(null, fileSystem);
  }
}


class TGResource extends v2.VirtualFileSystemResource {
  constructor(size, mtime, ctime, type) {
    const props = new v2.LocalPropertyManager();

    super({
      props,
      locks: new v2.LocalLockManager(),
      content: [],
      size: size || 0,
      lastModifiedDate: mtime || 0,
      creationDate: ctime || 0,
      type: type == 'folder' ? v2.ResourceType.Directory : v2.ResourceType.File,
    });
  }

  static async getItem(id) {
    const item = await DB.getItem(id);
    return TGResource.fromItem(item);
  }

  static fromItem(item) {
    let size = 0;
    if ( item.type !== 'folder' ) {
      size = item.sizes.reduce( (acc, value) => acc += value, size);
    }
    return new TGResource(size, item.mtime, item.ctime, item.type);
  }
}

class TGFileSystem extends v2.VirtualFileSystem {

  resources = []; // TGResource[]
  fsApi = null;

  constructor(fsApi) {
    super(new TGSerializer(fsApi));
    this.fsApi = fsApi;
    this.resources['/'] = new TGResource(fsApi.Root.size, fsApi.Root.mtime, fsApi.Root.ctime, 'folder');
  }

  async move(ctx, pathFrom, pathTo, overwrite, callback) {


    try {

      await this.fsApi.move(pathFrom.toString(), pathTo.toString());
      callback(null, true);

    } catch(e) {
      Log.error(e);
      callback(v2.Errors.ResourceNotFound);
    }


    // const item = this.resources[ pathFrom.toString() ];
    // if ( !item ) {
    //   return callback(v2.Errors.ResourceNotFound);
    // }

    // const oldFile = await this.getLastFolder(pathFrom);

    // if ( !oldFile ) {
    //   return callback(v2.Errors.ResourceNotFound);
    // }

    // const pathsTo = pathTo.paths.slice(0);
    // let parentFolder = await DB.getItem(DB.ROOT_ID);

    
    // await DB.write(async () => {
    //   // open transaction

    //   while(pathsTo.length - 1) {
    //     let foldeName = pathsTo.shift()
    //     let destPath = await DB.getItemByFilename( foldeName, parentFolder.id, 'folder');
    //     if ( !destPath ) {
    //       destPath = await DB.createFolder(parentFolder.id, foldeName);
    //     }
    //     parentFolder = destPath;
    //   }

    //   // get new name
    //   let filename = pathsTo.shift();

    //   const oldFileData = DB.remap(oldFile);
    
    //   oldFileData.filename = filename;
    //   oldFileData.parentfolder = parentFolder.id;

    //   //  v2.ResourceType.Directory : v2.ResourceType.File
    //   if ( item.type == v2.ResourceType.Directory ) {
    //     await DB.createFolder(parentFolder.id, filename, {id: oldFileData.id});
    //   } else {
    //     await DB.saveFile(oldFileData, parentFolder.id);
    //   }
    // });

    // callback(null, true);
  }

  async copy(ctx, pathFrom, pathTo, overwrite, callback) {


    const item = this.resources[ pathFrom.toString() ];
    if ( !item ) {
      return callback(v2.Errors.ResourceNotFound);
    }

    try {

      await this.fsApi.copy(pathFrom.toString(), pathTo.toString());
      callback(null, true);

    } catch(e) {
      Log.error(e);
      callback(v2.Errors.ResourceNotFound);
    }


    // const item = this.resources[ pathFrom.toString() ];
    // if ( !item ) {
    //   return callback(v2.Errors.ResourceNotFound);
    // }

    // const oldFile = await this.getLastFolder(pathFrom);

    // if ( !oldFile ) {
    //   return callback(v2.Errors.ResourceNotFound);
    // }


    // await DB.write(async () => {

    //   const pathsTo = pathTo.paths.slice(0);
    //   let parentFolder = await DB.getItem(DB.ROOT_ID);

    //   // let destChannel = null;

    //   while(pathsTo.length - 1) {
    //     let foldeName = pathsTo.shift();
    //     let destPath = await DB.getItemByFilename( foldeName, parentFolder.id, 'folder');
    //     if ( !destPath ) {
    //       destPath = await DB.createFolder(parentFolder.id, foldeName);
    //     }
    //     parentFolder = destPath;
    //     // destChannel = parentFolder.channel || destChannel;
    //   }

    //   // get new name
    //   let filename = pathsTo.shift();

    //   if ( oldFile.type == 'folder' ) {
    //     await DB.createFolder(parentFolder.id, filename);
    //   } else {

    //     const content = oldFile.content;
    //     const data = JSON.parse(JSON.stringify(oldFile));
    //     delete data.id;

    //     data.content = content;

    //     if ( content && content.byteLength ) {
    //       // file is saved in db
    //       await DB.saveFile( { ...data, originalFilename: filename, filename, parentfolder: parentFolder.id })

    //     } else {
    //       // file is located on Telegram, need to be forwarded

    //       TelegramClients.nextClient();
    //       const client = TelegramClients.Client;

    //       const sourceChannel = await client.getChannel(oldFile.channel);
    //       let destinationChannel = sourceChannel;

    //       // if ( oldFile.channel !== destChannel ) {
    //       //   destinationChannel = await client.getChannel(destChannel);
    //       // }

    //       let newParts = [];
    //       for ( const part of oldFile.parts ) {
    //         const resp = await client.forwardMessage(part, 
    //           {id: sourceChannel.id, hash: sourceChannel.access_hash},
    //           {id: destinationChannel.id, hash: destinationChannel.access_hash},
    //         );
    //         const msg = resp.updates.find( u => !!u.message );
    //         newParts.push( msg.message.id );
    //       }

    //       await DB.saveFile( { ...data, channel: destinationChannel.id, filename, parentfolder: parentFolder.id, parts: newParts });

    //     }

    //   }


    // });

    // callback(null, true);
  }

  async rename(ctx, pathFrom, newName, callback) {
    Log.log('rename:', pathFrom.toString(), newName.toString());
    callback(null, true);
  }

  async _fastExistCheck(ctx, path, callback) {
    if (this.resources[path.toString()]) {
      callback(true);
    } else {
      this._readDir(path, ctx, (err, resp) => {
        callback( !!this.resources[path.toString()] );
      });
    }
  }

  async _size(path, ctx, callback) {
    try {
      const size = await this.fsApi.size(path.toString());
      callback(null, size);
    } catch(e) {
      Log.error(e);
      callback(v2.Errors.ResourceNotFound);
    }
  }


  async _create(path, ctx, callback) {

    try {

      const dbFile = await this.fsApi.create(path.toString(), ctx.type.isDirectory);
      
      this.resources[path.toString()] = TGResource.fromItem(dbFile);
      callback(null, true);

    } catch(e) {
      Log.error(e);
      callback(v2.Errors.ResourceNotFound);
    }

    // const folder = await this.getLastFolder(path, true);

    // if ( !folder ) {
    //   return callback(v2.Errors.ResourceNotFound);
    // }
    // let filename = path.paths.slice(0).pop();
    
    // if (ctx.type.isDirectory) {

    //   const newFolder = await DB.createFolder(folder.id, filename);

    //   this.resources[path.toString()] = TGResource.fromItem(newFolder);
    //   callback(null, true);
    // } else {


    //   let channelid = null, p = folder.id;
    //   while ( !channelid ) {
    //     const pf = await DB.getItem(p);
    //     channelid = pf.channel;
    //     if (pf.id === DB.ROOT_ID) break;
    //     p = pf.parentfolder;
    //   }

    //   if ( !channelid ) {
    //     Log.info('file will be created into default channel');
    //     channelid = Config.telegram.upload.channel;
    //   }

    //   const dbFile = await DB.saveFile({
    //     filename: filename,
    //     originalFilename: filename,
    //     type: Mime.lookup(filename),
    //     channel: channelid,
    //     // md5: 'string?',
    //     // fileids: 'string[]',
    //     // sizes: [0],
    //     // info: 'string{}',
    //     // content: 'data?',
    //     state: 'ACTIVE'
    //   }, folder.id);

    //   this.resources[path.toString()] = TGResource.fromItem(dbFile);
    //   callback(null, true);
    // }
  }

  async _readDir(path, ctx, callback) {

    try {

      const res = await this.fsApi.listDir(path.toString());
      const currentFolder = res.shift();

      this.resources[path.toString()] = TGResource.fromItem(currentFolder);

      const response = res.map((child) => {
        this.resources[ `${Path.join( path.toString(), child.filename)}` ] = TGResource.fromItem(child);
        return child.filename;
      });

      callback(null, response);

    } catch(e) {
      Log.error(e);
      callback(v2.Errors.ResourceNotFound);
    }

  }

  async _openReadStream(path, ctx, callback) {

    const stream = new Stream.PassThrough();

    const headerRange = ctx.context.headers.headers.range;
    const range = headerRange || '';
    let {start, end} = parseRange(range);

    try {

      stream.pause();
      const service = await this.fsApi.readFileContent(path.toString(), {start, end}, stream);

      if ( service ) {
        // file will be read from telegram

        ctx.context.request.on('error', () => {
          if ( !service.aborted ) {
            service.stop();
            Log.warn('request has been aborted because of error')
          } 
        });
      
        ctx.context.request.on('aborted', () => {
          if ( !service.aborted ) {
            service.stop();
            Log.warn('request has been aborted because of aborted')
          } 
        });
      
        ctx.context.request.on('close', () => {
          if ( !service.aborted ) {
            service.stop();
            Log.warn('request has been aborted because of close')
          } 
        });

      }

      callback(null, stream);
      ctx.context.response.setHeader('Content-Range', `bytes ${service.Range.start}-${service.Range.end}/${service.Range.totalsize}`);
      stream.resume();

    } catch(e) {
      Log.error(e);
      callback(v2.Errors.ResourceNotFound);
    }

    // const folder = await this.getLastFolder(path, true);

    // if ( !folder ) {
    //   return callback(v2.Errors.ResourceNotFound);
    // }
    // let filename = path.paths.slice(0).pop();
    // const file = await DB.getItemByFilename(filename, folder.id);

    // if ( !file ) {
    //   return callback(v2.Errors.ResourceNotFound);
    // }

    // const dbData = [];
    // for ( const [i, msgid] of file.parts.entries() ) {

    //   dbData.push({
    //     ch: String(file.channel).length > 10 ? String(file.channel).substring(3) : String(file.channel),
    //     msg: msgid,
    //     size: file.sizes[ i ]
    //   });

    // }

    // const totalsize = file.sizes.reduce((acc, curr) => acc + curr, 0);

    // const headerRange = ctx.context.headers.headers.range;
    // const range = headerRange || '';
    // let {start, end} = parseRange(range);

    // if ( isNaN(start) ) {
    //   start = 0;
    // }
  
    // if ( isNaN(end) ) {
    //   end = totalsize - 1;
    // }

    // Log.info('serve file', filename, headerRange ? `with range ${start}-${end}` : 'full content', 'total:', totalsize);

    // const stream = new Stream.PassThrough();
    // callback(null, stream);

    // const reqId = String(Date.now());
    // const service = new Downloader(reqId, dbData, start, end);

    // ctx.context.request.on('error', () => {
    //   if ( !service.aborted ) {
    //     service.stop();
    //     Log.warn('request has been aborted because of error')
    //   } 
    // });
  
    // ctx.context.request.on('aborted', () => {
    //   if ( !service.aborted ) {
    //     service.stop();
    //     Log.warn('request has been aborted because of aborted')
    //   } 
    // });
  
    // ctx.context.request.on('close', () => {
    //   if ( !service.aborted ) {
    //     service.stop();
    //     Log.warn('request has been aborted because of close')
    //   } 
    // });

    // if (file.content) {
    //   stream.write(Buffer.from(file.content) );
    // } else {

    //   TelegramClients.nextClient();
    //   const client = TelegramClients.Client;
    //   service.execute(client, stream);
    // }

  }


  async _delete(path, ctx, callback) {

    const resource = this.resources[path.toString()];
    if (!resource) {
      return callback(v2.Errors.ResourceNotFound);
    }

    try {

      await this.fsApi.delete(path.toString(), true);

      const sPath = path.toString(true);
      for (const itemPath in this.resources) {
        if (itemPath.startsWith(sPath)) {
          delete this.resources[itemPath];
        }
      }

      delete this.resources[path.toString()];

      callback(null, true);

    } catch(e) {
      Log.error(e);
      callback(v2.Errors.ResourceNotFound);
    }

    // const folder = await this.getLastFolder(path, true);

    // if ( !folder ) {
    //   return callback(v2.Errors.ResourceNotFound);
    // }
    // let filename = path.paths.slice(0).pop();

    // const item = await DB.getItemByFilename(filename, folder.id);
    // if ( !item ) {
    //   return callback(v2.Errors.ResourceNotFound);
    // }

    // if (item.type == 'folder') {
    //   await DB.removeItem(item.id);
    // } else {
    //   const content = item.content;
    //   const data = JSON.parse(JSON.stringify(item));
    //   data.content = content;

    //   if (content && content.byteLength) {
    //     // file is a local file in DB
    //     await DB.removeItem(item.id);
    //   } else {
    //     // file is located on telegram
    //     const parts = data.parts;
        
    //     TelegramClients.nextClient();
    //     const client = TelegramClients.Client;

    //     const sourceChannel = await client.getChannel(data.channel);

    //     for ( const part of parts ) {
    //       const mess = await client.getMessage({id: sourceChannel.id, hash: sourceChannel.access_hash}, part);
    //       if ( mess ) {
    //         const {media} = mess;
    //         const {document} = media;
    //         if ( data.fileids.includes(document.id) ) {
    //           // ok, proceed to delete message
    //           const resp = await client.deleteMessage({id: sourceChannel.id, hash: sourceChannel.access_hash}, part);
    //           if (resp.pts_count !== 1) {
    //             callback(v2.Errors.InvalidOperation);
    //             throw `Deleted more than 1 message`;
    //           }
    //         } else {
    //           Log.error('File mismatch: fileid is different for message', mess.id);
    //           callback(v2.Errors.InvalidOperation);
    //           throw `File mismatch: fileid is different for message ${mess.id}`;
    //         }
    //       } else {
    //         Log.error('cannot retrieve message from chat:', sourceChannel.id, 'part:', part);
    //         callback(v2.Errors.InvalidOperation);
    //         throw `cannot retrieve message from chat: ${sourceChannel.id}, part: ${part}`;
    //       }
          
    //     }

    //     await DB.removeItem(item.id);
    //   }

    // }

  }


  async _openWriteStream(path, ctx, callback) {

    const stream = new Stream.PassThrough();

    if (ctx.estimatedSize <= 0) {
      Logger.info('skip upload because file is 0 bytes');
      return stream;
    }

    try {

      const service = await this.fsApi.createFileWithContent(path.toString(), ctx.estimatedSize, stream, (dbFile) => {
        this.resources[path.toString()] = TGResource.fromItem(dbFile);

        for (const cb of lastHandlers) {
          cb.apply(stream);
        }
      });

      /**
       * WORKAROUND:
       * inputstream is flushed before uploading file on telegram.
       * So, we need to force the 'no-response' to the client 'till file
       * was uploaded on telegram.
       * We need to attach 'data' and 'finish' event-handler to inputstream;
       * after that we have to remove all event and pass the inputstream to caller.
       * In this way the 'caller' can add its event-handlers. 
       * Then, we can remove all 'finish' event-handlers and re-attach older event-handlers.
       * After upload (on telegram) is completed, we can manually call the caller's event-handlers
       * In this way the client is notified only once file is fully uploaded on telegram
       */


      // get *our* 'finish' handlers
      const finishHandlers = stream.listeners('finish');
      stream.removeAllListeners('finish');

      // start receiving data from 'caller'
      callback(null, stream);

      // get the caller's 'finish' event-handlers
      const lastHandlers = stream.listeners('finish');

      // remove all 'finish' event-handlers (from caller)
      stream.removeAllListeners('finish');

      // re-attach *our* 'finish' event-handlers
      for (const cb of finishHandlers) {
        stream.on('finish', cb);
      }


    } catch(e) {
      Log.error(e);
      callback(v2.Errors.ResourceNotFound);
    }


    // const folder = await this.getLastFolder(path, true);

    // if ( !folder ) {
    //   return callback(v2.Errors.ResourceNotFound);
    // }
    // let filename = path.paths.slice(0).pop();

    // const { estimatedSize } = ctx;

    // const stream = new Stream.PassThrough();

    // if (estimatedSize <= 0) {
    //   callback(null, stream);
    //   Logger.info('skip upload because file is 0 bytes');
    //   return;
    // }

    // let channelid = null, p = folder.id;
    // while ( !channelid ) {
    //   const pf = await DB.getItem(p);
    //   channelid = pf.channel;
    //   if (pf.id === DB.ROOT_ID) break;
    //   p = pf.parentfolder;
    // }

    // if ( !channelid ) {
    //   Log.info('file will be uploaded into default channel');
    // }

    // let dbFile = await DB.getItemByFilename(filename, folder.id);
    // if ( dbFile && dbFile.state == 'TEMP' ) {
    //   Log.warn('delete already existing TEMPORARY file', filename, 'in', folder.filename);
    //   await DB.removeItem(dbFile.id);
    // }

    // dbFile = await DB.saveFile({
    //   filename: filename,
    //   channel: channelid,
    //   originalFilename: filename,
    //   type: Mime.lookup(filename),
    //   parentfolder: folder.id,
    //   // md5: 'string?',
    //   // fileids: 'string[]',
    //   // sizes: 'double[]',
    //   // info: 'string{}',
    //   // content: 'data?',
    //   state: 'TEMP',
    //   id: dbFile ? dbFile.id : undefined
    // }, folder.id);

    // TelegramClients.nextClient();
    // const client = TelegramClients.Client;

    // const uploader = new Uploader(client, channelid, filename);

    // await uploader.prepare();

    // uploader.onCompleteUpload = async (portions, chl) => {
    //   DB.writeSync( () => {
    //     dbFile.channel = chl;
    //     dbFile.fileids = portions.map( (item) => String(item.fileId) );
    //     dbFile.sizes = portions.map( (item) => item.size );

    //     if (portions[0].content) {
    //       // file will be stored in DB
    //       dbFile.content = portions[0].content;
    //       dbFile.parts = [];
    //     } else {
    //       dbFile.content = null;
    //       dbFile.parts = portions.map( (item) => item.msgid );
    //     }

    //     dbFile.channel = channelid;
    //     dbFile.state = 'ACTIVE';

    //     Log.info('file has been correctly uploaded, id: ', dbFile.id);

    //     this.resources[path.toString()] = TGResource.fromItem(dbFile);

    //     for (const cb of lastHandlers) {
    //       cb.apply(stream);
    //     }

    //   });
    // };

    // Log.info('file is being uploaded, id:', dbFile.id);
    
    // /**
    //  * WORKAROUND:
    //  * inputstream is flushed before uploading file on telegram.
    //  * So, we need to force the 'no-response' to the client 'till file
    //  * was uploaded on telegram.
    //  * We need to attach 'data' and 'finish' event-handler to inputstream;
    //  * after that we have to remove all event and pass the inputstream to caller.
    //  * In this way the 'caller' can add its event-handlers. 
    //  * Then, we can remove all 'finish' event-handlers and re-attach older event-handlers.
    //  * After upload (on telegram) is completed, we can manually call the caller's event-handlers
    //  * In this way the client is notified only once file is fully uploaded on telegram
    //  */


    // // start upload and attach 'data' and 'finish' handler
    // uploader.execute(stream);

    // // get *our* 'finish' handlers
    // const finishHandlers = stream.listeners('finish');
    // stream.removeAllListeners('finish');

    // // start receiving data from 'caller'
    // callback(null, stream);

    // // get the caller's 'finish' event-handlers
    // const lastHandlers = stream.listeners('finish');

    // // remove all 'finish' event-handlers (from caller)
    // stream.removeAllListeners('finish');

    // // re-attach *our* 'finish' event-handlers
    // for (const cb of finishHandlers) {
    //   stream.on('finish', cb);
    // }

  }

}


module.exports = TGFileSystem;